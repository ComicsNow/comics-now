"""Flask Blueprint for Story Arcs & Continuity Management.

Provides REST and SSE endpoints for:
- Story arc listing & library completeness matching
- In-reader 'Up Next in Arc' prompts
- Crawler sync start, status, cancel & live SSE logs
- Batch ComicInfo.xml tagging start, status, cancel & live SSE logs
"""
import json
import time
import queue
from flask import Blueprint, request, jsonify, Response

from tagger_app.continuity.crawler import continuity_crawler
from tagger_app.continuity.batch_tagger import continuity_batch_tagger
from tagger_app.continuity.matcher import (
    get_story_arcs_with_completeness,
    get_story_arc_detail,
    get_next_continuity_issue,
)

story_arcs_bp = Blueprint("story_arcs", __name__)


@story_arcs_bp.route("/api/story-arcs", methods=["GET"])
def api_list_story_arcs():
    """List story arcs with calculated library completeness."""
    publisher = request.args.get("publisher")
    search = request.args.get("search")
    arcs = get_story_arcs_with_completeness(publisher=publisher, search=search)
    return jsonify(arcs)


@story_arcs_bp.route("/api/story-arcs/<arc_id>", methods=["GET"])
def api_get_story_arc(arc_id: str):
    """Get full details, ordered sequential issues, and collections for a story arc."""
    detail = get_story_arc_detail(arc_id)
    if not detail:
        return jsonify({"error": "Story arc not found"}), 404
    return jsonify(detail)


@story_arcs_bp.route("/api/story-arcs/continuity/next/<comic_id>", methods=["GET"])
def api_get_next_continuity(comic_id: str):
    """Find next chronological issue in active arc for in-reader prompt."""
    next_info = get_next_continuity_issue(comic_id)
    if not next_info:
        return jsonify({"found": False})
    return jsonify({"found": True, **next_info})


# --- Crawler Endpoints ---


@story_arcs_bp.route("/api/story-arcs/sync", methods=["POST"])
def api_start_sync():
    """Trigger autonomous delta crawl of reading orders."""
    data = request.get_json(silent=True) or {}
    mode = data.get("mode", "both")
    force = bool(data.get("force", False))
    try:
        res = continuity_crawler.start_sync(mode=mode, force=force, run_async=True)
        return jsonify({"ok": True, **res})
    except RuntimeError as e:
        return jsonify({"ok": False, "error": str(e)}), 409


@story_arcs_bp.route("/api/story-arcs/sync/status", methods=["GET"])
def api_sync_status():
    """Return crawler status, percentage, and current slug."""
    return jsonify(continuity_crawler.get_status())


@story_arcs_bp.route("/api/story-arcs/sync/cancel", methods=["POST"])
def api_sync_cancel():
    """Cancel running crawler."""
    continuity_crawler.cancel_sync()
    return jsonify({"ok": True, "cancelled": True})


@story_arcs_bp.route("/api/story-arcs/stream", methods=["GET"])
def api_sync_stream():
    """Server-Sent Events (SSE) live log stream for crawler."""
    q: queue.Queue = queue.Queue(maxsize=100)

    def on_log(entry):
        try:
            q.put_nowait(entry)
        except queue.Full:
            pass

    continuity_crawler._log_subscribers.append(on_log)

    def generate():
        try:
            # Yield initial history
            for entry in continuity_crawler.get_logs(limit=200):
                yield f"data: {json.dumps(entry)}\n\n"

            while True:
                try:
                    entry = q.get(timeout=15.0)
                    yield f"data: {json.dumps(entry)}\n\n"
                except queue.Empty:
                    # Heartbeat comment to keep connection alive
                    yield ": ping\n\n"
        finally:
            if on_log in continuity_crawler._log_subscribers:
                continuity_crawler._log_subscribers.remove(on_log)

    return Response(generate(), mimetype="text/event-stream")


# --- Batch Tagging Endpoints ---


@story_arcs_bp.route("/api/story-arcs/batch-tag", methods=["POST"])
def api_start_batch_tag():
    """Trigger batch StoryArc ComicInfo.xml metadata enrichment (supports dryRun simulation)."""
    data = request.get_json(silent=True) or {}
    target = data.get("targetPublisher")
    dry_run = bool(data.get("dryRun", False))
    try:
        res = continuity_batch_tagger.start_batch_tag(
            target_publisher=target,
            run_async=True,
            dry_run=dry_run,
        )
        return jsonify({"ok": True, **res})
    except RuntimeError as e:
        return jsonify({"ok": False, "error": str(e)}), 409


@story_arcs_bp.route("/api/story-arcs/batch-tag/status", methods=["GET"])
def api_batch_tag_status():
    """Return batch tagger status and comic count progress."""
    return jsonify(continuity_batch_tagger.get_status())


@story_arcs_bp.route("/api/story-arcs/batch-tag/results", methods=["GET"])
def api_batch_tag_results():
    """Return structured results from the most recent batch tagging or dry run simulation."""
    return jsonify({
        "ok": True,
        "results": continuity_batch_tagger.get_dry_run_results(),
    })


@story_arcs_bp.route("/api/story-arcs/batch-tag/cancel", methods=["POST"])
def api_batch_tag_cancel():
    """Cancel running batch tagger."""
    continuity_batch_tagger.cancel_tagging()
    return jsonify({"ok": True, "cancelled": True})


@story_arcs_bp.route("/api/story-arcs/batch-tag/stream", methods=["GET"])
def api_batch_tag_stream():
    """Server-Sent Events (SSE) live log stream for batch tagger."""
    q: queue.Queue = queue.Queue(maxsize=100)

    def on_log(entry):
        try:
            q.put_nowait(entry)
        except queue.Full:
            pass

    continuity_batch_tagger._log_subscribers.append(on_log)

    def generate():
        try:
            for entry in continuity_batch_tagger.get_logs(limit=200):
                yield f"data: {json.dumps(entry)}\n\n"

            while True:
                try:
                    entry = q.get(timeout=15.0)
                    yield f"data: {json.dumps(entry)}\n\n"
                except queue.Empty:
                    yield ": ping\n\n"
        finally:
            if on_log in continuity_batch_tagger._log_subscribers:
                continuity_batch_tagger._log_subscribers.remove(on_log)

    return Response(generate(), mimetype="text/event-stream")


@story_arcs_bp.route("/api/story-arcs/batch-tag/publishers", methods=["GET"])
@story_arcs_bp.route("/api/story-arcs/publishers", methods=["GET"])
def api_get_publishers():
    """Return distinct publishers available in reading orders DB."""
    from tagger_app.continuity.db import get_reading_orders_db
    conn = get_reading_orders_db()
    rows = conn.execute(
        "SELECT DISTINCT publisher FROM reading_orders "
        "WHERE publisher IS NOT NULL AND publisher != '' ORDER BY publisher"
    ).fetchall()
    pubs = [r[0] for r in rows]
    return jsonify({"ok": True, "publishers": pubs})


@story_arcs_bp.route("/api/story-arcs/logs", methods=["GET"])
def api_get_logs():
    """Return recent crawler logs."""
    limit = request.args.get("limit", default=100, type=int)
    return jsonify({"ok": True, "logs": continuity_crawler.get_logs(limit=limit)})


@story_arcs_bp.route("/api/story-arcs/logs", methods=["DELETE"])
def api_clear_logs():
    """Clear crawler log buffer."""
    continuity_crawler._logs.clear()
    return jsonify({"ok": True})

