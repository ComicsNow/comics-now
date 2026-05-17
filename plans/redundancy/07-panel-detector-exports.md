# Plan 07 — Tighten `panel-detector.js` exports

**Category:** Truly redundant (export-surface only — no behavior change).

## Finding

`server/services/panel-detector.js:427` exports `{ processComic, detectPanels, detectBubbles, sortReadingOrder, extractPageBuffer, listPages, GUIDED_VIEW_DIR, MODEL_PATHS }`. Of these, only `processComic`, `extractPageBuffer`, and `GUIDED_VIEW_DIR` (plus `listPages` indirectly) are consumed externally. `detectPanels`, `detectBubbles`, `sortReadingOrder`, `MODEL_PATHS` are internal-only — they have no external callers and aren't part of any documented plugin surface.

## Steps

1. Confirm zero external callers: `grep -rn "detectPanels\b\|detectBubbles\b\|sortReadingOrder\b\|MODEL_PATHS\b" server server.js scripts tests | grep -v "panel-detector.js"`. Must be empty.
2. Trim the export to `module.exports = { processComic, extractPageBuffer, listPages, GUIDED_VIEW_DIR };`.
3. Run the guided-reader path end-to-end (see test plan).

## Test strategy

### Before
- `npm test`.
- Start server, trigger a guided run on a small comic via the admin panel. Confirm the run completes and the comic's guided panel JSON is written.
- `ls models/` — confirm model files exist (the test below relies on at least one of `comic-panel.onnx`, `manga-panel.onnx`).

### After
- `npm test` — identical result.
- Re-trigger a guided run on the same comic — must produce identical output (compare JSON via `diff`).
- `node -e "console.log(Object.keys(require('./server/services/panel-detector')))"` — should list only the trimmed exports.

## On failure

Per shared policy. **If a test that we didn't know about imports the trimmed names**, that test was either (a) covering internal-only logic that's now untestable from outside, or (b) the names were part of an intentional public surface. Ask the user before adjusting either. If the answer is (a), the test should move into the module file itself or stay green by importing the module's `__internal__` (not currently exposed) — but again, get the user's call first.
