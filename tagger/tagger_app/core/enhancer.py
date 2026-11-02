"""Additive library metadata enhancement without overwriting existing fields."""

import os
import uuid
import shutil

from tagger_app.config import UPLOAD_FOLDER
from tagger_app.core.covers import extract_cover_from_cbz
from tagger_app.core.comicinfo import read_comic_info_xml, generate_comic_info_xml, write_comic_info
from tagger_app.core.enrichment import (
    enrich_metadata_from_other_sources,
    query_all_sources_sequentially,
    merge_only_missing_fields
)
from tagger_app.core.tagger import get_comics_now_cover
from tagger_app.persistence.tracking_db import mark_as_enhanced, is_already_enhanced
from tagger_app.scheduler.state import scheduler_config


def enhance_single_cbz_file(file_path, comicvine_api_key, google_books_api_key=None, metron_user=None, metron_pass=None, lower_threshold=0.80, upper_threshold=0.90, on_progress=None, enabled_fields=None, enabled_sources=None, force_reprocess=False, metadata_storage=None):
    filename = os.path.basename(file_path)
    print(f"[*] Enhancing CBZ file: {filename}")

    if not force_reprocess and is_already_enhanced(file_path, enabled_sources, legacy_xml_fallback=scheduler_config.get("legacy_xml_fallback", True)):
        if on_progress:
            on_progress(filename, "Signature Check", "Already enhanced by Tag Comics Now!. Skipped.", 1.0)
        return {
            "filename": filename,
            "status": "skipped",
            "reason": "Already enhanced by Tag Comics Now! (Reprocessing skipped)",
            "file_path": file_path,
            "metadata": None,
            "source": None,
            "candidates": []
        }

    # Read existing metadata
    existing_meta = {}
    try:
        existing_meta = read_comic_info_xml(file_path) or {}
    except Exception as read_err:
        print(f"[-] Failed to read existing ComicInfo.xml for {filename}: {read_err}")

    active_sources = enabled_sources if enabled_sources else ["src-comicvine", "src-metron", "src-gcd", "src-lcg", "src-forbiddenplanet", "src-googlebooks", "src-goodreads", "src-blackwells", "src-waterstones", "src-amazon"]
    api_failed = False

    metadata = None
    source_url = None
    score = 0.0
    candidates = []

    def add_candidate(meta, score_val, source):
        if meta and score_val >= lower_threshold:
            m_url = source if (isinstance(source, str) and (source.startswith('http') or '.com' in source)) else meta.get('source_url', '')
            meta["source_url"] = m_url or source or meta.get('source_url', '')
            if not any(c.get("metadata", {}).get("source_url") == meta.get("source_url") for c in candidates):
                s_val = round(score_val * 100, 1)
                candidates.append({
                    "metadata": meta,
                    "score": s_val,
                    "source": source,
                    "matching_url": m_url
                })
                if on_progress:
                    src_label = source.split('/')[2] if (isinstance(source, str) and '://' in source) else source
                    on_progress(filename, src_label, f"Match found: {meta.get('title')} ({s_val}%)", score_val)

    # 1. Retrieve cover from database
    if on_progress:
        on_progress(filename, "DB Lookup", "Searching database for cover...")
    cover_path = get_comics_now_cover(file_path)

    created_tmp_dir = False
    cover_tmp_dir = None

    # Fallback to extract from CBZ
    if not cover_path:
        if on_progress:
            on_progress(filename, "Extract Cover", "Cover not in DB, extracting from CBZ...")
        cover_tmp_dir = os.path.join(UPLOAD_FOLDER, f"cover_{uuid.uuid4().hex[:8]}")
        try:
            os.makedirs(cover_tmp_dir, exist_ok=True)
            created_tmp_dir = True
            cover_path = extract_cover_from_cbz(file_path, output_dir=cover_tmp_dir)
        except Exception as cov_err:
            print(f"[-] Cover extract failed for {filename}: {cov_err}")
            if on_progress:
                on_progress(filename, "Extract Cover", f"Failed: {str(cov_err)}")

    try:
        on_prog_cb = lambda fn, src, msg: on_progress(fn, src, msg) if on_progress else None
        consolidated_cands = query_all_sources_sequentially(
            filename,
            cover_path=cover_path,
            comicvine_api_key=comicvine_api_key,
            google_books_api_key=google_books_api_key,
            metron_user=metron_user,
            metron_pass=metron_pass,
            enabled_sources=enabled_sources,
            on_progress=on_prog_cb,
            existing_meta=existing_meta
        )

        for m, s_val, src in consolidated_cands:
            add_candidate(m, s_val, src)
            if s_val > score:
                metadata = m
                score = s_val
                source_url = src
    except Exception as resolve_err:
        print(f"[-] Sequential search failed for {filename}: {resolve_err}")
        api_failed = True
    finally:
        if created_tmp_dir and cover_tmp_dir:
            shutil.rmtree(cover_tmp_dir, ignore_errors=True)

    final_res = None
    storage_mode = metadata_storage or scheduler_config.get("metadata_storage", "archive")

    if metadata and score >= lower_threshold:
        metadata = enrich_metadata_from_other_sources(metadata, candidates, lower_threshold)
        merged_meta = merge_only_missing_fields(existing_meta, metadata)

        added_fields = []
        for key, val in merged_meta.items():
            if not val:
                continue
            is_empty = False
            if key not in existing_meta or existing_meta[key] is None:
                is_empty = True
            elif isinstance(existing_meta[key], str) and not existing_meta[key].strip():
                is_empty = True
            elif isinstance(existing_meta[key], list) and not existing_meta[key]:
                is_empty = True
            elif isinstance(existing_meta[key], dict) and not existing_meta[key]:
                is_empty = True

            if is_empty:
                added_fields.append(key)

        if not added_fields:
            if not api_failed:
                mark_as_enhanced(file_path, active_sources)
            final_res = {
                "filename": filename,
                "status": "skipped",
                "matched_title": merged_meta.get("title"),
                "confidence": round(score * 100, 1),
                "reason": "All metadata fields already present (no updates needed)",
                "file_path": file_path,
                "metadata": merged_meta,
                "source": source_url,
                "candidates": sorted(candidates, key=lambda x: x["score"], reverse=True),
                "matching_url": source_url
            }
        elif score >= upper_threshold:
            try:
                xml_str = generate_comic_info_xml(merged_meta, enabled_fields=enabled_fields)
                write_comic_info(file_path, xml_str, storage_mode)
                mark_as_enhanced(file_path, active_sources)
                final_res = {
                    "filename": filename,
                    "status": "tagged",
                    "matched_title": merged_meta.get("title"),
                    "confidence": round(score * 100, 1),
                    "source": source_url,
                    "file_path": file_path,
                    "metadata": merged_meta,
                    "added_fields": added_fields,
                    "candidates": sorted(candidates, key=lambda x: x["score"], reverse=True),
                    "matching_url": source_url
                }
            except Exception as write_err:
                final_res = {
                    "filename": filename,
                    "status": "failed",
                    "matched_title": merged_meta.get("title"),
                    "confidence": round(score * 100, 1),
                    "error": str(write_err)
                }
        else:
            final_res = {
                "filename": filename,
                "status": "skipped",
                "matched_title": merged_meta.get("title"),
                "confidence": round(score * 100, 1),
                "reason": f"Confidence {round(score * 100, 1)}% is below Auto-Accept limit of {int(upper_threshold*100)}%",
                "file_path": file_path,
                "metadata": merged_meta,
                "source": source_url,
                "candidates": sorted(candidates, key=lambda x: x["score"], reverse=True),
                "matching_url": source_url
            }
    else:
        if not api_failed:
            mark_as_enhanced(file_path, active_sources)
        final_res = {
            "filename": filename,
            "status": "skipped",
            "matched_title": None,
            "confidence": 0.0,
            "reason": f"No matches found above lower threshold of {int(lower_threshold*100)}%",
            "file_path": file_path,
            "metadata": None,
            "source": None,
            "candidates": sorted(candidates, key=lambda x: x["score"], reverse=True)
        }

    if on_progress:
        status_label = "Updated ✦" if final_res["status"] == "tagged" else ("Failed to Write" if final_res["status"] == "failed" else "Skipped")
        on_progress(filename, source_url or "None", status_label, score)

    return final_res
