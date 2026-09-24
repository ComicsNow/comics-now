"""Blackwell's metadata source.

Extracted from the legacy tagger.py monolith and optimized for high performance,
domain rate limiting, and multi-level caching.
"""
import re
import urllib.parse
from bs4 import BeautifulSoup

from tagger_app.config import get_browser_headers
from tagger_app.core.metadata import (
    clean_author_names,
    clean_description,
    normalize_publisher,
    score_candidate,
)
from tagger_app.core.query import clean_search_query
from tagger_app.core.cache import tagger_cache
from tagger_app.core.limiter import domain_limiter


def parse_blackwells_product_soup(soup, url):
    title_tag = soup.find('h1', class_='product__name') or soup.find('h1')
    if not title_tag:
        return None
    title = title_tag.get_text(strip=True)

    authors = []
    writers = []
    colorists = []
    pencillers = []
    inkers = []

    author_div = soup.find('p', class_='product__author')
    if author_div:
        for a_link in author_div.find_all('a'):
            a_text = a_link.get_text(strip=True).rstrip(',')
            role_match = re.search(r'\((.*?)\)', a_text)
            name = re.sub(r'\(.*?\)', '', a_text).strip()

            if role_match:
                role = role_match.group(1).lower()
                if 'author' in role or 'writer' in role:
                    if name not in writers:
                        writers.append(name)
                elif 'colourist' in role or 'colorist' in role:
                    if name not in colorists:
                        colorists.append(name)
                elif 'artist' in role or 'penciller' in role or 'illustrator' in role:
                    if name not in pencillers:
                        pencillers.append(name)
                elif 'inker' in role:
                    if name not in inkers:
                        inkers.append(name)
            if name not in authors:
                authors.append(name)

    if not authors and author_div:
        authors = [a.strip() for a in author_div.get_text(strip=True).split(',') if a.strip()]

    desc_div = soup.find('div', class_='description') or soup.find('div', class_='synopsis__content')
    description = clean_description(desc_div.get_text(separator=' ', strip=True)) if desc_div else ""

    publisher = None
    publish_date = None
    isbn = None
    pages = None

    table = None
    for t in soup.find_all('table'):
        text = t.get_text(strip=True).lower()
        if 'isbn' in text and 'basket' not in str(t.get('class', '')):
            table = t
            break
    if table:
        for row in table.find_all('tr'):
            cells = [c.get_text(strip=True) for c in row.find_all(['td', 'th'])]
            if len(cells) >= 2:
                key = cells[0].lower().rstrip(':')
                val = cells[1]
                if 'isbn' in key:
                    isbn = val.replace('-', '').strip()
                elif 'publisher' in key:
                    publisher = val
                elif 'pub date' in key or 'publication date' in key:
                    publish_date = val
                elif 'pages' in key:
                    pages_match = re.search(r'\d+', val)
                    if pages_match:
                        pages = pages_match.group(0)

    if publisher:
        publisher = normalize_publisher(publisher)

    if not isbn:
        isbn_match = re.search(r'/(\d{10,13})$', url)
        if isbn_match:
            isbn = isbn_match.group(1)

    cover_image_url = f"https://blackwells.co.uk/jacket/500x500/{isbn}.jpg" if isbn else None

    metadata = {
        "title": title,
        "authors": clean_author_names(authors),
        "writer": ", ".join(writers) if writers else None,
        "penciller": ", ".join(pencillers) if pencillers else None,
        "colorist": ", ".join(colorists) if colorists else None,
        "inker": ", ".join(inkers) if inkers else None,
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


def search_blackwells_multi(query, limit=2):
    cached = tagger_cache.get_query("blackwells", query)
    if cached is not None:
        return cached

    print(f"[*] Querying Blackwell's Search for query: '{query}'")
    encoded = urllib.parse.quote_plus(query)
    url = f"https://blackwells.co.uk/bookshop/search/?keyword={encoded}"
    candidates = []

    try:
        import cloudscraper
        scraper = cloudscraper.create_scraper()
        scraper.headers.update(get_browser_headers(query=query))
        domain_limiter.wait_for_domain("blackwells.co.uk")
        response = scraper.get(url, allow_redirects=True, timeout=15)
        if response.status_code != 200:
            print(f"[-] Blackwell's search returned status: {response.status_code}")
            return []

        soup = BeautifulSoup(response.text, 'html.parser')

        if '/product/' in response.url:
            print("[+] Blackwell's search redirected directly to product page.")
            meta = parse_blackwells_product_soup(soup, response.url)
            if meta:
                candidates.append(meta)
            tagger_cache.set_query("blackwells", query, candidates)
            return candidates

        links = soup.find_all('a', href=True)
        product_paths = []
        for l in links:
            href = l['href']
            if '/product/' in href and href not in product_paths:
                product_paths.append(href)

        product_paths = product_paths[:limit]
        print(f"[*] Blackwell's found {len(product_paths)} product URLs to fetch.")

        for path in product_paths:
            prod_url = f"https://blackwells.co.uk{path}"
            cached_prod = tagger_cache.get_entity("blackwells_page", prod_url)
            if cached_prod is not None:
                candidates.append(cached_prod)
                continue

            try:
                domain_limiter.wait_for_domain("blackwells.co.uk")
                res = scraper.get(prod_url, timeout=10)
                if res.status_code == 200:
                    prod_soup = BeautifulSoup(res.text, 'html.parser')
                    meta = parse_blackwells_product_soup(prod_soup, prod_url)
                    if meta:
                        tagger_cache.set_entity("blackwells_page", prod_url, meta)
                        candidates.append(meta)
            except Exception as e:
                print(f"[-] Failed to fetch Blackwell's detail {prod_url}: {e}")

    except Exception as e:
        print(f"[-] Blackwell's search failed: {e}")

    tagger_cache.set_query("blackwells", query, candidates)
    return candidates


def resolve_blackwells(filename, cover_path=None, on_progress=None, existing_meta=None):
    if on_progress:
        on_progress("Searching Blackwell's...")
    query = clean_search_query(filename)

    try:
        res = search_blackwells_multi(query, limit=2)
    except Exception as e:
        print(f"[-] Blackwell's resolve failed: {e}")
        return []

    candidates = []
    for r in res:
        candidates.append(score_candidate(filename, r, cover_path=cover_path, default_source="Blackwells"))
    return candidates
