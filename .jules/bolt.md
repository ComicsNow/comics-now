## 2026-10-26 - Sequential Access Control Checks in buildLibrary
**Learning:** In `server/services/library.js`, `buildLibrary()` sequentially awaited `checkComicAccess` in a loop for every comic row, creating an async waterfall and task queue scheduling bottleneck for non-admin users with large comic libraries.
**Action:** Parallelize access control checks across all rows using `Promise.all` with `map` before constructing the library hierarchy.

## 2026-10-24 - N+1 DB Queries in Reading List Mark-Read Endpoints
**Learning:** In `server/routes/user/reading-lists.js`, marking reading lists or bulk reading lists as read/unread issued per-item `SELECT totalPages FROM comics` queries in a loop, resulting in 2N DB queries for a list of size N.
**Action:** Replace sequential per-item queries with a single `LEFT JOIN` between `reading_list_items` and `comics` to retrieve `comicId` and `totalPages` in a single query before updating status.
