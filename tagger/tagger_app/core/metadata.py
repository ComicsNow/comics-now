"""Metadata shaping helpers: author-name cleanup, normalization, fuzzy similarity.

Extracted from the legacy tagger.py monolith (architecture review, step 1).
"""
import re
import difflib


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
        if not n: continue
        nl = n.lower().strip()
        # Filter exact matches in blocked list
        if nl in blocked:
            continue
        # Filter names that are just corporate suffixes
        if nl in ["inc.", "inc", "ltd.", "ltd", "corp.", "corp", "publishing"]:
            continue
        cleaned.append(n)
        
    return cleaned


def clean_format_and_edition(text: str) -> str:
    """
    Strips edition/format tags (e.g. TP, HB, TPB, HC, SC, GN, Paperback, Hardcover,
    Hardback, Softcover, Trade Paperback, Digital Edition, etc.) from titles and series.
    """
    if not text:
        return ""
    s = str(text)

    # 1. Bracketed format/edition tags: (TPB), [HC], (Paperback), (digital), {HB}, etc.
    bracket_pattern = re.compile(
        r'[\(\[\{]\s*(?:(?:the|a|an)\s+)?(?:trade\s+paperback|digital(?:\s+edition)?|paperback(?:\s*\/\s*softback)?|hardcover|hardback(?:\s*\/\s*hardcover)?|softcover|graphic\s+novel|tpb|tp|hb|hc|sc|gn)\s*[\)\]\}]',
        re.IGNORECASE
    )
    s = bracket_pattern.sub(' ', s)

    # 2. Delimited format tokens: " - TPB", " TPB", " HC", " - Hardcover", ": A Graphic Novel", etc.
    format_tokens_pattern = re.compile(
        r'(?:^|[\s,:;/|\-\u2010-\u2015]+)(?:(?:the|a|an)\s+)?(?:trade\s+paperback|digital\s+edition|paperback(?:\s*\/\s*softback)?|hardcover|hardback(?:\s*\/\s*hardcover)?|softcover|graphic\s+novel|tpb|tp|hb|hc|sc|gn)(?=$|[\s,:;/|\-\u2010-\u2015]+$|[\s,:;/|\-\u2010-\u2015]*[\(\[\{]|[\s,:;/|\-\u2010-\u2015]+(?:v(?:ol)?\.?\s*\d+|#\d+|\bpart\b|\bbook\b|\bvolume\b)|[\s,:;/|\-\u2010-\u2015]+(?=[\-_/|:,;]))',
        re.IGNORECASE
    )
    s = format_tokens_pattern.sub(' ', s)

    # 3. Trailing digital indicator: " - digital" or ", digital" at end of string or before brackets
    trailing_digital_pattern = re.compile(
        r'[\s,:;/|\-\u2010-\u2015]+digital(?=$|[\s,:;/|\-\u2010-\u2015]+$|[\s,:;/|\-\u2010-\u2015]*[\(\[\{])',
        re.IGNORECASE
    )
    s = trailing_digital_pattern.sub(' ', s)

    # 4. Remove empty brackets () [] {}
    s = re.sub(r'[\(\[\{]\s*[\)\]\}]', ' ', s)

    # 5. Clean whitespace & trailing/leading/repeated delimiters
    s = re.sub(r'\s*[:;\-–—|/,]+\s*[:;\-–—|/,]+', ' - ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    s = s.rstrip(' ,:;/|-–—\u2010\u2011\u2012\u2013\u2014\u2015').strip()
    s = s.lstrip(' ,:;/|-–—\u2010\u2011\u2012\u2013\u2014\u2015').strip()
    return s


def is_title_same_as_series(title: str, series: str) -> bool:
    """
    Determines whether a title is redundant with the series name.
    If Title is the same as Series (even with issue numbers, `#3`, ` 3`, volume suffixes, or format tags),
    Title must be left blank.
    """
    if not title:
        return False
    t_raw = clean_format_and_edition(str(title)).strip()
    if not t_raw:
        return True  # Title was just a format tag (e.g. "HC", "TPB") -> blank it!

    if not series:
        return False
    s_raw = clean_format_and_edition(str(series)).strip()
    if not s_raw:
        return False

    if t_raw.lower() == s_raw.lower():
        return True

    # Direct regex check on raw strings
    escaped_s = re.escape(s_raw)
    direct_pattern = (
        rf"^{escaped_s}[:\s\-_–—]*(?:#|(?:issue|no\.?|vol(?:ume)?\.?|pt\.?|part|book|bk\.?)\s*#?)?\s*"
        rf"\d+(?:\s*(?:of|\/)\s*\d+)?\s*(?:\(\d{{4}}\))?\s*[)\]}}]*$"
    )
    if re.match(direct_pattern, t_raw, re.IGNORECASE):
        return True

    # Normalized alphanumeric comparison
    norm_s = re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", s_raw.lower())).strip()
    norm_t = re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", t_raw.lower())).strip()
    if not norm_s or not norm_t:
        return False

    if norm_t == norm_s:
        return True

    if norm_t.startswith(norm_s):
        rem = norm_t[len(norm_s):].strip()
        if re.match(r"^(?:#|(?:issue|no|vol|volume|pt|part|book|bk)\s*#?)?\s*\d+(?:\s*(?:of|\/)\s*\d+)?(?:\s*\d{4})?$", rem, re.IGNORECASE):
            return True

    if norm_s.startswith(norm_t):
        rem = norm_s[len(norm_t):].strip()
        if re.match(r"^(?:#|(?:issue|no|vol|volume|pt|part|book|bk)\s*#?)?\s*\d+(?:\s*(?:of|\/)\s*\d+)?(?:\s*\d{4})?$", rem, re.IGNORECASE):
            return True

    return False


CANONICAL_PUBLISHER_MAP = {
    "dc": "DC Comics",
    "dc comics": "DC Comics",
    "dc universe": "DC Comics",
    "dc black label": "DC Comics",
    "vertigo": "DC Comics",
    "image": "Image",
    "image comics": "Image",
    "imagev comics": "Image",
    "image comics inc": "Image",
    "image comics, inc": "Image",
    "image comics, inc.": "Image",
    "marvel": "Marvel",
    "marvel comics": "Marvel",
    "dark horse": "Dark Horse Comics",
    "dark horse comics": "Dark Horse Comics",
    "dark horse books": "Dark Horse Comics",
    "idw": "IDW Publishing",
    "idw publishing": "IDW Publishing",
    "boom!": "Boom! Studios",
    "boom! studios": "Boom! Studios",
    "boom studios": "Boom! Studios",
    "oni press": "Oni Press",
    "oni": "Oni Press",
    "fantagraphics": "Fantagraphics",
    "fantagraphics books": "Fantagraphics",
    "dynamite": "Dynamite Entertainment",
    "dynamite entertainment": "Dynamite Entertainment",
    "papercutz": "Papercutz",
    "europe comics": "Europe Comics",
    "cinebook": "Cinebook",
    "aftershock": "Aftershock Comics",
    "aftershock comics": "Aftershock Comics",
    "humanoids": "Humanoids",
    "humanoids inc": "Humanoids",
    "humanoids, inc": "Humanoids",
    "humanoids, inc.": "Humanoids",
    "les humanoides associes": "Les Humanoïdes Associés",
    "les humanoïdes associés": "Les Humanoïdes Associés",
    "top shelf": "Top Shelf",
    "top shelf productions": "Top Shelf",
    "panini": "Panini Comics",
    "panini comics": "Panini Comics",
    "panini verlag": "Panini Verlag",
    "rebellion": "Rebellion",
    "rebellion / 2000ad": "Rebellion",
    "2000 ad": "Rebellion",
    "2000ad": "Rebellion",
    "2000ad / rebellion": "Rebellion",
    "titan": "Titan Books",
    "titan books": "Titan Books",
    "titan comics": "Titan Comics",
    "vault": "Vault Comics",
    "vault comics": "Vault Comics",
    "scout": "Scout Comics",
    "scout comics": "Scout Comics",
    "mad cave": "Mad Cave Studios",
    "mad cave studios": "Mad Cave Studios",
    "ablaze": "Ablaze",
    "ablaze publishing": "Ablaze",
    "ahoy": "Ahoy Comics",
    "ahoy comics": "Ahoy Comics",
}


def normalize_publisher(publisher_name: str, codex=None) -> str:
    """
    Normalizes publisher names using a canonical mapping and optional DB publisher codex.
    E.g. 'DC' -> 'DC Comics', 'imagev comics' -> 'Image', 'Oni Press,US' -> 'Oni Press'.
    """
    if not publisher_name:
        return ""
    raw = str(publisher_name).strip()
    raw = re.sub(r'[\"\'\`]', '', raw).strip()
    if not raw or raw.lower() == "unknown publisher":
        return raw

    # Strip country/corporate suffixes (e.g. ',US', ', U.S.', ', Inc.', ' Ltd', etc.)
    stripped = re.sub(
        r'[\s,]+(?:US|U\.S\.|USA|U\.S\.A\.|UK|U\.K\.|GB|France|Germany|Spain|Italy|Inc\.?|LLC\.?|Ltd\.?|Limited)$',
        '',
        raw,
        flags=re.IGNORECASE
    ).strip()

    raw_lower = raw.lower()
    stripped_lower = stripped.lower()

    # 1. Canonical map direct check
    if raw_lower in CANONICAL_PUBLISHER_MAP:
        return CANONICAL_PUBLISHER_MAP[raw_lower]
    if stripped_lower in CANONICAL_PUBLISHER_MAP:
        return CANONICAL_PUBLISHER_MAP[stripped_lower]

    # 2. Database codex matching (if provided)
    if codex:
        codex_map = {c.lower(): c for c in codex if c and str(c).strip() and str(c) != 'Unknown Publisher'}
        if raw_lower in codex_map:
            return codex_map[raw_lower]
        if stripped_lower in codex_map:
            return codex_map[stripped_lower]

        # Suffix-trimmed codex check (e.g. if codex has 'Top Shelf' and input is 'Top Shelf Productions')
        stem_stripped = re.sub(
            r'[\s,]+(?:Publishing|Comics|Press|Books|Studios|Entertainment|Productions)$',
            '',
            stripped,
            flags=re.IGNORECASE
        ).strip()
        stem_lower = stem_stripped.lower()
        if stem_lower in codex_map:
            return codex_map[stem_lower]

    return stripped


# Common English words used for language safeguard heuristic
COMMON_ENGLISH_WORDS = {
    "the", "and", "of", "to", "in", "a", "is", "that", "for", "it", "as", "was",
    "with", "on", "by", "at", "from", "this", "but", "his", "they", "her", "she",
    "or", "an", "will", "my", "one", "all", "would", "there", "their", "what", "so",
    "up", "out", "if", "about", "who", "get", "which", "go", "me", "when", "make",
    "can", "like", "time", "no", "just", "him", "know", "take", "people", "into",
    "year", "your", "good", "some", "could", "them", "see", "other", "than", "then",
    "now", "look", "only", "come", "its", "over", "think", "also", "back", "after",
    "use", "two", "how", "our", "work", "first", "well", "way", "even", "new",
    "want", "because", "any", "these", "give", "day", "most", "us", "he", "has",
    "had", "comic", "comics", "series", "story", "stories", "issue", "issues", "hero",
    "batman", "superman", "spider", "man", "world", "earth", "city", "life", "death",
    "collects", "collecting", "edition", "graphic", "novel", "written", "illustrated"
}

# Distinctive foreign words that rarely/never appear in English comic descriptions
COMMON_FOREIGN_WORDS = {
    # German
    "der", "die", "das", "und", "den", "von", "mit", "sich", "des", "auf", "für",
    "ist", "im", "dem", "nicht", "ein", "eine", "einer", "einem", "einen", "als",
    "auch", "es", "an", "werden", "aus", "hat", "dass", "daß", "nach", "wird",
    "bei", "um", "am", "sind", "noch", "wie", "über", "war", "haben", "nur",
    "oder", "aber", "vor", "zur", "bis", "mehr", "durch", "sein", "wurde",
    "sammelband", "ausgabe", "enthält", "abenteuer", "deutschland",
    # French
    "le", "la", "les", "des", "du", "une", "dans", "par", "sur", "avec", "qui",
    "que", "est", "son", "sa", "ses", "aux", "au", "se", "pas", "plus", "ont",
    "tome", "bande", "dessinée", "dessinee", "intégrale", "integrale", "réunit", "reunit", "histoire",
    # Spanish
    "los", "las", "del", "una", "unos", "unas", "para", "por", "con", "que",
    "su", "sus", "al", "más", "mas", "este", "esta", "estos", "estas", "tomo",
    "contiene", "recopila", "número", "numero", "historia", "cómic", "comic", "edición", "edicion",
    # Italian
    "gli", "dello", "della", "dei", "degli", "delle", "uno", "per", "con", "su",
    "da", "che", "più", "piu", "questo", "questa", "questi", "queste", "contiene", "albo",
    # Portuguese
    "das", "uma", "uns", "umas", "no", "na", "nos", "nas", "por", "para", "com",
    "não", "nao", "mais", "edição", "edicao"
}

IGNORED_FOREIGN_PUBLISHERS = {
    "panini", "panini comics", "panini verlag", "panini españa", "panini espana",
    "panini france", "panini brasil", "panini spa", "panini uk", "panini manga",
    "panini comics (france)", "panini comics (germany)", "panini comics (italy)",
    "panini comics (spain)", "planeta deagostini", "planeta cómic", "planeta comic",
    "editorial planeta deagostini", "editorial televisa", "televisa", "abril",
    "editora abril", "dino comics", "urban comics", "ecc ediciones", "ecc",
    "egmont", "egmont ehapa",
    "semic", "edizioni bd", "rw edizioni", "salvat",
    "editorial salvat", "eaglemoss", "carlsen", "carlsen verlag", "glénat",
    "glenat"
}


def is_foreign_publisher(publisher_name: str, codex=None) -> bool:
    """Returns True if the publisher is a known foreign reprint publisher to avoid."""
    if not publisher_name:
        return False
    raw = str(publisher_name).lower().strip()
    raw = re.sub(r'[\"\'\`]', '', raw).strip()
    if not raw:
        return False

    # If this publisher exists in the user's library codex, do not treat as ignored
    if codex:
        codex_set = {str(c).lower().strip() for c in codex if c and str(c).strip() and str(c) != 'Unknown Publisher'}
        if raw in codex_set:
            return False

    if raw in IGNORED_FOREIGN_PUBLISHERS:
        return True
    for fp in IGNORED_FOREIGN_PUBLISHERS:
        if raw == fp or raw.startswith(fp + ' ') or raw.endswith(' ' + fp) or f' {fp} ' in f' {raw} ':
            return True
    return False


def is_english_text(text: str) -> bool:
    """
    Heuristic check to determine if text is in English or foreign language.
    Returns True for English or short text, False for detected non-English descriptions.
    """
    if not text:
        return True
    clean = re.sub(r'<[^<>]+>', ' ', str(text))
    words = [w.lower() for w in re.findall(r'\b[a-zA-Z\u00C0-\u017F]+\b', clean)]
    if len(words) < 5:
        return True

    eng_count = sum(1 for w in words if w in COMMON_ENGLISH_WORDS)
    foreign_count = sum(1 for w in words if w in COMMON_FOREIGN_WORDS)

    if foreign_count >= 2 and foreign_count > eng_count:
        return False
    if eng_count == 0 and foreign_count >= 2:
        return False
    return True


def clean_description(desc: str) -> str:
    """
    Sanitizes book/comic descriptions:
    - Strips specification table dumps (ISBN, Number of pages, Dimensions, Weight, Language).
    - Strips bookstore promo/ad text mentioning Waterstones, Blackwell's, e-commerce buttons.
    - Strips boilerplate 'Read reviews and discussion of...' lines.
    - Strips leading labels (Summary:, Synopsis:, Description:, etc.).
    - Discards non-English descriptions.
    - Returns empty string if resulting description is empty or placeholder text.
    """
    if not desc:
        return ""
    s = str(desc)

    # 1. Strip HTML tags and normalize entities
    s = re.sub(r'<[^<>]+>', ' ', s)
    _entity_map = {'&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&'}
    s = re.sub(r'&(?:quot|#39|lt|gt|amp);', lambda m: _entity_map.get(m.group(0), m.group(0)), s)

    # 2. Spec table dumps & blocks (glued or line-separated)
    s = re.sub(
        r'(?:Publisher\s+information\s*)?Publisher\s*:\s*[^\n\r]+?(?:ISBN(?:-1[03])?\s*:\s*[\d\-X]+)[^\n\r]*(?:Number of pages|Dimensions|Weight|Language|Publication)[^\n\r]*',
        ' ',
        s,
        flags=re.IGNORECASE
    )
    s = re.sub(
        r'Publisher\s+information[\s\S]*?(?:Language\s*:\s*\w+|Dimensions\s*:\s*[\dx\s\w]+|Weight\s*:\s*[\d\w\s]+|ISBN\s*:\s*[\d\-X]+|Number of pages\s*:\s*\d+)',
        ' ',
        s,
        flags=re.IGNORECASE
    )

    # 3. Strip individual spec lines or tokens
    spec_line_patterns = [
        r'(?:^|[\n\r])\s*(?:Publisher\s+information|Specification|Product Details|Book Details)\s*(?::|$)',
        r'(?:^|[\n\r])\s*Publisher\s*:\s*[^\n\r]+',
        r'(?:^|[\n\r])\s*ISBN(?:-1[03])?\s*:\s*[^\n\r]+',
        r'(?:^|[\n\r])\s*(?:Number of pages|Page count|Pages)\s*:\s*[^\n\r]+',
        r'(?:^|[\n\r])\s*Dimensions\s*:\s*[^\n\r]+',
        r'(?:^|[\n\r])\s*Weight\s*:\s*[^\n\r]+',
        r'(?:^|[\n\r])\s*Language\s*:\s*[^\n\r]+',
        r'(?:^|[\n\r])\s*Format\s*:\s*[^\n\r]+',
        r'(?:^|[\n\r])\s*Dewey\s*(?:edition)?\s*:\s*[^\n\r]+',
        r'(?:^|[\n\r])\s*Illustrations note\s*:\s*[^\n\r]+',
        r'(?:^|[\n\r])\s*Country of Publication\s*:\s*[^\n\r]+',
        r'(?:^|[\n\r])\s*Publication City\/Country\s*:\s*[^\n\r]+',
        r'(?:^|[\n\r])\s*BIC\s*:\s*[^\n\r]+',
        r'(?:^|[\n\r])\s*BISAC\s*:\s*[^\n\r]+',
        r'Item:\s*.*?\|\s*Publisher:\s*.*?\|\s*Cover Artist:.*',
        r'ISBN(?:-1[03])?\s*:\s*[\d\-X]+',
        r'Number of pages\s*:\s*\d+',
        r'Dimensions\s*:\s*\d+\s*x\s*\d+[^\n\r,.]*',
        r'Weight\s*:\s*\d+\s*(?:g|kg|lbs?|oz)',
        r'Language\s*:\s*(?:English|French|German|Spanish|Italian|Japanese)',
        r'Publisher information\s*'
    ]
    for p in spec_line_patterns:
        s = re.sub(p, ' ', s, flags=re.IGNORECASE)

    # 4. Strip bookstore ads and boilerplates
    ad_patterns = [
        r'Read reviews and discussion of\s+.*?(?:from\s+.*?)?(?:published by\s+.*?)(?:\.|$)',
        r'Read reviews and discussion of\s+.*',
        r'(?:Available\s+(?:now\s+)?(?:at|from)|Order\s+(?:now\s+)?(?:at|from|online\s+at)|Buy\s+(?:now\s+)?(?:at|from))\s+(?:Waterstones|Blackwell\'?s?|Amazon|Barnes\s*&\s*Noble)[^\n\r.]*(?:\.|$)?',
        r'Why choose Blackwell\'?s?\??[^\n\r.]*(?:\.|$)?',
        r'Free (?:UK )?delivery on orders over [^\n\r.]*(?:\.|$)?',
        r'(?:Click\s*&\s*Collect|Reserve in store|Add to (?:basket|cart|wishlist|wish list)|Check stock|Check availability)[^\n\r.]*(?:\.|$)?'
    ]
    for p in ad_patterns:
        s = re.sub(p, ' ', s, flags=re.IGNORECASE)

    # 5. Strip prefix labels
    s = re.sub(
        r'^(?:SUMMARY|Summary|PRODUCT DESCRIPTION|Product Description|BOOK DESCRIPTION|Book Description|SYNOPSIS|Synopsis|OVERVIEW|Overview|DESCRIPTION|Description)\s*[:\-–—]\s*',
        '',
        s.strip(),
        flags=re.IGNORECASE
    )

    # 6. Normalize whitespace
    s = re.sub(r'[ \t]+', ' ', s)
    s = re.sub(r'\n\s*\n+', '\n\n', s).strip()

    # 7. Check for placeholder descriptions
    placeholders = {
        'no description available.',
        'no description available',
        'no synopsis available.',
        'no synopsis available',
        'no overview available.',
        'no overview available',
        'no description.',
        'no description',
        'n/a',
        'none'
    }
    if s.lower() in placeholders:
        return ""

    # 8. English language safeguard
    if not is_english_text(s):
        return ""

    return s


VOL_SPLIT_PATTERN = re.compile(
    r'^(?P<series>.+?)[\s,:;\-–—]+\b(?P<vol_token>(?P<vol_prefix>Vol(?:ume|\.)?|Book|Bk\.?|v)\s*0*(?P<vol_num>\d+)(?:(?P<sub_sep>\s*[:\-–—]\s*|\s+)(?P<subtitle>.+))?)$',
    re.IGNORECASE
)

STANDALONE_VOL_PATTERN = re.compile(
    r'^(?P<vol_token>(?P<vol_prefix>Vol(?:ume|\.)?|Book|Bk\.?|v)\s*0*(?P<vol_num>\d+)(?:(?P<sub_sep>\s*[:\-–—]\s*|\s+)(?P<subtitle>.+))?)$',
    re.IGNORECASE
)


def resolve_creator_roles(meta):
    """
    Cleans, disambiguates, and resolves creator roles (writer, penciller, inker, colorist, letterer, cover_artist)
    across metadata dictionaries.

    Prevents:
    1. Generic 'authors' arrays (from book databases like Goodreads, Google Books, Waterstones)
       from blindly dumping artists/colorists into 'writer'.
    2. Duplication where the same person is listed in both 'writer' and 'penciller' when they are only the artist.
    3. Missing pencillers/artists when the summary or byline explicitly identifies them.
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

    writers = _to_name_list(meta.get("writer"))
    pencillers = _to_name_list(meta.get("penciller"))
    inkers = _to_name_list(meta.get("inker"))
    colorists = _to_name_list(meta.get("colorist"))
    letterers = _to_name_list(meta.get("letterer"))
    cover_artists = _to_name_list(meta.get("cover_artist") or meta.get("CoverArtist"))
    authors = _to_name_list(meta.get("authors"))

    desc = meta.get("description") or meta.get("summary") or ""
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

    # If writers is empty and authors exists, populate writers excluding known artists
    if not writers and authors:
        writers = [a for a in authors if a.lower() not in known_artists]
        if not writers:
            if len(authors) == 2 and not pencillers:
                writers = [authors[0]]
                pencillers = [authors[1]]
                known_artists.add(authors[1].lower())
            else:
                writers = list(authors)

    # If multiple writers and any are known artists, prune them from writers as long as at least one writer remains
    if len(writers) > 1 and known_artists:
        filtered = [w for w in writers if w.lower() not in known_artists]
        if filtered:
            writers = filtered

    meta["writer"] = ", ".join(writers) if writers else ""
    meta["penciller"] = ", ".join(pencillers) if pencillers else ""
    meta["inker"] = ", ".join(inkers) if inkers else ""
    meta["colorist"] = ", ".join(colorists) if colorists else ""
    meta["letterer"] = ", ".join(letterers) if letterers else ""
    meta["cover_artist"] = ", ".join(cover_artists) if cover_artists else ""
    meta["authors"] = authors or writers
    return meta


def normalize_metadata(meta, codex=None):
    """
    Cleans and maps metadata fields to ensure they align with the frontend keys
    (e.g., issue_number, issue_title, clean series name, normalized publisher, clean description).
    """
    if not meta:
        return meta

    # 1. Normalize series / title / issue_title & check for volume patterns
    original_series = meta.get("series")
    raw_title = clean_format_and_edition(meta.get("title") or "")
    series = clean_format_and_edition(meta.get("series") or "")
    issue_title = clean_format_and_edition(meta.get("issue_title") or "")

    vol_found = False
    vol_num = None
    extracted_series = None
    formatted_vol_title = None

    # Check series first, then raw_title for "Series Name Vol. X: Subtitle"
    m_vol = VOL_SPLIT_PATTERN.match(series)
    if not m_vol and raw_title:
        m_vol = VOL_SPLIT_PATTERN.match(raw_title)

    if m_vol:
        vol_found = True
        extracted_series = m_vol.group("series").strip()
        prefix = m_vol.group("vol_prefix")
        vol_num = str(int(m_vol.group("vol_num")))
        sub = (m_vol.group("subtitle") or "").strip()
        vol_token = m_vol.group("vol_token").strip()
        if prefix.lower() == "v":
            formatted_vol_title = f"Vol. {vol_num}: {sub}" if sub else f"Volume {vol_num}"
        else:
            formatted_vol_title = vol_token
    else:
        # Check standalone volume pattern on raw_title or issue_title (e.g. "Volume 1")
        m_stand = STANDALONE_VOL_PATTERN.match(raw_title) or (STANDALONE_VOL_PATTERN.match(issue_title) if issue_title else None)
        if m_stand:
            vol_found = True
            prefix = m_stand.group("vol_prefix")
            vol_num = str(int(m_stand.group("vol_num")))
            sub = (m_stand.group("subtitle") or "").strip()
            vol_token = m_stand.group("vol_token").strip()
            if prefix.lower() == "v":
                formatted_vol_title = f"Vol. {vol_num}: {sub}" if sub else f"Volume {vol_num}"
            else:
                formatted_vol_title = vol_token

    if vol_found:
        if extracted_series:
            series = clean_format_and_edition(extracted_series)
        issue_title = formatted_vol_title
        raw_title = formatted_vol_title
        meta["number"] = vol_num
        meta["issue_number"] = vol_num
        meta["volume"] = vol_num
    else:
        # Normalize number / issue_number
        explicit_number = meta.get("number") or meta.get("issue_number")
        if not explicit_number:
            # Try to parse from title, e.g. "Watchmen #1"
            m = re.search(r'#(\d+)\b', raw_title)
            if m:
                explicit_number = m.group(1)
        if explicit_number:
            meta["number"] = str(explicit_number)
            meta["issue_number"] = str(explicit_number)
        else:
            meta["number"] = "1"
            meta["issue_number"] = "1"

        # If title has a dash like "Watchmen #1 - Who Watches the Watchmen"
        if " - " in raw_title and not issue_title:
            parts = raw_title.split(" - ", 1)
            issue_title = clean_format_and_edition(parts[1].strip())

        # If title has a number sign like "Watchmen #1"
        if " #" in raw_title and not series:
            parts = raw_title.split(" #", 1)
            series = clean_format_and_edition(parts[0].strip())
        elif not series:
            series = raw_title

    if not issue_title:
        issue_title = ""

    meta["series"] = series
    meta["issue_title"] = issue_title
    meta["title"] = raw_title

    # Strip issue numbers out of the series name — they belong in number/issue_number only
    series_clean = meta["series"] or ""

    # Always strip unambiguous "#N" patterns (e.g. "Batman #45" → "Batman")
    m_hash = re.search(r'#(\d+)\s*$', series_clean)
    if m_hash:
        if not vol_found and not meta.get("number"):
            meta["number"] = m_hash.group(1)
            meta["issue_number"] = m_hash.group(1)
        series_clean = series_clean[:m_hash.start()].strip()

    # Strip trailing bare digits ONLY when that same number was explicitly set in the
    # source metadata — this protects names like "100 Bullets", "Section 8", "52",
    # "Batman 1989" etc. from being wrongly trimmed.
    current_num = meta.get("number")
    if current_num and series_clean and not vol_found:
        m_trail = re.search(r'\s+(' + re.escape(str(current_num)) + r')\s*$', series_clean)
        if m_trail and series_clean[:m_trail.start()].strip():
            series_clean = series_clean[:m_trail.start()].strip()

    meta["series"] = clean_format_and_edition(series_clean or series)

    # Rule: If title or issue_title is the same as series (even with issue numbers, #3, 3, volume suffixes), leave it blank!
    final_series = meta.get("series") or ""
    if original_series and is_title_same_as_series(meta.get("title"), final_series):
        meta["title"] = ""
    if is_title_same_as_series(meta.get("issue_title"), final_series):
        meta["issue_title"] = ""

    # 3. Disambiguate and resolve creator roles (Writer, Penciller, Inker, Colorist, Letterer)
    resolve_creator_roles(meta)

    # 4. Normalize year / publish_date
    year = meta.get("year")
    p_date = meta.get("publish_date")
    if not year and p_date:
        m = re.search(r'\b(19|20)\d{2}\b', str(p_date))
        if m:
            year = m.group(0)
    if year:
        meta["year"] = str(year)

    # 5. Normalize publisher
    if "publisher" in meta and meta["publisher"]:
        meta["publisher"] = normalize_publisher(meta["publisher"], codex=codex)

    # 6. Sanitize description / summary
    if "description" in meta and meta["description"]:
        meta["description"] = clean_description(meta["description"])
    if "summary" in meta and meta["summary"]:
        meta["summary"] = clean_description(meta["summary"])

    return meta


def calculate_similarity(string1, string2):
    if not string1 or not string2:
        return 0.0

    def clean(s):
        s = s.lower()
        if s.endswith('.cbz'):
            s = s[:-4]
        s = re.sub(r'[\(\[\{].*?[\)\]\}]', '', s)
        # remove common issue patterns and volume markers
        s = re.sub(r'\bv(ol|olume)?\.?\s*\d+\b', '', s)
        s = re.sub(r'#\d+\b', '', s)
        s = re.sub(r'[^a-z0-9\s]', ' ', s)
        return ' '.join(s.split())

    c1 = clean(string1)
    c2 = clean(string2)

    if not c1 or not c2:
        return 0.0

    if c1 == c2:
        return 1.0

    shorter, longer = (c1, c2) if len(c1) < len(c2) else (c2, c1)
    if shorter in longer and (len(shorter) / len(longer)) >= 0.85:
        return 0.90

    return difflib.SequenceMatcher(None, c1, c2).ratio()


def score_candidate(filename: str, raw_item: dict, cover_path: str = None, default_source: str = "Unknown") -> tuple:
    """
    Computes a match candidate tuple (normalized_meta, score, source_url) for a scraped item.
    Penalizes foreign reprint publishers and non-English descriptions.
    """
    norm = normalize_metadata(raw_item)
    title_score = calculate_similarity(filename, raw_item.get("title", "") or norm.get("title", ""))
    cover_url = raw_item.get("cover_image_url") or raw_item.get("cover_url")
    if cover_url and cover_path and title_score >= 0.60:
        from tagger_app.core.covers import compare_covers_python
        img_score = compare_covers_python(cover_path, cover_url)
        score = (img_score * 0.6) + (title_score * 0.4)
    else:
        score = title_score * 0.4

    # Deprioritize foreign reprint publishers
    if is_foreign_publisher(norm.get("publisher")) or is_foreign_publisher(raw_item.get("publisher")):
        score *= 0.1

    # Deprioritize non-English content
    raw_desc = raw_item.get("description") or raw_item.get("summary") or ""
    if raw_desc and not is_english_text(raw_desc):
        score *= 0.3

    source_url = raw_item.get("source_url") or default_source
    return (norm, round(score, 3), source_url)


def score_description_quality(desc: str) -> float:
    """
    Evaluates the informational richness and quality of a comic description.
    Higher score indicates a more detailed, complete, and informative synopsis.
    Returns 0.0 for empty, placeholder, or foreign-language descriptions.
    """
    if not desc:
        return 0.0
    cleaned = clean_description(desc)
    if not cleaned or not is_english_text(cleaned):
        return 0.0

    length = len(cleaned)
    if length < 25:
        return 0.1  # Very short stub (e.g. "Special issue.")

    # Base score on character length up to 1200 characters
    score = min(length / 500.0, 2.5)

    # Reward multiple sentences
    sentences = re.split(r'[.!?]+\s+', cleaned)
    valid_sentences = [s for s in sentences if len(s.strip().split()) >= 3]
    if len(valid_sentences) >= 2:
        score += min(len(valid_sentences) * 0.2, 1.0)

    # Reward paragraph structure (indicates rich summary rather than single line)
    paragraphs = [p for p in cleaned.split('\n\n') if len(p.strip()) > 30]
    if len(paragraphs) >= 2:
        score += 0.5

    # Penalize if it still looks like a spec dump
    if re.search(r'\b(isbn|dimensions|paperback|hardcover|softcover)\b', cleaned, re.I):
        score *= 0.7

    return round(score, 3)


def merge_best_metadata_fields(candidates_data: list, existing_meta: dict = None, codex: list = None) -> dict:
    """
    Evaluates and synthesizes the highest-quality value for every metadata field individually
    across all matching candidates from multiple sources.

    - Description: Evaluates length, structure, and quality score via score_description_quality.
    - Creators: Combines complementary roles (writer, penciller, inker, colorist, letterer, cover_artist)
      giving comic databases precedence for granular credits.
    - Dates: Prefers exact full dates (YYYY-MM-DD) over partial dates or year-only.
    - Lore (Characters, Teams, Locations): Performs case-insensitive set unions across all sources.
    - Genres: Deduplicates and unions genres.
    - Publisher: Picks canonical non-foreign publisher normalized with codex.
    - Title / Series: Prefers distinct story/issue title and canonical series name.
    - Attribution: Tracks all contributing sources in source_url.
    """
    if not candidates_data:
        return normalize_metadata(dict(existing_meta or {}), codex=codex)

    # 1. Normalize candidate representations into standard list of dicts
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
                s /= 100.0  # Normalize percentage scores to 0-1
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

    # Sort candidates by overall score descending
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
    # Primary candidate's series is base; if missing, look for cleanest non-empty series
    best_series = clean_format_and_edition(result.get("series") or "")
    if not best_series:
        for c in norm_candidates:
            s_cand = clean_format_and_edition(c["meta"].get("series") or "")
            if s_cand:
                best_series = s_cand
                _add_source(c["source"])
                break
    result["series"] = best_series

    # Number: Prefer comic DB number if available, else best score
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

    # Volume: Check all candidates
    if not result.get("volume"):
        for c in norm_candidates:
            v_cand = c["meta"].get("volume")
            if v_cand:
                result["volume"] = str(v_cand).strip()
                _add_source(c["source"])
                break

    # 3. Title / Issue Title: Look for a genuine story/issue title
    # (one that is not redundant with the series name)
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

    # 4. Description: Score quality across all candidates and pick the best
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

    # 5. Creators (writer, penciller, inker, colorist, letterer, cover_artist, editor)
    # Give comic DBs priority for granular credits, but union non-empty roles across sources
    creator_roles = ["writer", "penciller", "inker", "colorist", "letterer", "cover_artist", "editor"]
    for role in creator_roles:
        existing_creators = clean_author_names(_split_items(result.get(role)))
        
        # Check comic DBs first, then all candidates
        for c in norm_candidates:
            c_creators = clean_author_names(_split_items(c["meta"].get(role)))
            if not c_creators and role == "cover_artist":
                c_creators = clean_author_names(_split_items(c["meta"].get("CoverArtist") or c["meta"].get("coverArtist")))
            
            for person in c_creators:
                if not any(person.lower() == ec.lower() for ec in existing_creators):
                    existing_creators.append(person)
                    _add_source(c["source"])
                    
        result[role] = ", ".join(existing_creators) if existing_creators else ""

    # Authors fallback for book retailer data
    all_authors = clean_author_names(_split_items(result.get("authors")))
    for c in norm_candidates:
        c_authors = clean_author_names(_split_items(c["meta"].get("authors")))
        for a in c_authors:
            if not any(a.lower() == ea.lower() for ea in all_authors):
                all_authors.append(a)
    result["authors"] = all_authors
    result = resolve_creator_roles(result)

    # 6. Publisher: Prefer canonical non-foreign publisher
    best_pub = normalize_publisher(result.get("publisher"), codex=codex)
    if not best_pub or is_foreign_publisher(best_pub, codex=codex):
        # Look across candidates (comic DBs first)
        found_pub = False
        for is_cdb_pass in (True, False):
            if found_pub: break
            for c in norm_candidates:
                if c["is_comic_db"] == is_cdb_pass:
                    p_cand = normalize_publisher(c["meta"].get("publisher"), codex=codex)
                    if p_cand and not is_foreign_publisher(p_cand, codex=codex):
                        best_pub = p_cand
                        _add_source(c["source"])
                        found_pub = True
                        break
    result["publisher"] = best_pub

    # 7. Dates: Find most specific date (YYYY-MM-DD > YYYY-MM > YYYY)
    best_date_str = ""
    best_year = result.get("year")
    best_month = result.get("month")
    best_day = result.get("day")

    for c in norm_candidates:
        d_cand = str(c["meta"].get("publish_date") or c["meta"].get("cover_date") or "").strip()
        # Check full ISO YYYY-MM-DD
        m_full = re.search(r'\b((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b', d_cand)
        if m_full:
            best_year = m_full.group(1)
            best_month = str(int(m_full.group(2)))
            best_day = str(int(m_full.group(3)))
            best_date_str = f"{best_year}-{int(best_month):02d}-{int(best_day):02d}"
            _add_source(c["source"])
            break

    if not best_date_str:
        # Check YYYY-MM
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

    # 8. Lore: Characters, Teams, Locations (Union of sets)
    for lore_field in ["characters", "teams", "locations"]:
        lore_items = _split_items(result.get(lore_field))
        for c in norm_candidates:
            c_items = _split_items(c["meta"].get(lore_field))
            for item in c_items:
                if not any(item.lower() == li.lower() for li in lore_items):
                    lore_items.append(item)
                    _add_source(c["source"])
        result[lore_field] = ", ".join(lore_items) if lore_items else ""

    # 9. Genres (Union of sets)
    genres = _split_items(result.get("genres") or result.get("genre"))
    for c in norm_candidates:
        c_genres = _split_items(c["meta"].get("genres") or c["meta"].get("genre"))
        for g in c_genres:
            if not any(g.lower() == eg.lower() for eg in genres):
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

    # 13. Existing metadata preservation (if provided)
    if existing_meta and isinstance(existing_meta, dict):
        if existing_meta.get("notes"):
            result["notes"] = existing_meta["notes"]

    return normalize_metadata(result, codex=codex)

