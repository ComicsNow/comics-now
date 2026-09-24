"""ComicInfo.xml read/generate/write for CBZ archives.

Extracted from the legacy tagger.py monolith (architecture review, step 1).
"""
import os
import re
import zipfile
import xml.etree.ElementTree as ET
from xml.dom import minidom

from tagger_app.core.metadata import (
    normalize_metadata,
    clean_format_and_edition,
    normalize_publisher,
    clean_description,
    is_title_same_as_series,
    resolve_creator_roles,
)


def read_comic_info_xml(cbz_path):
    """
    Reads the existing ComicInfo.xml metadata inside a CBZ archive
    and returns a mapped dictionary of fields.
    """
    import zipfile
    import xml.etree.ElementTree as ET
    
    if not os.path.exists(cbz_path):
        return None
        
    try:
        with zipfile.ZipFile(cbz_path, 'r') as z:
            if "ComicInfo.xml" in z.namelist():
                xml_data = z.read("ComicInfo.xml")
                root = ET.fromstring(xml_data)
                
                metadata = {}
                
                tag_mappings = {
                    "Title": "title",
                    "Series": "series",
                    "Number": "number",
                    "Publisher": "publisher",
                    "Imprint": "imprint",
                    "Summary": "description",
                    "Year": "year",
                    "Month": "month",
                    "Day": "day",
                    "PageCount": "pages",
                    "LanguageISO": "language",
                    "Genre": "genres",
                    "Tags": "tags",
                    "GTIN": "isbn",
                    "Writer": "writer",
                    "Penciller": "penciller",
                    "Inker": "inker",
                    "Colorist": "colorist",
                    "Letterer": "letterer",
                    "CoverArtist": "cover_artist",
                    "Editor": "editor",
                    "Volume": "volume",
                    "Characters": "characters",
                    "Teams": "teams",
                    "Locations": "locations"
                }
                
                for xml_tag, meta_key in tag_mappings.items():
                    elem = root.find(xml_tag)
                    if elem is not None and elem.text:
                        val = elem.text.strip()
                        if meta_key == "genres":
                            metadata[meta_key] = [g.strip() for g in val.split(",") if g.strip()]
                        elif meta_key == "writer":
                            metadata["authors"] = [a.strip() for a in val.split(",") if a.strip()]
                        else:
                            metadata[meta_key] = val
                            
                return normalize_metadata(metadata)
    except Exception as e:
        print(f"[-] Failed to read existing ComicInfo.xml: {e}")
        
    return None

def generate_comic_info_xml(metadata, enabled_fields=None):
    """
    Creates a ComicInfo.xml compliant string from our metadata dict.
    """
    if not metadata or not isinstance(metadata, dict):
        metadata = {}
    else:
        metadata = resolve_creator_roles(dict(metadata))

    def _clean_str(val):
        if val is None:
            return ""
        if isinstance(val, (list, tuple, set)):
            items = [str(x).strip() for x in val if x is not None and str(x).strip()]
            return ", ".join(items)
        return str(val).strip()

    root = ET.Element("ComicInfo", {
        "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
        "xmlns:xsd": "http://www.w3.org/2001/XMLSchema"
    })
    
    # Title & Series & Issue Number
    title_val = clean_format_and_edition(_clean_str(metadata.get("title") or metadata.get("issue_title")))
    series_val = clean_format_and_edition(_clean_str(metadata.get("series")))
    
    # Rule: If the title and series match (including issue numbers, #3, 3, volume suffixes, or format tags), do NOT add Title; keep Series
    if title_val and (is_title_same_as_series(title_val, series_val) or (not series_val and is_title_same_as_series(title_val, ""))):
        title_val = ""

    if series_val:
        ET.SubElement(root, "Series").text = series_val
    if title_val:
        ET.SubElement(root, "Title").text = title_val
        
    num_val = _clean_str(metadata.get("number") or metadata.get("issue_number") or metadata.get("issue"))
    if num_val:
        ET.SubElement(root, "Number").text = num_val

    vol_val = _clean_str(metadata.get("volume"))
    if vol_val:
        ET.SubElement(root, "Volume").text = vol_val
        
    pub_val = normalize_publisher(_clean_str(metadata.get("publisher")))
    if pub_val:
        ET.SubElement(root, "Publisher").text = pub_val
        
    desc_val = clean_description(_clean_str(metadata.get("description") or metadata.get("summary")))
    if desc_val:
        ET.SubElement(root, "Summary").text = desc_val
        
    # Handle Year / Month / Day
    year = _clean_str(metadata.get("year"))
    month = _clean_str(metadata.get("month"))
    day = _clean_str(metadata.get("day"))
    
    p_date = _clean_str(metadata.get("publish_date") or metadata.get("cover_date"))
    if not year and p_date:
        if "-" in p_date:
            year_parts = p_date.split("-")
            if len(year_parts) > 0 and len(year_parts[0]) == 4:
                year = year_parts[0]
            if len(year_parts) > 1:
                try:
                    month = str(int(year_parts[1]))
                except ValueError:
                    pass  # Non-numeric month; fallback to month name matching below
            if len(year_parts) > 2:
                try:
                    day = str(int(year_parts[2]))
                except ValueError:
                    pass  # Non-numeric day fallback
        
        if not year:
            match = re.search(r'\b(19|20)\d{2}\b', p_date)
            if match:
                year = match.group(0)
        
        if not month:
            months = ["january", "february", "march", "april", "may", "june", 
                      "july", "august", "september", "october", "november", "december"]
            for i, m in enumerate(months):
                if m in p_date.lower():
                    month = str(i + 1)
                    break
    
    if year:
        ET.SubElement(root, "Year").text = str(year)
    if month:
        ET.SubElement(root, "Month").text = str(month)
    if day:
        ET.SubElement(root, "Day").text = str(day)
            
    # Optional tags driven by enabled_fields.
    
    # 1. Writer / Authors
    if enabled_fields is None or "Writer" in enabled_fields:
        writer_val = _clean_str(metadata.get("writer") or metadata.get("authors"))
        if writer_val:
            ET.SubElement(root, "Writer").text = writer_val
            
    # 2. Penciller
    if enabled_fields is None or "Penciller" in enabled_fields:
        penciller_val = _clean_str(metadata.get("penciller"))
        if penciller_val:
            ET.SubElement(root, "Penciller").text = penciller_val
            
    # 3. Inker
    if enabled_fields is None or "Inker" in enabled_fields:
        inker_val = _clean_str(metadata.get("inker"))
        if inker_val:
            ET.SubElement(root, "Inker").text = inker_val
            
    # 4. Colorist
    if enabled_fields is None or "Colorist" in enabled_fields:
        colorist_val = _clean_str(metadata.get("colorist"))
        if colorist_val:
            ET.SubElement(root, "Colorist").text = colorist_val
            
    # 5. Letterer
    if enabled_fields is None or "Letterer" in enabled_fields:
        letterer_val = _clean_str(metadata.get("letterer"))
        if letterer_val:
            ET.SubElement(root, "Letterer").text = letterer_val
            
    # 6. CoverArtist
    if enabled_fields is None or "CoverArtist" in enabled_fields:
        cover_val = _clean_str(metadata.get("cover_artist") or metadata.get("coverArtist"))
        if cover_val:
            ET.SubElement(root, "CoverArtist").text = cover_val
            
    # 7. Editor
    if enabled_fields is None or "Editor" in enabled_fields:
        editor_val = _clean_str(metadata.get("editor"))
        if editor_val:
            ET.SubElement(root, "Editor").text = editor_val
            
    # 8. Genre
    if enabled_fields is None or "Genre" in enabled_fields:
        genre_val = _clean_str(metadata.get("genres") or metadata.get("genre"))
        if genre_val:
            ET.SubElement(root, "Genre").text = genre_val
            
    # 9. PageCount
    if enabled_fields is None or "PageCount" in enabled_fields:
        pages_val = _clean_str(metadata.get("pages") or metadata.get("page_count") or metadata.get("pageCount"))
        if pages_val:
            ET.SubElement(root, "PageCount").text = pages_val
            
    # 10. Characters
    if enabled_fields is None or "Characters" in enabled_fields:
        char_val = _clean_str(metadata.get("characters"))
        if char_val:
            ET.SubElement(root, "Characters").text = char_val
            
    # 11. Teams
    if enabled_fields is None or "Teams" in enabled_fields:
        teams_val = _clean_str(metadata.get("teams"))
        if teams_val:
            ET.SubElement(root, "Teams").text = teams_val
            
    # 12. Locations
    if enabled_fields is None or "Locations" in enabled_fields:
        loc_val = _clean_str(metadata.get("locations"))
        if loc_val:
            ET.SubElement(root, "Locations").text = loc_val

    # Metadata tracker tag
    src_url = _clean_str(metadata.get("source_url") or metadata.get("source") or "Unknown")
    existing_notes = _clean_str(metadata.get("notes"))
    notes_val = f"Tagged automatically via Tag Comics Now!. Source: {src_url}"
    if existing_notes:
        notes_val = f"{existing_notes}\n{notes_val}"
    ET.SubElement(root, "Notes").text = notes_val

    # Pretty print XML
    xml_str = ET.tostring(root, encoding="utf-8")
    parsed_xml = minidom.parseString(xml_str)
    return parsed_xml.toprettyxml(indent="  ")

def sidecar_path_for(file_path):
    """Return the adjacent ComicInfo.xml sidecar path for a comic file."""
    base, _ext = os.path.splitext(file_path)
    return base + ".ComicInfo.xml"


def write_comic_info_sidecar(file_path, xml_str):
    """
    Write ComicInfo.xml to an external file adjacent to the comic
    (e.g. 'My Comic.cbz' -> 'My Comic.ComicInfo.xml'), leaving the archive untouched.
    """
    out_path = sidecar_path_for(file_path)
    print(f"[*] Writing external sidecar {os.path.basename(out_path)}...")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(xml_str)
    print("[+] External ComicInfo.xml sidecar written successfully!")


def write_comic_info(file_path, xml_str, storage_mode="archive"):
    """
    Dispatch ComicInfo.xml writing based on the shared storage mode.
    'sidecar' -> external adjacent file only (archive untouched).
    anything else ('archive', etc.) -> embedded inside the CBZ.
    """
    if storage_mode == "sidecar":
        write_comic_info_sidecar(file_path, xml_str)
    else:
        write_comic_info_to_cbz(file_path, xml_str)


def write_comic_info_to_cbz(cbz_path, xml_str):
    """
    Appends or updates the ComicInfo.xml file directly inside the CBZ archive
    using raw block copying to bypass decompression/recompression.
    """
    print(f"[*] Writing ComicInfo.xml to {os.path.basename(cbz_path)}...")
    temp_cbz = cbz_path + ".tmp"
    
    try:
        with zipfile.ZipFile(cbz_path, 'r') as yin:
            with zipfile.ZipFile(temp_cbz, 'w', compression=yin.compression) as yout:
                # Sort entries sequentially by header_offset
                infos = sorted(yin.infolist(), key=lambda x: x.header_offset)
                
                for i, entry in enumerate(infos):
                    if entry.filename == "ComicInfo.xml":
                        continue
                    
                    start = entry.header_offset
                    end = infos[i + 1].header_offset if i + 1 < len(infos) else yin.start_dir
                    
                    # Read and write raw compressed bytes
                    yin.fp.seek(start)
                    data = yin.fp.read(end - start)
                    
                    new_offset = yout.fp.tell()
                    yout.fp.write(data)
                    
                    # Update metadata offset and central directory lists
                    entry.header_offset = new_offset
                    yout.filelist.append(entry)
                    yout.NameToInfo[entry.filename] = entry
                
                # Reposition write pointer for writing the updated XML entry
                yout.start_dir = yout.fp.tell()
                yout.writestr("ComicInfo.xml", xml_str)
                
        # Replace original file with the updated temp file
        os.replace(temp_cbz, cbz_path)
        print("[+] ComicInfo.xml written successfully! CBZ updated.")
    except Exception as e:
        if os.path.exists(temp_cbz):
            os.remove(temp_cbz)
        print(f"[-] Error writing XML to CBZ: {e}")
        raise e
