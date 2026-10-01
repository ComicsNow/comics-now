"""Forbidden Planet metadata source.

Optimized for high performance, domain rate limiting, multi-level caching,
and Google Search referrer simulation.
"""
import re
import urllib.parse
import json
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


def parse_forbiddenplanet_product_soup(soup, url):
    """Parse a Forbidden Planet product detail page soup into normalized metadata."""
    if not soup:
        return None

    # 1. Attempt schema.org Product JSON-LD extraction
    json_ld = None
    for s in soup.find_all('script', type='application/ld+json'):
        try:
            d = json.loads(s.string)
            if isinstance(d, dict) and d.get('@type') == 'Product':
                json_ld = d
                break
        except Exception:
            pass

    # 2. Title extraction
    title = json_ld.get('name') if json_ld else None
    if not title:
        h1 = soup.find('h1')
        title = h1.get_text(strip=True) if h1 else None
    if not title:
        og_title = soup.find('meta', property='og:title')
        title = og_title.get('content', '').strip() if og_title else None
    if not title:
        return None

    # Clean off trailing '@ ForbiddenPlanet.com' if present
    title = re.sub(r'\s*@\s*ForbiddenPlanet\.com.*$', '', title, flags=re.IGNORECASE).strip()

    # 3. Field initializations
    writers = []
    artists = []
    authors = []
    publisher = None
    isbn = None
    publish_date = json_ld.get('releaseDate') if json_ld else None
    description = clean_description(json_ld.get('description', '')) if json_ld else ''
    series = None
    volume = None

    # 4. Specifications extraction from product <dl> containers
    # Prioritize product-specific detail dl containers over site-wide nav menus
    spec_dls = soup.find_all('dl', class_=lambda c: c and any(k in str(c) for k in ('txt-left', 'owlq')))
    dl_list = spec_dls if spec_dls else soup.find_all('dl')

    for dl in dl_list:
        for dt in dl.find_all('dt'):
            label = dt.get_text(strip=True).lower().rstrip(':')
            # Ignore site-wide navigation lists
            if label in ('top publishers', 'publishers', 'popular', 'top series', 'shop subscriptions', 'genres'):
                continue
            dd = dt.find_next_sibling('dd')
            if not dd:
                continue
            links = [a.get_text(strip=True) for a in dd.find_all('a')]
            val = dd.get_text(strip=True)

            if label in ('author', 'writer', 'written by'):
                vals = links if links else [v.strip() for v in val.split(',') if v.strip()]
                for v in vals:
                    if v not in writers:
                        writers.append(v)
                    if v not in authors:
                        authors.append(v)
            elif label in ('artist', 'artists', 'illustrator', 'penciller'):
                vals = links if links else [v.strip() for v in val.split(',') if v.strip()]
                for v in vals:
                    if v not in artists:
                        artists.append(v)
                    if v not in authors:
                        authors.append(v)
            elif label in ('publisher', 'published by'):
                if not publisher:
                    publisher = links[0] if links else val
            elif label in ('isbn', 'ean'):
                if not isbn and re.match(r'^\d{10,17}$', val):
                    isbn = val
            elif label in ('publication date', 'release date', 'published') and not publish_date:
                publish_date = val
            elif label == 'series' and not series:
                series = links[0] if links else val
            elif label == 'volume' and not volume:
                volume = val

    # Fallback publisher from title tag: "published by DC Comics @ ForbiddenPlanet.com"
    if not publisher and soup.title:
        pub_m = re.search(r'published by\s+(.*?)\s*@\s*ForbiddenPlanet', soup.title.string, re.I)
        if pub_m:
            publisher = pub_m.group(1).strip()

    # Fallback description from meta tag
    if not description:
        og_desc = soup.find('meta', property='og:description') or soup.find('meta', attrs={'name': 'description'})
        if og_desc:
            description = clean_description(og_desc.get('content', ''))

    # Normalize publisher
    if publisher:
        publisher = normalize_publisher(publisher)

    # Fallback ISBN from JSON-LD
    if not isbn and json_ld:
        isbn = json_ld.get('gtin13') or (
            json_ld.get('productID', '').replace('isbn:', '') if 'isbn:' in json_ld.get('productID', '') else None
        )

    # High-resolution cover artwork
    cover_image_url = None
    tw_img = soup.find('meta', property='twitter:image')
    if tw_img and tw_img.get('content'):
        cover_image_url = tw_img['content']
    elif json_ld and json_ld.get('image'):
        cover_image_url = json_ld['image']
    elif soup.find('meta', property='og:image'):
        cover_image_url = soup.find('meta', property='og:image').get('content')

    metadata = {
        "title": title,
        "authors": clean_author_names(authors),
        "writer": ", ".join(writers) if writers else None,
        "penciller": ", ".join(artists) if artists else None,
        "isbn": isbn,
        "publisher": publisher,
        "publish_date": publish_date,
        "description": description,
        "genres": ["Comics"],
        "source_url": url,
        "cover_image_url": cover_image_url,
    }
    if series:
        metadata["series"] = series
    if volume:
        metadata["volume"] = volume

    return metadata


def search_forbiddenplanet_multi(query, limit=2):
    """Search Forbidden Planet for comic / graphic novel products and parse detail pages."""
    cached = tagger_cache.get_query("forbiddenplanet", query)
    if cached is not None:
        return cached

    print(f"[*] Querying Forbidden Planet Search for query: '{query}'")
    encoded = urllib.parse.quote_plus(query)
    # Search specifically in the comics and graphic novels catalog
    url = f"https://forbiddenplanet.com/catalog/comics-and-graphic-novels/?q={encoded}"
    candidates = []

    try:
        import cloudscraper
        scraper = cloudscraper.create_scraper()
        # Google Search referrer spoofing
        scraper.headers.update(get_browser_headers(query=query))
        domain_limiter.wait_for_domain("forbiddenplanet.com")
        response = scraper.get(url, allow_redirects=True, timeout=15)
        if response.status_code != 200:
            print(f"[-] Forbidden Planet search returned status: {response.status_code}")
            return []

        soup = BeautifulSoup(response.text, 'html.parser')

        # Direct product page redirect handling (e.g. exact ISBN / SKU search)
        if re.search(r'/\d+-[^/]+/?$', response.url) and '/catalog/' not in response.url:
            print("[+] Forbidden Planet search redirected directly to product page.")
            meta = parse_forbiddenplanet_product_soup(soup, response.url)
            if meta:
                candidates.append(meta)
            tagger_cache.set_query("forbiddenplanet", query, candidates)
            return candidates

        # Extract product cards from the listing container
        product_paths = []
        listing = soup.find('ul', class_='listing')
        if listing:
            for item in listing.find_all('li', recursive=False):
                link = item.find('a', href=True)
                if link:
                    href = link['href']
                    if re.search(r'/\d+-[^/]+/?$', href) and href not in product_paths:
                        product_paths.append(href)
                        if len(product_paths) >= limit:
                            break

        print(f"[*] Forbidden Planet found {len(product_paths)} product URLs to fetch.")

        for path in product_paths:
            prod_url = f"https://forbiddenplanet.com{path}" if path.startswith('/') else path
            cached_prod = tagger_cache.get_entity("forbiddenplanet_page", prod_url)
            if cached_prod is not None:
                candidates.append(cached_prod)
                continue

            try:
                domain_limiter.wait_for_domain("forbiddenplanet.com")
                # Detail request transitions to same-origin navigation
                scraper.headers.update(get_browser_headers(referer=response.url))
                res = scraper.get(prod_url, timeout=10)
                if res.status_code == 200:
                    prod_soup = BeautifulSoup(res.text, 'html.parser')
                    meta = parse_forbiddenplanet_product_soup(prod_soup, prod_url)
                    if meta:
                        tagger_cache.set_entity("forbiddenplanet_page", prod_url, meta)
                        candidates.append(meta)
            except Exception as e:
                print(f"[-] Failed to fetch Forbidden Planet detail {prod_url}: {e}")

    except Exception as e:
        print(f"[-] Forbidden Planet search failed: {e}")

    tagger_cache.set_query("forbiddenplanet", query, candidates)
    return candidates


def resolve_forbiddenplanet(filename, cover_path=None, on_progress=None, existing_meta=None):
    """Main resolver interface called by registry orchestrator."""
    if on_progress:
        on_progress("Searching Forbidden Planet...")
    query = clean_search_query(filename)

    try:
        res = search_forbiddenplanet_multi(query, limit=2)
    except Exception as e:
        print(f"[-] Forbidden Planet resolve failed: {e}")
        return []

    candidates = []
    for r in res:
        candidates.append(score_candidate(filename, r, cover_path=cover_path, default_source="ForbiddenPlanet"))
    return candidates
