"""Per-scan JSON result logs.

Extracted from the legacy app.py monolith (architecture review, persistence layer).
"""
import os
import json

from tagger_app.config import LOGS_DIR


def write_scan_log(scan_type, target, total_files, tagged_count, skipped_count, failed_count, results):
    import uuid
    import datetime
    timestamp = datetime.datetime.now().isoformat()
    log_id = f"{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}_{str(uuid.uuid4())[:8]}"
    filename = f"scan_log_{log_id}.json"
    filepath = os.path.join(LOGS_DIR, filename)
    
    # Clean up results for log file by removing huge candidate items to keep file small
    cleaned_results = []
    for r in results:
        res_copy = {
            "filename": r.get("filename"),
            "status": r.get("status"),
            "matched_title": r.get("matched_title"),
            "confidence": r.get("confidence"),
            "source": r.get("source") or r.get("matching_url"),
            "file_path": r.get("file_path"),
            "reason": r.get("reason"),
            "error": r.get("error")
        }
        if r.get("metadata"):
            res_copy["metadata"] = {
                "title": r["metadata"].get("title"),
                "series": r["metadata"].get("series"),
                "number": r["metadata"].get("number"),
                "publisher": r["metadata"].get("publisher"),
                "year": r["metadata"].get("year")
            }
        cleaned_results.append(res_copy)

    log_data = {
        "id": log_id,
        "timestamp": timestamp,
        "type": scan_type,
        "target": target,
        "total_files": total_files,
        "tagged_count": tagged_count,
        "skipped_count": skipped_count,
        "failed_count": failed_count,
        "results": cleaned_results
    }
    
    try:
        with open(filepath, 'w') as f:
            json.dump(log_data, f, indent=4)
        print(f"[+] Saved scan log to {filepath}")
        prune_scan_logs(21)
    except Exception as e:
        print(f"[-] Failed to write scan log: {e}")


def prune_scan_logs(max_age_days=21):
    """Deletes scan log JSON files older than max_age_days (21 days default)."""
    import time
    if not os.path.exists(LOGS_DIR):
        return 0
    cutoff = time.time() - (max_age_days * 86400)
    pruned = 0
    for fname in os.listdir(LOGS_DIR):
        if fname.startswith("scan_log_") and fname.endswith(".json"):
            fpath = os.path.join(LOGS_DIR, fname)
            try:
                if os.path.getmtime(fpath) < cutoff:
                    os.remove(fpath)
                    pruned += 1
            except Exception:
                pass
    return pruned
