"""Reading Order Collections Matcher & Indexer for Trade Paperbacks and Hardcovers."""
import re
import sqlite3
from typing import Optional, Dict, Any, List
from collections import defaultdict

from tagger_app.continuity.util import (
    normalize_series,
    extract_year,
    is_year_compatible,
    is_publisher_compatible,
)


class CollectionMatcher:
    """Pre-indexed in-memory matcher for reading_order_collections."""

    def __init__(self):
        self.by_exact_pair: Dict[tuple[str, str], List[Dict[str, Any]]] = defaultdict(list)
        self.by_combined: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        self.by_title: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        self.total_collections = 0

    def load(self, ro_conn: sqlite3.Connection) -> None:
        """Load all collections from reading-orders.db into normalized in-memory lookup maps."""
        cursor = ro_conn.cursor()
        query = """
            SELECT 
                c.reading_order_id,
                o.title AS arc_title,
                o.publisher AS arc_publisher,
                c.position,
                c.title,
                c.subtitle,
                c.release_year
            FROM reading_order_collections c
            JOIN reading_orders o ON c.reading_order_id = o.id
            ORDER BY c.reading_order_id, c.position
        """
        cursor.execute(query)
        rows = cursor.fetchall()

        self.by_exact_pair.clear()
        self.by_combined.clear()
        self.by_title.clear()
        self.total_collections = len(rows)

        for r in rows:
            entry = {
                "reading_order_id": r["reading_order_id"],
                "arc_title": r["arc_title"],
                "arc_publisher": r["arc_publisher"],
                "position": str(r["position"]),
                "title": r["title"] or "",
                "subtitle": r["subtitle"] or "",
                "release_year": r["release_year"],
            }
            norm_t = normalize_series(entry["title"])
            norm_s = normalize_series(entry["subtitle"]) if entry["subtitle"] else ""
            combined = normalize_series(f"{entry['title']} {entry['subtitle']}")

            if norm_t and norm_s:
                self.by_exact_pair[(norm_t, norm_s)].append(entry)
            if combined:
                self.by_combined[combined].append(entry)
            if norm_t:
                self.by_title[norm_t].append(entry)

    def match(
        self,
        comic_series: str,
        comic_name: str,
        comic_pub: Optional[str] = None,
        comic_year: Optional[int] = None,
    ) -> Optional[Dict[str, Any]]:
        """Match local comic against collections using title, subtitle, publisher, and year."""
        if not comic_series and not comic_name:
            return None

        norm_series = normalize_series(comic_series)
        norm_name = normalize_series(comic_name)

        # 1. Attempt split on common subtitle delimiters: ':', ' - ', ' – '
        series_parts = re.split(r"[:\-–—]\s*", comic_series or "", maxsplit=1)
        candidates: List[Dict[str, Any]] = []

        if len(series_parts) == 2:
            base_t = normalize_series(series_parts[0])
            sub_t = normalize_series(series_parts[1])
            if (base_t, sub_t) in self.by_exact_pair:
                candidates.extend(self.by_exact_pair[(base_t, sub_t)])

        # 2. Check full combined string match (e.g. 'Knight Terrors Dark Knightmares')
        if norm_series in self.by_combined:
            candidates.extend(self.by_combined[norm_series])

        # 3. Check name against combined collection title
        if not candidates and norm_name:
            for comb_title, entries in self.by_combined.items():
                if len(comb_title) >= 6 and comb_title in norm_name:
                    candidates.extend(entries)

        # 4. Check if series matches collection title directly
        if not candidates and norm_series in self.by_title:
            candidates.extend(self.by_title[norm_series])

        # 5. Filter candidates by publisher and year compatibility
        for cand in candidates:
            if not is_publisher_compatible(comic_pub, cand["arc_publisher"]):
                continue

            cand_year = cand["release_year"]
            if comic_year and cand_year:
                if not is_year_compatible(comic_year, cand_year, max_gap=2):
                    continue

            return cand

        return None
