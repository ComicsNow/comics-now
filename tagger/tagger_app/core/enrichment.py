"""Metadata enrichment, completeness checking, and sequential source querying."""

import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

from tagger_app.core.metadata import (
    calculate_similarity,
    resolve_creator_roles,
    merge_best_metadata_fields,
)
from tagger_app.core.comicinfo import read_comic_info_xml
from tagger_app.sources.registry import SOURCES, SourceContext


def check_comic_info_completeness(cbz_path):
    """
    Checks if ComicInfo.xml (sidecar or embedded) exists and contains
    Series, Number, Publisher, and Year.
    Returns:
      is_incomplete: bool
      reason: str or None
    """
    if not os.path.exists(cbz_path):
        return True, "File not found"

    try:
        info = read_comic_info_xml(cbz_path)
    except Exception as e:
        return True, f"Error parsing ComicInfo.xml: {str(e)}"

    if not info:
        return True, "No ComicInfo.xml found"

    missing_fields = []
    if not (info.get("series") or info.get("title")):
        missing_fields.append("Series/Title")
    if not info.get("number"):
        missing_fields.append("Issue Number")
    if not info.get("publisher"):
        missing_fields.append("Publisher")
    if not info.get("year"):
        missing_fields.append("Year")

    if missing_fields:
        return True, f"Missing: {', '.join(missing_fields)}"

    return False, None


def enrich_metadata_from_other_sources(primary_meta, all_candidates, lower_threshold, codex=None):
    """
    Enriches primary_meta by evaluating and taking the best field values
    across all matching high-confidence candidates in all_candidates (score >= lower_threshold).
    """
    if not primary_meta:
        return primary_meta
    if not all_candidates:
        return primary_meta

    matching_candidates = [{"metadata": dict(primary_meta), "score": 1.0, "source": primary_meta.get("source_url", "")}]

    for cand in all_candidates:
        cand_meta = cand.get("metadata") if isinstance(cand, dict) and "metadata" in cand else cand
        if not cand_meta or not isinstance(cand_meta, dict):
            continue

        cand_score = cand.get("score") if isinstance(cand, dict) and cand.get("score") is not None else (cand.get("confidence") or 0)
        if cand_score > 1.0:
            cand_score /= 100.0

        if cand_score < lower_threshold:
            continue

        # Avoid merging identical candidates
        if cand_meta.get("source_url") and cand_meta.get("source_url") == primary_meta.get("source_url"):
            continue

        # Match series
        p_series = primary_meta.get("series") or primary_meta.get("title") or ""
        c_series = cand_meta.get("series") or cand_meta.get("title") or ""
        if calculate_similarity(p_series, c_series) < 0.85:
            continue

        # Match issue numbers if both specified
        p_num = primary_meta.get("number") or primary_meta.get("issue_number")
        c_num = cand_meta.get("number") or cand_meta.get("issue_number")
        if p_num and c_num and str(p_num).strip() != str(c_num).strip():
            continue

        matching_candidates.append(cand)

    merged = merge_best_metadata_fields(matching_candidates, existing_meta=primary_meta, codex=codex)
    return merged


def consolidate_all_candidates(candidates_list, codex=None):
    """
    Consolidates a list of candidates from multiple sources.
    Candidates that refer to the same comic (similar series name and matching issue number)
    are grouped together. In each group, the metadata fields are synthesized across all
    group candidates using field-by-field best selection (merge_best_metadata_fields).
    Returns a sorted list of consolidated (metadata_dict, score, source_url) candidates.
    """
    if not candidates_list:
        return []

    # Normalize incoming items
    normalized_list = []
    for item in candidates_list:
        if isinstance(item, tuple) and len(item) >= 2:
            meta = item[0]
            score = item[1]
            src = item[2] if len(item) > 2 else meta.get("source_url", "")
        elif isinstance(item, dict):
            meta = item.get("metadata") or item
            score = item.get("score", 0.0)
            if score > 1.0:
                score /= 100.0
            src = item.get("matching_url") or item.get("source") or meta.get("source_url", "")
        else:
            continue
        normalized_list.append({
            "metadata": meta,
            "score": score,
            "source": src
        })

    # Sort by score descending so the strongest match leads each group
    normalized_list.sort(key=lambda x: x["score"], reverse=True)

    grouped_candidates = []

    for cand in normalized_list:
        meta = cand["metadata"]
        matched_group_idx = -1
        for idx, group in enumerate(grouped_candidates):
            leader_meta = group[0]["metadata"]

            # Match series/title
            p_series = leader_meta.get("series") or leader_meta.get("title") or ""
            c_series = meta.get("series") or meta.get("title") or ""

            if calculate_similarity(p_series, c_series) < 0.85:
                continue

            # Match issue numbers if both specify one
            p_num = leader_meta.get("number") or leader_meta.get("issue_number")
            c_num = meta.get("number") or meta.get("issue_number")
            if p_num and c_num and str(p_num).strip() != str(c_num).strip():
                continue

            matched_group_idx = idx
            break

        if matched_group_idx >= 0:
            grouped_candidates[matched_group_idx].append(cand)
        else:
            grouped_candidates.append([cand])

    # Synthesize best metadata field-by-field for each group
    results = []
    for group in grouped_candidates:
        best_score = max(c["score"] for c in group)
        merged_meta = merge_best_metadata_fields(group, codex=codex)
        source_url = merged_meta.get("source_url") or group[0]["source"]
        results.append((merged_meta, best_score, source_url))

    # Sort results by score descending
    results.sort(key=lambda x: x[1], reverse=True)
    return results


def _has_core_metadata_fields(meta):
    """Check if metadata has all required core fields for complete tagging."""
    if not meta or not isinstance(meta, dict):
        return False
    has_series = bool(meta.get("series") or meta.get("title"))
    has_num = bool(meta.get("number") or meta.get("issue_number"))
    pub = meta.get("publisher")
    has_pub = bool(pub and str(pub).strip() and str(pub).strip().lower() not in ("unknown", "unknown publisher", "none"))
    has_date = bool(meta.get("publish_date") or meta.get("year") or meta.get("cover_date"))
    return has_series and has_num and has_pub and has_date


def query_all_sources_sequentially(filename, cover_path=None, comicvine_api_key=None,
                                   google_books_api_key=None,
                                   metron_user=None, metron_pass=None,
                                   gcd_user=None, gcd_pass=None,
                                   enabled_sources=None, on_progress=None,
                                   existing_meta=None, publisher_codex=None):
    """
    Queries all enabled sources concurrently to gather metadata across providers.
    All candidates are synthesized using field-by-field best metadata selection.
    """
    progress_lock = threading.Lock()

    def progress(source_name, msg):
        if on_progress:
            try:
                with progress_lock:
                    on_progress(filename, source_name, msg)
            except Exception:
                pass

    ctx = SourceContext(
        comicvine_api_key=comicvine_api_key,
        google_books_api_key=google_books_api_key,
        metron_user=metron_user,
        metron_pass=metron_pass,
        gcd_user=gcd_user,
        gcd_pass=gcd_pass,
        cover_path=cover_path,
        existing_meta=existing_meta,
    )

    active_sources = []
    for source in SOURCES:
        if not source.is_enabled(enabled_sources):
            progress(source.label, "Skipped (Disabled)")
        else:
            active_sources.append(source)

    def worker(src):
        progress(src.label, src.search_message)
        try:
            res = src.resolve(filename, ctx, lambda m, _label=src.label: progress(_label, m))
            if res:
                valid = [c for c in res if isinstance(c, (tuple, list)) and len(c) >= 2 and c[1] >= 0.50]
                if valid:
                    best = max(valid, key=lambda x: x[1])
                    pct = round(best[1] * 100, 1)
                    title_info = (best[0].get("title") or best[0].get("series") or "") if isinstance(best[0], dict) else ""
                    if title_info:
                        progress(src.label, f"Match found at {pct}% ({title_info})")
                    else:
                        progress(src.label, f"Match found at {pct}%")
                else:
                    progress(src.label, "No match found")
                return res
            else:
                progress(src.label, "No match found")
                return []
        except Exception as e:
            print(f"[-] {src.label} search failed: {e}")
            progress(src.label, f"Search failed: {str(e)}")
            return []

    raw_candidates = []
    if active_sources:
        max_workers = min(len(active_sources), 6)
        results_by_idx = {}
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_src = {executor.submit(worker, src): (idx, src) for idx, src in enumerate(active_sources)}
            for future in as_completed(future_to_src):
                idx, src = future_to_src[future]
                try:
                    res = future.result()
                    if res:
                        results_by_idx[idx] = res
                except Exception as e:
                    print(f"[-] Unhandled exception in {src.label} worker: {e}")

        # Collate candidates deterministically by registered source priority order
        for idx in sorted(results_by_idx.keys()):
            raw_candidates.extend(results_by_idx[idx])

    # Consolidate all candidates across sources using field-by-field best selection
    consolidated = consolidate_all_candidates(raw_candidates, codex=publisher_codex)
    return consolidated


def merge_only_missing_fields(existing_meta, new_meta):
    """
    Merges new_meta into existing_meta, but ONLY for fields that are missing or empty in existing_meta.
    Never overwrites existing metadata.
    """
    if not existing_meta:
        return new_meta or {}

    merged = dict(existing_meta)
    for key, val in new_meta.items():
        if not val:
            continue

        is_empty = False
        if key not in merged or merged[key] is None:
            is_empty = True
        elif isinstance(merged[key], str) and not merged[key].strip():
            is_empty = True
        elif isinstance(merged[key], list) and not merged[key]:
            is_empty = True
        elif isinstance(merged[key], dict) and not merged[key]:
            is_empty = True

        if is_empty:
            merged[key] = val

    return resolve_creator_roles(merged)
