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

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RO_DB = REPO_ROOT / "data" / "reading-orders.db"
DEFAULT_CN_DB = REPO_ROOT / "comics-now.db"


def normalize_series(series: str) -> str:
    """Normalize series name by removing years, punctuation, and event prefixes."""
    if not series:
        return ""
    s = str(series).strip().replace("’", "'").replace("‘", "'")
    s = re.sub(r"\s*\(\d{4}\)", "", s)
    s = re.sub(r"^(?:dc\s*k\.?o\.?|civil\s*war|blackest\s*night)\s*[:\-–—]?\s*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"[^a-zA-Z0-9']", " ", s)
    return " ".join(s.lower().split())


def normalize_issue_num(num: Any) -> str:
    """Strip leading zeroes but preserve fractions and spans."""
    if num is None:
        return ""
    s = str(num).strip()
    return re.sub(r"^0+([1-9])", r"\1", s)


def is_issue_in_range(comic_num: Any, arc_num_str: Any) -> bool:
    """Determine if a comic issue matches an exact number or falls within a span (e.g. 1-5)."""
    if comic_num is None or arc_num_str is None:
        return False
    c_match = re.search(r"\d+(?:\.\d+)?", str(comic_num).strip())
    if not c_match:
        return False
    try:
        c_val = float(c_match.group(0))
    except ValueError:
        return False

    arc_str = str(arc_num_str).strip()
    if "-" in arc_str:
        parts = arc_str.split("-")
        low_match = re.search(r"\d+(?:\.\d+)?", parts[0])
        high_match = re.search(r"\d+(?:\.\d+)?", parts[1])
        if low_match and high_match:
            try:
                low = float(low_match.group(0))
                high = float(high_match.group(0))
                return low <= c_val <= high
            except ValueError:
                pass

    a_match = re.search(r"\d+(?:\.\d+)?", arc_str)
    if not a_match:
        return False
    try:
        return c_val == float(a_match.group(0))
    except ValueError:
        return False


def expand_publisher_aliases(pub: str) -> List[str]:
    """Expand canonical publisher to common imprints and abbreviations."""
    if not pub:
        return []
    p = pub.strip()
    if "DC" in p:
        return ["DC", "DC Comics", "Vertigo", "Black Label", "WildStorm", "Milestone"]
    if "Marvel" in p:
        return ["Marvel", "Marvel Comics", "MAX", "Icon", "Marvel Knights"]
    return [p]


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
        cursor.execute("SELECT id, title, series, publisher, metadata FROM comics")
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
            num_match = re.search(r"#?(\d+(?:\.\d+)?)", c.get("title") or "")
            num = meta.get("Number") or (num_match.group(1) if num_match else "")

            norm_s = normalize_series(series)
            norm_n = normalize_issue_num(num)

            c_info = {**c, "issueNum": num, "normSeries": norm_s, "normNum": norm_n}
            key = f"{norm_s}:::{norm_n}"
            if key not in direct_map:
                direct_map[key] = c_info
            if norm_s not in series_map:
                series_map[norm_s] = []
            series_map[norm_s].append(c_info)
    finally:
        conn.close()

    return direct_map, series_map, by_id


def find_owned_comic(issue: Dict[str, Any], direct_map: Dict[str, Any], series_map: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Match an issue record against local library comics."""
    s_name = issue.get("series_name") or issue.get("seriesName") or ""
    i_num = issue.get("issue_number") or issue.get("issueNumber") or ""
    norm_s = normalize_series(s_name)
    norm_n = normalize_issue_num(i_num)

    direct_key = f"{norm_s}:::{norm_n}"
    if direct_key in direct_map:
        return direct_map[direct_key]

    if norm_s in series_map:
        for c in series_map[norm_s]:
            if is_issue_in_range(c["issueNum"], i_num):
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
        q = "SELECT * FROM reading_orders WHERE 1=1"
        params: List[Any] = []
        if publisher:
            q += " AND publisher LIKE ?"
            params.append(f"%{publisher}%")
        if search:
            q += " AND (title LIKE ? OR description LIKE ?)"
            params.extend([f"%{search}%", f"%{search}%"])
        q += " ORDER BY title ASC"

        cursor = conn.cursor()
        cursor.execute(q, params)
        orders = [dict(r) for r in cursor.fetchall()]

        results = []
        for order in orders:
            cursor.execute(
                "SELECT * FROM reading_order_issues WHERE reading_order_id = ? ORDER BY position ASC",
                (order["id"],),
            )
            issues = [dict(r) for r in cursor.fetchall()]
            owned_count = sum(1 for iss in issues if find_owned_comic(iss, direct_map, series_map))
            total_count = len(issues) or order.get("issue_count") or 0
            missing_count = max(0, total_count - owned_count)
            pct = round((owned_count / total_count) * 100) if total_count > 0 else 0

            clean_title = re.sub(r"\s+Reading\s+Order$", "", order["title"], flags=re.IGNORECASE).strip()
            results.append({
                "id": order["id"],
                "title": clean_title,
                "publisher": order.get("publisher"),
                "description": order.get("description"),
                "url": order.get("url"),
                "totalCount": total_count,
                "ownedCount": owned_count,
                "missingCount": missing_count,
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

        issues = []
        for iss in raw_issues:
            owned = find_owned_comic(iss, direct_map, series_map)
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
    num_match = re.search(r"#?(\d+(?:\.\d+)?)", comic.get("title") or "")
    num = meta.get("Number") or (num_match.group(1) if num_match else "")
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
            WHERE i.series_name LIKE ? AND i.issue_number = ?
            LIMIT 1
            """,
            (f"%{series}%", norm_n),
        )
        current_iss = cursor.fetchone()
        if not current_iss:
            return None

        arc_id = current_iss["arc_id"]
        pos = current_iss["position"]

        cursor.execute(
            "SELECT * FROM reading_order_issues WHERE reading_order_id = ? AND position > ? ORDER BY position ASC LIMIT 1",
            (arc_id, pos),
        )
        next_iss = cursor.fetchone()
        if not next_iss:
            return None

        next_dict = dict(next_iss)
        owned_next = find_owned_comic(next_dict, direct_map, series_map)
        clean_title = re.sub(r"\s+Reading\s+Order$", "", current_iss["arc_title"], flags=re.IGNORECASE).strip()

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
