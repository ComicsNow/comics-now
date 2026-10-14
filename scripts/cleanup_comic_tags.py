#!/usr/bin/env python3
"""Non-destructive cleanup script to remove redundant 'Comic' and 'Comics' tags/genres.

Strictly follows Comics Now AI Agent Guidelines:
- Rule 1: NEVER delete user reading lists or remove comics from them.
- Rule 2: NEVER reset or alter user reading progress (user_comic_status, progress, device_progress, lastReadPage).
- Non-destructive: only cleans the 'metadata' JSON column in 'comics' table and
  the <Genre> and <Tags> elements in adjacent .ComicInfo.xml sidecar files.
"""

import os
import sys
import json
import sqlite3
import xml.etree.ElementTree as ET

DB_PATH = "/opt/comics-now/comics-now.db"


def clean_tokens(val):
    if not val or not isinstance(val, str):
        return ""
    tokens = [x.strip() for x in val.split(",") if x.strip()]
    filtered = [x for x in tokens if x.lower() not in ["comic", "comics"]]
    return ", ".join(filtered)


def clean_metadata_dict(meta):
    changed = False
    for k in ["Genre", "genre", "Tags", "tags"]:
        if k in meta and meta[k]:
            orig = meta[k]
            cleaned = clean_tokens(orig)
            if cleaned != orig:
                if cleaned:
                    meta[k] = cleaned
                else:
                    del meta[k]
                changed = True

    if "genres" in meta and isinstance(meta["genres"], list):
        orig_genres = meta["genres"]
        filtered_genres = [
            g for g in orig_genres
            if g and isinstance(g, str) and g.strip().lower() not in ["comic", "comics"]
        ]
        if filtered_genres != orig_genres:
            meta["genres"] = filtered_genres
            changed = True

    return changed


def clean_xml_file(xml_path):
    if not os.path.exists(xml_path):
        return False
    try:
        tree = ET.parse(xml_path)
        root = tree.getroot()
        changed = False

        for tag_name in ["Genre", "Tags"]:
            elem = root.find(tag_name)
            if elem is not None and elem.text:
                orig_text = elem.text
                cleaned_text = clean_tokens(orig_text)
                if cleaned_text != orig_text:
                    if cleaned_text:
                        elem.text = cleaned_text
                    else:
                        root.remove(elem)
                    changed = True

        if changed:
            # Write back cleanly formatted XML
            tree.write(xml_path, encoding="utf-8", xml_declaration=True)
            return True
    except Exception as e:
        print(f"[-] Error cleaning XML {xml_path}: {e}", file=sys.stderr)
    return False


def main():
    if not os.path.exists(DB_PATH):
        print(f"Error: Database not found at {DB_PATH}", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    print("[*] Querying comics from database...")
    cursor.execute("SELECT id, path, metadata FROM comics WHERE metadata LIKE '%comic%' OR metadata LIKE '%Comic%'")
    rows = cursor.fetchall()
    print(f"[*] Found {len(rows)} potential candidate rows in 'comics' table.")

    db_updated = 0
    xml_updated = 0

    for cid, cpath, meta_str in rows:
        if not meta_str:
            continue
        try:
            meta = json.loads(meta_str)
        except Exception:
            continue

        if clean_metadata_dict(meta):
            new_meta_str = json.dumps(meta)
            cursor.execute("UPDATE comics SET metadata = ? WHERE id = ?", (new_meta_str, cid))
            db_updated += 1

        # Check for sidecar XML
        if cpath:
            sidecar1 = f"{cpath}.ComicInfo.xml"
            sidecar2 = f"{os.path.splitext(cpath)[0]}.ComicInfo.xml"
            for sc in [sidecar1, sidecar2]:
                if os.path.exists(sc):
                    if clean_xml_file(sc):
                        xml_updated += 1

    conn.commit()
    conn.close()

    print(f"[+] Successfully cleaned {db_updated} comic records in database.")
    print(f"[+] Successfully cleaned {xml_updated} sidecar ComicInfo.xml files on disk.")


if __name__ == "__main__":
    main()
