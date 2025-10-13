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
  - [Context Menus](#context-menus)
  - [Offline Reading](#offline-reading)
  - [Multi-Device Sync](#multi-device-sync)
- [API Endpoints](#api-endpoints)
- [Security](#security)

## Features

- 📚 Browse your comic collection by publisher, series, and issues
- 📖 Built-in comic reader with page navigation
- 📕 Manga mode with right-to-left reading support
- 🖱️ Context menus for quick actions (right-click or long-press)
- 🔄 Cross-device sync with progress tracking
- 📱 Offline support - download comics for offline reading
- 🏷️ ComicVine integration for metadata
- 🤖 ComicTagger integration for automated metadata tagging with visual comparison
- 🔐 Optional Cloudflare Zero Trust authentication
- 👥 Multi-user support with user roles
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

Enable right-to-left reading for manga and comics that follow this format:

**Per Comic:**
1. Right-click (or long-press on mobile) on a comic card
2. Select "Enable Manga Mode" from the context menu
3. Or use the manga mode button while reading in the viewer

**Bulk Operations:**
- **Series Level**: Right-click a series card → "Set to Manga Mode" (applies to all comics in series)
- **Publisher Level**: Right-click a publisher card → "Set to Manga Mode" (applies to all comics from publisher)
- **Library Level**: Right-click a library/root folder → "Set to Manga Mode" (applies to entire library)

**Features:**
- Page navigation automatically reverses (right-to-left)
- Purple checkmark indicator on manga mode comics
- Settings sync across all your devices
- Works in both normal and fullscreen reader modes

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

## API Endpoints

See `server/routes/api.js` for full API documentation.

Key endpoints:
- `GET /api/v1/comics` - Get library
- `GET /api/v1/comics/pages` - Get comic pages
- `POST /api/v1/progress` - Update reading progress
- `POST /api/v1/comics/manga-mode` - Toggle manga mode for comic
- `GET /api/v1/sync/check/:comicId` - Check sync status
- `POST /api/v1/sync/update` - Update sync progress

## Security

- All admin operations require admin role
- Role-based error messages (detailed for admins, generic for users)
- Cloudflare Zero Trust integration for enterprise authentication
- Support for trusted IP bypass for local network access
- CORS protection
- JWT token validation for authenticated users

## License

[Add your license here]

## Contributing

[Add contribution guidelines here]
