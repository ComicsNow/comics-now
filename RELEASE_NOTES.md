# Comics Now! v4.2.0 Release Notes

Welcome to **Comics Now! v4.2.0** — feature, performance, and security release introducing configurable Gemini AI Thinking Levels, native client-side offline CBR/CBZ extraction with Cache-First Service Worker image delivery and deduplicated preloading, comprehensive defense-in-depth origin security hardening, and configuration storage protections.

---

## ✨ What's New & Highlights in v4.2.0

### 1. Configurable Gemini Thinking Levels
* **Thinking Level Configuration**: Added configurable `geminiThinkingLevel` (`minimal`, `low`, `medium`, `high`) across backend configs, SQLite `settings` table, API endpoints, and the Admin UI. Allows fine-tuning AI reasoning effort for cover matching, metadata synthesis, and tagger operations.

### 2. Comprehensive Origin Security & Access Control Hardening
* **SSRF & Private CIDR Mitigation**: Hardened URL metadata extraction (`isSafeWebUrl` and DNS pre-resolution) to reject RFC 1918 private LAN ranges, alternate loopback/CGNAT/link-local ranges, IPv6 ULA/mapped addresses, and `.internal` hostnames. Disabled automated HTTP redirects on direct fallback fetches.
* **Sidecar Proxy Path Traversal Mitigation**: Added strict character and format validation on `:arcId` and `:comicId` parameters before dispatching upstream proxy requests to the Tag Comics Now service, preventing path traversal attacks.
* **Access Control & Admin Route Alignment**: Enforced `requireAdmin` authentication across metadata synthesis, URL extraction, batch-tagger status/logs, and external search proxy endpoints.
* **Thumbnail IDOR & Access Check Hardening**: Removed unguarded static thumbnail exposure and enforced per-user library access verification (`checkComicAccess`) across cached and on-demand thumbnail generation.
* **Configuration Storage & Key Transport Hardening**: Enforced `0600` file permissions on `config.json`, `comics-now.db`, Gemini settings, and tagger scheduler state upon creation and save; added support for passing Gemini API keys via `X-Gemini-Api-Key` HTTP header to prevent API key exposure in URL query parameters and proxy logs.
* **End-to-End Config & Tagger Secret Encryption**: Enforced automatic AES-256-GCM encryption (`enc:v1:...`) for all API keys and passwords in `config.json` on load, setter invocation, and save; added missing `gcdUser`, `gcdPassword`, and `googleBooksApiKey` settings hydration from SQLite; and scrubbed persisted plaintext secrets from `scheduler_config.json` while masking credentials in tagger scheduler API responses.
* **Archive Conversion & Tagger Boundary Hardening**: Hardened CBR/PDF conversion scripts against filename option injection and archive symlinks (`--`, `-ol-`, `-y`), enforced directory/file containment and symlink checks plus optional internal bearer token verification (`TAGGER_INTERNAL_TOKEN`) in the tagger service, and failed closed on static HTML viewer authentication when auth is enabled.
* **Multi-Layer SSRF, CORS, CSRF & Proxy Protections**: Extended IPv4/IPv6 private-range and redirect blocking across cover proxies, tagger cover comparison, and scraper utilities; restricted MCP server CORS origins (configurable via `MCP_ALLOWED_ORIGINS`) and expanded destructive HTTP verb/keyword guards; tightened Content Security Policy (`object-src`, `base-uri`, `frame-ancestors`); and added same-origin CSRF checks and rate limiting on outbound proxy endpoints.
* **User Access Bounds, Cache Privacy, XSS & XML Hardening**: Marked page image responses `Cache-Control: private, max-age=3600` with `Vary: Cookie, Authorization`, cleared offline download caches and hardened cookie attributes on impersonation switches, bounded story-arc continuity/reading-directory/reading-list queries to user library permissions, escaped story-arc UI interpolations against XSS, and enforced a 2MB size limit with DTD/ENTITY blocking on `ComicInfo.xml` parsing.

### 3. Offline CBR/CBZ Playback, Service Worker Caching & Preloading Reliability
* **Native Client-Side CBR & CBZ Extraction**: Added unified archive extraction (`archive-extractor.js` + `unrar.wasm`) using `JSZip` for `.cbz` and `node-unrar-js` WebAssembly for `.cbr`, enabling offline downloaded and local `.cbr` comics to open and stream pages natively in the browser without server-side transcoding.
* **Cache-First Service Worker Media Delivery & Schema Parity**: Switched `/api/v1/comics/pages/image` and `/thumbnails/` to Cache-First with bounded cache trimming (800 entries), added a 1500ms timeout guard on `/guided-view` network-first fetches, removed dead Service Worker Background Sync stubs, and aligned `openDownloadDB()` to initialize all 8 IndexedDB object stores.
* **Deduplicated Preloading, Memory-First Cache & Object URL Cleanup**: Shared in-flight `Image` loads between background preloading and `renderPage()`, checked in-memory archive caches before reading IndexedDB/File handles, revoked evicted `blob:` URLs via `URL.revokeObjectURL()`, enabled lookahead preloading for local device comics, added next-issue cover prefetching on the final two pages, and retained unsynced offline progress records on transient path lookup failures.

### 4. Story Arcs Continuity, Per-Run Scan Audits & Metadata Reliability
* **Multi-Arc `<StoryArcs>` Metadata & Scoped Batch Enrichment**: Added `<StoryArcs>` XML serialization and SQLite metadata persistence for comics spanning multiple story arcs (preserving `<StoryArc>` and `<StoryArcNumber>` for the primary arc while merging all matched arcs), added incremental batch enrichment scopes (`all`, `since_last_run`, `since_date`, `new_arcs`) with persisted watermark state, and removed legacy `dryRun` simulation paths.
* **Persistent Story Arcs Sync Timestamp**: Persisted `last_sync_time` and `sitemap_etag` in `reading_order_meta` across service restarts (with automatic recovery from existing sync timestamps) and fixed Unix seconds-to-milliseconds formatting in the Settings UI.
* **Per-Run Recent Scan Audits & Status Filtering**: Consolidated batch tagger scans into a single `scan_log_<id>.json` entry per run via `POST /api/logs` (suppressing per-comic log writes with `skip_scan_log`), made **Recent Scan Audits** expandable per run to inspect individual comic results, added **All**, **Successful**, **Failed**, and **Skipped** per-run filter controls, and surfaced the 21-day log retention policy.
* **Gemini Cover & Tagger Candidate Evaluation**: Removed the 5-candidate cap and `lower_threshold: 0.30` override so Gemini evaluation considers full candidate sets cleanly.

### 5. Reliability, Bug Fixes & Code Architecture Refinements
* **Library Preferences & Continuous Mode Fixes**: Normalized array-shaped user library preferences in Settings defaults so saved per-library reading modes load accurately, and persisted per-comic Continuous Scroll toggles to `/api/v1/comics/continuous-mode`.
* **Reading List Filter & Template Hardening**: Fixed reading list modal search/publisher filtering to always reflect freshly reloaded lists, escaped cover/thumbnail URL attributes in reading list cards, and hardened offline/settings `safeHtml` fallback renderers against HTML injection.
* **Module & Client Decoupling**: Replaced global `fetch` monkey-patching in the tagger bridge with an explicit `taggerFetch` client wrapper, fixed the Story Arcs publishers endpoint connection handling, broke a frontend UI module circular import, standardized top-level module imports across Node/Python services, and removed orphaned modules and unused `/_ext/*` route aliases.
* **Navigation, Breadcrumb & Search Enhancements**: Moved underlined ancestor-only breadcrumbs between the app title and action buttons, positioned view titles directly below the search bar, removed the redundant series continuity strip, and added Reading Lists and Story Arcs to library search and the search field dropdown.
* **Direct CBR/PDF Conversion & Zip Argument Ordering**: Fixed Info-ZIP `--` argument ordering across `ComicInfo.xml` archive updates and conversion scripts, and refactored `library-conversion.js` to invoke `unrar`, `pdftoppm`, and `zip` directly from Node.js with temporary directory cleanup.

---

## ⬆️ Upgrade Notes
* **No Database Migrations Required**: v4.2.0 is 100% backward-compatible with existing databases and sidecar files.
* **Zero Disruption to User Data**: All user reading lists, reading progress, and custom sort orders remain completely untouched.
* **Automatic Client Update**: Frontend assets are bundled via Vite (`public/dist/`); browsers will automatically load updated scripts.

---

## 📦 v4.2.0 Changelog
1. `feat(gemini)`: configurable thinking levels
2. `security(api)`: harden URL metadata extraction against SSRF and private network targeting
3. `security(proxy)`: sanitize route parameters to prevent sidecar path traversal
4. `security(auth)`: enforce admin guard on metadata synthesis, external search, and batch-tagger endpoints
5. `security(thumbnails)`: enforce per-user library access checks on thumbnail generation and serving
6. `security(config)`: restrict configuration and database file permissions to 0600
7. `security(secrets)`: auto-encrypt plaintext secrets in config.json on load/save and scrub/mask tagger scheduler_config.json credentials
8. `feat(offline)`: native client-side CBR/CBZ extraction via WebAssembly and offline progress retention
9. `perf(viewer)`: Cache-First SW image delivery, deduplicated in-flight page preloading, blob URL cleanup, and next-issue cover prefetching
10. `feat(story-arcs)`: add multi-arc `<StoryArcs>` XML/DB persistence, scoped batch enrichment, and persistent sync timestamp
11. `feat(tagger-ui)`: add per-run Recent Scan Audits inspection with Successful/Failed/Skipped filtering and 21-day retention display
12. `fix(gemini)`: remove 5-candidate cap and `lower_threshold` override in cover/tagger evaluation
13. `fix(tagger)`: consolidate batch scan audit logs into one entry per run
14. `security(scripts,tagger)`: harden archive conversion scripts against argument/symlink injection and enforce tagger path containment and internal token auth
15. `security(ssrf,cors,csrf)`: tighten IPv6/redirect SSRF blocking, MCP CORS/destructive-action guards, Helmet CSP directives, outbound proxy rate limits, and same-origin CSRF checks
16. `security(authz,cache,xss,xml)`: scope story-arc/reading-list access bounds, mark page caches private, clear SW caches on impersonation, escape story-arc UI templates, and reject DTD/ENTITY or >2MB `ComicInfo.xml` payloads
17. `fix(ui,settings)`: normalize array library preferences, persist per-comic continuous mode toggles, fix stale reading-list modal filters, and harden `safeHtml`/image attribute escaping
18. `refactor(core,tagger,mcp)`: replace global `fetch` monkey-patching with explicit `taggerFetch`, fix Story Arcs publishers DB connection handling, eliminate circular/inline imports, and prune orphaned modules and `/_ext/*` aliases

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
