import os
import sqlite3
from typing import Optional, Dict, Any, List, Tuple

from comics_mcp import reading_orders_cache
from comics_mcp import modal_scraper
from comics_mcp.curator import matcher as _matcher
from comics_mcp.curator import db as _db

DEFAULT_DB_PATH = _db.DEFAULT_DB_PATH

# Forward matcher utilities
validate_candidate_list = _matcher.validate_candidate_list
extract_issue_ranges = _matcher.extract_issue_ranges
_extract_issue_ranges = _matcher.extract_issue_ranges
comic_matches_step = _matcher.comic_matches_step
match_order_against_library = _matcher.match_order_against_library


def get_db_path() -> str:
    """Get path to comics-now.db from environment or default."""
    return _db.get_db_path()


def get_recent_comics(months: int = 3, reference_now_ms: Optional[int] = None) -> List[Dict[str, Any]]:
    """Query comics updated in the last X months using active db_path."""
    return _db.get_recent_comics(months=months, reference_now_ms=reference_now_ms, db_path=get_db_path())


def get_all_library_comics(unassigned_only: bool = False) -> List[Dict[str, Any]]:
    """Fetch all library comics using active db_path."""
    return _db.get_all_library_comics(unassigned_only=unassigned_only, db_path=get_db_path())


def commit_reading_list(name: str, description: str, comic_ids: List[str]) -> bool:
    """Create reading list in comics-now.db using active db_path."""
    return _db.commit_reading_list(name=name, description=description, comic_ids=comic_ids, db_path=get_db_path())


def curate_event_reading_order(event_name: str, apply_changes: bool = False) -> Dict[str, Any]:
    """
    Curate a reading list for a specific storyline/event (e.g. 'Knightfall', 'Civil War').
    """
    cached = reading_orders_cache.get_cached_order(event_name)
    if not cached:
        order = modal_scraper.fetch_reading_order(event_name)
        if order:
            reading_orders_cache.save_order(event_name, order)
            cached = order

    if not cached:
        return {
            "status": "error",
            "message": f"Could not find reading order for '{event_name}' on DCUI, CBRO, or Comic Book Herald."
        }

    library = get_all_library_comics(unassigned_only=False)
    result = match_order_against_library(cached, library)

    if apply_changes and result["is_valid"]:
        commit_reading_list(
            name=result["title"],
            description=result["description"],
            comic_ids=[c["comicId"] for c in result["matched_comics"]]
        )
        result["applied"] = True
    else:
        result["applied"] = False

    return result


def curate_recent_comics(months: int = 3, apply_changes: bool = False) -> Dict[str, Any]:
    """
    Analyze comics added in last X months:
    1. Check if they belong to existing reading lists.
    2. Check if they can form new reading lists.
    """
    recent = get_recent_comics(months=months)
    if not recent:
        return {
            "status": "empty",
            "message": f"No comics found added in the last {months} months."
        }

    db_path = get_db_path()
    existing_list_matches = []

    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        cur = conn.cursor()
        cur.execute("SELECT id, name, description FROM reading_lists;")
        existing_lists = cur.fetchall()
        
        cur.execute("SELECT listId, comicId FROM reading_list_items;")
        existing_items = set(cur.fetchall())

        seen_matches = set()
        for l_id, l_name, l_desc in existing_lists:
            for c in recent:
                key = (l_id, c.get("name", c["id"]))
                if key in seen_matches or (l_id, c["id"]) in existing_items:
                    continue

                c_series = c.get("series", "").lower().strip()
                l_name_lower = l_name.lower().strip()
                if c_series and (c_series in l_name_lower or l_name_lower in c_series):
                    seen_matches.add(key)
                    existing_list_matches.append({
                        "listId": l_id,
                        "listName": l_name,
                        "comicId": c["id"],
                        "comicName": c["name"],
                        "series": c["series"]
                    })
        conn.close()
    except Exception as e:
        print(f"Error checking existing lists: {e}")

    candidate_events = []
    seen_events = set()
    for c in recent:
        series = c.get("series", "")
        if series and series not in seen_events:
            seen_events.add(series)
            cached = reading_orders_cache.get_cached_order(series)
            if cached:
                res = match_order_against_library(cached, recent)
                if res["is_valid"]:
                    candidate_events.append(res)

    return {
        "status": "success",
        "recent_comics_count": len(recent),
        "existing_list_suggestions": existing_list_matches,
        "new_reading_list_proposals": candidate_events
    }
