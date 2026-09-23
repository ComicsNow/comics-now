import os
import uuid
import shutil
import zipfile
import threading
import time
import datetime
import json
import hashlib
from flask import Flask, render_template, request, jsonify, send_file, Response
from werkzeug.utils import secure_filename

# Tagging logic now lives in the tagger_app package.
from tagger_app.core.metadata import normalize_metadata, calculate_similarity
from tagger_app.core.covers import extract_cover_from_cbz
from tagger_app.core.limiter import domain_limiter
from tagger_app.core.comicinfo import read_comic_info_xml, generate_comic_info_xml, write_comic_info_to_cbz, write_comic_info
from tagger_app.sources.comicvine import search_comicvine_multi
from tagger_app.sources.gcd import search_gcd_multi
from tagger_app.sources.lcg import search_lcg_multi
from tagger_app.sources.metron import search_metron_multi
from tagger_app.sources.goodreads import search_goodreads_multi
from tagger_app.sources.blackwells import search_blackwells_multi
from tagger_app.sources.waterstones import search_waterstones_multi
from tagger_app.sources.googlebooks import search_googlebooks_multi
from tagger_app.sources.amazon import search_amazon_multi
from tagger_app.sources.registry import SOURCES, SourceContext
from tagger_app.config import DB_TRACKING_PATH, LOGS_DIR
from tagger_app.persistence.tracking_db import (
    init_tracking_db, mark_as_enhanced, is_already_enhanced,
)
from tagger_app.persistence.scan_logs import write_scan_log
from tagger_app.scheduler.state import (
    scheduler_config, scheduler_status,
    load_scheduler_data, save_scheduler_data, calculate_next_run,
)

app = Flask(__name__)

# Configure upload and temp directories
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
STATIC_TEMP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'temp')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(STATIC_TEMP_DIR, exist_ok=True)
os.makedirs(LOGS_DIR, exist_ok=True)

# Keep track of active session files (mapping file_id -> original_cbz_path)
# In production, this would be a database or Redis, but a dict is perfect for a local prototype.
sessions = {}
active_scans = {}
active_scans_lock = threading.Lock()

def check_comic_info_completeness(cbz_path):
    """
    Checks if ComicInfo.xml exists in the CBZ and contains Series, Number, Publisher, and Year.
    Returns:
      is_incomplete: bool
      reason: str or None
    """
    import defusedxml.ElementTree as ET
    if not os.path.exists(cbz_path):
        return True, "File not found"
    if not zipfile.is_zipfile(cbz_path):
        return True, "Invalid zip archive"
        
    try:
        with zipfile.ZipFile(cbz_path, 'r') as zf:
            if "ComicInfo.xml" not in zf.namelist():
                return True, "No ComicInfo.xml found"
                
            xml_data = zf.read("ComicInfo.xml")
            root = ET.fromstring(xml_data)
            
            missing_fields = []
            
            # Helper to check if tag is empty/missing
            def is_empty(tag_name):
                elem = root.find(tag_name)
                return elem is None or not elem.text or not elem.text.strip()
                
            if is_empty("Series") and is_empty("Title"):
                missing_fields.append("Series/Title")
            if is_empty("Number"):
                missing_fields.append("Issue Number")
            if is_empty("Publisher"):
                missing_fields.append("Publisher")
            if is_empty("Year"):
                missing_fields.append("Year")
                
            if missing_fields:
                return True, f"Missing: {', '.join(missing_fields)}"
            
            return False, None
    except Exception as e:
        return True, f"Error parsing ComicInfo.xml: {str(e)}"


def enrich_metadata_from_other_sources(primary_meta, all_candidates, lower_threshold):
    """
    Enriches the primary_meta dictionary by filling in empty or missing fields
    from other high-confidence candidates in the list (score >= lower_threshold).
    """
    enrich_fields = [
        "publisher", "publish_date", "description", "isbn", "genres", "pages", 
        "authors", "series", "number", "year", "month", "day",
        "writer", "penciller", "inker", "colorist", "letterer", "cover_artist", "editor", "volume",
        "characters", "teams", "locations"
    ]
    
    def is_value_empty(val):
        if val is None:
            return True
        if isinstance(val, str) and not val.strip():
            return True
        if isinstance(val, (list, set, tuple)) and len(val) == 0:
            return True
        return False

    # Collect unique sources
    sources = []
    primary_src = primary_meta.get("source_url")
    if primary_src:
        sources.append(primary_src)

    for cand in all_candidates:
        cand_meta = cand.get("metadata") or cand
        # In unique_candidates format, score is out of 100.
        cand_score = cand.get("score") if cand.get("score") is not None else (cand.get("confidence") or 0)
        
        # Normalize score to 0-1 scale if needed
        if cand_score > 1.0:
            cand_score /= 100.0
            
        if cand_score < lower_threshold:
            continue
            
        # Avoid merging with ourselves
        if cand_meta.get("source_url") == primary_meta.get("source_url"):
            continue
            
        # Ensure series/title match
        p_series = primary_meta.get("series") or primary_meta.get("title") or ""
        c_series = cand_meta.get("series") or cand_meta.get("title") or ""
        if calculate_similarity(p_series, c_series) < 0.85:
            continue
            
        # Ensure issue numbers match if both are specified
        p_num = primary_meta.get("number") or primary_meta.get("issue_number")
        c_num = cand_meta.get("number") or cand_meta.get("issue_number")
        if p_num and c_num and str(p_num).strip() != str(c_num).strip():
            continue
            
        enriched_any = False
        for field in enrich_fields:
            if is_value_empty(primary_meta.get(field)) and not is_value_empty(cand_meta.get(field)):
                print(f"[+] Enriching field '{field}' in '{primary_meta.get('title')}' from: {cand_meta.get('source_url') or 'other candidate source'}")
                primary_meta[field] = cand_meta[field]
                enriched_any = True
                
        if enriched_any:
            src_val = cand_meta.get("source_url") or cand.get("source")
            if src_val and src_val not in sources:
                sources.append(src_val)
                
    # Clean up and join sources
    if sources:
        unique_sources = []
        for s in sources:
            s_clean = s
            if s.startswith("http"):
                parts = s.split("/")
                if len(parts) > 2:
                    s_clean = parts[2].replace("www.", "")
            if s_clean not in unique_sources:
                unique_sources.append(s_clean)
        primary_meta["source_url"] = ", ".join(unique_sources)
        
    return primary_meta


def consolidate_all_candidates(candidates_list):
    """
    Consolidates a list of candidates from multiple sources.
    Candidates that refer to the same comic (similar series name and matching issue number)
    are grouped together. In each group, the highest-scoring candidate is chosen as primary,
    and enriched with empty/missing fields from all other candidates in the group.
    Returns a sorted list of consolidated (metadata_dict, score, source_url) candidates.
    """
    if not candidates_list:
        return []

    # Sort candidates by score descending first
    normalized_list = []
    for item in candidates_list:
        if isinstance(item, tuple) and len(item) == 3:
            meta, score, src = item
        else:
            continue
        normalized_list.append({
            "metadata": meta,
            "score": score,
            "source": src
        })

    # Sort by score descending
    normalized_list.sort(key=lambda x: x["score"], reverse=True)

    consolidated = []

    def is_value_empty(val):
        if val is None:
            return True
        if isinstance(val, str) and not val.strip():
            return True
        if isinstance(val, (list, set, tuple)) and len(val) == 0:
            return True
        return False

    enrich_fields = [
        "publisher", "publish_date", "description", "isbn", "genres", "pages", 
        "authors", "series", "number", "year", "month", "day",
        "writer", "penciller", "inker", "colorist", "letterer", "cover_artist", "editor", "volume",
        "characters", "teams", "locations"
    ]

    for cand in normalized_list:
        meta = cand["metadata"]
        score = cand["score"]
        src = cand["source"]

        # Check if this candidate matches any already consolidated group
        matched_idx = -1
        for idx, cons in enumerate(consolidated):
            cons_meta = cons["metadata"]

            # Match series/title
            p_series = cons_meta.get("series") or cons_meta.get("title") or ""
            c_series = meta.get("series") or meta.get("title") or ""

            if calculate_similarity(p_series, c_series) < 0.85:
                continue

            # Match issue numbers
            p_num = cons_meta.get("number") or cons_meta.get("issue_number")
            c_num = meta.get("number") or meta.get("issue_number")
            if p_num and c_num and str(p_num).strip() != str(c_num).strip():
                continue

            matched_idx = idx
            break

        if matched_idx >= 0:
            # Merge fields into the existing consolidated group primary candidate
            cons_meta = consolidated[matched_idx]["metadata"]
            cons_sources = consolidated[matched_idx]["sources"]

            # Enrich empty fields of primary with non-empty fields from cand
            for field in enrich_fields:
                if is_value_empty(cons_meta.get(field)) and not is_value_empty(meta.get(field)):
                    cons_meta[field] = meta[field]

            # Accumulate source URL/label
            src_val = meta.get("source_url") or src
            if src_val and src_val not in cons_sources:
                cons_sources.append(src_val)
        else:
            # Start a new consolidated group
            src_list = []
            src_val = meta.get("source_url") or src
            if src_val:
                src_list.append(src_val)
            # Make a copy to avoid mutating the original dict in place inappropriately
            consolidated.append({
                "metadata": dict(meta),
                "score": score,
                "sources": src_list
            })

    # Post-process to format source URLs/labels
    results = []
    for cons in consolidated:
        meta = cons["metadata"]
        score = cons["score"]
        sources = cons["sources"]

        unique_sources = []
        for s in sources:
            s_clean = s
            if s.startswith("http"):
                parts = s.split("/")
                if len(parts) > 2:
                    s_clean = parts[2].replace("www.", "")
            if s_clean not in unique_sources:
                unique_sources.append(s_clean)

        meta["source_url"] = ", ".join(unique_sources)
        results.append((meta, score, meta["source_url"]))

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
                                   enabled_sources=None, on_progress=None,
                                   existing_meta=None):
    """
    Queries enabled sources in tiered order with early-exit optimization:
    Tier 1: Authoritative comic databases (ComicVine, Metron, GCD, LCG).
    If a Tier 1 match achieves high confidence (>= 92%) with complete core metadata,
    early-exits immediately to skip heavy web scrapers.
    Tier 2: Retailers / book databases (Goodreads, Blackwell's, Waterstones, Google Books) as fallback.
    """
    def progress(source_name, msg):
        if on_progress:
            try:
                on_progress(filename, source_name, msg)
            except Exception:
                pass

    ctx = SourceContext(
        comicvine_api_key=comicvine_api_key,
        google_books_api_key=google_books_api_key,
        metron_user=metron_user,
        metron_pass=metron_pass,
        cover_path=cover_path,
        existing_meta=existing_meta,
    )

    raw_candidates = []

    # Partition sources into Tier 1 (Comic DBs) and Tier 2 (Book Retailers/Scrapers)
    tier1_sources = [s for s in SOURCES if getattr(s, "tier", 1) == 1]
    tier2_sources = [s for s in SOURCES if getattr(s, "tier", 1) > 1]

    # 1. Execute Tier 1 sources
    for source in tier1_sources:
        if not source.is_enabled(enabled_sources):
            progress(source.label, "Skipped (Disabled)")
            continue

        progress(source.label, source.search_message)
        try:
            res = source.resolve(filename, ctx, lambda m, _label=source.label: progress(_label, m))
            if res:
                raw_candidates.extend(res)
                valid = [c for c in res if isinstance(c, (tuple, list)) and len(c) >= 2 and c[1] >= 0.50]
                if valid:
                    best = max(valid, key=lambda x: x[1])
                    pct = round(best[1] * 100, 1)
                    title_info = (best[0].get("title") or best[0].get("series") or "") if isinstance(best[0], dict) else ""
                    if title_info:
                        progress(source.label, f"Match found at {pct}% ({title_info})")
                    else:
                        progress(source.label, f"Match found at {pct}%")
                else:
                    progress(source.label, "No match found")
            else:
                progress(source.label, "No match found")
        except Exception as e:
            print(f"[-] {source.label} search failed: {e}")
            progress(source.label, f"Search failed: {str(e)}")

    # Check if Tier 1 found a high-confidence match with complete fields
    consolidated_tier1 = consolidate_all_candidates(raw_candidates)
    if consolidated_tier1:
        best_meta, best_score, best_src = consolidated_tier1[0]
        if best_score >= 0.92 and _has_core_metadata_fields(best_meta):
            print(f"[+] Early exit: Tier 1 high-confidence match ({round(best_score * 100, 1)}%) with complete metadata. Skipping Tier 2 scrapers.")
            return consolidated_tier1

    # 2. Execute Tier 2 sources if Tier 1 lacked a confident complete match
    for source in tier2_sources:
        if not source.is_enabled(enabled_sources):
            progress(source.label, "Skipped (Disabled)")
            continue

        progress(source.label, source.search_message)
        try:
            res = source.resolve(filename, ctx, lambda m, _label=source.label: progress(_label, m))
            if res:
                raw_candidates.extend(res)
                valid = [c for c in res if isinstance(c, (tuple, list)) and len(c) >= 2 and c[1] >= 0.50]
                if valid:
                    best = max(valid, key=lambda x: x[1])
                    pct = round(best[1] * 100, 1)
                    title_info = (best[0].get("title") or best[0].get("series") or "") if isinstance(best[0], dict) else ""
                    if title_info:
                        progress(source.label, f"Match found at {pct}% ({title_info})")
                    else:
                        progress(source.label, f"Match found at {pct}%")
                else:
                    progress(source.label, "No match found")
            else:
                progress(source.label, "No match found")
        except Exception as e:
            print(f"[-] {source.label} search failed: {e}")
            progress(source.label, f"Search failed: {str(e)}")

    # Consolidate all candidates across both tiers
    consolidated = consolidate_all_candidates(raw_candidates)
    return consolidated


def process_single_cbz_file(file_path, comicvine_api_key, google_books_api_key=None, metron_user=None, metron_pass=None, lower_threshold=0.80, upper_threshold=0.90, on_progress=None, enabled_fields=None, enabled_sources=None, force_reprocess=False, metadata_storage="archive", publisher_codex=None):
    filename = os.path.basename(file_path)
    print(f"[*] Processing CBZ file: {filename}")
    
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
    
    active_sources = enabled_sources if enabled_sources else ["src-comicvine", "src-metron-gcd", "src-lcg", "src-goodreads", "src-blackwells", "src-waterstones"]
    api_failed = False
    
    metadata = None
    source_url = None
    score = 0.0
    candidates = []
    def add_candidate(meta, score_val, source):
        if meta and score_val >= lower_threshold:
            # Check if source is a URL or a label
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

    # Extract the cover so the resolver can verify candidates by image (pHash).
    cover_path = None
    created_tmp_dir = False
    cover_tmp_dir = None
    
    # Check if there is an existing persistent session cover we can reuse
    session_id = hashlib.sha256(file_path.encode('utf-8')).hexdigest()
    persistent_cover_dir = os.path.join(UPLOAD_FOLDER, session_id)
    persistent_cover_path = os.path.join(persistent_cover_dir, f"cover_{filename}.jpg")
    
    if os.path.exists(persistent_cover_path):
        try:
            if os.path.getmtime(persistent_cover_path) >= os.path.getmtime(file_path):
                cover_path = persistent_cover_path
                print(f"[+] Reusing persistent cover for {filename}: {cover_path}")
        except Exception:
            pass
            
    if not cover_path:
        cover_tmp_dir = os.path.join(UPLOAD_FOLDER, f"cover_{uuid.uuid4().hex[:8]}")
        try:
            os.makedirs(cover_tmp_dir, exist_ok=True)
            created_tmp_dir = True
            cover_path = extract_cover_from_cbz(file_path, output_dir=cover_tmp_dir)
        except Exception as cov_err:
            print(f"[-] Cover extract failed for {filename}: {cov_err}")

    try:
        on_prog_cb = lambda fn, src, msg: on_progress(fn, src, msg) if on_progress else None
        if on_progress:
            domain_limiter.set_thread_callback(lambda msg: on_progress(filename, "RateDefense", msg))
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
        print(f"[-] Parallel search failed for {filename}: {resolve_err}")
        api_failed = True
    finally:
        domain_limiter.clear_thread_callback()
        if created_tmp_dir and cover_tmp_dir:
            shutil.rmtree(cover_tmp_dir, ignore_errors=True)

    # Step 4: Write metadata if confidence threshold is met
    final_res = None
    if metadata and score >= lower_threshold:
        # Cross-reference and enrich from other candidates
        metadata = enrich_metadata_from_other_sources(metadata, candidates, lower_threshold)
        metadata = normalize_metadata(metadata, codex=publisher_codex)
        if existing_notes:
            metadata["notes"] = existing_notes

        # Also normalize candidate metadatas with codex
        for cand in candidates:
            if cand.get("metadata"):
                cand["metadata"] = normalize_metadata(cand["metadata"], codex=publisher_codex)
        
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
            # In between lower and upper threshold! Needs review/manual approval!
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
        # Below lower threshold! Ignored/skipped!
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

def get_comics_now_cover(file_path):
    """
    Lookup cover art in the Comics-Now sqlite database at /opt/comics-now/comics-now.db.
    Match by absolute path first, and fallback to matching by filename.
    """
    import sqlite3
    db_path = "/opt/comics-now/comics-now.db"
    thumbnails_dir = "/opt/comics-now/thumbnails"
    
    if not os.path.exists(db_path):
        print(f"[-] Comics-Now database not found at {db_path}")
        return None
        
    conn = None
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # 1. Match by absolute path
        cursor.execute("SELECT thumbnailPath FROM comics WHERE path = ?", (file_path,))
        row = cursor.fetchone()
        if row and row[0]:
            thumb_path = os.path.join(thumbnails_dir, row[0])
            if os.path.exists(thumb_path):
                print(f"[+] Found Comics-Now cover by path: {thumb_path}")
                return thumb_path
                
        # 2. Fallback to match by filename (basename)
        filename = os.path.basename(file_path)
        cursor.execute("SELECT path, thumbnailPath FROM comics WHERE path LIKE ?", (f"%{filename}",))
        rows = cursor.fetchall()
        for r_path, r_thumb in rows:
            if os.path.basename(r_path) == filename and r_thumb:
                thumb_path = os.path.join(thumbnails_dir, r_thumb)
                if os.path.exists(thumb_path):
                    print(f"[+] Found Comics-Now cover by filename fallback: {thumb_path}")
                    return thumb_path
                    
    except Exception as e:
        print(f"[-] Error querying Comics-Now database: {e}")
    finally:
        if conn:
            conn.close()
            
    return None

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
            
        # Check if key is missing or empty in existing_meta
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
            
    return merged

def enhance_single_cbz_file(file_path, comicvine_api_key, google_books_api_key=None, metron_user=None, metron_pass=None, lower_threshold=0.80, upper_threshold=0.90, on_progress=None, enabled_fields=None, enabled_sources=None, force_reprocess=False):
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
        
    active_sources = enabled_sources if enabled_sources else ["src-comicvine", "src-metron-gcd", "src-lcg", "src-goodreads"]
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

    # Write metadata if confidence threshold is met
    final_res = None
    if metadata and score >= lower_threshold:
        # Cross-reference and enrich from other candidates
        metadata = enrich_metadata_from_other_sources(metadata, candidates, lower_threshold)
        
        # Merge only missing fields
        merged_meta = merge_only_missing_fields(existing_meta, metadata)
        
        # Check what fields are actually new/added
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
            # All resolved metadata fields are already present! Skip to avoid touch
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
            # Score meets upper threshold, write to CBZ
            try:
                xml_str = generate_comic_info_xml(merged_meta, enabled_fields=enabled_fields)
                write_comic_info(file_path, xml_str, metadata_storage)
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
            # In between lower and upper threshold
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
        # Below lower threshold! Ignored/skipped!
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

def run_scheduled_scan():
    global scheduler_status
    
    folder_path = scheduler_config["default_directory"]
    if not folder_path or not os.path.exists(folder_path) or not os.path.isdir(folder_path):
        print(f"[-] Scheduled scan folder not found: {folder_path}")
        scheduler_status["last_run"] = datetime.datetime.now().isoformat()
        calculate_next_run()
        save_scheduler_data()
        return
        
    scheduler_status["is_running"] = True
    start_time = datetime.datetime.now()
    
    try:
        cbz_files = sorted([
            os.path.join(folder_path, f) for f in os.listdir(folder_path)
            if f.lower().endswith('.cbz')
        ])
        
        results = []
        tagged_count = 0
        
        for file_path in cbz_files:
            res = process_single_cbz_file(
                file_path,
                scheduler_config.get("comicvine_api_key"),
                google_books_api_key=scheduler_config.get("google_books_api_key"),
                metron_user=scheduler_config.get("metron_user"),
                metron_pass=scheduler_config.get("metron_pass"),
                lower_threshold=scheduler_config.get("lower_threshold", 0.80),
                upper_threshold=scheduler_config.get("upper_threshold", 0.90),
                enabled_fields=scheduler_config.get("selected_fields"),
                enabled_sources=scheduler_config.get("enabled_sources"),
                force_reprocess=scheduler_config.get("force_reprocess", False)
            )
            results.append(res)
            if res["status"] == "tagged":
                tagged_count += 1
                
        scan_log = {
            "timestamp": start_time.isoformat(),
            "duration_seconds": round((datetime.datetime.now() - start_time).total_seconds(), 2),
            "total_files": len(cbz_files),
            "tagged_count": tagged_count,
            "results": results
        }
        
        # Keep only the last 10 logs in history
        scheduler_status["history"] = [scan_log] + scheduler_status["history"][:9]
        
        # Write permanent log
        failed_count = sum(1 for r in results if r.get("status") == "failed")
        skipped_count = len(cbz_files) - tagged_count - failed_count
        write_scan_log(
            scan_type="scheduled",
            target=folder_path,
            total_files=len(cbz_files),
            tagged_count=tagged_count,
            skipped_count=skipped_count,
            failed_count=failed_count,
            results=results
        )
        
        print(f"[+] Scheduled scan completed: tagged {tagged_count}/{len(cbz_files)} files.")
        
    except Exception as e:
        print(f"[-] Scheduled scan failed: {e}")
        
    finally:
        scheduler_status["is_running"] = False
        scheduler_status["last_run"] = datetime.datetime.now().isoformat()
        calculate_next_run()
        save_scheduler_data()

def cleanup_old_files():
    """
    Deletes files and directories in uploads/ and temp_covers/ that are older than 24 hours.
    Also cleans up static/temp/ covers to avoid stale static files.
    """
    now = time.time()
    cutoff = now - 24 * 3600  # 24 hours ago
    
    temp_covers_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'temp_covers')
    target_dirs = [UPLOAD_FOLDER, temp_covers_dir, STATIC_TEMP_DIR]
    
    for folder in target_dirs:
        if not os.path.exists(folder):
            continue
        try:
            for filename in os.listdir(folder):
                file_path = os.path.join(folder, filename)
                try:
                    mtime = os.path.getmtime(file_path)
                    if mtime < cutoff:
                        if os.path.isfile(file_path) or os.path.islink(file_path):
                            os.unlink(file_path)
                            print(f"[+] Cleaned up old file: {file_path}")
                        elif os.path.isdir(file_path):
                            shutil.rmtree(file_path)
                            print(f"[+] Cleaned up old directory: {file_path}")
                            # Remove from sessions if it matches a session ID
                            sessions.pop(filename, None)
                except Exception as e:
                    print(f"[-] Failed to clean up {file_path}: {e}")
        except Exception as e:
            print(f"[-] Error listing directory {folder}: {e}")

def background_scheduler_worker():
    global scheduler_status
    print("[*] Background scheduler thread started.")
    
    last_cleanup_time = 0
    
    while True:
        try:
            time.sleep(10) # Check every 10 seconds
            
            # Run 24-hour file cleanup every 10 minutes
            now_ts = time.time()
            if now_ts - last_cleanup_time > 600:
                cleanup_old_files()
                last_cleanup_time = now_ts
                
            if not scheduler_config["enabled"] or not scheduler_config["default_directory"]:
                continue
                
            now = datetime.datetime.now()
            
            if not scheduler_status["next_run"]:
                calculate_next_run()
                
            if not scheduler_status["next_run"]:
                continue
                
            next_run_dt = datetime.datetime.fromisoformat(scheduler_status["next_run"])
            
            if now >= next_run_dt:
                run_scheduled_scan()
                
        except Exception as e:
            print(f"[-] Scheduler worker error: {e}")

@app.route('/')
def index():
    return render_template('index.html')




@app.route('/local-files', methods=['GET'])
def get_local_files():
    """
    Scans the workspace directory recursively for any .cbz files
    and returns a list of absolute paths and relative paths.
    """
    workspace_dir = os.path.dirname(os.path.abspath(__file__))
    cbz_files = []
    
    for root, dirs, files in os.walk(workspace_dir):
        # Exclude temp folders, cache folders, and hidden directories
        dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ('uploads', 'static', 'temp_covers')]
        for file in files:
            if file.lower().endswith('.cbz'):
                abs_path = os.path.join(root, file)
                rel_path = os.path.relpath(abs_path, workspace_dir)
                cbz_files.append({
                    "path": abs_path,
                    "rel_path": rel_path,
                    "filename": file
                })
                
    return jsonify({"success": True, "files": cbz_files})


@app.route('/browse-files', methods=['GET'])
def browse_files():
    """
    Returns lists of subdirectories and .cbz files in the requested path
    to support active filesystem browsing on the host.
    """
    workspace_dir = os.path.dirname(os.path.abspath(__file__))
    # Prioritize saved default scan directory if set
    if scheduler_config.get("default_directory") and os.path.exists(scheduler_config["default_directory"]):
        default_dir = scheduler_config["default_directory"]
    else:
        default_dir = os.path.expanduser("~") if os.path.exists(os.path.expanduser("~")) else workspace_dir
    
    path = request.args.get("path", default_dir)
    # Ensure the path is absolute
    path = os.path.abspath(path)
    
    if not os.path.exists(path) or not os.path.isdir(path):
        path = default_dir
        
    try:
        subdirs = []
        cbz_files = []
        
        # List contents of directory
        for item in sorted(os.listdir(path)):
            item_path = os.path.join(path, item)
            
            # Hide hidden directories/files
            if item.startswith('.'):
                continue
                
            if os.path.isdir(item_path):
                # Check permissions before listing
                if os.access(item_path, os.R_OK):
                    subdirs.append({
                        "name": item,
                        "path": item_path
                    })
            elif os.path.isfile(item_path) and item.lower().endswith('.cbz'):
                is_incomplete, reason = check_comic_info_completeness(item_path)
                cbz_files.append({
                    "name": item,
                    "path": item_path,
                    "size_mb": round(os.path.getsize(item_path) / (1024 * 1024), 2),
                    "is_incomplete": is_incomplete,
                    "incomplete_reason": reason
                })
                
        parent_path = os.path.dirname(path)
        if parent_path == path:
            parent_path = None
            
        return jsonify({
            "success": True,
            "current_path": path,
            "parent_path": parent_path,
            "subdirs": subdirs,
            "cbz_files": cbz_files
        })
    except Exception as e:
        return jsonify({"error": f"Failed to read directory: {str(e)}"}), 500


@app.route('/load-local', methods=['POST'])
def load_local_file():
    """
    Loads a CBZ file already present on the server without uploading it.
    """
    data = request.json or {}
    file_path = data.get("file_path")
    
    if not file_path or not os.path.exists(file_path):
        return jsonify({"error": "Selected file does not exist on the server."}), 400
        
    if not file_path.lower().endswith('.cbz'):
        return jsonify({"error": "Only .cbz files are supported."}), 400

    filename = os.path.basename(file_path)
    session_id = hashlib.sha256(file_path.encode('utf-8')).hexdigest()
    session_dir = os.path.join(UPLOAD_FOLDER, session_id)
    os.makedirs(session_dir, exist_ok=True)
    
    # Store session info. Track that it is local to the server so we can save it directly back.
    sessions[session_id] = {
        "cbz_path": file_path,
        "filename": filename,
        "session_dir": session_dir,
        "is_local": True
    }
    
    cover_exists = False
    expected_cover_path = os.path.join(session_dir, f"cover_{filename}.jpg")
    
    # Extract cover image
    try:
        static_cover_filename = f"cover_{session_id}.jpg"
        static_cover_path = os.path.join(STATIC_TEMP_DIR, static_cover_filename)
        
        # Check if we can reuse the existing cover from a previous run
        if os.path.exists(expected_cover_path):
            try:
                if os.path.getmtime(expected_cover_path) >= os.path.getmtime(file_path):
                    cover_exists = True
            except Exception:
                pass
                
        if cover_exists:
            print(f"[+] Reusing existing cover for {filename} from {expected_cover_path}")
            extracted_cover_path = expected_cover_path
        else:
            extracted_cover_path = extract_cover_from_cbz(file_path, output_dir=session_dir)
            
        # Check if the static temp file needs copying (if missing or outdated)
        static_exists = False
        if os.path.exists(static_cover_path):
            try:
                if os.path.getmtime(static_cover_path) >= os.path.getmtime(extracted_cover_path):
                    static_exists = True
            except Exception:
                pass
                
        if not static_exists:
            shutil.copy(extracted_cover_path, static_cover_path)
            
        existing_meta = read_comic_info_xml(file_path)
        
        return jsonify({
            "success": True,
            "session_id": session_id,
            "filename": filename,
            "cover_url": f"/static/temp/{static_cover_filename}",
            "existing_metadata": existing_meta
        })
    except Exception as e:
        if not cover_exists:
            shutil.rmtree(session_dir, ignore_errors=True)
        return jsonify({"error": f"Failed to extract cover: {str(e)}"}), 500

@app.route('/search', methods=['POST'])
def search_metadata():
    """
    Performs reverse image search on the cover of the given session ID
    and returns parsed metadata as a Server-Sent Events stream.
    Supports manual override URLs and query searches.
    """
    data = request.json or {}
    session_id = data.get("session_id")
    comicvine_api_key = data.get("comicvine_api_key")
    google_books_api_key = data.get("google_books_api_key")
    metron_user = data.get("metron_user")
    metron_pass = data.get("metron_pass")
    lower_threshold = float(data.get("lower_threshold", 0.80))
    upper_threshold = float(data.get("upper_threshold", 0.90))
    enabled_sources = data.get("enabled_sources") or scheduler_config.get("enabled_sources")

    if not session_id or session_id not in sessions:
        return jsonify({"error": "Invalid or expired session ID"}), 400
        
    session_info = sessions[session_id]
    
    def generate():
        import json
        
        def push_progress(message, step):
            return f"data: {json.dumps({'type': 'progress', 'message': message, 'step': step})}\n\n"
            
        try:
            raw_candidates = []
            
            active_labels = [s.label for s in SOURCES if s.is_enabled(enabled_sources)]

            # ── Cover flow: Search only enabled sources ──
            yield push_progress(f"Searching {', '.join(active_labels)}...", 2)
            # Locate the session's extracted cover for image verification.
            cover_path = os.path.join(session_info["session_dir"], f"cover_{session_info['filename']}.jpg")
            if not os.path.exists(cover_path):
                cover_path = None
                for _f in os.listdir(session_info["session_dir"]):
                    if _f.startswith("cover_") and _f.endswith(".jpg"):
                        cover_path = os.path.join(session_info["session_dir"], _f)
                        break
            
            resolved = query_all_sources_sequentially(
                session_info["filename"],
                cover_path=cover_path,
                comicvine_api_key=comicvine_api_key,
                google_books_api_key=google_books_api_key,
                metron_user=metron_user,
                metron_pass=metron_pass,
                enabled_sources=enabled_sources,
                on_progress=None
            )
            raw_candidates = [(m, s, u) for (m, s, u) in resolved if s >= lower_threshold]
            for meta, score, src in raw_candidates:
                yield push_progress(f"Match: {meta.get('title')} ({round(score*100,1)}%)", 3)
            if not raw_candidates:
                yield f"data: {json.dumps({'type': 'error', 'error': f'No matches found on ComicVine, Metron, GCD, League of Comic Geeks, or Goodreads above the lower threshold of {int(lower_threshold*100)}%.'})}\n\n"
                return

            # Common calculation and results pushing (applies to both manual/text and visual covers)
            seen_urls = set()
            unique_candidates = []
            for meta, score, matching_url in raw_candidates:
                meta = normalize_metadata(meta)
                url = matching_url or meta.get("source_url") or ""
                meta["source_url"] = url
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    meta["confidence_score"] = round(score * 100, 1)
                    meta["is_high_confidence"] = score >= upper_threshold
                    meta["auto_tagged"] = False
                    unique_candidates.append({
                        "metadata": meta,
                        "score": round(score * 100, 1),
                        "matching_url": url
                    })
            
            # Sort by score descending
            unique_candidates.sort(key=lambda x: x["score"], reverse=True)

            if unique_candidates:
                # Cross-reference and enrich all candidates from other high confidence candidates
                for i in range(len(unique_candidates)):
                    cand_meta = unique_candidates[i]["metadata"]
                    cand_meta = enrich_metadata_from_other_sources(cand_meta, unique_candidates, lower_threshold)
                    unique_candidates[i]["metadata"] = cand_meta
                
                best_candidate = unique_candidates[0]
                best_meta = best_candidate["metadata"]
                best_score = best_candidate["score"]
                matching_url = best_candidate["matching_url"]
                
                # If the best score is above or equal to upper range threshold, automatically accept!
                if best_score >= (upper_threshold * 100):
                    try:
                        yield push_progress(f"High confidence match ({best_score}%) detected (>= {int(upper_threshold*100)}%). Writing ComicInfo.xml...", 4)
                        xml_str = generate_comic_info_xml(best_meta, enabled_fields=scheduler_config.get("selected_fields"))
                        write_comic_info_to_cbz(session_info["cbz_path"], xml_str)
                        mark_as_enhanced(session_info["cbz_path"], [matching_url])
                        best_meta["auto_tagged"] = True
                        yield push_progress("Successfully auto-tagged comic!", 4)
                    except Exception as auto_err:
                        print(f"[-] Auto-tagging failed: {auto_err}")
                        yield push_progress(f"Auto-tagging failed: {str(auto_err)}", 4)
                
                yield f"data: {json.dumps({'type': 'result', 'metadata': best_meta, 'matching_url': matching_url, 'candidates': unique_candidates})}\n\n"
            else:
                yield f"data: {json.dumps({'type': 'error', 'error': f'No matching metadata found above the lower threshold of {int(lower_threshold * 100)}%.'})}\n\n"
                
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': f'Search failed: {str(e)}'})}\n\n"
            
    return Response(generate(), mimetype='text/event-stream')


@app.route('/tag', methods=['POST'])
def tag_comic():
    """
    Receives edited metadata, writes ComicInfo.xml, injects it back to CBZ.
    If the file is local to the server, it writes it directly back to the original file
    and returns a flag indicating direct save.
    """
    data = request.json or {}
    session_id = data.get("session_id")
    edited_metadata = data.get("metadata")
    
    if not session_id or session_id not in sessions:
        return jsonify({"error": "Invalid or expired session ID"}), 400
        
    if not edited_metadata:
        return jsonify({"error": "Metadata is required"}), 400
        
    session_info = sessions[session_id]
    cbz_path = session_info["cbz_path"]
    is_local = session_info.get("is_local", False)
    
    try:
        # Generate XML structure from edited frontend data
        xml_str = generate_comic_info_xml(edited_metadata, enabled_fields=scheduler_config.get("selected_fields"))
        
        # Inject the XML directly into the session's CBZ (which is the original if local)
        write_comic_info_to_cbz(cbz_path, xml_str)
        mark_as_enhanced(cbz_path, [edited_metadata.get("source_url") or "Unknown"])
        
        # Write permanent log
        write_scan_log(
            scan_type="single",
            target=cbz_path,
            total_files=1,
            tagged_count=1,
            skipped_count=0,
            failed_count=0,
            results=[{
                "filename": os.path.basename(cbz_path),
                "filepath": cbz_path,
                "status": "tagged",
                "confidence": float(edited_metadata.get("confidence_score") or 100.0),
                "source": edited_metadata.get("source_url") or "Manual",
                "metadata": edited_metadata
            }]
        )
        
        # Return success with download_url and local save info
        return jsonify({
            "success": True,
            "is_local": is_local,
            "file_path": cbz_path if is_local else None,
            "download_url": f"/download/{session_id}"
        })
    except Exception as e:
        return jsonify({"error": f"Tagging failed: {str(e)}"}), 500


@app.route('/batch-tag', methods=['POST'])
def batch_tag_folder():
    """
    Scans a folder for CBZ files, searches and automatically tags them
    if a high confidence match is found, streaming the progress in real-time.
    """
    data = request.json or {}
    folder_path = data.get("folder_path")
    comicvine_api_key = data.get("comicvine_api_key")
    google_books_api_key = data.get("google_books_api_key")
    metron_user = data.get("metron_user")
    metron_pass = data.get("metron_pass")
    lower_threshold = float(data.get("lower_threshold", 0.80))
    upper_threshold = float(data.get("upper_threshold", 0.90))
    
    enabled_sources = data.get("enabled_sources") or scheduler_config.get("enabled_sources")
    force_reprocess = bool(data.get("force_reprocess", scheduler_config.get("force_reprocess", False)))
    
    if not folder_path or not os.path.exists(folder_path) or not os.path.isdir(folder_path):
        return jsonify({"error": "Selected folder does not exist on the server."}), 400
        
    try:
        # Find all CBZ files directly inside this folder
        cbz_files = sorted([
            os.path.join(folder_path, f) for f in os.listdir(folder_path)
            if f.lower().endswith('.cbz')
        ])
        
        if not cbz_files:
            return jsonify({
                "success": True, 
                "tagged_count": 0, 
                "total_count": 0,
                "results": [], 
                "message": "No CBZ files found in the selected folder."
            })
            
        def generate():
            import queue
            import threading
            from concurrent.futures import ThreadPoolExecutor

            results = []
            tagged_count = 0
            total_count = len(cbz_files)

            # Number of comics to identify in parallel.
            max_concurrency = max(1, int(data.get("batch_concurrency", scheduler_config.get("batch_concurrency", 4))))

            ev = queue.Queue()          # shared event stream from all workers
            started = {"n": 0}          # how many files have begun (for "File X of Y")
            started_lock = threading.Lock()

            def worker(file_path):
                filename = os.path.basename(file_path)
                with started_lock:
                    started["n"] += 1
                    start_index = started["n"]
                ev.put({"type": "file_start", "filename": filename, "index": start_index, "total": total_count})

                def cb(fname, src, stat, conf=0.0):
                    ev.put({"type": "progress", "filename": fname, "source": src, "status": stat, "confidence": conf})

                try:
                    res = process_single_cbz_file(
                        file_path, comicvine_api_key,
                        google_books_api_key=google_books_api_key,
                        metron_user=metron_user, metron_pass=metron_pass,
                        lower_threshold=lower_threshold, upper_threshold=upper_threshold,
                        on_progress=cb,
                        enabled_fields=scheduler_config.get("selected_fields"),
                        enabled_sources=enabled_sources,
                        force_reprocess=force_reprocess
                    )
                except Exception as e:
                    res = {"filename": filename, "status": "failed", "error": str(e)}
                ev.put({"type": "file_complete_internal", "filename": filename, "result": res})

            executor = ThreadPoolExecutor(max_workers=max_concurrency)
            for fp in cbz_files:
                executor.submit(worker, fp)

            # Drain events until every file has reported completion. Each worker emits
            # all of its own progress events before its single file_complete, so once we
            # have seen total_count completions no further events remain to be produced.
            remaining = total_count
            while remaining > 0:
                try:
                    item = ev.get(timeout=0.1)
                except queue.Empty:
                    yield ": keepalive\n\n"
                    continue

                if item["type"] == "file_complete_internal":
                    res = item["result"]
                    results.append(res)
                    if res.get("status") == "tagged":
                        tagged_count += 1
                    remaining -= 1
                    yield f"data: {json.dumps({'type': 'file_complete', 'filename': item['filename'], 'result': res})}\n\n"
                else:
                    # file_start / progress — forward as-is
                    yield f"data: {json.dumps(item)}\n\n"

            executor.shutdown(wait=True)

            # Write permanent log
            failed_count = sum(1 for r in results if r.get("status") == "failed")
            skipped_count = total_count - tagged_count - failed_count
            write_scan_log(
                scan_type="batch",
                target=folder_path,
                total_files=total_count,
                tagged_count=tagged_count,
                skipped_count=skipped_count,
                failed_count=failed_count,
                results=results
            )

            # Yield final summary event
            yield f"data: {json.dumps({'type': 'batch_complete', 'tagged_count': tagged_count, 'total_count': total_count, 'results': results})}\n\n"
            
        return Response(generate(), mimetype='text/event-stream')
        
    except Exception as e:
        return jsonify({"error": f"Batch process initialization failed: {str(e)}"}), 500


@app.route('/scheduler-info', methods=['GET'])
def get_scheduler_info():
    return jsonify({
        "success": True,
        "config": scheduler_config,
        "status": scheduler_status
    })


@app.route('/scheduler-update', methods=['POST'])
def update_scheduler():
    global scheduler_config
    data = request.json or {}
    
    # Update config keys
    scheduler_config["default_directory"] = data.get("default_directory", "").strip()
    scheduler_config["interval_value"] = int(data.get("interval_value", 1))
    scheduler_config["interval_unit"] = data.get("interval_unit", "day")
    scheduler_config["enabled"] = bool(data.get("enabled", False))
    scheduler_config["comicvine_api_key"] = data.get("comicvine_api_key", "").strip()
    scheduler_config["google_books_api_key"] = data.get("google_books_api_key", "").strip()
    scheduler_config["metron_user"] = data.get("metron_user", "").strip()
    scheduler_config["metron_pass"] = data.get("metron_pass", "").strip()
    scheduler_config["confidence_threshold"] = float(data.get("confidence_threshold", 0.9))
    scheduler_config["lower_threshold"] = float(data.get("lower_threshold", 0.80))
    scheduler_config["upper_threshold"] = float(data.get("upper_threshold", 0.90))
    if "selected_fields" in data:
        scheduler_config["selected_fields"] = list(data.get("selected_fields", []))
    if "batch_concurrency" in data:
        scheduler_config["batch_concurrency"] = int(data.get("batch_concurrency", 4))
    if "enabled_sources" in data:
        scheduler_config["enabled_sources"] = list(data.get("enabled_sources", []))
    if "force_reprocess" in data:
        scheduler_config["force_reprocess"] = bool(data.get("force_reprocess", False))
    
    # Recalculate next run
    calculate_next_run()
    
    # Save to disk
    save_scheduler_data()
    
    return jsonify({
        "success": True,
        "message": "Scheduler settings updated successfully.",
        "config": scheduler_config,
        "status": scheduler_status
    })


@app.route('/scheduler-trigger', methods=['POST'])
def trigger_scheduler_scan():
    if scheduler_status["is_running"]:
        return jsonify({"error": "A scheduled scan is already running."}), 400
        
    # Run in background thread to avoid blocking response
    threading.Thread(target=run_scheduled_scan, daemon=True).start()
    return jsonify({
        "success": True,
        "message": "Scheduled scan started manually in the background."
    })


def run_library_enhance_background(folder_path, cbz_files, comicvine_api_key, google_books_api_key, metron_user, metron_pass, lower_threshold, upper_threshold, enabled_sources, max_concurrency, scan_id):
    global active_scans
    
    total_count = len(cbz_files)
    results = []
    tagged_count = 0
    remaining = total_count
    
    from concurrent.futures import ThreadPoolExecutor
    import queue
    
    scan = None
    with active_scans_lock:
        scan = active_scans.get(scan_id)
        
    def worker(file_path):
        filename = os.path.basename(file_path)
        def cb(fname, src, stat, conf=0.0):
            evt_prog = {"type": "progress", "filename": fname, "source": src, "status": stat, "confidence": conf}
            with active_scans_lock:
                for q in list(scan["queues"]):
                    q.put(evt_prog)
                    
        with active_scans_lock:
            started_count = scan["processed_count"] + 1
            current_index = started_count
        evt = {"type": "file_start", "filename": filename, "index": current_index, "total": total_count}
        log_str = f"---> Processing: {filename} ({current_index}/{total_count})"
        with active_scans_lock:
            scan["console_history"].append(log_str)
            for q in list(scan["queues"]):
                q.put(evt)
                
        try:
            res = enhance_single_cbz_file(
                file_path, comicvine_api_key,
                google_books_api_key=google_books_api_key,
                metron_user=metron_user, metron_pass=metron_pass,
                lower_threshold=lower_threshold, upper_threshold=upper_threshold,
                on_progress=cb,
                enabled_fields=scheduler_config.get("selected_fields"),
                enabled_sources=enabled_sources,
                force_reprocess=scan.get("force_reprocess", False)
            )
        except Exception as e:
            res = {"filename": filename, "status": "failed", "error": str(e)}
            
        evt_comp = {"type": "file_complete", "filename": filename, "result": res}
        status = res.get("status")
        if status == "tagged":
            log_str = f"[Success] Tagged and updated ComicInfo.xml for: {filename} ({res.get('confidence', 0)}%)"
        elif status == "skipped":
            log_str = f"[Skipped] {filename}: {res.get('reason', 'Low confidence')}"
        else:
            log_str = f"[Error] Failed to process {filename}: {res.get('error', 'Write failed')}"
            
        with active_scans_lock:
            scan["processed_count"] += 1
            if status == "tagged":
                scan["tagged_count"] += 1
            elif status == "skipped":
                scan["skipped_count"] += 1
            elif status == "failed":
                scan["failed_count"] += 1

            scan["console_history"].append(log_str)
            scan["completed_history"].append(res)
            for q in list(scan["queues"]):
                q.put(evt_comp)
                
        # Put result in local queue for tracking completion
        scan["results_queue"].put(res)

    executor = ThreadPoolExecutor(max_workers=max_concurrency)
    for fp in cbz_files:
        executor.submit(worker, fp)

    # Gather results
    while remaining > 0:
        try:
            res = scan["results_queue"].get(timeout=1.0)
            results.append(res)
            if res.get("status") == "tagged":
                tagged_count += 1
            remaining -= 1
        except queue.Empty:
            continue

    executor.shutdown(wait=True)

    # Write permanent log
    failed_count = sum(1 for r in results if r.get("status") == "failed")
    skipped_count = total_count - tagged_count - failed_count
    write_scan_log(
        scan_type="library",
        target=folder_path,
        total_files=total_count,
        tagged_count=tagged_count,
        skipped_count=skipped_count,
        failed_count=failed_count,
        results=results
    )

    evt_done = {'type': 'library_complete', 'tagged_count': tagged_count, 'total_count': total_count, 'results': results}
    log_str = "[System] Library enhancement complete!"
    with active_scans_lock:
        scan["console_history"].append(log_str)
        scan["status"] = "completed"
        for q in list(scan["queues"]):
            q.put(evt_done)


@app.route('/library-enhance', methods=['POST'])
def library_enhance_folder():
    """
    Recursively scans a folder for CBZ files, checks Comics-Now database for covers,
    looks up metadata from online sources, merges only missing fields (non-overwriting),
    and streams progress in real-time. Detaches scan in a background thread to prevent
    browser lock/disconnect crashes.
    """
    data = request.json or {}
    folder_path = data.get("folder_path")
    comicvine_api_key = data.get("comicvine_api_key")
    google_books_api_key = data.get("google_books_api_key")
    metron_user = data.get("metron_user")
    metron_pass = data.get("metron_pass")
    lower_threshold = float(data.get("lower_threshold", 0.80))
    upper_threshold = float(data.get("upper_threshold", 0.90))
    
    enabled_sources = data.get("enabled_sources") or scheduler_config.get("enabled_sources")
    force_reprocess = bool(data.get("force_reprocess", scheduler_config.get("force_reprocess", False)))
    
    if not folder_path or not os.path.exists(folder_path) or not os.path.isdir(folder_path):
        return jsonify({"error": "Selected folder does not exist on the server."}), 400
        
    try:
        # Recursively find all CBZ files in all subfolders
        cbz_files = []
        for root_dir, dirs, files in os.walk(folder_path):
            for file in files:
                if file.lower().endswith('.cbz'):
                    cbz_files.append(os.path.join(root_dir, file))
        cbz_files.sort()
                    
        if not cbz_files:
            return jsonify({
                "success": True, 
                "tagged_count": 0, 
                "total_count": 0,
                "results": [], 
                "message": "No CBZ files found in the selected folder."
            })
            
        scan_id = folder_path
        
        # Check if already running
        with active_scans_lock:
            scan = active_scans.get(scan_id)
            if not scan or scan["status"] != "running":
                # Start new scan
                import queue
                from collections import deque
                scan = {
                    "console_history": deque(maxlen=100),
                    "completed_history": deque(maxlen=100),
                    "queues": set(),
                    "results_queue": queue.Queue(),
                    "status": "running",
                    "force_reprocess": force_reprocess,
                    "total_count": len(cbz_files),
                    "processed_count": 0,
                    "tagged_count": 0,
                    "skipped_count": 0,
                    "failed_count": 0
                }
                scan["console_history"].append("[System] Starting Library Enhancement scan...")
                scan["console_history"].append(f"[System] Folder: {folder_path}")
                active_scans[scan_id] = scan
                
                # Start background thread
                max_concurrency = max(1, int(data.get("batch_concurrency", scheduler_config.get("batch_concurrency", 4))))
                t = threading.Thread(
                    target=run_library_enhance_background,
                    args=(folder_path, cbz_files, comicvine_api_key, google_books_api_key, metron_user, metron_pass, lower_threshold, upper_threshold, enabled_sources, max_concurrency, scan_id),
                    daemon=True
                )
                t.start()
                
        # Subscribe to scan queue
        import queue
        q = queue.Queue()
        with active_scans_lock:
            evt_snapshot = {
                "type": "snapshot",
                "total_count": scan["total_count"],
                "processed_count": scan["processed_count"],
                "tagged_count": scan["tagged_count"],
                "skipped_count": scan["skipped_count"],
                "failed_count": scan["failed_count"],
                "console_history": list(scan["console_history"]),
                "completed_history": list(scan["completed_history"])
            }
            scan["queues"].add(q)
            
        def generate():
            # Send snapshot first
            yield f"data: {json.dumps(evt_snapshot)}\n\n"
                
            while True:
                try:
                    item = q.get(timeout=2.0)
                    yield f"data: {json.dumps(item)}\n\n"
                    if item.get("type") == "library_complete":
                        break
                except queue.Empty:
                    yield ": keepalive\n\n"
                except GeneratorExit:
                    # Client disconnected
                    with active_scans_lock:
                        if scan_id in active_scans:
                            active_scans[scan_id]["queues"].discard(q)
                    break
                    
        return Response(generate(), mimetype='text/event-stream')
    except Exception as e:
        return jsonify({"error": f"Library enhance initialization failed: {str(e)}"}), 500


@app.route('/download/<session_id>', methods=['GET'])
def download_file(session_id):
    """
    Sends the fully tagged CBZ file to the browser.
    """
    if not session_id or session_id not in sessions:
        return "Session not found or expired", 404
        
    session_info = sessions[session_id]
    cbz_path = session_info["cbz_path"]
    filename = session_info["filename"]
    
    return send_file(
        cbz_path,
        as_attachment=True,
        download_name=f"tagged_{filename}",
        mimetype="application/x-cbz"
    )


# Clean up uploads and static/temp folders on exit or periodically
@app.route('/cleanup', methods=['POST'])
def cleanup_temp():
    # Helper to purge upload and static temp files
    try:
        for folder in [UPLOAD_FOLDER, STATIC_TEMP_DIR]:
            for filename in os.listdir(folder):
                file_path = os.path.join(folder, filename)
                try:
                    if os.path.isfile(file_path) or os.path.islink(file_path):
                        os.unlink(file_path)
                    elif os.path.isdir(file_path):
                        shutil.rmtree(file_path)
                except Exception as e:
                    pass
        sessions.clear()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def start_scheduler():
    # Load settings from disk
    load_scheduler_data()
    
    # Calculate next run
    calculate_next_run()
    save_scheduler_data()
    
    # Start background worker thread
    t = threading.Thread(target=background_scheduler_worker, daemon=True)
    t.start()

@app.route('/api/active-scan', methods=['GET'])
def get_active_scan():
    with active_scans_lock:
        for scan_id, scan in active_scans.items():
            if scan.get("status") == "running":
                return jsonify({
                    "active": True,
                    "folder_path": scan_id,
                    "status": "running",
                    "total_count": scan.get("total_count", 0),
                    "processed_count": scan.get("processed_count", 0),
                    "tagged_count": scan.get("tagged_count", 0),
                    "skipped_count": scan.get("skipped_count", 0),
                    "failed_count": scan.get("failed_count", 0),
                    "console_history": list(scan["console_history"]),
                    "completed_history": list(scan["completed_history"])
                })
    return jsonify({"active": False})


@app.route('/api/health', methods=['GET'])
def api_health():
    return jsonify({ "status": "ok", "version": "1.0" })


@app.route('/api/tag-file', methods=['POST'])
def api_tag_file():
    data = request.json or {}
    file_path = data.get("path")
    if not file_path or not os.path.exists(file_path):
        return jsonify({"error": "Selected file does not exist."}), 400
        
    try:
        comicvine_api_key = data.get("comicvine_api_key") or scheduler_config.get("comicvine_api_key")
        google_books_api_key = data.get("google_books_api_key") or scheduler_config.get("google_books_api_key")
        metron_user = data.get("metron_user") or scheduler_config.get("metron_user")
        metron_pass = data.get("metron_pass") or scheduler_config.get("metron_pass")
        lower_threshold = float(data.get("lower_threshold") or scheduler_config.get("lower_threshold", 0.80))
        upper_threshold = float(data.get("upper_threshold") or scheduler_config.get("upper_threshold", 0.90))
        enabled_sources = data.get("enabled_sources") or scheduler_config.get("enabled_sources")
        force_reprocess = bool(data.get("force_reprocess", scheduler_config.get("force_reprocess", False)))
        metadata_storage = data.get("metadata_storage") or scheduler_config.get("metadata_storage", "archive")
        publisher_codex = data.get("publisher_codex")

        res = process_single_cbz_file(
            file_path=file_path,
            comicvine_api_key=comicvine_api_key,
            google_books_api_key=google_books_api_key,
            metron_user=metron_user,
            metron_pass=metron_pass,
            lower_threshold=lower_threshold,
            upper_threshold=upper_threshold,
            enabled_fields=scheduler_config.get("selected_fields"),
            enabled_sources=enabled_sources,
            force_reprocess=force_reprocess,
            metadata_storage=metadata_storage,
            publisher_codex=publisher_codex
        )
        
        # Write permanent log
        write_scan_log(
            scan_type="single",
            target=file_path,
            total_files=1,
            tagged_count=1 if res.get("status") == "tagged" else 0,
            skipped_count=1 if res.get("status") in ["skipped", "review"] else 0,
            failed_count=1 if res.get("status") == "failed" else 0,
            results=[res]
        )
        
        return jsonify(res)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/tag-file-stream', methods=['POST'])
def api_tag_file_stream():
    data = request.json or {}
    file_path = data.get("path")
    if not file_path or not os.path.exists(file_path):
        return jsonify({"error": "Selected file does not exist."}), 400

    def generate():
        import queue
        event_q = queue.Queue()

        def prog_cb(filename, source, msg, score=None):
            try:
                event_q.put({"type": "progress", "source": source, "message": msg, "score": score})
            except Exception:
                pass

        worker_res = {}
        worker_err = {}

        def run_worker():
            try:
                comicvine_api_key = data.get("comicvine_api_key") or scheduler_config.get("comicvine_api_key")
                google_books_api_key = data.get("google_books_api_key") or scheduler_config.get("google_books_api_key")
                metron_user = data.get("metron_user") or scheduler_config.get("metron_user")
                metron_pass = data.get("metron_pass") or scheduler_config.get("metron_pass")
                lower_threshold = float(data.get("lower_threshold") or scheduler_config.get("lower_threshold", 0.80))
                upper_threshold = float(data.get("upper_threshold") or scheduler_config.get("upper_threshold", 0.90))
                enabled_sources = data.get("enabled_sources") or scheduler_config.get("enabled_sources")
                force_reprocess = bool(data.get("force_reprocess", scheduler_config.get("force_reprocess", False)))
                metadata_storage = data.get("metadata_storage") or scheduler_config.get("metadata_storage", "archive")
                publisher_codex = data.get("publisher_codex")

                res = process_single_cbz_file(
                    file_path=file_path,
                    comicvine_api_key=comicvine_api_key,
                    google_books_api_key=google_books_api_key,
                    metron_user=metron_user,
                    metron_pass=metron_pass,
                    lower_threshold=lower_threshold,
                    upper_threshold=upper_threshold,
                    on_progress=prog_cb,
                    enabled_fields=scheduler_config.get("selected_fields"),
                    enabled_sources=enabled_sources,
                    force_reprocess=force_reprocess,
                    metadata_storage=metadata_storage,
                    publisher_codex=publisher_codex
                )
                worker_res["result"] = res

                # Write permanent log
                write_scan_log(
                    scan_type="single",
                    target=file_path,
                    total_files=1,
                    tagged_count=1 if res.get("status") == "tagged" else 0,
                    skipped_count=1 if res.get("status") in ["skipped", "review"] else 0,
                    failed_count=1 if res.get("status") == "failed" else 0,
                    results=[res]
                )
            except Exception as e:
                worker_err["error"] = str(e)
            finally:
                event_q.put({"type": "done"})

        worker_thread = threading.Thread(target=run_worker, daemon=True)
        worker_thread.start()

        while True:
            try:
                ev = event_q.get(timeout=0.4)
                if ev.get("type") == "done":
                    break
                yield f"data: {json.dumps(ev)}\n\n"
            except queue.Empty:
                if not worker_thread.is_alive() and event_q.empty():
                    break
                yield ": keepalive\n\n"

        worker_thread.join(timeout=5.0)

        if "error" in worker_err:
            yield f"data: {json.dumps({'type': 'error', 'error': worker_err['error']})}\n\n"
        elif "result" in worker_res:
            yield f"data: {json.dumps({'type': 'result', 'data': worker_res['result']})}\n\n"

    return Response(generate(), mimetype='text/event-stream')


@app.route('/api/apply-tag', methods=['POST'])
def api_apply_tag():
    data = request.json or {}
    file_path = data.get("path")
    metadata = data.get("metadata")
    if not file_path or not os.path.exists(file_path):
        return jsonify({"error": "Selected file does not exist."}), 400
    if not metadata:
        return jsonify({"error": "Metadata is required."}), 400
        
    metadata_storage = data.get("metadata_storage") or scheduler_config.get("metadata_storage", "archive")
    try:
        xml_str = generate_comic_info_xml(metadata, enabled_fields=scheduler_config.get("selected_fields"))
        write_comic_info(file_path, xml_str, metadata_storage)
        mark_as_enhanced(file_path, [metadata.get("source_url") or "Unknown"])
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": f"Failed to apply tag: {str(e)}"}), 500


@app.route('/api/search', methods=['POST'])
def api_search_external():
    data = request.json or {}
    source = data.get("source", "").lower()
    query = data.get("query", "").strip()
    if not source or not query:
        return jsonify({"error": "source and query are required."}), 400

    try:
        results = []
        if source == "all":
            import concurrent.futures
            sources_to_run = [
                ("gcd", lambda: search_gcd_multi(query)),
                ("lcg", lambda: search_lcg_multi(query)),
                ("goodreads", lambda: search_goodreads_multi(query)),
                ("blackwells", lambda: search_blackwells_multi(query)),
                ("waterstones", lambda: search_waterstones_multi(query)),
                ("googlebooks", lambda: search_googlebooks_multi(query, api_key=data.get("google_books_api_key") or scheduler_config.get("google_books_api_key"))),
                ("amazon", lambda: search_amazon_multi(query)),
            ]

            cv_key = data.get("comicvine_api_key") or scheduler_config.get("comicvine_api_key")
            if cv_key:
                sources_to_run.append(("comicvine", lambda: search_comicvine_multi(query, cv_key)))

            metron_user = data.get("metron_user") or scheduler_config.get("metron_user")
            metron_pass = data.get("metron_pass") or scheduler_config.get("metron_pass")
            if metron_user and metron_pass:
                sources_to_run.append(("metron", lambda: search_metron_multi(query, metron_user, metron_pass)))

            with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(sources_to_run), 8)) as executor:
                future_to_src = {executor.submit(fn): src_name for src_name, fn in sources_to_run}
                for future in concurrent.futures.as_completed(future_to_src):
                    src_name = future_to_src[future]
                    try:
                        res = future.result()
                        if res and isinstance(res, list):
                            for item in res:
                                if item and isinstance(item, dict):
                                    if "source" not in item:
                                        item["source"] = src_name
                                    results.append(item)
                    except Exception as exc:
                        print(f"[-] Search source '{src_name}' error: {exc}")

        elif source == "comicvine":
            api_key = data.get("comicvine_api_key") or scheduler_config.get("comicvine_api_key")
            if not api_key:
                return jsonify({"error": "ComicVine API key not set"}), 400
            res = search_comicvine_multi(query, api_key)
            for item in (res or []):
                if isinstance(item, dict):
                    item["source"] = "comicvine"
                    results.append(item)

        elif source == "gcd":
            res = search_gcd_multi(query)
            for item in (res or []):
                if isinstance(item, dict):
                    item["source"] = "gcd"
                    results.append(item)

        elif source == "lcg":
            res = search_lcg_multi(query)
            for item in (res or []):
                if isinstance(item, dict):
                    item["source"] = "lcg"
                    results.append(item)

        elif source == "metron":
            user = data.get("metron_user") or scheduler_config.get("metron_user")
            pwd = data.get("metron_pass") or scheduler_config.get("metron_pass")
            res = search_metron_multi(query, user, pwd)
            for item in (res or []):
                if isinstance(item, dict):
                    item["source"] = "metron"
                    results.append(item)

        elif source == "goodreads":
            res = search_goodreads_multi(query)
            for item in (res or []):
                if isinstance(item, dict):
                    item["source"] = "goodreads"
                    results.append(item)

        elif source == "blackwells":
            res = search_blackwells_multi(query)
            for item in (res or []):
                if isinstance(item, dict):
                    item["source"] = "blackwells"
                    results.append(item)

        elif source == "waterstones":
            res = search_waterstones_multi(query)
            for item in (res or []):
                if isinstance(item, dict):
                    item["source"] = "waterstones"
                    results.append(item)

        elif source in ("googlebooks", "google_books", "google-books"):
            api_key = data.get("google_books_api_key") or scheduler_config.get("google_books_api_key")
            res = search_googlebooks_multi(query, api_key=api_key)
            for item in (res or []):
                if isinstance(item, dict):
                    item["source"] = "googlebooks"
                    results.append(item)

        elif source in ("amazon", "src-amazon", "amz"):
            res = search_amazon_multi(query)
            for item in (res or []):
                if isinstance(item, dict):
                    item["source"] = "amazon"
                    results.append(item)
        else:
            return jsonify({"error": f"Unsupported search source: {source}"}), 400

        # Normalize metadata for each result
        publisher_codex = data.get("publisher_codex")
        normalized = []
        for r in results:
            if r:
                src = r.get("source") or source
                norm = normalize_metadata(r, codex=publisher_codex)
                norm["source"] = src
                normalized.append(norm)

        return jsonify(normalized)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/homepage', methods=['GET'])
def homepage_widget():
    """
    Returns a JSON object compatible with the 'Homepage' dashboard custom widget.
    """
    history = scheduler_status.get("history", [])
    total_tagged = sum(h.get("tagged_count", 0) for h in history)
    
    status_text = "Idle"
    if scheduler_status.get("is_running"):
        status_text = "Scanning..."
    elif scheduler_config.get("enabled"):
        status_text = "Scheduled"

    return jsonify([
        {"label": "Status", "value": status_text},
        {"label": "Total Tagged", "value": total_tagged},
        {"label": "History", "value": len(history)}
    ])


@app.route('/api/logs', methods=['GET'])
def get_logs():
    logs = []
    if os.path.exists(LOGS_DIR):
        for f in os.listdir(LOGS_DIR):
            if f.startswith("scan_log_") and f.endswith(".json"):
                path = os.path.join(LOGS_DIR, f)
                try:
                    with open(path, 'r') as file_obj:
                        data = json.load(file_obj)
                        log_meta = {
                            "id": data.get("id"),
                            "timestamp": data.get("timestamp"),
                            "type": data.get("type"),
                            "target": data.get("target"),
                            "total_files": data.get("total_files"),
                            "tagged_count": data.get("tagged_count"),
                            "skipped_count": data.get("skipped_count"),
                            "failed_count": data.get("failed_count"),
                            "filename": f
                        }
                        logs.append(log_meta)
                except Exception as e:
                    print(f"[-] Error reading log file {f}: {e}")
    # Sort logs by timestamp descending
    logs.sort(key=lambda x: x["timestamp"], reverse=True)
    return jsonify({"success": True, "logs": logs})


@app.route('/api/logs/<log_id>', methods=['GET'])
def get_log_detail(log_id):
    filename = f"scan_log_{log_id}.json"
    path = os.path.join(LOGS_DIR, filename)
    if not os.path.exists(path):
        return jsonify({"error": "Log not found"}), 404
    try:
        with open(path, 'r') as file_obj:
            data = json.load(file_obj)
        return jsonify({"success": True, "log": data})
    except Exception as e:
        return jsonify({"error": f"Failed to read log: {str(e)}"}), 500


@app.route('/api/logs/<log_id>', methods=['DELETE'])
def delete_log(log_id):
    filename = f"scan_log_{log_id}.json"
    path = os.path.join(LOGS_DIR, filename)
    if not os.path.exists(path):
        return jsonify({"error": "Log not found"}), 404
    try:
        os.remove(path)
        return jsonify({"success": True, "message": "Log deleted successfully"})
    except Exception as e:
        return jsonify({"error": f"Failed to delete log: {str(e)}"}), 500


@app.route('/api/logs', methods=['DELETE'])
def clear_all_logs():
    try:
        deleted_count = 0
        if os.path.exists(LOGS_DIR):
            for f in os.listdir(LOGS_DIR):
                if f.startswith("scan_log_") and f.endswith(".json"):
                    os.remove(os.path.join(LOGS_DIR, f))
                    deleted_count += 1
        return jsonify({"success": True, "message": f"Successfully deleted {deleted_count} logs"})
    except Exception as e:
        return jsonify({"error": f"Failed to clear logs: {str(e)}"}), 500


@app.route('/api/enhanced-comics/clear', methods=['POST'])
def clear_enhanced_comics():
    import sqlite3
    try:
        conn = sqlite3.connect(DB_TRACKING_PATH)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM enhanced_comics")
        conn.commit()
        conn.close()
        
        # Also disable legacy XML fallback to ignore previous file-based tags
        scheduler_config["legacy_xml_fallback"] = False
        save_scheduler_data()
        
        return jsonify({"success": True, "message": "Successfully cleared all enhanced comics from tracking database and disabled legacy XML fallback."})
    except Exception as e:
        return jsonify({"error": f"Failed to clear tracking database: {str(e)}"}), 500


def _env_flag(name, default=False):
    """Parse a boolean-ish environment variable."""
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


def get_run_config():
    """Resolve server run settings from the environment.

    Security (SEC-001): debug defaults to OFF. The Werkzeug debugger allows arbitrary
    code execution, so it must never be enabled by default.

    The server binds 0.0.0.0 by default so it is reachable across the user's trusted
    LAN (an intentional requirement). No app-level authentication is enforced — the
    deployment relies on the local network being trusted (SEC-002 accepted as risk).

    Override via env vars:
      FLASK_DEBUG=1            enable the debugger (development only, never on a shared host)
      APP_HOST=127.0.0.1       restrict to loopback if you don't want LAN exposure
      APP_PORT=5000            listen port
    """
    return {
        "host": os.environ.get("APP_HOST", "0.0.0.0"),
        "port": int(os.environ.get("APP_PORT", "5000")),
        "debug": _env_flag("FLASK_DEBUG", default=False),
        "threaded": True,
    }


def create_app():
    """Application factory: initialize services and return the configured Flask app.

    Importing this module no longer has side effects — call create_app() to run the
    tracking-DB init and start the background scheduler worker. This keeps imports
    (and tests/tooling) free of thread/disk side effects.
    """
    init_tracking_db()
    # In debug mode Werkzeug runs the app twice (reloader); only start the worker in the
    # main/reloaded process so we don't spawn two scheduler threads.
    if os.environ.get("WERKZEUG_RUN_MAIN") == "true" or not get_run_config()["debug"]:
        start_scheduler()
    return app


if __name__ == '__main__':
    create_app()
    cfg = get_run_config()
    if cfg["debug"]:
        print("[!] WARNING: Flask debug mode is ON (Werkzeug debugger allows code execution). "
              "Never use this on an exposed host.")
    app.run(**cfg)
