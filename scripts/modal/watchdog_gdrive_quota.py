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

import argparse
import os
import re
import subprocess
import sys
import time

QUOTA_PATTERNS = [
    r"userRateLimitExceeded",
    r"downloadQuotaExceeded",
    r"quotaExceeded",
    r"Daily Limit Exceeded",
    r"rateLimitExceeded",
    r"403:.*quota",
]

def check_log_for_quota(log_file):
    if not log_file or not os.path.exists(log_file):
        return False
    try:
        with open(log_file, "r", errors="ignore") as f:
            content = f.read()
        for pat in QUOTA_PATTERNS:
            if re.search(pat, content, re.IGNORECASE):
                return True
    except Exception as exc:
        print(f"[WATCHDOG] Error reading log: {exc}")
    return False

def stop_modal(app_id, profile=None):
    print(f"\n[WATCHDOG ALERT] Google Drive daily download quota exceeded detected in logs!")
    print(f"[WATCHDOG] Immediately stopping Modal app {app_id}...")
    cmd = ["modal", "app", "stop", "--yes"]
    if profile:
        cmd.extend(["--profile", profile])
    if app_id:
        cmd.append(app_id)

    env = os.environ.copy()
    env["MODAL_IMAGE_BUILDER_VERSION"] = "2024.10"
    subprocess.run(cmd, env=env)

    print("[WATCHDOG] Terminating local batch runner process...")
    subprocess.run(["pkill", "-f", "run_gdrive_batch.py"])
    print("[WATCHDOG] Modal app and runner shut down completely. Safe for resume tomorrow.\n")

def main():
    parser = argparse.ArgumentParser(description="Monitor log for Google Drive quota limits")
    parser.add_argument("--log-file", default=os.environ.get("WATCHDOG_LOG_FILE", "batch_runner.log"), help="Path to the runner log file to monitor")
    parser.add_argument("--app-id", default=os.environ.get("MODAL_APP_ID", ""), help="Modal App ID to stop if quota exceeded")
    parser.add_argument("--profile", default=os.environ.get("MODAL_PROFILE", None), help="Modal CLI profile name")
    parser.add_argument("--interval", type=int, default=10, help="Check interval in seconds (default: 10)")
    args = parser.parse_args()

    log_file = args.log_file
    app_id = args.app_id
    profile = args.profile

    print(f"[WATCHDOG] Started monitoring {log_file} for Google Drive quota limits.")
    while True:
        if check_log_for_quota(log_file):
            stop_modal(app_id, profile)
            break

        res = subprocess.run(["pgrep", "-f", "run_gdrive_batch.py"], capture_output=True)
        if res.returncode != 0:
            print("[WATCHDOG] Batch runner process has finished. Watchdog exiting cleanly.")
            break

        time.sleep(args.interval)

if __name__ == "__main__":
    main()
