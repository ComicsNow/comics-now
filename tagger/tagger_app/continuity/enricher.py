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
    """Enrich ComicInfo metadata dict with matched Story Arc details using Gemini exclusively.
    
    Story Arc matching strictly requires Gemini AI. No heuristic/local rule fallback is permitted.
    """
    if not isinstance(metadata, dict) or not enable_gemini:
        return None

    try:
        from tagger_app.continuity.gemini_batch_tagger import get_gemini_tagger
        gemini_tagger = get_gemini_tagger()
        if not gemini_tagger or not gemini_tagger.config.get("api_key"):
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

        g_match = gemini_tagger.match_single_comic(comic_payload)
        if g_match and g_match.get("matchedArc"):
            metadata["story_arc"] = g_match["matchedArc"]
            metadata["story_arc_number"] = str(g_match.get("storyArcNumber") or "1")
            metadata["series_group"] = g_match.get("seriesGroup", "DC Comics Events")
            metadata["continuity_gemini_verified"] = True
            return g_match

        # Strict requirement: No heuristic or local 3-gate fallback allowed.
        return None
    except Exception as e:
        print(f"[-] Continuity Gemini enrichment failed for {file_path}: {e}")
        return None
