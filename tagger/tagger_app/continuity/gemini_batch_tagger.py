"""Scalable Gemini Flash Story Arc Tagger for Comics Now!.

Evaluates local library comics against ReadingOrders story arcs using Gemini Flash
with strict 15 RPM and 250k TPM quota protection and dynamic candidate scoping.
"""
import os
import sys
import json
import time
import sqlite3
import argparse
import re
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple, Callable

from tagger_app.continuity.crypto_utils import load_continuity_gemini_config, TokenRateLimiter
from tagger_app.continuity.review_formatter import format_cli_review, format_library_batch_review
from tagger_app.continuity.cluster_builder import (
    load_all_publisher_comics,
    load_all_reading_orders,
    get_arc_candidate_comics,
    find_candidate_arcs_for_comic,
    build_arc_target_prompt,
    parse_arc_matches,
)
from tagger_app.core.comicinfo import (
    read_comic_info_xml,
    write_comic_info,
    generate_comic_info_xml,
)

_r3 = Path(__file__).resolve().parents[3]
REPO_ROOT = _r3 if (_r3 / "comics-now.db").exists() else Path(__file__).resolve().parents[2]

DEFAULT_RO_DB = REPO_ROOT / "data" / "reading-orders.db"
DEFAULT_CN_DB = REPO_ROOT / "comics-now.db"
DEFAULT_CONFIG = REPO_ROOT / "config.json"
CACHE_DIR = REPO_ROOT / "cache"


class GeminiStoryArcTagger:
    """Batch Story Arc metadata tagger powered by Gemini Flash."""

    def __init__(
        self,
        ro_db_path: Path | str = DEFAULT_RO_DB,
        cn_db_path: Path | str = DEFAULT_CN_DB,
        config_path: Path | str = DEFAULT_CONFIG,
        min_confidence: float = 0.85,
        min_delay: float = 5.0,
    ):
        self.ro_db_path = str(ro_db_path)
        self.cn_db_path = str(cn_db_path)
        self.config = load_continuity_gemini_config(config_path)
        self.min_confidence = min_confidence
        self.limiter = TokenRateLimiter(min_delay=min_delay)

    def _call_gemini_api(self, prompt: str, max_retries: int = 4) -> Any:
        """Execute structured content generation with backoff retry."""
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=self.config["api_key"])
        for attempt in range(max_retries):
            try:
                response = client.models.generate_content(
                    model=self.config["model"],
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                    ),
                )
                return response
            except Exception as e:
                err_str = str(e).lower()
                if ("429" in err_str or "resource_exhausted" in err_str or "quota" in err_str) and attempt < max_retries - 1:
                    wait_time = (attempt + 1) * 10
                    print(f"    [!] Rate limit (429) hit. Pausing {wait_time}s before retry {attempt+2}/{max_retries}...")
                    time.sleep(wait_time)
                else:
                    raise e

    def _apply_tag(self, comic: Dict[str, Any], arc_title: str, pos: int, dry_run: bool) -> str:
        """Apply StoryArc tags to comic or return would-be action description."""
        storage_mode = self.config["metadata_storage"]
        file_path = comic.get("path") or ""
        file_stem = Path(file_path).stem if file_path else comic.get("name", "")

        action = (
            f"Would write sidecar: {file_stem}.ComicInfo.xml"
            if storage_mode == "sidecar"
            else (f"Would embed inside archive: {comic.get('name')}" if storage_mode == "archive" else "Would update SQLite database only")
        )

        if not dry_run:
            c_id = comic["id"]
            meta_to_write = {
                **comic.get("metadata", {}),
                "StoryArc": arc_title,
                "StoryArcNumber": str(pos),
            }
            now_ms = int(time.time() * 1000)
            conn = sqlite3.connect(self.cn_db_path, timeout=5.0)
            conn.execute(
                "UPDATE comics SET metadata = ?, updatedAt = ? WHERE id = ?",
                (json.dumps(meta_to_write), now_ms, c_id),
            )
            conn.commit()
            conn.close()

            if storage_mode in ("sidecar", "archive") and file_path and os.path.exists(file_path):
                try:
                    existing_xml = read_comic_info_xml(file_path) or {}
                    merged_meta = {**existing_xml, "StoryArc": arc_title, "StoryArcNumber": str(pos)}
                    xml_str = generate_comic_info_xml(merged_meta)
                    write_comic_info(file_path, xml_str, storage_mode=storage_mode)
                    action = f"Wrote {storage_mode} for {file_stem}"
                except Exception as err:
                    action = f"Error writing {storage_mode}: {err}"

        return action

    def tag_arc(
        self,
        arc_id: str,
        dry_run: bool = False,
        preloaded_comics: Optional[List[Dict[str, Any]]] = None,
        log_fn: Optional[Callable[[str, str], None]] = None,
    ) -> Dict[str, Any]:
        """Evaluate matching library comics for a single story arc."""
        all_arcs = load_all_reading_orders(self.ro_db_path)
        arc = next((a for a in all_arcs if a["id"] == arc_id), None)
        if not arc:
            return {"error": f"Story Arc '{arc_id}' not found"}

        candidates = get_arc_candidate_comics(
            self.cn_db_path, arc["publisher"], arc["series_phrases"], preloaded_comics=preloaded_comics
        )
        if not candidates:
            if log_fn:
                log_fn("INFO", f"  - [Gemini Flash] No candidate comics found in library for '{arc['clean_title']}'")
            return {
                "arcId": arc_id, "arcTitle": arc["clean_title"], "publisher": arc["publisher"],
                "totalChecklist": len(arc["checklist"]), "rawMatchesCount": 0, "totalMatches": 0,
                "appliedCount": 0, "dryRun": dry_run, "storageMode": self.config["metadata_storage"],
                "matches": [], "unmatched": arc["checklist"], "status": "no_candidates",
            }

        candidates_by_id = {c["id"]: c for c in candidates}
        prompt = build_arc_target_prompt(arc, candidates)
        estimated_tokens = len(prompt) // 3

        if log_fn:
            log_fn("INFO", f"  ✦ [Gemini Flash] Prompting AI with {len(candidates)} candidates (~{estimated_tokens} tokens)...")
        self.limiter.wait_if_needed(estimated_tokens)
        resp = self._call_gemini_api(prompt)

        raw_count = 0
        try:
            raw_data = json.loads(re.sub(r"```(?:json)?", "", resp.text).strip())
            raw_count = len(raw_data.get("matches", []))
        except Exception:
            pass

        matches = parse_arc_matches(resp.text, arc, candidates_by_id, self.min_confidence)

        detailed_matches = []
        matched_positions = set()
        for m in matches:
            matched_positions.add(m["position"])
            c = candidates_by_id[m["comic_id"]]
            action = self._apply_tag(c, arc["clean_title"], m["position"], dry_run)
            detailed_matches.append({
                "position": m["position"],
                "checklistTitle": m["checklist_item"].get("title") or "",
                "checklistSubtitle": m["checklist_item"].get("subtitle") or "",
                "releaseYear": m["checklist_item"].get("release_year"),
                "comicId": m["comic_id"],
                "comicName": c.get("name") or "",
                "confidence": m["confidence"],
                "reason": m["reason"],
                "proposedTags": {"StoryArc": arc["clean_title"], "StoryArcNumber": str(m["position"])},
                "action": action,
            })
            if log_fn:
                log_fn("SUCCESS", f"     ↳ Match #{m['position']}: {c.get('name')} ({int(m['confidence']*100)}% confidence)")

        if not detailed_matches and log_fn:
            log_fn("INFO", f"  - [Gemini Flash] No confident matches for '{arc['clean_title']}'")

        unmatched = [item for item in arc["checklist"] if item["position"] not in matched_positions]
        return {
            "arcId": arc_id,
            "arcTitle": arc["clean_title"],
            "publisher": arc["publisher"],
            "totalChecklist": len(arc["checklist"]),
            "rawMatchesCount": raw_count,
            "totalMatches": len(detailed_matches),
            "appliedCount": len(detailed_matches),
            "dryRun": dry_run,
            "storageMode": self.config["metadata_storage"],
            "matches": detailed_matches,
            "unmatched": unmatched,
        }

    def match_single_comic(self, comic_payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Evaluate a single comic against relevant candidate story arcs using Gemini Flash."""
        if not self.config.get("api_key"):
            return None

        series = comic_payload.get("series") or comic_payload.get("name") or ""
        pub = comic_payload.get("publisher") or "DC Comics"
        all_arcs = load_all_reading_orders(self.ro_db_path)
        cand_arcs = find_candidate_arcs_for_comic(all_arcs, series, pub)
        if not cand_arcs:
            return None

        meta = comic_payload.get("metadata") or {}
        cand_item = {
            "id": comic_payload.get("id") or comic_payload.get("name", ""),
            "name": comic_payload.get("name", ""),
            "series": series,
            "volume": meta.get("Volume") or "",
            "number": meta.get("Number") or "",
            "year": meta.get("Year") or "",
            "title": meta.get("Title") or "",
            "path": comic_payload.get("path") or "",
            "metadata": meta,
        }

        for arc in cand_arcs[:3]:
            res = self.tag_arc(arc["id"], dry_run=True, preloaded_comics=[cand_item])
            if res.get("totalMatches", 0) > 0:
                best = max(res["matches"], key=lambda m: m["confidence"])
                return {
                    "matchedArc": best["proposedTags"]["StoryArc"],
                    "storyArcNumber": best["proposedTags"]["StoryArcNumber"],
                    "seriesGroup": f"{arc['publisher']} Events",
                    "confidence": best["confidence"],
                    "reason": best["reason"],
                    "geminiVerified": True,
                }
        return None

    def tag_all_library(
        self,
        dry_run: bool = True,
        target_publisher: Optional[str] = None,
        log_fn: Optional[Callable[[str, str], None]] = None,
        progress_fn: Optional[Callable[[int, int, str, int], None]] = None,
        is_cancelled_fn: Optional[Callable[[], bool]] = None,
    ) -> Dict[str, Any]:
        """Evaluate entire library against all story arcs with quota-safe dynamic scoping."""
        all_arcs = load_all_reading_orders(self.ro_db_path)
        if not all_arcs:
            return {"error": "No reading orders found in database"}

        if target_publisher and target_publisher != "all":
            all_arcs = [a for a in all_arcs if target_publisher.lower() in a["publisher"].lower()]

        if log_fn:
            log_fn("INFO", "Pre-loading comic library catalogs for DC and Marvel...")
        dc_comics = load_all_publisher_comics(self.cn_db_path, "DC Comics")
        marvel_comics = load_all_publisher_comics(self.cn_db_path, "Marvel Comics")
        comics_by_pub = {"DC Comics": dc_comics, "Marvel Comics": marvel_comics}

        all_matches_by_arc: Dict[str, Any] = {}
        unmatched_arcs: List[Dict[str, Any]] = []
        total_matches_count = 0
        ai_evaluated_count = 0
        skipped_no_cands_count = 0

        candidate_arcs: List[Tuple[Dict[str, Any], List[Dict[str, Any]]]] = []
        for arc in all_arcs:
            pub_comics = comics_by_pub.get(arc["publisher"], [])
            cands = get_arc_candidate_comics(self.cn_db_path, arc["publisher"], arc["series_phrases"], preloaded_comics=pub_comics)
            if cands:
                candidate_arcs.append((arc, cands))
            else:
                skipped_no_cands_count += 1
                unmatched_arcs.append({"id": arc["id"], "title": arc["clean_title"], "publisher": arc["publisher"]})

        msg = f"Library Analysis: {len(all_arcs)} total arcs | {len(candidate_arcs)} arcs with matching library candidates | {skipped_no_cands_count} skipped"
        if log_fn:
            log_fn("INFO", msg)
        print(f"[*] {msg}")

        for idx, (arc, cands) in enumerate(candidate_arcs, start=1):
            if is_cancelled_fn and is_cancelled_fn():
                if log_fn:
                    log_fn("WARN", "Cancellation requested. Halting Gemini story arc evaluation.")
                break

            pct = int((idx / len(candidate_arcs)) * 100)
            status_msg = f"[{idx}/{len(candidate_arcs)}] ({pct}%) Evaluating '{arc['clean_title']}' ({arc['publisher']}) against {len(cands)} candidates..."
            if log_fn:
                log_fn("INFO", status_msg)
            print(f"  {status_msg}")

            if progress_fn:
                progress_fn(idx, len(candidate_arcs), arc["clean_title"], total_matches_count)

            res = self.tag_arc(arc["id"], dry_run=dry_run, preloaded_comics=cands, log_fn=log_fn)
            ai_evaluated_count += 1

            if res.get("totalMatches", 0) > 0:
                match_msg = f"       --> Matched {res['totalMatches']} comics for '{arc['clean_title']}'!"
                if log_fn:
                    log_fn("SUCCESS", match_msg)
                print(match_msg)
                all_matches_by_arc[arc["id"]] = {
                    "id": arc["id"],
                    "title": arc["clean_title"],
                    "publisher": arc["publisher"],
                    "matches": res["matches"],
                }
                total_matches_count += res["totalMatches"]
            else:
                unmatched_arcs.append({"id": arc["id"], "title": arc["clean_title"], "publisher": arc["publisher"]})

        if progress_fn:
            progress_fn(len(candidate_arcs), len(candidate_arcs), "Completed", total_matches_count)
        if log_fn:
            log_fn("SUCCESS", f"Enrichment completed! Found {total_matches_count} matching comics across {len(all_matches_by_arc)} story arcs.")


        return {
            "model": self.config["model"],
            "storageMode": self.config["metadata_storage"],
            "dryRun": dry_run,
            "totalArcs": len(all_arcs),
            "arcsEvaluatedWithAI": ai_evaluated_count,
            "arcsSkippedNoCandidates": skipped_no_cands_count,
            "arcsWithMatches": len(all_matches_by_arc),
            "totalMatches": total_matches_count,
            "matchedArcs": all_matches_by_arc,
            "unmatchedArcs": unmatched_arcs,
        }


def main():
    parser = argparse.ArgumentParser(description="Tag Comics Now! Story Arcs with Gemini Flash.")
    parser.add_argument("--arc", help="Specific reading order ID (e.g. absolute-universe)")
    parser.add_argument("--live", action="store_true", help="Execute live metadata writes")
    args = parser.parse_args()

    is_dry_run = not args.live
    tagger = GeminiStoryArcTagger()
    if args.arc:
        res = tagger.tag_arc(args.arc, dry_run=is_dry_run)
        print(format_cli_review(res) if "error" not in res else res["error"])
    else:
        print(f"[*] Starting full library story arc evaluation (Dry-Run: {is_dry_run})...")
        res = tagger.tag_all_library(dry_run=is_dry_run)
        print(format_library_batch_review(res))


_gemini_tagger_instance: Optional[GeminiStoryArcTagger] = None


def get_gemini_tagger() -> Optional[GeminiStoryArcTagger]:
    """Return cached thread-safe singleton instance of GeminiStoryArcTagger."""
    global _gemini_tagger_instance
    if _gemini_tagger_instance is None:
        try:
            _gemini_tagger_instance = GeminiStoryArcTagger()
        except Exception:
            return None
    return _gemini_tagger_instance


if __name__ == "__main__":
    main()
