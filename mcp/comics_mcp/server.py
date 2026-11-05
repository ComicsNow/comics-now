"""
Comics Now! MCP server entrypoint and tool hub.

Exposes the Comics Now! app to an MCP client (Claude, Gemini, ChatGPT, ...) as:
  - curated tools for the highest-value actions/queries,
  - a generic `call_api` escape hatch for any of the ~90 REST endpoints,
  - a read-only `query_db` tool over the app's SQLite database.
"""

import os

import uvicorn
from mcp.server.fastmcp import FastMCP, Image
from mcp.server.transport_security import TransportSecuritySettings
from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.routing import Mount

from comics_mcp.guided_overlay import render_guided_overlay
from comics_mcp.tools.core import (
    ALLOW_DESTRUCTIVE,
    BASE_URL,
    DB_PATH,
    EXTRA_HEADERS,
    GVE_BASE_URL,
    TIMEOUT,
    _DEFAULT_DB,
    _DESTRUCTIVE,
    _DESTRUCTIVE_EXEMPTIONS,
    _client,
    _dump,
    _gve_client,
    _gve_http,
    _gve_page_image,
    _gve_request,
    _http,
    _is_destructive,
    _request,
    _resolve_guided_page,
    call_api,
    mcp,
    query_db,
)
from comics_mcp.tools.guided_view import (
    apply_guided_page_fix,
    get_guided_page_data,
    get_guided_page_image,
    inspect_guided_page,
    reorder_guided_page,
)
from comics_mcp.tools.library import (
    comicvine_search,
    external_metadata_search,
    get_gemini_status,
    get_guided_logs,
    get_guided_status,
    get_logs,
    get_metadata_sources,
    get_operation_errors,
    get_organization_rules,
    get_settings,
    get_tag_comics_now_pending_details,
    get_user_access,
    get_user_stats,
    library_tree,
    list_gemini_models,
    list_libraries,
    list_users,
    preview_comic_organization,
    search_comics,
    set_comic_status,
    set_series_status,
    set_user_access,
    tag_comics_now_pending,
    trigger_guided_detection,
    trigger_scan,
)
from comics_mcp.tools.reading_lists import (
    add_comics_to_reading_list,
    add_comics_to_reading_lists_bulk,
    create_reading_list,
    create_reading_lists_bulk,
    curate_full_library_reading_lists,
    curate_reading_order_event,
    curate_recent_comics_reading_lists,
    delete_reading_list,
    delete_reading_list_globally,
    delete_reading_lists_bulk,
    get_reading_list,
    list_reading_lists,
    remove_comics_from_reading_list,
    remove_comics_from_reading_lists_bulk,
    reorder_reading_list_comics,
    reorder_reading_lists,
    set_reading_list_read_status,
    set_reading_lists_read_status_bulk,
    sync_reading_lists_to_all_users,
    update_reading_list,
)
from comics_mcp.tools.tagging import (
    TAG_WORKFLOW_DOC,
    extract_metadata_from_url,
    get_cover_image,
    get_tags,
    get_tags_bulk,
    run_tag_search,
    set_tags,
    set_tags_bulk,
    tag_comic_from_url,
    tag_workflow,
)


def main() -> None:
    transport = os.environ.get("MCP_TRANSPORT", "stdio")
    # Default to loopback (127.0.0.1) for security; only bind to 0.0.0.0 if explicitly requested
    host = os.environ.get("MCP_HOST", "127.0.0.1")
    port_str = os.environ.get("MCP_PORT")
    disable_dns_rebinding = os.environ.get("MCP_DISABLE_DNS_REBINDING", "0") == "1"

    if transport == "sse" and port_str:
        mcp.settings.host = host
        mcp.settings.port = int(port_str)
        mcp.settings.transport_security = TransportSecuritySettings(
            enable_dns_rebinding_protection=not disable_dns_rebinding
        )
        base_app = mcp.sse_app()
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

        uvicorn.run(starlette_app, host=host, port=int(port_str))
    elif transport == "streamable-http" and port_str:
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
                Mount("/sse", app=base_app),
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

        async def app(scope, receive, send):
            if scope["type"] == "http":
                path = scope.get("path", "")
                if path == "/comics-mcp":
                    scope["path"] = "/comics-mcp/"
                if path == "/sse":
                    scope["path"] = "/sse/"

            await starlette_app(scope, receive, send)

        uvicorn.run(app, host=host, port=int(port_str))
    else:
        mcp.run()


if __name__ == "__main__":
    main()
