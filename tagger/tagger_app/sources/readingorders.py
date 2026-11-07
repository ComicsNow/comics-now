"""ReadingOrders.com metadata & story arc source for Tag Comics Now!.

Queries the local reading-orders.db cache to identify story arcs, sequential reading order,
and series groups according to ComicInfo v2.0/v2.1 standards.
"""
import os
import sqlite3
from typing import Optional, List, Dict, Any, Callable
from pathlib import Path

from tagger_app.core.query import clean_search_query

# Dynamically resolve data/reading-orders.db relative to repository root
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = REPO_ROOT / "data" / "reading-orders.db"
DB_PATH = Path(os.environ.get("READING_ORDERS_DB_PATH", str(DEFAULT_DB_PATH)))


def normalize_series_name(name: str) -> str:
    if not name:
        return ""
    import re
    # Strip (year), remove non-alphanumeric, lower
    s = re.sub(r"\s*\(\d{4}\)", "", name)
    s = re.sub(r"[^a-zA-Z0-9]", " ", s)
    return " ".join(s.lower().split())


def get_story_arc_candidate(series: str, issue_num: str) -> Optional[Dict[str, Any]]:
    """Look up an issue in reading-orders.db and return ComicInfo StoryArc metadata."""
    if not DB_PATH.exists():
        return None

    norm_series = normalize_series_name(series)
    norm_num = issue_num.lstrip("0") or "0"

    try:
        conn = sqlite3.connect(str(DB_PATH), timeout=5)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Find matching issue in any reading order
        cursor.execute(
            """
            SELECT i.*, o.title as arc_title, o.publisher as arc_publisher
            FROM reading_order_issues i
            JOIN reading_orders o ON i.reading_order_id = o.id
            WHERE i.series_name LIKE ? AND i.issue_number = ?
            LIMIT 1
            """,
            (f"%{series}%", norm_num),
        )
        row = cursor.fetchone()
        conn.close()

        if not row:
            return None

        arc_title = row["arc_title"]
        arc_pos = str(row["position"])
        pub = row["arc_publisher"] or ""
        series_group = f"{pub} Events" if pub else "Comic Events"

        return {
            "story_arc": arc_title,
            "story_arc_number": arc_pos,
            "series_group": series_group,
            "StoryArc": arc_title,
            "StoryArcNumber": arc_pos,
            "SeriesGroup": series_group,
            "source": "readingorders.com",
            "confidence": 0.95,
        }
    except Exception as e:
        print(f"[!] ReadingOrders source error: {e}")
        return None


def resolve_readingorders_for_source(filename: str, ctx: Optional[Any] = None, on_progress: Optional[Callable] = None) -> List[Any]:
    """Source resolver adapter querying reading-orders.db for story arcs & continuity."""
    if not DB_PATH.exists():
        if on_progress:
            on_progress("ReadingOrders database not found")
        return []

    series = ""
    issue_num = ""
    if ctx and ctx.existing_meta:
        series = ctx.existing_meta.get("series") or ctx.existing_meta.get("title") or ""
        issue_num = str(ctx.existing_meta.get("number") or ctx.existing_meta.get("issue_number") or "")

    if not series or not issue_num:
        import re
        base = os.path.splitext(os.path.basename(filename))[0]
        m = re.search(r"^(.*?)(?:[#\s]+)(\d+(?:\.\d+)?)$", base)
        if m:
            if not series:
                series = m.group(1).strip()
            if not issue_num:
                issue_num = m.group(2).strip()

    if not series or not issue_num:
        return []

    if on_progress:
        on_progress(f"Checking continuity for {series} #{issue_num}...")

    candidate = get_story_arc_candidate(series, issue_num)
    if not candidate:
        return []

    meta = {
        "story_arc": candidate.get("story_arc") or candidate.get("StoryArc"),
        "story_arc_number": candidate.get("story_arc_number") or candidate.get("StoryArcNumber"),
        "series_group": candidate.get("series_group") or candidate.get("SeriesGroup"),
        "StoryArc": candidate.get("StoryArc") or candidate.get("story_arc"),
        "StoryArcNumber": candidate.get("StoryArcNumber") or candidate.get("story_arc_number"),
        "SeriesGroup": candidate.get("SeriesGroup") or candidate.get("series_group"),
        "series": series,
        "number": issue_num,
    }
    return [(meta, 1.0, "https://readingorders.com/")]
