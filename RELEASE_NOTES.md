# Comics Now! v3.4.0 Release Notes

Welcome to **Comics Now! v3.4.0** — introducing the **Story Arcs & Narrative Continuity Engine** powered by ReadingOrders.com, an interactive **Narrative Timeline DAG**, in-reader continuity prompts, a selectable **ReadingOrders** metadata source for **Tag Comics Now!**, and new **MCP server continuity tools**.

---

## ✨ What's New in v3.4.0

### 1. Story Arcs Smart Filter & Gold Box-Set View
* **Dedicated Story Arcs Smart Filter**: New `⚡ Story Arcs` filter pill in the publisher library view, visually distinguished from personal Reading Lists (`#8B5CF6` Purple) using an Amber/Gold and Crimson box-set trade dress (`#F59E0B` / `#EF4444`).
* **Live Library Completeness**: Each Story Arc card calculates real-time ownership metrics (`ownedCount`, `missingCount`, and `completenessPercent`) by matching local library comics against canonical multi-series reading orders.
* **Isolated Continuity Database**: Canonical reading orders, issue sequences, and collected edition volumes are stored in a dedicated `data/reading-orders.db` SQLite database — keeping user reading lists and reading progress 100% untouched.

### 2. Narrative Timeline DAG Visualizer
* **DC Trade-Dress Continuity Map**: Interactive horizontal timeline organizing crossover events across narrative milestones (`Act I: Inception`, `Act II: Escalation`, `Act III: Climax`).
* **Dual Granularity Toggle**: Switch instantaneously between **Individual Issues** and **Collected Volume Stacks** (TPBs, hardcovers, and omnibuses).
* **Importance & Gap Highlighting**: Badges distinguish **Essential / Core** issues from **Companion / Tie-In** issues, while missing library issues are highlighted as continuity gaps.

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
3. `feat(settings)`: add dedicated Story Arcs settings tab, smart streaming logs, crawler engine, and 21-day log retention

---

## 🧪 Verification & Test Results
- **Full Jest suite**: `187 suites passed, 1471 tests passed (100% pass rate)`.
- **MCP suite**: `47 passed`.
- **Python tagger source suite**: `6 passed`.
- **Production build**: Tailwind CSS v4 and Vite client bundle compiled cleanly.
- **Architecture ratchet**: all new and modified modules remain strictly under the 380-line ceiling.

---

# Previous Release: Comics Now! v3.3.0

- **Per-Comic Tag Search & CBR Support**: Single-comic tag search (`POST /api/v1/tag-comics-now/run-file` and MCP `run_tag_search`), CBR cover extraction, sidecar-only `ComicInfo.xml` writes for RAR/CBR archives, and companion metadata mirroring via `comics.originalPath`.
- **Allowed Library Formats & Guided View Hardening**: Format filtering across library/search/folder views, serialized RAR archive sessions, atomic sidecar writes, and Gemini Vision fallback resilience.
- See GitHub Releases for the full v3.3.0 notes.
