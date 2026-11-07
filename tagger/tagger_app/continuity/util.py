"""Continuity String & Issue Number Normalization Utilities."""
import re
from pathlib import Path
from typing import Optional, Any, List


def normalize_series(series: str) -> str:
    """Normalize series name by removing years, punctuation, and event prefixes."""
    if not series:
        return ""
    s = str(series).strip().replace("’", "'").replace("‘", "'")
    s = re.sub(r"\s*\(\d{4}\)", "", s)
    s = re.sub(r"^(?:dc\s*k\.?o\.?|civil\s*war|blackest\s*night)\s*[:\-–—]?\s*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"[^a-zA-Z0-9']", " ", s)
    return " ".join(s.lower().split())


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


def is_year_compatible(comic_year: Optional[int], ro_date_or_year: Any, max_gap: int = 2) -> bool:
    """Return True if comic year and reading order publication year are within max_gap or unknown."""
    if comic_year is None:
        return True
    ro_yr = extract_year(ro_date_or_year)
    if ro_yr is None:
        return True
    return abs(comic_year - ro_yr) <= max_gap


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


def is_issue_in_range(comic_num: Any, arc_num_str: Any) -> bool:
    """Determine if a comic issue matches an exact number or falls within a span (e.g. 1-5)."""
    if comic_num is None or arc_num_str is None:
        return False
    c_match = re.search(r"\d+(?:\.\d+)?", str(comic_num).strip())
    if not c_match:
        return False
    try:
        c_val = float(c_match.group(0))
    except ValueError:
        return False

    arc_str = str(arc_num_str).strip()
    if "-" in arc_str:
        parts = arc_str.split("-")
        low_match = re.search(r"\d+(?:\.\d+)?", parts[0])
        high_match = re.search(r"\d+(?:\.\d+)?", parts[1])
        if low_match and high_match:
            try:
                low = float(low_match.group(0))
                high = float(high_match.group(0))
                return low <= c_val <= high
            except ValueError:
                pass

    a_match = re.search(r"\d+(?:\.\d+)?", arc_str)
    if not a_match:
        return False
    try:
        return c_val == float(a_match.group(0))
    except ValueError:
        return False


def expand_publisher_aliases(pub: str) -> List[str]:
    """Expand canonical publisher to common imprints and abbreviations."""
    if not pub:
        return []
    p = pub.strip()
    if "DC" in p:
        return ["DC", "DC Comics", "Vertigo", "Black Label", "WildStorm", "Milestone"]
    if "Marvel" in p:
        return ["Marvel", "Marvel Comics", "MAX", "Icon", "Marvel Knights"]
    return [p]
