import re
from typing import Optional, Dict, Any, List, Tuple


def validate_candidate_list(title: str, matched_comics: List[Dict[str, Any]]) -> Tuple[bool, str]:
    """
    Enforce universal reading list constraints:
    1. At least 3 comics in user's library.
    2. Must span at least 2 distinct series (reject single-series runs).
    3. Cross-publisher is allowed.
    """
    if len(matched_comics) < 3:
        return False, f"Reading list '{title}' requires at least 3 comics in your library (found {len(matched_comics)})."

    distinct_series = set(c.get("series", "").strip() for c in matched_comics if c.get("series"))
    if len(distinct_series) <= 1:
        single_series = next(iter(distinct_series)) if distinct_series else "Unknown"
        return False, f"Reading list '{title}' cannot consist of a single series ('{single_series}'). Single-series runs belong in the Series view."

    return True, "Valid reading list."


def extract_issue_ranges(text: str) -> List[Tuple[str, int, int]]:
    """
    Extract series name and issue range from omnibus/TPB titles.
    Examples:
      'Batman 491-497' -> ('Batman', 491, 497)
      'Detective Comics #659-663' -> ('Detective Comics', 659, 663)
    """
    ranges = []
    matches = re.findall(r'([A-Za-z\s:\'\.]+?)\s+#?(\d+)\s*[-–—]\s*#?(\d+)', text)
    for s_name, start_s, end_s in matches:
        clean_s = s_name.strip()
        if clean_s:
            try:
                ranges.append((clean_s.lower(), int(start_s), int(end_s)))
            except ValueError:
                pass
    return ranges


def comic_matches_step(comic: Dict[str, Any], series: str, issue: str) -> bool:
    """
    Determine if a library comic matches a reading order step.
    Handles:
    - Direct single issue match.
    - Omnibus/TPB covering an issue range (Constraint 4).
    """
    comic_name = comic.get("name", "")
    comic_series = comic.get("series", "")
    target_series = series.lower().strip()
    target_iss_str = str(issue).strip()

    # 1. Check Omnibus / TPB Issue Ranges
    all_text = f"{comic_series} {comic_name}"
    ranges = extract_issue_ranges(all_text)
    if target_iss_str.isdigit():
        target_num = int(target_iss_str)
        for r_series, start_num, end_num in ranges:
            if (r_series in target_series or target_series in r_series or not r_series) and (start_num <= target_num <= end_num):
                return True

    # 2. Check Direct Series Matching
    c_series_lower = comic_series.lower().strip()
    series_match = (
        target_series == c_series_lower or
        target_series in c_series_lower or
        c_series_lower in target_series
    )

    if not series_match:
        if not target_series in comic_name.lower():
            return False

    # 3. Match Issue Number
    if target_iss_str:
        num_patterns = [
            rf'#{target_iss_str}\b',
            rf'#{target_iss_str.zfill(2)}\b',
            rf'#{target_iss_str.zfill(3)}\b',
            rf'\b0*{target_iss_str}\b'
        ]
        for pat in num_patterns:
            if re.search(pat, comic_name):
                return True

    return False


def match_order_against_library(order: Dict[str, Any], library_comics: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Match canonical reading order steps against a set of library comics.
    Returns matched comics in chronological sequence, missing steps, and validation status.
    """
    matched_comics = []
    matched_ids = set()
    missing_steps = []

    for step in order.get("items", []):
        s_series = step.get("series", "")
        s_issue = step.get("issue", "")
        raw_t = step.get("raw_title", f"{s_series} #{s_issue}")

        matched_comic = None
        for c in library_comics:
            if comic_matches_step(c, s_series, s_issue):
                matched_comic = c
                break

        if matched_comic:
            if matched_comic["id"] not in matched_ids:
                matched_ids.add(matched_comic["id"])
                matched_comics.append({
                    "step": step.get("step", len(matched_comics) + 1),
                    "comicId": matched_comic["id"],
                    "name": matched_comic["name"],
                    "series": matched_comic["series"],
                    "publisher": matched_comic["publisher"],
                    "canonical_target": raw_t
                })
        else:
            missing_steps.append({
                "step": step.get("step", 0),
                "title": raw_t
            })

    is_valid, reason = validate_candidate_list(order.get("title", "Reading List"), matched_comics)

    return {
        "title": order.get("title", ""),
        "source": order.get("source", ""),
        "description": order.get("description", ""),
        "is_valid": is_valid,
        "validation_reason": reason,
        "matched_count": len(matched_comics),
        "total_steps": len(order.get("items", [])),
        "matched_comics": matched_comics,
        "missing_steps": missing_steps
    }
