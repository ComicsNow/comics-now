"""Grand Comics Database (GCD) metadata source.

Extracted from the legacy tagger.py monolith and optimized for high performance,
domain rate limiting, and multi-level caching.
"""
import requests

from tagger_app.core.metadata import score_candidate
from tagger_app.core.query import clean_search_query
from tagger_app.core.cache import tagger_cache
from tagger_app.core.limiter import domain_limiter


def search_gcd_multi(query):
    cached = tagger_cache.get_query("gcd", query)
    if cached is not None:
        return cached

    out = []
    try:
        url = f"https://www.comics.org/api/series/name/{requests.utils.quote(query)}/"
        domain_limiter.wait_for_domain("comics.org")
        r = requests.get(url, headers={"Accept": "application/json", "User-Agent": "comic-tagger-bench/1.0"}, timeout=10)
        if r.status_code == 200:
            results = r.json().get("results", [])
            for s in results[:3]:
                for iss_url in s.get("active_issues", [])[:3]:
                    cached_iss = tagger_cache.get_entity("gcd_issue", iss_url)
                    if cached_iss is not None:
                        out.append(cached_iss)
                        continue

                    domain_limiter.wait_for_domain("comics.org")
                    ir = requests.get(iss_url, headers={"Accept": "application/json", "User-Agent": "comic-tagger-bench/1.0"}, timeout=10)
                    if ir.status_code == 200:
                        d = ir.json()
                        cov = d.get('cover')
                        if cov and '://' in cov:
                            parts = cov.split('://', 1)
                            cov = parts[0] + '://' + parts[1].replace('//', '/')
                        writers, pencillers, inkers, colorists, letterers, editors = [], [], [], [], [], []
                        stories = d.get('story_set') or d.get('stories') or []
                        import re
                        for story in stories:
                            if not isinstance(story, dict):
                                continue
                            for w in re.split(r'[;,]', story.get('script') or ''):
                                w = w.strip()
                                if w and w not in writers and w.lower() not in ['?', 'unknown']: writers.append(w)
                            for p in re.split(r'[;,]', story.get('pencils') or ''):
                                p = p.strip()
                                if p and p not in pencillers and p.lower() not in ['?', 'unknown']: pencillers.append(p)
                            for i in re.split(r'[;,]', story.get('inks') or ''):
                                i = i.strip()
                                if i and i not in inkers and i.lower() not in ['?', 'unknown']: inkers.append(i)
                            for c in re.split(r'[;,]', story.get('colors') or ''):
                                c = c.strip()
                                if c and c not in colorists and c.lower() not in ['?', 'unknown']: colorists.append(c)
                            for l in re.split(r'[;,]', story.get('letters') or ''):
                                l = l.strip()
                                if l and l not in letterers and l.lower() not in ['?', 'unknown']: letterers.append(l)
                            for e in re.split(r'[;,]', story.get('editing') or ''):
                                e = e.strip()
                                if e and e not in editors and e.lower() not in ['?', 'unknown']: editors.append(e)

                        item_meta = {
                            "title": f"{d.get('series_name','')} #{d.get('number','')}",
                            "series": d.get('series_name'),
                            "number": str(d.get('number')),
                            "publish_date": d.get("publication_date") or d.get("on_sale_date"),
                            "publisher": d.get("publisher_name"),
                            "description": d.get("notes"),
                            "writer": ", ".join(writers) if writers else None,
                            "penciller": ", ".join(pencillers) if pencillers else None,
                            "inker": ", ".join(inkers) if inkers else None,
                            "colorist": ", ".join(colorists) if colorists else None,
                            "letterer": ", ".join(letterers) if letterers else None,
                            "editor": ", ".join(editors) if editors else None,
                            "source_url": iss_url.replace("/api", ""),
                            "cover_image_url": cov
                        }
                        tagger_cache.set_entity("gcd_issue", iss_url, item_meta)
                        out.append(item_meta)

        tagger_cache.set_query("gcd", query, out)
        return out
    except Exception as e:
        print(f"[-] GCD search multi failed: {e}")
        return []


def resolve_gcd(filename, cover_path=None, on_progress=None, existing_meta=None):
    if on_progress:
        on_progress("Searching GCD...")
    query = clean_search_query(filename)

    res = search_gcd_multi(query)
    candidates = []
    for r in res:
        candidates.append(score_candidate(filename, r, cover_path=cover_path, default_source="GCD"))
    return candidates
