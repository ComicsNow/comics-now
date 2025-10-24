# Comics Now!

A modern, self-hosted Progressive Web App (PWA) for managing and reading your digital comic book collection.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
  - [Basic Settings](#basic-settings)
  - [CORS Settings](#cors-settings)
  - [Authentication (Optional)](#authentication-optional)
- [Setting up Cloudflare Zero Trust Authentication](#setting-up-cloudflare-zero-trust-authentication)
- [Environment Variables](#environment-variables)
- [Running as a Service](#running-as-a-service)
- [Usage](#usage)
  - [Web Interface](#web-interface)
  - [ComicTagger Integration](#comictagger-integration)
  - [Manga Mode](#manga-mode)
  - [Continuous Mode](#continuous-mode)
  - [Context Menus](#context-menus)
  - [Offline Reading](#offline-reading)
  - [Multi-Device Sync](#multi-device-sync)
  - [Library Access Control](#library-access-control-admin-only)
- [API Endpoints](#api-endpoints)
- [Security](#security)

## Features

- 📚 Browse your comic collection by publisher, series, and issues
- 📖 Built-in comic reader with page navigation
- 📜 Continuous mode with vertical scrolling (webtoon-style reading)
- 📕 Hierarchical manga mode with right-to-left reading support (per-user)
- 🔒 Granular library access control with hierarchical permissions (admin)
- 🖱️ Context menus for quick actions (right-click or long-press)
- 🔄 Cross-device sync with progress tracking
- 📱 Offline support - download comics for offline reading
- 🏷️ ComicVine integration for metadata
- 🤖 ComicTagger integration for automated metadata tagging with visual comparison
- 🔐 Optional Cloudflare Zero Trust authentication
- 👥 Multi-user support with user roles and access control
- 📊 Reading progress tracking across devices

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd comics-now
```

2. Install dependencies:
```bash
npm install
```

3. Copy the example configuration:
```bash
cp config.example.json config.json
```

4. Edit `config.json` with your settings (see Configuration below)

5. Start the server:
```bash
npm start
```

## Configuration

Edit `config.json` to configure the application:

### Basic Settings

- **port**: Port number for the server (default: 3000)
- **baseUrl**: Base URL path for the application (e.g., `/comics` or `/`)
- **comictaggerPath**: Path to ComicTagger executable
- **comicsLocation**: Main directory containing your comics
- **comicsDirectories**: Array of directories to scan for comics

### CORS Settings

```json
"cors": {
  "enabled": true,
  "allowedOrigins": [
    "https://your-domain.com",
    "http://localhost:3000"
  ]
}
```

### Authentication (Optional)

Comics Now supports Cloudflare Zero Trust authentication for secure multi-user access.

```json
"authentication": {
  "enabled": false,
  "adminEmail": "admin@example.com",
  "cloudflare": {
    "teamDomain": "yourteam.cloudflareaccess.com",
    "audience": "your-application-audience-tag"
  },
  "trustedIPs": [
    "127.0.0.1",
    "::1",
    "192.168.1.*"
  ]
}
```

**Authentication Options:**

- **enabled**: Set to `true` to enable authentication, `false` to disable
- **adminEmail**: Email address of the administrator user
- **cloudflare.teamDomain**: Your Cloudflare Zero Trust team domain
- **cloudflare.audience**: Application Audience (AUD) tag from Cloudflare Access
- **trustedIPs**: Array of IP addresses/patterns that bypass authentication
  - Supports wildcards (e.g., `192.168.1.*` matches all IPs in that subnet)
  - Useful for local network access without authentication

## Setting up Cloudflare Zero Trust Authentication

### Prerequisites

- A Cloudflare account (free tier works)
- A domain managed by Cloudflare
- Comics Now installed and running

### Step 1: Enable Cloudflare Zero Trust

1. Log in to your [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **Zero Trust** in the sidebar
3. If first time, complete the Zero Trust onboarding
4. Note your **Team Domain** (e.g., `yourteam.cloudflareaccess.com`)

### Step 2: Create an Access Application

1. In Zero Trust dashboard, go to **Access** → **Applications**
2. Click **Add an application**
3. Select **Self-hosted** application type
4. Configure the application:

   **Application Configuration:**
   - **Application name**: `Comics Now` (or your preferred name)
   - **Session Duration**: Choose your preferred session length (e.g., 24 hours)
   - **Application domain**:
     - Subdomain: `comics` (or your subdomain)
     - Domain: Select your domain from dropdown
     - Path: Leave blank or specify your baseUrl (e.g., `/comics`)

   **Identity Providers:**
   - Add at least one identity provider (Google, GitHub, email OTP, etc.)
   - Click **Next**

   **Policies:**
   - Create a policy to control who can access
   - Example policy: "Allow specific email addresses"
     - Policy name: `Allow Admin`
     - Action: `Allow`
     - Configure rules:
       - Selector: `Emails`
       - Value: Your email address
   - Add more policies as needed for additional users
   - Click **Next**

5. Review and click **Add application**

### Step 3: Get Application Credentials

1. In your application settings, find the **Application Audience (AUD) Tag**
   - Located in **Overview** tab of your application
   - Looks like: `abc123def456...` (long hexadecimal string)
   - Copy this value

2. Your **Team Domain** is shown in the Zero Trust dashboard
   - Format: `yourteam.cloudflareaccess.com`
   - Found in **Settings** → **Custom Pages** or in the application URL

### Step 4: Configure Comics Now

Edit your `config.json`:

```json
{
  "authentication": {
    "enabled": true,
    "adminEmail": "your-admin-email@example.com",
    "cloudflare": {
      "teamDomain": "yourteam.cloudflareaccess.com",
      "audience": "your-application-audience-tag-here"
    },
    "trustedIPs": [
      "127.0.0.1",
      "::1"
    ]
  }
}
```

**Configuration Notes:**
- `adminEmail`: This email will have admin privileges (must match one of your Cloudflare Access allowed emails)
- `teamDomain`: Your Cloudflare Zero Trust team domain
- `audience`: The Application Audience (AUD) tag from Step 3
- `trustedIPs`: Optional - IPs that can bypass Cloudflare authentication (useful for local network)

### Step 5: Test Authentication

1. Restart Comics Now:
   ```bash
   npm start
   # or if using systemd
   sudo systemctl restart comics-now
   ```

2. Access your application through the Cloudflare domain:
   ```
   https://comics.yourdomain.com
   ```

3. You should see the Cloudflare Access login page
4. Log in with your configured identity provider
5. After successful login, you'll be redirected to Comics Now

### Step 6: Add Additional Users

1. Go to Cloudflare Zero Trust → **Access** → **Applications**
2. Click on your Comics Now application
3. Go to **Policies** tab
4. Edit existing policy or create new policy:
   - **For regular users**: Add their email to an "Allow Users" policy
   - **For admins**: Add their email to `adminEmail` in `config.json`

**User Roles:**
- **Admin**: Full access to all features (ComicTagger, settings, user management, etc.)
- **User**: Can read comics and manage their own progress/devices

### Troubleshooting

**Login redirects to wrong URL:**
- Check your `baseUrl` in `config.json` matches your Cloudflare application path
- Ensure your application domain is correctly configured in Cloudflare

**"Invalid authentication token" error:**
- Verify your `audience` tag is correct
- Check your `teamDomain` matches your Zero Trust team domain
- Ensure Cloudflare Access application is enabled

**Local access not working:**
- Add your local network IPs to `trustedIPs` array
- Use wildcards for subnets: `192.168.1.*`
- Trusted IPs bypass Cloudflare authentication entirely

**Users can't access certain features:**
- Check if user's email matches `adminEmail` in config (for admin access)
- Regular users have read-only access to most features

### Advanced: Trusted IPs

If you want to allow local network access without Cloudflare authentication:

```json
"trustedIPs": [
  "127.0.0.1",           // Localhost
  "::1",                 // IPv6 localhost
  "192.168.1.*",         // All IPs in 192.168.1.x subnet
  "10.0.0.5"             // Specific IP address
]
```

**Security Note:** Trusted IPs bypass ALL authentication. Only use for secure local networks.

## Environment Variables

You can use environment variables as an alternative to configuration file settings:

- **PORT**: Server port (overrides `config.json`)
- **NODE_ENV**: Set to `development` for development mode
- **CF_TEAM_DOMAIN**: Cloudflare team domain (fallback if not in config)
- **CF_AUDIENCE**: Cloudflare audience tag (fallback if not in config)

Example:
```bash
PORT=8080 NODE_ENV=production npm start
```

## Running as a Service

### Linux (systemd)

Create a service file at `/etc/systemd/system/comics-now.service`:

```ini
[Unit]
Description=Comics Now Server
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/comics-now
ExecStart=/path/to/node /path/to/comics-now/server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable comics-now
sudo systemctl start comics-now
```

## Usage

### Web Interface

Access the web interface at `http://localhost:3000` (or your configured baseUrl)

### ComicTagger Integration

1. Install ComicTagger
2. Configure the path in `config.json`
3. Access the ComicTagger UI from Settings → ComicTagger (CT) button
4. Set a schedule for automatic tagging
5. Review and apply suggested metadata matches with visual comparison
   - See your comic's first page alongside ComicVine cover images
   - Click any cover to open full-size comparison view

### Manga Mode

Enable right-to-left reading for manga and comics that follow this format. **Manga mode is per-user** - each user has independent manga preferences that never affect other users.

#### Setting Manga Mode

**Per Comic:**
1. Right-click (or long-press on mobile) on a comic card
2. Select "Enable Manga Mode" from the context menu
3. Or use the manga mode button while reading in the viewer

**Bulk Operations:**
- **Series Level**: Right-click a series card → "Set to Manga Mode" (applies to all comics in series)
- **Publisher Level**: Right-click a publisher card → "Set to Manga Mode" (applies to all comics from publisher)
- **Library Level**: Settings → Comics Defaults tab → Toggle manga mode switch (applies to entire library)

#### Hierarchical Manga Mode System

Manga mode uses a **hierarchical inheritance system** for each user:

```
Library (Default) → Publisher → Series → Comic (Most Specific)
```

**How it works:**
1. **Library Level**: Set your default reading mode. All new comics inherit this preference.
2. **Publisher Level**: Override library default for specific publishers (e.g., "Kodansha" always manga)
3. **Series Level**: Override publisher setting for specific series
4. **Comic Level**: Override any parent setting for individual comics

**Example:**
- Set library to Standard mode
- Set publisher "Viz Media" to Manga mode → All Viz comics read right-to-left
- Set series "One Piece" to Manga mode → Only One Piece reads right-to-left
- Newly added comics automatically inherit the appropriate mode

**Features:**
- Page navigation automatically reverses (right-to-left)
- Purple checkmark indicator on manga mode comics
- Settings are per-user and sync across all your devices
- Works in both normal and fullscreen reader modes
- New comics automatically inherit parent-level preferences

### Continuous Mode

Read comics with vertical scrolling like webtoons and manga readers. **Continuous mode is per-user** - each user has independent continuous mode preferences.

#### Enabling Continuous Mode

1. Open a comic in fullscreen mode
2. Tap to reveal controls
3. Click the "Continuous" button to toggle continuous mode
4. Navigation arrows automatically change to up (↑) and down (↓) arrows

#### Features

- **Vertical Scrolling**: All pages load in a single scrollable view
- **Lazy Loading**: Pages load automatically as you scroll down
- **Up/Down Navigation**: Click ↑/↓ arrows to jump between pages smoothly
- **Progress Tracking**: Reading progress automatically saves as you scroll
- **Page Jumping**: Use the page counter to jump to specific pages
- **Fullscreen Only**: Continuous mode is optimized for immersive fullscreen reading
- **Preference Memory**: Your continuous mode preference is remembered per comic

**Navigation:**
- **↑ (Up arrow)**: Scroll to previous page
- **↓ (Down arrow)**: Scroll to next page
- **Scroll freely**: Use mouse wheel, trackpad, or touch gestures
- **Click sides**: Click left/right sides of screen to navigate up/down

### Context Menus

Quick access to common actions via right-click or long-press menus:

**Desktop**: Right-click on any comic, series, or publisher card
**Mobile**: Touch and hold for 500ms (long-press)

**Available Actions:**

**Comic Cards:**
- Download for offline reading
- Mark as read/unread
- Enable/disable manga mode

**Series Cards:**
- Download entire series
- Mark all comics as read/unread
- Toggle manga mode for all comics

**Publisher Cards:**
- Download all comics from publisher
- Toggle manga mode for all publisher comics

**Library/Root Folder Cards:**
- Download entire library
- Toggle manga mode for all comics

### Offline Reading

1. Open a comic in the reader
2. Click the download button to save for offline
3. Access downloaded comics from the "Downloaded" filter
4. Comics are stored in browser IndexedDB

### Multi-Device Sync

When authentication is enabled:
1. Each device automatically registers when you first access the app
2. Reading progress syncs across all your devices
3. View and manage devices in Settings → Devices tab

### Library Access Control (Admin Only)

Admins can control which libraries, publishers, and series each user can access using a **hierarchical access control system**.

#### Managing User Access

1. Go to **Settings → Users** tab (admin only)
2. Click on a user to view their access settings
3. Configure access using the three-checkbox system

#### Understanding the Checkboxes

Each folder/item has three checkboxes:

- **D (Direct)**: User has access to this specific item only, not its children
- **R (Recursive)**: UI helper to select/deselect all siblings at this level (not saved to database)
- **C (Child)**: User has access to all descendants of this item

#### Access Control Hierarchy

Access is controlled at three levels:

```
Library (Root Folder) → Publisher → Series
```

**How it works:**
1. **Library Level**: Control access to entire comic libraries/directories
2. **Publisher Level**: Grant or restrict access to specific publishers within accessible libraries
3. **Series Level**: Fine-tune access to individual series within accessible publishers

**Important Notes:**
- Users can only access content within libraries they have access to (root folder restriction)
- If a user has no library access, they cannot see any publishers/series regardless of other permissions
- The system automatically handles cascading permissions
- Admins always have full access to everything

**Example Scenarios:**

1. **Grant access to entire library:**
   - Check library's **C** checkbox → User can see everything in that library

2. **Grant access to specific publisher only:**
   - Check library's **D** checkbox (direct access to library)
   - Check publisher's **C** checkbox → User sees all series from that publisher

3. **Grant access to specific series only:**
   - Check library's **D** checkbox
   - Check publisher's **D** checkbox
   - Check series's **D** or **C** checkbox → User only sees that series

4. **Remove specific series while keeping others:**
   - Uncheck the series checkbox → User loses access to that series but keeps others

## API Endpoints

See `server/routes/api.js` for full API documentation.

Key endpoints:
- `GET /api/v1/comics` - Get library (filtered by user access permissions)
- `GET /api/v1/comics/pages` - Get comic pages
- `POST /api/v1/progress` - Update reading progress
- `POST /api/v1/comics/manga-mode` - Toggle manga mode for specific comic (per-user)
- `POST /api/v1/comics/set-all-manga-mode` - Set manga mode at hierarchy level (library/publisher/series)
- `GET /api/v1/manga-mode-preference` - Get current library-level manga mode preference
- `GET /api/v1/sync/check/:comicId` - Check sync status
- `POST /api/v1/sync/update` - Update sync progress
- `GET /api/v1/users` - List all users (admin only)
- `GET /api/v1/users/:userId/access` - Get user's access permissions (admin only)
- `POST /api/v1/users/:userId/access` - Update user's access permissions (admin only)

## Security

- All admin operations require admin role
- Hierarchical access control system restricts user access to authorized libraries/publishers/series
- Per-user preferences (manga mode, reading progress) are isolated and never affect other users
- Role-based error messages (detailed for admins, generic for users)
- Cloudflare Zero Trust integration for enterprise authentication
- Support for trusted IP bypass for local network access
- CORS protection
- JWT token validation for authenticated users
- Access control enforced at database query level for defense in depth

## License

Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International

This work is licensed under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License.
To view a copy of this license, visit https://creativecommons.org/licenses/by-nc-sa/4.0/ or send a letter to Creative Commons, PO Box 1866, Mountain View, CA 94042, USA.

Unless explicitly noted otherwise, all code, assets, and documentation in this repository are covered by this license.

## Contributing

⚠️ This is vibe-coded - I built this casually over 3 months for my own setup. It works for me, but it's not enterprise-grade code

⚠️ This is a personal project - Built for my specific use case, your mileage may vary

⚠️ Limited/no maintenance - I'm sharing the code as-is. I won't be actively maintaining it or accepting pull requests

⚠️ Use at your own risk - Please read the documentation carefully and understand what you're installing. Again, this is a vibe-coded app!

Feel free to fork it and make it your own - just follow the license terms (attribution, non commercial, share-alike).
