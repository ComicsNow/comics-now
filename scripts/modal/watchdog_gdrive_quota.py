#!/usr/bin/env python3
"""
Automated Watchdog for Google Drive Quota during Modal Batch Runs.

Monitors the active batch run log for Google Drive quota limits:
- 'userRateLimitExceeded'
- 'downloadQuotaExceeded'
- 'quotaExceeded'
- 'Daily Limit Exceeded'

If detected, it immediately sends a stop signal to Modal via
`modal app stop --yes <APP_ID>`
and terminates the local runner process to preserve cloud GPU credits.
"""

import os
import re
import subprocess
import sys
import time

LOG_FILE = os.environ.get("WATCHDOG_LOG_FILE", "batch_runner.log")
APP_ID = os.environ.get("MODAL_APP_ID", "")
QUOTA_PATTERNS = [
    r"userRateLimitExceeded",
    r"downloadQuotaExceeded",
    r"quotaExceeded",
    r"Daily Limit Exceeded",
    r"rateLimitExceeded",
    r"403:.*quota",
]

def check_log_for_quota():
    if not os.path.exists(LOG_FILE):
        return False
    try:
        with open(LOG_FILE, "r", errors="ignore") as f:
            content = f.read()
        for pat in QUOTA_PATTERNS:
            if re.search(pat, content, re.IGNORECASE):
                return True
    except Exception as exc:
        print(f"[WATCHDOG] Error reading log: {exc}")
    return False

def stop_modal():
    print(f"\n[WATCHDOG ALERT] Google Drive daily download quota exceeded detected in logs!")
    print(f"[WATCHDOG] Immediately stopping Modal app {APP_ID}...")
    cmd = [
        "modal", "app", "stop", "--yes", APP_ID
    ]
    env = os.environ.copy()
    env["MODAL_IMAGE_BUILDER_VERSION"] = "2024.10"
    subprocess.run(cmd, env=env)

    print("[WATCHDOG] Terminating local run_gdrive_batch.py process...")
    subprocess.run(["pkill", "-f", "run_gdrive_batch.py"])
    print("[WATCHDOG] Modal app and runner shut down completely. Safe for resume tomorrow.\n")

def main():
    print(f"[WATCHDOG] Started monitoring {LOG_FILE} for Google Drive quota limits.")
    while True:
        if check_log_for_quota():
            stop_modal()
            break

        # If run_gdrive_batch.py finishes normally, exit cleanly
        res = subprocess.run(["pgrep", "-f", "run_gdrive_batch.py"], capture_output=True)
        if res.returncode != 0:
            print("[WATCHDOG] Batch runner process has finished. Watchdog exiting cleanly.")
            break

        time.sleep(10)

if __name__ == "__main__":
    main()
