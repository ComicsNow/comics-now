"""Goodreads metadata source.

Extracted from the legacy tagger.py monolith and optimized for high performance,
domain rate limiting, and multi-level caching.
"""
import json
import urllib.parse
from bs4 import BeautifulSoup
import requests

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


def parse_goodreads_ld_json(goodreads_url, session=None, query=None):
    """
    Fetches a Goodreads page and parses the schema.org JSON-LD to extract structured book data.
    """
    cached = tagger_cache.get_entity("goodreads_page", goodreads_url)
    if cached is not None:
        return cached

    print(f"[*] Fetching Goodreads page: {goodreads_url}")
    domain_limiter.wait_for_domain("goodreads.com")

    headers = get_browser_headers(query=query, referer="https://www.google.com/")
    if session:
        response = session.get(goodreads_url, headers=headers, timeout=20)
    else:
        try:
            import cloudscraper
            scraper = cloudscraper.create_scraper()
            response = scraper.get(goodreads_url, headers=headers, timeout=20)
        except Exception as e:
            print(f"[!] Could not create cloudscraper: {e}. Falling back to requests.")
            response = requests.get(goodreads_url, headers=headers, timeout=20)

    if response.status_code == 202:
        print("[-] Goodreads page returned AWS WAF Challenge (status 202). Cannot bypass without JS rendering.")
        return None
    elif response.status_code != 200:
        print(f"[-] Failed to load Goodreads page: status code {response.status_code}")
        return None

    soup = BeautifulSoup(response.content, 'html.parser')
    script_tag = soup.find('script', type='application/ld+json')

    if not script_tag:
        print("[-] Could not locate structured JSON-LD data on Goodreads page.")
        return None

    try:
        data = json.loads(script_tag.string)
    except Exception as e:
        print(f"[-] Error decoding JSON-LD: {e}")
        return None

    cover_image = data.get("image")
    if isinstance(cover_image, dict):
        cover_image = cover_image.get("url")
    elif isinstance(cover_image, list) and cover_image:
        cover_image = cover_image[0]

    publisher = data.get("publisher", {}).get("name") if isinstance(data.get("publisher"), dict) else data.get("publisher")
    if publisher:
        publisher = normalize_publisher(publisher)

    metadata = {
        "title": data.get("name"),
        "authors": clean_author_names([author.get("name") for author in data.get("author", []) if "name" in author]),
        "isbn": data.get("isbn"),
        "publisher": publisher,
        "publish_date": data.get("datePublished"),
        "description": data.get("description"),
        "genres": data.get("genre", []),
        "source_url": goodreads_url,
        "cover_image_url": cover_image,
        "pages": str(data.get("numberOfPages") or data.get("pageCount")) if (data.get("numberOfPages") or data.get("pageCount")) else None
    }

    if metadata["description"]:
        desc_soup = BeautifulSoup(metadata["description"], 'html.parser')
        metadata["description"] = clean_description(desc_soup.get_text())
    else:
        metadata["description"] = ""

    tagger_cache.set_entity("goodreads_page", goodreads_url, metadata)
    print(f"[+] Successfully extracted metadata for: '{metadata['title']}' by {', '.join(metadata['authors'])}")
    return metadata


def search_goodreads_multi(query):
    cached = tagger_cache.get_query("goodreads", query)
    if cached is not None:
        return cached

    print(f"[*] Querying Goodreads Search for query: '{query}'")
    encoded = urllib.parse.quote(query)
    url = f"https://www.goodreads.com/search?q={encoded}"
    candidates = []

    try:
        import cloudscraper
        scraper = cloudscraper.create_scraper()
        scraper.headers.update(get_browser_headers(query=query))

        domain_limiter.wait_for_domain("goodreads.com")
        r = scraper.get(url, timeout=20)
        if r.status_code == 202:
            print("[-] Goodreads search returned AWS WAF Challenge (status 202). Cannot bypass without JS rendering.")
            return []
        elif r.status_code != 200:
            print(f"[-] Goodreads search returned status: {r.status_code}")
            return []

        soup = BeautifulSoup(r.content, 'html.parser')

        # Check if redirected directly
        if '/book/show/' in r.url or ('/book/' in r.url and not '/search' in r.url):
            print("[+] Goodreads search redirected directly to product page.")
            meta = parse_goodreads_ld_json(r.url, session=scraper)
            if meta:
                candidates.append(meta)
            tagger_cache.set_query("goodreads", query, candidates)
            return candidates

        links = soup.select('a.bookTitle[href*="/book/show/"]') or \
                soup.select('a[href*="/book/show/"]')

        product_paths = []
        for l in links:
            href = l.get('href')
            if href and href not in product_paths:
                product_paths.append(href)

        product_paths = product_paths[:2]
        print(f"[*] Goodreads found {len(product_paths)} book URLs to fetch.")

        for path in product_paths:
            prod_url = f"https://www.goodreads.com{path}" if path.startswith('/') else path
            try:
                meta = parse_goodreads_ld_json(prod_url, session=scraper)
                if meta:
                    candidates.append(meta)
            except Exception as e:
                print(f"[-] Failed to fetch Goodreads detail {prod_url}: {e}")

    except Exception as e:
        print(f"[-] Goodreads search failed: {e}")

    tagger_cache.set_query("goodreads", query, candidates)
    return candidates


def resolve_goodreads(filename, cover_path=None, on_progress=None, existing_meta=None):
    if on_progress:
        on_progress("Searching Goodreads...")
    query = clean_search_query(filename)

    try:
        res = search_goodreads_multi(query)
    except Exception as e:
        print(f"[-] Goodreads resolve failed: {e}")
        return []

    candidates = []
    for r in res:
        candidates.append(score_candidate(filename, r, cover_path=cover_path, default_source="Goodreads"))
    return candidates
