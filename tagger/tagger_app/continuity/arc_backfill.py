"""StoryArcs multi-arc merge, formatting, and XML/DB persistence helpers."""
import json
import os
import re
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple

from tagger_app.continuity.util import normalize_series
from tagger_app.core.comicinfo import generate_comic_info_xml, read_comic_info_xml, write_comic_info


def _clean_arc_name(title: str) -> str:
    return re.sub(r"\s+Reading\s+Order.*$", "", str(title or ""), flags=re.IGNORECASE).strip()


def parse_story_arcs_tag(raw_value: Any) -> List[Tuple[str, str]]:
    """Parse 'Arc A (#1); Arc B (#4)' into ordered (arc_title, position) tuples."""
    if not raw_value:
        return []
    entries: List[Tuple[str, str]] = []
    for part in str(raw_value).split(";"):
        chunk = part.strip()
        if not chunk:
            continue
        m = re.match(r"^(.*?)\s*\(#([^)]+)\)\s*$", chunk)
        if m:
            entries.append((m.group(1).strip(), m.group(2).strip()))
        else:
            entries.append((chunk, ""))
    return entries


def format_story_arcs_tag(entries: List[Tuple[str, str]]) -> str:
    """Format (arc_title, position) tuples into 'Arc A (#1); Arc B (#4)'."""
    parts: List[str] = []
    for title, pos in entries:
        t = str(title or "").strip()
        if not t:
            continue
        p = str(pos or "").strip()
        parts.append(f"{t} (#{p})" if p else t)
    return "; ".join(parts)


def merge_story_arcs_meta(
    existing_meta: Dict[str, Any],
    new_entries: List[Tuple[str, str]],
) -> Dict[str, Any]:
    """Merge new (arc_title, pos) entries into existing metadata without dropping prior arcs."""
    merged = dict(existing_meta or {})
    ordered: List[Tuple[str, str]] = []
    seen: Dict[str, int] = {}

    def _add(title: str, pos: str) -> None:
        clean_t = _clean_arc_name(title)
        if not clean_t:
            return
        key = normalize_series(clean_t)
        clean_p = str(pos or "").strip()
        if key in seen:
            idx = seen[key]
            if clean_p and not ordered[idx][1]:
                ordered[idx] = (ordered[idx][0], clean_p)
            return
        seen[key] = len(ordered)
        ordered.append((clean_t, clean_p))

    primary_arc = str(merged.get("StoryArc") or merged.get("story_arc") or "").strip()
    primary_num = str(merged.get("StoryArcNumber") or merged.get("story_arc_number") or "").strip()
    if primary_arc:
        _add(primary_arc, primary_num)

    for t, p in parse_story_arcs_tag(merged.get("StoryArcs") or merged.get("story_arcs")):
        _add(t, p)

    for t, p in new_entries:
        _add(t, p)

    if not ordered:
        return merged

    if not primary_arc:
        merged["StoryArc"] = ordered[0][0]
        if ordered[0][1]:
            merged["StoryArcNumber"] = ordered[0][1]

    merged["StoryArcs"] = format_story_arcs_tag(ordered)
    return merged


def apply_arc_tag_to_comic(
    cn_db_path: Path | str,
    storage_mode: str,
    comic: Dict[str, Any],
    arc_title: str,
    pos: int,
) -> str:
    """Merge a matched StoryArc/StoryArcs entry into SQLite metadata and ComicInfo.xml."""
    file_path = comic.get("path") or ""
    file_stem = Path(file_path).stem if file_path else comic.get("name", "")
    action = f"Updated SQLite database for {file_stem}"

    meta_to_write = merge_story_arcs_meta(comic.get("metadata", {}), [(arc_title, str(pos))])
    now_ms = int(time.time() * 1000)
    conn = sqlite3.connect(str(cn_db_path), timeout=5.0)
    conn.execute(
        "UPDATE comics SET metadata = ?, updatedAt = ? WHERE id = ?",
        (json.dumps(meta_to_write), now_ms, comic["id"]),
    )
    conn.commit()
    conn.close()

    if storage_mode in ("sidecar", "archive") and file_path and os.path.exists(file_path):
        try:
            existing_xml = read_comic_info_xml(file_path) or {}
            merged_meta = merge_story_arcs_meta(existing_xml, [(arc_title, str(pos))])
            xml_str = generate_comic_info_xml(merged_meta)
            write_comic_info(file_path, xml_str, storage_mode=storage_mode)
            action = f"Wrote {storage_mode} for {file_stem}"
        except Exception as err:
            action = f"Error writing {storage_mode}: {err}"

    return action
