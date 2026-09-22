"""Scheduler state + persistence.

Holds the in-memory scheduler config/status and loads/saves them to disk. The dicts
are module-level singletons; importers mutate them in place (never reassign) so all
modules share the same state — the same contract the legacy app.py relied on.

Extracted from the legacy app.py monolith (architecture review, scheduler layer).
"""
import os
import json
import datetime

from tagger_app.config import CONFIG_FILE


scheduler_config = {
    "default_directory": "",
    "interval_value": 1,
    "interval_unit": "day",
    "enabled": False,
    "comicvine_api_key": "",
    "google_books_api_key": "",
    "metron_user": "",
    "metron_pass": "",
    "confidence_threshold": 0.9,
    "lower_threshold": 0.80,
    "upper_threshold": 0.90,
    "batch_concurrency": 4,
    "selected_fields": ["Writer", "Penciller", "Inker", "Colorist", "Letterer", "CoverArtist", "Editor", "Genre", "PageCount", "Characters", "Teams", "Locations"],
    "enabled_sources": ["src-comicvine", "src-metron", "src-gcd", "src-lcg", "src-goodreads", "src-blackwells", "src-waterstones", "src-googlebooks", "src-amazon"],
    "force_reprocess": False,
    "legacy_xml_fallback": True
}

scheduler_status = {
    "last_run": None,
    "next_run": None,
    "is_running": False,
    "history": []
}

def load_scheduler_data():
    global scheduler_config, scheduler_status
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r') as f:
                data = json.load(f)
                if "config" in data:
                    scheduler_config.update(data["config"])
                if "status" in data:
                    scheduler_status.update(data["status"])
            # Reset is_running to False in case of server crash
            scheduler_status["is_running"] = False
        except Exception as e:
            print(f"[-] Failed to load scheduler config: {e}")

def save_scheduler_data():
    try:
        with open(CONFIG_FILE, 'w') as f:
            json.dump({
                "config": scheduler_config,
                "status": {
                    "last_run": scheduler_status["last_run"],
                    "next_run": scheduler_status["next_run"],
                    "history": scheduler_status["history"]
                }
            }, f, indent=4)
    except Exception as e:
        print(f"[-] Failed to save scheduler config: {e}")

def calculate_next_run():
    if not scheduler_config["enabled"] or not scheduler_config["default_directory"]:
        scheduler_status["next_run"] = None
        return
        
    last = scheduler_status["last_run"]
    if not last:
        # If it hasn't run yet, run immediately
        scheduler_status["next_run"] = datetime.datetime.now().isoformat()
        return
        
    try:
        last_dt = datetime.datetime.fromisoformat(last)
        val = int(scheduler_config["interval_value"])
        unit = scheduler_config["interval_unit"]
        
        if unit == "hour":
            delta = datetime.timedelta(hours=val)
        elif unit == "day":
            delta = datetime.timedelta(days=val)
        elif unit == "week":
            delta = datetime.timedelta(weeks=val)
        else:
            delta = datetime.timedelta(days=1)
            
        scheduler_status["next_run"] = (last_dt + delta).isoformat()
    except Exception as e:
        print(f"[-] Error calculating next run: {e}")
        scheduler_status["next_run"] = datetime.datetime.now().isoformat()
