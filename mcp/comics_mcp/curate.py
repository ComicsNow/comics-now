#!/usr/bin/env python3
"""
Standalone CLI entrypoint for Comics Now AI Reading List Curation.
Usage:
  python3 -m comics_mcp.curate --event "Knightfall" [--commit]
  python3 -m comics_mcp.curate --months 3 [--commit]
  python3 -m comics_mcp.curate --all [--unassigned] [--commit]
"""

import sys
import argparse
from typing import Dict, Any

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from comics_mcp import reading_curator


def print_event_result(res: Dict[str, Any]):
    print("\n" + "=" * 60)
    print(f"📖 Reading Order: {res.get('title', 'Unknown')}")
    print(f"🔗 Source: {res.get('source', 'Unknown')}")
    if res.get("description"):
        print(f"📝 Description: {res.get('description')}")
    print("=" * 60)

    is_valid = res.get("is_valid", False)
    status_str = "✅ VALID" if is_valid else "❌ SKIPPED"
    print(f"Status: {status_str} ({res.get('validation_reason', '')})")
    print(f"Matched in Library: {res.get('matched_count', 0)} of {res.get('total_steps', 0)} canonical steps\n")

    if res.get("matched_comics"):
        print("📚 Matched Comics in Reading Order:")
        for c in res["matched_comics"]:
            print(f"  [{c['step']:02d}] {c['name']} (Series: {c['series']})")
        print()

    if res.get("missing_steps"):
        print(f"⚠️  Missing Steps from Library ({len(res['missing_steps'])} issues):")
        for m in res["missing_steps"][:10]:
            print(f"  - Step {m['step']:02d}: {m['title']}")
        if len(res["missing_steps"]) > 10:
            print(f"  ... and {len(res['missing_steps']) - 10} more missing issues.")
        print()

    if res.get("applied"):
        print("🚀 APPLIED: Successfully added to Comics Now! and synced across all users.")
    else:
        print("💡 PREVIEW ONLY: Use --commit to insert into database and sync.")
    print("=" * 60 + "\n")


def print_recent_result(res: Dict[str, Any]):
    print("\n" + "=" * 60)
    print("📅 Recent Comics Ingestion Analysis")
    print(f"Analyzed {res.get('recent_comics_count', 0)} recently added/updated comics.")
    print("=" * 60)

    suggestions = res.get("existing_list_suggestions", [])
    if suggestions:
        print(f"\n📥 Suggestions for Existing Reading Lists ({len(suggestions)}):")
        for s in suggestions:
            print(f"  * Add '{s['comicName']}' -> Existing List: '{s['listName']}'")
    else:
        print("\nℹ️  No existing reading lists needed these recent comics.")

    proposals = res.get("new_reading_list_proposals", [])
    if proposals:
        print(f"\n🆕 New Candidate Reading Lists Discovered ({len(proposals)}):")
        for p in proposals:
            print_event_result(p)
    else:
        print("\nℹ️  No new multi-series reading lists met the >=3 comic threshold.")
    print("=" * 60 + "\n")


def main():
    parser = argparse.ArgumentParser(description="Comics Now AI Reading List Curator")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--event", type=str, help="Curate a specific storyline (e.g., 'Civil War', 'Knightfall', 'Absolute DC')")
    group.add_argument("--months", type=int, help="Check comics added in the last X months")
    group.add_argument("--all", action="store_true", help="Audit the entire library for reading lists")

    parser.add_argument("--unassigned-only", action="store_true", help="Only examine comics not currently in any reading list")
    parser.add_argument("--commit", action="store_true", help="Commit changes to Comics Now database (default is dry-run preview)")

    args = parser.parse_args()

    if args.event:
        print(f"🔍 Searching reading orders for '{args.event}'...")
        res = reading_curator.curate_event_reading_order(args.event, apply_changes=args.commit)
        if res.get("status") == "error":
            print(f"❌ Error: {res.get('message')}")
            sys.exit(1)
        print_event_result(res)

    elif args.months:
        print(f"🔍 Analyzing comics added in the last {args.months} months...")
        res = reading_curator.curate_recent_comics(months=args.months, apply_changes=args.commit)
        print_recent_result(res)

    elif args.all:
        print("🔍 Auditing library for reading list opportunities...")
        library = reading_curator.get_all_library_comics(unassigned_only=args.unassigned_only)
        print(f"Audited {len(library)} comics in library.")
        # Check against cached orders
        cached_orders = reading_curator.reading_orders_cache.list_cached_orders()
        print(f"Evaluating against {len(cached_orders)} known/cached reading orders...")
        for o in cached_orders:
            full_order = reading_curator.reading_orders_cache.get_cached_order(o["slug"])
            if full_order:
                match = reading_curator.match_order_against_library(full_order, library)
                if match["is_valid"]:
                    print_event_result(match)


if __name__ == "__main__":
    main()
