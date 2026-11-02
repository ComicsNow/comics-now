"""Blueprint for browser UI, local file browsing, session loading, downloading, and temp cleanup."""

import os
import shutil
import hashlib
from flask import Blueprint, render_template, request, jsonify, send_file

from tagger_app.config import UPLOAD_FOLDER, STATIC_TEMP_DIR
from tagger_app.scheduler.state import scheduler_config
from tagger_app.scheduler.scanner import sessions
from tagger_app.core.enrichment import check_comic_info_completeness
from tagger_app.core.covers import extract_cover_from_cbz
from tagger_app.core.comicinfo import read_comic_info_xml

ui_bp = Blueprint('ui', __name__)


@ui_bp.route('/')
def index():
    return render_template('index.html')


@ui_bp.route('/local-files', methods=['GET'])
def get_local_files():
    """
    Scans the workspace directory recursively for any .cbz files
    and returns a list of absolute paths and relative paths.
    """
    workspace_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    cbz_files = []

    for root, dirs, files in os.walk(workspace_dir):
        dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ('uploads', 'static', 'temp_covers')]
        for file in files:
            if file.lower().endswith('.cbz'):
                abs_path = os.path.join(root, file)
                rel_path = os.path.relpath(abs_path, workspace_dir)
                cbz_files.append({
                    "path": abs_path,
                    "rel_path": rel_path,
                    "filename": file
                })

    return jsonify({"success": True, "files": cbz_files})


@ui_bp.route('/browse-files', methods=['GET'])
def browse_files():
    """
    Returns lists of subdirectories and .cbz files in the requested path
    to support active filesystem browsing on the host.
    """
    workspace_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    if scheduler_config.get("default_directory") and os.path.exists(scheduler_config["default_directory"]):
        default_dir = scheduler_config["default_directory"]
    else:
        default_dir = os.path.expanduser("~") if os.path.exists(os.path.expanduser("~")) else workspace_dir

    path = request.args.get("path", default_dir)
    path = os.path.abspath(path)

    if not os.path.exists(path) or not os.path.isdir(path):
        path = default_dir

    try:
        subdirs = []
        cbz_files = []

        for item in sorted(os.listdir(path)):
            item_path = os.path.join(path, item)

            if item.startswith('.'):
                continue

            if os.path.isdir(item_path):
                if os.access(item_path, os.R_OK):
                    subdirs.append({
                        "name": item,
                        "path": item_path
                    })
            elif os.path.isfile(item_path) and item.lower().endswith('.cbz'):
                is_incomplete, reason = check_comic_info_completeness(item_path)
                cbz_files.append({
                    "name": item,
                    "path": item_path,
                    "size_mb": round(os.path.getsize(item_path) / (1024 * 1024), 2),
                    "is_incomplete": is_incomplete,
                    "incomplete_reason": reason
                })

        parent_path = os.path.dirname(path)
        if parent_path == path:
            parent_path = None

        return jsonify({
            "success": True,
            "current_path": path,
            "parent_path": parent_path,
            "subdirs": subdirs,
            "cbz_files": cbz_files
        })
    except Exception as e:
        print(f"[-] Error reading directory: {e}")
        return jsonify({"error": "Failed to read directory"}), 500


@ui_bp.route('/load-local', methods=['POST'])
def load_local_file():
    """Loads a CBZ file already present on the server without uploading it."""
    data = request.json or {}
    file_path = data.get("file_path")

    if not file_path or not os.path.exists(file_path):
        return jsonify({"error": "Selected file does not exist on the server."}), 400

    if not file_path.lower().endswith('.cbz'):
        return jsonify({"error": "Only .cbz files are supported."}), 400

    filename = os.path.basename(file_path)
    session_id = hashlib.md5(file_path.encode('utf-8')).hexdigest()
    session_dir = os.path.join(UPLOAD_FOLDER, session_id)
    os.makedirs(session_dir, exist_ok=True)

    sessions[session_id] = {
        "cbz_path": file_path,
        "filename": filename,
        "session_dir": session_dir,
        "is_local": True
    }

    cover_exists = False
    expected_cover_path = os.path.join(session_dir, f"cover_{filename}.jpg")

    try:
        static_cover_filename = f"cover_{session_id}.jpg"
        static_cover_path = os.path.join(STATIC_TEMP_DIR, static_cover_filename)

        if os.path.exists(expected_cover_path):
            try:
                if os.path.getmtime(expected_cover_path) >= os.path.getmtime(file_path):
                    cover_exists = True
            except Exception:
                pass

        if cover_exists:
            extracted_cover_path = expected_cover_path
        else:
            extracted_cover_path = extract_cover_from_cbz(file_path, output_dir=session_dir)

        static_exists = False
        if os.path.exists(static_cover_path):
            try:
                if os.path.getmtime(static_cover_path) >= os.path.getmtime(extracted_cover_path):
                    static_exists = True
            except Exception:
                pass

        if not static_exists:
            shutil.copy(extracted_cover_path, static_cover_path)

        existing_meta = read_comic_info_xml(file_path)

        return jsonify({
            "success": True,
            "session_id": session_id,
            "filename": filename,
            "cover_url": f"/static/temp/{static_cover_filename}",
            "existing_metadata": existing_meta
        })
    except Exception as e:
        print(f"[-] Error extracting cover: {e}")
        if not cover_exists:
            shutil.rmtree(session_dir, ignore_errors=True)
        return jsonify({"error": "Failed to extract cover"}), 500


@ui_bp.route('/download/<session_id>', methods=['GET'])
def download_file(session_id):
    """Sends the fully tagged CBZ file to the browser."""
    if not session_id or session_id not in sessions:
        return "Session not found or expired", 404

    session_info = sessions[session_id]
    cbz_path = session_info["cbz_path"]
    filename = session_info["filename"]

    return send_file(
        cbz_path,
        as_attachment=True,
        download_name=f"tagged_{filename}",
        mimetype="application/x-cbz"
    )


@ui_bp.route('/cleanup', methods=['POST'])
def cleanup_temp():
    """Purge upload and static temp files."""
    try:
        for folder in [UPLOAD_FOLDER, STATIC_TEMP_DIR]:
            if not os.path.exists(folder):
                continue
            for filename in os.listdir(folder):
                file_path = os.path.join(folder, filename)
                try:
                    if os.path.isfile(file_path) or os.path.islink(file_path):
                        os.unlink(file_path)
                    elif os.path.isdir(file_path):
                        shutil.rmtree(file_path)
                except Exception:
                    pass
        sessions.clear()
        return jsonify({"success": True})
    except Exception as e:
        print(f"[-] Cleanup error: {e}")
        return jsonify({"error": "Cleanup failed"}), 500
