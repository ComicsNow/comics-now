"""League of Comic Geeks metadata source.

LCG has no public API, so we discover the comic's page via DuckDuckGo
(site:leagueofcomicgeeks.com/comic/) and then parse the metadata straight off that
page (OpenGraph tags + the details block) with caching and rate limiting.
"""
import re
from bs4 import BeautifulSoup

from tagger_app.core.metadata import (
    clean_description,
    normalize_publisher,
    score_candidate,
)
from tagger_app.core.query import clean_search_query
from tagger_app.core.cache import tagger_cache
from tagger_app.core.limiter import domain_limiter


def parse_lcg_product_page(html, url):
    """Extract metadata from a League of Comic Geeks /comic/ page.

    Sources the fields from OpenGraph meta tags and the page's details text:
      og:title        -> "Series #N Reviews"  -> series + issue number
      og:description  -> "...from <creators>, published by <publisher>"
      body            -> "Released <Mon DD, YYYY>" -> publish date / year
      og:image        -> cover URL
    """
    soup = BeautifulSoup(html, "html.parser")

    def og(prop):
        tag = soup.find("meta", property=prop) or soup.find("meta", attrs={"name": prop})
        content = tag.get("content") if tag else None
        return content.strip() if content else None

    raw_title = og("og:title") or (soup.title.string.strip() if soup.title and soup.title.string else "")
    title = re.sub(r'\s+Reviews\s*$', '', raw_title).strip()
    raw_desc = og("og:description") or ""
    cover = og("og:image")
    canonical = og("og:url") or url

    # Try finding real synopsis on the page
    synopsis_div = (
        soup.find('div', class_='description')
        or soup.find('div', class_='details-description')
        or soup.find('div', class_='listing-description')
    )
    desc = synopsis_div.get_text(separator=' ', strip=True) if synopsis_div else raw_desc
    desc = clean_description(desc)

    # Series + issue number from "Series #N"
    series, number = title, None
    m = re.search(r'^(.*?)\s+#\s*([\d.]+)\b', title)
    if m:
        series = m.group(1).strip()
        number = m.group(2)

    # "...from <creators>, published by <publisher>"
    publisher = None
    mp = re.search(r'published by\s+(.+?)\s*$', raw_desc)
    if mp:
        publisher = mp.group(1).strip().rstrip('.')
    if publisher:
        publisher = normalize_publisher(publisher)

    writer = None
    mc = re.search(r'\bfrom\s+(.+?),\s*published by', raw_desc)
    if mc:
        writer = mc.group(1).strip()

    # "Released <Mon DD, YYYY>" in the details block
    publish_date = None
    text = soup.get_text(" ", strip=True)
    md = re.search(r'Released\s+([A-Z][a-z]{2,9}\.?\s+\d{1,2},?\s+\d{4})', text)
    if md:
        publish_date = md.group(1)

    return {
        "title": title,
        "series": series,
        "number": number,
        "publisher": publisher,
        "publish_date": publish_date,
        "writer": writer or "",
        "authors": [writer] if writer else [],
        "description": desc,
        "genres": ["Comics"],
        "source_url": canonical,
        "cover_image_url": cover,
    }


def search_lcg_multi(query):
    """Find LCG comic pages via DuckDuckGo and parse each one directly (with caching)."""
    cached = tagger_cache.get_query("lcg", query)
    if cached is not None:
        return cached

    out = []
    try:
        from ddgs import DDGS
        import cloudscraper
        scraper = cloudscraper.create_scraper()
        search_q = f"site:leagueofcomicgeeks.com/comic/ {query}"
        domain_limiter.wait_for_domain("duckduckgo.com")
        ddg_results = list(DDGS().text(search_q, max_results=5))
        for r in ddg_results:
            url = r.get("href", "")
            if "leagueofcomicgeeks.com/comic/" not in url:
                continue

            cached_meta = tagger_cache.get_entity("lcg_page", url)
            if cached_meta is not None:
                out.append(cached_meta)
                continue

            try:
                domain_limiter.wait_for_domain("leagueofcomicgeeks.com")
                resp = scraper.get(url, timeout=20)
                if resp.status_code == 200:
                    meta = parse_lcg_product_page(resp.text, url)
                    if meta and meta.get("series"):
                        tagger_cache.set_entity("lcg_page", url, meta)
                        out.append(meta)
            except Exception as e:
                print(f"[-] LCG page fetch failed for {url}: {e}")
    except Exception as e:
        print(f"[-] LCG search multi failed: {e}")

    tagger_cache.set_query("lcg", query, out)
    return out


def resolve_lcg(filename, cover_path=None, on_progress=None, existing_meta=None):
    if on_progress:
        on_progress("Searching League of Comic Geeks (via DDG + LCG page)...")
    query = clean_search_query(filename)

    try:
        res = search_lcg_multi(query)
    except Exception as e:
        print(f"[-] LCG resolve failed: {e}")
        return []

    candidates = []
    for r in res:
        candidates.append(score_candidate(filename, r, cover_path=cover_path, default_source="League of Comic Geeks"))
    return candidates
