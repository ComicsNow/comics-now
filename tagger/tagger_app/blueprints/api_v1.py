"""Blueprint for REST API v1 endpoints (tagging, streaming, metadata search, health)."""

import os
import sys
import json
import queue
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from flask import Blueprint, request, jsonify, Response

from tagger_app.scheduler.state import scheduler_config, scheduler_status
from tagger_app.persistence.scan_logs import write_scan_log
from tagger_app.persistence.tracking_db import mark_as_enhanced
from tagger_app.core.comicinfo import generate_comic_info_xml, write_comic_info
from tagger_app.core.tagger import process_single_cbz_file

from tagger_app.core.metadata import normalize_metadata
from tagger_app.sources.comicvine import search_comicvine_multi
from tagger_app.sources.gcd import search_gcd_multi
from tagger_app.sources.lcg import search_lcg_multi
from tagger_app.sources.metron import search_metron_multi
from tagger_app.sources.goodreads import search_goodreads_multi
from tagger_app.sources.blackwells import search_blackwells_multi
from tagger_app.sources.waterstones import search_waterstones_multi
from tagger_app.sources.googlebooks import search_googlebooks_multi
from tagger_app.sources.amazon import search_amazon_multi
from tagger_app.sources.forbiddenplanet import search_forbiddenplanet_multi

api_v1_bp = Blueprint('api_v1', __name__)


def _get_search_func(name, default_func):
    """Retrieve search function from app module if monkeypatched, else default."""
    app_mod = sys.modules.get('app')
    if app_mod and hasattr(app_mod, name):
        return getattr(app_mod, name)
    return default_func


@api_v1_bp.route('/api/health', methods=['GET'])
def api_health():
    return jsonify({"status": "ok", "version": "1.0"})


@api_v1_bp.route('/api/homepage', methods=['GET'])
def homepage_widget():
    """Returns a JSON object compatible with the 'Homepage' dashboard custom widget."""
    history = scheduler_status.get("history", [])
    total_tagged = sum(h.get("tagged_count", 0) for h in history)

    status_text = "Idle"
    if scheduler_status.get("is_running"):
        status_text = "Scanning..."
    elif scheduler_config.get("enabled"):
        status_text = "Scheduled"

    return jsonify([
        {"label": "Status", "value": status_text},
        {"label": "Total Tagged", "value": total_tagged},
        {"label": "History", "value": len(history)}
    ])


@api_v1_bp.route('/api/tag-file', methods=['POST'])
def api_tag_file():
    data = request.json or {}
    file_path = data.get("path")
    if not file_path or not os.path.exists(file_path):
        return jsonify({"error": "Selected file does not exist."}), 400

    try:
        comicvine_api_key = data.get("comicvine_api_key") or scheduler_config.get("comicvine_api_key")
        google_books_api_key = data.get("google_books_api_key") or scheduler_config.get("google_books_api_key")
        metron_user = data.get("metron_user") or scheduler_config.get("metron_user")
        metron_pass = data.get("metron_pass") or scheduler_config.get("metron_pass")
        lower_threshold = float(data.get("lower_threshold") or scheduler_config.get("lower_threshold", 0.80))
        upper_threshold = float(data.get("upper_threshold") or scheduler_config.get("upper_threshold", 0.90))
        enabled_sources = data.get("enabled_sources") or scheduler_config.get("enabled_sources")
        force_reprocess = bool(data.get("force_reprocess", scheduler_config.get("force_reprocess", False)))
        metadata_storage = data.get("metadata_storage") or scheduler_config.get("metadata_storage", "archive")
        publisher_codex = data.get("publisher_codex")
        cover_path = data.get("cover_path")

        res = process_single_cbz_file(
            file_path=file_path,
            comicvine_api_key=comicvine_api_key,
            google_books_api_key=google_books_api_key,
            metron_user=metron_user,
            metron_pass=metron_pass,
            lower_threshold=lower_threshold,
            upper_threshold=upper_threshold,
            enabled_fields=scheduler_config.get("selected_fields"),
            enabled_sources=enabled_sources,
            force_reprocess=force_reprocess,
            metadata_storage=metadata_storage,
            publisher_codex=publisher_codex,
            cover_path=cover_path
        )

        write_scan_log(
            scan_type="single",
            target=file_path,
            total_files=1,
            tagged_count=1 if res.get("status") == "tagged" else 0,
            skipped_count=1 if res.get("status") in ["skipped", "review"] else 0,
            failed_count=1 if res.get("status") == "failed" else 0,
            results=[res]
        )

        return jsonify(res)
    except Exception as e:
        print(f"[-] Error tagging file: {e}")
        return jsonify({"error": "File tagging failed"}), 500


@api_v1_bp.route('/api/tag-file-stream', methods=['POST'])
def api_tag_file_stream():
    data = request.json or {}
    file_path = data.get("path")
    if not file_path or not os.path.exists(file_path):
        return jsonify({"error": "Selected file does not exist."}), 400

    def generate():
        event_q = queue.Queue()

        def prog_cb(filename, source, msg, score=None):
            try:
                event_q.put({"type": "progress", "source": source, "message": msg, "score": score})
            except Exception:
                pass

        worker_res = {}
        worker_err = {}

        def run_worker():
            try:
                comicvine_api_key = data.get("comicvine_api_key") or scheduler_config.get("comicvine_api_key")
                google_books_api_key = data.get("google_books_api_key") or scheduler_config.get("google_books_api_key")
                metron_user = data.get("metron_user") or scheduler_config.get("metron_user")
                metron_pass = data.get("metron_pass") or scheduler_config.get("metron_pass")
                lower_threshold = float(data.get("lower_threshold") or scheduler_config.get("lower_threshold", 0.80))
                upper_threshold = float(data.get("upper_threshold") or scheduler_config.get("upper_threshold", 0.90))
                enabled_sources = data.get("enabled_sources") or scheduler_config.get("enabled_sources")
                force_reprocess = bool(data.get("force_reprocess", scheduler_config.get("force_reprocess", False)))
                metadata_storage = data.get("metadata_storage") or scheduler_config.get("metadata_storage", "archive")
                publisher_codex = data.get("publisher_codex")
                cover_path = data.get("cover_path")

                res = process_single_cbz_file(
                    file_path=file_path,
                    comicvine_api_key=comicvine_api_key,
                    google_books_api_key=google_books_api_key,
                    metron_user=metron_user,
                    metron_pass=metron_pass,
                    lower_threshold=lower_threshold,
                    upper_threshold=upper_threshold,
                    on_progress=prog_cb,
                    enabled_fields=scheduler_config.get("selected_fields"),
                    enabled_sources=enabled_sources,
                    force_reprocess=force_reprocess,
                    metadata_storage=metadata_storage,
                    publisher_codex=publisher_codex,
                    cover_path=cover_path
                )
                worker_res["result"] = res

                write_scan_log(
                    scan_type="single",
                    target=file_path,
                    total_files=1,
                    tagged_count=1 if res.get("status") == "tagged" else 0,
                    skipped_count=1 if res.get("status") in ["skipped", "review"] else 0,
                    failed_count=1 if res.get("status") == "failed" else 0,
                    results=[res]
                )
            except Exception as e:
                worker_err["error"] = str(e)
            finally:
                event_q.put({"type": "done"})

        worker_thread = threading.Thread(target=run_worker, daemon=True)
        worker_thread.start()

        while True:
            try:
                ev = event_q.get(timeout=0.4)
                if ev.get("type") == "done":
                    break
                yield f"data: {json.dumps(ev)}\n\n"
            except queue.Empty:
                if not worker_thread.is_alive() and event_q.empty():
                    break
                yield ": keepalive\n\n"

        worker_thread.join(timeout=5.0)

        if "error" in worker_err:
            yield f"data: {json.dumps({'type': 'error', 'error': worker_err['error']})}\n\n"
        elif "result" in worker_res:
            yield f"data: {json.dumps({'type': 'result', 'data': worker_res['result']})}\n\n"

    return Response(generate(), mimetype='text/event-stream')


@api_v1_bp.route('/api/apply-tag', methods=['POST'])
def api_apply_tag():
    data = request.json or {}
    file_path = data.get("path")
    metadata = data.get("metadata")
    if not file_path or not os.path.exists(file_path):
        return jsonify({"error": "Selected file does not exist."}), 400
    if not metadata:
        return jsonify({"error": "Metadata is required."}), 400

    metadata_storage = data.get("metadata_storage") or scheduler_config.get("metadata_storage", "archive")
    try:
        xml_str = generate_comic_info_xml(metadata, enabled_fields=scheduler_config.get("selected_fields"))
        write_comic_info(file_path, xml_str, metadata_storage)
        mark_as_enhanced(file_path, [metadata.get("source_url") or "Unknown"])
        return jsonify({"success": True})
    except Exception as e:
        print(f"[-] Error applying tag: {e}")
        return jsonify({"error": "Failed to apply tag"}), 500


def _append_results(dest, items, src_name):
    for item in (items or []):
        if isinstance(item, dict):
            item.setdefault("source", src_name)
            dest.append(item)


@api_v1_bp.route('/api/search', methods=['POST'])
def api_search_external():
    data = request.json or {}
    source = data.get("source", "").lower()
    query = data.get("query", "").strip()
    if not source or not query:
        return jsonify({"error": "source and query are required."}), 400

    _fn_cv = _get_search_func("search_comicvine_multi", search_comicvine_multi)
    _fn_gcd = _get_search_func("search_gcd_multi", search_gcd_multi)
    _fn_lcg = _get_search_func("search_lcg_multi", search_lcg_multi)
    _fn_metron = _get_search_func("search_metron_multi", search_metron_multi)
    _fn_goodreads = _get_search_func("search_goodreads_multi", search_goodreads_multi)
    _fn_blackwells = _get_search_func("search_blackwells_multi", search_blackwells_multi)
    _fn_waterstones = _get_search_func("search_waterstones_multi", search_waterstones_multi)
    _fn_googlebooks = _get_search_func("search_googlebooks_multi", search_googlebooks_multi)
    _fn_amazon = _get_search_func("search_amazon_multi", search_amazon_multi)
    _fn_forbiddenplanet = _get_search_func("search_forbiddenplanet_multi", search_forbiddenplanet_multi)

    try:
        results = []
        if source == "all":
            cv_key = data.get("comicvine_api_key") or scheduler_config.get("comicvine_api_key")
            metron_user = data.get("metron_user") or scheduler_config.get("metron_user")
            metron_pass = data.get("metron_pass") or scheduler_config.get("metron_pass")
            gcd_user = data.get("gcd_user") or scheduler_config.get("gcd_user")
            gcd_pass = data.get("gcd_pass") or scheduler_config.get("gcd_pass")

            def _run_gcd():
                try:
                    return _fn_gcd(query, gcd_user=gcd_user, gcd_pass=gcd_pass, comicvine_api_key=cv_key, metron_user=metron_user, metron_pass=metron_pass)
                except TypeError:
                    try:
                        return _fn_gcd(query, comicvine_api_key=cv_key, metron_user=metron_user, metron_pass=metron_pass)
                    except TypeError:
                        return _fn_gcd(query)

            sources_to_run = [
                ("gcd", _run_gcd),
                ("lcg", lambda: _fn_lcg(query)),
                ("forbiddenplanet", lambda: _fn_forbiddenplanet(query)),
                ("googlebooks", lambda: _fn_googlebooks(query, api_key=data.get("google_books_api_key") or scheduler_config.get("google_books_api_key"))),
                ("goodreads", lambda: _fn_goodreads(query)),
                ("blackwells", lambda: _fn_blackwells(query)),
                ("waterstones", lambda: _fn_waterstones(query)),
                ("amazon", lambda: _fn_amazon(query)),
            ]

            if cv_key:
                sources_to_run.append(("comicvine", lambda: _fn_cv(query, cv_key)))

            if metron_user and metron_pass:
                sources_to_run.append(("metron", lambda: _fn_metron(query, metron_user, metron_pass)))

            with ThreadPoolExecutor(max_workers=min(len(sources_to_run), 8)) as executor:
                future_to_src = {executor.submit(fn): src_name for src_name, fn in sources_to_run}
                for future in as_completed(future_to_src):
                    src_name = future_to_src[future]
                    try:
                        res = future.result()
                        _append_results(results, res, src_name)
                    except Exception as exc:
                        print(f"[-] Search source '{src_name}' error: {exc}")

        elif source == "comicvine":
            api_key = data.get("comicvine_api_key") or scheduler_config.get("comicvine_api_key")
            if not api_key:
                return jsonify({"error": "ComicVine API key not set"}), 400
            _append_results(results, _fn_cv(query, api_key), "comicvine")

        elif source == "gcd":
            cv_key = data.get("comicvine_api_key") or scheduler_config.get("comicvine_api_key")
            metron_user = data.get("metron_user") or scheduler_config.get("metron_user")
            metron_pass = data.get("metron_pass") or scheduler_config.get("metron_pass")
            gcd_user = data.get("gcd_user") or scheduler_config.get("gcd_user")
            gcd_pass = data.get("gcd_pass") or scheduler_config.get("gcd_pass")
            try:
                res = _fn_gcd(query, gcd_user=gcd_user, gcd_pass=gcd_pass, comicvine_api_key=cv_key, metron_user=metron_user, metron_pass=metron_pass)
            except TypeError:
                try:
                    res = _fn_gcd(query, comicvine_api_key=cv_key, metron_user=metron_user, metron_pass=metron_pass)
                except TypeError:
                    res = _fn_gcd(query)
            _append_results(results, res, "gcd")

        elif source == "lcg":
            _append_results(results, _fn_lcg(query), "lcg")

        elif source == "metron":
            user = data.get("metron_user") or scheduler_config.get("metron_user")
            pwd = data.get("metron_pass") or scheduler_config.get("metron_pass")
            _append_results(results, _fn_metron(query, user, pwd, year=data.get("year")), "metron")

        elif source == "goodreads":
            _append_results(results, _fn_goodreads(query), "goodreads")

        elif source == "blackwells":
            _append_results(results, _fn_blackwells(query), "blackwells")

        elif source == "waterstones":
            _append_results(results, _fn_waterstones(query), "waterstones")

        elif source in ("googlebooks", "google_books", "google-books"):
            api_key = data.get("google_books_api_key") or scheduler_config.get("google_books_api_key")
            _append_results(results, _fn_googlebooks(query, api_key=api_key), "googlebooks")

        elif source in ("amazon", "src-amazon", "amz"):
            _append_results(results, _fn_amazon(query), "amazon")

        elif source in ("forbiddenplanet", "src-forbiddenplanet", "fp"):
            _append_results(results, _fn_forbiddenplanet(query), "forbiddenplanet")
        else:
            return jsonify({"error": f"Unsupported search source: {source}"}), 400

        publisher_codex = data.get("publisher_codex")
        normalized = []
        for r in results:
            if r:
                src = r.get("source") or source
                norm = normalize_metadata(r, codex=publisher_codex)
                norm["source"] = src
                normalized.append(norm)

        return jsonify(normalized)
    except Exception as e:
        print(f"[-] Search error: {e}")
        return jsonify({"error": "Search failed"}), 500
