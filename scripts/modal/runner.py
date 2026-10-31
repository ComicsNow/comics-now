"""
Comics Guided View – backfill runner.
Supports both .cbz (ZIP) and .cbr (RAR) archives with local in-memory WebP pre-compression.
"""

import io
import json
import os
import pathlib
import re
import sqlite3
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import rarfile
except ImportError:
    rarfile = None

from PIL import Image

try:
    from tqdm import tqdm
except ImportError:
    class tqdm:
        def __init__(self, *args, **kwargs): pass
        def update(self, *args, **kwargs): pass
        def close(self): pass
        @staticmethod
        def write(msg): print(msg)

import modal
try:
    detect_pages_batch = modal.Function.from_name("comics-guided-view", "detect_pages_batch")
except Exception:
    from modal_app import app, detect_pages_batch

# ── paths ─────────────────────────────────────────────────────────────────────
DB_PATH     = "/opt/comics-now/comics-now.db"
SIDECAR_DIR = pathlib.Path("/opt/comics-now/metadata/guided_view")

# pages per Modal call
BATCH_SIZE = 15

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"}


# ── archive helpers ───────────────────────────────────────────────────────────

def _natural_key(s: str):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def _is_image(name: str) -> bool:
    return pathlib.PurePosixPath(name).suffix.lower() in IMAGE_EXTS


def _safe_parts(name: str) -> list:
    return list(pathlib.PurePosixPath(name).parts)


def open_archive(comic_path: str):
    """Open .cbz (ZIP) or .cbr (RAR) archive transparently."""
    ext = pathlib.Path(comic_path).suffix.lower()
    if ext == ".cbr" or (rarfile and rarfile.is_rarfile(comic_path)):
        if not rarfile:
            raise RuntimeError("rarfile package required to process CBR on Modal. Run 'pip install rarfile'")
        return rarfile.RarFile(comic_path)
    return zipfile.ZipFile(comic_path)


def list_pages(comic_path: str) -> list[str]:
    with open_archive(comic_path) as arch:
        names = arch.namelist()
    pages = [
        n for n in names
        if _is_image(n)
        and not any(p.startswith(".") or p == "__MACOSX" for p in _safe_parts(n))
    ]
    pages.sort(key=_natural_key)
    return pages


def read_pages(comic_path: str, page_names: list[str]) -> dict[str, bytes]:
    with open_archive(comic_path) as arch:
        return {name: arch.read(name) for name in page_names}


def prepare_page_webp(raw_bytes: bytes, max_side: int = 1280, quality: int = 80) -> tuple[bytes, int, int]:
    """
    Compress image to WebP with max dimension `max_side` to minimize network payload.
    Always returns the exact original (orig_w, orig_h) so bounding box coordinates
    can be projected back into original image space with zero shift.
    """
    img = Image.open(io.BytesIO(raw_bytes))
    orig_w, orig_h = img.size
    max_dim = max(orig_w, orig_h)

    if max_dim <= max_side:
        # Already smaller than max_side, still re-encode to WebP for massive byte reduction
        buf = io.BytesIO()
        img.save(buf, format="WEBP", quality=quality)
        return buf.getvalue(), orig_w, orig_h

    scale = max_side / max_dim
    new_w, new_h = round(orig_w * scale), round(orig_h * scale)
    resized = img.resize((new_w, new_h), Image.BILINEAR)
    buf = io.BytesIO()
    resized.save(buf, format="WEBP", quality=quality)
    return buf.getvalue(), orig_w, orig_h


# ── DB helpers ────────────────────────────────────────────────────────────────

def get_manga_mode(db: sqlite3.Connection,
                   comic_id: str, series: str | None,
                   publisher: str | None, path: str) -> bool:
    """Resolve manga mode exactly like resolveReadingModes in db.js."""
    row = db.execute(
        "SELECT mangaMode FROM user_reading_preferences "
        "WHERE preferenceType='comic' AND targetId=? LIMIT 1",
        (comic_id,),
    ).fetchone()
    if row and row[0] is not None:
        return bool(row[0])
    if series:
        row = db.execute(
            "SELECT mangaMode FROM user_reading_preferences "
            "WHERE preferenceType='series' AND targetId=? LIMIT 1",
            (series,),
        ).fetchone()
        if row and row[0] is not None:
            return bool(row[0])
    if publisher:
        row = db.execute(
            "SELECT mangaMode FROM user_reading_preferences "
            "WHERE preferenceType='publisher' AND targetId=? LIMIT 1",
            (publisher,),
        ).fetchone()
        if row and row[0] is not None:
            return bool(row[0])
    scan_dirs = db.execute("SELECT dir FROM scan_dirs").fetchall()
    for (scan_dir,) in scan_dirs:
        root = scan_dir if scan_dir.endswith("/") else scan_dir + "/"
        if path.startswith(root):
            row = db.execute(
                "SELECT mangaMode FROM user_reading_preferences "
                "WHERE preferenceType='library' AND targetId=? LIMIT 1",
                (scan_dir,),
            ).fetchone()
            if row and row[0] is not None:
                return bool(row[0])
    return False


def get_pending(db: sqlite3.Connection, limit: int | None = None) -> list:
    sql = """
        SELECT id, publisher, series, name, path
        FROM comics
        WHERE COALESCE(guidedViewStatus, 'pending') IN ('pending', 'failed')
        ORDER BY
            COALESCE(publisher, 'zzz') COLLATE NOCASE,
            COALESCE(series,    'zzz') COLLATE NOCASE,
            COALESCE(name,      '')    COLLATE NOCASE
    """
    if limit:
        sql += f" LIMIT {int(limit)}"
    return db.execute(sql).fetchall()


db_lock = threading.Lock()


def reset_stuck(db: sqlite3.Connection) -> int:
    with db_lock:
        cur = db.execute(
            "UPDATE comics SET guidedViewStatus='pending' "
            "WHERE guidedViewStatus='processing'"
        )
        db.commit()
        return cur.rowcount


def mark_processing(db: sqlite3.Connection, comic_id: str) -> None:
    with db_lock:
        now_ms = int(time.time() * 1000)
        try:
            db.execute(
                "UPDATE comics SET guidedViewStatus='processing', guidedViewError=NULL, updatedAt=? WHERE id=?",
                (now_ms, comic_id),
            )
        except sqlite3.OperationalError:
            db.execute(
                "UPDATE comics SET guidedViewStatus='processing', guidedViewError=NULL WHERE id=?",
                (comic_id,),
            )
        db.commit()


def mark_done(db: sqlite3.Connection, comic_id: str, sidecar: pathlib.Path) -> None:
    with db_lock:
        now_ms = int(time.time() * 1000)
        try:
            db.execute(
                "UPDATE comics SET guidedViewStatus='completed', "
                "guidedViewError=NULL, guidedViewPath=?, updatedAt=? WHERE id=?",
                (str(sidecar), now_ms, comic_id),
            )
        except sqlite3.OperationalError:
            db.execute(
                "UPDATE comics SET guidedViewStatus='completed', "
                "guidedViewError=NULL, guidedViewPath=? WHERE id=?",
                (str(sidecar), comic_id),
            )
        db.commit()


def mark_failed(db: sqlite3.Connection, comic_id: str, err: str) -> None:
    with db_lock:
        db.execute(
            "UPDATE comics SET guidedViewStatus='failed', guidedViewError=? WHERE id=?",
            (str(err)[:500], comic_id),
        )
        db.commit()


# ── per-comic processing ──────────────────────────────────────────────────────

def process_comic(db: sqlite3.Connection, comic: tuple) -> dict:
    comic_id, publisher, series, name, path = comic
    manga_mode = get_manga_mode(db, comic_id, series, publisher, path)
    comic_type = "manga" if manga_mode else "western"

    if not os.path.exists(path):
        raise FileNotFoundError(path)

    pages = list_pages(path)
    if not pages:
        raise ValueError(f"No image pages in {path}")

    result: dict = {"comicId": comic_id, "type": comic_type, "pages": {}}

    # Pre-encode all pages of the comic in parallel across CPU cores in local RAM
    all_raw = read_pages(path, pages)
    def _prepare_entry(pname):
        wb, ow, oh = prepare_page_webp(all_raw[pname])
        return pname, [pname, wb, ow, oh]

    with ThreadPoolExecutor(max_workers=4) as pool:
        prepared_dict = dict(pool.map(_prepare_entry, pages))

    batch_slices = [pages[i : i + BATCH_SIZE] for i in range(0, len(pages), BATCH_SIZE)]
    for idx, batch_names in enumerate(batch_slices):
        t0 = time.time()
        batch_data = [prepared_dict[pname] for pname in batch_names]
        
        # Retry with exponential backoff on transient gRPC connection loss
        max_retries = 3
        batch_out = None
        for attempt in range(1, max_retries + 1):
            try:
                batch_out = detect_pages_batch.remote(batch_data, comic_type)
                break
            except Exception as batch_err:
                err_str = str(batch_err)
                if ("Connection lost" in err_str or "SSL connection" in err_str or "StreamTerminated" in err_str) and attempt < max_retries:
                    wait_sec = attempt * 3
                    tqdm.write(f"  [{name[:30]}] batch {idx+1}/{len(batch_slices)} transient drop: {batch_err}. Retrying in {wait_sec}s (attempt {attempt}/{max_retries})...")
                    time.sleep(wait_sec)
                else:
                    raise batch_err

        result["pages"].update(batch_out)
        tqdm.write(f"  [{name[:35]}] batch {idx+1}/{len(batch_slices)} ({len(batch_names)}p) in {time.time()-t0:.2f}s")

    return result


def run_concurrent_backfill(db: sqlite3.Connection, pending: list, concurrency: int = 2) -> tuple[int, int]:
    ok = fail = 0

    def _worker(comic):
        comic_id, publisher, series, name, path = comic
        try:
            mark_processing(db, comic_id)
            result  = process_comic(db, comic)
            sidecar = SIDECAR_DIR / f"{comic_id}.json"
            sidecar.write_text(json.dumps(result, separators=(",", ":")))
            mark_done(db, comic_id, sidecar)
            return True, comic_id, name, None
        except Exception as exc:
            import traceback
            tb = traceback.format_exc()
            mark_failed(db, comic_id, str(exc))
            return False, comic_id, name, f"{exc}\n{tb}"

    if concurrency <= 1:
        pbar = tqdm(total=len(pending), unit="comic", desc="Guided view (sequential)")
        try:
            for comic in pending:
                success, comic_id, name, err = _worker(comic)
                if success:
                    ok += 1
                else:
                    fail += 1
                    tqdm.write(f"FAIL [{comic_id[:8]}…] {name}: {err}")
                pbar.update(1)
        except KeyboardInterrupt:
            tqdm.write("\nInterrupted by user...")
        finally:
            pbar.close()
        return ok, fail

    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = {executor.submit(_worker, comic): comic for comic in pending}
        pbar = tqdm(total=len(pending), unit="comic", desc=f"Guided view ({concurrency} workers)")
        try:
            for fut in as_completed(futures):
                success, comic_id, name, err = fut.result()
                if success:
                    ok += 1
                else:
                    fail += 1
                    tqdm.write(f"FAIL [{comic_id[:8]}…] {name}: {err}")
                pbar.update(1)
        except KeyboardInterrupt:
            tqdm.write("\nInterrupted by user, canceling remaining workers...")
            executor.shutdown(wait=False, cancel_futures=True)
            for fut, comic in futures.items():
                if not fut.done():
                    mark_failed(db, comic[0], "Interrupted")
        finally:
            pbar.close()

    return ok, fail
