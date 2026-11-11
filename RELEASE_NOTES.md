# Comics Now! v4.1.0 Release Notes

Welcome to **Comics Now! v4.1.0** — feature release introducing smart panel-aware speech bubble zoom placement with intelligent panel collision avoidance, seamless reading flow preservation, and reverse proxy asset delivery hardening.

---

## ✨ What's New & Highlights in v4.1.0

### 1. Smart Panel-Aware Speech Bubble Zoom Placement
* **Dynamic Panel Collision Avoidance**: Guided view speech bubble zoom now intelligently avoids covering the active comic panel artwork. When inspecting dialogue bubbles in **Western Speech Zoom**, **Manga Speech Zoom**, or **Manga Panel Zoom**, the viewer calculates the containing panel's on-screen geometry and dynamically docks the magnifier callout in clear space:
  - **Clean Vertical Docking**: Docks cleanly above or below the panel when vertical clearance is available.
  - **Side-Escape for Tall Panels**: When viewing tall vertical panels spanning most of the page height, the overlay escapes horizontally to the left or right side, keeping the entire panel and its artwork in view.
  - **Opposite-Corner Fallback for Splash Pages**: On giant full-page splash panels where panel overlap is unavoidable, the overlay positions itself in the corner opposite the bubble (e.g. bubble in top-left → overlay in bottom-right).
* **Guaranteed Bubble Visibility**: The placement algorithm strictly penalizes bubble overlap to zero, ensuring the magnifier callout never obscures the original speech bubble being read.
* **Intra-Panel Placement Stability**: Consecutive taps on dialogue bubbles within the same panel maintain positional stability, eliminating erratic jumping across the screen during conversations.
* **100% Decoupled from Panel Zoom**: Panel zoom rendering remains completely untouched in its own isolated branch, maintaining standard centering, fit scaling, and navigation.

### 2. Reverse Proxy & Tunnel Asset Delivery Hardening
* **Vite Bundle Asset Delivery**: Whitelisted `/assets/` and `/logos/` in `publicPathPrefixes` in the JWT authentication middleware (`server/middleware/auth.js`). Eliminates `401 Unauthorized` responses on JavaScript/CSS asset bundles when accessing Comics Now! via Cloudflare Tunnels, reverse proxies, and subpath deployments with authentication enabled.

---

## ⬆️ Upgrade Notes
* **No Database Migrations Required**: v4.1.0 is 100% backward-compatible with existing databases and sidecar files.
* **Zero Disruption to User Data**: All user reading lists, reading progress, and custom sort orders remain completely untouched.
* **Automatic Client Update**: Frontend assets are bundled via Vite (`public/dist/`); browsers will automatically load the new viewer scripts.

---

## 📦 v4.1.0 Changelog
1. `feat(viewer)`: smart panel-aware speech bubble zoom placement (`0b82150`)
2. `fix(auth)`: whitelist Vite /assets/ and /logos/ in JWT auth middleware for proxy and tunnel deployments (`14a26c9`)

---

## 🧪 Verification & Test Results
- **Full Jest suite**: `197 suites passed, 1520 tests passed (100% pass rate)`.
- **Dedicated TDD placement test suite**: `tests/guidedBubblePlacement.test.js` (14/14 tests passed).
- **Interactive zoom integration**: `tests/guidedInteractiveZoom.test.js` and `tests/guidedZoomOverlay.test.js` verified (100% pass rate).
- **Production build**: Tailwind CSS v4 and Vite client bundle compiled cleanly.

---

# Previous Release: Comics Now! v4.0.0

### Story Arcs, Narrative Timelines & Continuity Management
- **Dedicated Story Arcs Smart Filter**: New `⚡ Story Arcs` filter pill in publisher view with Gold/Amber trade dress (`#F59E0B` / `#EF4444`) and real-time library completeness metrics.
- **Story Arc Detail Banner & DAG Visualizer**: Interactive box-set detail banner with Grid, Checklist, and Spine & Orbit Spurs timeline visualizer.
- **In-Reader Continuity Prompts**: "Up Next in Arc" prompt upon reaching the final page of an issue.
- **Tag Comics Now! Source**: `ReadingOrders (Story Arcs)` source for `<StoryArc>`, `<StoryArcNumber>`, and `<SeriesGroup>` ComicInfo enrichment.
- **Dedicated Settings Tab & Crawler**: Multi-publisher crawler engine with live SSE streaming logs and 21-day retention policy.
- **MCP Continuity Tools**: Added 4 FastMCP continuity tools (`list_story_arcs`, `get_story_arc`, `get_story_arc_next`, `trigger_story_arcs_sync`).
- See GitHub Releases for the full v4.0.0 notes.
