"""
Story Arcs and Narrative Continuity tools for the Comics Now! MCP server.
Integrates ReadingOrders.com continuity data and library completeness.
"""

from typing import Optional

from comics_mcp.tools.core import _dump, _srv, mcp


@mcp.tool()
def list_story_arcs(publisher: Optional[str] = None, search: Optional[str] = None) -> str:
    """List canonical story arcs and reading orders with library completeness percentage."""
    params = {}
    if publisher:
        params["publisher"] = publisher
    if search:
        params["search"] = search
    return _dump(_srv()._request("GET", "/api/v1/story-arcs", params=params))


@mcp.tool()
def get_story_arc(arc_id: str) -> str:
    """Get full details, ordered single issues, collected editions, and matched local comic IDs for a story arc."""
    return _dump(_srv()._request("GET", f"/api/v1/story-arcs/{arc_id}"))


@mcp.tool()
def get_story_arc_next(comic_id: str) -> str:
    """Get the next chronological issue in the story arc for a comic currently being read."""
    return _dump(_srv()._request("GET", f"/api/v1/story-arcs/continuity/next/{comic_id}"))


@mcp.tool()
def trigger_story_arcs_sync(mode: str = "both") -> str:
    """Trigger an autonomous delta crawl of reading orders from readingorders.com with rate limiting."""
    return _dump(_srv()._request("POST", "/api/v1/story-arcs/sync", body={"mode": mode}))
