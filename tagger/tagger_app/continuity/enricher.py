"""Continuity Metadata Enricher: auto-enriches ComicInfo metadata with Story Arc details."""
import os
import threading
from pathlib import Path
from typing import Optional, Dict, Any

from tagger_app.continuity.three_gate_matcher import ThreeGateMatcher
from tagger_app.continuity.gemini_arbiter import GeminiArbiter
from tagger_app.core.covers import get_comics_now_cover

REPO_ROOT = Path(__file__).resolve().parents[3]
if not (REPO_ROOT / "comics-now.db").exists() and (Path(__file__).resolve().parents[2] / "comics-now.db").exists():
    REPO_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_RO_DB = REPO_ROOT / "data" / "reading-orders.db"
DEFAULT_THUMBNAILS_DIR = REPO_ROOT / "thumbnails"

_matcher_instance: Optional[ThreeGateMatcher] = None
_matcher_lock = threading.Lock()


def get_matcher(ro_db_path: Path | str = DEFAULT_RO_DB) -> Optional[ThreeGateMatcher]:
    """Return a thread-safe singleton instance of ThreeGateMatcher."""
    global _matcher_instance
    if _matcher_instance is None:
        with _matcher_lock:
            if _matcher_instance is None:
                p = Path(ro_db_path)
                if not p.exists():
                    return None
                try:
                    arbiter = GeminiArbiter()
                    matcher = ThreeGateMatcher(ro_db_path=p, gemini_arbiter=arbiter)
                    matcher.load_indices()
                    _matcher_instance = matcher
                except Exception as e:
                    print(f"[-] Failed to initialize ThreeGateMatcher: {e}")
                    return None
    return _matcher_instance


def reset_matcher() -> None:
    """Reset cached matcher instance (used for testing or after database sync)."""
    global _matcher_instance
    with _matcher_lock:
        _matcher_instance = None


def enrich_with_continuity(
    metadata: Dict[str, Any],
    file_path: str,
    cover_path: Optional[str] = None,
    enable_gemini: bool = True,
    ro_db_path: Path | str = DEFAULT_RO_DB,
) -> Optional[Dict[str, Any]]:
    """Enrich ComicInfo metadata dict with matched Story Arc and Reading Order position."""
    if not isinstance(metadata, dict):
        return None

    try:
        matcher = get_matcher(ro_db_path=ro_db_path)
        if not matcher:
            return None

        filename = os.path.basename(file_path) if file_path else ""
        resolved_thumb = cover_path
        if not resolved_thumb and file_path and os.path.exists(file_path):
            # Attempt lookup in Comics-Now database thumbnails
            resolved_thumb = get_comics_now_cover(file_path)

        comic_payload = {
            "id": filename,
            "name": filename,
            "series": metadata.get("series") or metadata.get("title") or "",
            "publisher": metadata.get("publisher") or "",
            "metadata": metadata,
            "thumb_path": resolved_thumb,
        }

        arc_match = matcher.match_comic(comic_payload, enable_gemini_arbiter=enable_gemini)
        if not arc_match:
            return None

        metadata["story_arc"] = arc_match["matchedArc"]
        metadata["story_arc_number"] = str(arc_match["storyArcNumber"])
        metadata["series_group"] = arc_match["seriesGroup"]
        if arc_match.get("geminiVerified"):
            metadata["continuity_gemini_verified"] = True

        return arc_match
    except Exception as e:
        print(f"[-] Continuity enrichment failed for {file_path}: {e}")
        return None
