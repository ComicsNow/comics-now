# Comics Now! v2.4.2 Release Notes

Welcome to **Comics Now! v2.4.2** — a performance and infrastructure patch release that optimizes core database queries for library browsing and search, while standardizing MCP server transport.

---

## 🌟 Highlights

### 1. Database Query Optimization with LEFT JOIN
* **Consolidated Queries**: In `server/services/library.js` (`buildLibrary`) and `server/routes/user/library.js` (`/api/v1/search`), comic retrieval and user reading progress (`user_comic_status`) are now fetched in a single unified SQL query using a `LEFT JOIN`.
* **Zero Memory Bloat**: Eliminates the previous pattern of pulling the user's entire reading history into Node.js memory and iterating over dictionary maps.
* **Instant Search Filtering**: For search requests, SQLite filters matching comic records first and only joins user progress for matching rows via the composite primary key index `(userId, comicId)`.
* **Data Parity**: Seamless fallback behavior and full cross-device reading progress sync compatibility are completely preserved.

### 2. Standardized MCP Server SSE Transport
* **Comics MCP Service**: Added native support for Server-Sent Events (SSE) transport in `comics_mcp` running on port 3018, standardizing streaming transports across companion MCP servers.

---

## 📦 Changelog

### Performance & Database
- `perf(db)`: optimize library and search database queries with LEFT JOIN (#131)

### Infrastructure & MCP
- `feat(mcp)`: support sse transport for comics-mcp

---

## 🧪 Verification & Test Results
- **Node.js / Jest**: **124 of 124 test suites passed** (1,007 of 1,007 tests passed).
- **Python / MCP**: **30 of 30 tests passed**.
- **Data Safety**: 100% compliant with Comics Now Rules 1 & 2. Zero deletions or modifications to user reading progress, reading lists, or comic files.
