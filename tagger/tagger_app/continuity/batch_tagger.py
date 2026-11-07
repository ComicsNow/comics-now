"""Batch ComicInfo.xml Story Arc Enrichment Service for Tag Comics Now!.

Scans local library comics, checks canonical story arcs in reading-orders.db,
and enriches external ComicInfo.xml sidecars with StoryArc, StoryArcNumber, and SeriesGroup tags.
"""
import re
import os
import json
import sqlite3
import threading
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from collections import defaultdict
from tagger_app.continuity.util import (
    normalize_series,
    normalize_issue_num,
    extract_year,
    is_year_compatible,
    is_publisher_compatible,
    extract_issue_number,
    extract_collected_issues,
    is_issue_in_range,
    expand_publisher_aliases,
)
from tagger_app.core.comicinfo import (
    read_comic_info_xml,
    write_comic_info,
    generate_comic_info_xml,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
if not (REPO_ROOT / "comics-now.db").exists() and (Path(__file__).resolve().parents[2] / "comics-now.db").exists():
    REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RO_DB = REPO_ROOT / "data" / "reading-orders.db"
DEFAULT_CN_DB = REPO_ROOT / "comics-now.db"


class ContinuityBatchTagger:
    """Thread-safe batch tagger for ComicInfo.xml StoryArc sidecar enrichment."""

    def __init__(self, ro_db_path: Path | str = DEFAULT_RO_DB, cn_db_path: Path | str = DEFAULT_CN_DB):
        self.ro_db_path = str(ro_db_path)
        self.cn_db_path = str(cn_db_path)

        self.is_running = False
        self.is_cancelled = False
        self.dry_run = False
        self.dry_run_results: List[Dict[str, Any]] = []
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
            "dryRun": self.dry_run,
            "dryRunResultsCount": len(self.dry_run_results),
            "progress": dict(self.progress),
            "lastRunTime": self.last_run_time,
        }

    def get_dry_run_results(self) -> List[Dict[str, Any]]:
        """Return results of the last dry run simulation."""
        with self._lock:
            return list(self.dry_run_results)

    def cancel_tagging(self) -> None:
        """Request cooperative cancellation."""
        self.is_cancelled = True
        self.log("WARN", "Cancellation requested. Finishing current comic...")

    def start_batch_tag(
        self,
        target_publisher: Optional[str] = None,
        run_async: bool = True,
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        """Trigger batch tagging run with optional dry-run simulation mode."""
        with self._lock:
            if self.is_running:
                raise RuntimeError("Batch Story Arc tagging is already running.")
            self.is_running = True
            self.is_cancelled = False
            self.dry_run = dry_run
            self.dry_run_results = []
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
            self._thread = threading.Thread(
                target=self._run_batch,
                args=(target_publisher, dry_run),
                daemon=True,
            )
            self._thread.start()
            return {"started": True, "targetPublisher": target_publisher, "dryRun": dry_run}
        else:
            return self._run_batch(target_publisher, dry_run)

    def _run_batch(self, target_publisher: Optional[str], dry_run: bool = False) -> Dict[str, Any]:
        """Iterate library comics, match against reading-orders.db, and update ComicInfo sidecars."""
        mode_label = "DRY-RUN simulation" if dry_run else "live write"
        self.log("INFO", f"Starting Story Arc batch tagging [{mode_label}] (target: {target_publisher or 'All'})...")
        try:
            if not Path(self.cn_db_path).exists() or not Path(self.ro_db_path).exists():
                raise FileNotFoundError("Required databases not found")

            # 1. Query candidate comics
            cn_conn = sqlite3.connect(self.cn_db_path, timeout=10.0)
            cn_conn.row_factory = sqlite3.Row
            cursor = cn_conn.cursor()

            query = "SELECT id, name, series, publisher, path, metadata FROM comics WHERE 1=1"
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

            # 2. Connect to reading orders and precompute era windows & series index
            ro_conn = sqlite3.connect(self.ro_db_path, timeout=10.0)
            ro_conn.row_factory = sqlite3.Row
            ro_cursor = ro_conn.cursor()

            ro_cursor.execute(
                """
                SELECT reading_order_id, publication_date
                FROM reading_order_issues
                WHERE publication_date IS NOT NULL AND publication_date != ''
                """
            )
            ro_issue_dates = defaultdict(list)
            for r_id, p_date in ro_cursor.fetchall():
                yr = extract_year(p_date)
                if yr:
                    ro_issue_dates[r_id].append(yr)

            ro_era_windows = {}
            for r_id, title, desc in ro_cursor.execute("SELECT id, title, description FROM reading_orders").fetchall():
                dates = ro_issue_dates.get(r_id, [])
                if dates:
                    ro_era_windows[r_id] = (min(dates), max(dates))
                else:
                    ty = extract_year(title) or extract_year(desc)
                    if ty:
                        ro_era_windows[r_id] = (ty, ty)

            ro_issues_by_series = defaultdict(list)
            ro_cursor.execute(
                """
                SELECT i.*, o.title as arc_title, o.publisher as arc_publisher
                FROM reading_order_issues i
                JOIN reading_orders o ON i.reading_order_id = o.id
                """
            )
            for r in ro_cursor.fetchall():
                row_dict = dict(r)
                row_dict["era_window"] = ro_era_windows.get(row_dict["reading_order_id"])
                ro_issues_by_series[normalize_series(row_dict["series_name"])].append(row_dict)

            for idx, comic in enumerate(comics, start=1):
                if self.is_cancelled:
                    self.log("WARN", "Batch tagging cancelled by user.")
                    break

                self.progress["current"] = idx
                self.progress["currentComic"] = comic.get("name") or comic.get("id")

                series = comic.get("series") or ""
                meta = {}
                if comic.get("metadata"):
                    try:
                        meta = json.loads(comic["metadata"]) if isinstance(comic["metadata"], str) else comic["metadata"]
                    except Exception:
                        pass

                num = extract_issue_number(comic.get("name") or "", meta.get("Number"))
                if not num:
                    self.progress["skipped"] += 1
                    continue

                year = extract_year(meta.get("Year") or comic.get("name") or "")
                c_pub = comic.get("publisher") or ""
                collected_range = extract_collected_issues(meta.get("Summary") or meta.get("Description") or "")

                norm_s = normalize_series(series)
                candidates = ro_issues_by_series.get(norm_s, [])
                if not candidates:
                    candidates = ro_issues_by_series.get(normalize_series(series, strip_article=False), [])

                if not candidates:
                    self.progress["skipped"] += 1
                    continue

                matches = [
                    cand for cand in candidates
                    if is_publisher_compatible(c_pub, cand.get("arc_publisher"))
                    and is_issue_in_range(num, cand["issue_number"], collected_range=collected_range)
                    and is_year_compatible(
                        year,
                        cand.get("publication_date") or cand["arc_title"],
                        ro_era_window=cand.get("era_window"),
                    )
                ]

                if not matches:
                    self.progress["skipped"] += 1
                    continue

                match = matches[0]
                clean_arc = re.sub(r"\s+Reading\s+Order$", "", match["arc_title"], flags=re.IGNORECASE).strip()
                pos_str = str(match["position"])
                series_group = f"{match['arc_publisher'] or 'Comic'} Events"

                file_path = comic.get("path") or ""

                if dry_run:
                    self.dry_run_results.append({
                        "comicId": comic["id"],
                        "comicName": comic.get("name") or "",
                        "series": series,
                        "issueNumber": num,
                        "year": year,
                        "matchedArc": clean_arc,
                        "storyArcNumber": pos_str,
                        "seriesGroup": series_group,
                        "filePath": file_path,
                    })
                    self.progress["updated"] += 1
                    self.log("INFO", f"[DRY-RUN] Would tag {os.path.basename(file_path or comic.get('name', ''))} -> {clean_arc} #{pos_str}")
                    continue

                if file_path and os.path.exists(file_path):
                    try:
                        existing = read_comic_info_xml(file_path) or {}
                        if (
                            existing.get("StoryArc") == clean_arc
                            and str(existing.get("StoryArcNumber") or "") == pos_str
                        ):
                            self.progress["skipped"] += 1
                            continue

                        existing_group = existing.get("SeriesGroup")
                        group_to_use = existing_group if existing_group else series_group

                        meta_to_write = {
                            **existing,
                            "StoryArc": clean_arc,
                            "StoryArcNumber": pos_str,
                            "SeriesGroup": group_to_use,
                        }
                        xml_str = generate_comic_info_xml(meta_to_write)
                        # ALWAYS write external sidecar (storage_mode="sidecar"), leaving archives untouched!
                        write_comic_info(file_path, xml_str, storage_mode="sidecar")

                        # Update DB metadata
                        cn_write = sqlite3.connect(self.cn_db_path, timeout=5.0)
                        cn_write.execute(
                            "UPDATE comics SET metadata = ?, updatedAt = datetime('now') WHERE id = ?",
                            (json.dumps(meta_to_write), comic["id"]),
                        )
                        cn_write.commit()
                        cn_write.close()

                        self.progress["updated"] += 1
                        self.log("INFO", f"Updated sidecar for {os.path.basename(file_path)} -> {clean_arc} #{pos_str}")
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
                f"Batch tagging completed [{mode_label}]: {self.progress['updated']} updated, {self.progress['skipped']} skipped, {self.progress['errors']} errors.",
            )
            return {"completed": True, "dryRun": dry_run, "progress": dict(self.progress)}
        except Exception as e:
            self.status = "error"
            self.is_running = False
            self.log("ERROR", f"Batch tagging error: {e}")
            return {"error": str(e)}
            self.log("ERROR", f"Batch tagging error: {e}")
            return {"error": str(e)}


# Singleton instance
continuity_batch_tagger = ContinuityBatchTagger()
