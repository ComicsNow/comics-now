"""SQLite Database Manager for Reading Orders & Continuity.

Maintains tables for reading orders, sequential issues, collected editions,
and metadata caches in data/reading-orders.db.
"""
import os
import sqlite3
from pathlib import Path
from typing import Optional, List, Dict, Any

REPO_ROOT = Path(__file__).resolve().parents[3]
if not (REPO_ROOT / "comics-now.db").exists() and (Path(__file__).resolve().parents[2] / "comics-now.db").exists():
    REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = REPO_ROOT / "data" / "reading-orders.db"
DB_PATH = Path(os.environ.get("READING_ORDERS_DB_PATH", str(DEFAULT_DB_PATH)))


def get_connection(db_path: Optional[Path | str] = None) -> sqlite3.Connection:
    """Return a configured SQLite connection with WAL mode enabled."""
    target_path = Path(db_path) if db_path else DB_PATH
    if target_path != Path(":memory:") and not target_path.parent.exists():
        target_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(target_path), timeout=10.0)
    conn.row_factory = sqlite3.Row
    if target_path != Path(":memory:"):
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_continuity_db(conn: sqlite3.Connection) -> None:
    """Create reading orders schema if not already initialized."""
    with conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS reading_orders (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                publisher TEXT,
                description TEXT,
                url TEXT,
                issue_count INTEGER DEFAULT 0,
                scraped_at INTEGER DEFAULT (strftime('%s', 'now'))
            );

            CREATE TABLE IF NOT EXISTS reading_order_issues (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reading_order_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                series_name TEXT NOT NULL,
                issue_number TEXT,
                publication_date TEXT,
                comic_vine_id TEXT,
                part_number INTEGER,
                notes TEXT,
                FOREIGN KEY (reading_order_id) REFERENCES reading_orders(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS reading_order_collections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reading_order_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                title TEXT NOT NULL,
                volume_number TEXT,
                isbn TEXT,
                issue_range TEXT,
                FOREIGN KEY (reading_order_id) REFERENCES reading_orders(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS reading_order_meta (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at INTEGER DEFAULT (strftime('%s', 'now'))
            );

            CREATE INDEX IF NOT EXISTS idx_ro_issues_order ON reading_order_issues(reading_order_id, position);
            CREATE INDEX IF NOT EXISTS idx_ro_issues_lookup ON reading_order_issues(series_name, issue_number);
            CREATE INDEX IF NOT EXISTS idx_ro_collections_order ON reading_order_collections(reading_order_id, position);
            """
        )


def upsert_reading_order(conn: sqlite3.Connection, order: Dict[str, Any]) -> None:
    """Insert or update a reading order."""
    with conn:
        conn.execute(
            """
            INSERT INTO reading_orders (id, title, publisher, description, url, issue_count, scraped_at)
            VALUES (?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                publisher = COALESCE(excluded.publisher, reading_orders.publisher),
                description = COALESCE(excluded.description, reading_orders.description),
                url = COALESCE(excluded.url, reading_orders.url),
                issue_count = excluded.issue_count,
                scraped_at = excluded.scraped_at
            """,
            (
                order["id"],
                order["title"],
                order.get("publisher"),
                order.get("description"),
                order.get("url"),
                order.get("issue_count", 0),
            ),
        )


def upsert_reading_order_issues(conn: sqlite3.Connection, order_id: str, issues: List[Dict[str, Any]]) -> None:
    """Replace all issues for a reading order."""
    with conn:
        conn.execute("DELETE FROM reading_order_issues WHERE reading_order_id = ?", (order_id,))
        for idx, iss in enumerate(issues, start=1):
            conn.execute(
                """
                INSERT INTO reading_order_issues (
                    reading_order_id, position, series_name, issue_number, publication_date, comic_vine_id, part_number, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    order_id,
                    iss.get("position", idx),
                    iss.get("series_name") or iss.get("seriesName") or "",
                    str(iss.get("issue_number") or iss.get("issueNumber") or ""),
                    iss.get("publication_date") or iss.get("publicationDate"),
                    iss.get("comic_vine_id") or iss.get("comicVineId"),
                    iss.get("part_number") or iss.get("partNumber"),
                    iss.get("notes"),
                ),
            )


def upsert_reading_order_collections(conn: sqlite3.Connection, order_id: str, collections: List[Dict[str, Any]]) -> None:
    """Replace all collected editions for a reading order."""
    with conn:
        conn.execute("DELETE FROM reading_order_collections WHERE reading_order_id = ?", (order_id,))
        for idx, col in enumerate(collections, start=1):
            conn.execute(
                """
                INSERT INTO reading_order_collections (
                    reading_order_id, position, title, volume_number, isbn, issue_range
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    order_id,
                    col.get("position", idx),
                    col.get("title") or "",
                    col.get("volume_number") or col.get("volumeNumber"),
                    col.get("isbn"),
                    col.get("issue_range") or col.get("issueRange"),
                ),
            )


def get_order_count(conn: sqlite3.Connection) -> int:
    """Return total number of indexed reading orders."""
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) as count FROM reading_orders")
    row = cursor.fetchone()
    return int(row["count"]) if row else 0


def get_sitemap_etag(conn: sqlite3.Connection) -> Optional[str]:
    """Retrieve saved sitemap ETag."""
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM reading_order_meta WHERE key = 'sitemap_etag'")
    row = cursor.fetchone()
    return str(row["value"]) if row and row["value"] else None


def set_sitemap_etag(conn: sqlite3.Connection, etag: str) -> None:
    """Update saved sitemap ETag."""
    with conn:
        conn.execute(
            """
            INSERT INTO reading_order_meta (key, value, updated_at)
            VALUES ('sitemap_etag', ?, strftime('%s', 'now'))
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """,
            (etag,),
        )


def list_reading_orders(conn: sqlite3.Connection, publisher: Optional[str] = None, search: Optional[str] = None) -> List[Dict[str, Any]]:
    """Query reading orders with optional publisher and title search filters."""
    query = "SELECT * FROM reading_orders WHERE 1=1"
    params: List[Any] = []
    if publisher:
        query += " AND publisher LIKE ?"
        params.append(f"%{publisher}%")
    if search:
        query += " AND (title LIKE ? OR description LIKE ?)"
        params.extend([f"%{search}%", f"%{search}%"])
    query += " ORDER BY title ASC"

    cursor = conn.cursor()
    cursor.execute(query, params)
    return [dict(r) for r in cursor.fetchall()]


def get_reading_order(conn: sqlite3.Connection, order_id: str, include_issues: bool = False) -> Optional[Dict[str, Any]]:
    """Retrieve reading order details, optionally including ordered issues and collections."""
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM reading_orders WHERE id = ?", (order_id,))
    row = cursor.fetchone()
    if not row:
        return None

    result = dict(row)
    if include_issues:
        cursor.execute("SELECT * FROM reading_order_issues WHERE reading_order_id = ? ORDER BY position ASC", (order_id,))
        result["issues"] = [dict(r) for r in cursor.fetchall()]

        cursor.execute("SELECT * FROM reading_order_collections WHERE reading_order_id = ? ORDER BY position ASC", (order_id,))
        result["collections"] = [dict(r) for r in cursor.fetchall()]
    return result
