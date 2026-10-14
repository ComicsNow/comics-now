import os
import re
import time
import json
import sqlite3
import pathlib
from typing import Optional, Dict, Any, List, Tuple

from comics_mcp import reading_orders_cache
from comics_mcp import modal_scraper

DEFAULT_DB_PATH = "/opt/comics-now/comics-now.db"


def get_db_path() -> str:
    """Get path to comics-now.db from environment or default."""
    return os.environ.get("COMICS_DB_PATH", DEFAULT_DB_PATH)


def validate_candidate_list(title: str, matched_comics: List[Dict[str, Any]]) -> Tuple[bool, str]:
    """
    Enforce universal reading list constraints:
    1. At least 3 comics in user's library.
    2. Must span at least 2 distinct series (reject single-series runs).
    3. Cross-publisher is allowed.
    """
    if len(matched_comics) < 3:
        return False, f"Reading list '{title}' requires at least 3 comics in your library (found {len(matched_comics)})."

    distinct_series = set(c.get("series", "").strip() for c in matched_comics if c.get("series"))
    if len(distinct_series) <= 1:
        single_series = next(iter(distinct_series)) if distinct_series else "Unknown"
        return False, f"Reading list '{title}' cannot consist of a single series ('{single_series}'). Single-series runs belong in the Series view."

    return True, "Valid reading list."


def _extract_issue_ranges(text: str) -> List[Tuple[str, int, int]]:
    """
    Extract series name and issue range from omnibus/TPB titles.
    Examples:
      'Batman 491-497' -> ('Batman', 491, 497)
      'Detective Comics #659-663' -> ('Detective Comics', 659, 663)
    """
    ranges = []
    # Pattern: [Series Name] [optional #] [start] - [end]
    matches = re.findall(r'([A-Za-z\s:\'\.]+?)\s+#?(\d+)\s*[-–—]\s*#?(\d+)', text)
    for s_name, start_s, end_s in matches:
        clean_s = s_name.strip()
        if clean_s:
            try:
                ranges.append((clean_s.lower(), int(start_s), int(end_s)))
            except ValueError:
                pass
    return ranges


def comic_matches_step(comic: Dict[str, Any], series: str, issue: str) -> bool:
    """
    Determine if a library comic matches a reading order step.
    Handles:
    - Direct single issue match.
    - Omnibus/TPB covering an issue range (Constraint 4).
    """
    comic_name = comic.get("name", "")
    comic_series = comic.get("series", "")
    target_series = series.lower().strip()
    target_iss_str = str(issue).strip()

    # 1. Check Omnibus / TPB Issue Ranges
    all_text = f"{comic_series} {comic_name}"
    ranges = _extract_issue_ranges(all_text)
    if target_iss_str.isdigit():
        target_num = int(target_iss_str)
        for r_series, start_num, end_num in ranges:
            if (r_series in target_series or target_series in r_series or not r_series) and (start_num <= target_num <= end_num):
                return True

    # 2. Check Direct Series Matching
    c_series_lower = comic_series.lower().strip()
    series_match = (
        target_series == c_series_lower or
        target_series in c_series_lower or
        c_series_lower in target_series
    )

    if not series_match:
        # Check name for series prefix
        if not target_series in comic_name.lower():
            return False

    # 3. Match Issue Number
    # Look for '#X' or 'Issue X' or ' 01 ' in name
    if target_iss_str:
        num_patterns = [
            rf'#{target_iss_str}\b',
            rf'#{target_iss_str.zfill(2)}\b',
            rf'#{target_iss_str.zfill(3)}\b',
            rf'\b0*{target_iss_str}\b'
        ]
        for pat in num_patterns:
            if re.search(pat, comic_name):
                return True

    return False


def get_recent_comics(months: int = 3, reference_now_ms: Optional[int] = None) -> List[Dict[str, Any]]:
    """Query comics updated in the last X months from SQLite."""
    now_ms = reference_now_ms if reference_now_ms is not None else int(time.time() * 1000)
    cutoff_ms = now_ms - (months * 30 * 86400 * 1000)

    db_path = get_db_path()
    if not os.path.exists(db_path):
        return []

    uri = f"file:{db_path}?mode=ro"
    comics = []
    try:
        conn = sqlite3.connect(uri, uri=True, timeout=5.0)
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(comics);")
        cols = [c[1] for c in cursor.fetchall()]
        has_meta = "metadata" in cols
        meta_col = "metadata" if has_meta else "''"
        cursor.execute(f"""
            SELECT id, publisher, series, name, updatedAt, {meta_col}
            FROM comics
            WHERE updatedAt >= ?
            ORDER BY updatedAt DESC;
        """, (cutoff_ms,))
        for row in cursor.fetchall():
            comics.append({
                "id": row[0],
                "publisher": row[1] or "",
                "series": row[2] or "",
                "name": row[3] or "",
                "updatedAt": row[4],
                "metadata": row[5] or ""
            })
        conn.close()
    except Exception as e:
        print(f"Error fetching recent comics: {e}")

    return comics


def get_all_library_comics(unassigned_only: bool = False) -> List[Dict[str, Any]]:
    """Fetch all library comics, optionally filtering to those not in any reading list."""
    db_path = get_db_path()
    if not os.path.exists(db_path):
        return []

    uri = f"file:{db_path}?mode=ro"
    comics = []
    try:
        conn = sqlite3.connect(uri, uri=True, timeout=5.0)
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(comics);")
        cols = [c[1] for c in cursor.fetchall()]
        has_meta = "metadata" in cols
        meta_col = "metadata" if has_meta else "''"
        if unassigned_only:
            cursor.execute(f"""
                SELECT id, publisher, series, name, updatedAt, {meta_col}
                FROM comics
                WHERE id NOT IN (SELECT comicId FROM reading_list_items)
                ORDER BY publisher, series, name;
            """)
        else:
            cursor.execute(f"""
                SELECT id, publisher, series, name, updatedAt, {meta_col}
                FROM comics
                ORDER BY publisher, series, name;
            """)
        for row in cursor.fetchall():
            comics.append({
                "id": row[0],
                "publisher": row[1] or "",
                "series": row[2] or "",
                "name": row[3] or "",
                "updatedAt": row[4],
                "metadata": row[5] or ""
            })
        conn.close()
    except Exception as e:
        print(f"Error fetching library comics: {e}")

    return comics


def match_order_against_library(order: Dict[str, Any], library_comics: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Match canonical reading order steps against a set of library comics.
    Returns matched comics in chronological sequence, missing steps, and validation status.
    """
    matched_comics = []
    matched_ids = set()
    missing_steps = []

    for step in order.get("items", []):
        s_series = step.get("series", "")
        s_issue = step.get("issue", "")
        raw_t = step.get("raw_title", f"{s_series} #{s_issue}")

        matched_comic = None
        for c in library_comics:
            if comic_matches_step(c, s_series, s_issue):
                matched_comic = c
                break

        if matched_comic:
            if matched_comic["id"] not in matched_ids:
                matched_ids.add(matched_comic["id"])
                matched_comics.append({
                    "step": step.get("step", len(matched_comics) + 1),
                    "comicId": matched_comic["id"],
                    "name": matched_comic["name"],
                    "series": matched_comic["series"],
                    "publisher": matched_comic["publisher"],
                    "canonical_target": raw_t
                })
        else:
            missing_steps.append({
                "step": step.get("step", 0),
                "title": raw_t
            })

    is_valid, reason = validate_candidate_list(order.get("title", "Reading List"), matched_comics)

    return {
        "title": order.get("title", ""),
        "source": order.get("source", ""),
        "description": order.get("description", ""),
        "is_valid": is_valid,
        "validation_reason": reason,
        "matched_count": len(matched_comics),
        "total_steps": len(order.get("items", [])),
        "matched_comics": matched_comics,
        "missing_steps": missing_steps
    }


def curate_event_reading_order(event_name: str, apply_changes: bool = False) -> Dict[str, Any]:
    """
    Curate a reading list for a specific storyline/event (e.g. 'Knightfall', 'Civil War').
    """
    # 1. Check local cache
    cached = reading_orders_cache.get_cached_order(event_name)
    if not cached:
        # Fetch from Modal / scraper
        order = modal_scraper.fetch_reading_order(event_name)
        if order:
            reading_orders_cache.save_order(event_name, order)
            cached = order

    if not cached:
        return {
            "status": "error",
            "message": f"Could not find reading order for '{event_name}' on DCUI, CBRO, or Comic Book Herald."
        }

    # 2. Match against full library
    library = get_all_library_comics(unassigned_only=False)
    result = match_order_against_library(cached, library)

    # 3. Apply changes if requested and valid
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

    # 1. Check against existing reading lists in DB
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        cur = conn.cursor()
        cur.execute("SELECT id, name, description FROM reading_lists;")
        existing_lists = cur.fetchall()
        
        # Pre-fetch existing list items
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

    # 2. Try candidate events for recent series
    candidate_events = []
    seen_events = set()
    for c in recent:
        series = c.get("series", "")
        if series and series not in seen_events:
            seen_events.add(series)
            # Check if this series has a known reading order
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


def commit_reading_list(name: str, description: str, comic_ids: List[str]) -> bool:
    """Create reading list in comics-now.db and sync across all users."""
    try:
        import httpx
        base_url = os.environ.get("COMICS_BASE_URL", "http://localhost:3000")
        headers = json.loads(os.environ.get("COMICS_EXTRA_HEADERS", "{}"))
        
        # 1. POST /api/v1/reading-lists
        body = {"name": name, "description": description, "comicIds": comic_ids}
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(f"{base_url}/api/v1/reading-lists", json=body, headers=headers)
            if resp.status_code in (200, 201):
                # 2. Trigger sync across all users
                client.post(
                    f"{base_url}/api/v1/admin/reading-lists/sync-to-all",
                    json={"overwrite": True, "prune": False},
                    headers=headers
                )
                return True
    except Exception as e:
        print(f"Error committing reading list via API: {e}")

    # Fallback to direct SQLite insertion if API unreachable
    try:
        import uuid
        db_path = get_db_path()
        conn = sqlite3.connect(db_path, timeout=5.0)
        cur = conn.cursor()
        list_id = str(uuid.uuid4()).replace("-", "")[:32]
        now_ms = int(time.time() * 1000)
        cur.execute("""
            INSERT INTO reading_lists (id, userId, name, description, created, updated)
            VALUES (?, 'default-user', ?, ?, ?, ?);
        """, (list_id, name, description, now_ms, now_ms))

        for idx, cid in enumerate(comic_ids):
            cur.execute("""
                INSERT OR IGNORE INTO reading_list_items (listId, comicId, sortOrder, addedAt)
                VALUES (?, ?, ?, ?);
            """, (list_id, cid, idx + 1, now_ms))

        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"Direct DB commit failed: {e}")
        return False
