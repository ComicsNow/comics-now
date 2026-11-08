"""3-Gate Continuity Matcher: Gate 1 (Cover dHash) -> Gate 2 (Title) -> Gate 3 (Volume/Issue)."""
import re
import json
import sqlite3
from pathlib import Path
from typing import Optional, Dict, Any, List
from PIL import Image
import imagehash

from tagger_app.continuity.util import (
    normalize_series,
    extract_year,
    extract_issue_number,
    is_publisher_compatible,
    is_issue_in_range,
    is_year_compatible,
)
from tagger_app.continuity.cover_service import sanitize_filename_from_url

REPO_ROOT = Path(__file__).resolve().parents[3]
if not (REPO_ROOT / "comics-now.db").exists() and (Path(__file__).resolve().parents[2] / "comics-now.db").exists():
    REPO_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_RO_DB = REPO_ROOT / "data" / "reading-orders.db"
DEFAULT_THUMBNAILS_DIR = REPO_ROOT / "thumbnails"


def extract_volume_number(text: Any) -> Optional[int]:
    """Extract volume or book integer from string (e.g. 'Vol. 2', 'Volume 2', 'Book 2', 'v01', 'v2', '1')."""
    if text is None:
        return None
    if isinstance(text, int):
        return text
    s = str(text).strip()
    if s.isdigit():
        try:
            val = int(s)
            return None if 1900 <= val <= 2099 else val
        except ValueError:
            return None
    m = re.search(
        r"\b(?:vol(?:ume)?\.?\s*0*(\d+)|book\.?\s*0*(\d+)|v\.?\s*0*(\d+))\b",
        s,
        re.IGNORECASE,
    )
    if m:
        try:
            return int(m.group(1) or m.group(2) or m.group(3))
        except ValueError:
            pass
    return None


class ThreeGateMatcher:
    """Multi-gate visual and semantic matcher for ReadingOrders continuity."""

    def __init__(
        self,
        ro_db_path: Path | str = DEFAULT_RO_DB,
        thumbnails_dir: Path | str = DEFAULT_THUMBNAILS_DIR,
        gemini_arbiter: Optional[Any] = None,
    ):
        self.ro_db_path = str(ro_db_path)
        self.thumbnails_dir = Path(thumbnails_dir)
        self.gemini_arbiter = gemini_arbiter
        self.indexed_items: List[Dict[str, Any]] = []
        self.ro_covers_dir = REPO_ROOT / "cache" / "ro_covers"

    def _get_cover_distance(self, local_hash_int: Optional[int], item_hash_int: Optional[int]) -> Optional[int]:
        """Compute bitwise Hamming distance between two 64-bit dHashes."""
        if local_hash_int is None or item_hash_int is None:
            return None
        return (local_hash_int ^ item_hash_int).bit_count()

    def _resolve_ro_cover_path(self, cover_image_url: Optional[str]) -> Optional[Path]:
        """Resolve filesystem path for cached ReadingOrders cover."""
        if not cover_image_url:
            return None
        fname = sanitize_filename_from_url(cover_image_url)
        return self.ro_covers_dir / fname

    def load_indices(self) -> None:
        """Load all items with cover hashes from reading_order_issues and reading_order_collections."""
        conn = sqlite3.connect(self.ro_db_path, timeout=10.0)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # 1. Load collections
        cursor.execute(
            """
            SELECT 
                c.id, c.reading_order_id, c.position, c.title, c.subtitle, 
                c.release_year, c.cover_hash, c.cover_image_url,
                o.title as arc_title, o.publisher as arc_publisher
            FROM reading_order_collections c
            JOIN reading_orders o ON c.reading_order_id = o.id
            """
        )
        items = []
        for r in cursor.fetchall():
            h_int = None
            if r["cover_hash"]:
                try:
                    h_int = int(r["cover_hash"], 16)
                except (ValueError, TypeError):
                    pass
            items.append({
                "id": r["id"],
                "reading_order_id": r["reading_order_id"],
                "arc_title": r["arc_title"],
                "arc_publisher": r["arc_publisher"],
                "position": str(r["position"]),
                "item_type": "collection",
                "title": r["title"] or "",
                "subtitle": r["subtitle"] or "",
                "vol_num": extract_volume_number(f"{r['title']} {r['subtitle'] or ''}"),
                "release_year": r["release_year"],
                "norm_title": normalize_series(r["title"]),
                "norm_sub": normalize_series(r["subtitle"]) if r["subtitle"] else "",
                "hash_int": h_int,
                "cover_image_url": r["cover_image_url"],
            })

        # 2. Load issues
        cursor.execute(
            """
            SELECT 
                i.id, i.reading_order_id, i.position, i.series_name, i.issue_number, 
                i.publication_date, i.cover_hash, i.cover_image_url,
                o.title as arc_title, o.publisher as arc_publisher
            FROM reading_order_issues i
            JOIN reading_orders o ON i.reading_order_id = o.id
            """
        )
        for r in cursor.fetchall():
            h_int = None
            if r["cover_hash"]:
                try:
                    h_int = int(r["cover_hash"], 16)
                except (ValueError, TypeError):
                    pass
            items.append({
                "id": r["id"],
                "reading_order_id": r["reading_order_id"],
                "arc_title": r["arc_title"],
                "arc_publisher": r["arc_publisher"],
                "position": str(r["position"]),
                "item_type": "issue",
                "series_name": r["series_name"] or "",
                "issue_number": str(r["issue_number"] or ""),
                "publication_date": r["publication_date"],
                "release_year": extract_year(r["publication_date"]),
                "norm_series": normalize_series(r["series_name"]),
                "hash_int": h_int,
                "cover_image_url": r["cover_image_url"],
            })

        conn.close()
        self.indexed_items = items

    def _resolve_thumbnail_path(self, comic: Dict[str, Any]) -> Optional[Path]:
        """Locate local thumbnail file for comic."""
        if comic.get("thumb_path") and Path(comic["thumb_path"]).exists():
            return Path(comic["thumb_path"])

        c_id = comic.get("id")
        if c_id:
            candidate = self.thumbnails_dir / f"{c_id}.jpg"
            if candidate.exists():
                return candidate
        return None

    def match_comic(
        self,
        comic: Dict[str, Any],
        max_cover_distance: int = 10,
        max_collection_distance: int = 14,
        enable_gemini_arbiter: bool = False,
    ) -> Optional[Dict[str, Any]]:
        """Evaluate candidate comic through Gate 1 (Cover), Gate 2 (Title), and Gate 3 (Volume/Issue).
        
        Uses Two-Pass evaluation:
        Pass 1: Collected Editions first (distance <= 14, title/volume alignment).
        Pass 2: Single Issues second (distance <= 10, title/issue alignment).
        When enable_gemini_arbiter is True, borderline distances (11-16 bits) are arbitrated by Gemini Vision.
        """
        thumb_path = self._resolve_thumbnail_path(comic)
        local_hash_int = None
        if thumb_path and thumb_path.exists():
            try:
                with Image.open(thumb_path) as img:
                    local_hash_int = int(str(imagehash.dhash(img)), 16)
            except Exception:
                # Corrupt image file cannot be verified visually
                return None

        # Parse comic metadata
        comic_series = comic.get("series") or ""
        comic_name = comic.get("name") or ""
        comic_pub = comic.get("publisher") or ""
        meta = {}
        if comic.get("metadata"):
            try:
                meta = json.loads(comic["metadata"]) if isinstance(comic["metadata"], str) else comic["metadata"]
            except Exception:
                pass

        norm_comic_series = normalize_series(comic_series)
        comic_num = extract_issue_number(comic_name, meta.get("Number"))
        raw_vol = meta.get("Volume")
        if raw_vol is not None and str(raw_vol).isdigit():
            comic_vol = int(raw_vol)
        else:
            comic_vol = extract_volume_number(comic_series) or extract_volume_number(comic_name)
        comic_yr = extract_year(meta.get("Year") or comic_name)

        use_gemini = enable_gemini_arbiter and (self.gemini_arbiter is not None)
        effective_max_coll = 16 if use_gemini else max_collection_distance

        # PASS 1: Collected Editions First
        coll_candidates = []
        for item in self.indexed_items:
            if item["item_type"] != "collection":
                continue
            dist = self._get_cover_distance(local_hash_int, item.get("hash_int"))
            if dist is not None and dist > effective_max_coll:
                continue
            coll_candidates.append((dist if dist is not None else 0, item))

        coll_candidates.sort(
            key=lambda x: (
                x[0],
                -(1 if (x[1].get("norm_sub") and x[1]["norm_sub"] in norm_comic_series) else 0),
            )
        )

        for dist, cand in coll_candidates:
            # GATE 2: Title / Series & Publisher Compatibility
            if not is_publisher_compatible(comic_pub, cand["arc_publisher"]):
                continue

            combined_cand = f"{cand['norm_title']} {cand['norm_sub']}".strip()
            title_match = (
                norm_comic_series in combined_cand
                or combined_cand in norm_comic_series
                or cand["norm_title"] in norm_comic_series
                or (cand["norm_sub"] and cand["norm_sub"] in norm_comic_series)
                or (cand["norm_title"] in normalize_series(comic_name))
            )
            if not title_match:
                continue

            # GATE 3: Volume Alignment
            cand_vol = cand.get("vol_num")
            if comic_vol is not None and cand_vol is not None:
                if comic_vol != cand_vol:
                    continue

            if comic_yr and cand.get("release_year"):
                if abs(comic_yr - cand["release_year"]) > 3:
                    continue

            # Borderline verification via Gemini Arbiter if enabled
            is_borderline = dist is not None and 11 <= dist <= 16
            gemini_verified = False
            if is_borderline and use_gemini and thumb_path:
                ro_cover = self._resolve_ro_cover_path(cand.get("cover_image_url"))
                arb_res = self.gemini_arbiter.verify_cover_pair(str(thumb_path), str(ro_cover) if ro_cover else "")
                if not arb_res.get("match"):
                    continue
                gemini_verified = True
            elif dist is not None and dist > max_collection_distance:
                continue

            clean_arc = re.sub(r"\s+Reading\s+Order$", "", cand["arc_title"], flags=re.IGNORECASE).strip()
            series_group = f"{cand['arc_publisher'] or 'Comic'} Events"

            res = {
                "comicId": comic.get("id"),
                "comicName": comic_name,
                "series": comic_series,
                "matchedArc": clean_arc,
                "storyArcNumber": cand["position"],
                "seriesGroup": series_group,
                "coverDistance": dist,
                "matchedType": "collection",
            }
            if gemini_verified:
                res["geminiVerified"] = True
            return res

        # PASS 2: Single Issues (only if Pass 1 yielded no collection match)
        effective_max_issue = 14 if use_gemini else max_cover_distance
        issue_candidates = []
        for item in self.indexed_items:
            if item["item_type"] != "issue":
                continue
            dist = self._get_cover_distance(local_hash_int, item.get("hash_int"))
            if dist is not None and dist > effective_max_issue:
                continue
            issue_candidates.append((dist if dist is not None else 0, item))

        issue_candidates.sort(key=lambda x: x[0])

        for dist, cand in issue_candidates:
            # GATE 2: Title / Series & Publisher Compatibility
            if not is_publisher_compatible(comic_pub, cand["arc_publisher"]):
                continue

            if norm_comic_series != cand["norm_series"]:
                if cand["norm_series"] not in norm_comic_series and norm_comic_series not in cand["norm_series"]:
                    continue

            # GATE 3: Issue Number Alignment
            if not is_issue_in_range(comic_num, cand["issue_number"]):
                continue

            if comic_yr and cand.get("release_year"):
                if abs(comic_yr - cand["release_year"]) > 3:
                    continue

            # Borderline verification via Gemini Arbiter if enabled
            is_borderline = dist is not None and 9 <= dist <= 14
            gemini_verified = False
            if is_borderline and use_gemini and thumb_path:
                ro_cover = self._resolve_ro_cover_path(cand.get("cover_image_url"))
                arb_res = self.gemini_arbiter.verify_cover_pair(str(thumb_path), str(ro_cover) if ro_cover else "")
                if not arb_res.get("match"):
                    continue
                gemini_verified = True
            elif dist is not None and dist > max_cover_distance:
                continue

            clean_arc = re.sub(r"\s+Reading\s+Order$", "", cand["arc_title"], flags=re.IGNORECASE).strip()
            series_group = f"{cand['arc_publisher'] or 'Comic'} Events"

            res = {
                "comicId": comic.get("id"),
                "comicName": comic_name,
                "series": comic_series,
                "matchedArc": clean_arc,
                "storyArcNumber": cand["position"],
                "seriesGroup": series_group,
                "coverDistance": dist,
                "matchedType": "issue",
            }
            if gemini_verified:
                res["geminiVerified"] = True
            return res

        return None
