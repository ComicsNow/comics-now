"""Amazon metadata source.

Provides resilient metadata querying, synopsis extraction, ISBN resolution,
and high-resolution cover retrieval via Amazon Books with anti-bot kindness,
Google Search referrer simulation, and multi-layer DOM extraction fallbacks.
"""
import re
import json
import urllib.parse
from bs4 import BeautifulSoup
import requests

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


def _clean_text(text: str) -> str:
    """Normalize whitespace and strip invisible Unicode direction markers."""
    if not text:
        return ""
    # Remove zero-width & direction markers (‎, ‏,  )
    cleaned = re.sub(r'[‎‏​‪-‮ ]', ' ', text)
    return re.sub(r'\s+', ' ', cleaned).strip()


def parse_amazon_product_soup(soup, url):
    """
    Parses an Amazon book product page using a multi-strategy resilient extractor:
    1. Structured schema.org JSON-LD & meta tags.
    2. Primary Amazon desktop selectors (with expander & noscript fallbacks).
    3. Dynamic JSON image parser for maximum resolution cover extraction.
    4. Fuzzy semantic DOM scanner (traverses all DOM elements to find ISBN, publisher, pages, etc.).
    """
    if not soup:
        return None

    # 0. Anti-bot / CAPTCHA challenge detection
    page_text = soup.get_text()
    if 'Robot Check' in page_text or 'validateCaptcha' in page_text or 'Type the characters you see in this image' in page_text:
        print(f'[-] Amazon anti-bot challenge encountered on {url}; skipping gracefully.')
        return None

    title = None
    authors = []
    writer = None
    penciller = None
    colorist = None
    inkers = []
    publisher = None
    publish_date = None
    isbn = None
    pages = None
    description = None
    cover_image_url = None

    # 1. Strategy 1: JSON-LD Structured Data
    for script_tag in soup.find_all('script', type='application/ld+json'):
        try:
            ld_data = json.loads(script_tag.string or '{}')
            if isinstance(ld_data, list):
                ld_data = ld_data[0] if ld_data else {}
            if isinstance(ld_data, dict) and ('Book' in ld_data.get('@type', '') or 'Product' in ld_data.get('@type', '')):
                if not title:
                    title = ld_data.get('name')
                if not description:
                    description = ld_data.get('description')
                if not isbn:
                    isbn = ld_data.get('isbn')
                if not pages and ld_data.get('numberOfPages'):
                    pages = str(ld_data.get('numberOfPages'))
                if not cover_image_url and ld_data.get('image'):
                    img = ld_data.get('image')
                    cover_image_url = img if isinstance(img, str) else (img.get('url') if isinstance(img, dict) else None)
                if not publisher and ld_data.get('publisher'):
                    pub = ld_data.get('publisher')
                    publisher = pub.get('name') if isinstance(pub, dict) else (pub if isinstance(pub, str) else None)
        except Exception:
            pass

    # 2. Strategy 2: Primary Known Selectors
    # Title
    if not title:
        title_tag = (
            soup.find('span', id='productTitle')
            or soup.find('span', id='bookTitle')
            or soup.find('h1', id='title')
            or soup.find('h1', class_='a-size-large')
            or soup.find('h1')
        )
        if title_tag:
            title = _clean_text(title_tag.get_text())

    # Fallback to og:title or meta title
    if not title:
        og_title = soup.find('meta', property='og:title') or soup.find('meta', attrs={'name': 'title'})
        if og_title and og_title.get('content'):
            title = _clean_text(og_title['content'])
            title = re.sub(r':\s*Amazon\.[a-z.]+:.*$', '', title, flags=re.I).strip()

    if not title:
        return None

    # Authors & Contributors
    byline = soup.find('div', id='bylineInfo') or soup.find('div', id='bylineInfo_feature_div')
    if byline:
        author_spans = byline.find_all(['span', 'a'], class_=re.compile(r'author|contributorNameID|a-link-normal', re.I))
        for span in author_spans:
            raw_author = _clean_text(span.get_text())
            if not raw_author or raw_author.lower() in ["author", "visit amazon's", "follow the author", "by"]:
                continue
            # Check for role in parentheses e.g. "Alan Moore (Author)", "Dave Gibbons (Illustrator)"
            role_m = re.search(r'\((.*?)\)', raw_author)
            clean_name = re.sub(r'\(.*?\)', '', raw_author).strip()
            clean_name = re.sub(r'^by\s+', '', clean_name, flags=re.I).strip()

            if clean_name and len(clean_name) > 1 and clean_name not in authors:
                authors.append(clean_name)
                if role_m:
                    role = role_m.group(1).lower()
                    if 'author' in role or 'writer' in role:
                        writer = clean_name
                    elif 'illustrator' in role or 'artist' in role or 'penciller' in role:
                        penciller = clean_name
                    elif 'color' in role:
                        colorist = clean_name
                    elif 'ink' in role:
                        inkers.append(clean_name)

    # Description (with expander, noscript, and editorial review fallbacks)
    if not description:
        desc_div = (
            soup.find('div', id='bookDescription_feature_div')
            or soup.find('div', id='productDescription')
            or soup.find('div', id='editorialReviews_feature_div')
            or soup.find('div', attrs={'data-feature-name': 'bookDescription'})
        )
        if desc_div:
            # Check noscript first for un-minified raw HTML
            noscript = desc_div.find('noscript')
            if noscript and noscript.string:
                try:
                    ns_soup = BeautifulSoup(noscript.string, 'html.parser')
                    description = _clean_text(ns_soup.get_text())
                except Exception:
                    pass

            if not description:
                expander = desc_div.find('div', class_='a-expander-content') or desc_div
                description = _clean_text(expander.get_text())

    # Fallback to meta description
    if not description or len(description) < 20:
        meta_desc = soup.find('meta', attrs={'name': 'description'}) or soup.find('meta', property='og:description')
        if meta_desc and meta_desc.get('content'):
            description = _clean_text(meta_desc['content'])

    # Clean description boilerplate prefixes
    if description:
        description = re.sub(r'^(?:SUMMARY|Product Description|Editorial Reviews|About the Author|Book Description)\s*:\s*', '', description, flags=re.I).strip()

    # Details: Detail Bullets List (#detailBullets_feature_div)
    bullets_container = soup.find('div', id='detailBullets_feature_div') or soup.find('div', id='detailBulletsWrapper_feature_div')
    isbn_13 = None
    isbn_10 = None
    if bullets_container:
        for li in bullets_container.find_all('li'):
            li_text = _clean_text(li.get_text())
            if not li_text:
                continue

            if 'ISBN-13' in li_text:
                m = re.search(r'ISBN-13\s*:\s*([0-9-]{13,17})', li_text, re.I)
                if m:
                    isbn_13 = m.group(1).replace('-', '').strip()
            elif 'ISBN-10' in li_text:
                m = re.search(r'ISBN-10\s*:\s*([0-9X-]{10,13})', li_text, re.I)
                if m:
                    isbn_10 = m.group(1).replace('-', '').strip()
            elif 'Publisher' in li_text and not publisher:
                m = re.search(r'Publisher\s*:\s*([^;(]+)', li_text, re.I)
                if m:
                    publisher = _clean_text(m.group(1))
            elif ('Print length' in li_text or 'pages' in li_text.lower()) and not pages:
                m = re.search(r'(\d+)\s*pages?', li_text, re.I)
                if m:
                    pages = m.group(1)
            elif 'Publication date' in li_text and not publish_date:
                m = re.search(r'Publication date\s*:\s*(.+)$', li_text, re.I)
                if m:
                    publish_date = _clean_text(m.group(1))

    if isbn_13:
        isbn = isbn_13
    elif isbn_10 and not isbn:
        isbn = isbn_10

    # Details: Table layout (#productDetailsTable or table.a-keyvalue)
    if not isbn or not publisher or not pages:
        for tr in soup.find_all('tr'):
            th = tr.find('th') or tr.find('td', class_='a-span3')
            td = tr.find('td') or tr.find('td', class_='a-span9')
            if th and td:
                label = _clean_text(th.get_text()).lower()
                val = _clean_text(td.get_text())
                if 'isbn-13' in label:
                    isbn = re.sub(r'[^0-9]', '', val)
                elif 'isbn-10' in label and not isbn:
                    isbn = re.sub(r'[^0-9X]', '', val)
                elif 'publisher' in label and not publisher:
                    publisher = re.split(r'[;(]', val)[0].strip()
                elif ('pages' in label or 'length' in label) and not pages:
                    m = re.search(r'(\d+)', val)
                    if m:
                        pages = m.group(1)
                elif 'publication date' in label and not publish_date:
                    publish_date = val

    # 3. Strategy 3: Resilient "Dumb/Fuzzy Semantic Scanner" (traverses all elements)
    if not isbn or not publisher or not pages:
        for elem in soup.find_all(['li', 'div', 'p', 'span']):
            t = _clean_text(elem.get_text())
            if not isbn:
                m = re.search(r'(?:ISBN-13|ISBN 13|ISBN13)\s*[:\s]*([0-9-]{13,17})', t, re.I)
                if m:
                    isbn = m.group(1).replace('-', '').strip()
                else:
                    m10 = re.search(r'(?:ISBN-10|ISBN 10|ISBN10)\s*[:\s]*([0-9X-]{10,13})', t, re.I)
                    if m10:
                        isbn = m10.group(1).replace('-', '').strip()
            if not publisher:
                mp = re.search(r'Publisher\s*[:\s]+([A-Za-z0-9\s.,&\'-]+?)(?:;|\(|$|\n)', t, re.I)
                if mp and len(mp.group(1).strip()) > 2 and len(mp.group(1).strip()) < 60:
                    publisher = _clean_text(mp.group(1))
            if not pages:
                mpg = re.search(r'(?:Print length|Hardcover|Paperback|Length)\s*[:\s]*(\d+)\s*pages?', t, re.I)
                if mpg:
                    pages = mpg.group(1)

    # 4. Strategy 4: High-Resolution Cover Art Extraction
    if not cover_image_url:
        img_elem = soup.find('img', id='landingImage') or soup.find('img', id='imgBlkFront') or soup.find('img', id='ebooksImgBlkFront')
        if img_elem:
            # Check dynamic image resolution map (JSON in data-a-dynamic-image)
            dynamic_data = img_elem.get('data-a-dynamic-image')
            if dynamic_data:
                try:
                    img_map = json.loads(dynamic_data)
                    if isinstance(img_map, dict) and img_map:
                        # Pick the image URL with the largest dimensions (w * h)
                        best_url = max(img_map.items(), key=lambda item: (item[1][0] * item[1][1]) if len(item[1]) >= 2 else 0)[0]
                        if best_url:
                            cover_image_url = best_url
                except Exception:
                    pass

            if not cover_image_url:
                cover_image_url = img_elem.get('data-old-hires') or img_elem.get('src')

    # Fallback cover from og:image
    if not cover_image_url:
        og_img = soup.find('meta', property='og:image')
        if og_img and og_img.get('content'):
            cover_image_url = og_img['content']

    # Final cleanup & normalization
    cleaned_authors = clean_author_names(authors)
    if not writer and cleaned_authors:
        writer = ', '.join(cleaned_authors)

    if publisher:
        publisher = normalize_publisher(publisher)

    metadata = {
        'title': title,
        'authors': cleaned_authors,
        'writer': writer,
        'penciller': penciller,
        'colorist': colorist,
        'inker': ', '.join(inkers) if inkers else None,
        'isbn': isbn,
        'publisher': publisher,
        'publish_date': publish_date,
        'description': clean_description(description),
        'genres': ['Comics'],
        'source_url': url,
        'cover_image_url': cover_image_url,
        'pages': pages
    }
    return metadata


def search_amazon_multi(query, limit=2):
    """Search Amazon Books for volume candidates with anti-bot headers & rate limits."""
    if not query or not query.strip():
        return []

    cached = tagger_cache.get_query('amazon', query)
    if cached is not None:
        return cached

    print(f"[*] Querying Amazon Books Search for query: '{query}'")
    encoded = urllib.parse.quote_plus(query)
    url = f"https://www.amazon.com/s?k={encoded}&i=stripbooks"
    candidates = []

    try:
        import cloudscraper
        scraper = cloudscraper.create_scraper()
        scraper.headers.update(get_browser_headers(query=query))

        domain_limiter.wait_for_domain('amazon.com')
        response = scraper.get(url, allow_redirects=True, timeout=15)
        if response.status_code != 200:
            print(f'[-] Amazon search returned status: {response.status_code}')
            return []

        soup = BeautifulSoup(response.text, 'html.parser')

        # Check if Amazon redirected directly to a product page (/dp/...)
        if '/dp/' in response.url or '/gp/product/' in response.url:
            print('[+] Amazon search redirected directly to product page.')
            meta = parse_amazon_product_soup(soup, response.url)
            if meta:
                candidates.append(meta)
            tagger_cache.set_query('amazon', query, candidates)
            return candidates

        # Find search result item cards
        result_cards = soup.select('div[data-component-type="s-search-result"]') or soup.select('div.s-result-item[data-asin]')
        product_urls = []

        for card in result_cards:
            asin = card.get('data-asin')
            if not asin:
                continue

            # Find title link
            title_link = card.select_one('h2 a[href]') or card.select_one('a.a-link-normal[href*="/dp/"]')
            if title_link:
                href = title_link.get('href', '')
                if href.startswith('/'):
                    prod_url = f'https://www.amazon.com{href}'
                else:
                    prod_url = href
                # Strip query trackers from product URL to normalize cache
                prod_url = re.sub(r'/ref=[^?]*', '', prod_url)
                prod_url = prod_url.split('?')[0]

                if prod_url not in product_urls:
                    product_urls.append(prod_url)

        product_urls = product_urls[:limit]
        print(f'[*] Amazon found {len(product_urls)} product URLs to fetch.')

        for prod_url in product_urls:
            cached_prod = tagger_cache.get_entity('amazon_page', prod_url)
            if cached_prod is not None:
                candidates.append(cached_prod)
                continue

            try:
                domain_limiter.wait_for_domain('amazon.com')
                res = scraper.get(prod_url, headers=get_browser_headers(referer=url), timeout=15)
                if res.status_code == 200:
                    prod_soup = BeautifulSoup(res.text, 'html.parser')
                    meta = parse_amazon_product_soup(prod_soup, prod_url)
                    if meta:
                        tagger_cache.set_entity('amazon_page', prod_url, meta)
                        candidates.append(meta)
                else:
                    print(f'[-] Amazon product page returned status {res.status_code} for {prod_url}')
            except Exception as e:
                print(f'[-] Failed to fetch Amazon detail {prod_url}: {e}')

    except Exception as e:
        print(f'[-] Amazon search failed: {e}')

    tagger_cache.set_query('amazon', query, candidates)
    return candidates


def resolve_amazon(filename, cover_path=None, on_progress=None, existing_meta=None):
    """Resolve metadata for a comic file via Amazon Books."""
    if on_progress:
        on_progress('Searching Amazon...')
    query = clean_search_query(filename)

    try:
        res = search_amazon_multi(query, limit=2)
    except Exception as e:
        print(f'[-] Amazon resolve failed: {e}')
        return []

    candidates = []
    for r in res:
        candidates.append(score_candidate(filename, r, cover_path=cover_path, default_source='Amazon'))
    return candidates
