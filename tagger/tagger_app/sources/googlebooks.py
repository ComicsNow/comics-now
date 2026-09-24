"""Google Books metadata source.

Provides high-speed metadata querying, synopsis extraction, ISBN resolution,
and cover art retrieval via Google Books API.
"""
import requests
from bs4 import BeautifulSoup

from tagger_app.config import HEADERS
from tagger_app.core.metadata import (
    clean_author_names,
    clean_description,
    normalize_publisher,
    score_candidate,
)
from tagger_app.core.query import clean_search_query
from tagger_app.core.cache import tagger_cache
from tagger_app.core.limiter import domain_limiter

GOOGLE_BOOKS_API_URL = "https://www.googleapis.com/books/v1/volumes"


def _extract_volume_metadata(item):
    """Extract standard metadata dictionary from a Google Books volume item."""
    if not item or not isinstance(item, dict):
        return None

    vol_info = item.get("volumeInfo", {})
    if not vol_info:
        return None

    title = vol_info.get("title", "")
    subtitle = vol_info.get("subtitle", "")
    full_title = f"{title}: {subtitle}" if (subtitle and subtitle.lower() not in title.lower()) else title

    authors = clean_author_names(vol_info.get("authors", []))
    publisher = vol_info.get("publisher")
    if publisher:
        publisher = normalize_publisher(publisher)
    published_date = vol_info.get("publishedDate")
    categories = vol_info.get("categories", [])
    page_count = str(vol_info.get("pageCount")) if vol_info.get("pageCount") else None

    # Description cleanup (strip html tags if present)
    desc = vol_info.get("description", "")
    if desc:
        try:
            desc = BeautifulSoup(desc, "html.parser").get_text()
        except Exception:
            pass
    desc = clean_description(desc)

    # ISBN extraction (prefer ISBN_13, fallback to ISBN_10)
    isbn = None
    industry_identifiers = vol_info.get("industryIdentifiers", [])
    for ident in industry_identifiers:
        if ident.get("type") == "ISBN_13":
            isbn = ident.get("identifier")
            break
        elif ident.get("type") == "ISBN_10" and not isbn:
            isbn = ident.get("identifier")

    # High-resolution cover art resolution
    image_links = vol_info.get("imageLinks", {})
    cover_image_url = (
        image_links.get("extraLarge")
        or image_links.get("large")
        or image_links.get("medium")
        or image_links.get("small")
        or image_links.get("thumbnail")
        or image_links.get("smallThumbnail")
    )
    if cover_image_url:
        if cover_image_url.startswith("http://"):
            cover_image_url = "https://" + cover_image_url[7:]
        # Remove zoom and curl artifacts for crisp images
        cover_image_url = cover_image_url.replace("&edge=curl", "")

    source_url = (
        vol_info.get("infoLink")
        or vol_info.get("canonicalVolumeLink")
        or f"https://books.google.com/books?id={item.get('id', '')}"
    )

    writer = ", ".join(authors) if authors else None

    meta = {
        "title": full_title or title,
        "authors": authors,
        "writer": writer,
        "isbn": isbn,
        "publisher": publisher,
        "publish_date": published_date,
        "description": desc,
        "genres": categories if categories else ["Comics"],
        "source_url": source_url,
        "cover_image_url": cover_image_url,
        "pages": page_count
    }
    return meta


def search_googlebooks_multi(query, api_key=None, limit=5):
    """Search Google Books for multiple matching volume candidates."""
    if not query or not query.strip():
        return []

    cache_key = f"{query.strip()}_{api_key or 'nokey'}"
    cached = tagger_cache.get_query("googlebooks", cache_key)
    if cached is not None:
        return cached

    print(f"[*] Querying Google Books API for: '{query}'")
    domain_limiter.wait_for_domain("googleapis.com")

    params = {
        "q": query,
        "maxResults": min(max(1, limit), 10),
        "printType": "books"
    }
    if api_key:
        params["key"] = api_key

    candidates = []
    try:
        resp = requests.get(GOOGLE_BOOKS_API_URL, params=params, headers=HEADERS, timeout=15)
        if resp.status_code != 200:
            print(f"[-] Google Books API returned status: {resp.status_code} ({resp.text[:100]})")
            return []

        data = resp.json()
        items = data.get("items", [])
        for item in items:
            vol_id = item.get("id")
            if vol_id:
                cached_vol = tagger_cache.get_entity("googlebooks_volume", vol_id)
                if cached_vol is not None:
                    candidates.append(cached_vol)
                    continue

            meta = _extract_volume_metadata(item)
            if meta:
                if vol_id:
                    tagger_cache.set_entity("googlebooks_volume", vol_id, meta)
                candidates.append(meta)

    except Exception as e:
        print(f"[-] Google Books search failed: {e}")

    tagger_cache.set_query("googlebooks", cache_key, candidates)
    return candidates


def resolve_googlebooks(filename, api_key=None, cover_path=None, on_progress=None, existing_meta=None):
    """Resolve metadata for a comic file via Google Books."""
    if on_progress:
        on_progress("Searching Google Books...")

    query = clean_search_query(filename)
    if not query:
        return []

    try:
        res = search_googlebooks_multi(query, api_key=api_key, limit=5)
    except Exception as e:
        print(f"[-] Google Books resolve failed: {e}")
        return []

    candidates = []
    for r in res:
        candidates.append(score_candidate(filename, r, cover_path=cover_path, default_source="Google Books"))

    return candidates
