"""Metron metadata source.

Extracted from the legacy tagger.py monolith and optimized for high performance,
domain rate limiting, and multi-level caching.
"""

import re

from tagger_app.core.metadata import score_candidate
from tagger_app.core.query import clean_search_query
from tagger_app.core.cache import tagger_cache
from tagger_app.core.limiter import domain_limiter


def split_series_number(query):
    """Split 'Series #N' into ('Series', 'N'). Only an explicit '#' marks the issue
    number — a trailing bare number stays part of the series name (e.g. '2000 AD').
    Returns (series, number_or_None)."""
    if not query:
        return (query, None)
    m = re.search(r'^(.*?)\s*#\s*([\d.]+)\s*$', query)
    if m:
        return (m.group(1).strip(), m.group(2))
    return (query.strip(), None)


def search_metron_multi(query, user, pwd, year=None):
    if not user or not pwd:
        return []

    cache_key = f"{query}|{year}" if year else query
    cached = tagger_cache.get_query("metron", cache_key)
    if cached is not None:
        return cached

    try:
        import mokkari
        domain_limiter.wait_for_domain("metron.cloud")
        m = mokkari.api(user, pwd)
        series_name, number = split_series_number(query)
        params = {"series_name": series_name}
        if number:
            params["number"] = number
        if year:
            params["cover_year"] = str(year)
        res = list(m.issues_list(params=params))
        out = []
        for item in res[:5]:
            cached_full = tagger_cache.get_entity("metron_issue", item.id)
            if cached_full is not None:
                out.append(cached_full)
                continue

            domain_limiter.wait_for_domain("metron.cloud")
            full = m.issue(item.id)
            writers, pencillers, inkers, colorists, letterers, cover_artists, editors = [], [], [], [], [], [], []
            for cr in getattr(full, 'credits', []) or []:
                role_val = getattr(cr, 'role', None)
                role_name = str(getattr(role_val, 'name', role_val or '')).lower()
                creator_val = getattr(cr, 'creator', None)
                creator_name = str(getattr(creator_val, 'name', creator_val or '')).strip()
                if not creator_name:
                    continue
                if 'writer' in role_name or 'script' in role_name:
                    if creator_name not in writers: writers.append(creator_name)
                elif 'pencill' in role_name or 'artist' in role_name:
                    if creator_name not in pencillers: pencillers.append(creator_name)
                elif 'ink' in role_name:
                    if creator_name not in inkers: inkers.append(creator_name)
                elif 'color' in role_name:
                    if creator_name not in colorists: colorists.append(creator_name)
                elif 'letter' in role_name:
                    if creator_name not in letterers: letterers.append(creator_name)
                elif 'cover' in role_name:
                    if creator_name not in cover_artists: cover_artists.append(creator_name)
                elif 'editor' in role_name:
                    if creator_name not in editors: editors.append(creator_name)

            char_list = [getattr(c, 'name', str(c)) for c in (getattr(full, 'characters', None) or [])]
            team_list = [getattr(t, 'name', str(t)) for t in (getattr(full, 'teams', None) or [])]
            loc_list  = [getattr(l, 'name', str(l)) for l in (getattr(full, 'locations', None) or [])]
            arc_objects = getattr(full, 'arcs', None) or []
            arc_names = [getattr(a, 'name', str(a)) for a in arc_objects if getattr(a, 'name', None)]
            arc_number = str(getattr(arc_objects[0], 'number', '')) if arc_objects else None
            series_obj = getattr(full, 'series', None)
            genre_list = [getattr(g, 'name', str(g)) for g in (getattr(series_obj, 'genres', None) or [])]
            age_rating = getattr(getattr(full, 'rating', None), 'name', None)
            page_count = getattr(full, 'page_count', None)

            item_meta = {
                "title": f"{full.series.name if full.series else ''} #{full.number}",
                "series": full.series.name if full.series else '',
                "number": str(full.number),
                "publisher": full.publisher.name if full.publisher else None,
                "publish_date": full.store_date or full.cover_date,
                "cover_image_url": str(full.image) if full.image else None,
                "source_url": f"https://metron.cloud/issue/{full.id}/",
                "description": full.desc,
                "writer": ", ".join(writers) if writers else None,
                "penciller": ", ".join(pencillers) if pencillers else None,
                "inker": ", ".join(inkers) if inkers else None,
                "colorist": ", ".join(colorists) if colorists else None,
                "letterer": ", ".join(letterers) if letterers else None,
                "cover_artist": ", ".join(cover_artists) if cover_artists else None,
                "editor": ", ".join(editors) if editors else None,
                "characters": ", ".join(char_list) if char_list else None,
                "teams": ", ".join(team_list) if team_list else None,
                "locations": ", ".join(loc_list) if loc_list else None,
                "story_arc": ", ".join(arc_names) if arc_names else None,
                "story_arc_number": arc_number if arc_number else None,
                "genres": genre_list if genre_list else ["Comics"],
                "age_rating": age_rating,
                "pages": str(page_count) if page_count else None
            }
            tagger_cache.set_entity("metron_issue", item.id, item_meta)
            out.append(item_meta)

        tagger_cache.set_query("metron", cache_key, out)
        return out
    except Exception as e:
        print(f"[-] Metron search multi failed: {e}")
        return []


def resolve_metron(filename, metron_user=None, metron_pass=None, cover_path=None, on_progress=None, existing_meta=None):
    if not metron_user or not metron_pass:
        if on_progress:
            on_progress("Metron credentials not set. Skipping.")
        return []
    if on_progress:
        on_progress("Searching Metron...")
    query = clean_search_query(filename)

    res = search_metron_multi(query, metron_user, metron_pass)
    candidates = []
    for r in res:
        candidates.append(score_candidate(filename, r, cover_path=cover_path, default_source="Metron"))
    return candidates
