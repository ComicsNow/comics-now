"""Continuity String & Issue Number Normalization Utilities."""
import re
import sqlite3
from pathlib import Path
from typing import Optional, Any, List


def normalize_series(series: str, strip_article: bool = True) -> str:
    """Normalize series name by removing volume indicators, years, punctuation, editions, and optionally articles."""
    if not series:
        return ""
    s = str(series).strip().replace("’", "'").replace("‘", "'")
    s = re.sub(r"\s*\(\d{4}\)", "", s)
    s = re.sub(r"^(?:dc\s*k\.?o\.?|civil\s*war|blackest\s*night)\s*[:\-–—]\s*", "", s, flags=re.IGNORECASE)
    # Strip edition and collection format keywords
    s = re.sub(
        r"\b(?:35th\s+anniversary|deluxe(?:\s+edition)?|omnibus|companion|special\s+edition|director's\s+cut)\b",
        " ",
        s,
        flags=re.IGNORECASE,
    )
    s = re.sub(r"\b(?:vol(?:ume)?\.?\s*\d+|book\s*\d+|hc|tpb)\b", " ", s, flags=re.IGNORECASE)
    s = re.sub(r"[^a-zA-Z0-9']", " ", s)
    tokens = s.lower().split()
    if strip_article and tokens and tokens[0] == "the":
        tokens = tokens[1:]
    return " ".join(tokens)


def normalize_issue_num(num: Any) -> str:
    """Strip leading zeroes but preserve fractions and spans."""
    if num is None:
        return ""
    s = str(num).strip()
    return re.sub(r"^0+([1-9])", r"\1", s)


def extract_year(text_or_date: Any) -> Optional[int]:
    """Extract 4-digit year (1900-2099) from date string, metadata, or filename."""
    if not text_or_date:
        return None
    m = re.search(r"\b(19\d\d|20\d\d)\b", str(text_or_date))
    return int(m.group(1)) if m else None


def is_year_compatible(
    comic_year: Optional[int],
    ro_date_or_year: Any,
    ro_era_window: Optional[Any] = None,
    max_gap: int = 2,
) -> bool:
    """Return True if comic year matches issue publication year or falls within reading order era window."""
    if comic_year is None:
        return True
    ro_yr = extract_year(ro_date_or_year)
    if ro_yr is not None:
        return abs(comic_year - ro_yr) <= max_gap
    if ro_era_window and isinstance(ro_era_window, (tuple, list)) and len(ro_era_window) == 2:
        min_yr, max_yr = ro_era_window
        if min_yr is not None and max_yr is not None:
            return (min_yr - max_gap) <= comic_year <= (max_yr + max_gap)
    return True


def is_publisher_compatible(comic_pub: Optional[str], arc_pub: Optional[str]) -> bool:
    """Validate publisher family to prevent cross-company false positives (e.g. Marvel vs DC)."""
    if not comic_pub or not arc_pub:
        return True
    cp = comic_pub.strip().lower()
    ap = arc_pub.strip().lower()

    def _family(p: str) -> Optional[str]:
        if any(k in p for k in ["dc", "vertigo", "black label", "wildstorm", "milestone"]):
            return "dc"
        if any(k in p for k in ["marvel", "max", "icon", "knights"]):
            return "marvel"
        if "image" in p or "skybound" in p:
            return "image"
        if "dark horse" in p:
            return "dark horse"
        if "idw" in p:
            return "idw"
        if "boom" in p:
            return "boom"
        if "europe" in p:
            return "europe"
        return None

    cf = _family(cp)
    af = _family(ap)
    if cf and af:
        return cf == af
    return True


def extract_issue_number(name: str, meta_number: Any = None) -> str:
    """Extract issue number strictly, ignoring leading file track numbers like '01 ' or '06 '."""
    if meta_number is not None and str(meta_number).strip() != "":
        return normalize_issue_num(meta_number)
    if not name:
        return ""
    base = Path(name).stem
    hash_match = re.search(r"#\s*(\d+(?:\.\d+)?)", base)
    if hash_match:
        return normalize_issue_num(hash_match.group(1))
    cleaned = re.sub(r"^\d{1,3}\s+[-–—]?\s*", "", base)
    cleaned_no_brackets = re.sub(r"\([^)]*\)|\[[^\]]*\]", " ", cleaned)
    for m in re.finditer(r"\b(\d+(?:\.\d+)?)\b", cleaned_no_brackets):
        num_str = m.group(1)
        try:
            val = float(num_str)
            if val < 1900:
                return normalize_issue_num(num_str)
        except ValueError:
            pass
    return ""


def extract_collected_issues(text: str) -> Optional[tuple[float, float]]:
    """Extract collected issue span from summary or title (e.g. 'Collects issues 12-17')."""
    if not text:
        return None
    pat = r"collects?\s*.*?\b(?:issues?|#)?\s*#?\s*(\d+(?:\.\d+)?)\s*[-–—]\s*#?\s*(\d+(?:\.\d+)?)"
    m = re.search(pat, text, re.IGNORECASE)
    if m:
        try:
            return float(m.group(1)), float(m.group(2))
        except ValueError:
            pass
    return None


def is_issue_in_range(
    comic_num: Any,
    arc_num_str: Any,
    collected_range: Optional[tuple[float, float]] = None,
) -> bool:
    """Determine if a comic issue matches an exact number or falls within a span (e.g. 1-5)."""
    if (comic_num is None and collected_range is None) or arc_num_str is None:
        return False

    arc_str = str(arc_num_str).strip()
    if "-" in arc_str:
        parts = arc_str.split("-")
        low_match = re.search(r"\d+(?:\.\d+)?", parts[0])
        high_match = re.search(r"\d+(?:\.\d+)?", parts[1])
        if low_match and high_match:
            try:
                a_low, a_high = float(low_match.group(0)), float(high_match.group(0))
                if collected_range:
                    c_low, c_high = collected_range
                    return max(c_low, a_low) <= min(c_high, a_high)
                c_val = float(str(comic_num).strip())
                return a_low <= c_val <= a_high
            except ValueError:
                return False
    else:
        a_match = re.search(r"\d+(?:\.\d+)?", arc_str)
        if a_match:
            try:
                a_val = float(a_match.group(0))
                if collected_range:
                    c_low, c_high = collected_range
                    return c_low <= a_val <= c_high
                return float(str(comic_num).strip()) == a_val
            except ValueError:
                return False
    return False


def expand_publisher_aliases(pub: str) -> List[str]:
    """Expand canonical publisher to common imprints and abbreviations."""
    if not pub:
        return []
    p = pub.strip()
    if "DC" in p or p.lower() in ["dc", "vertigo", "black label", "wildstorm", "milestone"]:
        return [
            "DC",
            "DC Comics",
            "Vertigo",
            "Black Label",
            "WildStorm",
            "Milestone",
            "Americas Best Comics",
            "America's Best Comics",
            "Amalgam Comics",
            "Paradox Press",
            "Berger Books",
        ]
    if "Marvel" in p or p.lower() in ["marvel", "max", "icon", "knights"]:
        return [
            "Marvel",
            "Marvel Comics",
            "MAX",
            "Icon",
            "Icon Comics",
            "Marvel Knights",
            "Epic Graphic Novels",
        ]
    return [p]


def get_supported_publishers(ro_db_path: Path | str) -> List[str]:
    """Return list of all supported publisher aliases represented in reading-orders.db."""
    db_file = Path(ro_db_path)
    if not db_file.exists():
        # Fallback to standard DC and Marvel families
        return expand_publisher_aliases("DC Comics") + expand_publisher_aliases("Marvel Comics")

    try:
        conn = sqlite3.connect(str(db_file), timeout=5.0)
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT publisher FROM reading_orders WHERE publisher IS NOT NULL AND publisher != ''")
        pubs = [r[0] for r in cursor.fetchall()]
        conn.close()

        aliases = set()
        for p in pubs:
            for a in expand_publisher_aliases(p):
                aliases.add(a)
        if not aliases:
            aliases.update(expand_publisher_aliases("DC Comics"))
            aliases.update(expand_publisher_aliases("Marvel Comics"))
        return sorted(aliases)
    except Exception:
        return expand_publisher_aliases("DC Comics") + expand_publisher_aliases("Marvel Comics")
