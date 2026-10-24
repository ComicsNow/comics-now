# Comics Now! v2.1.0 Release Notes

Welcome to **Comics Now! v2.1.0** — a major feature and performance release introducing **Web URL Metadata Tagging with Gemini AI**, **High-Throughput SQLite Performance Tuning**, **Multi-Source Metadata Synthesis**, **Streamlined Card Typography**, **Continuous Reader Stabilization**, **Asynchronous Event-Loop Non-Blocking I/O**, and **Modal & UI Accessibility Enhancements**.

---

## 🌟 Highlights

### 1. Web URL Metadata Tagging & Comics MCP
* **Tag from Any URL**: Seamlessly tag comic issues by passing web links (comic solicitations, fandom wikis, publisher previews, or review pages).
* **Gemini AI Synthesis**: Automatically parses and structures web content into standardized ComicInfo metadata, matching series, issue numbers, creators, and synopsis.
* **Live Daily Quota Tracking**: Web URL requests count toward the daily Gemini AI quota, displayed in real-time in **Settings $\rightarrow$ Tag Comics Now! $\rightarrow$ Gemini AI**.
* **New Comics MCP Tools**:
  - `tag_comic_from_url(comic_id, url, storage)`: One-step comic tagging from any web link.
  - `extract_metadata_from_url(url, filename)`: Web URL metadata extraction dry-run.

### 2. High-Throughput SQLite & Database Optimization
* **Zero-Scan Indexing**: Added 4 non-destructive covering and composite indexes:
  - `idx_reading_list_items_list_sort`: Eliminates temporary B-Tree sorts for reading lists and DAG rendering.
  - `idx_reading_lists_user_sort`: Eliminates full table scans on reading list views.
  - `idx_comics_publisher_series`: Answers library grouping directly from a covering index.
  - `idx_user_comic_status_comic`: Replaces full table scans with instant indexed searches on comic progress.
* **Batch Operations & N+1 Query Elimination**:
  - **Transaction-Wrapped Progress Updates**: Marks entire series as read/unread inside a single SQLite transaction, reducing disk syncs from $N$ to 1 (over 10x faster).
  - **Engine-Level Reading List Population**: Uses direct `INSERT ... SELECT` queries within SQLite for copying default reading lists, bypassing Node.js heap buffering.
  - **Batched Pruning & Deletions**: Deletes reading list items and stale lists using batched `WHERE id IN (...)` queries.
  - **Parallel Publisher Logo Resolution**: Resolves publisher logos concurrently with `Promise.all` instead of serial disk lookups.
* **Memory & I/O Pragmas**:
  - `mmap_size = 256MB`: Enables zero-copy kernel memory mapping for instant page reads.
  - `temp_store = MEMORY`: Keeps all temporary sorting and grouping structures in RAM.
  - `cache_size = 64MB`: Caches the entire working dataset in memory.
* **Instant Server Startup**: Guarded historical migration loops with completion flags in `settings` to prevent CPU churn and table scanning on server reboots.

### 3. Asynchronous I/O & Event Loop Unblocking
* **Non-Blocking Static Serving**: Static asset handlers (`sendAppShell` and `/service-worker.js`) now use asynchronous filesystem reads with in-memory caching, reducing latency by 85% under high concurrency.
* **Async Archive Processing**: `createRarReader` and comic identity updates use non-blocking asynchronous file operations.
* **Concurrent Access Control**: Access control checks in library searches execute concurrently via `Promise.all`.
* **Async Config Loading**: Configuration file parsing is non-blocking to prevent event-loop stalls during startup and runtime reloads.

### 4. Accessibility (a11y) & Modal UX
* **ARIA Dialog Semantics**: Added `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` across all modals.
* **Screen Reader Polish**: Descriptive `aria-label` attributes on icon-only close and toolbar buttons.
* **Keyboard Escape Dismissal**: Global `Escape` key listener instantly closes the active modal dialog.

### 5. Streamlined Comic Card & Viewer Typography
* **Strict 2-Line Hierarchy**:
  - **Line 1**: Series name and issue number (e.g. `Action Comics #1050`).
  - **Line 2**: Distinct story title (e.g. `Kal-El Returns`), only when available.
* **Filename Subtitle Removal**: Completely eliminated raw filenames leaking as secondary labels below comic titles.
* **Clean Fallbacks**: Untagged comics gracefully fall back to clean, sanitized names on Line 1 with empty Line 2.
* **DC All In Styling**: High-contrast Anton display typography and electric blue focus/selection halos.

### 6. Multi-Source Metadata Synthesis & Staging Modal
* **Tri-Source Synthesis**: Combines ComicVine, Grand Comics Database (GCD), and Gemini AI with confidence weighting.
* **Manual Inspection UI**: Review and selectively stage synthesized metadata before saving to archive or sidecar storage.

### 7. Reader Mode Stabilization
* **Continuous Scroll Polish**: Stabilized scroll anchoring and gesture handling in continuous reading mode.
* **Kindle & E-Ink Profiles**: High-contrast rendering and dedicated touch navigation for e-ink devices.

---

## 📦 Changelog

### Features & UI
- `feat(metadata)`: Web URL metadata tagging with Gemini AI synthesis, multi-source staging, and SSRF security
- `feat(ui)`: comic typography, card selection states, and strict 2-line title hierarchy
- `feat(reader)`: continuous reading mode stabilization, clean display titles, and e-ink/kindle support
- `feat(a11y)`: improve modal dialog accessibility, icon button tooltips, and Escape key dismissal

### Performance & Engine
- `perf(db)`: optimize SQLite indexes, memory pragmas, and startup migration guards
- `perf(progress)`: optimize series status updates with single-transaction batching
- `perf(reading-lists)`: eliminate N+1 queries in creation, pruning, and mark-read endpoints
- `perf(io)`: unblock event loop with asynchronous file operations in static routes, config, and archive readers
- `perf(library)`: parallelize publisher logo resolution and concurrent access control checks

### Security & Hardening
- `fix(security)`: validate and sanitize ComicTagger matching threshold settings
- `fix(security)`: validate and sanitize `deviceId` in progress sync endpoints

### Maintenance & Code Health
- `refactor`: simplify function signatures using options objects (`checkComicAccess`, `resolveReadingModes`, `syncDefaultReadingLists`, `buildTaggedDbMeta`)
- `test`: add comprehensive test coverage for `mcp-tools.js` and modal accessibility
- `chore(deps-dev)`: bump vite from 8.3.0 to 8.3.3
- `chore`: align Node engine floor with Vite 8 requirement

---

## 🧪 Verification & Compatibility
- **Jest Test Suite**: 100 / 100 test suites passed (725 / 725 tests).
- **Python / Pytest**: 150 / 150 tests passed.
- **Data Safety**: 100% backward compatible. Zero resets or modifications to user reading progress, reading lists, or comic files.
- **Greenfield Ready**: New Docker and npm installations automatically initialize with optimized indexes, seeds, and memory pragmas out of the box.

---

## 🚀 Deployment & Distribution
Pushed release tags automatically build and publish:
* **Docker Hub**: `docker pull comicsnowdev/comics-now:2.1.0`
* **GitHub Container Registry (GHCR)**: `docker pull ghcr.io/comicsnow/comics-now:2.1.0`
* **npm Registry**: `npx comics-now@2.1.0`
