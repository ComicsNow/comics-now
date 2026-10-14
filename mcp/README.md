# Comics Now! MCP Server

A Model Context Protocol ([MCP](https://modelcontextprotocol.io)) server that connects the Comics Now! application to an AI coding assistant or client (Claude Code, Claude Desktop, Gemini CLI, Cursor, etc.).

It exposes tools to:
- Search and query the comic library, users, and reading lists.
- View and extract high-resolution cover page images for AI visual analysis.
- Edit, sync, and write comic metadata (`ComicInfo.xml` sidecars or CBZ tags).
- Execute read-only SQL queries (`query_db`) directly against the SQLite database.
- Call any API endpoint with automatic protection against destructive actions.

---

## Setup

```bash
cd mcp
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
cp .env.example .env
```

---

## Configuration (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `COMICS_BASE_URL` | `http://localhost:3000` | Application base URL. |
| `COMICS_DB_PATH` | `../comics-now.db` | Path to the SQLite database (used by `query_db`). |
| `COMICS_ALLOW_DESTRUCTIVE` | `0` | Set to `1` to permit destructive operations (move, delete, migrate). |
| `COMICS_TIMEOUT` | `60` | HTTP request timeout in seconds. |
| `COMICS_EXTRA_HEADERS` | `{}` | Optional JSON dictionary of extra headers (e.g. Cloudflare Service Tokens). |

- **Network mode** (`MCP_TRANSPORT` / `MCP_HOST` / `MCP_PORT`): the default `stdio` transport has no listening port. For network transports (`sse` or `streamable-http`), set `MCP_TRANSPORT`, `MCP_HOST` (default `127.0.0.1`), and `MCP_PORT` (default `8000`) in `.env`.

---

## Client Integration

### Claude Code
```bash
claude mcp add comics-now -- /path/to/comics-now/mcp/run.sh
```

### Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "comics-now": {
      "command": "/path/to/comics-now/mcp/run.sh"
    }
  }
}
```

### Gemini CLI (`~/.gemini/settings.json`)
```json
{
  "mcpServers": {
    "comics-now": {
      "command": "/path/to/comics-now/mcp/run.sh"
    }
  }
}
```

---

## Available Tools

- **Library & Search**: `search_comics`, `library_tree`, `list_users`, `get_user_access`, `list_reading_lists`, `get_reading_list`, `get_settings`, `get_logs`.
- **Reading Lists**: `create_reading_list`, `create_reading_lists_bulk`, `update_reading_list`, `delete_reading_list`, `delete_reading_lists_bulk`, `sync_reading_lists_to_all_users`, `add_comics_to_reading_list`, `remove_comics_from_reading_list`, `reorder_reading_list_comics`.
- **Reading Status**: `set_comic_status`, `set_series_status`, `set_reading_list_read_status`.
- **External Metadata & Tag Comics Now!**:
  - `external_metadata_search(query, source="all")`: Multi-source live search across ComicVine, Metron, AniList, MangaUpdates, League of Comic Geeks, Marvel, and Google Books.
  - `get_metadata_sources()`: Get list and configuration status of supported Tag Comics Now! metadata plugins.
  - `get_tag_comics_now_pending_details()`: Inspect pending Tag Comics Now! background identification job candidate matches and status.
- **Gemini AI Visual Cover Matching**:
  - `get_gemini_status()`: Get Gemini Vision API configuration and status (API key configured, default model, prompt version).
  - `list_gemini_models(api_key=None)`: List available Google Gemini models supported for visual cover matching.
- **Organization & Rules**:
  - `get_organization_rules()`: Get active comic file naming tokens and folder hierarchy rules.
  - `preview_comic_organization(metadata)`: Simulate file naming and folder path organization for a comic without writing any files.
- **Guided View Detection**:
  - `get_guided_status()`: Get Guided View panel detector status, queue size, and active job.
  - `get_guided_logs()`: Retrieve recent logs from the Guided View panel detection worker.
  - `trigger_guided_detection(scope, target, force=False)`: Trigger panel detection across a library, publisher, series, or single comic.
- **Guided View Visual & Coordinate Editing (GVE Now companion)**:
  - `inspect_guided_page(comic_id, page=0)`: Returns the overlaid page image (visual bounding boxes and reading order badges) alongside the structured sequence coordinates.
  - `get_guided_page_image(comic_id, page=0, overlay=True)`: Extracts a page image, optionally rendering speech bubble and panel overlays.
  - `get_guided_page_data(comic_id, page=0)`: Retrieves page dimensions, reading sequence order, and speech/panel bounding boxes.
  - `apply_guided_page_fix(comic_id, page, items, order=None)`: Applies validated speech/panel coordinates and reading sequence fixes to GVE Now with automatic backup.
  - `reorder_guided_page(comic_id, page, order)`: Reorders the active reading sequence for a page without changing box coordinates.
- **Administration & Diagnostics**:
  - `list_libraries()`: List all configured comic root library folders.
  - `get_user_stats(user_id)`: Get detailed reading statistics, read/unread counts, and total pages read for a user.
  - `get_operation_errors()`: Retrieve recent system operation errors, failures, and stack traces.
- **AI Visual Tagging**:
  - `get_cover_image(comic_id, page=0)`: Extracts a high-res cover image for visual inspection.
  - `get_tags(comic_id)` / `get_tags_bulk(comic_ids)`: Reads ComicInfo + database tags.
  - `set_tags(comic_id, fields, storage)` / `set_tags_bulk(...)`: Writes ComicInfo (sidecar XML, CBZ archive, or DB).
  - `tag_workflow()`: Returns step-by-step guidance for cover-driven tagging.
- **AI Reading List Curation**:
  - `curate_reading_order_event(event_name, apply_changes=False)`: Curate an event or crossover reading order (e.g., 'Civil War', 'Knightfall', 'Absolute DC'). Scrapes canonical orders from DC Universe Infinite, Comic Book Reading Orders, Comic Book Herald, and Wikipedia, matches your library's single issues and omnibuses, and enforces multi-series rules.
  - `curate_recent_comics_reading_lists(months=3, apply_changes=False)`: Analyzes newly added/updated comics in the last *X* months. Checks if they complete gaps in your existing reading lists or form new multi-series reading orders.
  - `curate_full_library_reading_lists(unassigned_only=True, apply_changes=False)`: Audits your entire comic collection against major community and editorial reading orders.

---

## AI Reading List Curation

Comics Now! includes an automated reading list curation engine that pulls canonical reading orders from **DC Universe Infinite** (official app collections), **Comic Book Reading Orders**, **Comic Book Herald**, and **Wikipedia**, and matches them against your library.

### Key Rules & Constraints
- **Minimum 3 Comics:** Discards candidate lists if your library contains fewer than 3 matching comics.
- **Multi-Series Required:** Rejects lists where all issues belong to the exact same Series (single-series runs belong in the native Series browser).
- **Cross-Publisher Allowed:** Fully supports cross-publisher events (e.g. DC/Marvel, Batman/TMNT, Aliens vs Predator vs Judge Dredd).
- **Omnibus & Collected Edition Support:** Mappings automatically resolve multi-issue omnibuses and TPBs (e.g. *Batman: Knightfall Vol. 1* covering Batman #491–497) and place them at their earliest chronological position.

### Chat Prompts (Claude Desktop, Claude Code, Gemini CLI)
- *"Curate a reading list for Knightfall in preview mode"*
- *"Check comics added in the last 3 months: should they be added to existing reading lists, or can we create new ones?"*
- *"Audit my whole library for unassigned reading orders"*

### Standalone CLI
You can also run curation directly from the terminal without an LLM:

```bash
cd mcp

# 1. Curate a specific event (dry-run preview)
PYTHONPATH=. .venv/bin/python3 -m comics_mcp.curate --event "Knightfall"

# 2. Check comics added in the last 3 months
PYTHONPATH=. .venv/bin/python3 -m comics_mcp.curate --months 3

# 3. Full library audit
PYTHONPATH=. .venv/bin/python3 -m comics_mcp.curate --all

# 4. Commit changes to Comics Now! and sync across all users
PYTHONPATH=. .venv/bin/python3 -m comics_mcp.curate --event "Knightfall" --commit
```


