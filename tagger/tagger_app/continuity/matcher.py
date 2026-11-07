"""Continuity Matching Engine for Tag Comics Now!.

Matches reading order sequences against user comics in library.
Computes narrative completeness, missing issue gaps, ComicInfo metadata,
and in-reader continuity prompts.
"""
import re
import json
import sqlite3
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple

from tagger_app.continuity.db import init_continuity_db
from tagger_app.continuity.util import (
    normalize_series,
    normalize_issue_num,
    extract_year,
    is_year_compatible,
    extract_issue_number,
    is_issue_in_range,
    expand_publisher_aliases,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
if not (REPO_ROOT / "comics-now.db").exists() and (Path(__file__).resolve().parents[2] / "comics-now.db").exists():
    REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RO_DB = REPO_ROOT / "data" / "reading-orders.db"
DEFAULT_CN_DB = REPO_ROOT / "comics-now.db"


def _load_library_comics(cn_db_path: Path | str) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, List[Dict[str, Any]]], Dict[str, Dict[str, Any]]]:
    """Read library comics from comics-now.db and build lookup maps."""
    direct_map = {}
    series_map = {}
    by_id = {}

    p = Path(cn_db_path)
    if not p.exists():
        return direct_map, series_map, by_id

    conn = sqlite3.connect(str(p), timeout=5.0)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, series, publisher, metadata FROM comics")
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

            c_info = {**c, "issueNum": num, "year": year, "normSeries": norm_s, "normNum": norm_n}
            key = f"{norm_s}:::{norm_n}"
            if key not in direct_map:
                direct_map[key] = c_info
            if norm_s not in series_map:
                series_map[norm_s] = []
            series_map[norm_s].append(c_info)
    finally:
        conn.close()

    return direct_map, series_map, by_id


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


def get_story_arcs_with_completeness(
    comics_now_db_path: Path | str = DEFAULT_CN_DB,
    reading_orders_db_path: Path | str = DEFAULT_RO_DB,
    publisher: Optional[str] = None,
    search: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Calculate completeness percentages for all reading orders matching query."""
    direct_map, series_map, _ = _load_library_comics(comics_now_db_path)

    ro_p = Path(reading_orders_db_path)
    if not ro_p.exists():
        return []

    conn = sqlite3.connect(str(ro_p), timeout=5.0)
    conn.row_factory = sqlite3.Row
    init_continuity_db(conn)
    try:
        cursor = conn.cursor()
        query = "SELECT * FROM reading_orders WHERE 1=1"
        params = []
        if publisher:
            aliases = expand_publisher_aliases(publisher)
            placeholders = ",".join("?" for _ in aliases)
            query += f" AND publisher IN ({placeholders})"
            params.extend(aliases)
        if search:
            query += " AND (title LIKE ? OR description LIKE ?)"
            params.extend([f"%{search}%", f"%{search}%"])

        query += " ORDER BY title ASC"
        cursor.execute(query, params)
        orders = [dict(r) for r in cursor.fetchall()]

        results = []
        for order in orders:
            order_id = order["id"]
            cursor.execute(
                "SELECT * FROM reading_order_issues WHERE reading_order_id = ? ORDER BY position ASC",
                (order_id,),
            )
            issues = [dict(r) for r in cursor.fetchall()]
            total = len(issues)
            order_yrs = [extract_year(iss.get("publication_date")) for iss in issues if extract_year(iss.get("publication_date"))]
            order_era = (min(order_yrs), max(order_yrs)) if order_yrs else None
            owned_count = sum(1 for iss in issues if find_owned_comic(iss, direct_map, series_map, ro_era_window=order_era) is not None)
            pct = round((owned_count / total * 100), 1) if total > 0 else 0.0

            clean_title = re.sub(r"\s+Reading\s+Order$", "", order["title"], flags=re.IGNORECASE).strip()
            results.append({
                "id": order["id"],
                "title": clean_title,
                "publisher": order.get("publisher"),
                "description": order.get("description"),
                "category": order.get("category", "Event"),
                "coverImage": order.get("cover_image"),
                "url": order.get("url"),
                "totalIssues": total,
                "ownedCount": owned_count,
                "missingCount": max(0, total - owned_count),
                "completenessPercent": pct,
            })
        return results
    finally:
        conn.close()


def get_story_arc_detail(
    arc_id: str,
    comics_now_db_path: Path | str = DEFAULT_CN_DB,
    reading_orders_db_path: Path | str = DEFAULT_RO_DB,
) -> Optional[Dict[str, Any]]:
    """Return full story arc details, ordered sequential checklist, and DAG spine/spurs."""
    direct_map, series_map, _ = _load_library_comics(comics_now_db_path)

    ro_p = Path(reading_orders_db_path)
    if not ro_p.exists():
        return None

    conn = sqlite3.connect(str(ro_p), timeout=5.0)
    conn.row_factory = sqlite3.Row
    init_continuity_db(conn)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM reading_orders WHERE id = ?", (arc_id,))
        row = cursor.fetchone()
        if not row:
            return None

        order = dict(row)
        cursor.execute(
            "SELECT * FROM reading_order_issues WHERE reading_order_id = ? ORDER BY position ASC",
            (arc_id,),
        )
        raw_issues = [dict(r) for r in cursor.fetchall()]

        cursor.execute(
            "SELECT * FROM reading_order_collections WHERE reading_order_id = ? ORDER BY position ASC",
            (arc_id,),
        )
        collections = [dict(r) for r in cursor.fetchall()]

        arc_yrs = [extract_year(iss.get("publication_date")) for iss in raw_issues if extract_year(iss.get("publication_date"))]
        arc_era = (min(arc_yrs), max(arc_yrs)) if arc_yrs else None

        issues = []
        for iss in raw_issues:
            owned = find_owned_comic(iss, direct_map, series_map, ro_era_window=arc_era)
            issues.append({
                "id": iss["id"],
                "position": iss["position"],
                "seriesName": iss["series_name"],
                "issueNumber": iss["issue_number"],
                "partNumber": iss.get("part_number"),
                "comicVineId": iss.get("comic_vine_id"),
                "owned": owned is not None,
                "comicId": owned["id"] if owned else None,
            })

        clean_title = re.sub(r"\s+Reading\s+Order$", "", order["title"], flags=re.IGNORECASE).strip()
        return {
            "id": order["id"],
            "title": clean_title,
            "publisher": order.get("publisher"),
            "description": order.get("description"),
            "url": order.get("url"),
            "issues": issues,
            "collections": collections,
        }
    finally:
        conn.close()


def get_next_continuity_issue(
    comic_id: str,
    comics_now_db_path: Path | str = DEFAULT_CN_DB,
    reading_orders_db_path: Path | str = DEFAULT_RO_DB,
) -> Optional[Dict[str, Any]]:
    """Find the next chronological issue in an active story arc for in-reader prompt."""
    direct_map, series_map, by_id = _load_library_comics(comics_now_db_path)
    comic = by_id.get(comic_id)
    if not comic:
        return None

    meta = {}
    if comic.get("metadata"):
        try:
            meta = json.loads(comic["metadata"]) if isinstance(comic["metadata"], str) else comic["metadata"]
        except Exception:
            pass

    series = comic.get("series") or meta.get("Series") or ""
    num = extract_issue_number(comic.get("name") or "", meta.get("Number"))
    year = extract_year(meta.get("Year") or comic.get("name") or "")
    norm_s = normalize_series(series)
    norm_n = normalize_issue_num(num)

    ro_p = Path(reading_orders_db_path)
    if not ro_p.exists():
        return None

    conn = sqlite3.connect(str(ro_p), timeout=5.0)
    conn.row_factory = sqlite3.Row
    init_continuity_db(conn)
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT i.*, o.title as arc_title, o.id as arc_id
            FROM reading_order_issues i
            JOIN reading_orders o ON i.reading_order_id = o.id
            """
        )
        all_issues = cursor.fetchall()
        matching_current = None
        for r in all_issues:
            if normalize_series(r["series_name"]) == norm_s and is_issue_in_range(norm_n, r["issue_number"]):
                ro_date = r["publication_date"] if "publication_date" in r.keys() else None
                if is_year_compatible(year, ro_date or r["arc_title"]):
                    matching_current = r
                    break

        if not matching_current:
            return None

        arc_id = matching_current["arc_id"]
        pos = matching_current["position"]

        cursor.execute(
            "SELECT * FROM reading_order_issues WHERE reading_order_id = ? AND position > ? ORDER BY position ASC LIMIT 1",
            (arc_id, pos),
        )
        next_iss = cursor.fetchone()
        if not next_iss:
            return None

        next_dict = dict(next_iss)
        owned_next = find_owned_comic(next_dict, direct_map, series_map)
        clean_title = re.sub(r"\s+Reading\s+Order$", "", matching_current["arc_title"], flags=re.IGNORECASE).strip()

        return {
            "arcId": arc_id,
            "arcTitle": clean_title,
            "currentPosition": pos,
            "nextIssue": {
                "seriesName": next_dict["series_name"],
                "issueNumber": next_dict["issue_number"],
                "position": next_dict["position"],
                "owned": owned_next is not None,
                "comicId": owned_next["id"] if owned_next else None,
            },
        }
    finally:
        conn.close()
