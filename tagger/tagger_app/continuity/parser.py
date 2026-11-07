"""ReadingOrders.com HTML and Sitemap Parser for Tag Comics Now!.

Extracts structured reading orders, single issues, and collected edition metadata
using BeautifulSoup.
"""
import re
from typing import List, Dict, Any, Optional
from bs4 import BeautifulSoup

BASE_URL = "https://readingorders.com"


def parse_issue_title_and_number(raw_title: str) -> Dict[str, str]:
    """Parse series name and issue number from an issue title string.

    e.g., 'Crisis on Infinite Earths #1' -> {'seriesName': 'Crisis on Infinite Earths', 'issueNumber': '1'}
    """
    if not raw_title:
        return {"seriesName": "", "issueNumber": ""}
    s = raw_title.strip()
    hash_idx = s.rfind("#")
    if hash_idx == -1:
        return {"seriesName": s, "issueNumber": ""}
    return {
        "seriesName": s[:hash_idx].strip(),
        "issueNumber": s[hash_idx + 1:].strip(),
    }


def parse_sitemap_slugs(xml_or_html: str) -> List[str]:
    """Extract distinct reading order slugs from ReadingOrders sitemap XML or HTML."""
    slugs = []
    # Pattern matching /reading-order/<slug>/
    matches = re.findall(r"/reading-order/([a-zA-Z0-9_\-]+)/?", xml_or_html)
    for m in matches:
        clean = m.strip().rstrip("/")
        if clean and clean not in slugs and clean != "reading-order" and not clean.endswith(".xml") and not clean.endswith("-page"):
            slugs.append(clean)
    return slugs


def detect_publisher(
    breadcrumbs: Optional[List[str]] = None,
    links: Optional[List[str]] = None,
    title: str = "",
    slug: str = "",
    description: str = "",
) -> str:
    """Infer publisher (DC Comics, Marvel Comics, Image Comics, Other)."""
    # 1. Authoritative check: ReadingOrders.com meta descriptions always format as:
    # "Reading Order for <Title> by <Publisher>: <Summary>"
    if description:
        m = re.search(r"\bby\s+(Marvel(?:\s+Comics)?|DC(?:\s+Comics)?|Image(?:\s+Comics)?|Dark\s+Horse(?:\s+Comics)?|IDW(?:\s+Publishing)?)\b", description, re.IGNORECASE)
        if m:
            pub_raw = m.group(1).lower()
            if "marvel" in pub_raw:
                return "Marvel Comics"
            if "dc" in pub_raw:
                return "DC Comics"
            if "image" in pub_raw:
                return "Image Comics"
            if "dark horse" in pub_raw:
                return "Dark Horse Comics"
            if "idw" in pub_raw:
                return "IDW Publishing"

    # 2. Filter out site-wide global footer/nav links (e.g. www.dc.com, www.marvel.com)
    clean_links = [
        l for l in (links or [])
        if not re.search(r"^https?://(www\.)?(dc|marvel)\.com/?$", l.lower().strip())
    ]

    text_corpus = " ".join((breadcrumbs or []) + clean_links + [title, slug]).lower()

    # 3. Targeted slug/title keyword checks
    if any(k in text_corpus for k in ["marvel comics", "timeline/marvel", "/publisher/marvel", "avengers", "spider-man", "secret-wars", "x-men", "dawn-of-x", "reign-of-x", "fall-of-x", "empyre", "king-in-black"]):
        return "Marvel Comics"
    if any(k in text_corpus for k in ["dc comics", "timeline/dc", "/publisher/dc", "batman", "superman", "crisis-on", "flashpoint", "knightfall", "dark-nights"]):
        return "DC Comics"
    if "image" in text_corpus or "/publisher/image" in text_corpus:
        return "Image Comics"
    return "Other"


def parse_reading_order_soup(soup: BeautifulSoup, slug: str) -> Dict[str, Any]:
    """Parse single-issues reading order HTML into a structured dictionary."""
    # Title extraction
    title_el = soup.find("h1")
    title = title_el.get_text(strip=True) if title_el else slug
    title = re.sub(r"\s+Reading\s+Order$", "", title, flags=re.IGNORECASE).strip()

    # Description extraction
    desc = ""
    desc_el = soup.find("p", class_="description") or soup.find("div", class_="entry-content")
    if desc_el:
        desc = desc_el.get_text(strip=True)
    if not desc:
        meta_desc = soup.find("meta", attrs={"name": "description"})
        if meta_desc and meta_desc.get("content"):
            desc = meta_desc["content"].strip()

    # Breadcrumbs & links for publisher detection
    breadcrumbs = [a.get_text(strip=True) for a in soup.select(".breadcrumb a, nav a")]
    links = [a.get("href", "") for a in soup.find_all("a", href=True)]
    publisher = detect_publisher(breadcrumbs, links, title=title, slug=slug, description=desc)

    issues = []
    # Cards: either .issue-item or generic border card
    cards = soup.select(".issue-item, div.rounded-xl.border, div.rounded-lg.border")
    for idx, card in enumerate(cards, start=1):
        # Series & issue
        series_el = card.select_one(".series-title, h3")
        num_el = card.select_one(".issue-num")
        cv_id = card.get("data-cv-id") or card.get("data-comicvine-id")

        if series_el and num_el:
            series_name = series_el.get_text(strip=True)
            issue_number = num_el.get_text(strip=True).lstrip("#")
        elif series_el:
            parsed = parse_issue_title_and_number(series_el.get_text(strip=True))
            series_name = parsed["seriesName"]
            issue_number = parsed["issueNumber"]
        else:
            continue

        if not series_name:
            continue

        part_num = None
        part_el = card.select_one(".part-annotation, div.text-muted-foreground.text-sm")
        if part_el:
            part_match = re.search(r"Part\s+(\d+)", part_el.get_text(strip=True), re.IGNORECASE)
            if part_match:
                part_num = int(part_match.group(1))

        issues.append({
            "position": idx,
            "series_name": series_name,
            "issue_number": issue_number,
            "part_number": part_num,
            "comic_vine_id": cv_id,
        })

    return {
        "id": slug,
        "title": title or slug,
        "publisher": publisher,
        "description": desc,
        "url": f"{BASE_URL}/reading-order/{slug}",
        "issue_count": len(issues),
        "issues": issues,
    }


def parse_collected_editions_soup(soup: BeautifulSoup, slug: str) -> List[Dict[str, Any]]:
    """Parse collected editions HTML page into a list of collection volumes."""
    collections = []
    items = soup.select(".collection-item, div.collected-edition-card, div.rounded-xl.border")
    for idx, item in enumerate(items, start=1):
        title_el = item.select_one(".collection-title, h3")
        if not title_el:
            continue
        col_title = title_el.get_text(strip=True)
        if not col_title:
            continue

        vol_num = None
        vol_el = item.select_one(".volume-num, span.text-xs")
        if vol_el:
            vol_num = vol_el.get_text(strip=True)

        isbn = None
        isbn_el = item.select_one(".isbn")
        if isbn_el:
            isbn = isbn_el.get_text(strip=True)

        issue_range = None
        issues_el = item.select_one(".issues-collected, p.text-muted-foreground")
        if issues_el:
            issue_range = issues_el.get_text(strip=True)

        collections.append({
            "position": idx,
            "title": col_title,
            "volume_number": vol_num,
            "isbn": isbn,
            "issue_range": issue_range,
        })
    return collections
