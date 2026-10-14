# Comics Now - AI Agent Guidelines & Architecture Rules

## Core Reading List & Data Preservation Rules
Whenever auditing, creating, or modifying reading lists in Comics Now (`/opt/comics-now/comics-now.db`):

1. **Rule 1: NEVER Delete User Reading Lists or Remove Comics from Them**
   - NEVER delete reading lists that a user has created.
   - NEVER delete or remove comics from any reading list that a user has created.
   - Audits and curation jobs must be strictly non-destructive.

2. **Rule 2: NEVER Reset or Alter User Reading Progress**
   - User progress records (`user_comic_status`, `progress`, `device_progress`, and `comics.lastReadPage`) must NEVER be modified, reset, or deleted.
   - However, **altering reading list order (`sortOrder` on `reading_list_items` and `reading_lists`) IS allowed** to maintain correct chronological and narrative reading order across series.

3. **Rule 3: Multi-Series Only for NEW Lists (NO Redundant Single-Series Lists)**
   - NEVER create a reading list if all comics in it belong to the same single `series` within the same publisher.
   - Comics Now natively groups comics by series in the UI. Creating a reading list for a single series creates duplicate navigation.
   - Reading lists exist exclusively to curate storylines across **multiple distinct series**, crossovers, events, imprints, or multi-publisher chronologies (e.g. *The Absolute Universe*, *Hank Howard*, *Crisis on Infinite Earths*, *Thorgal*, *Powers*).

4. **Rule 4: Minimum Threshold (>= 3 Comics)**
   - Only create a new reading list if there are at least **3 comics** bridging across the storyline.
   - Never create a 1-issue or 2-issue reading list.

5. **Rule 5: No Duplicate Lists**
   - Always query `SELECT DISTINCT name FROM reading_lists;` before creating any list to prevent duplicate or conflicting lists.

6. **Rule 6: Multi-User Parity (Additive & Order Sync)**
   - When new candidate comics are added or chronological ordering is tuned, sync them across all registered user IDs in the `users` table:
     - `default-user`
     - `637b7da9-dbab-4f90-acf8-25dd09c8369f` (h.r.ahmad@gmail.com)
     - `53e5889d-72e4-591f-9c8b-5dd7d6c5cf7f` (playhrausa@gmail.com)
     - `578ef229-fc84-5d14-b754-ea5e7a806ec8` (yahya.bashir.a@gmail.com)
   - Syncing adds missing issues with `INSERT OR IGNORE` and aligns `sortOrder` without deleting user lists or resetting progress.

## Automated Weekly Curator
- Weekly autonomous cron script: `/home/raza/scripts/comics-weekly-curator.py`
- Runs every Monday at 09:00 via user crontab (`0 9 * * 1`).
- Operates non-destructively: matches new issues to existing multi-series lists using `INSERT OR IGNORE`, syncs reading order (`sortOrder`), with zero deletions of user lists, comics, or reading progress.
- Status endpoint: `http://localhost:3002/comics-curator` (served by `dns-monitor.service`).
- Homepage dashboard widget is configured in `/var/lib/homepage/config/services.yaml`.

## Reading List Continuity DAG & Production Build/Restart
- **Interactive Reading List DAG View**:
  - Endpoint: `GET /api/v1/reading-lists/:id/dag` (`server/routes/user/reading-lists.js`) computes reading order flow, multi-series lanes, and same-series continuity arcs while strictly preserving user progress and obeying `checkComicAccess`.
  - Frontend visualizer: `public/js/reading-list-dag.js` provides SVG Bézier curves, directional arrows, zoom/pan (mouse + mobile touch pinch-to-zoom), live filter/search, and node inspector.
  - Integration: Reading list detail supports Grid (`⊞`), List (`☰`), and DAG (`🔀`) segmented modes with automatic modal container expansion (`max-w-6xl w-full h-[92vh]`), plus 1-click DAG launch buttons on cards in modal and library views.
- **Build & Restart Workflow**:
  - Build CSS: `npm run build:css` (Tailwind CSS v4 engine)
  - Build frontend bundles: `npm run build` (Vite)
  - Restart service: `sudo systemctl restart comics-now`
  - Base URL: `http://127.0.0.1:3000/comics/`
