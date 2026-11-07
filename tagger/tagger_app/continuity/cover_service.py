"""ReadingOrders Cover Image Ingestion, Caching, and 64-bit dHash Service."""
import re
import time
import sqlite3
import urllib.request
import urllib.error
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, Tuple, List, Dict, Any
from PIL import Image
import imagehash

REPO_ROOT = Path(__file__).resolve().parents[3]
if not (REPO_ROOT / "comics-now.db").exists() and (Path(__file__).resolve().parents[2] / "comics-now.db").exists():
    REPO_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_RO_DB = REPO_ROOT / "data" / "reading-orders.db"
DEFAULT_COVERS_DIR = REPO_ROOT / "cache" / "ro_covers"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
}


def sanitize_filename_from_url(url: str) -> str:
    """Generate deterministic filename for cached cover."""
    m_iss = re.search(r"/images/issues/(\d+)\.(png|jpe?g|webp)", url, re.I)
    if m_iss:
        return f"issue_{m_iss.group(1)}.{m_iss.group(2).lower()}"
    m_col = re.search(r"/images/collections/(\d+)\.(png|jpe?g|webp)", url, re.I)
    if m_col:
        return f"collection_{m_col.group(1)}.{m_col.group(2).lower()}"
    safe = re.sub(r"[^a-zA-Z0-9_\-\.]", "_", url.split("/")[-1])
    return safe or f"cover_{abs(hash(url))}.png"


def download_and_hash_cover(url: str, dest_dir: Path = DEFAULT_COVERS_DIR) -> Tuple[str, Optional[str], bool]:
    """Download cover image to disk if missing, and compute its 64-bit dHash."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    fname = sanitize_filename_from_url(url)
    dest_path = dest_dir / fname

    if dest_path.exists() and dest_path.stat().st_size > 100:
        try:
            with Image.open(dest_path) as img:
                h = str(imagehash.dhash(img))
                return url, h, True
        except Exception:
            dest_path.unlink(missing_ok=True)

    fetch_url = url.replace("https://readingorders.com", "https://www.readingorders.com")
    req = urllib.request.Request(fetch_url, headers=HEADERS)

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=10.0) as resp:
                if resp.status == 200:
                    data = resp.read()
                    if len(data) > 100:
                        dest_path.write_bytes(data)
                        with Image.open(dest_path) as img:
                            h = str(imagehash.dhash(img))
                            return url, h, False
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError):
            if attempt < 2:
                time.sleep(0.5 * (attempt + 1))
            else:
                return url, None, False

    return url, None, False


def backfill_missing_covers(
    ro_db_path: Path | str = DEFAULT_RO_DB,
    covers_dir: Path | str = DEFAULT_COVERS_DIR,
    max_workers: int = 10,
    batch_size: int = 100,
) -> Dict[str, Any]:
    """Download and hash any unhashed ReadingOrders covers."""
    dest_dir = Path(covers_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(ro_db_path), timeout=30.0)

    cursor = conn.cursor()
    cursor.execute("""
        SELECT DISTINCT cover_image_url 
        FROM reading_order_issues 
        WHERE cover_image_url IS NOT NULL AND cover_image_url != ''
        UNION
        SELECT DISTINCT cover_image_url 
        FROM reading_order_collections 
        WHERE cover_image_url IS NOT NULL AND cover_image_url != ''
    """)
    all_urls = [r[0] for r in cursor.fetchall()]

    cursor.execute("""
        SELECT DISTINCT cover_image_url 
        FROM reading_order_issues 
        WHERE cover_hash IS NOT NULL AND cover_hash != ''
        UNION
        SELECT DISTINCT cover_image_url 
        FROM reading_order_collections 
        WHERE cover_hash IS NOT NULL AND cover_hash != ''
    """)
    already_hashed = {r[0] for r in cursor.fetchall()}
    urls_to_process = [u for u in all_urls if u not in already_hashed or not (dest_dir / sanitize_filename_from_url(u)).exists()]

    if not urls_to_process:
        conn.close()
        return {"total": len(all_urls), "processed": 0, "saved": 0, "errors": 0}

    processed = 0
    saved = 0
    errors = 0

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(download_and_hash_cover, u, dest_dir): u for u in urls_to_process}
        batch_updates = []

        for future in as_completed(futures):
            url, h, was_cached = future.result()
            processed += 1
            if h:
                saved += 1
                batch_updates.append((h, url))
            else:
                errors += 1

            if len(batch_updates) >= batch_size:
                with conn:
                    conn.executemany("UPDATE reading_order_issues SET cover_hash = ? WHERE cover_image_url = ?", batch_updates)
                    conn.executemany("UPDATE reading_order_collections SET cover_hash = ? WHERE cover_image_url = ?", batch_updates)
                batch_updates.clear()

        if batch_updates:
            with conn:
                conn.executemany("UPDATE reading_order_issues SET cover_hash = ? WHERE cover_image_url = ?", batch_updates)
                conn.executemany("UPDATE reading_order_collections SET cover_hash = ? WHERE cover_image_url = ?", batch_updates)
            batch_updates.clear()

    conn.close()
    return {"total": len(all_urls), "processed": processed, "saved": saved, "errors": errors}
