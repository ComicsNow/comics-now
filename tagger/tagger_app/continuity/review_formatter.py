"""Terminal visual formatter for Story Arc tagging dry-run reviews."""
from typing import Dict, Any


def format_cli_review(res: Dict[str, Any]) -> str:
    """Format single arc review report for clean terminal display."""
    lines = [
        "=" * 90,
        f"STORY ARC DRY-RUN REVIEW: {res.get('arcTitle')} ({res.get('publisher')})",
        f"Storage Mode: {res.get('storageMode')} | Total Checklist: {res.get('totalChecklist')} | Matched: {res.get('totalMatches')}",
        "=" * 90,
    ]
    for m in res.get("matches", []):
        sub = f" ({m['checklistSubtitle']})" if m.get("checklistSubtitle") else ""
        lines.append(f"\n[MATCHED] Pos {m['position']}: {m['checklistTitle']}{sub} [{m.get('releaseYear') or ''}]")
        lines.append(f"  --> Library File: {m['comicName']}")
        lines.append(f"  --> Confidence:   {m['confidence']*100:.0f}%")
        lines.append(f"  --> Reason:       {m['reason']}")
        lines.append(f"  --> Action:       {m['action']}")

    if res.get("unmatched"):
        lines.append("\n" + "-" * 90)
        lines.append(f"[UNMATCHED / MISSING FROM LIBRARY] ({len(res['unmatched'])} items):")
        for u in res["unmatched"]:
            sub = f" ({u.get('subtitle')})" if u.get("subtitle") else ""
            lines.append(f"  - Pos {u.get('position')}: {u.get('title')}{sub} [{u.get('release_year') or 'N/A'}]")

    lines.append("\n" + "=" * 90)
    lines.append(f"Summary: {res.get('totalMatches')} / {res.get('totalChecklist')} items matched | 0 changes written (DRY-RUN)")
    lines.append("=" * 90)
    return "\n".join(lines)


def format_library_batch_review(res: Dict[str, Any]) -> str:
    """Format whole-library batch dry-run review for clean terminal display."""
    lines = [
        "=" * 90,
        "WHOLE-LIBRARY GEMINI FLASH STORY ARC EVALUATION (DRY-RUN)",
        f"Model: {res.get('model')} | Storage Mode: {res.get('storageMode')}",
        f"Total Story Arcs Evaluated: {res.get('totalArcs')} | Arcs with Matches: {res.get('arcsWithMatches')}",
        f"Total Library Comics Matched: {res.get('totalMatches')}",
        "=" * 90,
    ]

    matched_arcs = res.get("matchedArcs", {})
    if matched_arcs:
        lines.append("\nMATCHED STORY ARCS & COMICS:")
        for arc_id, arc_data in matched_arcs.items():
            lines.append(f"\n* Arc: {arc_data['title']} ({arc_data['publisher']}) [{len(arc_data['matches'])} matches]")
            for m in arc_data["matches"]:
                lines.append(f"    - #{m['position']} | {m['comicName']} ({m['confidence']*100:.0f}%) -> {m['action']}")

    unmatched_arcs = res.get("unmatchedArcs", [])
    if unmatched_arcs:
        lines.append("\n" + "-" * 90)
        lines.append(f"STORY ARCS WITH 0 LIBRARY MATCHES ({len(unmatched_arcs)} arcs):")
        # Format in compact columns of 3
        chunks = [unmatched_arcs[i:i+3] for i in range(0, len(unmatched_arcs), 3)]
        for chunk in chunks:
            row = " | ".join(f"{a['title'][:26]:<26}" for a in chunk)
            lines.append(f"  {row}")

    lines.append("\n" + "=" * 90)
    lines.append(f"Summary: {res.get('totalMatches')} comics matched across {res.get('arcsWithMatches')} arcs | 0 changes written (DRY-RUN)")
    lines.append("=" * 90)
    return "\n".join(lines)
