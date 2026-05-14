# Comics Now! API Documentation

This document provides a technical overview of the REST API for Comics Now! All endpoints are prefixed with `/api/v1`.

## Authentication

Comics Now! uses role-based authentication. Most endpoints require a valid user session. Admin endpoints require an `admin` role.

### Public Auth
- **GET `/user/me`**: Returns the current user's profile and authentication status.

---

## Library & Browsing

### `GET /comics`
Returns the complete library accessible to the current user, grouped by publisher and series.

### `GET /search`
**Query Params:** `query` (search term), `field` (all, title, series, publisher, character)
Returns a flat list of comics matching the query, filtered by user access.

### `GET /folders/:path`
**Path:** Base64 encoded physical path or `root`.
Returns the contents of a directory (folders and comics) for Folder Mode browsing.

---

## Reader & Content

### `GET /comics/:id/guided-view`
Returns the JSON sidecar containing ML-detected panel and speech bubble coordinates for the specified comic.

### `GET /comics/pages`
**Query Params:** `path` (Base64 encoded)
Returns an array of image filenames for the comic at the specified path.

### `GET /comics/pages/image`
**Query Params:** `path` (Base64), `page` (filename)
Serves the raw image buffer for a specific page. Supports caching.

### `GET /comics/download`
**Query Params:** `path` (Base64)
Downloads the full comic archive. Supports `Range` requests for partial downloads.

---

## Progress & Sync

### `GET /sync/check/:comicId`
**Query Params:** `deviceId`
Checks if there is newer reading progress available from other devices for this comic.

### `POST /sync/update`
**Body:** `{ comicId, deviceId, lastReadPage }`
Updates the reading progress for a specific device and syncs it to the user's global status.

### `POST /comics/status`
**Body:** `{ comicId, status }` (`status` is 'read' or 'unread')
Manually marks a comic as read or unread for the current user.

### `POST /series/status`
**Body:** `{ publisher, series, status, rootFolder? }`
Bulk updates the status of all comics in a series.

---

## Reading Preferences

Per-user and per-comic reading mode toggles. Note: Guided navigation preferences (Guided Mode, Bubble Mode, Hot Zoom) are handled client-side via Local Storage and no longer have server-side endpoints.

### Manga Mode (Right-to-Left)
- **GET `/manga-mode-preference`**: Returns the library-level manga mode preference for the user.
- **POST `/comics/manga-mode`**
  - **Body:** `{ comicId, mangaMode }` (boolean)
- **POST `/comics/set-all-manga-mode`**: Set bulk Manga mode preference.
  - **Body (Optional):** `{ mangaMode, preferenceType, targetId }`. If `preferenceType` ('comic', 'series', 'publisher', 'library') and `targetId` are provided, sets at that level. Otherwise, sets for the entire library.

### Continuous Mode (Vertical Scroll)
- **GET `/continuous-mode-preference`**: Returns the user's default continuous mode preference.
- **POST `/continuous-mode-preference`**
  - **Body:** `{ continuousMode }` (boolean)
- **POST `/comics/continuous-mode`**
  - **Body:** `{ comicId, continuousMode }` (boolean)
- **POST `/comics/set-all-continuous-mode`**: Wipes per-comic overrides and sets the default for the entire library.
  - **Body:** `{ continuousMode }` (boolean)

---

## Reading Lists

### `GET /reading-lists`
Returns all reading lists for the current user with progress statistics.

### `POST /reading-lists`
**Body:** `{ name, description, comicIds? }`
Creates a new reading list.

### `GET /reading-lists/:id`
Returns detailed information and all comic items for a specific list.

### `POST /reading-lists/:id/comics`
**Body:** `{ comicIds }`
Adds comics to a reading list.

### `DELETE /reading-lists/:id/comics`
**Body:** `{ comicIds }`
Removes comics from a reading list.

### `PUT /reading-lists/:id/reorder`
**Body:** `{ comicOrder }` (Array of comic IDs)
Updates the reading order within a list.

### `POST /reading-lists/export` / `POST /reading-lists/import`
Handles JSON-based export/import of reading list definitions.

---

## Metadata (ComicVine)

### `GET /comics/info`
**Query Params:** `path` (Base64)
Returns the stored metadata (ComicInfo.xml contents) for a comic.

### `GET /search/comicvine`
**Query Params:** `query`
Performs a live search on ComicVine for volumes or issues.

### `GET /comicvine/volume/:id` / `GET /comicvine/issue/:id`
Fetches detailed metadata and creator credits for a specific ComicVine resource.

---

## Administration (Admin Only)

### User Management
- **GET `/users`**: List all registered users.
- **GET `/users/:userId/access`**: Get a user's hierarchical access permissions.
- **POST `/users/:userId/access`**: Update a user's access permissions for specific publishers or series.
- **GET `/library-tree`**: Returns the full publisher/series hierarchy for access management.

### Library Management
- **POST `/scan`**: Triggers a library scan for new files.
- **GET `/admin/libraries`**: List root library folders.
- **POST `/admin/libraries`**: Add a new root library folder.
- **DELETE `/admin/libraries`**: Remove a root library folder.

### Automation (ComicTagger & ML)
- **POST `/comictagger/run`**: Starts the automated metadata tagging process.
- **GET `/comictagger/pending`**: Returns the current match awaiting manual review.
- **POST `/comictagger/apply`**: Applies a selected metadata match to a comic.
- **POST `/guided/run`**: Starts the machine learning scan for panel detection.
- **GET `/guided/status`**: Returns the status of the Guided Reader background worker.

### System
- **POST `/settings`**: Updates global settings (ComicVine API key, scan interval).
- **GET `/logs`**: Returns system event logs.
- **GET `/comictagger/stream`** / **GET `/guided/stream`**: Server-Sent Events (SSE) streams for real-time operation logs.
