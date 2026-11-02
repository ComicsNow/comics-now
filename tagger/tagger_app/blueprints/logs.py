"""Blueprint for log inspection, deletion, and tracking history reset."""

import os
import re
import json
import sqlite3
from flask import Blueprint, jsonify
from werkzeug.utils import secure_filename

from tagger_app.config import LOGS_DIR, DB_TRACKING_PATH
from tagger_app.scheduler.state import scheduler_config, save_scheduler_data

logs_bp = Blueprint('logs', __name__)


@logs_bp.route('/api/logs', methods=['GET'])
def get_logs():
    logs = []
    if os.path.exists(LOGS_DIR):
        for f in os.listdir(LOGS_DIR):
            if f.startswith("scan_log_") and f.endswith(".json"):
                path = os.path.join(LOGS_DIR, f)
                try:
                    with open(path, 'r') as file_obj:
                        data = json.load(file_obj)
                        log_meta = {
                            "id": data.get("id"),
                            "timestamp": data.get("timestamp"),
                            "type": data.get("type"),
                            "target": data.get("target"),
                            "total_files": data.get("total_files"),
                            "tagged_count": data.get("tagged_count"),
                            "skipped_count": data.get("skipped_count"),
                            "failed_count": data.get("failed_count"),
                            "filename": f
                        }
                        logs.append(log_meta)
                except Exception as e:
                    print(f"[-] Error reading log file {f}: {e}")
    logs.sort(key=lambda x: x["timestamp"], reverse=True)
    return jsonify({"success": True, "logs": logs})


@logs_bp.route('/api/logs/<log_id>', methods=['GET'])
def get_log_detail(log_id):
    if not re.match(r'^[a-zA-Z0-9_\-]+$', log_id):
        return jsonify({"error": "Invalid log identifier"}), 400
    safe_filename = secure_filename(f"scan_log_{log_id}.json")
    resolved_logs_dir = os.path.abspath(LOGS_DIR)
    path = os.path.abspath(os.path.join(resolved_logs_dir, safe_filename))
    if not path.startswith(resolved_logs_dir + os.sep):
        return jsonify({"error": "Access denied"}), 403
    if not os.path.exists(path):
        return jsonify({"error": "Log not found"}), 404
    try:
        with open(path, 'r') as file_obj:
            data = json.load(file_obj)
        return jsonify({"success": True, "log": data})
    except Exception as e:
        print(f"[-] Error reading log {log_id}: {e}")
        return jsonify({"error": "Failed to read log"}), 500


@logs_bp.route('/api/logs/<log_id>', methods=['DELETE'])
def delete_log(log_id):
    if not re.match(r'^[a-zA-Z0-9_\-]+$', log_id):
        return jsonify({"error": "Invalid log identifier"}), 400
    safe_filename = secure_filename(f"scan_log_{log_id}.json")
    resolved_logs_dir = os.path.abspath(LOGS_DIR)
    path = os.path.abspath(os.path.join(resolved_logs_dir, safe_filename))
    if not path.startswith(resolved_logs_dir + os.sep):
        return jsonify({"error": "Access denied"}), 403
    if not os.path.exists(path):
        return jsonify({"error": "Log not found"}), 404
    try:
        os.remove(path)
        return jsonify({"success": True, "message": "Log deleted successfully"})
    except Exception as e:
        print(f"[-] Error deleting log {log_id}: {e}")
        return jsonify({"error": "Failed to delete log"}), 500


@logs_bp.route('/api/logs', methods=['DELETE'])
def clear_all_logs():
    try:
        deleted_count = 0
        if os.path.exists(LOGS_DIR):
            for f in os.listdir(LOGS_DIR):
                if f.startswith("scan_log_") and f.endswith(".json"):
                    os.remove(os.path.join(LOGS_DIR, f))
                    deleted_count += 1
        return jsonify({"success": True, "message": f"Successfully deleted {deleted_count} logs"})
    except Exception as e:
        print(f"[-] Error clearing logs: {e}")
        return jsonify({"error": "Failed to clear logs"}), 500


@logs_bp.route('/api/enhanced-comics/clear', methods=['POST'])
def clear_enhanced_comics():
    try:
        conn = sqlite3.connect(DB_TRACKING_PATH)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM enhanced_comics")
        conn.commit()
        conn.close()

        scheduler_config["legacy_xml_fallback"] = False
        save_scheduler_data()

        return jsonify({"success": True, "message": "Successfully cleared all enhanced comics from tracking database and disabled legacy XML fallback."})
    except Exception as e:
        print(f"[-] Error clearing tracking DB: {e}")
        return jsonify({"error": "Failed to clear tracking database"}), 500
