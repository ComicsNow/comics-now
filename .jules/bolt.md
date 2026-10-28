## 2026-10-24 - N+1 DB Queries in Reading List Mark-Read Endpoints
**Learning:** In `server/routes/user/reading-lists.js`, marking reading lists or bulk reading lists as read/unread issued per-item `SELECT totalPages FROM comics` queries in a loop, resulting in 2N DB queries for a list of size N.
**Action:** Replace sequential per-item queries with a single `LEFT JOIN` between `reading_list_items` and `comics` to retrieve `comicId` and `totalPages` in a single query before updating status.

## 2026-10-27 - SQLite Parameter Limit on Large Directories
**Learning:** When retrieving comics using a WHERE IN clause based on an array of file paths from the disk, SQLite will crash if the directory contains thousands of files due to the "too many SQL variables" parameter limit (default is 999).
**Action:** Use array chunking (e.g. `for (let i = 0; i < paths.length; i += chunkSize) { const chunk = paths.slice(i, i + chunkSize); ... }`) with a max `chunkSize` of 500 when dynamically building `IN (...)` placeholders to aggregate results safely.
