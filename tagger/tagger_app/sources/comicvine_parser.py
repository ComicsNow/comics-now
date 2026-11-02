"""Parsing and schema normalization for ComicVine responses."""

import re
from bs4 import BeautifulSoup

from tagger_app.core.metadata import (
    clean_author_names,
    clean_description,
    normalize_publisher,
)
from tagger_app.core.cache import tagger_cache


def cv_id_num(raw):
    """Strip a ComicVine prefix (4000-/4045-) and return just the numeric id as a string."""
    m = re.search(r'(?:\d{4}-)?(\d+)', str(raw))
    return m.group(1) if m else str(raw)


def extract_volume_number(filename):
    """Recover a volume/issue number from a filename: 'Vol 3', 'v3', 'volume 3', '#3'."""
    m = re.search(r'\bv(?:ol(?:ume)?)?\.?\s*(\d+)\b', filename, flags=re.IGNORECASE)
    if not m:
        m = re.search(r'#\s*(\d+)\b', filename)
    return m.group(1) if m else None


def parse_search_issue_match(match):
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
        "genres": [],
        "source_url": site_url,
        "cover_image_url": cover_image_url,
        "volume_id": vol_id,
        "volume_api_url": volume_info.get("api_detail_url"),
        "id": match.get("id")
    }


def parse_issue_detail(results, comicvine_url, publisher=None):
    """Parses detailed ComicVine issue API results into normalized metadata."""
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
    web_url = results.get("site_detail_url") or comicvine_url

    norm_pub = normalize_publisher(publisher) if publisher else None

    metadata = {
        "title": title,
        "series": series_name,
        "number": str(results.get("issue_number")) if results.get("issue_number") is not None else "1",
        "authors": clean_author_names(authors),
        "publisher": norm_pub,
        "publish_date": results.get("cover_date") or results.get("store_date"),
        "description": results.get("description"),
        "genres": [],
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
        "web": web_url,
        "pages": str(results.get("page_count")) if results.get("page_count") else None
    }

    if metadata["description"]:
        desc_soup = BeautifulSoup(metadata["description"], 'html.parser')
        metadata["description"] = clean_description(desc_soup.get_text())
    else:
        metadata["description"] = ""

    return metadata


def parse_volume_detail(results, comicvine_url):
    """Parses detailed ComicVine volume API results into normalized metadata."""
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
        "genres": [],
        "source_url": comicvine_url,
        "cover_image_url": cover_image_url
    }

    if metadata["description"]:
        desc_soup = BeautifulSoup(metadata["description"], 'html.parser')
        metadata["description"] = clean_description(desc_soup.get_text())
    else:
        metadata["description"] = ""

    return metadata
