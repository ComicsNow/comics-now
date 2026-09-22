"""Waterstones metadata source.

Extracted from the legacy tagger.py monolith and optimized for high performance,
domain rate limiting, and multi-level caching.
"""
import re
import urllib.parse
from bs4 import BeautifulSoup

from tagger_app.config import HEADERS, get_browser_headers
from tagger_app.core.metadata import (
    normalize_metadata,
    calculate_similarity,
    clean_author_names,
    clean_description,
    normalize_publisher,
    score_candidate,
)
from tagger_app.core.covers import compare_covers_python
from tagger_app.core.query import clean_search_query
from tagger_app.core.cache import tagger_cache
from tagger_app.core.limiter import domain_limiter


def parse_waterstones_product_soup(soup, url):
    title_tag = soup.find(attrs={"itemprop": "name"}) or soup.find('h1')
    if not title_tag:
        return None
    title = title_tag.get_text(strip=True)

    authors = []
    for author_tag in soup.find_all(attrs={"itemprop": "author"}):
        a_name = author_tag.get_text(strip=True)
        a_name = re.sub(r'\(.*?\)', '', a_name).strip()
        if a_name and a_name not in authors:
            authors.append(a_name)

    if not authors:
        author_preview = soup.find('div', class_='author-preview')
        if author_preview:
            h4 = author_preview.find('h4')
            if h4:
                authors.append(h4.get_text(strip=True))

    desc_div = soup.find(attrs={"itemprop": "description"}) or soup.find('div', class_='tab-content-synopsis')
    description = clean_description(desc_div.get_text(separator=' ', strip=True)) if desc_div else ""

    publisher = None
    pub_tag = soup.find(attrs={"itemprop": "publisher"})
    if pub_tag:
        publisher = pub_tag.get_text(strip=True)

    isbn = None
    isbn_tag = soup.find(attrs={"itemprop": "isbn"})
    if isbn_tag:
        isbn = isbn_tag.get_text(strip=True).replace('-', '').strip()

    pages = None
    pages_tag = soup.find(attrs={"itemprop": "numberOfPages"})
    if pages_tag:
        pages = pages_tag.get_text(strip=True)

    publish_date = None
    date_tag = soup.find(attrs={"itemprop": "datePublished"})
    if date_tag:
        publish_date = date_tag.get('content') or date_tag.get_text(strip=True)

    spec_div = soup.find('div', class_='pdp-spec')
    if spec_div:
        spec_text = spec_div.get_text(separator=' ', strip=True)
        if not publisher:
            pub_match = re.search(r'Publisher:\s*(.*?)(?:ISBN:|$)', spec_text, re.I)
            if pub_match:
                publisher = pub_match.group(1).strip()
        if not isbn:
            isbn_match = re.search(r'ISBN:\s*(\d{10,13})', spec_text, re.I)
            if isbn_match:
                isbn = isbn_match.group(1).strip()
        if not pages:
            pages_match = re.search(r'Number of pages:\s*(\d+)', spec_text, re.I)
            if pages_match:
                pages = pages_match.group(1).strip()

    if publisher:
        publisher = normalize_publisher(publisher)

    if not isbn:
        isbn_match = re.search(r'/(\d{10,13})$', url)
        if isbn_match:
            isbn = isbn_match.group(1)

    cover_image_url = None
    og_img = soup.find('meta', property='og:image')
    if og_img:
        cover_image_url = og_img.get('content')

    if not cover_image_url and isbn:
        cover_image_url = f"https://cdn.waterstones.com/bookjackets/large/{isbn[:4]}/{isbn[4:8]}/{isbn}.jpg"

    metadata = {
        "title": title,
        "authors": clean_author_names(authors),
        "writer": ", ".join(authors) if authors else None,
        "isbn": isbn,
        "publisher": publisher,
        "publish_date": publish_date,
        "description": description,
        "genres": ["Comics"],
        "source_url": url,
        "cover_image_url": cover_image_url,
        "pages": pages
    }
    return metadata


def search_waterstones_multi(query, limit=2):
    cached = tagger_cache.get_query("waterstones", query)
    if cached is not None:
        return cached

    print(f"[*] Querying Waterstones Search for query: '{query}'")
    encoded = urllib.parse.quote_plus(query)
    url = f"https://www.waterstones.com/books/search/term/{encoded}"
    candidates = []

    try:
        import cloudscraper
        scraper = cloudscraper.create_scraper()
        scraper.headers.update(get_browser_headers(query=query))
        domain_limiter.wait_for_domain("waterstones.com")
        response = scraper.get(url, allow_redirects=True, timeout=15)
        if response.status_code != 200:
            print(f"[-] Waterstones search returned status: {response.status_code}")
            return []

        soup = BeautifulSoup(response.text, 'html.parser')

        if '/book/' in response.url and not '/search/' in response.url:
            print("[+] Waterstones search redirected directly to product page.")
            meta = parse_waterstones_product_soup(soup, response.url)
            if meta:
                candidates.append(meta)
            tagger_cache.set_query("waterstones", query, candidates)
            return candidates

        links = soup.find_all('a', href=True)
        product_paths = []
        for l in links:
            href = l['href']
            if '/book/' in href and not '/books/' in href:
                isbn_match = re.search(r'/(\d{10,13})$', href)
                if isbn_match and href not in product_paths:
                    product_paths.append(href)

        product_paths = product_paths[:limit]
        print(f"[*] Waterstones found {len(product_paths)} product URLs to fetch.")

        for path in product_paths:
            prod_url = f"https://www.waterstones.com{path}" if path.startswith('/') else path
            cached_prod = tagger_cache.get_entity("waterstones_page", prod_url)
            if cached_prod is not None:
                candidates.append(cached_prod)
                continue

            try:
                domain_limiter.wait_for_domain("waterstones.com")
                res = scraper.get(prod_url, timeout=10)
                if res.status_code == 200:
                    prod_soup = BeautifulSoup(res.text, 'html.parser')
                    meta = parse_waterstones_product_soup(prod_soup, prod_url)
                    if meta:
                        tagger_cache.set_entity("waterstones_page", prod_url, meta)
                        candidates.append(meta)
            except Exception as e:
                print(f"[-] Failed to fetch Waterstones detail {prod_url}: {e}")

    except Exception as e:
        print(f"[-] Waterstones search failed: {e}")

    tagger_cache.set_query("waterstones", query, candidates)
    return candidates


def resolve_waterstones(filename, cover_path=None, on_progress=None, existing_meta=None):
    if on_progress:
        on_progress("Searching Waterstones...")
    query = clean_search_query(filename)

    try:
        res = search_waterstones_multi(query, limit=2)
    except Exception as e:
        print(f"[-] Waterstones resolve failed: {e}")
        return []

    candidates = []
    for r in res:
        candidates.append(score_candidate(filename, r, cover_path=cover_path, default_source="Waterstones"))
    return candidates
