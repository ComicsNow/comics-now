"""ComicVine metadata source.

Extracted from the legacy tagger.py monolith and optimized for high performance,
domain rate limiting, and multi-level caching.
"""
import re
import requests
from bs4 import BeautifulSoup

from tagger_app.core.metadata import (
    clean_author_names,
    clean_description,
    normalize_publisher,
    score_candidate,
)
from tagger_app.core.query import clean_search_query
from tagger_app.core.cache import tagger_cache
from tagger_app.core.limiter import domain_limiter


def _parse_search_issue_match(match, api_key=None):
    """Build a metadata dictionary directly from a ComicVine search issue result item."""
    if not match:
        return None

    volume_info = match.get("volume") or {}
    series_name = volume_info.get("name", "")
    issue_name = match.get("name") or ""
    issue_num = str(match.get("issue_number")) if match.get("issue_number") is not None else ""

    title = series_name
    if issue_num:
        title += f" #{issue_num}"
    if issue_name:
        title += f" - {issue_name}"

    image_info = match.get("image") or {}
    cover_image_url = image_info.get("medium_url") or image_info.get("super_url") or image_info.get("thumb_url")

    desc = match.get("description") or ""
    if desc:
        try:
            desc = BeautifulSoup(desc, "html.parser").get_text()
        except Exception:
            pass
    desc = clean_description(desc)

    vol_id = volume_info.get("id")
    publisher = None
    if vol_id:
        publisher = tagger_cache.get_entity("comicvine_volume", vol_id)
    if publisher:
        publisher = normalize_publisher(publisher)

    site_url = match.get("site_detail_url") or f"https://comicvine.gamespot.com/issue/4000-{match.get('id')}/"

    return {
        "title": title,
        "series": series_name,
        "number": issue_num,
        "issue_number": issue_num,
        "authors": [],
        "publisher": publisher,
        "publish_date": match.get("cover_date") or match.get("store_date"),
        "description": desc,
        "genres": ["Comics"],
        "source_url": site_url,
        "cover_image_url": cover_image_url,
        "volume_id": vol_id,
        "volume_api_url": volume_info.get("api_detail_url"),
        "id": match.get("id")
    }


def search_comicvine_multi(query, api_key, limit=5):
    """
    Searches ComicVine for issues matching the search query,
    returns a list of formatted metadata dictionaries using caching.
    """
    if not api_key:
        return []

    cached = tagger_cache.get_query("comicvine_issues", query)
    if cached is not None:
        return cached

    print(f"[*] Querying ComicVine search API (Multi) with query: '{query}'")
    headers = {
        "User-Agent": "ComicsNow/1.0 (https://github.com/comics-now)"
    }
    url = "https://comicvine.gamespot.com/api/search/"
    params = {
        "api_key": api_key,
        "format": "json",
        "resources": "issue",
        "query": query,
        "limit": limit
    }
    candidates = []
    try:
        domain_limiter.wait_for_domain("comicvine.gamespot.com")
        response = requests.get(url, params=params, headers=headers, timeout=15)
        if response.status_code == 200:
            data = response.json()
            results = data.get("results", [])
            for match in results[:limit]:
                site_url = match.get("site_detail_url")
                if site_url:
                    meta = fetch_comicvine_metadata(site_url, api_key)
                    if meta:
                        candidates.append(meta)
                        continue
                meta = _parse_search_issue_match(match, api_key)
                if meta:
                    candidates.append(meta)
    except Exception as e:
        print(f"[-] ComicVine multi search failed: {e}")

    tagger_cache.set_query("comicvine_issues", query, candidates)
    return candidates


def search_comicvine_volumes(query, api_key, limit=5):
    """
    Searches ComicVine for *volumes* (series / collected editions) matching the query.
    """
    if not api_key:
        return []

    cached = tagger_cache.get_query("comicvine_volumes", query)
    if cached is not None:
        return cached

    print(f"[*] Querying ComicVine search API (Volumes) with query: '{query}'")
    headers = {
        "User-Agent": "ComicsNow/1.0 (https://github.com/comics-now)"
    }
    url = "https://comicvine.gamespot.com/api/search/"
    params = {
        "api_key": api_key,
        "format": "json",
        "resources": "volume",
        "query": query,
        "limit": limit
    }
    candidates = []
    try:
        domain_limiter.wait_for_domain("comicvine.gamespot.com")
        response = requests.get(url, params=params, headers=headers, timeout=15)
        if response.status_code == 200:
            data = response.json()
            results = data.get("results", [])
            for match in results[:limit]:
                site_url = match.get("site_detail_url")
                if site_url:
                    meta = fetch_comicvine_metadata(site_url, api_key)
                    if meta:
                        candidates.append(meta)
                        continue

                pub_info = match.get("publisher") or {}
                pub_name = pub_info.get("name") if isinstance(pub_info, dict) else None

                vol_id = match.get("id")
                if vol_id and pub_name:
                    tagger_cache.set_entity("comicvine_volume", vol_id, pub_name)

                image_info = match.get("image") or {}
                cover_image_url = image_info.get("medium_url") or image_info.get("super_url") or image_info.get("thumb_url")

                desc = match.get("description") or ""
                if desc:
                    try:
                        desc = BeautifulSoup(desc, "html.parser").get_text()
                    except Exception:
                        pass

                meta = {
                    "title": match.get("name"),
                    "series": match.get("name"),
                    "authors": [],
                    "publisher": pub_name,
                    "publish_date": match.get("start_year"),
                    "description": desc,
                    "genres": ["Comics"],
                    "source_url": site_url or f"https://comicvine.gamespot.com/volume/4050-{match.get('id')}/",
                    "cover_image_url": cover_image_url
                }
                candidates.append(meta)
    except Exception as e:
        print(f"[-] ComicVine volume search failed: {e}")

    tagger_cache.set_query("comicvine_volumes", query, candidates)
    return candidates


def _extract_volume_number(filename):
    """Recover a volume/issue number from a filename: 'Vol 3', 'v3', 'volume 3', '#3'."""
    m = re.search(r'\bv(?:ol(?:ume)?)?\.?\s*(\d+)\b', filename, flags=re.IGNORECASE)
    if not m:
        m = re.search(r'#\s*(\d+)\b', filename)
    return m.group(1) if m else None


def fetch_comicvine_metadata(comicvine_url, api_key):
    """
    Parses the ComicVine URL to find the entity ID (4000-xxxx or 4050-xxxx),
    queries the official ComicVine API, and returns mapped metadata (with caching).
    """
    print(f"[*] Extracting entity ID from ComicVine URL: {comicvine_url}")
    match = re.search(r'/(4000-\d+|4050-\d+)/?', comicvine_url)
    if not match:
        print("[-] Could not extract a valid 4000-xxxx or 4050-xxxx entity ID from URL.")
        return None

    entity_id = match.group(1)
    entity_type = entity_id.split("-")[0]  # '4000' or '4050'

    # Check entity cache
    cached_meta = tagger_cache.get_entity("comicvine_entity", entity_id)
    if cached_meta is not None:
        return cached_meta

    headers = {
        "User-Agent": "ComicsNow/1.0 (https://github.com/comics-now)"
    }
    base_api_url = "https://comicvine.gamespot.com/api"

    if entity_type == "4000":
        # Issue endpoint - retrieve comprehensive fields
        api_url = f"{base_api_url}/issue/{entity_id}/?api_key={api_key}&format=json&field_list=name,description,issue_number,cover_date,store_date,volume,person_credits,character_credits,team_credits,location_credits,page_count,image"
        print(f"[*] Querying ComicVine Issue API: {base_api_url}/issue/{entity_id}/?api_key=***&format=json")

        domain_limiter.wait_for_domain("comicvine.gamespot.com")
        response = requests.get(api_url, headers=headers, timeout=15)
        if response.status_code != 200:
            print(f"[-] ComicVine API returned error code: {response.status_code}")
            return None

        res_data = response.json()
        res_results = res_data.get("results", {})
        if isinstance(res_results, list):
            results = res_results[0] if res_results else {}
        else:
            results = res_results if isinstance(res_results, dict) else {}

        if not results:
            print("[-] ComicVine API returned empty results.")
            return None

        # Parse creators / crew
        authors = []
        writers = []
        pencillers = []
        inkers = []
        colorists = []
        letterers = []
        cover_artists = []
        editors = []
        for credit in results.get("person_credits", []):
            role = credit.get("role", "").lower()
            name = credit.get("name")
            if not name:
                continue
            if "writer" in role or "artist" in role or "penciller" in role:
                authors.append(name)

            if "writer" in role:
                writers.append(name)
            if "penciller" in role or "penciler" in role or "artist" in role:
                pencillers.append(name)
            if "inker" in role:
                inkers.append(name)
            if "colorist" in role:
                colorists.append(name)
            if "letterer" in role:
                letterers.append(name)
            if "cover" in role:
                cover_artists.append(name)
            if "editor" in role:
                editors.append(name)

        if not authors:
            authors = [c.get("name") for c in results.get("person_credits", [])[:3]]

        volume_info = results.get("volume", {})
        series_name = volume_info.get("name", "")
        issue_name = results.get("name", "")

        title = series_name
        if results.get("issue_number"):
            title += f" #{results.get('issue_number')}"
        if issue_name:
            title += f" - {issue_name}"

        image_info = results.get("image", {})
        cover_image_url = image_info.get("medium_url") or image_info.get("super_url") or image_info.get("thumb_url")

        char_list = [c.get("name") for c in results.get("character_credits", []) if c.get("name")]
        team_list = [t.get("name") for t in results.get("team_credits", []) if t.get("name")]
        loc_list = [l.get("name") for l in results.get("location_credits", []) if l.get("name")]

        # Check publisher cache by volume ID
        vol_id = volume_info.get("id")
        publisher = None
        if vol_id:
            publisher = tagger_cache.get_entity("comicvine_volume", vol_id)

        # Fetch volume details if publisher not cached
        if not publisher:
            volume_api_url = volume_info.get("api_detail_url")
            if volume_api_url:
                print(f"[*] Querying ComicVine Volume API to get publisher: {volume_api_url}")
                vol_url_full = f"{volume_api_url}?api_key={api_key}&format=json&field_list=publisher"
                domain_limiter.wait_for_domain("comicvine.gamespot.com")
                vol_response = requests.get(vol_url_full, headers=headers, timeout=15)
                if vol_response.status_code == 200:
                    vol_data = vol_response.json()
                    v_res = vol_data.get("results", {})
                    v_dict = v_res[0] if isinstance(v_res, list) and v_res else (v_res if isinstance(v_res, dict) else {})
                    publisher_info = v_dict.get("publisher", {})
                    if publisher_info:
                        publisher = publisher_info.get("name")
                        if vol_id and publisher:
                            tagger_cache.set_entity("comicvine_volume", vol_id, publisher)
                        print(f"[+] Found publisher: {publisher}")

        if publisher:
            publisher = normalize_publisher(publisher)

        metadata = {
            "title": title,
            "series": series_name,
            "number": str(results.get("issue_number")) if results.get("issue_number") is not None else "1",
            "authors": clean_author_names(authors),
            "publisher": publisher,
            "publish_date": results.get("cover_date") or results.get("store_date"),
            "description": results.get("description"),
            "genres": ["Comics"],
            "source_url": comicvine_url,
            "cover_image_url": cover_image_url,
            "writer": ", ".join(writers) if writers else ", ".join(authors),
            "penciller": ", ".join(pencillers),
            "inker": ", ".join(inkers),
            "colorist": ", ".join(colorists),
            "letterer": ", ".join(letterers),
            "cover_artist": ", ".join(cover_artists),
            "editor": ", ".join(editors),
            "characters": ", ".join(char_list),
            "teams": ", ".join(team_list),
            "locations": ", ".join(loc_list),
            "pages": str(results.get("page_count")) if results.get("page_count") else None
        }

        if metadata["description"]:
            desc_soup = BeautifulSoup(metadata["description"], 'html.parser')
            metadata["description"] = clean_description(desc_soup.get_text())
        else:
            metadata["description"] = ""

        tagger_cache.set_entity("comicvine_entity", entity_id, metadata)
        return metadata

    elif entity_type == "4050":
        # Volume/Series endpoint
        api_url = f"{base_api_url}/volume/{entity_id}/?api_key={api_key}&format=json&field_list=name,description,publisher,start_year,image"
        print(f"[*] Querying ComicVine Volume API: {base_api_url}/volume/{entity_id}/?api_key=***&format=json")

        domain_limiter.wait_for_domain("comicvine.gamespot.com")
        response = requests.get(api_url, headers=headers, timeout=15)
        if response.status_code != 200:
            print(f"[-] ComicVine API returned error code: {response.status_code}")
            return None

        res_data = response.json()
        res_results = res_data.get("results", {})
        if isinstance(res_results, list):
            results = res_results[0] if res_results else {}
        else:
            results = res_results if isinstance(res_results, dict) else {}

        if not results:
            print("[-] ComicVine API returned empty results.")
            return None

        publisher_info = results.get("publisher", {})
        pub_name = publisher_info.get("name") if isinstance(publisher_info, dict) else None
        vol_raw_id = results.get("id")
        if vol_raw_id and pub_name:
            tagger_cache.set_entity("comicvine_volume", vol_raw_id, pub_name)
        if pub_name:
            pub_name = normalize_publisher(pub_name)

        image_info = results.get("image", {})
        cover_image_url = image_info.get("medium_url") or image_info.get("super_url") or image_info.get("thumb_url")

        metadata = {
            "title": results.get("name"),
            "series": results.get("name"),
            "authors": [],
            "publisher": pub_name,
            "publish_date": results.get("start_year"),
            "description": results.get("description"),
            "genres": ["Comics"],
            "source_url": comicvine_url,
            "cover_image_url": cover_image_url
        }

        if metadata["description"]:
            desc_soup = BeautifulSoup(metadata["description"], 'html.parser')
            metadata["description"] = clean_description(desc_soup.get_text())
        else:
            metadata["description"] = ""

        tagger_cache.set_entity("comicvine_entity", entity_id, metadata)
        return metadata

    return None


def resolve_comicvine(filename, api_key, cover_path=None, on_progress=None, existing_meta=None):
    if on_progress:
        on_progress("Searching ComicVine...")
    query = clean_search_query(filename)

    issue_res = search_comicvine_multi(query, api_key, limit=5)
    volume_res = search_comicvine_volumes(query, api_key, limit=5)

    vol_number = _extract_volume_number(filename)

    def _score_and_add(candidates, results, is_volume):
        for r in results:
            if is_volume and vol_number:
                r["number"] = vol_number
                r["issue_number"] = vol_number
            candidates.append(score_candidate(filename, r, cover_path=cover_path, default_source="ComicVine"))

    candidates = []
    _score_and_add(candidates, issue_res, is_volume=False)
    _score_and_add(candidates, volume_res, is_volume=True)
    return candidates
