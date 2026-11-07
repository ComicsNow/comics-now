"""Blueprint for interactive web UI search, manual tagging, and folder batch-tagging."""

import os
import json
import queue
import threading
from concurrent.futures import ThreadPoolExecutor
from flask import Blueprint, request, jsonify, Response

from tagger_app.scheduler.state import scheduler_config
from tagger_app.scheduler.scanner import sessions
from tagger_app.sources.registry import SOURCES
from tagger_app.core.metadata import normalize_metadata
from tagger_app.core.enrichment import (
    query_all_sources_sequentially,
    enrich_metadata_from_other_sources,
)
from tagger_app.core.comicinfo import (
    generate_comic_info_xml,
    write_comic_info_to_cbz,
)
from tagger_app.persistence.tracking_db import mark_as_enhanced
from tagger_app.persistence.scan_logs import write_scan_log
from tagger_app.core.tagger import process_single_cbz_file
from tagger_app.continuity.enricher import enrich_with_continuity

manual_tagger_bp = Blueprint('manual_tagger', __name__)


@manual_tagger_bp.route('/search', methods=['POST'])
def search_metadata():
    """
    Performs search on the cover of the given session ID
    and returns parsed metadata as a Server-Sent Events stream.
    """
    data = request.json or {}
    session_id = data.get("session_id")
    comicvine_api_key = data.get("comicvine_api_key")
    google_books_api_key = data.get("google_books_api_key")
    metron_user = data.get("metron_user")
    metron_pass = data.get("metron_pass")
    lower_threshold = float(data.get("lower_threshold", 0.80))
    upper_threshold = float(data.get("upper_threshold", 0.90))
    enabled_sources = data.get("enabled_sources") or scheduler_config.get("enabled_sources")

    if not session_id or session_id not in sessions:
        return jsonify({"error": "Invalid or expired session ID"}), 400

    session_info = sessions[session_id]

    def generate():
        def push_progress(message, step):
            return f"data: {json.dumps({'type': 'progress', 'message': message, 'step': step})}\n\n"

        try:
            active_labels = [s.label for s in SOURCES if s.is_enabled(enabled_sources)]
            yield push_progress(f"Searching {', '.join(active_labels)}...", 2)

            cover_path = os.path.join(session_info["session_dir"], f"cover_{session_info['filename']}.jpg")
            if not os.path.exists(cover_path):
                cover_path = None
                for _f in os.listdir(session_info["session_dir"]):
                    if _f.startswith("cover_") and _f.endswith(".jpg"):
                        cover_path = os.path.join(session_info["session_dir"], _f)
                        break

            resolved = query_all_sources_sequentially(
                session_info["filename"],
                cover_path=cover_path,
                comicvine_api_key=comicvine_api_key,
                google_books_api_key=google_books_api_key,
                metron_user=metron_user,
                metron_pass=metron_pass,
                enabled_sources=enabled_sources,
                on_progress=None
            )
            raw_candidates = [(m, s, u) for (m, s, u) in resolved if s >= lower_threshold]
            for meta, score, src in raw_candidates:
                yield push_progress(f"Match: {meta.get('title')} ({round(score*100,1)}%)", 3)
            if not raw_candidates:
                yield f"data: {json.dumps({'type': 'error', 'error': f'No matches found above the lower threshold of {int(lower_threshold*100)}%.'})}\n\n"
                return

            seen_urls = set()
            unique_candidates = []
            for meta, score, matching_url in raw_candidates:
                meta = normalize_metadata(meta)
                url = matching_url or meta.get("source_url") or ""
                meta["source_url"] = url
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    meta["confidence_score"] = round(score * 100, 1)
                    meta["is_high_confidence"] = score >= upper_threshold
                    meta["auto_tagged"] = False
                    unique_candidates.append({
                        "metadata": meta,
                        "score": round(score * 100, 1),
                        "matching_url": url
                    })

            unique_candidates.sort(key=lambda x: x["score"], reverse=True)

            if unique_candidates:
                cbz_p = session_info.get("cbz_path", "")
                for i in range(len(unique_candidates)):
                    cand_meta = unique_candidates[i]["metadata"]
                    cand_meta = enrich_metadata_from_other_sources(cand_meta, unique_candidates, lower_threshold)
                    enrich_with_continuity(cand_meta, cbz_p, cover_path=cover_path)
                    unique_candidates[i]["metadata"] = cand_meta

                best_candidate = unique_candidates[0]
                best_meta = best_candidate["metadata"]
                best_score = best_candidate["score"]
                matching_url = best_candidate["matching_url"]

                if best_score >= (upper_threshold * 100):
                    try:
                        yield push_progress(f"High confidence match ({best_score}%) detected (>= {int(upper_threshold*100)}%). Writing ComicInfo.xml...", 4)
                        xml_str = generate_comic_info_xml(best_meta, enabled_fields=scheduler_config.get("selected_fields"))
                        write_comic_info_to_cbz(session_info["cbz_path"], xml_str)
                        mark_as_enhanced(session_info["cbz_path"], [matching_url])
                        best_meta["auto_tagged"] = True
                        yield push_progress("Successfully auto-tagged comic!", 4)
                    except Exception as auto_err:
                        print(f"[-] Auto-tagging failed: {auto_err}")
                        yield push_progress(f"Auto-tagging failed: {str(auto_err)}", 4)

                yield f"data: {json.dumps({'type': 'result', 'metadata': best_meta, 'matching_url': matching_url, 'candidates': unique_candidates})}\n\n"
            else:
                yield f"data: {json.dumps({'type': 'error', 'error': f'No matching metadata found above the lower threshold of {int(lower_threshold * 100)}%.'})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': f'Search failed: {str(e)}'})}\n\n"

    return Response(generate(), mimetype='text/event-stream')


@manual_tagger_bp.route('/tag', methods=['POST'])
def tag_comic():
    """Receives edited metadata, writes ComicInfo.xml, injects it back to CBZ."""
    data = request.json or {}
    session_id = data.get("session_id")
    edited_metadata = data.get("metadata")

    if not session_id or session_id not in sessions:
        return jsonify({"error": "Invalid or expired session ID"}), 400

    if not edited_metadata:
        return jsonify({"error": "Metadata is required"}), 400

    session_info = sessions[session_id]
    cbz_path = session_info["cbz_path"]
    is_local = session_info.get("is_local", False)

    try:
        if not edited_metadata.get("story_arc"):
            enrich_with_continuity(edited_metadata, cbz_path)
        xml_str = generate_comic_info_xml(edited_metadata, enabled_fields=scheduler_config.get("selected_fields"))
        write_comic_info_to_cbz(cbz_path, xml_str)
        mark_as_enhanced(cbz_path, [edited_metadata.get("source_url") or "Unknown"])

        write_scan_log(
            scan_type="single",
            target=cbz_path,
            total_files=1,
            tagged_count=1,
            skipped_count=0,
            failed_count=0,
            results=[{
                "filename": os.path.basename(cbz_path),
                "filepath": cbz_path,
                "status": "tagged",
                "confidence": float(edited_metadata.get("confidence_score") or 100.0),
                "source": edited_metadata.get("source_url") or "Manual",
                "metadata": edited_metadata
            }]
        )

        return jsonify({
            "success": True,
            "is_local": is_local,
            "file_path": cbz_path if is_local else None,
            "download_url": f"/download/{session_id}"
        })
    except Exception as e:
        print(f"[-] Error during tagging: {e}")
        return jsonify({"error": "Tagging failed"}), 500


@manual_tagger_bp.route('/batch-tag', methods=['POST'])
def batch_tag_folder():
    """
    Scans a folder for CBZ files, searches and automatically tags them
    if a high confidence match is found, streaming the progress in real-time.
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
        cbz_files = sorted([
            os.path.join(folder_path, f) for f in os.listdir(folder_path)
            if f.lower().endswith('.cbz')
        ])

        if not cbz_files:
            return jsonify({
                "success": True,
                "tagged_count": 0,
                "total_count": 0,
                "results": [],
                "message": "No CBZ files found in the selected folder."
            })

        def generate():
            results = []
            tagged_count = 0
            total_count = len(cbz_files)

            max_concurrency = max(1, int(data.get("batch_concurrency", scheduler_config.get("batch_concurrency", 4))))

            ev = queue.Queue()
            started = {"n": 0}
            started_lock = threading.Lock()

            def worker(file_path):
                filename = os.path.basename(file_path)
                with started_lock:
                    started["n"] += 1
                    start_index = started["n"]
                ev.put({"type": "file_start", "filename": filename, "index": start_index, "total": total_count})

                def cb(fname, src, stat, conf=0.0):
                    ev.put({"type": "progress", "filename": fname, "source": src, "status": stat, "confidence": conf})

                try:
                    res = process_single_cbz_file(
                        file_path, comicvine_api_key,
                        google_books_api_key=google_books_api_key,
                        metron_user=metron_user, metron_pass=metron_pass,
                        lower_threshold=lower_threshold, upper_threshold=upper_threshold,
                        on_progress=cb,
                        enabled_fields=scheduler_config.get("selected_fields"),
                        enabled_sources=enabled_sources,
                        force_reprocess=force_reprocess
                    )
                except Exception as e:
                    res = {"filename": filename, "status": "failed", "error": str(e)}
                ev.put({"type": "file_complete_internal", "filename": filename, "result": res})

            executor = ThreadPoolExecutor(max_workers=max_concurrency)
            for fp in cbz_files:
                executor.submit(worker, fp)

            remaining = total_count
            while remaining > 0:
                try:
                    item = ev.get(timeout=0.1)
                except queue.Empty:
                    yield ": keepalive\n\n"
                    continue

                if item["type"] == "file_complete_internal":
                    res = item["result"]
                    results.append(res)
                    if res.get("status") == "tagged":
                        tagged_count += 1
                    remaining -= 1
                    yield f"data: {json.dumps({'type': 'file_complete', 'filename': item['filename'], 'result': res})}\n\n"
                else:
                    yield f"data: {json.dumps(item)}\n\n"

            executor.shutdown(wait=True)

            failed_count = sum(1 for r in results if r.get("status") == "failed")
            skipped_count = total_count - tagged_count - failed_count
            write_scan_log(
                scan_type="batch",
                target=folder_path,
                total_files=total_count,
                tagged_count=tagged_count,
                skipped_count=skipped_count,
                failed_count=failed_count,
                results=results
            )

            yield f"data: {json.dumps({'type': 'batch_complete', 'tagged_count': tagged_count, 'total_count': total_count, 'results': results})}\n\n"

        return Response(generate(), mimetype='text/event-stream')

    except Exception as e:
        print(f"[-] Batch process error: {e}")
        return jsonify({"error": "Batch process initialization failed"}), 500
