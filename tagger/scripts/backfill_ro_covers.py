"""Backfill and cache ReadingOrders cover images and 64-bit dHashes into reading-orders.db."""
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "tagger"))

from tagger_app.continuity.cover_service import backfill_missing_covers, DEFAULT_RO_DB, DEFAULT_COVERS_DIR


def main():
    print(f"Starting ReadingOrders cover backfill...")
    print(f"Database: {DEFAULT_RO_DB}")
    print(f"Covers Cache: {DEFAULT_COVERS_DIR}")

    res = backfill_missing_covers(max_workers=12)
    print(f"Backfill Result: {res}")


if __name__ == "__main__":
    main()
