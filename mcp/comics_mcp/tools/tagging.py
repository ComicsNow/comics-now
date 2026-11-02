"""
Cover-driven identification, ComicInfo tagging, and web URL metadata extraction
tools for the Comics Now! MCP server.
"""

from typing import Any, Optional

from mcp.server.fastmcp import Image

from comics_mcp.tools.core import _dump, _srv, mcp

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
    srv = _srv()
    listing = srv._request("GET", f"/api/v1/comics/{comic_id}/guided-pages")
    data = listing.get("data") if isinstance(listing, dict) else None
    pages = data.get("pages") if isinstance(data, dict) else None
    if not pages:
        raise ValueError(f"Could not list pages for comic {comic_id}: {listing}")
    idx = max(0, min(int(page), len(pages) - 1))
    page_name = pages[idx]["name"]

    url = srv.BASE_URL.rstrip("/") + f"/api/v1/comics/{comic_id}/page-image"
    resp = srv._http().request("GET", url, params={"page": page_name})
    resp.raise_for_status()
    ctype = resp.headers.get("content-type", "image/jpeg")
    fmt = "png" if "png" in ctype else ("webp" if "webp" in ctype else "jpeg")
    return Image(data=resp.content, format=fmt)


@mcp.tool()
def get_tags(comic_id: str) -> str:
    """Read a comic's current ComicInfo metadata (from sidecar/zip) plus the DB
    metadata, publisher, series and tag status."""
    return _dump(_srv()._request("GET", f"/api/v1/comics/{comic_id}/tags"))


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
        _srv()._request(
            "POST",
            f"/api/v1/comics/{comic_id}/tags",
            body={"fields": fields, "storage": storage},
        )
    )


@mcp.tool()
def extract_metadata_from_url(url: str, filename: Optional[str] = None) -> str:
    """Extract and synthesize ComicInfo metadata from a web page URL (e.g. Comic Vine,
    League of Comic Geeks, DC/Marvel Fandom, Goodreads, publisher site) using Jina Reader and Gemini AI.

    Args:
        url: Direct web URL of the comic page (must start with http:// or https://).
        filename: Optional comic filename (e.g. 'Batman 001 (2016).cbz') to assist extraction.
    """
    body = {"url": url}
    if filename:
        body["filename"] = filename
    return _dump(_srv()._request("POST", "/api/v1/metadata/extract-from-url", body=body))


@mcp.tool()
def tag_comic_from_url(comic_id: str, url: str, storage: str = "sidecar") -> str:
    """Extract metadata from a web URL using Gemini and write ComicInfo tags to the comic in one step.

    Scrapes clean markdown from the provided web URL (Comic Vine, League of Comic Geeks,
    DC/Marvel Fandom, Goodreads, etc.), uses Gemini AI to synthesize canonical ComicInfo
    fields, and saves the tags to the comic via sidecar XML, CBZ archive, or DB.
    Also tracks usage against the daily Gemini AI quota counter.

    Args:
        comic_id: Target comic ID.
        url: Direct web URL of the comic page (must start with http:// or https://).
        storage: "sidecar" (adjacent .ComicInfo.xml, default), "db" (database only),
                 or "archive" (repack ComicInfo.xml INTO the .cbz archive).
    """
    srv = _srv()
    # 1. Fetch current comic tags & filename
    tags_resp = srv._request("GET", f"/api/v1/comics/{comic_id}/tags")
    comic_data = tags_resp.get("data", {}) if isinstance(tags_resp, dict) else {}
    filename = comic_data.get("name") or "Comic.cbz"
    existing_meta = comic_data.get("dbMetadata") or {}

    # 2. Extract metadata via web URL endpoint
    extract_resp = srv._request(
        "POST",
        "/api/v1/metadata/extract-from-url",
        body={"url": url, "filename": filename, "existingMeta": existing_meta},
    )
    extract_data = extract_resp.get("data", {}) if isinstance(extract_resp, dict) else {}
    extracted_fields = extract_data.get("metadata")

    if not extracted_fields or not isinstance(extracted_fields, dict):
        raise ValueError(f"Failed to extract metadata from {url}: {extract_resp}")

    # 3. Apply extracted tags to comic
    apply_resp = srv._request(
        "POST",
        f"/api/v1/comics/{comic_id}/tags",
        body={"fields": extracted_fields, "storage": storage},
    )

    return _dump({
        "status": 200,
        "ok": True,
        "data": {
            "comicId": comic_id,
            "url": url,
            "storage": storage,
            "fields": extracted_fields,
            "dailyUsed": extract_data.get("dailyUsed"),
            "applyResult": apply_resp.get("data") if isinstance(apply_resp, dict) else apply_resp,
        }
    })


@mcp.tool()
def get_tags_bulk(comic_ids: list[str]) -> str:
    """Read ComicInfo metadata (from sidecar/zip) plus DB metadata for multiple comics in a single batch request.

    Args:
        comic_ids: List of comic IDs to fetch metadata for.
    """
    return _dump(
        _srv()._request(
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
    return _dump(_srv()._request("POST", "/api/v1/comics/tags/bulk", body=body))
