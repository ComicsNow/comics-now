"""Collection completeness calculation and trade paperback ownership resolution."""
import re
import sqlite3
from typing import Optional, Dict, Any, List

from tagger_app.continuity.util import normalize_series, is_year_compatible
from tagger_app.continuity.three_gate_matcher import extract_volume_number


def find_owned_collection(
    col: Dict[str, Any],
    direct_map: Dict[str, Any],
    series_map: Dict[str, Any],
    arc_tagged_map: Dict[str, Any],
    clean_arc_title: str,
) -> Optional[Dict[str, Any]]:
    """Match a reading order collection against local library comics."""
    pos_str = str(col.get("position", ""))
    clean_arc = re.sub(r"\s+Reading\s+Order.*$", "", str(clean_arc_title or ""), flags=re.IGNORECASE).strip()
    norm_arc = normalize_series(clean_arc)

    # 1. Match by tagged StoryArc and StoryArcNumber (O(1) lookup)
    tagged_key = f"{norm_arc}:::{pos_str}"
    if tagged_key in arc_tagged_map:
        return arc_tagged_map[tagged_key]

    # 2. Extract title, subtitle, target volume, and base series
    cand_title = col.get("title") or ""
    cand_sub = col.get("subtitle") or ""
    vol_num = extract_volume_number(f"{cand_title} {cand_sub}")
    ro_year = col.get("release_year")

    # Extract base series by stripping volume suffixes (e.g. 'Absolute Batman: Volume 1' -> 'Absolute Batman')
    base_s = re.sub(
        r"[:\-–—]\s*(?:vol(?:ume)?\.?\s*\d+|book\.?\s*\d+|v\.?\s*\d+).*$",
        "",
        cand_title,
        flags=re.IGNORECASE,
    ).strip()
    norm_base = normalize_series(base_s)
    norm_col_title = normalize_series(cand_title)
    norm_sub = normalize_series(cand_sub)

    # Candidate series in library (exact normalized matches only, never loose substring)
    candidate_series_keys = []
    if norm_base in series_map:
        candidate_series_keys.append(norm_base)
    if norm_col_title in series_map and norm_col_title not in candidate_series_keys:
        candidate_series_keys.append(norm_col_title)

    for s_key in candidate_series_keys:
        for c in series_map[s_key]:
            c_vol = c.get("volume") if c.get("volume") is not None else (
                extract_volume_number(c.get("name") or "") or extract_volume_number(c.get("series") or "")
            )
            c_year = c.get("year")
            # Guard against cross-era mismatch when release years are known
            if ro_year and c_year and not is_year_compatible(c_year, ro_year, max_gap=3):
                continue

            # Case A: Collection specifies a volume number
            if vol_num is not None:
                if c_vol == vol_num:
                    return c
                # Subtitle alignment within the exact same series
                if norm_sub and len(norm_sub) >= 4:
                    comb_comic = f"{normalize_series(c.get('name') or '')} {normalize_series(c.get('metaTitle') or '')}"
                    if norm_sub in comb_comic:
                        return c
            else:
                # Case B: Standalone collection without volume (e.g. 'Batman: Cataclysm')
                if norm_sub and len(norm_sub) >= 4:
                    comb_comic = f"{normalize_series(c.get('name') or '')} {normalize_series(c.get('metaTitle') or '')}"
                    if norm_sub in comb_comic:
                        return c
                # If library series has 1 comic and it's volume 1 or unnumbered
                if c_vol in (None, 1) and len(series_map[s_key]) == 1:
                    return c

    return None


def calculate_collection_completeness(
    ro_conn: sqlite3.Connection,
    order_id: str,
    clean_title: str,
    direct_map: Dict[str, Any],
    series_map: Dict[str, Any],
    arc_tagged_map: Dict[str, Any],
) -> Dict[str, Any]:
    """Calculate library completeness and reading progress for an arc's collected editions."""
    cursor = ro_conn.cursor()
    cursor.execute(
        "SELECT * FROM reading_order_collections WHERE reading_order_id = ? ORDER BY position ASC",
        (order_id,),
    )
    collections = [dict(r) for r in cursor.fetchall()]
    total = len(collections)

    owned_count = 0
    read_count = 0
    reading_count = 0
    unread_count = 0

    first_cover = None
    for col in collections:
        if not first_cover and col.get("cover_image_url"):
            first_cover = col["cover_image_url"]

        owned = find_owned_collection(col, direct_map, series_map, arc_tagged_map, clean_title)
        if owned:
            owned_count += 1
            status = owned.get("readStatus", "unread")
            if status == "read":
                read_count += 1
            elif status == "reading":
                reading_count += 1
            else:
                unread_count += 1

    pct_owned = round((owned_count / total * 100), 1) if total > 0 else 0.0
    pct_read = round((read_count / total * 100), 1) if total > 0 else 0.0

    return {
        "totalCollections": total,
        "ownedCount": owned_count,
        "missingCount": max(0, total - owned_count),
        "readCount": read_count,
        "completenessPercent": pct_owned,
        "readPercent": pct_read,
        "coverImage": first_cover,
        "readStatusCounts": {
            "read": read_count,
            "reading": reading_count,
            "unread": unread_count,
            "missing": max(0, total - owned_count),
        },
    }


def enrich_arc_collections(
    collections: List[Dict[str, Any]],
    direct_map: Dict[str, Any],
    series_map: Dict[str, Any],
    arc_tagged_map: Dict[str, Any],
    clean_arc_title: str,
) -> List[Dict[str, Any]]:
    """Enrich collection rows with library ownership and read progress."""
    enriched = []
    for col in collections:
        owned = find_owned_collection(col, direct_map, series_map, arc_tagged_map, clean_arc_title)
        enriched.append({
            "id": col["id"],
            "position": col["position"],
            "title": col.get("title") or "",
            "subtitle": col.get("subtitle") or "",
            "releaseYear": col.get("release_year"),
            "pageCount": col.get("page_count") or (owned.get("pageCount") if owned else None),
            "coverImageUrl": col.get("cover_image_url"),
            "contentsRaw": col.get("contents_raw"),
            "owned": owned is not None,
            "comicId": owned["id"] if owned else None,
            "readStatus": owned.get("readStatus", "missing") if owned else "missing",
            "lastReadPage": owned.get("lastReadPage", 0) if owned else 0,
        })
    return enriched
