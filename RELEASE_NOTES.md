# Comics Now! v3.4.0 Release Notes

Welcome to **Comics Now! v3.4.0** — introducing the **Story Arcs & Narrative Continuity Engine** powered by ReadingOrders.com, an interactive **Narrative Timeline DAG**, in-reader continuity prompts, a selectable **ReadingOrders** metadata source for **Tag Comics Now!**, and new **MCP server continuity tools**.

---

## ✨ What's New in v3.4.0

### 1. Story Arcs Smart Filter & Gold Box-Set View
* **Dedicated Story Arcs Smart Filter**: New `⚡ Story Arcs` filter pill in the publisher library view, visually distinguished from personal Reading Lists (`#8B5CF6` Purple) using an Amber/Gold and Crimson box-set trade dress (`#F59E0B` / `#EF4444`).
* **Live Library Completeness**: Each Story Arc card calculates real-time ownership metrics (`ownedCount`, `missingCount`, and `completenessPercent`) by matching local library comics against canonical multi-series reading orders.
* **Isolated Continuity Database**: Canonical reading orders, issue sequences, and collected edition volumes are stored in a dedicated `data/reading-orders.db` SQLite database — keeping user reading lists and reading progress 100% untouched.

### 2. Story Arc Detail Banner & Narrative Timeline DAG
* **Interactive Story Arc Detail Banner**: Clicking any box-set card in the Story Arcs smart list opens the Gold/Amber box-set detail banner (distinct from Reading Lists' purple playlist). Features real-time completeness progress, publication metadata, and 3-way view switching:
  - **Grid View**: Visual cover cards in canonical sequence, clearly marking owned issues vs. missing gap placeholders.
  - **Checklist View**: Tabular chronological reading checklist with storyline part annotations.
  - **Narrative DAG View**: Integrated cinematic timeline visualizer.
* **Spine & Orbit Spurs Visualizer**: Enhanced narrative timeline distinguishing main event / core issues along the central spine from tie-in series branching into angled orbit spurs. Features interactive card hover spotlighting, act milestones (`Act I: Inception`, `Act II: Escalation`, `Act III: Climax`), dual Issues / Collected Volumes toggle, and missing issue gap diagnostics.
* **Series Page Continuity Strip**: On series pages (`/series/:publisher/:seriesName`), an inline Amber/Gold continuity strip surfaces associated story arcs with 1-click access to the full storyline detail.

### 3. In-Reader Continuity Prompts ("Up Next in Arc")
* Reaching the final page of an issue belonging to an indexed story arc surfaces an **Up Next in Arc** prompt with direct 1-tap navigation to the next chronological issue (even when the story crosses into a different series), or a clear continuity gap notice if the next issue is missing from the library.

### 4. Tag Comics Now! Selectable Source (`ReadingOrders`)
* **11th Metadata Source**: `ReadingOrders (Story Arcs)` (`src-readingorders`) is now available as a selectable checkbox in **Tag Comics Now! → Settings → Metadata Sources**.
* **ComicInfo v2.0/v2.1 Enrichment**: When enabled, matched comics are automatically enriched with `<StoryArc>`, `<StoryArcNumber>`, and `<SeriesGroup>` tags via sub-millisecond local SQLite lookups with zero outbound network requests during tagging.

### 5. Dedicated Story Arcs Settings Tab & Live Streaming Crawler
* **Dedicated Settings Tab**: Replaced the nested general settings card with a top-level **Story Arcs** tab (`#settings-tab-story-arcs`) featuring:
  - Configuration of auto-sync intervals (`readingOrdersIntervalDays`, default: 7 days, 0 = disabled) and ingestion modes (`both`, `issues`, `collected`).
  - Strict user-initiated synchronization: `[ ▷ Start Initial Scan / Sync ]` button with optional `Force Re-Scrape` cache bypass.
  - Live progress card showing currently scraped slug, percentage bar, and cancel controls (`[ ⏹ Cancel Sync ]`).
  - Live SSE streaming log output (`GET /api/v1/story-arcs/stream`) with log line counter and clear action.
* **Resilient Crawler Engine**: Auto-detects publishers (`DC Comics`, `Marvel Comics`) from timeline breadcrumbs and links, supports HTTP 308 redirects, and indexes storylines into `data/reading-orders.db`.

### 6. Universal 21-Day Log Retention Policy & Smart Auto-Scroll
* **Universal 21-Day Retention**: Enforced across all logging layers in Comics Now! — in-memory log streams (`storyArcsLogs`, `guidedLogs`, general logs), on-disk Tag Comics Now scan logs (`data/scan_logs/scan_log_*.json`), and audit records are automatically pruned after 21 days. Includes a daily scheduled retention sweep.
* **Smart Auto-Scroll in Log Viewers**: Fixed aggressive auto-scrolling across live streaming log viewers (both in Tag Comics Now! / Comic Tagger and Story Arcs). When users scroll up to inspect previous log lines, scroll position is strictly preserved; scrolling back to the bottom (within 35px) resumes auto-scroll, paired with a floating `[ ↓ Jump to latest ]` button.

### 7. Comics Now! MCP Server Continuity Tools
* Added 4 new FastMCP tools in `comics_mcp`:
  - `list_story_arcs(publisher, search)`
  - `get_story_arc(arc_id)`
  - `get_story_arc_next(comic_id)`
  - `trigger_story_arcs_sync(mode)`

### 8. Batch ComicInfo.xml Story Arc Enrichment (Option C Override)
* **Targeted Metadata Enrichment**: Added batch ComicInfo.xml metadata enrichment directly within the Story Arcs settings tab. Allows administrators to run batch updates across all library comics or target specific publishers present in `reading-orders.db` (e.g. `DC Comics`, `Marvel Comics`).
* **Canonical Story Arc Override (Option C)**: Always enriches `<StoryArc>`, `<StoryArcNumber>`, and `<SeriesGroup>` with canonical continuity data from the Story Arcs database, while strictly preserving all other existing ComicInfo.xml fields (creators, characters, summaries, genres, dates, page lists, and cover coordinates).
* **Storage-Aware & Redundant Write Protection**: Respects existing storage modes (`archive` zip updates, `sidecar` `.ComicInfo.xml`, and `db` metadata). Automatically skips comics where existing Story Arc tags already match canonical values, avoiding unnecessary disk I/O and modified timestamps.
* **Live SSE Progress Tracking & Cancellation**: Features a live progress bar with percentage, current comic indicator, updated/skipped counters, and a responsive cancel button.

### 9. In-Grid Story Arc Badges & Continuity Gap Cards
* **Visual Story Arc Badges**: Comic cards belonging to an active story arc display an amber continuity pill badge (`⚡ <Story Arc Name>`) directly on the card in library and series views.
* **Inline Continuity Gap Cards**: When browsing issues of a series that participates in a multi-series crossover storyline, missing intermediate issues are visually rendered as dashed amber gap cards (`⚠️ Part of <Story Arc Name>`). Clicking a gap card immediately opens the storyline checklist and timeline visualizer.

### 10. "Skipping Continuity" Reader Launch Interceptor
* **Continuity Jump Interceptor**: When opening an issue that belongs to a canonical story arc, Comics Now! checks whether earlier chronological issues in that storyline remain unread.
* **Non-Intrusive Modal**: If unread earlier issues exist, an Amber trade dress dialog informs the reader (`You are jumping ahead in <Story Arc>`) offering 1-tap options to `Read Oldest Unread` or `Continue to Issue`. Includes a persistent `Don't show again for this story arc` preference stored per arc.

### 11. Mobile-First Settings IA & Scope Switcher
* **3-Scope Settings Architecture**: Replaced cramped horizontal tabs with a responsive segmented scope bar:
  - **📖 My Reader**: Personal reading preferences (Reading Experience, Offline Downloads, Synced Devices) available to all users.
  - **⚙️ Server Admin**: Core server management (Storage & Library Paths, Users & Access, System Diagnostics Logs) gated strictly to administrators.
  - **⚡ AI Engines**: Autonomous pipelines (Story Arcs & Reading Orders Crawler, Guided View GPU Engine).
* **Bidirectional Workflow Bridges**: Added 1-tap navigation buttons connecting Story Arcs settings directly to Tag Comics Now! metadata sources, and vice-versa.

### 12. Automated Weekly Continuity Delta Sync
* Integrated autonomous delta synchronization into the weekly curator cron routine, fetching new and updated storylines non-destructively without altering reading progress or user-curated reading lists.

---

## ⬆️ Upgrade Notes
* `data/reading-orders.db` is initialized automatically in WAL mode on first access.
* Existing user reading lists, custom sort orders, and reading progress records are completely untouched.
* All log entries and on-disk scan logs older than 21 days are automatically pruned.
* Optional `config.json` settings `readingOrdersIntervalDays` (default: `7`) and `readingOrdersMode` (default: `"both"`) are supported out of the box.

---

## 📦 v3.4.0 Changelog
1. `feat(continuity)`: add ReadingOrders scraper, Story Arcs smart filter, and narrative timeline (`d53f862`)
2. `feat(continuity)`: add ReadingOrders MCP tools, selectable tagger source, runner and docs (`e9b06cf`)
3. `feat(settings)`: add dedicated Story Arcs settings tab, smart streaming logs, crawler engine, route contract integrity test, and 21-day log retention
4. `feat(story-arcs)`: add batch ComicInfo.xml metadata enrichment with Option C override and target publisher scope
5. `feat(story-arcs)`: add Story Arc detail banner view, multi-lane spine and spurs DAG, and series continuity strip
6. `feat(continuity)`: add in-grid badges, continuity jump interceptor, weekly delta sync, and mobile-first settings scope switcher

---

## 🧪 Verification & Test Results
- **Full Jest suite**: `195 suites passed, 1503 tests passed (100% pass rate)`.
- **MCP suite**: `47 passed`.
- **Python tagger source suite**: `6 passed`.
- **Production build**: Tailwind CSS v4 and Vite client bundle compiled cleanly.
- **Architecture ratchet**: all new and modified modules remain strictly under the 380-line ceiling.

---

# Previous Release: Comics Now! v3.3.0

- **Per-Comic Tag Search & CBR Support**: Single-comic tag search (`POST /api/v1/tag-comics-now/run-file` and MCP `run_tag_search`), CBR cover extraction, sidecar-only `ComicInfo.xml` writes for RAR/CBR archives, and companion metadata mirroring via `comics.originalPath`.
- **Allowed Library Formats & Guided View Hardening**: Format filtering across library/search/folder views, serialized RAR archive sessions, atomic sidecar writes, and Gemini Vision fallback resilience.
- See GitHub Releases for the full v3.3.0 notes.
