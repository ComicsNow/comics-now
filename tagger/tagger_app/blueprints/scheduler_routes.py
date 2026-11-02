"""Blueprint for scheduled scans and library enhancement streaming endpoints."""

import os
import json
import queue
import threading
from collections import deque
from flask import Blueprint, request, jsonify, Response

from tagger_app.scheduler.state import (
    scheduler_config,
    scheduler_status,
    save_scheduler_data,
    calculate_next_run,
)
from tagger_app.scheduler.scanner import (
    run_scheduled_scan,
    run_library_enhance_background,
    active_scans,
    active_scans_lock,
)

scheduler_bp = Blueprint('scheduler', __name__)


@scheduler_bp.route('/scheduler-info', methods=['GET'])
def get_scheduler_info():
    return jsonify({
        "success": True,
        "config": scheduler_config,
        "status": scheduler_status
    })


@scheduler_bp.route('/scheduler-update', methods=['POST'])
def update_scheduler():
    data = request.json or {}

    # Update config keys
    scheduler_config["default_directory"] = data.get("default_directory", "").strip()
    scheduler_config["interval_value"] = int(data.get("interval_value", 1))
    scheduler_config["interval_unit"] = data.get("interval_unit", "day")
    scheduler_config["enabled"] = bool(data.get("enabled", False))
    scheduler_config["comicvine_api_key"] = data.get("comicvine_api_key", "").strip()
    scheduler_config["google_books_api_key"] = data.get("google_books_api_key", "").strip()
    scheduler_config["metron_user"] = data.get("metron_user", "").strip()
    scheduler_config["metron_pass"] = data.get("metron_pass", "").strip()
    scheduler_config["confidence_threshold"] = float(data.get("confidence_threshold", 0.9))
    scheduler_config["lower_threshold"] = float(data.get("lower_threshold", 0.80))
    scheduler_config["upper_threshold"] = float(data.get("upper_threshold", 0.90))
    if "selected_fields" in data:
        scheduler_config["selected_fields"] = list(data.get("selected_fields", []))
    if "batch_concurrency" in data:
        scheduler_config["batch_concurrency"] = int(data.get("batch_concurrency", 4))
    if "enabled_sources" in data:
        scheduler_config["enabled_sources"] = list(data.get("enabled_sources", []))
    if "force_reprocess" in data:
        scheduler_config["force_reprocess"] = bool(data.get("force_reprocess", False))

    calculate_next_run()
    save_scheduler_data()

    return jsonify({
        "success": True,
        "message": "Scheduler settings updated successfully.",
        "config": scheduler_config,
        "status": scheduler_status
    })


@scheduler_bp.route('/scheduler-trigger', methods=['POST'])
def trigger_scheduler_scan():
    if scheduler_status["is_running"]:
        return jsonify({"error": "A scheduled scan is already running."}), 400

    threading.Thread(target=run_scheduled_scan, daemon=True).start()
    return jsonify({
        "success": True,
        "message": "Scheduled scan started manually in the background."
    })


@scheduler_bp.route('/library-enhance', methods=['POST'])
@scheduler_bp.route('/api/library/enhance', methods=['POST'])
def library_enhance_folder():
    """
    Recursively scans a folder for CBZ files, looks up metadata from online sources,
    merges missing fields, and streams progress in real-time.
    """
    data = request.json or {}
    folder_path = data.get("folder_path")
    comicvine_api_key = data.get("comicvine_api_key")
    google_books_api_key = data.get("google_books_api_key")
    metron_user = data.get("metron_user")
    metron_pass = data.get("metron_pass")
    lower_threshold = float(data.get("lower_threshold", 0.80))
    upper_threshold = float(data.get("upper_threshold", 0.90))

    enabled_sources = data.get("enabled_sources") or scheduler_config.get("enabled_sources")
    force_reprocess = bool(data.get("force_reprocess", scheduler_config.get("force_reprocess", False)))

    if not folder_path or not os.path.exists(folder_path) or not os.path.isdir(folder_path):
        return jsonify({"error": "Selected folder does not exist on the server."}), 400

    try:
        cbz_files = []
        for root_dir, dirs, files in os.walk(folder_path):
            for file in files:
                if file.lower().endswith('.cbz'):
                    cbz_files.append(os.path.join(root_dir, file))
        cbz_files.sort()

        if not cbz_files:
            return jsonify({
                "success": True,
                "tagged_count": 0,
                "total_count": 0,
                "results": [],
                "message": "No CBZ files found in the selected folder."
            })

        scan_id = folder_path

        with active_scans_lock:
            scan = active_scans.get(scan_id)
            if not scan or scan["status"] != "running":
                scan = {
                    "console_history": deque(maxlen=100),
                    "completed_history": deque(maxlen=100),
                    "queues": set(),
                    "results_queue": queue.Queue(),
                    "status": "running",
                    "force_reprocess": force_reprocess,
                    "total_count": len(cbz_files),
                    "processed_count": 0,
                    "tagged_count": 0,
                    "skipped_count": 0,
                    "failed_count": 0
                }
                scan["console_history"].append("[System] Starting Library Enhancement scan...")
                scan["console_history"].append(f"[System] Folder: {folder_path}")
                active_scans[scan_id] = scan

                max_concurrency = max(1, int(data.get("batch_concurrency", scheduler_config.get("batch_concurrency", 4))))
                t = threading.Thread(
                    target=run_library_enhance_background,
                    args=(folder_path, cbz_files, comicvine_api_key, google_books_api_key, metron_user, metron_pass, lower_threshold, upper_threshold, enabled_sources, max_concurrency, scan_id),
                    daemon=True
                )
                t.start()

        q = queue.Queue()
        with active_scans_lock:
            evt_snapshot = {
                "type": "snapshot",
                "total_count": scan["total_count"],
                "processed_count": scan["processed_count"],
                "tagged_count": scan["tagged_count"],
                "skipped_count": scan["skipped_count"],
                "failed_count": scan["failed_count"],
                "console_history": list(scan["console_history"]),
                "completed_history": list(scan["completed_history"])
            }
            scan["queues"].add(q)

        def generate():
            yield f"data: {json.dumps(evt_snapshot)}\n\n"
            while True:
                try:
                    item = q.get(timeout=2.0)
                    yield f"data: {json.dumps(item)}\n\n"
                    if item.get("type") == "library_complete":
                        break
                except queue.Empty:
                    yield ": keepalive\n\n"
                except GeneratorExit:
                    with active_scans_lock:
                        if scan_id in active_scans:
                            active_scans[scan_id]["queues"].discard(q)
                    break

        return Response(generate(), mimetype='text/event-stream')
    except Exception as e:
        print(f"[-] Library enhance error: {e}")
        return jsonify({"error": "Library enhance initialization failed"}), 500


@scheduler_bp.route('/api/active-scan', methods=['GET'])
def get_active_scan():
    with active_scans_lock:
        for scan_id, scan in active_scans.items():
            if scan.get("status") == "running":
                return jsonify({
                    "active": True,
                    "folder_path": scan_id,
                    "status": "running",
                    "total_count": scan.get("total_count", 0),
                    "processed_count": scan.get("processed_count", 0),
                    "tagged_count": scan.get("tagged_count", 0),
                    "skipped_count": scan.get("skipped_count", 0),
                    "failed_count": scan.get("failed_count", 0),
                    "console_history": list(scan["console_history"]),
                    "completed_history": list(scan["completed_history"])
                })
    return jsonify({"active": False})
