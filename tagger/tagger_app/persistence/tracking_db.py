"""SQLite tracking DB: records which comics have been enhanced, and decides whether
a file still needs processing (with optional legacy ComicInfo.xml signature fallback).

Extracted from the legacy app.py monolith (architecture review, persistence layer).
"""
import os
import sqlite3
import zipfile
import xml.etree.ElementTree as ET

from tagger_app.config import DB_TRACKING_PATH


def init_tracking_db():
    conn = None
    try:
        conn = sqlite3.connect(DB_TRACKING_PATH)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS enhanced_comics (
                file_path TEXT PRIMARY KEY,
                mtime REAL,
                sources TEXT,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()
    except Exception as e:
        print(f"[-] Failed to initialize tracking database: {e}")
    finally:
        if conn:
            conn.close()


def mark_as_enhanced(file_path, sources_list):
    if not sources_list:
        return
    conn = None
    try:
        conn = sqlite3.connect(DB_TRACKING_PATH)
        cursor = conn.cursor()
        
        # Get existing sources for this path if any
        cursor.execute("SELECT sources FROM enhanced_comics WHERE file_path = ?", (file_path,))
        row = cursor.fetchone()
        
        mtime = os.path.getmtime(file_path) if os.path.exists(file_path) else 0.0
        
        # Convert sources to lowercase set
        new_sources = {s.lower() for s in sources_list if s}
        if row and row[0]:
            existing_sources = set(row[0].split(','))
            combined_sources = existing_sources.union(new_sources)
        else:
            combined_sources = new_sources
            
        sources_str = ",".join(sorted(list(combined_sources)))
        
        cursor.execute("""
            INSERT INTO enhanced_comics (file_path, mtime, sources, last_updated)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(file_path) DO UPDATE SET
                mtime = excluded.mtime,
                sources = excluded.sources,
                last_updated = CURRENT_TIMESTAMP
        """, (file_path, mtime, sources_str))
        conn.commit()
    except Exception as e:
        print(f"[-] Failed to record enhanced status in DB: {e}")
    finally:
        if conn:
            conn.close()


def parse_sources_from_cbz_xml(file_path):
    """
    Parses legacy 'Tag Comics Now!' signature notes from the CBZ XML.
    Returns a set of sources found.
    """
    sources = set()
    try:
        with zipfile.ZipFile(file_path, 'r') as z:
            if "ComicInfo.xml" in z.namelist():
                xml_data = z.read("ComicInfo.xml")
                root = ET.fromstring(xml_data)
                notes_elem = root.find("Notes")
                if notes_elem is not None and notes_elem.text:
                    notes_text = notes_elem.text
                    if "Tag Comics Now!" in notes_text:
                        # Extract source from each signature line
                        for line in notes_text.split('\n'):
                            if "Tag Comics Now!" in line:
                                if "comicvine" in line.lower():
                                    sources.add("src-comicvine")
                                elif "metron" in line.lower() or "gcd" in line.lower() or "comics.org" in line.lower():
                                    sources.add("src-metron-gcd")
                                elif "leagueof" in line.lower() or "lcg" in line.lower():
                                    sources.add("src-lcg")
                                elif "goodreads" in line.lower():
                                    sources.add("src-goodreads")
                                elif "blackwells" in line.lower():
                                    sources.add("src-blackwells")
                                elif "waterstones" in line.lower():
                                    sources.add("src-waterstones")
                                else:
                                    sources.add("unknown")
    except (zipfile.BadZipFile, ET.ParseError, KeyError):
        pass
    except (OSError, PermissionError) as e:
        print(f"[-] Warning: Failed to read {file_path} for tracking signatures: {e}")
    return sources


def check_sources_match(has_sources, enabled_sources):
    if not enabled_sources:
        return len(has_sources) > 0
        
    source_keywords = {
        "src-comicvine": ["comicvine", "src-comicvine"],
        "src-metron-gcd": ["metron", "gcd", "comics.org", "grandcomicbookdatabase", "src-metron-gcd"],
        "src-lcg": ["leagueofcomicgeeks", "lcg", "src-lcg"],
        "src-goodreads": ["goodreads", "src-goodreads"],
        "src-blackwells": ["blackwells", "src-blackwells"],
        "src-waterstones": ["waterstones", "src-waterstones"]
    }
    
    for src in enabled_sources:
        src_key = src.lower()
        if src_key not in source_keywords:
            if "goodreads" in src_key: src_key = "src-goodreads"
            elif "blackwells" in src_key: src_key = "src-blackwells"
            elif "waterstones" in src_key: src_key = "src-waterstones"
            elif "comicvine" in src_key: src_key = "src-comicvine"
            elif "metron" in src_key or "gcd" in src_key: src_key = "src-metron-gcd"
            elif "lcg" in src_key or "leagueof" in src_key: src_key = "src-lcg"
            
        keywords = source_keywords.get(src_key, [src_key])
        has_source = any(any(kw in hs for kw in keywords) for hs in has_sources)
        if not has_source:
            return False
    return True


def is_already_enhanced(file_path, enabled_sources=None, legacy_xml_fallback=True):
    """
    Checks if the comic archive has already been enhanced by 'Tag Comics Now!'
    for the enabled sources. Utilizes SQLite for near-instant checks and 
    falls back to XML notes signatures (with automatic DB migration) if enabled.
    """
    if not os.path.exists(file_path):
        return False
        
    db_row = None
    conn = None
    try:
        conn = sqlite3.connect(DB_TRACKING_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT mtime, sources FROM enhanced_comics WHERE file_path = ?", (file_path,))
        db_row = cursor.fetchone()
    except Exception as e:
        print(f"[-] Error querying tracking database: {e}")
    finally:
        if conn:
            conn.close()
        
    current_mtime = os.path.getmtime(file_path)
    
    if db_row:
        db_mtime, db_sources_str = db_row
        if current_mtime <= db_mtime + 5.0:
            db_sources = set(db_sources_str.split(',')) if db_sources_str else set()
            return check_sources_match(db_sources, enabled_sources)
            
    # Check if we should fall back to reading legacy XML signatures
    if legacy_xml_fallback:
        fallback_sources = parse_sources_from_cbz_xml(file_path)
        if fallback_sources:
            # Migrate/import to SQLite database
            mark_as_enhanced(file_path, list(fallback_sources))
            return check_sources_match(fallback_sources, enabled_sources)
            
    return False
