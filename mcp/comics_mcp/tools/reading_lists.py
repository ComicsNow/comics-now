"""
Reading lists CRUD, ordering, bulk actions, and autonomous curation tools
for the Comics Now! MCP server.
"""

from typing import Optional

from comics_mcp import reading_curator
from comics_mcp.tools.core import _dump, _srv, mcp


@mcp.tool()
def list_reading_lists() -> str:
    """List the current user's reading lists with counts."""
    return _dump(_srv()._request("GET", "/api/v1/reading-lists"))


@mcp.tool()
def get_reading_list(list_id: str) -> str:
    """Get a single reading list and its comics."""
    return _dump(_srv()._request("GET", f"/api/v1/reading-lists/{list_id}"))


@mcp.tool()
def create_reading_list(
    name: str, description: str = "", comic_ids: Optional[list[str]] = None
) -> str:
    """Create a new reading list, optionally seeded with comic IDs. Automatically synced to all users."""
    body = {"name": name, "description": description}
    if comic_ids:
        body["comicIds"] = comic_ids
    return _dump(_srv()._request("POST", "/api/v1/reading-lists", body=body))


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
        _srv()._request(
            "POST",
            "/api/v1/admin/reading-lists/sync-to-all",
            body={"overwrite": bool(overwrite), "prune": bool(prune)},
        )
    )


@mcp.tool()
def delete_reading_list_globally(name_or_id: str) -> str:
    """Delete a reading list across ALL user accounts in Comics Now! by list name or list ID."""
    return _dump(
        _srv()._request(
            "POST",
            "/api/v1/admin/reading-lists/delete-globally",
            body={"name": name_or_id},
        )
    )


@mcp.tool()
def add_comics_to_reading_list(list_id: str, comic_ids: list[str]) -> str:
    """Add one or more comics to an existing reading list."""
    return _dump(
        _srv()._request(
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
    return _dump(_srv()._request("PUT", f"/api/v1/reading-lists/{list_id}", body=body))


@mcp.tool()
def delete_reading_list(list_id: str) -> str:
    """Delete a reading list by its ID."""
    return _dump(_srv()._request("DELETE", f"/api/v1/reading-lists/{list_id}"))


@mcp.tool()
def remove_comics_from_reading_list(list_id: str, comic_ids: list[str]) -> str:
    """Remove one or more comics from a reading list."""
    return _dump(
        _srv()._request(
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
        _srv()._request(
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
        _srv()._request(
            "PUT",
            "/api/v1/reading-lists/reorder",
            body={"listOrder": list_ids},
        )
    )


@mcp.tool()
def set_reading_list_read_status(list_id: str, read: bool = True) -> str:
    """Mark all comics in a reading list as read (read=True) or unread (read=False)."""
    return _dump(
        _srv()._request(
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
        _srv()._request(
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
        _srv()._request(
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
        _srv()._request(
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
        _srv()._request(
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
        _srv()._request(
            "POST",
            "/api/v1/reading-lists/mark-read-bulk",
            body={"listIds": list_ids, "read": bool(read)},
        )
    )
