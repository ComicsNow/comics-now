"""ComicVine metadata source.

Extracted from the legacy tagger.py monolith and optimized for high performance,
domain rate limiting, and multi-level caching.
"""
import re
import requests
from bs4 import BeautifulSoup

from tagger_app.core.metadata import score_candidate
from tagger_app.core.query import clean_search_query
from tagger_app.core.cache import tagger_cache
from tagger_app.core.limiter import domain_limiter

from tagger_app.sources.comicvine_parser import (
    cv_id_num as _cv_id_num,
    extract_volume_number as _extract_volume_number,
    parse_search_issue_match,
    parse_issue_detail,
    parse_volume_detail,
)


def _parse_search_issue_match(match, api_key=None):
    """Build a metadata dictionary directly from a ComicVine search issue result item."""
    return parse_search_issue_match(match)


def search_comicvine_multi(query, api_key, limit=20):
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


def search_comicvine_volumes(query, api_key, limit=20):
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
                    "genres": [],
                    "source_url": site_url or f"https://comicvine.gamespot.com/volume/4050-{match.get('id')}/",
                    "cover_image_url": cover_image_url
                }
                candidates.append(meta)
    except Exception as e:
        print(f"[-] ComicVine volume search failed: {e}")

    tagger_cache.set_query("comicvine_volumes", query, candidates)
    return candidates


def _issue_date_key(issue):
    """Sort key for arc issues — cover_date first, then store_date."""
    return issue.get("cover_date") or issue.get("store_date") or ""


def fetch_comicvine_arc_position(arc_id, issue_id, api_key):
    """Resolve the reading-order position of an issue within a ComicVine story arc.

    Queries the story_arc resource, sorts its issues by cover_date (true reading
    order), and returns {"name", "position" (1-based), "total"} — or None if the
    issue isn't part of the arc or the lookup fails.
    """
    if not api_key:
        return None
    arc_num = _cv_id_num(arc_id)
    headers = {"User-Agent": "ComicsNow/1.0 (https://github.com/comics-now)"}
    url = (f"https://comicvine.gamespot.com/api/story_arc/4045-{arc_num}/"
           f"?api_key={api_key}&format=json&field_list=id,name,issues")
    try:
        domain_limiter.wait_for_domain("comicvine.gamespot.com")
        resp = requests.get(url, headers=headers, timeout=15)
        if resp.status_code != 200:
            return None
        res = resp.json().get("results") or {}
        issues = res.get("issues") or []
        if not issues:
            return None

        issues_sorted = sorted(issues, key=_issue_date_key)
        target = _cv_id_num(issue_id)
        for idx, iss in enumerate(issues_sorted):
            if _cv_id_num(iss.get("id")) == target:
                return {"name": res.get("name") or "", "position": idx + 1, "total": len(issues_sorted)}
        return None
    except Exception as e:
        print(f"[-] ComicVine arc position lookup failed: {e}")
        return None


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
        api_url = f"{base_api_url}/issue/{entity_id}/?api_key={api_key}&format=json&field_list=name,description,issue_number,cover_date,store_date,volume,person_credits,character_credits,team_credits,location_credits,page_count,image,story_arc_credits,site_detail_url"
        print(f"[*] Querying ComicVine Issue API: {base_api_url}/issue/{entity_id}/?api_key=***&format=json")

        domain_limiter.wait_for_domain("comicvine.gamespot.com")
        response = requests.get(api_url, headers=headers, timeout=15)
        if response.status_code != 200:
            print(f"[-] ComicVine API returned error code: {response.status_code}")
            return None

        res_data = response.json()
        res_results = res_data.get("results", {})
        results = res_results[0] if isinstance(res_results, list) and res_results else (res_results if isinstance(res_results, dict) else {})
        if not results:
            print("[-] ComicVine API returned empty results.")
            return None

        volume_info = results.get("volume", {})
        vol_id = volume_info.get("id")
        publisher = tagger_cache.get_entity("comicvine_volume", vol_id) if vol_id else None

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

        metadata = parse_issue_detail(results, comicvine_url, publisher=publisher)
        tagger_cache.set_entity("comicvine_entity", entity_id, metadata)
        return metadata

    elif entity_type == "4050":
        api_url = f"{base_api_url}/volume/{entity_id}/?api_key={api_key}&format=json&field_list=name,description,publisher,start_year,image"
        print(f"[*] Querying ComicVine Volume API: {base_api_url}/volume/{entity_id}/?api_key=***&format=json")

        domain_limiter.wait_for_domain("comicvine.gamespot.com")
        response = requests.get(api_url, headers=headers, timeout=15)
        if response.status_code != 200:
            print(f"[-] ComicVine API returned error code: {response.status_code}")
            return None

        res_data = response.json()
        res_results = res_data.get("results", {})
        results = res_results[0] if isinstance(res_results, list) and res_results else (res_results if isinstance(res_results, dict) else {})
        if not results:
            print("[-] ComicVine API returned empty results.")
            return None

        metadata = parse_volume_detail(results, comicvine_url)
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
