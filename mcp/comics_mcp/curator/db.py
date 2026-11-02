import os
import time
import json
import sqlite3
from typing import Optional, Dict, Any, List

DEFAULT_DB_PATH = "/opt/comics-now/comics-now.db"


def get_db_path() -> str:
    """Get path to comics-now.db from environment or default."""
    return os.environ.get("COMICS_DB_PATH", DEFAULT_DB_PATH)


def get_recent_comics(months: int = 3, reference_now_ms: Optional[int] = None, db_path: Optional[str] = None) -> List[Dict[str, Any]]:
    """Query comics updated in the last X months from SQLite."""
    now_ms = reference_now_ms if reference_now_ms is not None else int(time.time() * 1000)
    cutoff_ms = now_ms - (months * 30 * 86400 * 1000)

    target_db = db_path if db_path is not None else get_db_path()
    if not os.path.exists(target_db):
        return []

    uri = f"file:{target_db}?mode=ro"
    comics = []
    try:
        conn = sqlite3.connect(uri, uri=True, timeout=5.0)
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(comics);")
        cols = [c[1] for c in cursor.fetchall()]
        has_meta = "metadata" in cols
        meta_col = "metadata" if has_meta else "''"
        cursor.execute(f"""
            SELECT id, publisher, series, name, updatedAt, {meta_col}
            FROM comics
            WHERE updatedAt >= ?
            ORDER BY updatedAt DESC;
        """, (cutoff_ms,))
        for row in cursor.fetchall():
            comics.append({
                "id": row[0],
                "publisher": row[1] or "",
                "series": row[2] or "",
                "name": row[3] or "",
                "updatedAt": row[4],
                "metadata": row[5] or ""
            })
        conn.close()
    except Exception as e:
        print(f"Error fetching recent comics: {e}")

    return comics


def get_all_library_comics(unassigned_only: bool = False, db_path: Optional[str] = None) -> List[Dict[str, Any]]:
    """Fetch all library comics, optionally filtering to those not in any reading list."""
    target_db = db_path if db_path is not None else get_db_path()
    if not os.path.exists(target_db):
        return []

    uri = f"file:{target_db}?mode=ro"
    comics = []
    try:
        conn = sqlite3.connect(uri, uri=True, timeout=5.0)
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(comics);")
        cols = [c[1] for c in cursor.fetchall()]
        has_meta = "metadata" in cols
        meta_col = "metadata" if has_meta else "''"
        if unassigned_only:
            cursor.execute(f"""
                SELECT id, publisher, series, name, updatedAt, {meta_col}
                FROM comics
                WHERE id NOT IN (SELECT comicId FROM reading_list_items)
                ORDER BY publisher, series, name;
            """)
        else:
            cursor.execute(f"""
                SELECT id, publisher, series, name, updatedAt, {meta_col}
                FROM comics
                ORDER BY publisher, series, name;
            """)
        for row in cursor.fetchall():
            comics.append({
                "id": row[0],
                "publisher": row[1] or "",
                "series": row[2] or "",
                "name": row[3] or "",
                "updatedAt": row[4],
                "metadata": row[5] or ""
            })
        conn.close()
    except Exception as e:
        print(f"Error fetching library comics: {e}")

    return comics


def commit_reading_list(name: str, description: str, comic_ids: List[str], db_path: Optional[str] = None) -> bool:
    """Create reading list in comics-now.db and sync across all users."""
    try:
        import httpx
        base_url = os.environ.get("COMICS_BASE_URL", "http://localhost:3000")
        headers = json.loads(os.environ.get("COMICS_EXTRA_HEADERS", "{}"))
        
        # 1. POST /api/v1/reading-lists
        body = {"name": name, "description": description, "comicIds": comic_ids}
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(f"{base_url}/api/v1/reading-lists", json=body, headers=headers)
            if resp.status_code in (200, 201):
                # 2. Trigger sync across all users
                client.post(
                    f"{base_url}/api/v1/admin/reading-lists/sync-to-all",
                    json={"overwrite": True, "prune": False},
                    headers=headers
                )
                return True
    except Exception as e:
        print(f"Error committing reading list via API: {e}")

    # Fallback to direct SQLite insertion if API unreachable
    try:
        import uuid
        target_db = db_path if db_path is not None else get_db_path()
        conn = sqlite3.connect(target_db, timeout=5.0)
        cur = conn.cursor()
        list_id = str(uuid.uuid4()).replace("-", "")[:32]
        now_ms = int(time.time() * 1000)
        cur.execute("""
            INSERT INTO reading_lists (id, userId, name, description, created, updated)
            VALUES (?, 'default-user', ?, ?, ?, ?);
        """, (list_id, name, description, now_ms, now_ms))

        for idx, cid in enumerate(comic_ids):
            cur.execute("""
                INSERT OR IGNORE INTO reading_list_items (listId, comicId, sortOrder, addedAt)
                VALUES (?, ?, ?, ?);
            """, (list_id, cid, idx + 1, now_ms))

        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"Direct DB commit failed: {e}")
        return False
