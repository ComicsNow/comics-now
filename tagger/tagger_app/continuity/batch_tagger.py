"""Batch ComicInfo.xml Story Arc Enrichment Service for Tag Comics Now!.

Scans local library comics, checks canonical story arcs in reading-orders.db,
and enriches ComicInfo.xml with StoryArc, StoryArcNumber, and SeriesGroup tags.
"""
import re
import os
import json
import sqlite3
import threading
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from tagger_app.continuity.matcher import (
    normalize_series,
    normalize_issue_num,
    is_issue_in_range,
    expand_publisher_aliases,
)
from tagger_app.core.comicinfo import (
    read_comic_info_xml,
    write_comic_info,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RO_DB = REPO_ROOT / "data" / "reading-orders.db"
DEFAULT_CN_DB = REPO_ROOT / "comics-now.db"


class ContinuityBatchTagger:
    """Thread-safe batch tagger for ComicInfo.xml StoryArc enrichment."""

    def __init__(self, ro_db_path: Path | str = DEFAULT_RO_DB, cn_db_path: Path | str = DEFAULT_CN_DB):
        self.ro_db_path = str(ro_db_path)
        self.cn_db_path = str(cn_db_path)

        self.is_running = False
        self.is_cancelled = False
        self.status = "idle"  # idle | running | complete | error
        self.progress = {
            "current": 0,
            "total": 0,
            "updated": 0,
            "skipped": 0,
            "errors": 0,
            "currentComic": "",
        }
        self.last_run_time = None
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._logs: List[Dict[str, Any]] = []
        self._log_subscribers = []

    def log(self, level: str, message: str) -> None:
        """Append log entry and broadcast to SSE subscribers."""
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": level,
            "message": message,
        }
        with self._lock:
            self._logs.append(entry)
            if len(self._logs) > 2000:
                self._logs = self._logs[-2000:]

        for sub in list(self._log_subscribers):
            try:
                sub(entry)
            except Exception:
                pass

    def get_logs(self, limit: int = 500) -> List[Dict[str, Any]]:
        """Return circular log buffer."""
        with self._lock:
            return list(self._logs[-limit:])

    def get_status(self) -> Dict[str, Any]:
        """Return current status dictionary."""
        return {
            "status": self.status,
            "isRunning": self.is_running,
            "progress": dict(self.progress),
            "lastRunTime": self.last_run_time,
        }

    def cancel_tagging(self) -> None:
        """Request cooperative cancellation."""
        self.is_cancelled = True
        self.log("WARN", "Cancellation requested. Finishing current comic...")

    def start_batch_tag(self, target_publisher: Optional[str] = None, run_async: bool = True) -> Dict[str, Any]:
        """Trigger batch tagging run."""
        with self._lock:
            if self.is_running:
                raise RuntimeError("Batch Story Arc tagging is already running.")
            self.is_running = True
            self.is_cancelled = False
            self.status = "running"
            self.progress = {
                "current": 0,
                "total": 0,
                "updated": 0,
                "skipped": 0,
                "errors": 0,
                "currentComic": "",
            }

        if run_async:
            self._thread = threading.Thread(target=self._run_batch, args=(target_publisher,), daemon=True)
            self._thread.start()
            return {"started": True, "targetPublisher": target_publisher}
        else:
            return self._run_batch(target_publisher)

    def _run_batch(self, target_publisher: Optional[str]) -> Dict[str, Any]:
        """Iterate library comics, match against reading-orders.db, and update ComicInfo."""
        self.log("INFO", f"Starting Story Arc batch tagging (target: {target_publisher or 'All'})...")
        try:
            if not Path(self.cn_db_path).exists() or not Path(self.ro_db_path).exists():
                raise FileNotFoundError("Required databases not found")

            # 1. Query candidate comics
            cn_conn = sqlite3.connect(self.cn_db_path, timeout=10.0)
            cn_conn.row_factory = sqlite3.Row
            cursor = cn_conn.cursor()

            query = "SELECT id, title, series, publisher, path, metadata FROM comics WHERE 1=1"
            params = []
            if target_publisher and target_publisher != "all":
                aliases = expand_publisher_aliases(target_publisher)
                placeholders = ",".join("?" for _ in aliases)
                query += f" AND publisher IN ({placeholders})"
                params.extend(aliases)

            cursor.execute(query, params)
            comics = [dict(r) for r in cursor.fetchall()]
            cn_conn.close()

            self.progress["total"] = len(comics)
            self.log("INFO", f"Found {len(comics)} candidate comics to inspect.")

            # 2. Connect to reading orders
            ro_conn = sqlite3.connect(self.ro_db_path, timeout=10.0)
            ro_conn.row_factory = sqlite3.Row
            ro_cursor = ro_conn.cursor()

            for idx, comic in enumerate(comics, start=1):
                if self.is_cancelled:
                    self.log("WARN", "Batch tagging cancelled by user.")
                    break

                self.progress["current"] = idx
                self.progress["currentComic"] = comic.get("title") or comic.get("id")

                series = comic.get("series") or ""
                num_match = re.search(r"#?(\d+(?:\.\d+)?)", comic.get("title") or "")
                num = num_match.group(1) if num_match else "1"
                norm_n = normalize_issue_num(num)

                ro_cursor.execute(
                    """
                    SELECT i.*, o.title as arc_title, o.publisher as arc_publisher
                    FROM reading_order_issues i
                    JOIN reading_orders o ON i.reading_order_id = o.id
                    WHERE i.series_name LIKE ? AND i.issue_number = ?
                    LIMIT 1
                    """,
                    (f"%{series}%", norm_n),
                )
                match = ro_cursor.fetchone()
                if not match:
                    self.progress["skipped"] += 1
                    continue

                clean_arc = re.sub(r"\s+Reading\s+Order$", "", match["arc_title"], flags=re.IGNORECASE).strip()
                pos_str = str(match["position"])
                pub = match["arc_publisher"] or comic.get("publisher") or ""
                series_group = f"{pub} Events" if pub else "Comic Events"

                file_path = comic.get("path")
                if file_path and os.path.exists(file_path):
                    try:
                        existing = read_comic_info_xml(file_path) or {}
                        if (
                            existing.get("StoryArc") == clean_arc
                            and str(existing.get("StoryArcNumber") or "") == pos_str
                        ):
                            self.progress["skipped"] += 1
                            continue

                        meta_to_write = {
                            **existing,
                            "StoryArc": clean_arc,
                            "StoryArcNumber": pos_str,
                            "SeriesGroup": series_group,
                        }
                        write_comic_info(file_path, meta_to_write)
                        self.progress["updated"] += 1
                        self.log("INFO", f"Updated {os.path.basename(file_path)} -> {clean_arc} #{pos_str}")
                    except Exception as err:
                        self.progress["errors"] += 1
                        self.log("WARN", f"Failed to tag {os.path.basename(file_path)}: {err}")
                else:
                    self.progress["skipped"] += 1

            ro_conn.close()
            self.status = "complete"
            self.is_running = False
            self.last_run_time = int(datetime.now().timestamp())
            self.log(
                "INFO",
                f"Batch tagging completed: {self.progress['updated']} updated, {self.progress['skipped']} skipped, {self.progress['errors']} errors.",
            )
            return {"completed": True, "progress": dict(self.progress)}
        except Exception as e:
            self.status = "error"
            self.is_running = False
            self.log("ERROR", f"Batch tagging error: {e}")
            return {"error": str(e)}


# Singleton instance
continuity_batch_tagger = ContinuityBatchTagger()
