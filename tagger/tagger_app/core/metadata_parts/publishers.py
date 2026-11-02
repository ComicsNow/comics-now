"""Publisher normalization, foreign-language filtering, and description sanitization."""
import re

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

        # Suffix-trimmed codex check
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
    def _replace_entity(m):
        return _entity_map.get(m.group(0), m.group(0))
    s = re.sub(r'&(?:quot|#39|lt|gt|amp);', _replace_entity, s)

    # 2. Spec table dumps & blocks
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
