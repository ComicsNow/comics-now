# Comics Now! Complete Wiki & Documentation Manual

Welcome to the definitive user, administrator, and developer guide for **Comics Now!** — a modern, self-hosted comic book library server, reader, and organizer.

For the complete REST endpoint reference — every route under `/api/v1` with parameters, request bodies, and admin-only notes — see the companion **[API Documentation](API.md)** (`docs/API.md`).

---

# Table of Contents
1. [What is Comics Now!?](#1-what-is-comics-now)
2. [Installation & Deployment](#2-installation--deployment)
   - [Docker (Recommended)](#docker-recommended)
   - [Docker Compose](#docker-compose)
   - [Bare Metal Installation](#bare-metal-installation)
   - [Configuration Reference (`config.json`)](#configuration-reference-configjson)
     - [App Secrets & Envelope Encryption (AES-256-GCM)](#7-app-secrets--envelope-encryption-aes-256-gcm)
     - [What Can vs. Cannot Be Updated in the UI](#what-can-vs-cannot-be-updated-in-the-ui)
     - [Updating Settings Inside the Web UI](#updating-settings-inside-the-web-ui)
     - [Updating Settings Outside the Web UI](#updating-settings-outside-the-web-ui)
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
   - [Web URL Tagging & Gemini AI Synthesis](#web-url-tagging--gemini-ai-synthesis)
   - [Multi-Source Synthesis & Manual Staging Modal](#multi-source-synthesis--manual-staging-modal)
   - [Grand Comics Database (GCD) & Cover Cascade](#grand-comics-database-gcd--cover-cascade)
   - [The Tag Comics Now! UI & Matching Workflow](#the-tag-comics-now-ui--matching-workflow)
   - [Automatic Renaming & Moving](#automatic-renaming--moving)
8. [Smart Guided View & Reading Modes](#8-smart-guided-view--reading-modes)
   - [How Guided View Works (Deep Learning / ONNX)](#how-guided-view-works-deep-learning--onnx)
   - [Modal Serverless GPU Acceleration (Cloud GPU Speedup)](#modal-serverless-gpu-acceleration-cloud-gpu-speedup)
   - [Admin-Generated, Community Shared](#admin-generated-community-shared)
   - [Reading Modes](#reading-modes)
   - [Display & Viewport Controls](#display--viewport-controls)
   - [Fullscreen Thumbnail Filmstrip & Scrubber](#fullscreen-thumbnail-filmstrip--scrubber)
   - [Authoring & Editing Guided View with GVE Now!](#authoring--editing-guided-view-with-gve-now)
9. [Reading Lists](#9-reading-lists)
   - [Creating & Managing Lists](#creating--managing-lists)
   - [Interactive Continuity DAG View (Directed Acyclic Graph)](#interactive-continuity-dag-view-directed-acyclic-graph)
   - [View Modes: Grid, List & DAG](#view-modes-grid-list--dag)
   - [Reordering Comics & Lists](#reordering-comics--lists)
   - [Syncing Lists to All Users (`syncToAll`)](#syncing-lists-to-all-users-synctoall)
   - [Bulk Operations & Import](#bulk-operations--import)
10. [Devices, Progress Syncing & Offline PWA](#10-devices-progress-syncing--offline-pwa)
    - [How Device Tracking Works](#how-device-tracking-works)
    - [Cross-Device Reading Progress](#cross-device-reading-progress)
    - [The Downloads Queue](#the-downloads-queue)
    - [Installing as an Offline PWA](#installing-as-an-offline-pwa)
    - [Active Connectivity Probing & Doze Self-Healing](#active-connectivity-probing--doze-self-healing)
11. [UI Navigation, Views & Long-Press Menus](#11-ui-navigation-views--long-press-menus)
    - [Comic Card & Viewer Typography Hierarchy](#comic-card--viewer-typography-hierarchy)
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
    - [Configuration & Environment Variables](#mcp-configuration--environment-variables)
    - [GVE Now Companion Integration](#gve-now-companion-integration)
    - [Changing the Port & Systemd Service](#changing-the-port--systemd-service)
    - [Client Configuration](#client-configuration)
    - [AI Capabilities (Tagging, Reading Lists, SQL)](#ai-capabilities)
14. [System Logs & Maintenance](#14-system-logs--maintenance)
    - [Logs Viewer](#logs-viewer)
    - [SQLite High-Performance Architecture & Compaction](#sqlite-high-performance-architecture--compaction)
    - [Database Backups](#database-backups)

**Companion Document:** [REST API Reference (docs/API.md)](API.md)

---

# 1. What is Comics Now!?

**Comics Now!** is a high-performance web platform engineered specifically for digital comic book collectors, enthusiasts, and shared family/community servers.

Unlike traditional media servers retrofitted for comic books, Comics Now! was built from the ground up for comics:
- **Interactive Panel & Bubble Zoom**: Automatically analyzes comic pages using pre-trained deep learning vision models (`western.onnx` and `manga.onnx`) or cloud GPUs to detect panels and dialogue bubbles for fluid tap-to-zoom reading.
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

### Configuration Reference (`config.json`)

Comics Now! stores its persistent configuration in `data/config.json` (or wherever `$DATA_DIR` is mounted). A clean, ready-to-copy template is provided in the repository root as [`config.example.json`](../config.example.json).

#### Hierarchy & Precedence
Settings are resolved in the following order:
1. **Environment Variables**: Overrides any file configuration (e.g., `PORT`, `BASE_URL`, `COMICS_LOCATION`, `TRUST_PROXY`).
2. **`data/config.json`**: Persistent server-side settings on disk.
3. **Built-in Defaults**: Hardcoded fallback values in `server/config.js`.

> [!IMPORTANT]
> The configuration file must be valid, RFC 8259-compliant JSON. **Do not include JavaScript comments (`//` or `/* */`)** in `data/config.json`. If a JSON syntax error occurs during boot, Comics Now! logs an error and falls back to safe built-in defaults.

#### Complete Parameter Reference

##### 1. Server & Network
| Key | Type | Default | Description |
|---|---|---|---|
| `port` | `number` | `3000` | HTTP listening port for the web server. |
| `baseUrl` | `string` | `"/"` | Path prefix where Comics Now! is served. Use `"/"` for root domain hosting, or a subpath like `"/comics"` if reverse-proxying behind a prefix. |
| `trustProxy` | `boolean` \| `number` | `false` | Enable when running behind reverse proxies or tunnels (e.g. `1` or `true` for Cloudflare, Nginx, or Traefik) so client IP addresses and protocols are resolved accurately. |
| `cors.enabled` | `boolean` | `true` | Enables or disables Cross-Origin Resource Sharing. |
| `cors.allowedOrigins` | `array` | `[...]` | List of allowed origin URLs permitted to make cross-origin requests. |

##### 2. Libraries & Ingestion
| Key | Type | Default | Description |
|---|---|---|---|
| `libraries` | `array` | `[]` | List of library objects: `[{"path": "/comics/organized", "hierarchyMode": "metadata"}]`. |
| `libraries[].path` | `string` | — | Absolute filesystem directory containing comic files. |
| `libraries[].hierarchyMode` | `string` | `"metadata"` | `"metadata"` organizes the UI by Publisher and Series extracted from ComicInfo.xml. `"folder"` mirrors the physical folder hierarchy on disk. |
| `comicsLocation` | `string` | `"/comics"` | Ingestion/inbox workspace where Tag Comics Now! scans for untagged or newly downloaded CBZ files. |
| `scanIntervalMinutes` | `number` | `5` | Frequency (in minutes) of background filesystem scans to discover new comics. |
| `allowed_formats` | `string` | `"cbz"` | Permitted archive formats. Automatic conversion converts PDF and CBR to CBZ. |
| `metadata_storage` | `string` | `"archive"` | Where comic metadata is stored: `"sidecar"` (writes external `.ComicInfo.xml` files alongside the comic), `"archive"` (embeds `ComicInfo.xml` directly inside the `.cbz` zip archive), or `"database"` (stored in SQLite only). |

##### 3. Tag Comics Now! & Metadata Services
| Key | Type | Default | Description |
|---|---|---|---|
| `taggerMode` | `string` | `"new"` | Tagger subsystem architecture. `"new"` runs the embedded Python tagger service. |
| `taggerServiceUrl` | `string` | `"http://127.0.0.1:5000"` | Local URL endpoint of the Python tagger service. |
| `taggerLowerThreshold` | `number` | `0.80` | Minimum confidence score (0.0 to 1.0) required to present an issue match candidate. |
| `taggerUpperThreshold` | `number` | `0.90` | High-confidence threshold (0.0 to 1.0) for automated acceptance. |
| `taggerEnabledSources` | `array` | `[...]` | Metadata scraper sources enabled for queries (`src-comicvine`, `src-metron`, `src-gcd`, `src-lcg`, `src-goodreads`, `src-blackwells`, `src-waterstones`, `src-googlebooks`, `src-amazon`, `src-forbiddenplanet`). |
| `ctScheduleMinutes` | `number` | `60` | Scheduled interval for background tagger processing jobs. |

##### 4. Third-Party Scraper Accounts & API Keys
| Key | Type | Default | Description |
|---|---|---|---|
| `comicVineApiKey` | `string` | `""` | ComicVine API key for scraping issues, characters, and volume metadata. |
| `googleBooksApiKey` | `string` | `""` | Google Books API key for ISBN, graphic novel, and TPB matching. |
| `metronUser` | `string` | `""` | Metron comic database username. |
| `metronPassword` | `string` | `""` | Metron comic database account password. |
| `gcdUser` | `string` | `""` | Grand Comics Database (GCD) login email/username. |
| `gcdPassword` | `string` | `""` | Grand Comics Database (GCD) password. |

##### 5. Google Gemini AI Cover Matching & OCR
| Key | Type | Default | Description |
|---|---|---|---|
| `geminiApiKey` | `string` | `""` | Google Gemini API key used for visual cover recognition, text extraction, and metadata synthesis. |
| `geminiModel` | `string` | `"gemini-3.5-flash-lite"` | Gemini model used for multimodal cover recognition. |
| `geminiCoverMatchEnabled` | `boolean` | `true` | Toggles visual cover matching when textual title/issue scraping fails. |
| `geminiCoverDailyCap` | `number` | `450` | Maximum Gemini cover API requests allowed per 24 hours to prevent unexpected API costs. |
| `geminiTermsAccepted` | `boolean` | `false` | Must be set to `true` to acknowledge and activate Gemini features. |

##### 6. Authentication & Cloudflare Zero Trust
| Key | Type | Default | Description |
|---|---|---|---|
| `authentication.enabled` | `boolean` | `false` | When `true`, enforces authentication headers via Cloudflare Access JWT. |
| `authentication.adminEmail` | `string` | `""` | Primary administrator email. Requests with this email receive unrestricted administrative privileges. |
| `authentication.userEmail` | `string` | `""` | Default user email for regular access. |
| `authentication.cloudflare.teamDomain` | `string` | `""` | Cloudflare Access team domain (e.g. `your-team.cloudflareaccess.com`). |
| `authentication.cloudflare.audience` | `string` | `""` | Application Audience (AUD) tag generated in Cloudflare Zero Trust. |
| `authentication.trustedIPs` | `array` | `[]` | List of local IP addresses or wildcards (e.g. `["127.0.0.1", "::1", "192.168.1.*"]`) that bypass authentication and are granted local admin rights. |

##### 7. App Secrets & Envelope Encryption (AES-256-GCM)
All third-party credentials (API keys, scraper passwords, AI tokens, cloud GPU secrets) entered in Comics Now! are automatically encrypted at rest using industry-standard **AES-256-GCM envelope encryption**.

| Master Key Source | Precedence | Description |
|---|---|---|
| `COMICS_SECRET_KEY` | 1 (Highest) | Passphrase or master key passed via environment variable (hashed with SHA-256 to derive a 256-bit AES key). Ideal for Docker or systemd environments. |
| `COMICS_SECRET_KEY_FILE` | 2 | Path to a secret file containing the master key (e.g. Docker Secret `/run/secrets/comics_secret_key` or Kubernetes secret volume). |
| `data/.app_secret` | 3 (Default) | Automatically generated 256-bit cryptographic key created with strict `0600` Linux file permissions on first boot. Persisted in the `data/` volume and ignored by git. |
| `COMICS_SECRET_KEY_PATH` | (Custom path) | Custom file path override for `.app_secret` if non-default storage is required. |

###### Protected Secrets:
The following secrets are transparently encrypted in SQLite (`settings` table) with the tagged format `enc:v1:<iv>:<tag>:<ciphertext>`:
- `comicVineApiKey`
- `googleBooksApiKey`
- `metronPassword`
- `gcdPassword`
- `geminiApiKey`
- `guided.modalTokenSecret` (Modal GPU Cloud secret)
- `impersonation_secret` (Admin impersonation token)

###### Features:
- **Zero-Downtime Migration**: On startup, Comics Now! checks for unencrypted plaintext credentials from older versions and automatically encrypts them in place.
- **Safe Passthrough**: If a credential is unencrypted, the decryptor transparently passes it through without failing or corrupting data.
- **UI Masking**: Web interfaces receive masked placeholders (`••••••••••••<last4>`) to prevent shoulder-surfing and network log exposure. If a form is saved without modifying the masked value, the existing encrypted secret is preserved intact.

---

#### What Can vs. Cannot Be Updated in the UI

To keep server startup safe and predictable, Comics Now! divides configuration parameters into two groups:

| Category | Settings | Can Be Configured in UI? | Why / When to Update |
|---|---|:---:|---|
| **Boot Only (`[BOOT]`)** | `baseUrl`<br>`port`<br>`trustProxy`<br>`authentication` (`enabled`, `adminEmail`, `cloudflare`)<br>`cors` | ❌ **No** | **Server Initialization**: Express router paths, listening ports, reverse proxy headers, and authentication security middlewares are assembled on server boot before any web requests can be handled. Must be set in `config.json` or via environment variables before launch. |
| **UI Configurable (`[UI]`)** | `libraries`<br>`comicsLocation`<br>`metadata_storage`<br>`scanIntervalMinutes`<br>`allowed_formats`<br>`comicVineApiKey`<br>`googleBooksApiKey`<br>`metronUser` / `metronPassword`<br>`gcdUser` / `gcdPassword`<br>`geminiApiKey` / `geminiModel`<br>`geminiCoverMatchEnabled`<br>`geminiCoverDailyCap`<br>`geminiTermsAccepted`<br>`taggerLowerThreshold`<br>`taggerUpperThreshold`<br>`taggerEnabledSources`<br>`ctScheduleMinutes`<br>`namingRules`<br>`folderRules`<br>User Accounts & Permissions | ✅ **Yes** | **Runtime Operation**: Can be set anytime directly in the web browser. The server automatically updates memory state, synchronizes the SQLite database, and persists the changes back to `data/config.json`. No server restart required! |

---

#### Updating Settings Inside the Web UI

Administrators can configure all runtime settings directly in the browser:

1. **Managing Libraries & Paths**:
   - Click the **Settings (gear icon)** in the header.
   - Under **Libraries**, enter the absolute directory path of your comic collection.
   - Choose the hierarchy mode:
     - **Metadata Mode**: Groups issues by Publisher and Series parsed from internal `ComicInfo.xml`.
     - **Folder Mode**: Reflects the physical directory tree on disk.
   - Click **Add Library**. Comics Now! validates the path and begins background indexing.
2. **Scan Intervals & Storage Strategy**:
   - In **Settings → General**, adjust the **Scan Interval** (minutes) for background filesystem discovery.
   - Select **Metadata Storage Mode**:
     - `sidecar`: Writes an external `.ComicInfo.xml` beside each comic archive (ideal for read-only archives).
     - `archive`: Writes metadata directly inside the `.cbz` archive.
     - `db`: Saves metadata strictly in the local SQLite database.
   - Set **Allowed Formats** (`cbz`, `cbr`, or `both`).
3. **Scraper Credentials & API Keys**:
   - Open **Tag Comics Now!** from the navigation bar.
   - Switch to the **Settings & Sources** tab.
   - Enter your **ComicVine API Key**, **Google Books API Key**, **Metron** username/password, and **GCD** account credentials.
   - Toggle individual scraper source checkboxes on or off based on your preferences.
   - Set your **Inbox Directory** (`comicsLocation`) where incoming untagged issues land.
   - Adjust **Lower Threshold** (minimum score to suggest a match) and **Upper Threshold** (score for automated acceptance).
4. **Google Gemini AI Cover Matching & OCR**:
   - Open **Tag Comics Now! → Gemini** tab.
   - Enter your **Gemini API Key** and choose your model (e.g. `gemini-3.5-flash-lite`).
   - Toggle **Visual Cover Matching** on to enable multimodal AI identification for covers with missing or obscure filenames.
   - Set the **Daily Request Cap** (e.g. `450`) to safeguard against unexpected API expenses.
   - Check the **Terms of Service** acceptance checkbox and click **Save Settings**.
5. **Organization & Auto-Renaming Rules**:
   - In **Tag Comics Now!**, visit **Naming Rules** and **Folder Rules**.
   - Enable/disable tokens (Series, Volume, Year, Issue Number, Publisher) and test formatting with the live preview tool.

> [!NOTE]
> When you save settings anywhere in the UI, Comics Now! updates its active runtime and automatically writes the new values to `data/config.json` via [`saveConfigToDisk()`](file:///opt/comics-now/server/config.js#L163-L185).

---

#### Updating Settings Outside the Web UI

Use file-based or environment variable configuration when performing automated deployments (Docker, Kubernetes, Ansible), setting up boot-only settings, or recovering from lockouts.

##### Method A: Editing `data/config.json`
1. Stop the service (optional but recommended when changing ports or base paths):
   ```bash
   sudo systemctl stop comics-now.service
   # Or for Docker:
   docker compose down
   ```
2. Open `data/config.json` in your preferred editor (`nano`, `vim`, or VS Code):
   ```bash
   nano data/config.json
   ```
3. Update your required keys. Ensure the file remains strictly valid JSON:
   - Use double quotes `"` around property names and strings.
   - Do **not** include JavaScript comments (`//` or `/* */`).
4. Save the file and restart the service:
   ```bash
   sudo systemctl start comics-now.service
   # Or for Docker:
   docker compose up -d
   ```

##### Method B: Using Environment Variables
Environment variables take top precedence and override values stored in `data/config.json`. This is ideal for containerized or 12-factor application deployments:

| Environment Variable | Equivalent `config.json` Key | Example Value |
|---|---|---|
| `PORT` | `port` | `3000` |
| `BASE_URL` | `baseUrl` | `/` or `/comics` |
| `TRUST_PROXY` | `trustProxy` | `1` or `true` |
| `COMICS_LOCATION` | `comicsLocation` | `/media/comics/inbox` |
| `SCAN_INTERVAL_MINUTES` | `scanIntervalMinutes` | `10` |
| `ALLOWED_FORMATS` | `allowed_formats` | `cbz` |
| `METADATA_STORAGE` | `metadata_storage` | `sidecar` |
| `COMICVINE_API_KEY` | `comicVineApiKey` | `66b29fe5...` |
| `GOOGLE_BOOKS_API_KEY` | `googleBooksApiKey` | `AIzaSy...` |
| `METRON_USER` | `metronUser` | `username` |
| `METRON_PASSWORD` | `metronPassword` | `password` |
| `GEMINI_API_KEY` | `geminiApiKey` | `AIzaSy...` |
| `GEMINI_MODEL` | `geminiModel` | `gemini-3.5-flash-lite` |
| `GEMINI_COVER_DAILY_CAP` | `geminiCoverDailyCap` | `500` |
| `TAGGER_SERVICE_URL` | `taggerServiceUrl` | `http://127.0.0.1:5000` |
| `TAGGER_LOWER_THRESHOLD` | `taggerLowerThreshold` | `0.75` |
| `TAGGER_UPPER_THRESHOLD` | `taggerUpperThreshold` | `0.90` |
| `CORS_ENABLED` | `cors.enabled` | `true` |
| `CORS_ALLOWED_ORIGINS` | `cors.allowedOrigins` | `https://example.com,http://localhost:3000` |
| `COMICS_SECRET_KEY` | Master Key (Passphrase) | `your-secret-master-passphrase` |
| `COMICS_SECRET_KEY_FILE` | Master Key (Secret File) | `/run/secrets/comics_secret_key` |
| `COMICS_SECRET_KEY_PATH` | Key File Path Override | `/opt/comics-now/data/.app_secret` |

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

### Web URL Tagging & Gemini AI Synthesis
Comics Now! supports direct one-click tagging from any web URL:
- **Universal URL Extraction**: Paste any link from League of Comic Geeks, ComicVine, Marvel Fandom, DC Database, Wikipedia, Goodreads, Amazon, or comic publisher stores directly into the tagger UI or via API endpoint `POST /api/v1/metadata/extract-from-url`.
- **Markdown Web Scraper**: Utilizes Jina Reader (`r.jina.ai`) to extract clean, ad-free semantic markdown from web pages without requiring brittle site-specific DOM scrapers.
- **Gemini AI Structured Extraction**: Extracted web markdown is processed by Google Gemini AI (such as `gemini-2.5-flash`), synthesizing canonical ComicInfo fields: Series, Issue Number, Volume, Story Title, Publisher, Imprint, Publication Date (Year, Month, Day), Issue Synopsis, Creators (Writers, Pencillers, Inkers, Colorists, Letterers, Cover Artists, Editors), Characters, Teams, Locations, and Genres.
- **Daily Quota Tracking**: The UI features an integrated Google Gemini daily usage counter (`#ct-gemini-daily-used`) calibrated against the 1,000 requests/day free tier, providing live visual feedback on remaining quota and automatic midnight reset tracking.
- **AI Agent Automation**: Fully accessible through native MCP tools `tag_comic_from_url` and `extract_metadata_from_url`.

### Multi-Source Synthesis & Manual Staging Modal
When tagging complex issues across divergent sources (e.g., ComicVine having full artist credits while GCD holds precise historical release dates and Goodreads provides graphic novel summaries):
- **Weighted Field Synthesis**: Automatically combines the most authoritative metadata fields from multiple scraping passes into a cohesive ComicInfo dataset.
- **Side-by-Side Staging Modal**: Preview proposed changes side-by-side with current file metadata. Inspect field differences before committing writes to your library.
- **Target Selection**: Save synthesized tags to **Sidecar XML (`.ComicInfo.xml`)**, **Database Only**, or **Archive Write-Back** directly into the CBZ archive.

### Grand Comics Database (GCD) & Cover Cascade
Comics Now! includes full native support for querying the **Grand Comics Database (GCD)** — one of the largest non-profit historical comic archives:
- **Authentication**: Optional GCD login credentials can be supplied under **Tag Comics Now! → Settings & Sources** to unlock member queries and higher rate limits.
- **Tiered Rate Limiting**: The tagger automatically respects GCD's request throttling rules with automatic backoff and local disk caching to prevent API bans.
- **3-Step Cover Cascade**: When identifying covers, the engine executes a prioritized multi-tier cascade:
  1. **Primary**: High-resolution scans from **ComicVine**.
  2. **Secondary**: Community scans from **Metron**.
  3. **Fallback Archive**: Historical scans from **GCD**.
  If a release lacks a cover on ComicVine or Metron, GCD fills the gap automatically.
- **Metadata Sanitization**: Synopses and issue descriptions scraped from online sources are sanitized automatically, stripping promotional bookstore sales ads, ISBN dump lines, and distributor placeholders before writing to your database or ComicInfo.xml sidecars.

### Service Port
The tagger listens on port `5000` by default — configurable via the `APP_PORT` environment variable (`APP_HOST` defaults to `0.0.0.0`). When embedded, Comics Now! spawns the tagger and proxies to it; change the port under **Tag Comics Now! → Settings & Sources → Service Port** and the app will spawn and proxy to the new port. For a standalone or sidecar tagger, set `APP_PORT` and point Comics Now! at the same port, or set `TAGGER_SERVICE_URL` (or `taggerServiceUrl` in `config.json`).

### The Tag Comics Now! UI & Matching Workflow
1. Open the **Tag Comics Now!** panel from the top bar.
2. Select a comic or folder to inspect.
3. The engine extracts the cover image, computes an image perceptual hash (`imagehash`), and matches it against online covers.
4. **Side-by-Side Review**: Displays the candidate match, match confidence percentage, publication year, and cover art.
5. Click **Apply Tags** to confirm.

### Automatic Renaming & Moving
In the **Tag Comics Now!** panel → **Management** tab → **Name** / **Folder** sub-tabs, configure automated file organization rules:
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

> [!NOTE]
> **Automated Guided View Buttons Removed**: The continuous automated guided view toggle buttons (which walked through panels sequentially on autopilot) have been removed from the reader interface, as automated sequential traversal was not good enough across complex, artistic comic layouts, non-linear page flows, and dynamic splash pages.
>
> **Interactive Panel Zoom & Bubble Zoom Remain Active**: Precision interactive zoom remains fully supported and active! Readers can tap directly on any detected panel (**Panel Zoom**) to zoom into it with smooth animation, or tap speech balloons to focus with high magnification (**Bubble Zoom**). In Manga mode, dedicated toolbar buttons provide on-demand Bubble Zoom and dual Panel Zoom controls with direct dialogue bubble priority and adaptive touch hit tolerance.

### Modal Serverless GPU Acceleration (Cloud GPU Speedup)
While local CPU detection runs smoothly on modern desktop processors, analyzing hundreds of pages with deep learning neural networks can take 30–60 seconds per issue on low-power servers, NAS hardware, or a Raspberry Pi.

Comics Now! supports offloading panel and dialogue bubble detection to cloud **NVIDIA T4 GPUs** via [Modal](https://modal.com):

| Feature | Local CPU Inference (ONNX) | Modal Serverless GPU (T4) |
| :--- | :--- | :--- |
| **Speed per Comic (24-32 pages)** | ~30 – 60 seconds | **~1 – 3 seconds** |
| **Local CPU Load (Raspberry Pi)** | 100% (High thermal load) | **≤ 50% (Cool & responsive)** |
| **Parallel Comic Processing** | 1 at a time (Sequential) | **2 comics simultaneously** |
| **Failure Handling** | N/A | **Automatic fallback to local CPU** |

#### Modal Free Tier & $30 Monthly Compute Credits
Every Modal account includes **$30.00 of recurring free compute credits every calendar month**. Because a single comic costs approximately **$0.0005 to $0.001** of GPU compute time, Modal's free allowance enables analyzing **30,000+ comic pages (~1,500+ issues) each month completely free**.

#### How to Add a $30 Budget Cap (Preventing Unexpected Charges)
To guarantee that you never incur unexpected charges on your credit card beyond Modal's free compute credit:

1. Log into your [Modal Dashboard](https://modal.com).
2. Navigate to **Settings → Billing / Usage** (or **Workspace Settings → Usage Limits**).
3. Under **Monthly Spending Limit**, enter:
   ```text
   $30.00
   ```
4. Set email notification alert thresholds (e.g. at **50%**, **80%**, and **100%**).
5. Click **Save Changes**.

Once this hard limit is reached, Modal immediately halts cloud function invocations instead of charging your card. Comics Now! detects the spend limit via live telemetry, displays a warning badge in the Admin UI, and automatically reverts to local CPU detection without interruption.

> [!WARNING]
> **User Responsibility & Billing Safeguards**: It is strictly your responsibility to configure your spending limits in your Modal account dashboard and monitor your usage. Comics Now! provides automated budget monitoring and safe fallbacks to local CPU, but cannot control third-party billing accounts or guarantee that third-party services will not bill you if you choose not to set a spend limit or configure a higher limit.

#### Step-by-Step Setup in Comics Now!
1. **Generate API Credentials**:
   - In your Modal dashboard, go to **Settings → API Tokens**.
   - Click **New Token** to generate a **Token ID** (`ak-...`) and **Token Secret** (`as-...`).
2. **Configure via Web Admin UI**:
   - Open Comics Now! and go to **Settings → Guided View**.
   - Check **Use Modal GPU Acceleration**.
   - Enter your **Token ID** and **Token Secret** (leave Environment as `main`).
   - Click **Test Connection** — this validates your API credentials and fetches your real-time Modal credit balance.
   - Click **⚡ Initialize Modal GPU Environment** — this performs a one-time deployment, creating a persistent Modal Volume (`comics-now-models`) and uploading the neural network models.
   - Under **Processing Concurrency**, select **2 Comics in parallel (Modal GPU)**.
   - Click **Save Settings**.
3. **Alternative: Environment Variables (`.env` or Docker Compose)**:
   ```bash
   MODAL_TOKEN_ID="ak-..."
   MODAL_TOKEN_SECRET="as-..."
   MODAL_ENVIRONMENT="main"
   ```

#### Live Telemetry & Balance Monitoring
In **Settings → Guided View**, Comics Now! displays a real-time status card showing:
- **Available Credit**: Remaining free monthly allowance.
- **Total Credits**: Overall account credit allotment ($30.00).
- **Metered Cost**: Cloud GPU compute incurred during the active billing cycle.
- **Billed Cost**: Any billed amount (remains $0.00 when the $30 cap is enforced).

### Admin-Generated, Community Shared
- Panel detection is computationally intensive. Therefore, **generating Guided View is an Admin privilege** (via the comic card long-press menu or Comic Summary page).
- Once computed, the panel maps are saved permanently in the database.
- **Every user** with access to that comic can then read it in Guided View with zero performance overhead.

### Reading Modes
Switch between reading modes instantly in the reader overlay:
1. **Standard Mode**: Single page view with left/right page flipping.
2. **Continuous Mode**: Infinite vertical scroll down all pages (ideal for webtoons and mobile phones).
3. **Manga Mode**: Right-to-left reading flow with reversed navigation touches, dedicated Bubble Zoom button, and dual Panel Zoom button.
4. **Interactive Panel Zoom**: Tap directly on any detected panel to zoom in smoothly. *(Note: Automated guided view sequence buttons have been removed as automated stepping was not good enough across diverse page layouts; interactive tap-to-zoom is the recommended experience).*
5. **Bubble Zoom**: Focuses dynamically on dialogue balloons for easy reading on small phone screens, with adaptive hit tolerance and direct tap priority.
6. **Hot Zoom**: Automatic pan-and-scan focusing on active narrative areas.

### Display & Viewport Controls
- **Fit to Height**: Scales page height to 100% viewport height.
- **Fit to Width**: Scales page width to 100% viewport width.
- **Orientation Lock**: Portrait, Landscape, or Auto Dual-Page Spread.
- **Full Page Overview**: Double-tap in zoom mode to return to full page overview.
- **E-Ink Anti-Ghosting Mode**: Toggle in the fullscreen toolbar cycles **Off → Monochrome → Color**, saved per device (Kindle, Kobo, Onyx Boox, and PocketBook are auto-detected on first visit). **Monochrome** applies a grayscale + contrast filter for black-and-white e-readers; **Color** boosts saturation for color e-paper displays. Both modes disable animations and flash the screen black on each page turn to prevent ghosting.
- **Cinema Pan (Spreads)**: In Fullscreen, wide double-page spreads pan across automatically when they overflow the screen, starting once per displayed page (a re-render never restarts a pan you've stopped; navigating away and back re-arms it). A **Cinema Pan Spread** badge indicates the spread — tap it to toggle panning manually; spreads that already fit the screen don't pan.

### Fullscreen Thumbnail Filmstrip & Scrubber
When reading in fullscreen mode on touch tablets, phones, or desktop monitors:
- **Horizontal Thumbnail Filmstrip**: Displays a touch-scrollable visual reel of all page thumbnails across the comic, allowing you to visually scan chapters, splash pages, and covers without leaving the reader.
- **Precision Page Scrubber**: A bottom slider bar that lets you jump across 100+ pages smoothly with real-time page number feedback.
- **Persistent Header Controls**: Fullscreen mode keeps the comic title and close/exit buttons permanently accessible at the top edge with calibrated z-index layering so zoom overlays never obscure navigation.

### Authoring & Editing Guided View with GVE Now!
While Comics Now! automatically extracts panels and dialogue balloons via deep learning (`manga.onnx` and `western.onnx`), you can inspect, author, and fine-tune panel coordinates using the official companion application: **[GVE Now! (Guided View Editor)](https://github.com/ComicsNow/gve-now-editor)**.

#### Key Features:
- **Visual Bounding Box Canvas**: Interactive editor allowing you to draw, resize, snap, and nudge panel borders and speech bubbles with 1:1 pixel accuracy.
- **Reading Order Sequencing**: Drag-and-drop sequencing to adjust panel transitions (critical for complex multi-tier layouts, splash pages, and non-linear storytelling).
- **Direct Database & Cache Integration**: Points directly at your Comics Now! installation via `comicsNowRoot` in `config.json` — shares the SQLite database, metadata sidecars, and WebP page cache without file duplication.
- **Live Sync to Reader**: Any edits saved in GVE Now! are instantly reflected in the Comics Now! web reader upon page reload.
- **Sidecar Management**: Generates and updates standalone `.guided.json` sidecar files adjacent to your `.cbz` archives, enabling portable guided-view metadata across setups.
- **Import & Export**: Backup panel coordinate maps or share community-authored guided views as clean JSON definitions.

To install and run GVE Now! alongside Comics Now!, follow the instructions in the [GVE Now! Repository](https://github.com/ComicsNow/gve-now-editor).

---

# 9. Reading Lists

Reading lists allow you to curate custom story arcs, crossovers, and reading orders across multiple series and publishers.

### Creating & Managing Lists
1. In the **Reading Lists** tab, click **New List**.
2. Give your list a title (e.g. *"Civil War - Complete Chronology"*) and optional description.
3. Add comics from any publisher or series directly using the **Add to List** option on any comic card.

### Interactive Continuity DAG View (Directed Acyclic Graph)
Reading lists in Comics Now! support a first-of-its-kind interactive **Continuity DAG visualizer**:
- **Multi-Series Crossover Timelines**: When reading complex multi-title crossovers (e.g., *Crisis on Infinite Earths*, *Absolute Universe*, *Infinity Gauntlet*), the DAG computes reading flow, arranges comics into distinct parallel series lanes, and renders directional Bézier curves between narrative milestones.
- **Fluid Zoom & Pan Navigation**: Navigate massive 100+ issue story arcs smoothly using mouse wheel zoom/pan on desktop or intuitive **pinch-to-zoom** and two-finger drag on mobile tablets and phones.
- **Click-to-Read Graph Nodes**: Tap or click any comic node directly within the DAG canvas to inspect issue metadata, check read status, or immediately launch the reader.
- **Live Search & Filter**: Instantly isolate specific character arcs or sub-series within massive reading lists using the live DAG search bar.

### View Modes: Grid, List & DAG
Every reading list features an instant 3-way segmented control at the top of the detail modal:
1. **Grid View (`⊞`)**: Visual poster-forward cover grid showcasing high-resolution cover art with read progress badges.
2. **List View (`☰`)**: Compact 3-line operational view designed for reading sessions:
   - **Line 1**: Comic title, series name, and publication date.
   - **Line 2**: Live reading status badge (completion tick, in-progress indicator, and exact percentage read).
   - **Line 3**: Dynamic action buttons: **[▶ Read]** or **[▶ Resume]**, Mark as Read/Unread, and an interactive **Download** button with deletion confirmation.
3. **DAG View (`🔀`)**: Fullscreen continuity map displaying narrative order flow.

### Reordering Comics & Lists
- Click **Edit** to enter reordering mode.
- Use the drag handles or up/down buttons on the left of each item to arrange issues into your desired narrative order.
- To protect against accidental deletions, list deletion and issue removal buttons (`🗑️`) only appear while **Edit** mode is active.
- Save changes via **Save Order** or discard with **Cancel**.

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

### Active Connectivity Probing & Doze Self-Healing
On mobile devices (especially Android PWAs/WebAPKs), the operating system's battery optimization (Doze Mode) suspends network sockets when the screen locks. In standard PWAs, this causes browsers to get stuck reporting `navigator.onLine === false` even after reconnecting to Wi-Fi.

Comics Now! incorporates an intelligent self-healing connectivity loop:
- **High-Speed Health Probe (`/api/v1/health`)**: An unauthenticated, zero-overhead endpoint designed for sub-millisecond network verification.
- **Wake-Up & Focus Re-Validation**: Whenever you unlock your phone or switch back to the PWA (`visibilitychange` and `focus` events), Comics Now! immediately probes the health endpoint.
- **Auto-Recovery**: If the probe succeeds, the app clears any offline indicators, dispatches a live `online` event, and refreshes library and reading list data without requiring you to restart or kill the app.

---

# 11. UI Navigation, Views & Long-Press Menus

Comics Now! features responsive touch controls and context menus accessible via right-click (desktop) or long-press (touch devices):

### Comic Card & Viewer Typography Hierarchy
Comics Now! applies modern comic editorial typography rules across comic cards, list views, search results, and reader headers:
- **Strict 2-Line Hierarchy**:
  - **Line 1 (Series & Issue Number)**: Rendered in punchy, high-contrast Anton condensed display typography (`{Series} #{Number}`).
  - **Line 2 (Story Title Subtitle)**: Displays the genuine narrative or story arc title (e.g., *"The Court of Owls"*, *"Knightfall Part 1"*).
  - **Zero Filename Leakage**: Technical filenames (e.g., `Batman_001_(2011)_(Digital)_(Zone-Empire).cbz`) are completely filtered out of subtitle candidates. If a comic does not have an explicit story arc title, Line 2 is left cleanly empty rather than displaying file extensions or redundant series names.
- **Electric Blue Focus Halos**: Card selection states, keyboard focus, and multi-select modes feature high-contrast electric blue halos (`ring-2 ring-blue-500/80 shadow-[0_0_15px_rgba(59,130,246,0.35)]`) inspired by modern DC Comics design language.

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

**Network mode**: The default `stdio` transport has no listening port. For network transports (e.g. remote use or SSE), set `MCP_TRANSPORT=sse` (or `streamable-http`), plus `MCP_HOST` and `MCP_PORT` in `mcp/.env` — `run.sh` loads that file automatically.

### MCP Configuration & Environment Variables

All runtime behavior is controlled by environment variables loaded from `mcp/.env`:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `COMICS_BASE_URL` | `http://localhost:3000` | Base URL of Comics Now! for API calls. |
| `GVE_BASE_URL` | `http://localhost:3100` | Base URL of the GVE Now! (Guided View Editor) companion app. |
| `COMICS_DB_PATH` | `/opt/comics-now/comics-now.db` | Absolute path to SQLite DB used by the read-only `query_db` tool. |
| `COMICS_ALLOW_DESTRUCTIVE` | `0` | Set to `1` to permit destructive operations (file deletes, renames, migrations). |
| `COMICS_TIMEOUT` | `60` | HTTP request timeout in seconds. |
| `COMICS_EXTRA_HEADERS` | `{}` | JSON string of extra headers (e.g. Cloudflare Service Tokens `{"CF-Access-Client-Id":"...","CF-Access-Client-Secret":"..."}`). |
| `MCP_TRANSPORT` | `stdio` | Transport protocol: `stdio` (local subprocess) or `sse` / `streamable-http` (network). |
| `MCP_HOST` | `127.0.0.1` | Network bind address. Set to `0.0.0.0` for LAN accessibility. |
| `MCP_PORT` | `8000` | Port for SSE/network transport (e.g. `3018`). |
| `MCP_DISABLE_DNS_REBINDING` | `0` | Set to `1` when accessing via local LAN or reverse proxy. |

### GVE Now Companion Integration

Comics Now! integrates natively with **GVE Now!** (port `3100`) for visual guided view editing. The MCP server provides dedicated tools that query GVE Now! under the hood:
* `inspect_guided_page(comic_id, page)`: Returns page image with panel bounding boxes and reading order badges alongside raw coordinates.
* `get_guided_page_data(comic_id, page)`: Retrieves page dimensions and sequence items from GVE.
* `apply_guided_page_fix(comic_id, page, items, order)`: Pushes validated speech/panel coordinates and reading orders directly to GVE Now with automatic backup.
* `reorder_guided_page(comic_id, page, order)`: Reorders panel and dialogue sequence without changing coordinates.

If GVE Now! is hosted on a different port, host, or behind a reverse proxy, set `GVE_BASE_URL` in `mcp/.env`:
```ini
GVE_BASE_URL=http://localhost:3100
# Or remote instance:
# GVE_BASE_URL=https://gve.example.com
```

### Changing the Port & Systemd Service

When running Comics Now MCP in the background as a Linux systemd service (e.g. `comics-mcp.service` on port `3018`):

#### 1. Systemd Service Definition (`/etc/systemd/system/comics-mcp.service`)
```ini
[Unit]
Description=Comics Now! MCP Server (SSE on port 3018)
After=network.target

[Service]
Type=simple
User=comicsnow
WorkingDirectory=/opt/comics-now/mcp
Environment=MCP_TRANSPORT=sse
Environment=MCP_HOST=0.0.0.0
Environment=MCP_PORT=3018
Environment=MCP_DISABLE_DNS_REBINDING=1
EnvironmentFile=/opt/comics-now/mcp/.env
ExecStart=/opt/comics-now/mcp/.venv/bin/python -m comics_mcp.server
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

#### 2. Changing the Listening Port
To change the port (e.g. from `3018` to another port):
1. Update `Environment=MCP_PORT=<NEW_PORT>` in `/etc/systemd/system/comics-mcp.service` (or `MCP_PORT=<NEW_PORT>` in `/opt/comics-now/mcp/.env`).
2. Reload systemd and restart the service:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart comics-mcp.service
   ```
3. Verify the service is listening on the new port:
   ```bash
   curl -I http://localhost:<NEW_PORT>/sse
   systemctl status comics-mcp.service
   ```
4. If using Homepage dashboard or a reverse proxy, update the port in your configuration:
   * In `/var/lib/homepage/config/services.yaml`:
     ```yaml
     - Comics MCP:
         href: http://<YOUR_SERVER_IP>:<NEW_PORT>/sse
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
- **Web URL Metadata Extraction & Tagging (`tag_comic_from_url`, `extract_metadata_from_url`)**:
  Ask the AI: *"Tag comic #412 using this League of Comic Geeks / Comic Vine / Fandom URL."* The MCP server scrapes clean markdown via Jina Reader, synthesizes canonical ComicInfo fields via Gemini AI, writes the tags directly to the comic file (sidecar XML, CBZ archive, or DB), and tracks requests against your daily Gemini quota counter.
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

### SQLite High-Performance Architecture & Compaction
Comics Now! is powered by SQLite via `better-sqlite3`, optimized for instant responsiveness across massive comic collections (100,000+ issues):
- **Memory-Mapped I/O (`mmap_size = 256MB`)**: Bypasses user-space buffer copying, allowing the OS kernel to page database blocks directly from memory into application space.
- **In-Memory Sorts & Temp Tables (`temp_store = MEMORY`)**: Heavy operations like complex reading list continuity DAG computations, multi-table sorting, and group-by aggregations execute entirely in RAM.
- **Expanded Page Cache (`cache_size = -64000`)**: Allocates 64MB of high-priority database cache in RAM, eliminating disk thrashing during library-wide browsing and search queries.
- **Write-Ahead Logging (`journal_mode = WAL`)**: Concurrent readers never block writers, and writes never block readers.
- **Optimized Covering & Composite Indexes**:
  - `idx_reading_list_items_list_sort`: Indexes `(readingListId, sortOrder)` on `reading_list_items`, delivering sub-millisecond reading list loads and continuity lane generation with zero table scans.
  - `idx_reading_lists_user_sort`: Indexes `(userId, sortOrder)` on `reading_lists` for instant dashboard and reading list drawer rendering.
  - `idx_comics_publisher_series`: Indexes `(publisher, series)` on `comics` to accelerate publisher/series navigation and breadcrumbs.
  - `idx_user_comic_status_comic`: Indexes `(comicId, userId)` on `user_comic_status` for fast read progress badge lookups across all card grids.
- **Startup Migration Idempotency Guards**:
  - Historical database migration loops (such as `migration_title_cleanup_v1` and `migration_creator_roles_v1`) are tracked with dedicated schema version entries in `schema_version`. Migrations run once on upgrade and exit immediately on subsequent boots, cutting server boot time to single-digit milliseconds.
- **Zero-Data-Loss Compaction (`VACUUM`)**:
  - Over extended usage, comic scans, thumbnail caching, and repeated metadata updates create unallocated free database pages. Running `VACUUM` defragments the database file and reclaims unallocated pages, offering potential storage savings of up to 40%–60%+ depending on catalog history and churn, without altering user lists or resetting user reading progress (strictly adhering to Project Rules 1 & 2).

### Database Backups
All server state resides in SQLite databases inside your data directory (`/app/data/comics-now.db`).
- Back up `comics-now.db` periodically.
- Because WAL mode (`Write-Ahead Logging`) is enabled, ensure `comics-now.db-wal` and `comics-now.db-shm` are preserved when copying live databases.
