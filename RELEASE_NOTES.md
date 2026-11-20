# Comics Now! v5.0.2 Release Notes

**Comics Now! v5.0.2** is a patch release fixing fullscreen edge speech-bubble interaction so speech bubbles under the left and right page-turn hotspots zoom properly instead of triggering accidental page turns.

---

## 🐛 Bug Fixes in v5.0.2

* **Prioritize Edge Speech Bubbles Over Fullscreen Page-Turn Hotspots**:
  * In Western Speech Zoom, Manga Speech Zoom, and Manga Panel Zoom, tapping or pressing a speech bubble positioned inside the outer 10% left/right fullscreen edge strips now zooms the speech bubble instead of triggering a page turn or 250ms long-press navigation.
* **Preserve Edge Navigation & Panels**:
  * Tapping empty edge margins, letterbox/pillarbox bars, standard fullscreen edges, or non-bubble manga panels continues to turn pages normally, with tighter edge hit-target padding (`6px` in Speech Zoom, exact bounds in Manga Panel Zoom) so inward bubbles do not block page turns.
* **Desktop Hover Cursor Cue**:
  * Hovering over an edge speech bubble with a mouse now displays a `zoom-in` cursor and resets automatically when leaving the edge, turning pages via keyboard, switching modes, or closing fullscreen.

---

## 🧪 Verification

* Added regression suite `tests/guidedEdgeHotspotArbitration.test.js` (`23` tests) covering Western/Manga Speech Zoom, bubbles-only Manga Panel Zoom, tight edge padding, long-press suppression, mouse-only hover cursor lifecycle, and open controls/overlay guards.
* Verified full test suite (`224/224` Jest suites, `1,694` tests, `1` snapshot; `273/273` Python tagger tests), CSS/Vite production builds, and Playwright Firefox smoke check (`0` uncaught console errors).
