import os
import re
import json
import urllib.request
import urllib.parse
from typing import Optional, Dict, Any, List
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}


def _http_get(url: str, timeout: int = 15) -> str:
    """Execute standard HTTP GET with browser User-Agent."""
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def scrape_dcui_collection(slug_or_url: str) -> Optional[Dict[str, Any]]:
    """Scrape official DC Universe Infinite curated collection or storyline."""
    if not slug_or_url.startswith("http"):
        slug = slug_or_url.strip("/").replace("collections/", "")
        url = f"https://www.dcuniverseinfinite.com/collections/{slug}"
    else:
        url = slug_or_url

    try:
        html = _http_get(url)
    except Exception as e:
        return None

    # Parse Nuxt 3 SSR JSON state
    m = re.search(r'<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
    if not m:
        return None

    try:
        tokens = json.loads(m.group(1))
    except Exception:
        return None

    title = ""
    description = ""
    items = []

    # Find collection metadata in Nuxt tokens
    for token in tokens:
        if isinstance(token, str) and token.startswith("{\"tags\":") and "\"title\":" in token:
            try:
                meta = json.loads(token)
                title = meta.get("title", "")
                description = meta.get("description", "") or meta.get("description_short", "")
                break
            except Exception:
                pass

    if not title:
        # Fallback to HTML title
        soup = BeautifulSoup(html, "html.parser")
        h1 = soup.find("h1")
        title = h1.get_text(strip=True) if h1 else slug_or_url.split("/")[-1].replace("-", " ").title()

    # Extract comic issue items from tokens
    seen_items = set()
    step_num = 1

    for token in tokens:
        if isinstance(token, str) and len(token) < 120:
            # Look for comic titles like "Absolute Batman #1", "Batman #491", etc.
            clean = token.strip()
            if re.search(r'(?:Batman|Superman|Wonder Woman|Flash|Green Lantern|Robin|Nightwing|JLA|Justice League|Aquaman|Shazam|Catwoman|Titans|Absolute)\b', clean, re.I):
                if re.search(r'(?:#\d+|Episode\s+\d+|Vol\b|\b\d+\b)', clean):
                    if clean not in seen_items and not clean.startswith("{") and not clean.startswith("http"):
                        seen_items.add(clean)
                        # Extract series and issue
                        issue_m = re.search(r'#?(\d+)\b', clean)
                        issue_num = issue_m.group(1) if issue_m else ""
                        series_name = re.sub(r'#?\d+.*', '', clean).strip() or clean
                        items.append({
                            "step": step_num,
                            "raw_title": clean,
                            "series": series_name,
                            "issue": issue_num
                        })
                        step_num += 1

    if not items:
        return None

    return {
        "title": title or "DC Universe Infinite Reading Order",
        "source": url,
        "publisher": "DC Comics",
        "description": description,
        "items": items
    }


def scrape_cbro_order(query_or_url: str) -> Optional[Dict[str, Any]]:
    """Scrape issue-by-issue reading order from comicbookreadingorders.com."""
    if not query_or_url.startswith("http"):
        # Search CBRO
        search_url = f"https://comicbookreadingorders.com/?s={urllib.parse.quote(query_or_url)}"
        try:
            html = _http_get(search_url)
            soup = BeautifulSoup(html, "html.parser")
            candidate_links = []
            for a in soup.find_all("a", href=True):
                href = a["href"]
                if "comicbookreadingorders.com" in href and ("events" in href or "reading-order" in href):
                    candidate_links.append(href)

            q_words = [w.lower() for w in query_or_url.split() if len(w) > 2]
            best_links = [l for l in candidate_links if any(w in l.lower() for w in q_words)]
            if best_links:
                target_url = best_links[0]
            elif candidate_links:
                target_url = candidate_links[0]
            else:
                return None
        except Exception:
            return None
    else:
        target_url = query_or_url

    try:
        html = _http_get(target_url)
    except Exception:
        return None

    soup = BeautifulSoup(html, "html.parser")
    content = soup.find("div", class_="entry-content")
    if not content:
        return None

    h1 = soup.find("h1")
    title = h1.get_text(strip=True) if h1 else query_or_url.title()

    items = []
    step_num = 1
    seen = set()

    for el in content.find_all(["li", "p"]):
        text = el.get_text(strip=True)
        # Match lines like "Batman #491" or "Detective Comics #659"
        lines = [line.strip() for line in re.split(r'[\r\n]+', text) if line.strip()]
        for line in lines:
            m = re.search(r'^([A-Za-z0-9\s:\-\'\.]+?)\s+#(\d+)', line)
            if m:
                series = m.group(1).strip()
                issue = m.group(2).strip()
                key = f"{series.lower()}:{issue}"
                if key not in seen:
                    seen.add(key)
                    items.append({
                        "step": step_num,
                        "raw_title": f"{series} #{issue}",
                        "series": series,
                        "issue": issue
                    })
                    step_num += 1

    if not items:
        return None

    return {
        "title": title,
        "source": target_url,
        "description": f"Curated reading order from Comic Book Reading Orders for {title}",
        "items": items
    }


def scrape_cbh_order(query_or_url: str) -> Optional[Dict[str, Any]]:
    """Scrape TPB/Omnibus contents and reading order from comicbookherald.com."""
    if not query_or_url.startswith("http"):
        search_url = f"https://www.comicbookherald.com/?s={urllib.parse.quote(query_or_url)}"
        try:
            html = _http_get(search_url)
            soup = BeautifulSoup(html, "html.parser")
            candidate_links = []
            for a in soup.find_all("a", href=True):
                href = a["href"]
                if "comicbookherald.com" in href and ("reading-order" in href or "reading-dc" in href or "reading-marvel" in href):
                    candidate_links.append(href)

            q_words = [w.lower() for w in query_or_url.split() if len(w) > 2]
            best_links = [l for l in candidate_links if any(w in l.lower() for w in q_words)]
            if best_links:
                target_url = best_links[0]
            elif candidate_links:
                target_url = candidate_links[0]
            else:
                return None
        except Exception:
            return None
    else:
        target_url = query_or_url

    try:
        html = _http_get(target_url)
    except Exception:
        return None

    soup = BeautifulSoup(html, "html.parser")
    content = soup.find("div", class_="entry-content")
    if not content:
        return None

    h1 = soup.find("h1")
    title = h1.get_text(strip=True) if h1 else query_or_url.title()

    items = []
    step_num = 1
    seen = set()

    # Look for "Collects: Series #X to #Y" patterns
    for p in content.find_all(["p", "li"]):
        text = p.get_text(strip=True)
        if "collects:" in text.lower():
            collects_text = re.sub(r'(?i).*?collects:\s*', '', text)
            # Find all series and issue ranges: e.g. "Batman #455 to #457"
            ranges = re.findall(r'([A-Za-z0-9\s:\-\'\.]+?)\s+#(\d+)(?:\s+(?:to|-)\s+#?(\d+))?', collects_text)
            for s_name, start_iss, end_iss in ranges:
                series = s_name.strip()
                s_num = int(start_iss)
                e_num = int(end_iss) if end_iss else s_num
                for iss in range(s_num, e_num + 1):
                    key = f"{series.lower()}:{iss}"
                    if key not in seen:
                        seen.add(key)
                        items.append({
                            "step": step_num,
                            "raw_title": f"{series} #{iss}",
                            "series": series,
                            "issue": str(iss),
                            "collected_in": text[:80]
                        })
                        step_num += 1

    if not items:
        # Fallback to issue mentions
        for li in content.find_all("li"):
            text = li.get_text(strip=True)
            m = re.search(r'([A-Za-z0-9\s:\-\'\.]+?)\s+#(\d+)', text)
            if m:
                series = m.group(1).strip()
                iss = m.group(2).strip()
                key = f"{series.lower()}:{iss}"
                if key not in seen:
                    seen.add(key)
                    items.append({
                        "step": step_num,
                        "raw_title": f"{series} #{iss}",
                        "series": series,
                        "issue": iss
                    })
                    step_num += 1

    if not items:
        return None

    return {
        "title": title,
        "source": target_url,
        "description": f"Curated reading order and trade contents from Comic Book Herald for {title}",
        "items": items
    }


def fetch_reading_order_local(query: str, source: str = "auto") -> Optional[Dict[str, Any]]:
    """Fetch reading order locally using direct HTTP."""
    source_lower = source.lower()

    if source_lower == "dcui" or ("dc" in query.lower() and source_lower == "auto"):
        res = scrape_dcui_collection(query)
        if res:
            return res

    if source_lower in ("cbro", "auto"):
        res = scrape_cbro_order(query)
        if res:
            return res

    if source_lower in ("cbh", "auto"):
        res = scrape_cbh_order(query)
        if res:
            return res

    # Fallback to DCUI if not tried
    if source_lower == "auto":
        res = scrape_dcui_collection(query)
        if res:
            return res

    return None


# Modal Serverless App Definition
try:
    import modal

    app = modal.App("reading-orders-scraper")
    image = modal.Image.debian_slim(python_version="3.11").pip_install(
        "beautifulsoup4", "urllib3"
    )

    @app.function(image=image, timeout=60)
    def cloud_fetch_reading_order(query: str, source: str = "auto") -> Optional[Dict[str, Any]]:
        return fetch_reading_order_local(query, source)

except Exception:
    app = None
    cloud_fetch_reading_order = None


def fetch_reading_order(query: str, source: str = "auto") -> Optional[Dict[str, Any]]:
    """Fetch reading order via Modal cloud worker with local fallback."""
    try:
        if cloud_fetch_reading_order is not None and os.environ.get("MODAL_TOKEN_ID"):
            return cloud_fetch_reading_order.remote(query, source)
    except Exception:
        pass

    return fetch_reading_order_local(query, source)
