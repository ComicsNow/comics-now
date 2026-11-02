"""Title, series, edition-tag cleanup, and metadata dictionary normalization."""
import re
from tagger_app.core.metadata_parts.publishers import (
    normalize_publisher,
    clean_description,
)
from tagger_app.core.metadata_parts.creators import resolve_creator_roles

VOL_SPLIT_PATTERN = re.compile(
    r'^(?P<series>.+?)[\s,:;\-–—]+\b(?P<vol_token>(?P<vol_prefix>Vol(?:ume|\.)?|Book|Bk\.?|v)\s*0*(?P<vol_num>\d+)(?:(?P<sub_sep>\s*[:\-–—,;]\s*|\s+)(?P<subtitle>.+))?)$',
    re.IGNORECASE
)

STANDALONE_VOL_PATTERN = re.compile(
    r'^(?P<vol_token>(?P<vol_prefix>Vol(?:ume|\.)?|Book|Bk\.?|v)\s*0*(?P<vol_num>\d+)(?:(?P<sub_sep>\s*[:\-–—,;]\s*|\s+)(?P<subtitle>.+))?)$',
    re.IGNORECASE
)


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
        return True

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


def normalize_metadata(meta, codex=None):
    """
    Cleans and maps metadata fields to ensure they align with the frontend keys
    (e.g., issue_number, issue_title, clean series name, normalized publisher, clean description).
    """
    if not meta:
        return meta
    meta = dict(meta)

    # 1. Normalize series / title / issue_title & check for volume patterns
    original_series = meta.get("series")
    raw_title = clean_format_and_edition(meta.get("title") or "")
    series = clean_format_and_edition(meta.get("series") or "")
    issue_title = clean_format_and_edition(meta.get("issue_title") or "")

    vol_found = False
    vol_num = None
    extracted_series = None
    formatted_vol_title = None

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
        explicit_number = meta.get("number") or meta.get("issue_number")
        if not explicit_number:
            m = re.search(r'#(\d+)\b', raw_title)
            if m:
                explicit_number = m.group(1)
        if explicit_number:
            meta["number"] = str(explicit_number)
            meta["issue_number"] = str(explicit_number)
        else:
            meta["number"] = "1"
            meta["issue_number"] = "1"

        if " - " in raw_title and not issue_title:
            parts = raw_title.split(" - ", 1)
            issue_title = clean_format_and_edition(parts[1].strip())

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

    series_clean = meta["series"] or ""

    m_hash = re.search(r'#(\d+)\s*$', series_clean)
    if m_hash:
        if not vol_found and not meta.get("number"):
            meta["number"] = m_hash.group(1)
            meta["issue_number"] = m_hash.group(1)
        series_clean = series_clean[:m_hash.start()].strip()

    current_num = meta.get("number")
    if current_num and series_clean and not vol_found:
        m_trail = re.search(r'\s+(' + re.escape(str(current_num)) + r')\s*$', series_clean)
        if m_trail and series_clean[:m_trail.start()].strip():
            series_clean = series_clean[:m_trail.start()].strip()

    meta["series"] = clean_format_and_edition(series_clean or series)

    final_series = meta.get("series") or ""
    if original_series and is_title_same_as_series(meta.get("title"), final_series):
        meta["title"] = ""
    if is_title_same_as_series(meta.get("issue_title"), final_series):
        meta["issue_title"] = ""

    resolve_creator_roles(meta)

    year = meta.get("year")
    p_date = meta.get("publish_date")
    if not year and p_date:
        m = re.search(r'\b(19|20)\d{2}\b', str(p_date))
        if m:
            year = m.group(0)
    if year:
        meta["year"] = str(year)

    if "publisher" in meta and meta["publisher"]:
        meta["publisher"] = normalize_publisher(meta["publisher"], codex=codex)

    if "description" in meta and meta["description"]:
        meta["description"] = clean_description(meta["description"])
    if "summary" in meta and meta["summary"]:
        meta["summary"] = clean_description(meta["summary"])

    return meta
