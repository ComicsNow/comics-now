"""
Library, users, settings, external search, Gemini configuration, organization
rules, and Guided View job status tools for the Comics Now! MCP server.
"""

from typing import Optional

from comics_mcp.tools.core import _dump, _srv, mcp


@mcp.tool()
def search_comics(query: str) -> str:
    """Search the library for comics matching a text query (title/series/etc.)."""
    return _dump(_srv()._request("GET", "/api/v1/search", params={"query": query}))


@mcp.tool()
def library_tree() -> str:
    """Return the full library hierarchy: root folders -> publishers -> series
    (metadata mode) or folders/comics (folder mode)."""
    return _dump(_srv()._request("GET", "/api/v1/library-tree"))


@mcp.tool()
def list_users() -> str:
    """List all users (userId, email, role, timestamps)."""
    return _dump(_srv()._request("GET", "/api/v1/users"))


@mcp.tool()
def get_user_access(user_id: str) -> str:
    """Get a user's library access grants (root_folder/publisher/series rows)."""
    return _dump(_srv()._request("GET", f"/api/v1/users/{user_id}/access"))


@mcp.tool()
def get_settings() -> str:
    """Get application settings (scan interval, formats, metadata storage, ...)."""
    return _dump(_srv()._request("GET", "/api/v1/settings"))


@mcp.tool()
def get_logs(level: str = "ALL", category: str = "ALL") -> str:
    """Fetch recent server logs, optionally filtered by level and category."""
    return _dump(
        _srv()._request(
            "GET", "/api/v1/logs", params={"level": level, "category": category}
        )
    )


@mcp.tool()
def tag_comics_now_pending() -> str:
    """Get comics pending Tag Comics Now! review / the current pending match."""
    return _dump(_srv()._request("GET", "/api/v1/tag-comics-now/pending"))


@mcp.tool()
def comicvine_search(query: str) -> str:
    """Search ComicVine (external metadata source) for a series/issue."""
    return _dump(
        _srv()._request("GET", "/api/v1/search/comicvine", params={"query": query})
    )


@mcp.tool()
def external_metadata_search(query: str, source: str = "all") -> str:
    """Search for comic metadata across external databases.

    Args:
        query: Comic title / series search string.
        source: Metadata source to query ("all", "comicvine", "metron", or "gcd").
    """
    return _dump(
        _srv()._request("GET", "/api/v1/search/external", params={"query": query, "source": source})
    )


@mcp.tool()
def get_metadata_sources() -> str:
    """Get all available external metadata sources and their configuration status."""
    return _dump(_srv()._request("GET", "/api/v1/tag-comics-now/sources"))


@mcp.tool()
def get_tag_comics_now_pending_details() -> str:
    """Get full details, candidates, cover URLs, and match confidence for the comic currently pending review."""
    return _dump(_srv()._request("GET", "/api/v1/tag-comics-now/pending-details"))


@mcp.tool()
def get_gemini_status() -> str:
    """Get Gemini AI cover-matching status, model configuration, daily quota cap, and usage today."""
    return _dump(_srv()._request("GET", "/api/v1/gemini/config"))


@mcp.tool()
def list_gemini_models(api_key: Optional[str] = None) -> str:
    """List available Google Gemini models supported for visual cover matching."""
    params = {}
    if api_key:
        params["apiKey"] = api_key
    return _dump(_srv()._request("GET", "/api/v1/gemini/models", params=params if params else None))


@mcp.tool()
def get_organization_rules() -> str:
    """Get active comic file naming tokens and folder hierarchy rules."""
    srv = _srv()
    naming = srv._request("GET", "/api/v1/tag-comics-now/naming-rules")
    folder = srv._request("GET", "/api/v1/tag-comics-now/folder-rules")
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

    srv = _srv()
    filename_resp = srv._request("POST", "/api/v1/tag-comics-now/naming-preview", body={"metadata": normalized})
    folder_resp = srv._request("POST", "/api/v1/tag-comics-now/folder-preview", body={"metadata": normalized})

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
    return _dump(_srv()._request("GET", "/api/v1/guided/status"))


@mcp.tool()
def get_guided_logs() -> str:
    """Fetch recent Guided View detection logs."""
    return _dump(_srv()._request("GET", "/api/v1/guided/logs"))


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
        _srv()._request(
            "POST",
            "/api/v1/guided/run-scope",
            body={"scope": scope, "target": target, "force": bool(force)},
        )
    )


@mcp.tool()
def list_libraries() -> str:
    """List all configured comic libraries, root paths, and settings."""
    return _dump(_srv()._request("GET", "/api/v1/admin/libraries"))


@mcp.tool()
def get_user_stats(user_id: str) -> str:
    """Get reading statistics for a user (total read, pages read, series progress)."""
    return _dump(_srv()._request("GET", f"/api/v1/users/{user_id}/stats"))


@mcp.tool()
def get_operation_errors() -> str:
    """Get background operation errors (file move, rename, scan, or tagging errors)."""
    return _dump(_srv()._request("GET", "/api/v1/operation-errors"))


@mcp.tool()
def trigger_scan(full: bool = False) -> str:
    """Trigger a library scan. Set full=True for a complete rescan."""
    return _dump(_srv()._request("POST", "/api/v1/scan", body={"full": bool(full)}))


@mcp.tool()
def set_user_access(user_id: str, access: list[dict]) -> str:
    """Replace a user's library access grants.

    `access` is a list of {accessType, accessValue, direct_access, child_access}.
    accessType is one of root_folder/publisher/series (metadata mode) or
    folder/comic (folder mode). For metadata mode, a publisher/series grant with
    child_access=true grants that publisher/series globally.
    """
    return _dump(
        _srv()._request("POST", f"/api/v1/users/{user_id}/access", body={"access": access})
    )


@mcp.tool()
def set_comic_status(comic_id: str, status: str) -> str:
    """Set a comic's read status (e.g. "read" / "unread")."""
    return _dump(
        _srv()._request(
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
        _srv()._request(
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
