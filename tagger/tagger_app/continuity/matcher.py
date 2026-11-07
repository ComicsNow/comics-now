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
from tagger_app.continuity.collection_completeness import (
    calculate_collection_completeness,
    enrich_arc_collections,
)
from tagger_app.continuity.library_store import (
    _load_library_comics,
    find_owned_comic,
)
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


def get_story_arcs_with_completeness(
    comics_now_db_path: Path | str = DEFAULT_CN_DB,
    reading_orders_db_path: Path | str = DEFAULT_RO_DB,
    publisher: Optional[str] = None,
    search: Optional[str] = None,
    edition: Optional[str] = "both",
) -> List[Dict[str, Any]]:
    """Calculate library completeness and read percentages for reading orders matching query."""
    direct_map, series_map, _, arc_tagged_map = _load_library_comics(comics_now_db_path)

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
        target_edition = (edition or "both").lower()

        for order in orders:
            order_id = order["id"]
            clean_title = re.sub(r"\s+Reading\s+Order.*$", "", order["title"], flags=re.IGNORECASE).strip()

            # 1. Single Issues Edition
            if target_edition in ("issues", "both", "all"):
                cursor.execute(
                    "SELECT * FROM reading_order_issues WHERE reading_order_id = ? ORDER BY position ASC",
                    (order_id,),
                )
                issues = [dict(r) for r in cursor.fetchall()]
                total_iss = len(issues)
                if total_iss > 0 or target_edition == "issues":
                    order_yrs = [extract_year(iss.get("publication_date")) for iss in issues if extract_year(iss.get("publication_date"))]
                    order_era = (min(order_yrs), max(order_yrs)) if order_yrs else None
                    owned_iss = 0
                    read_iss = 0
                    reading_iss = 0
                    unread_iss = 0
                    first_cover = order.get("cover_image")
                    for iss in issues:
                        if not first_cover and iss.get("cover_image_url"):
                            first_cover = iss["cover_image_url"]
                        owned = find_owned_comic(iss, direct_map, series_map, ro_era_window=order_era)
                        if owned:
                            owned_iss += 1
                            st = owned.get("readStatus", "unread")
                            if st == "read":
                                read_iss += 1
                            elif st == "reading":
                                reading_iss += 1
                            else:
                                unread_iss += 1

                    pct_owned = round((owned_iss / total_iss * 100), 1) if total_iss > 0 else 0.0
                    pct_read = round((read_iss / total_iss * 100), 1) if total_iss > 0 else 0.0
                    results.append({
                        "id": order_id,
                        "arcId": order_id,
                        "edition": "issue",
                        "title": clean_title,
                        "publisher": order.get("publisher"),
                        "description": order.get("description"),
                        "category": order.get("category", "Event"),
                        "coverImage": first_cover,
                        "url": order.get("url"),
                        "totalIssues": total_iss,
                        "totalCollections": order.get("total_collections", 0),
                        "ownedCount": owned_iss,
                        "missingCount": max(0, total_iss - owned_iss),
                        "readCount": read_iss,
                        "completenessPercent": pct_owned,
                        "readPercent": pct_read,
                        "readStatusCounts": {
                            "read": read_iss,
                            "reading": reading_iss,
                            "unread": unread_iss,
                            "missing": max(0, total_iss - owned_iss),
                        },
                    })

            # 2. Collected Editions
            if target_edition in ("collections", "both", "all"):
                col_res = calculate_collection_completeness(
                    conn, order_id, clean_title, direct_map, series_map, arc_tagged_map
                )
                total_col = col_res["totalCollections"]
                if total_col > 0 or target_edition == "collections":
                    results.append({
                        "id": f"{order_id}__collections" if target_edition == "both" else order_id,
                        "arcId": order_id,
                        "edition": "collection",
                        "title": clean_title,
                        "publisher": order.get("publisher"),
                        "description": order.get("description"),
                        "category": order.get("category", "Event"),
                        "coverImage": col_res.get("coverImage") or order.get("cover_image"),
                        "url": order.get("url"),
                        "totalIssues": order.get("total_issues", 0),
                        "totalCollections": total_col,
                        "ownedCount": col_res["ownedCount"],
                        "missingCount": col_res["missingCount"],
                        "readCount": col_res["readCount"],
                        "completenessPercent": col_res["completenessPercent"],
                        "readPercent": col_res["readPercent"],
                        "readStatusCounts": col_res["readStatusCounts"],
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
    direct_map, series_map, _, arc_tagged_map = _load_library_comics(comics_now_db_path)

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
        raw_collections = [dict(r) for r in cursor.fetchall()]

        arc_yrs = [extract_year(iss.get("publication_date")) for iss in raw_issues if extract_year(iss.get("publication_date"))]
        arc_era = (min(arc_yrs), max(arc_yrs)) if arc_yrs else None

        clean_title = re.sub(r"\s+Reading\s+Order.*$", "", order["title"], flags=re.IGNORECASE).strip()

        issues = []
        owned_iss = 0
        read_iss = 0
        for iss in raw_issues:
            owned = find_owned_comic(iss, direct_map, series_map, ro_era_window=arc_era)
            is_owned = owned is not None
            st = owned.get("readStatus", "unread") if is_owned else "missing"
            if is_owned:
                owned_iss += 1
                if st == "read":
                    read_iss += 1
            issues.append({
                "id": iss["id"],
                "position": iss["position"],
                "seriesName": iss["series_name"],
                "issueNumber": iss["issue_number"],
                "partNumber": iss.get("part_number"),
                "comicVineId": iss.get("comic_vine_id"),
                "coverImageUrl": iss.get("cover_image_url"),
                "publicationDate": iss.get("publication_date"),
                "storyParts": iss.get("story_parts"),
                "owned": is_owned,
                "comicId": owned["id"] if is_owned else None,
                "readStatus": st,
                "lastReadPage": owned.get("lastReadPage", 0) if is_owned else 0,
                "pageCount": owned.get("pageCount", 0) if is_owned else 0,
            })

        collections = enrich_arc_collections(
            raw_collections, direct_map, series_map, arc_tagged_map, clean_title
        )
        owned_col = sum(1 for c in collections if c["owned"])
        read_col = sum(1 for c in collections if c["readStatus"] == "read")

        return {
            "id": order["id"],
            "title": clean_title,
            "publisher": order.get("publisher"),
            "description": order.get("description"),
            "url": order.get("url"),
            "totalIssues": len(issues),
            "ownedCount": owned_iss,
            "readCount": read_iss,
            "completenessPercent": round((owned_iss / len(issues) * 100), 1) if issues else 0.0,
            "totalCollections": len(collections),
            "ownedCollectionsCount": owned_col,
            "readCollectionsCount": read_col,
            "collectionsCompletenessPercent": round((owned_col / len(collections) * 100), 1) if collections else 0.0,
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
    direct_map, series_map, by_id, _ = _load_library_comics(comics_now_db_path)
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
