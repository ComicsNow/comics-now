"""Library comic loader and single issue ownership matcher."""
import os
import re
import json
import time
import threading
import sqlite3
from pathlib import Path
from typing import Optional, Dict, Any, Tuple, List

from tagger_app.continuity.util import (
    normalize_series,
    normalize_issue_num,
    extract_year,
    is_year_compatible,
    extract_issue_number,
    is_issue_in_range,
)
from tagger_app.continuity.three_gate_matcher import extract_volume_number

_CACHE_LOCK = threading.Lock()
_CACHE_DATA: Optional[Tuple[Dict[str, Dict[str, Any]], Dict[str, List[Dict[str, Any]]], Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]] = None
_CACHE_MTIME = 0.0
_CACHE_TIMESTAMP = 0.0
_CACHE_TTL = 30.0


def clear_library_cache() -> None:
    """Clear in-memory library cache (useful during tests or after batch tagging)."""
    global _CACHE_DATA, _CACHE_MTIME, _CACHE_TIMESTAMP
    with _CACHE_LOCK:
        _CACHE_DATA = None
        _CACHE_MTIME = 0.0
        _CACHE_TIMESTAMP = 0.0


def _load_library_comics(
    cn_db_path: Path | str,
) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, List[Dict[str, Any]]], Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    """Read library comics from comics-now.db and build lookup maps including read status."""
    direct_map: Dict[str, Dict[str, Any]] = {}
    series_map: Dict[str, List[Dict[str, Any]]] = {}
    by_id: Dict[str, Dict[str, Any]] = {}
    arc_tagged_map: Dict[str, Dict[str, Any]] = {}

    p = Path(cn_db_path)
    if not p.exists():
        return direct_map, series_map, by_id, arc_tagged_map

    global _CACHE_DATA, _CACHE_MTIME, _CACHE_TIMESTAMP
    try:
        current_mtime = p.stat().st_mtime
    except OSError:
        current_mtime = 0.0

    now = time.time()
    with _CACHE_LOCK:
        if _CACHE_DATA is not None and (now - _CACHE_TIMESTAMP) < _CACHE_TTL and current_mtime == _CACHE_MTIME:
            return _CACHE_DATA

    conn = sqlite3.connect(str(p), timeout=5.0)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.cursor()
        cursor.execute("PRAGMA busy_timeout = 5000")
        # Inspect schema to support both production comics-now.db and test mocks
        table_names = [r[0] for r in cursor.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        has_ucs = "user_comic_status" in table_names

        comic_cols = [r[1] for r in cursor.execute("PRAGMA table_info(comics)").fetchall()]
        has_total_pages = "totalPages" in comic_cols
        has_page_count = "pageCount" in comic_cols
        has_last_read = "lastReadPage" in comic_cols

        pages_col = "c.totalPages" if has_total_pages else ("c.pageCount" if has_page_count else "0")
        read_col = "c.lastReadPage" if has_last_read else "0"

        if has_ucs:
            query = f"""
                SELECT 
                    c.id, c.name, c.series, c.publisher, c.metadata,
                    COALESCE(ucs.totalPages, {pages_col}, 0) as pageCount,
                    COALESCE(ucs.lastReadPage, {read_col}, 0) as lastReadPage
                FROM comics c
                LEFT JOIN user_comic_status ucs ON c.id = ucs.comicId
            """
        else:
            query = f"""
                SELECT 
                    c.id, c.name, c.series, c.publisher, c.metadata,
                    {pages_col} as pageCount,
                    {read_col} as lastReadPage
                FROM comics c
            """
        cursor.execute(query)
        for row in cursor.fetchall():
            c = dict(row)
            by_id[c["id"]] = c
            meta = {}
            if c.get("metadata"):
                try:
                    meta = json.loads(c["metadata"]) if isinstance(c["metadata"], str) else c["metadata"]
                except Exception:
                    pass

            series = c.get("series") or meta.get("Series") or ""
            num = extract_issue_number(c.get("name") or "", meta.get("Number"))
            year = extract_year(meta.get("Year") or c.get("name") or "")

            norm_s = normalize_series(series)
            norm_n = normalize_issue_num(num)

            p_cnt = int(c.get("pageCount") or 0)
            lr_page = int(c.get("lastReadPage") or 0)
            if lr_page >= p_cnt and p_cnt > 0:
                read_status = "read"
            elif lr_page > 0:
                read_status = "reading"
            else:
                read_status = "unread"

            meta_title = str(meta.get("Title") or "")
            c_vol = (
                extract_volume_number(meta.get("Volume"))
                or extract_volume_number(meta.get("Number"))
                or extract_volume_number(meta_title)
                or extract_volume_number(c.get("name") or "")
                or extract_volume_number(series)
            )

            c_info = {
                **c,
                "issueNum": num,
                "year": year,
                "normSeries": norm_s,
                "normNum": norm_n,
                "volume": c_vol,
                "metaTitle": meta_title,
                "pageCount": p_cnt,
                "lastReadPage": lr_page,
                "readStatus": read_status,
            }
            key = f"{norm_s}:::{norm_n}"
            if key not in direct_map:
                direct_map[key] = c_info
            if norm_s not in series_map:
                series_map[norm_s] = []
            series_map[norm_s].append(c_info)

            # Map tagged StoryArc and StoryArcNumber
            arc = meta.get("StoryArc")
            arc_num = meta.get("StoryArcNumber")
            if arc and arc_num:
                clean_arc = re.sub(r"\s+Reading\s+Order.*$", "", str(arc), flags=re.IGNORECASE).strip()
                norm_arc = normalize_series(clean_arc)
                arc_tagged_map[f"{norm_arc}:::{arc_num}"] = c_info

        result = (direct_map, series_map, by_id, arc_tagged_map)
        with _CACHE_LOCK:
            _CACHE_DATA = result
            _CACHE_MTIME = current_mtime
            _CACHE_TIMESTAMP = now
        return result
    finally:
        conn.close()


def find_owned_comic(
    issue: Dict[str, Any],
    direct_map: Dict[str, Any],
    series_map: Dict[str, Any],
    ro_era_window: Optional[Any] = None,
) -> Optional[Dict[str, Any]]:
    """Match an issue record against local library comics with strict series, era, and year validation."""
    s_name = issue.get("series_name") or issue.get("seriesName") or ""
    i_num = issue.get("issue_number") or issue.get("issueNumber") or ""
    pub_date = issue.get("publication_date") or issue.get("publicationDate") or ""
    norm_s = normalize_series(s_name)
    norm_n = normalize_issue_num(i_num)

    # 1. Direct match with year validation
    direct_key = f"{norm_s}:::{norm_n}"
    if direct_key in direct_map:
        cand = direct_map[direct_key]
        if is_year_compatible(cand.get("year"), pub_date, ro_era_window=ro_era_window):
            return cand

    # 2. Candidate match with range and year validation
    if norm_s in series_map:
        for c in series_map[norm_s]:
            if is_issue_in_range(c.get("issueNum"), i_num):
                if is_year_compatible(c.get("year"), pub_date, ro_era_window=ro_era_window):
                    return c
    return None
