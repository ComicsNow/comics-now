"""Persisted watermark and incremental scope resolution for Story Arc batch tagging."""
import sqlite3
from pathlib import Path
from typing import Any, Dict, Optional


def load_batch_watermark(ro_db_path: Path | str) -> Optional[int]:
    """Load persisted last successful enrichment timestamp (ms) from reading-orders.db."""
    p = Path(ro_db_path)
    if not p.exists():
        return None
    try:
        conn = sqlite3.connect(str(p), timeout=5.0)
        row = conn.execute(
            "SELECT value FROM batch_tag_state WHERE key = 'last_run_time_ms'"
        ).fetchone()
        conn.close()
        return int(row[0]) if row and row[0] else None
    except Exception:
        return None


def save_batch_watermark(ro_db_path: Path | str, ts_ms: int) -> None:
    """Persist last successful enrichment timestamp (ms) to reading-orders.db."""
    p = Path(ro_db_path)
    if not p.exists():
        return
    try:
        conn = sqlite3.connect(str(p), timeout=5.0)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS batch_tag_state (key TEXT PRIMARY KEY, value TEXT)"
        )
        conn.execute(
            "INSERT OR REPLACE INTO batch_tag_state (key, value) VALUES ('last_run_time_ms', ?)",
            (str(int(ts_ms)),),
        )
        conn.commit()
        conn.close()
    except Exception:
        pass


def resolve_batch_scope_filters(
    scope: str,
    last_run_time: Optional[int],
    since_timestamp: Optional[int],
) -> Dict[str, Any]:
    """Resolve incremental SQL/timestamp filters from user-selected batch scope."""
    clean_scope = (scope or "all").strip().lower()
    since_ms: Optional[int] = None
    scraped_since_sec: Optional[int] = None

    if clean_scope == "since_last_run":
        if not last_run_time:
            raise ValueError(
                "No previous enrichment run recorded yet. Choose 'Full Library Rescan' or 'Since Date'."
            )
        since_ms = int(last_run_time)
    elif clean_scope == "since_date":
        if since_timestamp is None:
            raise ValueError("A valid 'sinceDate' / 'sinceTimestamp' is required for 'since_date' scope.")
        since_ms = int(since_timestamp)
    elif clean_scope == "new_arcs":
        if since_timestamp is not None:
            scraped_since_sec = int(int(since_timestamp) // 1000)
        elif last_run_time:
            scraped_since_sec = int(int(last_run_time) // 1000)

    return {
        "scope": clean_scope,
        "since_ms": since_ms,
        "scraped_since_sec": scraped_since_sec,
    }
