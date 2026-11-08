"""Continuity Crawler & Ingestion Worker for Tag Comics Now!.

Asynchronously crawls ReadingOrders.com with polite rate limiting,
sitemap ETag change detection, and live SSE logging.
"""
import time
import random
import threading
import requests
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from bs4 import BeautifulSoup

from tagger_app.config import get_browser_headers
from tagger_app.continuity.db import (
    get_connection,
    init_continuity_db,
    upsert_reading_order,
    upsert_reading_order_issues,
    upsert_reading_order_collections,
    get_order_count,
    get_sitemap_etag,
    set_sitemap_etag,
)
from tagger_app.continuity.parser import (
    parse_sitemap_slugs,
    parse_reading_order_soup,
    parse_collected_editions_soup,
)
from tagger_app.continuity.cover_service import backfill_missing_covers

SITEMAP_URL = "https://www.readingorders.com/sitemap-0.xml"
BASE_URL = "https://readingorders.com"


class ContinuityCrawler:
    """Thread-safe crawler for ReadingOrders.com."""

    def __init__(self, db_conn=None, min_delay: float = 1.2, min_jitter: float = 0.15, max_jitter: float = 0.35):
        self.db_conn = db_conn
        self.min_delay = min_delay
        self.min_jitter = min_jitter
        self.max_jitter = max_jitter

        self.is_syncing = False
        self.is_cancelled = False
        self.status = "idle"  # idle | syncing | error
        self.progress = {"current": 0, "total": 0, "currentSlug": ""}
        self.last_sync_time = None
        self.last_error = None
        self.last_sitemap_etag = None

        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._logs: List[Dict[str, Any]] = []
        self._log_subscribers = []

    def log(self, level: str, message: str) -> None:
        """Append log message and notify live SSE subscribers."""
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
        """Return most recent logs."""
        with self._lock:
            return list(self._logs[-limit:])

    def get_order_count(self) -> int:
        """Query current total order count."""
        try:
            conn = self.db_conn or get_connection()
            return get_order_count(conn)
        except Exception:
            return 0

    def get_status(self) -> Dict[str, Any]:
        """Return current crawler state."""
        return {
            "status": self.status,
            "isSyncing": self.is_syncing,
            "progress": dict(self.progress),
            "lastSyncTime": self.last_sync_time,
            "lastError": self.last_error,
            "lastSitemapEtag": self.last_sitemap_etag,
            "orderCount": self.get_order_count(),
        }

    def _fetch_sitemap_headers(self) -> Dict[str, Any]:
        """Query HTTP headers of sitemap for ETag."""
        try:
            headers = get_browser_headers()
            if self.last_sitemap_etag:
                headers["If-None-Match"] = self.last_sitemap_etag
            res = requests.head(SITEMAP_URL, headers=headers, timeout=10.0, allow_redirects=True)
            etag = res.headers.get("ETag") or res.headers.get("etag")
            return {"status": res.status_code, "etag": etag}
        except Exception as e:
            self.log("WARN", f"Failed to check sitemap headers: {e}")
            return {"status": 0, "etag": None}

    def _wait_polite(self) -> None:
        """Sleep with random jitter."""
        jitter = random.uniform(self.min_jitter, self.max_jitter)
        time.sleep(self.min_delay + jitter)

    def cancel_sync(self) -> None:
        """Flag active crawler for cancellation."""
        self.is_cancelled = True
        self.log("WARN", "Cancellation requested. Finishing current page...")

    def start_sync(self, mode: str = "both", force: bool = False, run_async: bool = True) -> Dict[str, Any]:
        """Start crawl run synchronously or in a background thread."""
        with self._lock:
            if self.is_syncing:
                raise RuntimeError("A reading orders sync is already in progress.")
            self.is_syncing = True
            self.status = "syncing"
            self.is_cancelled = False
            self.last_error = None
            self.progress = {"current": 0, "total": 0, "currentSlug": ""}

        if run_async:
            self._thread = threading.Thread(target=self._run_crawl, args=(mode, force), daemon=True)
            self._thread.start()
            return {"started": True, "mode": mode}
        else:
            return self._run_crawl(mode, force)

    def _run_crawl(self, mode: str, force: bool) -> Dict[str, Any]:
        """Main crawl execution loop."""
        self.log("INFO", f"Starting ReadingOrders sync (mode: {mode}, force: {force})...")
        try:
            conn = self.db_conn or get_connection()
            init_continuity_db(conn)

            # Check ETag if not forcing
            if not force:
                meta = self._fetch_sitemap_headers()
                cnt = self.get_order_count()
                if cnt >= 150 and (meta.get("status") == 304 or (self.last_sitemap_etag and meta.get("etag") == self.last_sitemap_etag)):
                    self.status = "idle"
                    self.is_syncing = False
                    self.last_sync_time = int(time.time())
                    self.log("INFO", "Sitemap ETag unchanged (304 Not Modified). All orders up to date.")
                    return {"skipped": True, "reason": "Sitemap not modified (304)", "scrapedCount": 0}
                if meta.get("etag"):
                    self.last_sitemap_etag = meta["etag"]
                    set_sitemap_etag(conn, meta["etag"])

            self.log("INFO", f"Fetching sitemap index from {SITEMAP_URL}...")
            res = requests.get(SITEMAP_URL, headers=get_browser_headers(), timeout=15.0)
            slugs = parse_sitemap_slugs(res.text)
            self.log("INFO", f"Sitemap parsed: discovered {len(slugs)} reading orders.")

            cursor = conn.cursor()
            cursor.execute("SELECT id FROM reading_orders")
            existing = {row["id"] for row in cursor.fetchall()}

            slugs_to_scrape = slugs if force else [s for s in slugs if s not in existing]
            if not slugs_to_scrape:
                self.status = "idle"
                self.is_syncing = False
                self.last_sync_time = int(time.time())
                self.log("INFO", f"All {len(slugs)} reading orders already indexed in local database.")
                return {"skipped": True, "reason": "All orders already indexed", "scrapedCount": 0}

            self.progress["total"] = len(slugs_to_scrape)
            scraped = 0

            for idx, slug in enumerate(slugs_to_scrape, start=1):
                if self.is_cancelled:
                    self.log("WARN", "Sync cancelled by user.")
                    break

                self.progress["current"] = idx
                self.progress["currentSlug"] = slug

                try:
                    self._wait_polite()
                    page_url = f"{BASE_URL}/reading-order/{slug}/"
                    r = requests.get(page_url, headers=get_browser_headers(), timeout=15.0)
                    if r.status_code == 200:
                        soup = BeautifulSoup(r.text, "html.parser")
                        order = parse_reading_order_soup(soup, slug)
                        upsert_reading_order(conn, order)
                        if order.get("issues"):
                            upsert_reading_order_issues(conn, slug, order["issues"])

                        if mode in ("both", "collected"):
                            self._wait_polite()
                            col_url = f"{BASE_URL}/reading-order/{slug}/collected-editions/"
                            col_res = requests.get(col_url, headers=get_browser_headers(), timeout=10.0)
                            if col_res.status_code == 200:
                                col_soup = BeautifulSoup(col_res.text, "html.parser")
                                cols = parse_collected_editions_soup(col_soup, slug)
                                if cols:
                                    upsert_reading_order_collections(conn, slug, cols)

                        scraped += 1
                        self.log("INFO", f"[{idx}/{len(slugs_to_scrape)}] Indexed {order['title']} ({len(order['issues'])} issues)")
                except Exception as err:
                    self.log("WARN", f"Failed to ingest {slug}: {err}")

            self.status = "idle"
            self.is_syncing = False
            self.last_sync_time = int(time.time())
            if scraped > 0:
                try:
                    self.log("INFO", "Backfilling cover images and dHashes for newly indexed reading orders...")
                    backfill_missing_covers(max_workers=6)
                except Exception as cover_err:
                    self.log("WARN", f"Cover backfill notice: {cover_err}")

                try:
                    from tagger_app.continuity.gemini_batch_tagger import get_gemini_tagger
                    gemini = get_gemini_tagger()
                    if gemini and gemini.config.get("api_key"):
                        self.log("INFO", f"Starting Gemini Flash story arc matching for {len(slugs_to_scrape)} newly synced orders...")
                        for s_idx, slug in enumerate(slugs_to_scrape, start=1):
                            if self.is_cancelled:
                                self.log("WARN", "Sync cancelled during Gemini evaluation.")
                                break
                            pct = int((s_idx / len(slugs_to_scrape)) * 100)
                            self.log("INFO", f"[Gemini Sync {s_idx}/{len(slugs_to_scrape)}] ({pct}%) Matching candidate comics for '{slug}'...")
                            gem_res = gemini.tag_arc(slug, dry_run=False, log_fn=lambda lvl, msg: self.log(lvl, msg))
                            if gem_res.get("totalMatches", 0) > 0:
                                self.log("SUCCESS", f"  ✓ Gemini matched {gem_res['totalMatches']} issues for '{slug}'")
                    else:
                        self.log("INFO", "Gemini API key not configured. Story Arc matching requires Gemini AI.")
                except Exception as g_sync_err:
                    self.log("WARN", f"Automated Gemini sync matching notice: {g_sync_err}")
            self.log("INFO", f"Sync completed: {scraped} reading orders updated.")
            return {"skipped": False, "scrapedCount": scraped}
        except Exception as e:
            self.status = "error"
            self.is_syncing = False
            self.last_error = str(e)
            self.log("ERROR", f"Crawl failed: {e}")
            return {"error": str(e)}


# Singleton instance
continuity_crawler = ContinuityCrawler()
