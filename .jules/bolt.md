# Bolt Learnings

## 2026-10-28 - N+1 DB Queries in Reading List Mark-Read Endpoints
**Learning:** In `server/routes/user/reading-lists.js`, marking reading lists or bulk reading lists as read/unread issued per-item `SELECT totalPages FROM comics` queries in a loop, resulting in 2N DB queries for a list of size N.
**Action:** Replace sequential per-item queries with a single `LEFT JOIN` between `reading_list_items` and `comics` to retrieve `comicId` and `totalPages` in a single query before updating status.
## 2026-10-29 - Consolidate DB Queries using LEFT JOIN
**Learning:** In `server/services/library.js` and `server/routes/user/library.js`, retrieving comics and their corresponding user reading progress involved issuing two separate `dbAll` queries and mapping the results in memory, causing an N+1 style inefficiency.
**Action:** Always combine the retrieval of base entities (like `comics`) with related per-user data (like `user_comic_status`) directly in the database using a `LEFT JOIN`.
