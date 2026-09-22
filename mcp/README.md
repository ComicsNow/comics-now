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
- **AI Visual Tagging**:
  - `get_cover_image(comic_id, page=0)`: Extracts a high-res cover image for visual inspection.
  - `get_tags(comic_id)` / `get_tags_bulk(comic_ids)`: Reads ComicInfo + database tags.
  - `set_tags(comic_id, fields, storage)` / `set_tags_bulk(...)`: Writes ComicInfo (sidecar XML, CBZ archive, or DB).
  - `tag_workflow()`: Returns step-by-step guidance for cover-driven tagging.
- **Database Query**: `query_db(sql, limit)`: Runs read-only SELECT / PRAGMA queries.
- **REST API Escape Hatch**: `call_api(method, path, query, body)`: Directly invokes REST endpoints (destructive paths require `COMICS_ALLOW_DESTRUCTIVE=1`).
