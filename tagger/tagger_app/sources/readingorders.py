"""ReadingOrders.com metadata & story arc source for Tag Comics Now!.

Queries the local reading-orders.db cache to identify story arcs, sequential reading order,
and series groups according to ComicInfo v2.0/v2.1 standards.
"""
import os
import sqlite3
from typing import Optional, List, Dict, Any
from pathlib import Path

from tagger_app.core.query import clean_search_query

DB_PATH = Path("/opt/comics-now/data/reading-orders.db")


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
            "StoryArc": arc_title,
            "StoryArcNumber": arc_pos,
            "SeriesGroup": series_group,
            "source": "readingorders.com",
            "confidence": 0.95,
        }
    except Exception as e:
        print(f"[!] ReadingOrders source error: {e}")
        return None
