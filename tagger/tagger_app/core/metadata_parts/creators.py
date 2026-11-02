"""Creator name cleanup and role disambiguation."""
import re


def clean_author_names(names):
    """
    Filters out generic 'Various' or 'Various Artists' from a list of names.
    Also filters out known corporate/publisher names that sometimes appear in author fields.
    """
    if not names:
        return []

    blocked = [
        "various", "various artists", "various author", "various authors",
        "artists, writers & artisans", "awa studios", "awa publishing",
        "dc comics", "marvel comics", "image comics", "dark horse comics",
        "idw publishing", "dynamite entertainment", "boom! studios",
        "editorial staff", "staff artists", "creative team",
        "add to basket", "reserve in store", "check stock elsewhere",
        "reserve now", "add to wishlist", "buy now", "add to cart",
        "bynicholas hayes", "byted venn", "byjossgarvey"
    ]

    cleaned = []
    for n in names:
        if not n:
            continue
        nl = n.lower().strip()
        if nl in blocked:
            continue
        if nl in ["inc.", "inc", "ltd.", "ltd", "corp.", "corp", "publishing"]:
            continue
        cleaned.append(n)

    return cleaned


def resolve_creator_roles(meta):
    """
    Cleans, disambiguates, and resolves creator roles (writer, penciller, inker, colorist, letterer, cover_artist)
    across metadata dictionaries.
    """
    if not isinstance(meta, dict):
        return meta

    def _to_name_list(val):
        if not val:
            return []
        if isinstance(val, (list, tuple, set)):
            items = val
        elif isinstance(val, str):
            items = [val]
        else:
            return []
        names = []
        for item in items:
            for part in re.split(r'[,;&]|\s+and\s+', str(item)):
                p = part.strip()
                if p and not any(p.lower() == n.lower() for n in names):
                    names.append(p)
        return names

    writers = _to_name_list(meta.get("writer") or meta.get("Writer"))
    pencillers = _to_name_list(meta.get("penciller") or meta.get("Penciller"))
    inkers = _to_name_list(meta.get("inker") or meta.get("Inker"))
    colorists = _to_name_list(meta.get("colorist") or meta.get("Colorist"))
    letterers = _to_name_list(meta.get("letterer") or meta.get("Letterer"))
    cover_artists = _to_name_list(meta.get("cover_artist") or meta.get("CoverArtist") or meta.get("coverArtist"))
    authors = _to_name_list(meta.get("authors") or meta.get("Authors"))

    desc = meta.get("description") or meta.get("Description") or meta.get("summary") or meta.get("Summary") or ""
    if desc:
        w_pattern = r'\b(?:writer|written by|script(?: by)?)\s+([A-Z][a-zA-Z\.\'\-\s]+?)(?=\s*[\(\,\.\n]| and | & | artist | while |\bjoins\b|\btest\b|$)'
        a_pattern = r'\b(?:artist|art by|illustrated by|drawn by|penciller|penciler)\s+([A-Z][a-zA-Z\.\'\-\s]+?)(?=\s*[\(\,\.\n]| and | & | writer | while |\bjoins\b|\btest\b|\bexplore\b|$)'
        c_pattern = r'\b(?:colorist|colors by|colourist|colours by)\s+([A-Z][a-zA-Z\.\'\-\s]+?)(?=\s*[\(\,\.\n]| and | & |\bjoins\b|$)'
        l_pattern = r'\b(?:letterer|letters by)\s+([A-Z][a-zA-Z\.\'\-\s]+?)(?=\s*[\(\,\.\n]| and | & |\bjoins\b|$)'

        all_pool = writers + pencillers + inkers + colorists + letterers + cover_artists + authors

        for m in re.finditer(w_pattern, desc, re.I):
            matched = m.group(1).strip()
            cand = next((n for n in all_pool if n.lower() == matched.lower()), matched)
            if not any(cand.lower() == w.lower() for w in writers):
                writers.append(cand)

        for m in re.finditer(a_pattern, desc, re.I):
            matched = m.group(1).strip()
            cand = next((n for n in all_pool if n.lower() == matched.lower()), matched)
            if not any(cand.lower() == p.lower() for p in pencillers):
                pencillers.append(cand)

        for m in re.finditer(c_pattern, desc, re.I):
            matched = m.group(1).strip()
            cand = next((n for n in all_pool if n.lower() == matched.lower()), matched)
            if not any(cand.lower() == c.lower() for c in colorists):
                colorists.append(cand)

        for m in re.finditer(l_pattern, desc, re.I):
            matched = m.group(1).strip()
            cand = next((n for n in all_pool if n.lower() == matched.lower()), matched)
            if not any(cand.lower() == l.lower() for l in letterers):
                letterers.append(cand)

    known_artists = set(p.lower() for p in pencillers + inkers + colorists + letterers + cover_artists)

    if not writers and authors:
        writers = [a for a in authors if a.lower() not in known_artists]
        if not writers:
            if len(authors) == 2 and not pencillers:
                writers = [authors[0]]
                pencillers = [authors[1]]
                known_artists.add(authors[1].lower())
            else:
                writers = list(authors)

    if len(writers) > 1 and known_artists:
        filtered = [w for w in writers if w.lower() not in known_artists]
        if filtered:
            writers = filtered

    series_title = str(meta.get("series") or meta.get("Series") or "").strip()
    _BLURB_WORDS = {
        'comes', 'from', 'presents', 'present', 'returns', 'brings', 'featuring',
        'introducing', 'available', 'now', 'out', 'series', 'issue', 'edition',
        'preview', 'exclusive', 'collects', 'collecting', 'includes', 'story',
        'stories', 'graphic', 'novel', 'volume', 'vol', 'page', 'pages', 'script'
    }

    def _is_creator_name(name):
        n = (name or '').strip()
        if len(n) < 2:
            return False
        words = n.split()
        if len(words) > 4:
            return False
        lowered = {re.sub(r'[^a-z]', '', w.lower()) for w in words}
        if lowered & _BLURB_WORDS:
            return False
        if series_title and series_title.lower() in n.lower() and n.lower() != series_title.lower():
            return False
        return True

    writers = [w for w in writers if _is_creator_name(w)]
    pencillers = [p for p in pencillers if _is_creator_name(p)]
    inkers = [i for i in inkers if _is_creator_name(i)]
    colorists = [c for c in colorists if _is_creator_name(c)]
    letterers = [l for l in letterers if _is_creator_name(l)]
    cover_artists = [ca for ca in cover_artists if _is_creator_name(ca)]
    authors = [a for a in authors if _is_creator_name(a)]

    meta["writer"] = ", ".join(writers) if writers else ""
    meta["penciller"] = ", ".join(pencillers) if pencillers else ""
    meta["inker"] = ", ".join(inkers) if inkers else ""
    meta["colorist"] = ", ".join(colorists) if colorists else ""
    meta["letterer"] = ", ".join(letterers) if letterers else ""
    meta["cover_artist"] = ", ".join(cover_artists) if cover_artists else ""
    meta["authors"] = authors or writers

    if "Writer" in meta or writers:
        meta["Writer"] = meta["writer"]
    if "Penciller" in meta or pencillers:
        meta["Penciller"] = meta["penciller"]
    if "Inker" in meta or inkers:
        meta["Inker"] = meta["inker"]
    if "Colorist" in meta or colorists:
        meta["Colorist"] = meta["colorist"]
    if "Letterer" in meta or letterers:
        meta["Letterer"] = meta["letterer"]
    if "CoverArtist" in meta or cover_artists:
        meta["CoverArtist"] = meta["cover_artist"]
    return meta
