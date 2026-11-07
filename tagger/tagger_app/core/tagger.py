"""Single comic file tagging and cover resolution."""

import os
import uuid
import shutil
import hashlib
import sqlite3

from tagger_app.config import UPLOAD_FOLDER
from tagger_app.core.metadata import normalize_metadata
from tagger_app.core.covers import extract_cover_from_cbz, get_comics_now_cover
from tagger_app.core.limiter import domain_limiter
from tagger_app.core.comicinfo import read_comic_info_xml, generate_comic_info_xml, write_comic_info
from tagger_app.core.enrichment import check_comic_info_completeness, enrich_metadata_from_other_sources, query_all_sources_sequentially
from tagger_app.persistence.tracking_db import mark_as_enhanced, is_already_enhanced
from tagger_app.scheduler.state import scheduler_config
from tagger_app.continuity.enricher import enrich_with_continuity


def _is_readable_cover(file_path):
    """Return True when a supplied cover exists, is readable, and is non-empty."""
    if not file_path:
        return False
    try:
        return (
            os.path.isfile(file_path)
            and os.access(file_path, os.R_OK)
            and os.path.getsize(file_path) > 0
        )
    except OSError:
        return False


def process_single_cbz_file(file_path, comicvine_api_key, google_books_api_key=None, metron_user=None, metron_pass=None, lower_threshold=0.80, upper_threshold=0.90, on_progress=None, enabled_fields=None, enabled_sources=None, force_reprocess=False, metadata_storage="archive", publisher_codex=None, cover_path=None):
    filename = os.path.basename(file_path)
    print(f"[*] Processing comic file: {filename}")

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

    if not force_reprocess:
        is_incomplete, _ = check_comic_info_completeness(file_path)
        if not is_incomplete:
            mark_as_enhanced(file_path, enabled_sources or ["archive"])
            if on_progress:
                on_progress(filename, "Completeness Check", "Already contains complete ComicInfo.xml metadata. Skipped.", 1.0)
            return {
                "filename": filename,
                "status": "skipped",
                "reason": "Already contains complete ComicInfo.xml metadata",
                "file_path": file_path,
                "metadata": read_comic_info_xml(file_path),
                "source": None,
                "candidates": []
            }

    # Read existing metadata
    existing_meta = {}
    existing_notes = ""
    try:
        existing_meta = read_comic_info_xml(file_path) or {}
        existing_notes = existing_meta.get("notes", "").strip()
    except Exception:
        pass

    active_sources = enabled_sources if enabled_sources else ["src-comicvine", "src-metron", "src-gcd", "src-lcg", "src-forbiddenplanet", "src-googlebooks", "src-goodreads", "src-blackwells", "src-waterstones", "src-amazon"]

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

    # Resolve the cover so the resolver can verify candidates by image (pHash).
    # Node supplies a thumbnail for CBR archives, which Python cannot extract.
    resolved_cover_path = cover_path if _is_readable_cover(cover_path) else None
    if resolved_cover_path:
        print(f"[+] Using supplied cover for {filename}: {resolved_cover_path}")
    created_tmp_dir = False
    cover_tmp_dir = None

    session_id = hashlib.md5(file_path.encode('utf-8')).hexdigest()
    persistent_cover_dir = os.path.join(UPLOAD_FOLDER, session_id)
    persistent_cover_path = os.path.join(persistent_cover_dir, f"cover_{filename}.jpg")

    if not resolved_cover_path and os.path.exists(persistent_cover_path):
        try:
            if os.path.getmtime(persistent_cover_path) >= os.path.getmtime(file_path):
                resolved_cover_path = persistent_cover_path
                print(f"[+] Reusing persistent cover for {filename}: {resolved_cover_path}")
        except Exception:
            pass

    if not resolved_cover_path:
        cover_tmp_dir = os.path.join(UPLOAD_FOLDER, f"cover_{uuid.uuid4().hex[:8]}")
        try:
            os.makedirs(cover_tmp_dir, exist_ok=True)
            created_tmp_dir = True
            resolved_cover_path = extract_cover_from_cbz(file_path, output_dir=cover_tmp_dir)
        except Exception as cov_err:
            print(f"[-] Cover extract failed for {filename}: {cov_err}")

    try:
        on_prog_cb = lambda fn, src, msg: on_progress(fn, src, msg) if on_progress else None
        if on_progress:
            domain_limiter.set_thread_callback(lambda msg: on_progress(filename, "RateDefense", msg))
        consolidated_cands = query_all_sources_sequentially(
            filename,
            cover_path=resolved_cover_path,
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
        print(f"[-] Parallel search failed for {filename}: {resolve_err}")
    finally:
        domain_limiter.clear_thread_callback()
        if created_tmp_dir and cover_tmp_dir:
            shutil.rmtree(cover_tmp_dir, ignore_errors=True)

    final_res = None
    if metadata and score >= lower_threshold:
        metadata = enrich_metadata_from_other_sources(metadata, candidates, lower_threshold)
        metadata = normalize_metadata(metadata, codex=publisher_codex)
        enrich_with_continuity(metadata, file_path, cover_path=resolved_cover_path)
        if existing_notes:
            metadata["notes"] = existing_notes

        for cand in candidates:
            if cand.get("metadata"):
                cand["metadata"] = normalize_metadata(cand["metadata"], codex=publisher_codex)
                enrich_with_continuity(cand["metadata"], file_path, cover_path=resolved_cover_path)

        if score >= upper_threshold:
            try:
                xml_str = generate_comic_info_xml(metadata, enabled_fields=enabled_fields)
                write_comic_info(file_path, xml_str, metadata_storage)
                mark_as_enhanced(file_path, active_sources)
                final_res = {
                    "filename": filename,
                    "status": "tagged",
                    "matched_title": metadata.get("title"),
                    "confidence": round(score * 100, 1),
                    "source": source_url,
                    "file_path": file_path,
                    "metadata": metadata,
                    "candidates": sorted(candidates, key=lambda x: x["score"], reverse=True),
                    "matching_url": source_url
                }
            except Exception as write_err:
                final_res = {
                    "filename": filename,
                    "status": "failed",
                    "matched_title": metadata.get("title"),
                    "confidence": round(score * 100, 1),
                    "error": str(write_err)
                }
        else:
            final_res = {
                "filename": filename,
                "status": "review",
                "matched_title": metadata.get("title"),
                "confidence": round(score * 100, 1),
                "reason": f"Needs Confirmation (Confidence: {round(score * 100, 1)}% is below Auto-Accept limit of {int(upper_threshold*100)}%)",
                "file_path": file_path,
                "metadata": metadata,
                "source": source_url,
                "candidates": sorted(candidates, key=lambda x: x["score"], reverse=True),
                "matching_url": source_url
            }
    else:
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
        status_label = "Tagged ✦" if final_res["status"] == "tagged" else ("Failed to Write" if final_res["status"] == "failed" else ("Needs Review" if final_res["status"] == "review" else "Ignored ✘"))
        on_progress(filename, source_url or "None", status_label, score)

    return final_res



