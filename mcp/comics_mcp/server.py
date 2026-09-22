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

# --- Configuration (env-driven) ---------------------------------------------

BASE_URL = os.environ.get("COMICS_BASE_URL", "http://localhost:3000").rstrip("/")
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


def _http() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(
            base_url=BASE_URL, timeout=TIMEOUT, headers=EXTRA_HEADERS
        )
    return _client


# Endpoints that mutate/destroy data on disk. Blocked via call_api unless
# COMICS_ALLOW_DESTRUCTIVE=1. (method, compiled path regex)
_DESTRUCTIVE = [
    ("POST", re.compile(r"/api/v1/move-comics$")),
    ("POST", re.compile(r"/api/v1/move/")),
    ("POST", re.compile(r"/api/v1/rename-cbz$")),
    ("POST", re.compile(r"/api/v1/comictagger/(apply|run|match-covers|schedule|skip)$")),
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
def comictagger_pending() -> str:
    """Get comics pending tagger review / the current pending match."""
    return _dump(_request("GET", "/api/v1/comictagger/pending"))


@mcp.tool()
def comicvine_search(query: str) -> str:
    """Search ComicVine (external metadata source) for a series/issue."""
    return _dump(
        _request("GET", "/api/v1/search/comicvine", params={"query": query})
    )


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
# Cover-driven identification (no ComicTagger/ComicVine): the model extracts the
# cover image, recognises it (title, issue #, publisher, cover artist, logos,
# distinctive art), confirms the exact series/issue via web search, then writes
# the metadata back with set_tags.

TAG_WORKFLOW_DOC = """\
Identify-and-tag a comic from its cover, without ComicTagger/ComicVine:

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


def main() -> None:
    transport = os.environ.get("MCP_TRANSPORT", "stdio")
    # Default to loopback (127.0.0.1) for security; only bind to 0.0.0.0 if explicitly requested
    host = os.environ.get("MCP_HOST", "127.0.0.1")
    port_str = os.environ.get("MCP_PORT")
    disable_dns_rebinding = os.environ.get("MCP_DISABLE_DNS_REBINDING", "0") == "1"

    if transport in ("sse", "streamable-http") and port_str:
        mcp.settings.host = host
        mcp.settings.port = int(port_str)
        mcp.settings.transport_security = TransportSecuritySettings(
            enable_dns_rebinding_protection=not disable_dns_rebinding
        )
        mcp.run(transport=transport)
    else:
        mcp.run()


if __name__ == "__main__":
    main()
