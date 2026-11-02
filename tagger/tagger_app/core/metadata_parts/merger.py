"""Multi-source metadata field synthesis and merging."""
import re
from tagger_app.core.metadata_parts.publishers import (
    normalize_publisher,
    is_foreign_publisher,
    clean_description,
)
from tagger_app.core.metadata_parts.creators import (
    clean_author_names,
    resolve_creator_roles,
)
from tagger_app.core.metadata_parts.titles import (
    clean_format_and_edition,
    is_title_same_as_series,
    normalize_metadata,
)
from tagger_app.core.metadata_parts.scoring import score_description_quality


def merge_best_metadata_fields(candidates_data: list, existing_meta: dict = None, codex: list = None) -> dict:
    """
    Evaluates and synthesizes the highest-quality value for every metadata field individually
    across all matching candidates from multiple sources.
    """
    if not candidates_data:
        return normalize_metadata(dict(existing_meta or {}), codex=codex)

    norm_candidates = []
    for item in candidates_data:
        if isinstance(item, tuple) and len(item) >= 2:
            m = item[0]
            s = item[1]
            src = (m.get("source_url") if isinstance(m, dict) and m.get("source_url") else None) or (item[2] if len(item) > 2 else "Unknown")
        elif isinstance(item, dict):
            m = item.get("metadata") if "metadata" in item and isinstance(item["metadata"], dict) else item
            s = item.get("score", 0.0)
            if s > 1.0:
                s /= 100.0
            src = item.get("matching_url") or (m.get("source_url") if isinstance(m, dict) and m.get("source_url") else None) or item.get("source") or "Unknown"
        else:
            continue

        if not m or not isinstance(m, dict):
            continue

        src_str = str(src or "")
        src_lower = src_str.lower()
        is_comic_db = any(k in src_lower for k in [
            "comicvine", "metron", "gcd", "grandcomicsdatabase", "leagueofcomicgeeks", "lcg"
        ])

        norm_candidates.append({
            "meta": dict(m),
            "score": float(s),
            "source": src_str,
            "is_comic_db": is_comic_db
        })

    if not norm_candidates:
        return normalize_metadata(dict(existing_meta or {}), codex=codex)

    norm_candidates.sort(key=lambda x: x["score"], reverse=True)
    primary = norm_candidates[0]
    result = dict(primary["meta"])

    contributing_sources = []
    if primary["source"]:
        contributing_sources.append(primary["source"])

    def _add_source(src_val):
        if src_val and src_val not in contributing_sources:
            contributing_sources.append(src_val)

    def _split_items(val):
        if not val:
            return []
        if isinstance(val, (list, tuple, set)):
            raw_list = val
        elif isinstance(val, str):
            raw_list = [val]
        else:
            return []
        items = []
        for x in raw_list:
            for part in re.split(r'[,;&]|\s+and\s+', str(x)):
                p = part.strip()
                if p and not any(p.lower() == existing.lower() for existing in items):
                    items.append(p)
        return items

    # 2. Series & Issue Number & Volume
    best_series = clean_format_and_edition(result.get("series") or "")
    if not best_series:
        for c in norm_candidates:
            s_cand = clean_format_and_edition(c["meta"].get("series") or "")
            if s_cand:
                best_series = s_cand
                _add_source(c["source"])
                break
    result["series"] = best_series

    best_num = result.get("number") or result.get("issue_number")
    if not best_num:
        for c in norm_candidates:
            n_cand = c["meta"].get("number") or c["meta"].get("issue_number")
            if n_cand:
                best_num = str(n_cand).strip()
                _add_source(c["source"])
                break
    if best_num:
        result["number"] = str(best_num)
        result["issue_number"] = str(best_num)

    if not result.get("volume"):
        for c in norm_candidates:
            v_cand = c["meta"].get("volume")
            if v_cand:
                result["volume"] = str(v_cand).strip()
                _add_source(c["source"])
                break

    # 3. Title / Issue Title
    current_issue_title = clean_format_and_edition(result.get("issue_title") or result.get("title") or "")
    if is_title_same_as_series(current_issue_title, best_series):
        current_issue_title = ""

    if not current_issue_title:
        for c in norm_candidates:
            c_title = clean_format_and_edition(c["meta"].get("issue_title") or c["meta"].get("title") or "")
            if c_title and not is_title_same_as_series(c_title, best_series):
                current_issue_title = c_title
                _add_source(c["source"])
                break

    result["issue_title"] = current_issue_title
    result["title"] = current_issue_title

    # 4. Description
    best_desc = ""
    best_desc_score = -1.0
    best_desc_src = None

    for c in norm_candidates:
        d = c["meta"].get("description") or c["meta"].get("summary") or ""
        q = score_description_quality(d)
        if q > best_desc_score:
            best_desc_score = q
            best_desc = clean_description(d)
            best_desc_src = c["source"]

    if best_desc:
        result["description"] = best_desc
        result["summary"] = best_desc
        if best_desc_src:
            _add_source(best_desc_src)

    # 5. Creators
    creator_roles = ["writer", "penciller", "inker", "colorist", "letterer", "cover_artist", "editor"]
    for role in creator_roles:
        existing_creators = clean_author_names(_split_items(result.get(role)))

        for c in norm_candidates:
            c_creators = clean_author_names(_split_items(c["meta"].get(role)))
            if not c_creators and role == "cover_artist":
                c_creators = clean_author_names(_split_items(c["meta"].get("CoverArtist") or c["meta"].get("coverArtist")))

            for person in c_creators:
                if not any(person.lower() == ec.lower() for ec in existing_creators):
                    existing_creators.append(person)
                    _add_source(c["source"])

        result[role] = ", ".join(existing_creators) if existing_creators else ""

    all_authors = clean_author_names(_split_items(result.get("authors")))
    for c in norm_candidates:
        c_authors = clean_author_names(_split_items(c["meta"].get("authors")))
        for a in c_authors:
            if not any(a.lower() == ea.lower() for ea in all_authors):
                all_authors.append(a)
    result["authors"] = all_authors
    result = resolve_creator_roles(result)

    # 6. Publisher
    best_pub = normalize_publisher(result.get("publisher"), codex=codex)
    if not best_pub or is_foreign_publisher(best_pub, codex=codex):
        found_pub = False
        for is_cdb_pass in (True, False):
            if found_pub:
                break
            for c in norm_candidates:
                if c["is_comic_db"] == is_cdb_pass:
                    p_cand = normalize_publisher(c["meta"].get("publisher"), codex=codex)
                    if p_cand and not is_foreign_publisher(p_cand, codex=codex):
                        best_pub = p_cand
                        _add_source(c["source"])
                        found_pub = True
                        break
    result["publisher"] = best_pub

    # 7. Dates
    best_date_str = ""
    best_year = result.get("year")
    best_month = result.get("month")
    best_day = result.get("day")

    for c in norm_candidates:
        d_cand = str(c["meta"].get("publish_date") or c["meta"].get("cover_date") or "").strip()
        m_full = re.search(r'\b((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b', d_cand)
        if m_full:
            best_year = m_full.group(1)
            best_month = str(int(m_full.group(2)))
            best_day = str(int(m_full.group(3)))
            best_date_str = f"{best_year}-{int(best_month):02d}-{int(best_day):02d}"
            _add_source(c["source"])
            break

    if not best_date_str:
        for c in norm_candidates:
            d_cand = str(c["meta"].get("publish_date") or c["meta"].get("cover_date") or "").strip()
            m_ym = re.search(r'\b((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])\b', d_cand)
            if m_ym:
                best_year = m_ym.group(1)
                best_month = str(int(m_ym.group(2)))
                best_date_str = f"{best_year}-{int(best_month):02d}"
                _add_source(c["source"])
                break

    if not best_year:
        for c in norm_candidates:
            y_cand = c["meta"].get("year")
            if y_cand and re.match(r'^(?:19|20)\d{2}$', str(y_cand).strip()):
                best_year = str(y_cand).strip()
                _add_source(c["source"])
                break

    if best_year:
        result["year"] = str(best_year)
    if best_month:
        result["month"] = str(best_month)
    if best_day:
        result["day"] = str(best_day)
    if best_date_str:
        result["publish_date"] = best_date_str

    # 8. Lore: Characters, Teams, Locations
    for lore_field in ["characters", "teams", "locations"]:
        lore_items = _split_items(result.get(lore_field))
        for c in norm_candidates:
            c_items = _split_items(c["meta"].get(lore_field))
            for item in c_items:
                if not any(item.lower() == li.lower() for li in lore_items):
                    lore_items.append(item)
                    _add_source(c["source"])
        result[lore_field] = ", ".join(lore_items) if lore_items else ""

    # 9. Genres
    genres = [g for g in _split_items(result.get("genres") or result.get("genre")) if g.lower() not in ["comic", "comics"]]
    for c in norm_candidates:
        c_genres = _split_items(c["meta"].get("genres") or c["meta"].get("genre"))
        for g in c_genres:
            if g.lower() not in ["comic", "comics"] and not any(g.lower() == eg.lower() for eg in genres):
                genres.append(g)
                _add_source(c["source"])
    result["genres"] = genres

    # 10. Pages / Page Count
    if not result.get("pages"):
        for c in norm_candidates:
            p_val = c["meta"].get("pages") or c["meta"].get("page_count") or c["meta"].get("pageCount")
            if p_val and str(p_val).isdigit() and int(p_val) > 0:
                result["pages"] = str(p_val)
                _add_source(c["source"])
                break

    # 11. ISBN / GTIN
    if not result.get("isbn"):
        for c in norm_candidates:
            isbn_val = c["meta"].get("isbn") or c["meta"].get("gtin")
            if isbn_val:
                clean_isbn = re.sub(r'[^0-9X]', '', str(isbn_val).upper())
                if len(clean_isbn) in (10, 13):
                    result["isbn"] = str(isbn_val).strip()
                    _add_source(c["source"])
                    break

    # 12. Format clean source URLs / labels
    clean_sources = []
    for s in contributing_sources:
        s_clean = s
        if s.startswith("http"):
            parts = s.split("/")
            if len(parts) > 2:
                s_clean = parts[2].replace("www.", "")
        if s_clean and s_clean not in clean_sources:
            clean_sources.append(s_clean)
    result["source_url"] = ", ".join(clean_sources)

    # 13. Existing metadata preservation
    if existing_meta and isinstance(existing_meta, dict):
        if existing_meta.get("notes"):
            result["notes"] = existing_meta["notes"]

    return normalize_metadata(result, codex=codex)
