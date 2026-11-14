"""Batch ComicInfo.xml Story Arc Enrichment Service for Tag Comics Now!.

Scans local library comics, checks canonical story arcs in reading-orders.db,
and enriches external ComicInfo.xml sidecars with StoryArc, StoryArcNumber, and SeriesGroup tags.
"""
import re
import os
import time
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
    get_supported_publishers,
)
from tagger_app.continuity.three_gate_matcher import ThreeGateMatcher
from tagger_app.core.comicinfo import (
    read_comic_info_xml,
    write_comic_info,
    generate_comic_info_xml,
)
from tagger_app.continuity.arc_backfill import merge_story_arcs_meta
from tagger_app.continuity.batch_state import (
    load_batch_watermark,
    resolve_batch_scope_filters,
    save_batch_watermark,
)
from tagger_app.continuity.crypto_utils import load_continuity_gemini_config
from tagger_app.continuity.gemini_batch_tagger import get_gemini_tagger

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
        self.status = "idle"  # idle | running | complete | error
        self.progress = {
            "current": 0,
            "total": 0,
            "updated": 0,
            "skipped": 0,
            "errors": 0,
            "currentComic": "",
        }
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._logs: List[Dict[str, Any]] = []
        self._log_subscribers = []
        self.last_run_time: Optional[int] = load_batch_watermark(self.ro_db_path)

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
            "isCancelled": self.is_cancelled,
            "progress": dict(self.progress),
            "lastRunTime": self.last_run_time,
        }

    def cancel_tagging(self) -> None:
        """Request cooperative cancellation."""
        self.is_cancelled = True
        self.log("WARN", "Cancellation requested. Finishing current comic...")

    def start_batch_tag(
        self,
        target_publisher: Optional[str] = None,
        run_async: bool = True,
        engine: str = "gemini",
        scope: str = "all",
        since_timestamp: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Trigger scoped batch tagging run."""
        filters = resolve_batch_scope_filters(
            scope, self.last_run_time, since_timestamp
        )
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

        target_fn = self._run_gemini_batch if engine == "gemini" else self._run_batch
        if run_async:
            self._thread = threading.Thread(
                target=target_fn,
                args=(target_publisher, filters),
                daemon=True,
            )
            self._thread.start()
            return {"started": True, "targetPublisher": target_publisher, "engine": engine, **filters}
        return target_fn(target_publisher, filters)

    def _run_gemini_batch(self, target_publisher: Optional[str], filters: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Execute Gemini Flash Story Arc batch tagging with live SSE log broadcasting."""
        f = filters or {}
        self.log(
            "INFO",
            f"Starting Gemini Flash Story Arc enrichment (scope={f.get('scope', 'all')}, target={target_publisher or 'All'})...",
        )
        try:
            gemini_tagger = get_gemini_tagger()
            if not gemini_tagger or not gemini_tagger.config.get("api_key"):
                err_msg = "Gemini API key is not configured. Story Arc matching strictly requires Gemini AI (no local fallback allowed)."
                self.log("ERROR", err_msg)
                self.status = "error"
                return {"error": err_msg}

            def progress_callback(cur: int, tot: int, current_arc: str, matches_cnt: int) -> None:
                with self._lock:
                    self.progress["current"] = cur
                    self.progress["total"] = tot
                    self.progress["currentComic"] = current_arc
                    self.progress["updated"] = matches_cnt

            results = gemini_tagger.tag_all_library(
                target_publisher=target_publisher,
                since_ms=f.get("since_ms"),
                scraped_since_sec=f.get("scraped_since_sec"),
                log_fn=self.log,
                progress_fn=progress_callback,
                is_cancelled_fn=lambda: self.is_cancelled,
            )

            with self._lock:
                if self.is_cancelled:
                    self.status = "cancelled"
                else:
                    self.status = "complete"
                    now_ms = int(time.time() * 1000)
                    self.last_run_time = now_ms
                    save_batch_watermark(self.ro_db_path, now_ms)
            return results
        except Exception as e:
            self.status = "error"
            self.log("ERROR", f"Gemini batch tagging encountered an error: {e}")
            raise e
        finally:
            with self._lock:
                self.is_running = False

    def _run_batch(self, target_publisher: Optional[str], filters: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Iterate library comics, match against reading-orders.db, and update ComicInfo sidecars."""
        f = filters or {}
        self.log("INFO", f"Starting Story Arc batch tagging (target: {target_publisher or 'All'})...")
        try:
            if not Path(self.cn_db_path).exists() or not Path(self.ro_db_path).exists():
                raise FileNotFoundError("Required databases not found")

            # 1. Query candidate comics
            cn_conn = sqlite3.connect(self.cn_db_path, timeout=10.0)
            cn_conn.row_factory = sqlite3.Row
            cursor = cn_conn.cursor()

            if target_publisher and target_publisher != "all":
                aliases = expand_publisher_aliases(target_publisher)
            else:
                aliases = get_supported_publishers(self.ro_db_path)

            placeholders = ",".join("?" for _ in aliases)
            query = f"SELECT id, name, series, publisher, path, metadata FROM comics WHERE publisher IN ({placeholders})"
            cursor.execute(query, aliases)
            comics = [dict(r) for r in cursor.fetchall()]
            cn_conn.close()

            self.progress["total"] = len(comics)
            self.log("INFO", f"Found {len(comics)} candidate comics to inspect.")

            # 2. Initialize 3-Gate Matcher (Gate 1 Cover -> Gate 2 Title -> Gate 3 Volume/Issue)
            three_gate_matcher = ThreeGateMatcher(ro_db_path=self.ro_db_path)
            three_gate_matcher.load_indices()

            for idx, comic in enumerate(comics, start=1):
                if self.is_cancelled:
                    self.log("WARN", "Batch tagging cancelled by user.")
                    break

                self.progress["current"] = idx
                self.progress["currentComic"] = comic.get("name") or comic.get("id")

                match = three_gate_matcher.match_comic(comic, max_cover_distance=10)
                if not match:
                    self.progress["skipped"] += 1
                    continue

                clean_arc = match["matchedArc"]
                pos_str = match["storyArcNumber"]
                series_group = match["seriesGroup"]
                series = comic.get("series") or ""
                num = extract_issue_number(comic.get("name") or "")
                year = extract_year(comic.get("name") or "")

                file_path = comic.get("path") or ""

                if file_path and os.path.exists(file_path):
                    try:
                        existing = read_comic_info_xml(file_path) or {}
                        existing_group = existing.get("SeriesGroup")
                        group_to_use = existing_group if existing_group else series_group

                        meta_to_write = merge_story_arcs_meta(
                            {**existing, "SeriesGroup": group_to_use},
                            [(clean_arc, pos_str)],
                        )
                        if (
                            meta_to_write.get("StoryArc") == existing.get("story_arc")
                            and str(meta_to_write.get("StoryArcNumber") or "") == str(existing.get("story_arc_number") or "")
                            and meta_to_write.get("StoryArcs") == existing.get("story_arcs")
                        ):
                            self.progress["skipped"] += 1
                            continue
                        xml_str = generate_comic_info_xml(meta_to_write)
                        # ALWAYS write external sidecar (storage_mode="sidecar"), leaving archives untouched!
                        write_comic_info(file_path, xml_str, storage_mode="sidecar")

                        # Update DB metadata
                        now_ms = int(time.time() * 1000)
                        cn_write = sqlite3.connect(self.cn_db_path, timeout=5.0)
                        cols = {r[1] for r in cn_write.execute("PRAGMA table_info(comics)").fetchall()}
                        if "updatedAt" in cols:
                            cn_write.execute(
                                "UPDATE comics SET metadata = ?, updatedAt = ? WHERE id = ?",
                                (json.dumps(meta_to_write), now_ms, comic["id"]),
                            )
                        else:
                            cn_write.execute(
                                "UPDATE comics SET metadata = ? WHERE id = ?",
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

            self.status = "complete" if not self.is_cancelled else "cancelled"
            self.is_running = False
            if not self.is_cancelled:
                now_ms = int(time.time() * 1000)
                self.last_run_time = now_ms
                save_batch_watermark(self.ro_db_path, now_ms)
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
