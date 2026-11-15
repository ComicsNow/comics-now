"""Shared configuration constants for the tagger package."""
import os
import urllib.parse

# Repo root (parent of the tagger_app package). Used to anchor data/log paths so they
# resolve to the same locations the legacy app.py used.
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Default user agent to mimic a modern browser when fetching remote HTML/images
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
}


def get_browser_headers(query: str = None, referer: str = None) -> dict:
    """Generate realistic browser headers simulating navigation from Google Search results.
    
    Ensures outbound requests appear organic to target sites (Amazon, Goodreads, Waterstones, Blackwell's),
    protecting against anti-bot heuristics, Cloudflare/AWS WAF challenges, and IP blacklisting.
    """
    if referer:
        ref = referer
    elif query:
        encoded_q = urllib.parse.quote_plus(query.strip())
        ref = f"https://www.google.com/search?q={encoded_q}"
    else:
        ref = "https://www.google.com/"

    return {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "en-US,en;q=0.9,en-GB;q=0.8",
        "Referer": ref,
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-User": "?1",
        "Sec-Ch-Ua": '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Upgrade-Insecure-Requests": "1",
        "DNT": "1"
    }

_DATA_DIR = os.environ.get("DATA_DIR", _ROOT)

# SQLite tracking DB recording which comics have already been enhanced.
DB_TRACKING_PATH = os.environ.get("TRACKING_DB_PATH", os.path.join(_DATA_DIR, "enhanced_tracking.db"))

# Directory holding per-scan JSON result logs.
LOGS_DIR = os.environ.get("SCAN_LOGS_DIR", os.path.join(_DATA_DIR, "scan_logs"))

# Persisted scheduler config + status.
CONFIG_FILE = os.environ.get("SCHEDULER_CONFIG_PATH", os.path.join(_DATA_DIR, "scheduler_config.json"))

# Upload and temp directories
UPLOAD_FOLDER = os.path.join(_ROOT, "uploads")
STATIC_TEMP_DIR = os.path.join(_ROOT, "static", "temp")

_FORBIDDEN_SYSTEM_PREFIXES = (
    "/etc",
    "/proc",
    "/sys",
    "/root",
    "/boot",
    "/dev",
    "/run",
    "/var/log",
    "/var/run",
)


def _has_traversal_segment(path_str):
    parts = path_str.replace("\\", "/").split("/")
    return ".." in parts


def _is_forbidden_system_path(path_str):
    normalized = os.path.normpath(path_str)
    for prefix in _FORBIDDEN_SYSTEM_PREFIXES:
        if normalized == prefix or normalized.startswith(prefix + "/"):
            return True
    return False


def is_safe_cbz_path(file_path):
    """Return True only when file_path is a non-symlink existing .cbz/.cbr file without traversal."""
    if not file_path or not isinstance(file_path, str):
        return False
    if _has_traversal_segment(file_path):
        return False
    abs_path = os.path.abspath(file_path)
    if os.path.islink(file_path) or os.path.islink(abs_path):
        return False
    real_path = os.path.realpath(abs_path)
    if _is_forbidden_system_path(abs_path) or _is_forbidden_system_path(real_path):
        return False
    if not abs_path.lower().endswith((".cbz", ".cbr", ".pdf", ".epub")):
        return False
    return os.path.isfile(abs_path)


def is_safe_browse_dir(dir_path):
    """Return True only when dir_path is a safe, non-symlink existing directory."""
    if not dir_path or not isinstance(dir_path, str):
        return False
    if _has_traversal_segment(dir_path):
        return False
    abs_path = os.path.abspath(dir_path)
    if os.path.islink(dir_path) or os.path.islink(abs_path):
        return False
    real_path = os.path.realpath(abs_path)
    if _is_forbidden_system_path(abs_path) or _is_forbidden_system_path(real_path):
        return False
    return os.path.isdir(abs_path)


