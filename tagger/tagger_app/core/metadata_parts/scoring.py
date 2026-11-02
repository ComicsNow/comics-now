"""Similarity scoring, candidate scoring, and description quality metrics."""
import re
import difflib
from tagger_app.core.metadata_parts.publishers import (
    is_foreign_publisher,
    is_english_text,
    clean_description,
)
from tagger_app.core.metadata_parts.titles import normalize_metadata


def calculate_similarity(string1, string2):
    if not string1 or not string2:
        return 0.0

    def clean(s):
        s = s.lower()
        if s.endswith('.cbz'):
            s = s[:-4]
        s = re.sub(r'[\(\[\{].*?[\)\]\}]', '', s)
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

    candidate_title = raw_item.get("title") or norm.get("title")
    if not candidate_title or not str(candidate_title).strip():
        ser = norm.get("series") or raw_item.get("series") or ""
        num = norm.get("number") or norm.get("issue_number") or raw_item.get("number") or ""
        if ser and num:
            candidate_title = f"{ser} #{num}"
        elif ser:
            candidate_title = ser

    cand_num = str(norm.get("number") or raw_item.get("number") or "")
    cand_title_str = str(candidate_title or "")
    if re.search(r'\[\s*nn\s*\]', cand_num, re.IGNORECASE) or re.search(r'\[\s*nn\s*\]', cand_title_str, re.IGNORECASE):
        src_label = str(default_source or raw_item.get("source") or "").lower()
        if "gcd" in src_label:
            return (norm, 0.0, raw_item.get("source_url") or "")

    title_score = calculate_similarity(filename, candidate_title or "")

    series_name = norm.get("series") or raw_item.get("series") or ""
    if series_name:
        series_score = calculate_similarity(filename, series_name)
        if series_score > title_score:
            title_score = series_score

    cover_url = raw_item.get("cover_image_url") or raw_item.get("cover_url")
    if cover_url and cover_path and title_score >= 0.60:
        from tagger_app.core.covers import compare_covers_python
        img_score = compare_covers_python(cover_path, cover_url)
        if img_score > 0:
            score = (img_score * 0.6) + (title_score * 0.4)
        else:
            score = title_score
    else:
        score = title_score

    if is_foreign_publisher(norm.get("publisher")) or is_foreign_publisher(raw_item.get("publisher")):
        score *= 0.1

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
        return 0.1

    score = min(length / 500.0, 2.5)

    sentences = re.split(r'[.!?]+\s+', cleaned)
    valid_sentences = [s for s in sentences if len(s.strip().split()) >= 3]
    if len(valid_sentences) >= 2:
        score += min(len(valid_sentences) * 0.2, 1.0)

    paragraphs = [p for p in cleaned.split('\n\n') if len(p.strip()) > 30]
    if len(paragraphs) >= 2:
        score += 0.5

    if re.search(r'\b(isbn|dimensions|paperback|hardcover|softcover)\b', cleaned, re.I):
        score *= 0.7

    return round(score, 3)
