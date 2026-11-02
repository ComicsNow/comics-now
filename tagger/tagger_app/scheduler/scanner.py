"""Background scheduler loop, file cleanup, and automated library enhancement."""

import os
import time
import datetime
import shutil
import threading
import queue
from concurrent.futures import ThreadPoolExecutor

from tagger_app.config import UPLOAD_FOLDER, STATIC_TEMP_DIR
from tagger_app.core.tagger import process_single_cbz_file
from tagger_app.core.enhancer import enhance_single_cbz_file
from tagger_app.persistence.scan_logs import write_scan_log
from tagger_app.scheduler.state import (
    scheduler_config,
    scheduler_status,
    load_scheduler_data,
    save_scheduler_data,
    calculate_next_run,
)

# Active scans state
active_scans = {}
active_scans_lock = threading.Lock()
sessions = {}


def run_scheduled_scan():
    folder_path = scheduler_config.get("default_directory")
    if not folder_path or not os.path.exists(folder_path) or not os.path.isdir(folder_path):
        print(f"[-] Scheduled scan folder not found: {folder_path}")
        scheduler_status["last_run"] = datetime.datetime.now().isoformat()
        calculate_next_run()
        save_scheduler_data()
        return

    scheduler_status["is_running"] = True
    start_time = datetime.datetime.now()

    try:
        cbz_files = sorted([
            os.path.join(folder_path, f) for f in os.listdir(folder_path)
            if f.lower().endswith('.cbz')
        ])

        results = []
        tagged_count = 0

        for file_path in cbz_files:
            res = process_single_cbz_file(
                file_path,
                scheduler_config.get("comicvine_api_key"),
                google_books_api_key=scheduler_config.get("google_books_api_key"),
                metron_user=scheduler_config.get("metron_user"),
                metron_pass=scheduler_config.get("metron_pass"),
                lower_threshold=scheduler_config.get("lower_threshold", 0.80),
                upper_threshold=scheduler_config.get("upper_threshold", 0.90),
                enabled_fields=scheduler_config.get("selected_fields"),
                enabled_sources=scheduler_config.get("enabled_sources"),
                force_reprocess=scheduler_config.get("force_reprocess", False)
            )
            results.append(res)
            if res.get("status") == "tagged":
                tagged_count += 1

        scan_log = {
            "timestamp": start_time.isoformat(),
            "duration_seconds": round((datetime.datetime.now() - start_time).total_seconds(), 2),
            "total_files": len(cbz_files),
            "tagged_count": tagged_count,
            "results": results
        }

        # Keep only the last 10 logs in history
        scheduler_status["history"] = [scan_log] + scheduler_status.get("history", [])[:9]

        # Write permanent log
        failed_count = sum(1 for r in results if r.get("status") == "failed")
        skipped_count = len(cbz_files) - tagged_count - failed_count
        write_scan_log(
            scan_type="scheduled",
            target=folder_path,
            total_files=len(cbz_files),
            tagged_count=tagged_count,
            skipped_count=skipped_count,
            failed_count=failed_count,
            results=results
        )

        print(f"[+] Scheduled scan completed: tagged {tagged_count}/{len(cbz_files)} files.")

    except Exception as e:
        print(f"[-] Scheduled scan failed: {e}")

    finally:
        scheduler_status["is_running"] = False
        scheduler_status["last_run"] = datetime.datetime.now().isoformat()
        calculate_next_run()
        save_scheduler_data()


def cleanup_old_files():
    """
    Deletes files and directories in uploads/ and temp_covers/ that are older than 24 hours.
    Also cleans up static/temp/ covers to avoid stale static files.
    """
    now = time.time()
    cutoff = now - 24 * 3600  # 24 hours ago

    temp_covers_dir = os.path.join(os.path.dirname(UPLOAD_FOLDER), 'temp_covers')
    target_dirs = [UPLOAD_FOLDER, temp_covers_dir, STATIC_TEMP_DIR]

    for folder in target_dirs:
        if not os.path.exists(folder):
            continue
        try:
            for filename in os.listdir(folder):
                file_path = os.path.join(folder, filename)
                try:
                    mtime = os.path.getmtime(file_path)
                    if mtime < cutoff:
                        if os.path.isfile(file_path) or os.path.islink(file_path):
                            os.unlink(file_path)
                            print(f"[+] Cleaned up old file: {file_path}")
                        elif os.path.isdir(file_path):
                            shutil.rmtree(file_path)
                            print(f"[+] Cleaned up old directory: {file_path}")
                            sessions.pop(filename, None)
                except Exception as e:
                    print(f"[-] Failed to clean up {file_path}: {e}")
        except Exception as e:
            print(f"[-] Error listing directory {folder}: {e}")


def background_scheduler_worker():
    print("[*] Background scheduler thread started.")
    last_cleanup_time = 0

    while True:
        try:
            time.sleep(10)  # Check every 10 seconds

            now_ts = time.time()
            if now_ts - last_cleanup_time > 600:
                cleanup_old_files()
                last_cleanup_time = now_ts

            if not scheduler_config.get("enabled") or not scheduler_config.get("default_directory"):
                continue

            now = datetime.datetime.now()

            if not scheduler_status.get("next_run"):
                calculate_next_run()

            if not scheduler_status.get("next_run"):
                continue

            next_run_dt = datetime.datetime.fromisoformat(scheduler_status["next_run"])

            if now >= next_run_dt:
                run_scheduled_scan()

        except Exception as e:
            print(f"[-] Scheduler worker error: {e}")


def start_scheduler():
    load_scheduler_data()
    calculate_next_run()
    save_scheduler_data()

    t = threading.Thread(target=background_scheduler_worker, daemon=True)
    t.start()


def run_library_enhance_background(folder_path, cbz_files, comicvine_api_key, google_books_api_key, metron_user, metron_pass, lower_threshold, upper_threshold, enabled_sources, max_concurrency, scan_id):
    total_count = len(cbz_files)
    results = []
    tagged_count = 0
    remaining = total_count

    with active_scans_lock:
        scan = active_scans.get(scan_id)

    if not scan:
        return

    def worker(file_path):
        filename = os.path.basename(file_path)
        def cb(fname, src, stat, conf=0.0):
            evt_prog = {"type": "progress", "filename": fname, "source": src, "status": stat, "confidence": conf}
            with active_scans_lock:
                for q in list(scan["queues"]):
                    q.put(evt_prog)

        with active_scans_lock:
            started_count = scan["processed_count"] + 1
            current_index = started_count
        evt = {"type": "file_start", "filename": filename, "index": current_index, "total": total_count}
        log_str = f"---> Processing: {filename} ({current_index}/{total_count})"
        with active_scans_lock:
            scan["console_history"].append(log_str)
            for q in list(scan["queues"]):
                q.put(evt)

        try:
            res = enhance_single_cbz_file(
                file_path, comicvine_api_key,
                google_books_api_key=google_books_api_key,
                metron_user=metron_user, metron_pass=metron_pass,
                lower_threshold=lower_threshold, upper_threshold=upper_threshold,
                on_progress=cb,
                enabled_fields=scheduler_config.get("selected_fields"),
                enabled_sources=enabled_sources,
                force_reprocess=scan.get("force_reprocess", False)
            )
        except Exception as e:
            res = {"filename": filename, "status": "failed", "error": str(e)}

        evt_comp = {"type": "file_complete", "filename": filename, "result": res}
        status = res.get("status")
        if status == "tagged":
            log_str = f"[Success] Tagged and updated ComicInfo.xml for: {filename} ({res.get('confidence', 0)}%)"
        elif status == "skipped":
            log_str = f"[Skipped] {filename}: {res.get('reason', 'Low confidence')}"
        else:
            log_str = f"[Error] Failed to process {filename}: {res.get('error', 'Write failed')}"

        with active_scans_lock:
            scan["processed_count"] += 1
            if status == "tagged":
                scan["tagged_count"] += 1
            elif status == "skipped":
                scan["skipped_count"] += 1
            elif status == "failed":
                scan["failed_count"] += 1

            scan["console_history"].append(log_str)
            scan["completed_history"].append(res)
            for q in list(scan["queues"]):
                q.put(evt_comp)

        scan["results_queue"].put(res)

    executor = ThreadPoolExecutor(max_workers=max_concurrency)
    for fp in cbz_files:
        executor.submit(worker, fp)

    while remaining > 0:
        try:
            res = scan["results_queue"].get(timeout=1.0)
            results.append(res)
            if res.get("status") == "tagged":
                tagged_count += 1
            remaining -= 1
        except queue.Empty:
            continue

    executor.shutdown(wait=True)

    failed_count = sum(1 for r in results if r.get("status") == "failed")
    skipped_count = total_count - tagged_count - failed_count
    write_scan_log(
        scan_type="library",
        target=folder_path,
        total_files=total_count,
        tagged_count=tagged_count,
        skipped_count=skipped_count,
        failed_count=failed_count,
        results=results
    )

    evt_done = {'type': 'library_complete', 'tagged_count': tagged_count, 'total_count': total_count, 'results': results}
    log_str = "[System] Library enhancement complete!"
    with active_scans_lock:
        scan["console_history"].append(log_str)
        scan["status"] = "completed"
        for q in list(scan["queues"]):
            q.put(evt_done)
