# Comics Now! v2.2.0 Release Notes

Welcome to **Comics Now! v2.2.0** — a performance, reliability, and test coverage release introducing **Modal GPU Credit & Spend Limit Accuracy**, **Batched Tagger & Reading List Database Operations**, **Memory-Efficient Archive Extraction**, **Immediate Progressive Metadata & Sidecar Sync**, and **Expanded Frontend & Backend Unit Test Suites**.

---

## 🌟 Highlights

### 1. Modal GPU Billing, Credit Deduction & Spend Limit Accuracy
* **Accurate Credit Balance Calculation**: Deducts metered GPU compute usage directly against available free/plan credits (`creditBalance`) before accruing net billable spend.
* **Net Metered Cost & Spend Limit Tracking**: Correctly computes remaining credit allowance and net metered cost against user-configured spend limits in the Guided View Modal settings UI.

### 2. High-Throughput Tagger, Archive & Reading List Performance
* **Batched Tagger Database Writes**: Eliminated N+1 SQLite query bottlenecks during comic tagger checks using chunked bulk database operations while preserving immediate progressive sidecar and metadata updates during live scans.
* **Bulk Reading List Item Insertions**: Replaced per-item loop inserts with batched multi-row SQLite `INSERT` statements for reading list creation and synchronization.
* **Chunked Series Status Updates**: Refactored series read/unread status updates into chunked batch inserts to stay well within SQLite variable limits on large series.
* **Memory-Efficient RAR Extraction (`archive-utils`)**: Switched RAR archive extraction to stream directly from disk via `createExtractorFromFile` instead of buffering entire archives into memory.
* **Concurrent Library Access Checks**: Parallelized comic access verification across library routes using `Promise.all`.

### 3. Security, Accessibility & Code Architecture
* **Gemini Daily Quota Validation**: Hardened input validation and bounds checking for the Gemini AI daily quota cap setting.
* **Header Icon Accessibility**: Added descriptive `aria-label` attributes and tooltips to header navigation and action icon buttons.
* **Unified Options-Object Signatures**: Refactored `checkComicAccess` and reading list service functions to accept structured options objects for cleaner, extensible internal APIs.

### 4. Comprehensive Frontend & Backend Test Suite Expansion
* Added 19 new unit test suites (bringing the total to **119 Jest test suites / 964 tests**), covering:
  - Frontend modules: `continuous.js`, `progress.js`, `impersonation.js`, `jwt-capture.js`, `modal-detector.js`, `panel-detector.js`, `router.js`, `events.js`, `globals.js`.
  - Backend services & routes: `library-pages`, `library-logos`, `library-conversion`, `admin/impersonate`, `user/devices`, `user-stats`, `mcp-tools`, `static`, and route index registration.

---

## 📦 Changelog

### Bug Fixes & Security
- `fix(modal)`: correct credit balance deduction, net metered cost, and spend limit calculation
- `fix(security)`: validate input bounds for Gemini daily quota cap
- `feat(a11y)`: add missing ARIA labels and tooltips to header icon buttons

### Performance & Refactoring
- `perf(tagger)`: resolve N+1 query bottleneck by batching comic tagger database checks
- `perf(reading-lists)`: optimize reading list item insertions with bulk inserts
- `perf(archive-utils)`: use `createExtractorFromFile` instead of loading entire RAR archives into memory
- `perf(access)`: optimize library access checks with `Promise.all`
- `refactor`: chunked batch inserts for series status updates
- `refactor`: unify `checkComicAccess` and reading list service signatures with options objects

### Testing
- `test`: expand frontend and backend unit test coverage to 119 test suites (964 tests)

---

## 🧪 Verification & Compatibility
- **Jest Test Suite**: 119 / 119 test suites passed (964 / 964 tests).
- **Python / Pytest**: 150 / 150 tagger tests + 29 / 29 MCP tests passed.
- **Data Safety**: 100% backward compatible. Zero resets or modifications to user reading progress, reading lists, or comic files.

---

## 🚀 Deployment & Distribution
Pushed release tags automatically build and publish:
* **Docker Hub**: `docker pull comicsnowdev/comics-now:2.2.0`
* **GitHub Container Registry (GHCR)**: `docker pull ghcr.io/comicsnow/comics-now:2.2.0`
* **npm Registry**: `npx comics-now@2.2.0`
