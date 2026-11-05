"""
Core configuration, HTTP/DB helpers, and generic tools (`call_api`, `query_db`)
for the Comics Now! MCP server.
"""

import json
import os
import re
import sqlite3
import sys
from typing import Any, Optional

import httpx
from mcp.server.fastmcp import FastMCP

# --- Configuration (env-driven) ---------------------------------------------

BASE_URL = os.environ.get("COMICS_BASE_URL", "http://localhost:3000").rstrip("/")
GVE_BASE_URL = os.environ.get("GVE_BASE_URL", "http://localhost:3100").rstrip("/")
_DEFAULT_DB = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "comics-now.db")
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


def _srv():
    return sys.modules.get("comics_mcp.server") or sys.modules[__name__]


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
        resp = _srv()._gve_http().request(
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
    resp = _srv()._gve_http().request("GET", url, params={"page": page_name})
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
    ("POST", re.compile(r"/api/v1/tag-comics-now/(apply|run|run-file|match-covers|schedule|skip)$")),
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
    srv = _srv()
    url = srv.BASE_URL.rstrip("/") + "/" + path.lstrip("/")
    resp = srv._http().request(method.upper(), url, params=params, json=body)
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
    srv = _srv()
    if srv._is_destructive(method, path) and not srv.ALLOW_DESTRUCTIVE:
        return _dump(
            {
                "blocked": True,
                "reason": "Destructive endpoint blocked. Start the MCP server "
                "with COMICS_ALLOW_DESTRUCTIVE=1 to permit this.",
                "method": method.upper(),
                "path": path,
            }
        )
    return _dump(srv._request(method, path, params=query, body=body))


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
    srv = _srv()
    try:
        conn = sqlite3.connect(f"file:{srv.DB_PATH}?mode=ro", uri=True)
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
