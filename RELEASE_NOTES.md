# Comics Now! v4.2.0 Release Notes

Welcome to **Comics Now! v4.2.0** — feature and security release introducing configurable Gemini AI Thinking Levels, strict Flash-Lite model discovery filtering, comprehensive defense-in-depth origin security hardening (SSRF prevention, sidecar proxy path traversal mitigation, thumbnail IDOR authorization), and configuration storage protections.

---

## ✨ What's New & Highlights in v4.2.0

### 1. Configurable Gemini Thinking Levels & Flash-Lite Model Filtering
* **Thinking Level Configuration**: Added configurable `geminiThinkingLevel` (`minimal`, `low`, `medium`, `high`) across backend configs, SQLite `settings` table, API endpoints, and the Admin UI. Allows fine-tuning AI reasoning effort for cover matching, metadata synthesis, and tagger operations.
* **Curated Flash-Lite Model Filtering**: Model discovery (`/api/v1/gemini/models`) now case-insensitively filters Google AI models to Flash-Lite while strictly excluding specialized non-chat variants (Nano and TTS models).

### 2. Comprehensive Origin Security & Access Control Hardening
* **SSRF & Private CIDR Mitigation**: Hardened URL metadata extraction (`isSafeWebUrl` and DNS pre-resolution) to reject RFC 1918 private LAN ranges, alternate loopback/CGNAT/link-local ranges, IPv6 ULA/mapped addresses, and `.internal` hostnames. Disabled automated HTTP redirects on direct fallback fetches.
* **Sidecar Proxy Path Traversal Mitigation**: Added strict character and format validation on `:arcId` and `:comicId` parameters before dispatching upstream proxy requests to the Tag Comics Now service, preventing path traversal attacks.
* **Access Control & Admin Route Alignment**: Enforced `requireAdmin` authentication across metadata synthesis, URL extraction, batch-tagger status/logs, and external search proxy endpoints.
* **Thumbnail IDOR & Access Check Hardening**: Removed unguarded static thumbnail exposure and enforced per-user library access verification (`checkComicAccess`) across cached and on-demand thumbnail generation.
* **Configuration Storage & Key Transport Hardening**: Enforced `0600` file permissions on `config.json` and `comics-now.db` upon creation and save; added support for passing Gemini API keys via `X-Gemini-Api-Key` HTTP header to prevent API key exposure in URL query parameters and proxy logs.

---

## ⬆️ Upgrade Notes
* **No Database Migrations Required**: v4.2.0 is 100% backward-compatible with existing databases and sidecar files.
* **Zero Disruption to User Data**: All user reading lists, reading progress, and custom sort orders remain completely untouched.
* **Automatic Client Update**: Frontend assets are bundled via Vite (`public/dist/`); browsers will automatically load updated scripts.

---

## 📦 v4.2.0 Changelog
1. `feat(gemini)`: configurable thinking levels and strict Flash-Lite model filtering
2. `security(api)`: harden URL metadata extraction against SSRF and private network targeting
3. `security(proxy)`: sanitize route parameters to prevent sidecar path traversal
4. `security(auth)`: enforce admin guard on metadata synthesis, external search, and batch-tagger endpoints
5. `security(thumbnails)`: enforce per-user library access checks on thumbnail generation and serving
6. `security(config)`: restrict configuration and database file permissions to 0600

---

## 🧪 Verification & Test Results
- **Full Jest suite**: `197 suites passed, 1533 tests passed (100% pass rate)`.
- **Architectural invariants**: `tests/architectureRatchet.test.js` verified (100% pass rate).
- **Security & route integration suites**: `tests/urlMetadataExtractor.test.js`, `tests/storyArcsSyncRoute.test.js`, `tests/metadataRoutes.test.js`, `tests/server/routes/static.test.js` verified.
- **Production build**: Tailwind CSS v4 and Vite client bundle compiled cleanly.

---

# Previous Release: Comics Now! v4.1.0

### Story Arcs, Narrative Timelines & Continuity Management
- **Dedicated Story Arcs Smart Filter**: New `⚡ Story Arcs` filter pill in publisher view with Gold/Amber trade dress (`#F59E0B` / `#EF4444`) and real-time library completeness metrics.
- **Story Arc Detail Banner & DAG Visualizer**: Interactive box-set detail banner with Grid, Checklist, and Spine & Orbit Spurs timeline visualizer.
- **In-Reader Continuity Prompts**: "Up Next in Arc" prompt upon reaching the final page of an issue.
- **Tag Comics Now! Source**: `ReadingOrders (Story Arcs)` source for `<StoryArc>`, `<StoryArcNumber>`, and `<SeriesGroup>` ComicInfo enrichment.
- **Dedicated Settings Tab & Crawler**: Multi-publisher crawler engine with live SSE streaming logs and 21-day retention policy.
- **MCP Continuity Tools**: Added 4 FastMCP continuity tools (`list_story_arcs`, `get_story_arc`, `get_story_arc_next`, `trigger_story_arcs_sync`).
- See GitHub Releases for the full v4.0.0 notes.
