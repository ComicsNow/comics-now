"""
Guided View visual inspection and coordinate editing tools
for the Comics Now! MCP server.
"""

from typing import Optional

from mcp.server.fastmcp import Image

from comics_mcp.guided_overlay import render_guided_overlay
from comics_mcp.tools.core import _dump, _resolve_guided_page, _srv, mcp


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
    srv = _srv()
    res = srv._gve_request("GET", f"/api/comics/{comic_id}/guided")
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
    srv = _srv()
    res = srv._gve_request("GET", f"/api/comics/{comic_id}/guided")
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
    raw_bytes, fmt = srv._gve_page_image(comic_id, page_name)

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
    srv = _srv()
    res = srv._gve_request("GET", f"/api/comics/{comic_id}/guided")
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

    put_res = srv._gve_request("PUT", f"/api/comics/{comic_id}/guided", body=doc)
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
    srv = _srv()
    res = srv._gve_request("GET", f"/api/comics/{comic_id}/guided")
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

    put_res = srv._gve_request("PUT", f"/api/comics/{comic_id}/guided", body=doc)
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
