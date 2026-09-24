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


def normalize_metadata(meta, codex=None):
    """
    Cleans and maps metadata fields to ensure they align with the frontend keys
    (e.g., issue_number, issue_title, clean series name, normalized publisher, clean description).
    """
    if not meta:
        return meta

    # 1. Normalize series / title / issue_title & check for volume patterns
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

    # 3. Normalize authors / writer
    authors = meta.get("authors")
    writer = meta.get("writer")

    if isinstance(authors, str):
        authors = [a.strip() for a in authors.split(",") if a.strip()]
    elif not authors:
        authors = []

    if not writer and authors:
        writer = ", ".join(authors)
    elif writer and not authors:
        authors = [a.strip() for a in writer.split(",") if a.strip()]

    meta["authors"] = authors
    meta["writer"] = writer or ""

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
