"""
Comics Now! MCP server.

Exposes the Comics Now! app to an MCP client (Claude, Gemini, ChatGPT, ...) as:
  - curated tools for the highest-value actions/queries,
  - a generic `call_api` escape hatch for any of the ~90 REST endpoints,
  - a read-only `query_db` tool over the app's SQLite database.

Auth: the app treats localhost / trusted-LAN requests as an admin user, so no
Cloudflare token is needed when this runs on the same box. See .env.example.

Curated tools cover API actions/queries + SQL and tagging (calling small helper
endpoints in the app). Guided-view authoring is intentionally not exposed here.
"""

import json
import os
import re
import sqlite3
from typing import Any, Optional

import httpx
from mcp.server.fastmcp import FastMCP, Image
from mcp.server.transport_security import TransportSecuritySettings

from comics_mcp.guided_overlay import render_guided_overlay

# --- Configuration (env-driven) ---------------------------------------------

BASE_URL = os.environ.get("COMICS_BASE_URL", "http://localhost:3000").rstrip("/")
GVE_BASE_URL = os.environ.get("GVE_BASE_URL", "http://localhost:3100").rstrip("/")
_DEFAULT_DB = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "comics-now.db")
)
DB_PATH = os.environ.get("COMICS_DB_PATH", _DEFAULT_DB)
ALLOW_DESTRUCTIVE = os.environ.get("COMICS_ALLOW_DESTRUCTIVE", "0") == "1"
TIMEOUT = float(os.environ.get("COMICS_TIMEOUT", "60"))

try:
    EXTRA_HEADERS = json.loads(os.environ.get("COMICS_EXTRA_HEADERS", "") or "{}")
    if not isinstance(EXTRA_HEADERS, dict):
        EXTRA_HEADERS = {}
except json.JSONDecodeError:
    EXTRA_HEADERS = {}

mcp = FastMCP("comics-now")

# --- HTTP helper -------------------------------------------------------------

_client: Optional[httpx.Client] = None
_gve_client: Optional[httpx.Client] = None


def _http() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(
            base_url=BASE_URL, timeout=TIMEOUT, headers=EXTRA_HEADERS
        )
    return _client


def _gve_http() -> httpx.Client:
    global _gve_client
    if _gve_client is None:
        _gve_client = httpx.Client(
            base_url=GVE_BASE_URL, timeout=TIMEOUT, headers=EXTRA_HEADERS
        )
    return _gve_client


def _gve_request(
    method: str,
    path: str,
    params: Optional[dict] = None,
    body: Optional[dict] = None,
) -> dict:
    try:
        resp = _gve_http().request(
            method, path, params=params, json=body if body is not None else None
        )
    except httpx.RequestError as exc:
        return {"status": 0, "ok": False, "error": f"GVE Now HTTP error: {exc}"}

    ctype = resp.headers.get("content-type", "")
    if "application/json" in ctype:
        try:
            payload = resp.json()
        except Exception:
            payload = resp.text
    else:
        payload = resp.text
    return {
        "status": resp.status_code,
        "ok": resp.is_success,
        "data": payload,
    }


def _gve_page_image(comic_id: str, page_name: str) -> tuple[bytes, str]:
    url = f"/api/comics/{comic_id}/page-image"
    resp = _gve_http().request("GET", url, params={"page": page_name})
    resp.raise_for_status()
    ctype = resp.headers.get("content-type", "image/jpeg")
    fmt = "png" if "png" in ctype else ("webp" if "webp" in ctype else "jpeg")
    return resp.content, fmt


def _resolve_guided_page(pages_dict: dict, page: int) -> Optional[tuple[int, str, dict]]:
    if not pages_dict:
        return None
    sorted_keys = sorted(pages_dict.keys())
    if page < 0 or page >= len(sorted_keys):
        return None
    page_name = sorted_keys[page]
    return page, page_name, pages_dict[page_name]


# Endpoints that mutate/destroy data on disk. Blocked via call_api unless
# COMICS_ALLOW_DESTRUCTIVE=1. (method, compiled path regex)
_DESTRUCTIVE = [
    ("POST", re.compile(r"/api/v1/move-comics$")),
    ("POST", re.compile(r"/api/v1/move/")),
    ("POST", re.compile(r"/api/v1/rename-cbz$")),
    ("POST", re.compile(r"/api/v1/tag-comics-now/(apply|run|match-covers|schedule|skip)$")),
    ("POST", re.compile(r"/api/v1/admin/metadata/migrate$")),
    ("POST", re.compile(r"/api/v1/guided/run")),
    # Config / bulk-mutating endpoints (not file-destroying, but high blast
    # radius). Note: user-access grants (/users/:id/access) are intentionally
    # NOT gated. GETs are unaffected — these only match POST.
    ("POST", re.compile(r"/api/v1/settings$")),
    ("POST", re.compile(r"/api/v1/admin/libraries$")),
    ("POST", re.compile(r"/api/v1/reading-lists/import$")),
    ("POST", re.compile(r"/api/v1/comics/set-all-(manga|continuous)-mode$")),
    ("POST", re.compile(r"/api/v1/comics/info$")),
    ("POST", re.compile(r"/api/v1/sync/update$")),
    ("DELETE", re.compile(r".*")),  # all DELETEs are destructive
]


# Endpoints exempt from the destructive block (safe DB-only mutations)
_DESTRUCTIVE_EXEMPTIONS = [
    ("DELETE", re.compile(r"^/api/v1/reading-lists(?:/.*)?$")),
]


def _is_destructive(method: str, path: str) -> bool:
    m = method.upper()
    for dm, rx in _DESTRUCTIVE_EXEMPTIONS:
        if dm == m and rx.search(path):
            return False
    for dm, rx in _DESTRUCTIVE:
        if dm == m and rx.search(path):
            return True
    return False


def _request(
    method: str,
    path: str,
    params: Optional[dict] = None,
    body: Optional[dict] = None,
) -> Any:
    url = BASE_URL.rstrip("/") + "/" + path.lstrip("/")
    resp = _http().request(method.upper(), url, params=params, json=body)
    ctype = resp.headers.get("content-type", "")
    payload: Any
    if "application/json" in ctype:
        try:
            payload = resp.json()
        except Exception:
            payload = resp.text
    else:
        payload = resp.text
    return {
        "status": resp.status_code,
        "ok": resp.is_success,
        "data": payload,
    }


def _dump(obj: Any) -> str:
    return json.dumps(obj, indent=2, ensure_ascii=False, default=str)


# --- Generic tools -----------------------------------------------------------


@mcp.tool()
def call_api(
    method: str,
    path: str,
    query: Optional[dict] = None,
    body: Optional[dict] = None,
) -> str:
    """Call any Comics Now! REST endpoint (escape hatch for endpoints without a
    dedicated tool).

    Args:
        method: HTTP method, e.g. "GET", "POST", "PUT", "DELETE".
        path: API path beginning with /api/v1/... (query string optional).
        query: Optional query-string parameters as a dict.
        body: Optional JSON request body as a dict.

    Destructive endpoints (file move/rename/delete, tagger apply/run, metadata
    migrate, guided run) are blocked unless the server was started with
    COMICS_ALLOW_DESTRUCTIVE=1.
    """
    if _is_destructive(method, path) and not ALLOW_DESTRUCTIVE:
        return _dump(
            {
                "blocked": True,
                "reason": "Destructive endpoint blocked. Start the MCP server "
                "with COMICS_ALLOW_DESTRUCTIVE=1 to permit this.",
                "method": method.upper(),
                "path": path,
            }
        )
    return _dump(_request(method, path, params=query, body=body))


@mcp.tool()
def query_db(sql: str, limit: int = 500) -> str:
    """Run a READ-ONLY SQL query against the app's SQLite database.

    Only a single SELECT / WITH / PRAGMA / EXPLAIN statement is allowed; any
    write statement or multiple statements are rejected. Results are returned as
    JSON rows (capped at `limit`).

    Useful tables: comics(id, path, name, series, publisher, metadata,
    lastReadPage, totalPages, guidedViewStatus, guidedViewPath, tagStatus),
    users(userId, email, role), user_library_access(userId, accessType,
    accessValue, direct_access, child_access), reading_lists, ...
    """
    stripped = sql.strip().rstrip(";").strip()
    if ";" in stripped:
        return _dump({"error": "Only a single statement is allowed (no ';')."})
    if not re.match(r"(?is)^\s*(select|with|pragma|explain)\b", stripped):
        return _dump(
            {"error": "Only SELECT/WITH/PRAGMA/EXPLAIN queries are allowed."}
        )
    limit = max(1, min(int(limit), 5000))
    try:
        conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        cur = conn.execute(stripped)
        rows = [dict(r) for r in cur.fetchmany(limit)]
        truncated = cur.fetchone() is not None
        conn.close()
    except sqlite3.Error as e:
        return _dump({"error": f"SQLite error: {e}"})
    return _dump(
        {"rowCount": len(rows), "truncated": truncated, "rows": rows}
    )


# --- Curated read tools ------------------------------------------------------


@mcp.tool()
def search_comics(query: str) -> str:
    """Search the library for comics matching a text query (title/series/etc.)."""
    return _dump(_request("GET", "/api/v1/search", params={"query": query}))


@mcp.tool()
def library_tree() -> str:
    """Return the full library hierarchy: root folders -> publishers -> series
    (metadata mode) or folders/comics (folder mode)."""
    return _dump(_request("GET", "/api/v1/library-tree"))


@mcp.tool()
def list_users() -> str:
    """List all users (userId, email, role, timestamps)."""
    return _dump(_request("GET", "/api/v1/users"))


@mcp.tool()
def get_user_access(user_id: str) -> str:
    """Get a user's library access grants (root_folder/publisher/series rows)."""
    return _dump(_request("GET", f"/api/v1/users/{user_id}/access"))


@mcp.tool()
def list_reading_lists() -> str:
    """List the current user's reading lists with counts."""
    return _dump(_request("GET", "/api/v1/reading-lists"))


@mcp.tool()
def get_reading_list(list_id: str) -> str:
    """Get a single reading list and its comics."""
    return _dump(_request("GET", f"/api/v1/reading-lists/{list_id}"))


@mcp.tool()
def get_settings() -> str:
    """Get application settings (scan interval, formats, metadata storage, ...)."""
    return _dump(_request("GET", "/api/v1/settings"))


@mcp.tool()
def get_logs(level: str = "ALL", category: str = "ALL") -> str:
    """Fetch recent server logs, optionally filtered by level and category."""
    return _dump(
        _request(
            "GET", "/api/v1/logs", params={"level": level, "category": category}
        )
    )


@mcp.tool()
def tag_comics_now_pending() -> str:
    """Get comics pending Tag Comics Now! review / the current pending match."""
    return _dump(_request("GET", "/api/v1/tag-comics-now/pending"))


@mcp.tool()
def comicvine_search(query: str) -> str:
    """Search ComicVine (external metadata source) for a series/issue."""
    return _dump(
        _request("GET", "/api/v1/search/comicvine", params={"query": query})
    )


@mcp.tool()
def external_metadata_search(query: str, source: str = "all") -> str:
    """Search for comic metadata across external databases.

    Args:
        query: Comic title / series search string.
        source: Metadata source to query ("all", "comicvine", "metron", or "gcd").
    """
    return _dump(
        _request("GET", "/api/v1/search/external", params={"query": query, "source": source})
    )


@mcp.tool()
def get_metadata_sources() -> str:
    """Get all available external metadata sources and their configuration status."""
    return _dump(_request("GET", "/api/v1/tag-comics-now/sources"))


@mcp.tool()
def get_tag_comics_now_pending_details() -> str:
    """Get full details, candidates, cover URLs, and match confidence for the comic currently pending review."""
    return _dump(_request("GET", "/api/v1/tag-comics-now/pending-details"))


@mcp.tool()
def get_gemini_status() -> str:
    """Get Gemini AI cover-matching status, model configuration, daily quota cap, and usage today."""
    return _dump(_request("GET", "/api/v1/gemini/config"))


@mcp.tool()
def list_gemini_models(api_key: Optional[str] = None) -> str:
    """List available Google Gemini models supported for visual cover matching."""
    params = {}
    if api_key:
        params["apiKey"] = api_key
    return _dump(_request("GET", "/api/v1/gemini/models", params=params if params else None))


@mcp.tool()
def get_organization_rules() -> str:
    """Get active comic file naming tokens and folder hierarchy rules."""
    naming = _request("GET", "/api/v1/tag-comics-now/naming-rules")
    folder = _request("GET", "/api/v1/tag-comics-now/folder-rules")
    naming_rules = (
        naming.get("data", {}).get("rules")
        if isinstance(naming, dict) and isinstance(naming.get("data"), dict)
        else (naming.get("data") if isinstance(naming, dict) else naming)
    )
    folder_rules = (
        folder.get("data", {}).get("rules")
        if isinstance(folder, dict) and isinstance(folder.get("data"), dict)
        else (folder.get("data") if isinstance(folder, dict) else folder)
    )
    return _dump({
        "namingRules": naming_rules,
        "folderRules": folder_rules,
    })


@mcp.tool()
def preview_comic_organization(metadata: dict) -> str:
    """Simulate file naming and folder path organization for a comic without writing any files.

    Args:
        metadata: Comic metadata dictionary, e.g. {"series": "Batman", "issue": "1", "year": "2016", "publisher": "DC Comics"}.
    """
    normalized = dict(metadata)
    mapping = {
        "series": "Series",
        "publisher": "Publisher",
        "year": "Year",
        "issue": "Number",
        "number": "Number",
        "title": "Title",
        "writer": "Writer",
        "volume": "Volume",
        "pages": "PageCount",
        "page_count": "PageCount",
        "cover_date": "CoverDate",
    }
    for src, target in mapping.items():
        if src in metadata and target not in normalized:
            normalized[target] = metadata[src]
        elif target in metadata and src not in normalized:
            normalized[src] = metadata[target]

    filename_resp = _request("POST", "/api/v1/tag-comics-now/naming-preview", body={"metadata": normalized})
    folder_resp = _request("POST", "/api/v1/tag-comics-now/folder-preview", body={"metadata": normalized})

    filename = None
    if isinstance(filename_resp, dict):
        if "filename" in filename_resp:
            filename = filename_resp["filename"]
        elif isinstance(filename_resp.get("data"), dict):
            filename = filename_resp["data"].get("filename")

    folder_path = None
    if isinstance(folder_resp, dict):
        if "folderPath" in folder_resp:
            folder_path = folder_resp["folderPath"]
        elif isinstance(folder_resp.get("data"), dict):
            folder_path = folder_resp["data"].get("folderPath")

    return _dump({
        "filename": filename,
        "folderPath": folder_path,
    })



@mcp.tool()
def get_guided_status() -> str:
    """Get Guided View panel detector status, queue size, and active job."""
    return _dump(_request("GET", "/api/v1/guided/status"))


@mcp.tool()
def get_guided_logs() -> str:
    """Fetch recent Guided View detection logs."""
    return _dump(_request("GET", "/api/v1/guided/logs"))


@mcp.tool()
def trigger_guided_detection(
    scope: str,
    target: str,
    force: bool = False,
) -> str:
    """Start Guided View panel/bubble detection for a comic, series, publisher, or library.

    Args:
        scope: Target scope type ("comic", "series", "publisher", or "library").
        target: Target identifier or name (e.g. comic ID, series name, publisher name, or library path).
        force: If True, forces re-detection on comics even if already completed.
    """
    return _dump(
        _request(
            "POST",
            "/api/v1/guided/run-scope",
            body={"scope": scope, "target": target, "force": bool(force)},
        )
    )


@mcp.tool()
def list_libraries() -> str:
    """List all configured comic libraries, root paths, and settings."""
    return _dump(_request("GET", "/api/v1/admin/libraries"))


@mcp.tool()
def get_user_stats(user_id: str) -> str:
    """Get reading statistics for a user (total read, pages read, series progress)."""
    return _dump(_request("GET", f"/api/v1/users/{user_id}/stats"))


@mcp.tool()
def get_operation_errors() -> str:
    """Get background operation errors (file move, rename, scan, or tagging errors)."""
    return _dump(_request("GET", "/api/v1/operation-errors"))


# --- Curated safe-write tools ------------------------------------------------


@mcp.tool()
def trigger_scan(full: bool = False) -> str:
    """Trigger a library scan. Set full=True for a complete rescan."""
    return _dump(_request("POST", "/api/v1/scan", body={"full": bool(full)}))


@mcp.tool()
def set_user_access(user_id: str, access: list[dict]) -> str:
    """Replace a user's library access grants.

    `access` is a list of {accessType, accessValue, direct_access, child_access}.
    accessType is one of root_folder/publisher/series (metadata mode) or
    folder/comic (folder mode). For metadata mode, a publisher/series grant with
    child_access=true grants that publisher/series globally.
    """
    return _dump(
        _request("POST", f"/api/v1/users/{user_id}/access", body={"access": access})
    )


@mcp.tool()
def create_reading_list(
    name: str, description: str = "", comic_ids: Optional[list[str]] = None
) -> str:
    """Create a new reading list, optionally seeded with comic IDs. Automatically synced to all users."""
    body = {"name": name, "description": description}
    if comic_ids:
        body["comicIds"] = comic_ids
    return _dump(_request("POST", "/api/v1/reading-lists", body=body))


@mcp.tool()
def sync_reading_lists_to_all_users(
    overwrite: bool = True, prune: bool = True
) -> str:
    """Sync/mirror all curated reading lists from the default/admin account to all registered users in Comics Now!.

    Args:
        overwrite: If True (default), updates existing lists and their comic ordering to match default-user.
        prune: If True (default), removes obsolete reading lists that were deleted from default-user.
    """
    return _dump(
        _request(
            "POST",
            "/api/v1/admin/reading-lists/sync-to-all",
            body={"overwrite": bool(overwrite), "prune": bool(prune)},
        )
    )


@mcp.tool()
def delete_reading_list_globally(name_or_id: str) -> str:
    """Delete a reading list across ALL user accounts in Comics Now! by list name or list ID."""
    return _dump(
        _request(
            "POST",
            "/api/v1/admin/reading-lists/delete-globally",
            body={"name": name_or_id},
        )
    )


@mcp.tool()
def add_comics_to_reading_list(list_id: str, comic_ids: list[str]) -> str:
    """Add one or more comics to an existing reading list."""
    return _dump(
        _request(
            "POST",
            f"/api/v1/reading-lists/{list_id}/comics",
            body={"comicIds": comic_ids},
        )
    )


@mcp.tool()
def update_reading_list(
    list_id: str, name: str, description: str = ""
) -> str:
    """Update a reading list's name and/or description."""
    body = {"name": name, "description": description}
    return _dump(_request("PUT", f"/api/v1/reading-lists/{list_id}", body=body))


@mcp.tool()
def delete_reading_list(list_id: str) -> str:
    """Delete a reading list by its ID."""
    return _dump(_request("DELETE", f"/api/v1/reading-lists/{list_id}"))


@mcp.tool()
def remove_comics_from_reading_list(list_id: str, comic_ids: list[str]) -> str:
    """Remove one or more comics from a reading list."""
    return _dump(
        _request(
            "DELETE",
            f"/api/v1/reading-lists/{list_id}/comics",
            body={"comicIds": comic_ids},
        )
    )


@mcp.tool()
def reorder_reading_list_comics(list_id: str, comic_ids: list[str]) -> str:
    """Set the order of comics inside a reading list.

    Args:
        list_id: The reading list ID.
        comic_ids: Complete list of comic IDs in the desired order.
    """
    return _dump(
        _request(
            "PUT",
            f"/api/v1/reading-lists/{list_id}/reorder",
            body={"comicOrder": comic_ids},
        )
    )


@mcp.tool()
def curate_reading_order_event(
    event_name: str, apply_changes: bool = False
) -> str:
    """Curate a specific comic event or storyline reading order (e.g., 'Civil War', 'Knightfall', 'Absolute DC').
    Scrapes canonical orders from DC Universe Infinite, Comic Book Reading Orders, Comic Book Herald, and Wikipedia,
    matches them against library single issues and omnibuses, and enforces multi-series constraints.

    Args:
        event_name: Name of the comic crossover or storyline.
        apply_changes: If False (default), returns a dry-run preview. If True, creates the list in DB and syncs across all users.
    """
    from comics_mcp import reading_curator
    result = reading_curator.curate_event_reading_order(event_name, apply_changes=apply_changes)
    return _dump(result)


@mcp.tool()
def curate_recent_comics_reading_lists(
    months: int = 3, apply_changes: bool = False
) -> str:
    """Analyze comics added in the last X months to check if they complete existing reading lists or form new ones.

    Args:
        months: Number of months of recent additions to analyze (default 3).
        apply_changes: If False (default), returns a dry-run preview. If True, commits changes to DB.
    """
    from comics_mcp import reading_curator
    result = reading_curator.curate_recent_comics(months=months, apply_changes=apply_changes)
    return _dump(result)


@mcp.tool()
def curate_full_library_reading_lists(
    unassigned_only: bool = True, apply_changes: bool = False
) -> str:
    """Audit the comic collection against major reading orders from DCUI, CBRO, and Comic Book Herald.

    Args:
        unassigned_only: If True (default), focuses on comics not yet in any reading list.
        apply_changes: If False (default), returns a dry-run preview. If True, commits changes to DB.
    """
    from comics_mcp import reading_curator
    library = reading_curator.get_all_library_comics(unassigned_only=unassigned_only)
    cached_orders = reading_curator.reading_orders_cache.list_cached_orders()
    valid_matches = []
    for o in cached_orders:
        full_order = reading_curator.reading_orders_cache.get_cached_order(o["slug"])
        if full_order:
            match = reading_curator.match_order_against_library(full_order, library)
            if match["is_valid"]:
                if apply_changes:
                    reading_curator.commit_reading_list(
                        name=match["title"],
                        description=match["description"],
                        comic_ids=[c["comicId"] for c in match["matched_comics"]]
                    )
                    match["applied"] = True
                valid_matches.append(match)

    return _dump({
        "audited_comics_count": len(library),
        "valid_proposals_count": len(valid_matches),
        "proposals": valid_matches
    })


@mcp.tool()
def reorder_reading_lists(list_ids: list[str]) -> str:
    """Set the display order of reading lists.

    Args:
        list_ids: Complete list of reading list IDs in the desired order.
    """
    return _dump(
        _request(
            "PUT",
            "/api/v1/reading-lists/reorder",
            body={"listOrder": list_ids},
        )
    )


@mcp.tool()
def set_reading_list_read_status(list_id: str, read: bool = True) -> str:
    """Mark all comics in a reading list as read (read=True) or unread (read=False)."""
    return _dump(
        _request(
            "POST",
            f"/api/v1/reading-lists/{list_id}/mark-read",
            body={"read": bool(read)},
        )
    )


@mcp.tool()
def create_reading_lists_bulk(
    lists: list[dict], sync_to_all: bool = True
) -> str:
    """Create multiple reading lists in bulk.

    Args:
        lists: List of reading list definitions. Each dict contains:
               - name (str): List name (required)
               - description (str, optional): List description
               - comicIds (list[str], optional): List of comic IDs
        sync_to_all: If True (default), propagates the created lists to all registered users.
    """
    return _dump(
        _request(
            "POST",
            "/api/v1/reading-lists/bulk",
            body={"lists": lists, "syncToAll": bool(sync_to_all)},
        )
    )


@mcp.tool()
def delete_reading_lists_bulk(
    list_ids: list[str], globally: bool = False
) -> str:
    """Delete multiple reading lists by their IDs or names.

    Args:
        list_ids: List of reading list IDs or names to delete.
        globally: If True, deletes across ALL user accounts in Comics Now! (admin only).
    """
    return _dump(
        _request(
            "POST",
            "/api/v1/reading-lists/delete-bulk",
            body={"listIds": list_ids, "globally": bool(globally)},
        )
    )


@mcp.tool()
def add_comics_to_reading_lists_bulk(
    list_ids: list[str], comic_ids: list[str]
) -> str:
    """Add comic IDs across multiple reading lists at once.

    Args:
        list_ids: List of reading list IDs to add comics to.
        comic_ids: List of comic IDs to add.
    """
    return _dump(
        _request(
            "POST",
            "/api/v1/reading-lists/bulk-add-comics",
            body={"listIds": list_ids, "comicIds": comic_ids},
        )
    )


@mcp.tool()
def remove_comics_from_reading_lists_bulk(
    list_ids: list[str], comic_ids: list[str]
) -> str:
    """Remove comic IDs from multiple reading lists at once.

    Args:
        list_ids: List of reading list IDs to remove comics from.
        comic_ids: List of comic IDs to remove.
    """
    return _dump(
        _request(
            "POST",
            "/api/v1/reading-lists/bulk-remove-comics",
            body={"listIds": list_ids, "comicIds": comic_ids},
        )
    )


@mcp.tool()
def set_reading_lists_read_status_bulk(
    list_ids: list[str], read: bool = True
) -> str:
    """Mark all comics across multiple reading lists as read (read=True) or unread (read=False)."""
    return _dump(
        _request(
            "POST",
            "/api/v1/reading-lists/mark-read-bulk",
            body={"listIds": list_ids, "read": bool(read)},
        )
    )


@mcp.tool()
def set_comic_status(comic_id: str, status: str) -> str:
    """Set a comic's read status (e.g. "read" / "unread")."""
    return _dump(
        _request(
            "POST",
            "/api/v1/comics/status",
            body={"comicId": comic_id, "status": status},
        )
    )


@mcp.tool()
def set_series_status(
    publisher: str, series: str, status: str, root_folder: str = ""
) -> str:
    """Set read status for an entire series."""
    return _dump(
        _request(
            "POST",
            "/api/v1/series/status",
            body={
                "publisher": publisher,
                "series": series,
                "status": status,
                "rootFolder": root_folder,
            },
        )
    )


# --- Part C: tagging ---------------------------------------------------------
#
# Cover-driven identification (no Tag Comics Now!/ComicVine): the model extracts the
# cover image, recognises it (title, issue #, publisher, cover artist, logos,
# distinctive art), confirms the exact series/issue via web search, then writes
# the metadata back with set_tags.

TAG_WORKFLOW_DOC = """\
Identify-and-tag a comic from its cover, without Tag Comics Now!/ComicVine:

1. get_cover_image(comic_id) -> LOOK at the returned cover. Read every clue:
   series title, issue number, publisher/imprint logos, cover artist credit,
   trade dress, barcode/price, and the artwork itself.
2. Search the web (WebSearch/WebFetch) for that exact book to confirm the
   series, issue number, publisher, cover/store date, and creators. Cross-check
   at least one authoritative source (publisher page, GCD, ComicVine web page,
   a retailer listing) — don't tag from a single weak guess.
3. If the cover is ambiguous (variant covers, reprints), pull another page with
   get_cover_image(comic_id, page=N) or read the indicia page for the printing.
4. set_tags(comic_id, fields, storage) with the confirmed metadata. Use
   ComicInfo field names: Series, Number, Title, Publisher, Year, Month, Day,
   Writer, Penciller, CoverArtist, Summary, Web (source URL), Notes.

Only tag fields you are confident about; leave unknowns out rather than
guessing. Prefer storage="sidecar" unless asked otherwise.
"""


@mcp.tool()
def tag_workflow() -> str:
    """Return the cover-driven tagging workflow (extract cover -> identify via web
    search -> set_tags). Read this before tagging a comic from its cover."""
    return TAG_WORKFLOW_DOC


@mcp.tool()
def get_cover_image(comic_id: str, page: int = 0) -> Image:
    """Extract a comic page as a native-resolution image so YOU can visually
    identify the book and search the web for a match to tag it.

    `page` is a 0-based page index (0 = front cover, the default). Use a later
    page to read the indicia/printing info when the cover is ambiguous. After
    looking at the image, web-search the series/issue to confirm metadata, then
    call set_tags. See tag_workflow().
    """
    listing = _request("GET", f"/api/v1/comics/{comic_id}/guided-pages")
    data = listing.get("data") if isinstance(listing, dict) else None
    pages = data.get("pages") if isinstance(data, dict) else None
    if not pages:
        raise ValueError(f"Could not list pages for comic {comic_id}: {listing}")
    idx = max(0, min(int(page), len(pages) - 1))
    page_name = pages[idx]["name"]

    url = BASE_URL.rstrip("/") + f"/api/v1/comics/{comic_id}/page-image"
    resp = _http().request("GET", url, params={"page": page_name})
    resp.raise_for_status()
    ctype = resp.headers.get("content-type", "image/jpeg")
    fmt = "png" if "png" in ctype else ("webp" if "webp" in ctype else "jpeg")
    return Image(data=resp.content, format=fmt)


@mcp.tool()
def get_tags(comic_id: str) -> str:
    """Read a comic's current ComicInfo metadata (from sidecar/zip) plus the DB
    metadata, publisher, series and tag status."""
    return _dump(_request("GET", f"/api/v1/comics/{comic_id}/tags"))


@mcp.tool()
def set_tags(comic_id: str, fields: dict, storage: str = "sidecar") -> str:
    """Write ComicInfo tags for a comic.

    Args:
        comic_id: target comic id.
        fields: ComicInfo fields, e.g. {"Series": "...", "Number": "3",
                "Title": "...", "Publisher": "...", "Writer": "...", "Year": "..."}.
        storage: "sidecar" (adjacent .ComicInfo.xml, default), "db" (database
                 only), or "archive" (repack ComicInfo.xml INTO the .cbz —
                 modifies the comic file).
    """
    return _dump(
        _request(
            "POST",
            f"/api/v1/comics/{comic_id}/tags",
            body={"fields": fields, "storage": storage},
        )
    )


@mcp.tool()
def get_tags_bulk(comic_ids: list[str]) -> str:
    """Read ComicInfo metadata (from sidecar/zip) plus DB metadata for multiple comics in a single batch request.

    Args:
        comic_ids: List of comic IDs to fetch metadata for.
    """
    return _dump(
        _request(
            "POST",
            "/api/v1/comics/tags/batch",
            body={"comicIds": comic_ids},
        )
    )


@mcp.tool()
def set_tags_bulk(
    items: Optional[list[dict]] = None,
    comic_ids: Optional[list[str]] = None,
    fields: Optional[dict] = None,
    storage: str = "sidecar",
) -> str:
    """Write ComicInfo tags for multiple comics in bulk.

    Supports two input patterns:
    1. Pass `items` with a list of `{"comicId": "...", "fields": { ... }, "storage": "..."}`
       to write individual/different metadata per comic.
    2. Pass `comic_ids` and a shared `fields` dictionary to apply the same tags across all comics.

    Args:
        items: Optional list of item objects with comicId, fields, and optional storage.
        comic_ids: Optional list of comic IDs when applying shared fields.
        fields: ComicInfo fields (used when comic_ids is provided).
        storage: "sidecar" (default), "db", or "archive".
    """
    body: dict[str, Any] = {"storage": storage}
    if items is not None:
        body["items"] = items
    if comic_ids is not None:
        body["comicIds"] = comic_ids
    if fields is not None:
        body["fields"] = fields
    return _dump(_request("POST", "/api/v1/comics/tags/bulk", body=body))


# --- Part D: Guided View Visual & Coordinate Editing -------------------------


@mcp.tool()
def get_guided_page_data(comic_id: str, page: int = 0) -> str:
    """Retrieve speech and panel coordinates for a specific comic page as structured data.

    Args:
        comic_id: Target comic id.
        page: 0-based page index (0 = first page).

    Returns:
        JSON string containing comic ID, page index, page file name, comic reading type,
        dimensions, and items sorted in active reading sequence.
    """
    res = _gve_request("GET", f"/api/comics/{comic_id}/guided")
    if not res.get("ok"):
        return _dump({
            "ok": False,
            "error": f"Failed to retrieve guided data for comic {comic_id}: {res.get('data') or res.get('error')}",
        })

    doc = res.get("data") if isinstance(res.get("data"), dict) else {}
    pages = doc.get("pages", {})
    resolved = _resolve_guided_page(pages, int(page))
    if not resolved:
        return _dump({
            "ok": False,
            "error": f"Page index {page} is out of bounds (total pages: {len(pages)})",
        })

    page_idx, page_name, page_info = resolved
    items = page_info.get("items", [])
    order = page_info.get("order", [])

    item_map = {it["id"]: it for it in items if isinstance(it, dict) and "id" in it}
    sequence = []
    for seq_idx, item_id in enumerate(order, start=1):
        if item_id in item_map:
            it = item_map[item_id]
            sequence.append({
                "order": seq_idx,
                "id": it.get("id"),
                "kind": it.get("kind"),
                "box": it.get("box"),
            })

    return _dump({
        "ok": True,
        "data": {
            "comicId": comic_id,
            "pageIndex": page_idx,
            "pageName": page_name,
            "type": doc.get("type", "western"),
            "dimensions": {
                "width": page_info.get("width"),
                "height": page_info.get("height"),
            },
            "sequence": sequence,
            "items": items,
            "order": order,
            "warnings": doc.get("warnings", []),
        },
    })


@mcp.tool()
def get_guided_page_image(comic_id: str, page: int = 0, overlay: bool = True) -> Image:
    """Retrieve a comic page image, optionally with guided-view coordinates rendered as an overlay.

    Args:
        comic_id: Target comic id.
        page: 0-based page index.
        overlay: If True (default), renders panel boxes, speech bubble boxes, and sequence badges on top of the image.
                 If False, returns the clean original page image.
    """
    res = _gve_request("GET", f"/api/comics/{comic_id}/guided")
    if not res.get("ok"):
        raise ValueError(
            f"Could not retrieve guided data for comic {comic_id}: {res.get('data') or res.get('error')}"
        )

    doc = res.get("data") if isinstance(res.get("data"), dict) else {}
    pages = doc.get("pages", {})
    resolved = _resolve_guided_page(pages, int(page))
    if not resolved:
        raise ValueError(f"Page index {page} is out of bounds (total pages: {len(pages)})")

    page_idx, page_name, page_info = resolved
    raw_bytes, fmt = _gve_page_image(comic_id, page_name)

    if not overlay:
        return Image(data=raw_bytes, format=fmt)

    overlaid_bytes = render_guided_overlay(
        raw_bytes,
        items=page_info.get("items", []),
        order=page_info.get("order", []),
        output_format="PNG",
    )
    return Image(data=overlaid_bytes, format="png")


@mcp.tool()
def inspect_guided_page(comic_id: str, page: int = 0) -> list:
    """Inspect a comic page with visual guided-view overlays and structured coordinate data in a single call.

    Returns the overlaid page image (visual boxes and reading order badges) alongside the structured JSON
    metadata and sequence coordinates for AI visual analysis and user review.

    Args:
        comic_id: Target comic id.
        page: 0-based page index.
    """
    image_obj = get_guided_page_image(comic_id, page=page, overlay=True)
    data_str = get_guided_page_data(comic_id, page=page)
    return [image_obj, data_str]


@mcp.tool()
def apply_guided_page_fix(
    comic_id: str,
    page: int,
    items: list[dict],
    order: Optional[list[str]] = None,
) -> str:
    """Apply updated speech bubble and panel coordinates or ordering to a comic page in GVE Now.

    Args:
        comic_id: Target comic id.
        page: 0-based page index.
        items: List of item dictionaries for the page, each with:
               id: str (e.g. "b1", "p1")
               kind: "bubble" | "panel"
               box: [x, y, w, h] (integer pixel coordinates)
        order: Optional list of item IDs representing reading sequence order.
               If omitted, defaults to the order of items provided.
    """
    res = _gve_request("GET", f"/api/comics/{comic_id}/guided")
    if not res.get("ok"):
        return _dump({
            "ok": False,
            "error": f"Failed to retrieve current guided data for comic {comic_id}",
        })

    doc = res.get("data") if isinstance(res.get("data"), dict) else {}
    pages = doc.get("pages", {})
    resolved = _resolve_guided_page(pages, int(page))
    if not resolved:
        return _dump({
            "ok": False,
            "error": f"Page index {page} is out of bounds (total pages: {len(pages)})",
        })

    page_idx, page_name, page_info = resolved
    item_ids = [it["id"] for it in items if isinstance(it, dict) and "id" in it]

    if order is None:
        order = list(item_ids)
    else:
        if sorted(order) != sorted(item_ids):
            return _dump({
                "ok": False,
                "error": f"order list {order} must be an exact permutation of item ids {item_ids}",
            })

    # Update only the targeted page, leaving all other pages verbatim
    doc["pages"][page_name]["items"] = items
    doc["pages"][page_name]["order"] = order

    put_res = _gve_request("PUT", f"/api/comics/{comic_id}/guided", body=doc)
    if not put_res.get("ok"):
        return _dump({
            "ok": False,
            "error": f"GVE Now rejected update: {put_res.get('data') or put_res.get('error')}",
        })

    return _dump({
        "ok": True,
        "data": {
            "comicId": comic_id,
            "pageIndex": page_idx,
            "pageName": page_name,
            "itemCount": len(items),
            "order": order,
            "warnings": put_res.get("data", {}).get("warnings", []) if isinstance(put_res.get("data"), dict) else [],
        },
    })


@mcp.tool()
def reorder_guided_page(
    comic_id: str,
    page: int,
    order: list[str],
) -> str:
    """Reorder the guided view reading sequence for a specific comic page without altering coordinates.

    Args:
        comic_id: Target comic id.
        page: 0-based page index.
        order: List of existing item IDs representing the desired 1-based reading sequence.
    """
    res = _gve_request("GET", f"/api/comics/{comic_id}/guided")
    if not res.get("ok"):
        return _dump({
            "ok": False,
            "error": f"Failed to retrieve current guided data for comic {comic_id}",
        })

    doc = res.get("data") if isinstance(res.get("data"), dict) else {}
    pages = doc.get("pages", {})
    resolved = _resolve_guided_page(pages, int(page))
    if not resolved:
        return _dump({
            "ok": False,
            "error": f"Page index {page} is out of bounds (total pages: {len(pages)})",
        })

    page_idx, page_name, page_info = resolved
    existing_items = page_info.get("items", [])
    existing_ids = [it["id"] for it in existing_items if isinstance(it, dict) and "id" in it]

    if sorted(order) != sorted(existing_ids):
        return _dump({
            "ok": False,
            "error": f"order list {order} must be an exact permutation of existing item ids {existing_ids}",
        })

    doc["pages"][page_name]["order"] = order

    put_res = _gve_request("PUT", f"/api/comics/{comic_id}/guided", body=doc)
    if not put_res.get("ok"):
        return _dump({
            "ok": False,
            "error": f"GVE Now rejected update: {put_res.get('data') or put_res.get('error')}",
        })

    return _dump({
        "ok": True,
        "data": {
            "comicId": comic_id,
            "pageIndex": page_idx,
            "pageName": page_name,
            "order": order,
            "warnings": put_res.get("data", {}).get("warnings", []) if isinstance(put_res.get("data"), dict) else [],
        },
    })


def main() -> None:
    transport = os.environ.get("MCP_TRANSPORT", "stdio")
    # Default to loopback (127.0.0.1) for security; only bind to 0.0.0.0 if explicitly requested
    host = os.environ.get("MCP_HOST", "127.0.0.1")
    port_str = os.environ.get("MCP_PORT")
    disable_dns_rebinding = os.environ.get("MCP_DISABLE_DNS_REBINDING", "0") == "1"

    if transport in ("sse", "streamable-http") and port_str:
        import uvicorn
        from starlette.applications import Starlette
        from starlette.middleware.cors import CORSMiddleware
        from starlette.routing import Mount

        mcp.settings.host = host
        mcp.settings.port = int(port_str)
        mcp.settings.transport_security = TransportSecuritySettings(
            enable_dns_rebinding_protection=not disable_dns_rebinding
        )
        mcp.settings.streamable_http_path = "/"
        base_app = mcp.streamable_http_app()
        starlette_app = Starlette(
            routes=[
                Mount("/comics-mcp", app=base_app),
                Mount("", app=base_app),
            ],
            lifespan=base_app.router.lifespan_context,
        )
        starlette_app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        OIDC_ISSUER = "https://yourteam.cloudflareaccess.com/cdn-cgi/access/sso/oidc/0000000000000000000000000000000000000000000000000000000000000000"

        OAUTH_PROTECTED_RESOURCE = json.dumps({
            "resource": "http://localhost:3018/comics-mcp",
            "authorization_servers": ["http://localhost:3018/comics-mcp"],
            "scopes_supported": ["openid", "email", "profile"],
        }).encode("utf-8")

        OAUTH_AUTH_SERVER = json.dumps({
            "issuer": OIDC_ISSUER,
            "authorization_endpoint": f"{OIDC_ISSUER}/authorization",
            "token_endpoint": f"{OIDC_ISSUER}/token",
            "jwks_uri": f"{OIDC_ISSUER}/jwks",
            "userinfo_endpoint": f"{OIDC_ISSUER}/userinfo",
            "scopes_supported": ["openid", "email", "profile"],
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code"],
            "token_endpoint_auth_methods": ["client_secret_basic", "client_secret_post"],
        }).encode("utf-8")

        async def app(scope, receive, send):
            if scope["type"] == "http":
                path = scope.get("path", "")
                if "/.well-known/oauth-protected-resource" in path:
                    from starlette.responses import Response
                    res = Response(OAUTH_PROTECTED_RESOURCE, media_type="application/json", headers={"Access-Control-Allow-Origin": "*"})
                    await res(scope, receive, send)
                    return
                if "/.well-known/oauth-authorization-server" in path or "/.well-known/openid-configuration" in path:
                    from starlette.responses import Response
                    res = Response(OAUTH_AUTH_SERVER, media_type="application/json", headers={"Access-Control-Allow-Origin": "*"})
                    await res(scope, receive, send)
                    return
                if path == "/comics-mcp":
                    scope["path"] = "/comics-mcp/"

            await starlette_app(scope, receive, send)

        uvicorn.run(app, host=host, port=int(port_str))
    else:
        mcp.run()


if __name__ == "__main__":
    main()
