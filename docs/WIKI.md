# Comics Now! Complete Wiki & Documentation Manual

Welcome to the definitive user, administrator, and developer guide for **Comics Now!** — a modern, self-hosted comic book library server, reader, and organizer.

---

# Table of Contents
1. [What is Comics Now!?](#1-what-is-comics-now)
2. [Installation & Deployment](#2-installation--deployment)
   - [Docker (Recommended)](#docker-recommended)
   - [Docker Compose](#docker-compose)
   - [Bare Metal Installation](#bare-metal-installation)
3. [Cloudflare Zero Trust & Authentication](#3-cloudflare-zero-trust--authentication)
   - [How Cloudflare Access Works](#how-cloudflare-access-works)
   - [Configuring Environment Variables](#configuring-environment-variables)
   - [Trusted LAN & Local Auto-Admin](#trusted-lan--local-auto-admin)
4. [User & Administrator Management](#4-user--administrator-management)
   - [The First Admin Account](#the-first-admin-account)
   - [Adding & Elevating Users](#adding--elevating-users)
   - [Granular Library Permissions](#granular-library-permissions)
   - [Admin Impersonation Mode](#admin-impersonation-mode)
   - [User Statistics](#user-statistics)
5. [Libraries, Folder Structures & Scanning](#5-libraries-folder-structures--scanning)
   - [Adding a Library](#adding-a-library)
   - [Metadata Mode vs. Folder Mode](#metadata-mode-vs-folder-mode)
   - [Scan Pipeline & Error Safeguards](#scan-pipeline--error-safeguards)
   - [Scan Intervals & Scheduling](#scan-intervals--scheduling)
6. [Supported Formats, Auto-Conversion & Metadata Storage](#6-supported-formats-auto-conversion--metadata-storage)
   - [Supported Formats](#supported-formats)
   - [Automatic PDF & CBR Conversion to CBZ](#automatic-pdf--cbr-conversion-to-cbz)
   - [The 3 Metadata Storage Options](#the-3-metadata-storage-options)
7. [The Tagging Engine & File Organization](#7-the-tagging-engine--file-organization)
   - [Multi-Source Metadata APIs](#multi-source-metadata-apis)
   - [The Tagger UI & Matching Workflow](#the-tagger-ui--matching-workflow)
   - [Automatic Renaming & Moving](#automatic-renaming--moving)
8. [Smart Guided View & Reading Modes](#8-smart-guided-view--reading-modes)
   - [How Guided View Works (Deep Learning / ONNX)](#how-guided-view-works-deep-learning--onnx)
   - [Admin-Generated, Community Shared](#admin-generated-community-shared)
   - [Reading Modes](#reading-modes)
   - [Display & Viewport Controls](#display--viewport-controls)
9. [Reading Lists](#9-reading-lists)
   - [Creating & Managing Lists](#creating--managing-lists)
   - [Reordering Comics & Lists](#reordering-comics--lists)
   - [Syncing Lists to All Users (`syncToAll`)](#syncing-lists-to-all-users-synctoall)
   - [Bulk Operations & Import](#bulk-operations--import)
10. [Devices, Progress Syncing & Offline PWA](#10-devices-progress-syncing--offline-pwa)
    - [How Device Tracking Works](#how-device-tracking-works)
    - [Cross-Device Reading Progress](#cross-device-reading-progress)
    - [The Downloads Queue](#the-downloads-queue)
    - [Installing as an Offline PWA](#installing-as-an-offline-pwa)
11. [UI Navigation, Views & Long-Press Menus](#11-ui-navigation-views--long-press-menus)
    - [Library Card View (Long-Press Actions)](#library-card-view-long-press-actions)
    - [Publisher View (Long-Press Actions)](#publisher-view-long-press-actions)
    - [Series View (Long-Press Actions)](#series-view-long-press-actions)
    - [Comic Card View (Long-Press Actions)](#comic-card-view-long-press-actions)
    - [Comic Summary / Details Modal](#comic-summary--details-modal)
    - [Editing Singular Comic Metadata](#editing-singular-comic-metadata)
    - [Adding Local Comics (Client-Side Reader)](#adding-local-comics-client-side-reader)
    - [The User Pill](#the-user-pill)
12. [Search, Filtering & Custom Publisher Logos](#12-search-filtering--custom-publisher-logos)
    - [Global Search & Smart Filters](#global-search--smart-filters)
    - [Custom Publisher Logos](#custom-publisher-logos)
13. [Model Context Protocol (MCP) Server](#13-model-context-protocol-mcp-server)
    - [Overview](#mcp-overview)
    - [Setup & Launcher](#mcp-setup--launcher)
    - [Client Configuration](#client-configuration)
    - [AI Capabilities (Tagging, Reading Lists, SQL)](#ai-capabilities)
14. [System Logs & Maintenance](#14-system-logs--maintenance)

---

# 1. What is Comics Now!?

**Comics Now!** is a high-performance web platform engineered specifically for digital comic book collectors, enthusiasts, and shared family/community servers.

Unlike traditional media servers retrofitted for comic books, Comics Now! was built from the ground up for comics:
- **Neural Guided View**: Automatically analyzes comic pages using pre-trained deep learning vision models (`western.onnx` and `manga.onnx`) to detect panels and dialogue bubbles for cinematic, panel-by-panel reading.
- **True Cross-Device Sync**: Preserves reading progress per-comic and per-user, seamlessly synchronizing state between your desktop, tablet, and mobile devices.
- **Offline Progressive Web App (PWA)**: Installable directly onto iOS, iPadOS, Android, Windows, and macOS, with a background downloads queue that stores comic issues locally in IndexedDB for internet-free reading.
- **Granular Multi-User Security**: Full role-based access control with folder/publisher/series-level permissions, Cloudflare Zero Trust authentication, and admin impersonation.
- **Comprehensive Metadata & Tagging**: Multi-source metadata enrichment (ComicVine, Metron, GCD, Goodreads, Amazon, Google Books, Waterstones) with cover image hashing and automated library organization.
- **Native AI Model Context Protocol (MCP)**: A built-in Python MCP server allowing AI assistants (Claude, Cursor, Gemini) to organize reading lists, inspect cover art, and query your database via natural language.

---

# 2. Installation & Deployment

### Docker (Recommended)
Comics Now! publishes automated, production-hardened container images to GitHub Container Registry: `ghcr.io/comicsnow/comics-now:latest`.

```bash
docker run -d \
  --name comics-now \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -v /path/to/your/comics:/comics:ro \
  --restart unless-stopped \
  ghcr.io/comicsnow/comics-now:latest
```

### Docker Compose
Create a `docker-compose.yml` file:

```yaml
services:
  comics-now:
    image: ghcr.io/comicsnow/comics-now:latest
    container_name: comics-now
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATA_DIR=/app/data
      - PORT=3000
      # Optional: Cloudflare Zero Trust
      # - CLOUDFLARE_AUD=your-aud-tag
      # - CLOUDFLARE_TEAM_DOMAIN=your-team.cloudflareaccess.com
    volumes:
      # Persistent application state (SQLite databases, cache, thumbnails)
      - ./data:/app/data
      # Your comic library (mount :ro for safety, or :rw if you want archive write-back/renaming)
      - /path/to/comics:/comics:ro
      # Optional custom publisher logos
      - ./logos:/app/logos
    restart: unless-stopped
```

Run:
```bash
docker compose up -d
```

### Bare Metal Installation
If running natively on Linux (Ubuntu, Debian, Raspberry Pi OS):

1. **System Prerequisites**:
   ```bash
   sudo apt update
   sudo apt install -y nodejs npm python3 python3-pip python3-venv poppler-utils zip unrar
   ```
2. **Clone & Install**:
   ```bash
   git clone https://github.com/ComicsNow/comics-now.git
   cd comics-now
   npm install
   npm run build
   ```
3. **Environment Setup**:
   ```bash
   cp .env.example .env
   # Edit .env with your preferred ports and library paths
   ```
4. **Launch**:
   ```bash
   npm start
   ```

---

# 3. Cloudflare Zero Trust & Authentication

Comics Now! is designed to run securely behind **Cloudflare Zero Trust (Access)**. This eliminates the need to expose open ports or manage public passwords.

### How Cloudflare Access Works
When a user visits your domain, Cloudflare Access validates their identity (via Google, GitHub, SAML, or one-time pin) and issues a signed JSON Web Token (JWT) in the request header:
```http
Cf-Access-Jwt-Assertion: <signed-jwt-token>
```

The Comics Now! origin server validates:
1. **Algorithm Pinning**: Strictly verifies `RS256` signatures to prevent algorithm confusion attacks.
2. **JWKS Key Caching & Rate-Limiting**: Retrieves public keys from `https://<CLOUDFLARE_TEAM_DOMAIN>/cdn-cgi/access/certs` with a 1-hour in-memory cache and a rate limit of 10 requests/minute.
3. **Audience Verification**: Validates that the JWT was generated specifically for your application AUD tag (`CLOUDFLARE_AUD`).
4. **User Creation**: Automatically provisions the user in the SQLite database based on their Cloudflare email.

### Configuring Environment Variables
Add these to your `.env` or Docker environment:
```ini
CLOUDFLARE_TEAM_DOMAIN=myteam.cloudflareaccess.com
CLOUDFLARE_AUD=a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890
```

### Trusted LAN & Local Auto-Admin
To make administration seamless on your home network, Comics Now! includes socket-level private network auto-elevation:
- When accessed from a **private LAN IP** (e.g. `127.0.0.1`, `::1`, `192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`), the server inspects `req.socket.remoteAddress` directly.
- LAN connections automatically authenticate as the primary `admin` user (`default-user`).
- **Security Guard**: External attackers attempting to spoof `X-Forwarded-For` from the internet cannot trigger LAN elevation because Comics Now! validates the physical network socket.

---

# 4. User & Administrator Management

### The First Admin Account
- When Comics Now! is initialized, the first user account registered (either via LAN or Cloudflare Access) is automatically granted the `admin` role.
- All subsequent users receive the `user` role by default.

### Adding & Elevating Users
1. Have the user access the site through your Cloudflare Access URL. Their user record will be automatically provisioned upon initial login.
2. To elevate a user to Administrator, navigate to **Settings → Users** (Admin only).
3. Click the user row, change their role dropdown from **User** to **Admin**, and save.

### Granular Library Permissions
Comics Now! supports fine-grained access control so you can share specific sections of your collection with family or friends without exposing your entire library.

Navigate to **Settings → Users → Permissions**:
- **Root Folder Access**: Grant or revoke access to entire library directories (e.g. "Kids Comics" vs "General Library").
- **Publisher Access**: Grant access to specific publishers (e.g., Marvel, DC, Image). Setting `child_access=true` automatically inherits access to all current and future series under that publisher.
- **Series Access**: Restrict a user to specific comic titles.
- **Folder Mode Permissions**: When using Folder Mode, permissions can be granted per physical directory.

### Admin Impersonation Mode
Admins can verify what restricted users see without logging out:
1. Go to **Settings → Users**.
2. Click **Impersonate User** next to any account.
3. The interface immediately switches to that user's view, applying their exact library restrictions and reading history.
4. An amber warning banner appears at the bottom of the screen with an **"Exit Impersonation"** button to return to your admin view.

### User Statistics
Navigate to **Settings → User Stats** to view:
- Total comics read per user.
- Pages read per week/month.
- Active devices and last-seen timestamps.

---

# 5. Libraries, Folder Structures & Scanning

### Adding a Library
1. Open **Settings → Libraries**.
2. Click **Add Library**.
3. Provide a **Display Name** (e.g., "Main Collection") and the **Folder Path** inside the container (e.g. `/comics`).
4. Select the organization mode: **Metadata Mode** or **Folder Mode**.

### Metadata Mode vs. Folder Mode

| Feature | Metadata Mode (Default) | Folder Mode |
| :--- | :--- | :--- |
| **Hierarchy** | `Root Folder → Publisher → Series → Issue` | `Root Folder → Folder 1 → Folder 2 → File` |
| **Source of Truth** | Embedded `ComicInfo.xml` or sidecar | Physical filesystem layout on disk |
| **Best For** | Curated collections, standardized naming | Unsorted collections, custom directory trees |
| **Filtering** | By publisher, publication year, volume | By folder name |

### Scan Pipeline & Error Safeguards
When a scan is triggered (manually or via schedule):
1. **Recursive Traversal**: Scans all subdirectories for `.cbz`, `.cbr`, and `.pdf` files.
2. **Metadata Extraction**: Reads `ComicInfo.xml` from the archive or adjacent `.ComicInfo.xml` sidecar.
3. **Format Conversion**: Automatically converts PDFs or CBRs to CBZ (if enabled in settings).
4. **Thumbnail Generation**: Extracts the first page and saves an optimized WebP thumbnail into `/app/data/thumbnails/`.
5. **Database Sync**: Adds new records and updates modified files.
6. **I/O Error Safeguard**: If any directory fails to read during traversal (e.g. an unmounted NAS share), the server **aborts missing file cleanup immediately**. This prevents accidental deletion of reading progress or lists due to temporary disk disconnects.

### Scan Intervals & Scheduling
In **Settings → General Settings**:
- Configure **Scan Interval**: Set how frequently the server checks for new comics (e.g., every 6 hours, 24 hours, or a custom cron expression).
- Toggle **Full Rescan vs Quick Scan**: Quick scans inspect modified timestamps; Full rescans re-evaluate all metadata and covers.

---

# 6. Supported Formats, Auto-Conversion & Metadata Storage

### Supported Formats
- **CBZ (`.cbz`)**: Standard ZIP archive containing image files (`JPG`, `PNG`, `WEBP`, `GIF`).
- **CBR (`.cbr`)**: RAR archive containing image files.
- **PDF (`.pdf`)**: Adobe Portable Document Format.

### Automatic PDF & CBR Conversion to CBZ
In **Settings → Server Settings**:
- **Convert PDF to CBZ**: When enabled, the scanner invokes `pdftoppm` to extract PDF pages at native resolution and packages them into a lightweight `.cbz` archive.
- **Convert CBR to CBZ**: Uses `unrar` to extract proprietary RAR archives and repacks them into open `.cbz` archives for faster extraction and lower memory usage.

### The 3 Metadata Storage Options
When saving metadata in Comics Now!, you can choose where tags reside:

1. **Sidecar (`.ComicInfo.xml`) [Default]**:
   - Creates an XML file alongside the comic: `Spider-Man 001.ComicInfo.xml`.
   - **Pros**: 100% non-destructive. Preserves original comic file checksums, modification dates, and read-only storage mounts.
2. **Database-Only (`db`)**:
   - Stores metadata strictly in SQLite (`comics.metadata`).
   - **Pros**: Zero disk writes to your comic library. Perfect for read-only NAS mounts (`:ro`).
3. **Archive Write-Back (`archive`)**:
   - Repacks `ComicInfo.xml` directly inside the `.cbz` archive using native zip tools.
   - **Pros**: Truly portable. If you copy the CBZ to a tablet or external reader, all metadata travels inside the file.

---

# 7. The Tagging Engine & File Organization

Comics Now! includes an integrated tagging microservice powered by a dedicated Python backend (`tagger/app.py`).

### Multi-Source Metadata APIs
The tagger queries the following providers:
- **ComicVine**: Full issue details, writer/artist credits, character appearances, and volume numbers.
- **Metron**: Community-maintained open comic database.
- **Grand Comics Database (GCD)**: Comprehensive historical comic archive.
- **Goodreads & Amazon**: Ideal for trade paperbacks, graphic novels, and ISBN lookups.
- **Google Books, Blackwells, Waterstones, LCG**: Supplemental publisher and store indicia.

### The Tagger UI & Matching Workflow
1. Navigate to the **Tagger** tab.
2. Select a comic or folder to inspect.
3. The engine extracts the cover image, computes an image perceptual hash (`imagehash`), and matches it against online covers.
4. **Side-by-Side Review**: Displays the candidate match, match confidence percentage, publication year, and cover art.
5. Click **Apply Tags** to confirm.

### Automatic Renaming & Moving
In **Settings → Tagger Settings**, configure automated file organization rules:
- **Naming Pattern**: `{Series} #{Number} ({Year})`
- **Folder Pattern**: `{Publisher}/{Series} (v{Volume})/`
- When enabled, applying tags automatically moves and renames the file on disk into a clean, uniform directory tree.

---

# 8. Smart Guided View & Reading Modes

### How Guided View Works (Deep Learning / ONNX)
Comics Now! features an AI-driven panel detection pipeline:
- Utilizes `onnxruntime-node` with two specialized computer vision models:
  - `western.onnx`: Optimized for Western comic layouts (left-to-right, top-to-bottom).
  - `manga.onnx`: Optimized for Japanese manga layouts (right-to-left).
- Analyzes page contrast, borders, and margins to compute exact panel coordinates (`[x, y, width, height]`) and speech bubble regions.

### Admin-Generated, Community Shared
- Panel detection is computationally intensive. Therefore, **generating Guided View is an Admin privilege** (via the comic card long-press menu or Comic Summary page).
- Once computed, the panel maps are saved permanently in the database.
- **Every user** with access to that comic can then read it in Guided View with zero performance overhead.

### Reading Modes
Switch between reading modes instantly in the reader overlay:
1. **Standard Mode**: Single page view with left/right page flipping.
2. **Continuous Mode**: Infinite vertical scroll down all pages (ideal for webtoons and mobile phones).
3. **Manga Mode**: Right-to-left reading flow with reversed navigation touches and keyboard arrows.
4. **Guided View**: Zooms and pans into each individual panel sequentially with smooth animations.
5. **Bubble Zoom**: Focuses dynamically on dialogue balloons for easy reading on small phone screens.
6. **Hot Zoom**: Automatic pan-and-scan focusing on active narrative areas.

### Display & Viewport Controls
- **Fit to Height**: Scales page height to 100% viewport height.
- **Fit to Width**: Scales page width to 100% viewport width.
- **Orientation Lock**: Portrait, Landscape, or Auto Dual-Page Spread.
- **Full Page Overview**: Double-tap in Guided View to view the full page before stepping to the next page's panels.

---

# 9. Reading Lists

Reading lists allow you to curate custom story arcs, crossovers, and reading orders across multiple series and publishers.

### Creating & Managing Lists
1. In the **Reading Lists** tab, click **New List**.
2. Give your list a title (e.g. *"Civil War - Complete Chronology"*) and optional description.
3. Add comics from any publisher or series directly using the **Add to List** option on any comic card.

### Reordering Comics & Lists
- Open the reading list and drag-and-drop issues to set the exact chronological or crossover reading sequence.
- Save the custom sequence via **Save Order**.

### Syncing Lists to All Users (`syncToAll`)
- When an Administrator creates a curated list, they can toggle **Sync to All Users**.
- This automatically mirrors the reading list and its custom sequence to every user on the server.
- Individual users maintain their own read/unread progress through the synced list.

### Bulk Operations & Import
- **Bulk Add / Remove**: Add entire series to a list with one click.
- **Mark List Read/Unread**: Toggle read status for all issues in the list simultaneously.
- **Import**: Import reading lists from JSON definitions or external community guides.

---

# 10. Devices, Progress Syncing & Offline PWA

### How Device Tracking Works
- Every client browser generates a persistent, unique device identifier (`deviceId`) stored in `localStorage`.
- When connecting, the server registers the device name (e.g., *"iPad Pro - Safari"*, *"Pixel 8 - Chrome"*) under **Settings → Devices**.
- Unclaimed devices are automatically bound to the authenticated user.

### Cross-Device Reading Progress
- As you read, the reader sends progress heartbeats (`page`, `totalPages`, `completed`) to `/api/v1/comics/:id/progress`.
- Progress is stored in the database per-user.
- When you open the same comic on another device, Comics Now! prompts you to resume from where you left off.

### The Downloads Queue
- Comics, series, or entire reading lists can be queued for offline reading via the **Download** button.
- The Downloads manager downloads pages in the background and stores them in browser **IndexedDB**.
- The download queue is persistent and resumes automatically if interrupted.

### Installing as an Offline PWA
Comics Now! is a full Progressive Web App:
- **On iOS / iPadOS**: Open the app in Safari, tap the **Share** button, and select **Add to Home Screen**.
- **On Android**: In Chrome, tap the menu and select **Install App** or **Add to Home screen**.
- **On Desktop (Chrome/Edge)**: Click the **Install** icon in the URL address bar.
- Once installed, downloaded comics can be read completely offline with zero internet access.

---

# 11. UI Navigation, Views & Long-Press Menus

Comics Now! features responsive touch controls and context menus accessible via right-click (desktop) or long-press (touch devices):

### Library Card View (Long-Press Actions)
- **Rescan Folder**: Triggers an immediate rescan of that specific library path.
- **Edit Library**: Modify display name or storage paths (Admin only).
- **Remove Library**: Detach library mapping from the server (Admin only).

### Publisher View (Long-Press Actions)
- **Mark All as Read**: Marks all series and issues from this publisher as read.
- **Mark All as Unread**: Clears read progress across the entire publisher catalog.
- **Change Logo**: Upload or replace the publisher's cover logo (Admin only).

### Series View (Long-Press Actions)
- **Mark Series as Read / Unread**: Toggle progress for every issue in the series.
- **Add Series to Reading List**: Appends all comics in the series to a reading list.
- **Download Series**: Queues every issue in the series into the offline download manager.

### Comic Card View (Long-Press Actions)
- **Mark Read / Unread**: Toggles read status badge.
- **Add to Reading List**: Adds the issue to an existing or new reading list.
- **Download for Offline**: Caches the comic in local IndexedDB.
- **View Details**: Opens the Comic Summary modal.
- **Generate Guided View**: Triggers AI panel detection (Admin only).

### Comic Summary / Details Modal
Opening a comic's details reveals:
- Full cover art preview, title, issue number, publication date, creators, and synopsis.
- **Read / Viewer Button**: Launches the reader at your last read page.
- **Manga Button**: Quickly toggles the comic's reading direction between LTR and RTL.
- **Metadata Button**: Opens the metadata editor.

### Editing Singular Comic Metadata
In the Metadata Editor:
- Edit issue number, volume, publication date, creators (Writer, Penciller, Colorist), summary, and notes.
- Click **Search ComicVine** to auto-match and populate fields automatically.
- Choose metadata destination: **Sidecar XML**, **Database Only**, or **Archive Write-Back**.

### Adding Local Comics (Client-Side Reader)
- Navigate to the **Local** tab.
- Drag-and-drop or select CBZ/CBR files directly from your phone, tablet, or PC.
- Files are parsed entirely client-side using WebAssembly (`jszip` / `node-unrar-js`) with zero server uploading. Reading progress is stored locally in your browser.

### The User Pill
Located in the bottom-left corner of the interface:
- Displays user avatar, email initial, and active role (`Admin` or `User`).
- Displays active device name.
- When an admin is impersonating another account, turns amber with an **"Exit Impersonation"** shortcut.
- Clicking the pill opens user profile preferences, device manager, and sign-out.

---

# 12. Search, Filtering & Custom Publisher Logos

### Global Search & Smart Filters
- **Global Search Bar**: Instant search across comic titles, series, publishers, writers, artists, and release years.
- **Status Filters**: Filter by **Unread**, **In Progress**, or **Completed**.
- **Publisher Filters**: Filter reading lists or library views by specific publishers.
- **Sorting Options**: Sort by Alphabetical (A-Z / Z-A), Issue Number, Publication Date, or Date Added to Library.

### Custom Publisher Logos
Publisher logos appear on publisher cards throughout the interface.
- Logos are stored on disk in the `logos/` directory:
  ```text
  logos/
  ├── Marvel/
  │   └── logo.png
  ├── DC Comics/
  │   └── logo.svg
  └── Image Comics/
      └── logo.jpg
  ```
- **Supported Formats**: `.png`, `.jpg`, `.jpeg`, `.svg`, `.webp`.
- **How to Add**:
  - **Method 1 (UI)**: Long-press any publisher card and click **Change Logo** to upload.
  - **Method 2 (Filesystem)**: Create a folder inside `logos/` matching the publisher name and place your image inside.
- If no custom logo is uploaded, Comics Now! automatically generates a colored brand badge using the publisher's initial letter.

---

# 13. Model Context Protocol (MCP) Server

Comics Now! includes a native **Model Context Protocol (MCP)** server (`mcp/comics_mcp/server.py`), allowing LLM assistants (Claude Desktop, Claude Code, Cursor, Gemini CLI) to interact directly with your comic library.

### MCP Overview
The MCP server communicates locally with Comics Now! as an admin, giving your AI agent the ability to:
- Curate reading orders and build reading lists automatically based on comic book crossover events.
- Visually identify un-tagged comics from native cover page scans.
- Run read-only SQLite queries across your library.
- Safely call REST endpoints with built-in protection against destructive file operations (`COMICS_ALLOW_DESTRUCTIVE=0` by default).

### MCP Setup & Launcher
1. Install Python dependencies:
   ```bash
   cd mcp
   python3 -m venv .venv
   ./.venv/bin/pip install -r requirements.txt
   cp .env.example .env
   ```
2. Start the server (default `stdio` mode):
   ```bash
   bash mcp/run.sh
   # Or via npm
   npm run mcp
   ```

### Client Configuration

#### Claude Code:
```bash
claude mcp add comics-now -- /path/to/comics-now/mcp/run.sh
```

#### Claude Desktop (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "comics-now": {
      "command": "/path/to/comics-now/mcp/run.sh"
    }
  }
}
```

#### Gemini CLI (`~/.gemini/settings.json`):
```json
{
  "mcpServers": {
    "comics-now": {
      "command": "/path/to/comics-now/mcp/run.sh"
    }
  }
}
```

### AI Capabilities
- **Visual Cover Tagging (`get_cover_image`, `tag_workflow`, `set_tags`)**:
  The AI extracts native resolution cover art, inspects logos, issue numbers, and trade dress, searches the web to verify the exact issue, and writes ComicInfo metadata.
- **Reading List Generation (`create_reading_lists_bulk`)**:
  Ask the AI: *"Create a reading list for the Batman: Knightfall crossover in chronological order."* The AI queries your library, resolves comic IDs, and builds the sorted reading list automatically.
- **Safe SQL Queries (`query_db`)**:
  Runs read-only `SELECT` / `PRAGMA` queries to inspect library statistics, missing issues, or unread counts.

---

# 14. System Logs & Maintenance

### Logs Viewer
Navigate to **Settings → Logs**:
- Filter logs by **Level**: `INFO`, `WARN`, `ERROR`.
- Filter logs by **Category**:
  - `SCAN`: Library file discovery, conversion, and thumbnail generation.
  - `AUTH`: Cloudflare Access JWT validation, LAN elevation, and impersonation.
  - `TAGGER`: Metadata API calls, cover matching, and renaming actions.
  - `META`: `ComicInfo.xml` reading and archive write-back.
  - `DB`: SQLite migrations, statement caching, and query health.

### Database Backups
All server state resides in SQLite databases inside your data directory (`/app/data/comics-now.db`).
- Back up `comics-now.db` periodically.
- Because WAL mode (`Write-Ahead Logging`) is enabled, ensure `comics-now.db-wal` and `comics-now.db-shm` are preserved when copying live databases.
