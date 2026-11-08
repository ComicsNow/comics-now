"""Dynamic candidate filtering and prompt construction for Gemini story arc matching."""
import json
import sqlite3
import re
from pathlib import Path
from typing import Dict, Any, List, Set, Optional

from tagger_app.continuity.util import normalize_series, expand_publisher_aliases


def extract_series_phrases_for_arc(checklist: List[Dict[str, Any]]) -> Set[str]:
    """Extract cleaned, normalized series phrases referenced in an arc checklist."""
    phrases = set()
    for item in checklist:
        for text in [item.get("title"), item.get("subtitle")]:
            if not text:
                continue
            # Strip volume numbers, books, issue patterns, years
            base = re.sub(
                r"[:\-–—]\s*(?:vol(?:ume)?|book|act|part|issue|episode)\s*\d+.*$",
                "",
                str(text),
                flags=re.IGNORECASE,
            ).strip()
            norm = normalize_series(base)
            if norm and len(norm) >= 3:
                phrases.add(norm)
    return phrases


def load_all_publisher_comics(cn_db_path: Path | str, publisher: str) -> List[Dict[str, Any]]:
    """Query all comics in library for given publisher with normalized series precomputed."""
    p = Path(cn_db_path)
    if not p.exists():
        return []

    aliases = expand_publisher_aliases(publisher)
    placeholders = ",".join("?" for _ in aliases)

    conn = sqlite3.connect(str(p))
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute(
        f"SELECT id, name, series, publisher, path, metadata FROM comics WHERE publisher IN ({placeholders})",
        aliases,
    )
    rows = cursor.fetchall()
    conn.close()

    comics = []
    for r in rows:
        meta = {}
        if r["metadata"]:
            try:
                meta = json.loads(r["metadata"]) if isinstance(r["metadata"], str) else r["metadata"]
            except Exception:
                pass

        series = r["series"] or meta.get("Series") or ""
        vol = meta.get("Volume") or ""
        num = meta.get("Number") or ""
        year = meta.get("Year") or ""
        title = meta.get("Title") or ""
        norm_s = normalize_series(series)
        norm_n = normalize_series(r["name"] or "")

        comics.append({
            "id": r["id"],
            "name": r["name"] or "",
            "series": series,
            "norm_series": norm_s,
            "norm_name": norm_n,
            "volume": vol,
            "number": num,
            "year": year,
            "title": title,
            "path": r["path"] or "",
            "metadata": meta,
        })

    return comics


def get_arc_candidate_comics(
    cn_db_path: Path | str,
    publisher: str,
    series_phrases: Set[str],
    preloaded_comics: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """Filter library comics to only those matching the arc's required series phrases."""
    all_pub_comics = preloaded_comics if preloaded_comics is not None else load_all_publisher_comics(cn_db_path, publisher)
    if not series_phrases:
        return []

    candidates = []
    for c in all_pub_comics:
        norm_s = c.get("norm_series") or normalize_series(c.get("series") or "")
        norm_n = c.get("norm_name") or normalize_series(c.get("name") or "")
        if any(phrase in norm_s or phrase in norm_n for phrase in series_phrases):
            candidates.append(c)

    return candidates


def load_all_reading_orders(ro_db_path: Path | str) -> List[Dict[str, Any]]:
    """Load all reading orders and their checklists from reading-orders.db."""
    p = Path(ro_db_path)
    if not p.exists():
        return []

    conn = sqlite3.connect(str(p))
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("SELECT id, title, publisher, description FROM reading_orders ORDER BY publisher, title ASC")
    order_rows = cursor.fetchall()

    arcs = []
    for r in order_rows:
        arc_id = r["id"]
        cursor.execute(
            """
            SELECT id, position, title, subtitle, release_year, contents_raw
            FROM reading_order_collections
            WHERE reading_order_id = ?
            ORDER BY position ASC
            """,
            (arc_id,),
        )
        collections = [dict(c) for c in cursor.fetchall()]

        issues = []
        if not collections:
            cursor.execute(
                """
                SELECT id, position, series_name as title, issue_number as subtitle, publication_date as release_year
                FROM reading_order_issues
                WHERE reading_order_id = ?
                ORDER BY position ASC
                """,
                (arc_id,),
            )
            issues = [dict(i) for i in cursor.fetchall()]

        clean_title = re.sub(r"\s+Reading\s+Order.*$", "", r["title"] or "", flags=re.IGNORECASE).strip()
        checklist = collections if collections else issues
        phrases = extract_series_phrases_for_arc(checklist)

        arcs.append({
            "id": arc_id,
            "title": r["title"],
            "clean_title": clean_title,
            "publisher": r["publisher"],
            "description": r["description"],
            "checklist": checklist,
            "series_phrases": phrases,
        })

    conn.close()
    return arcs


def build_arc_target_prompt(arc: Dict[str, Any], candidates: List[Dict[str, Any]]) -> str:
    """Construct focused prompt for a single story arc and its candidate pool."""
    checklist_lines = []
    for item in arc["checklist"]:
        sub = f" : {item.get('subtitle')}" if item.get("subtitle") else ""
        yr = f" ({item.get('release_year')})" if item.get("release_year") else ""
        checklist_lines.append(f"#{item['position']} | {item.get('title')}{sub}{yr}")

    comic_lines = []
    for c in candidates:
        v_str = f"v{c['volume']}" if c.get("volume") else "-"
        n_str = f"#{c['number']}" if c.get("number") else "-"
        y_str = str(c.get("year")) if c.get("year") else "-"
        t_str = c.get("title") if c.get("title") else "-"
        comic_lines.append(
            f"{c['id']} | {c.get('series', '-')} | {v_str} | {n_str} | {y_str} | {t_str} | {c['name']}"
        )

    check_text = "\n".join(checklist_lines)
    cand_text = "\n".join(comic_lines)

    return (
        f"You are an expert comic book archivist for {arc['publisher']}.\n"
        f"Story Arc: '{arc['clean_title']}'\n"
        "Match each reading order checklist position to the single best matching comic from the candidate list.\n\n"
        "Matching Rules:\n"
        "1. Match by series title, volume number (e.g. v01 or Vol 1 = Volume 1), subtitle, and storyline.\n"
        "2. Note: A comic file may feature the volume subtitle without the volume number (e.g. 'Devil's Workshop' is Volume 3), or the volume number without the subtitle (e.g. 'Vol: 1' is Volume 1).\n"
        "3. Never match across completely different comic universes or runs (e.g. main continuity Batman is NOT Absolute Batman).\n"
        "4. If no candidate matches a position, DO NOT match that position.\n"
        "5. Return only a JSON object conforming to:\n"
        "{\n"
        '  "matches": [\n'
        '    {"position": int, "comic_id": string, "confidence": float, "reason": string}\n'
        "  ]\n"
        "}\n\n"
        f"=== CHECKLIST POSITIONS ({len(arc['checklist'])} ITEMS) ===\n{check_text}\n\n"
        f"=== LIBRARY CANDIDATES ({len(candidates)} COMICS) ===\n"
        "Format: id | series | volume | issue | year | title | filename\n"
        f"{cand_text}"
    )


def parse_arc_matches(
    raw_json_str: str,
    arc: Dict[str, Any],
    candidates_by_id: Dict[str, Any],
    min_confidence: float = 0.85,
) -> List[Dict[str, Any]]:
    """Parse and validate JSON response matches for a single arc."""
    try:
        cleaned = re.sub(r"^```(?:json)?\s*", "", raw_json_str.strip())
        cleaned = re.sub(r"\s*```$", "", cleaned)
        data = json.loads(cleaned)
    except Exception:
        return []

    raw_matches = data.get("matches", []) if isinstance(data, dict) else []
    checklist_by_pos = {item["position"]: item for item in arc["checklist"]}

    valid_matches = []
    for m in raw_matches:
        pos = m.get("position")
        c_id = m.get("comic_id")
        conf = float(m.get("confidence", 0.0))

        if conf < min_confidence or pos not in checklist_by_pos or c_id not in candidates_by_id:
            continue

        valid_matches.append({
            "position": pos,
            "comic_id": c_id,
            "confidence": conf,
            "reason": m.get("reason", "Matched by Gemini Flash"),
            "checklist_item": checklist_by_pos[pos],
        })

    return valid_matches


def find_candidate_arcs_for_comic(
    all_arcs: List[Dict[str, Any]], series: str, publisher: str
) -> List[Dict[str, Any]]:
    """Filter list of story arcs to those relevant to a single comic's series and publisher."""
    norm_s = normalize_series(series)
    if not norm_s:
        return []

    aliases = set(expand_publisher_aliases(publisher))
    candidate_arcs = []
    for arc in all_arcs:
        if arc.get("publisher") not in aliases:
            continue
        phrases = arc.get("series_phrases") or set()
        if any(phrase in norm_s or norm_s in phrase for phrase in phrases):
            candidate_arcs.append(arc)

    return candidate_arcs

