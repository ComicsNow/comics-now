"""Grand Comics Database (GCD) metadata source.

Extracted from the legacy tagger.py monolith and optimized for high performance,
domain rate limiting, and multi-level caching.
"""
import requests

from tagger_app.core.metadata import score_candidate
from tagger_app.core.query import clean_search_query
from tagger_app.core.cache import tagger_cache
from tagger_app.core.limiter import domain_limiter


def find_fallback_cover(series, number=None, comicvine_api_key=None, metron_user=None, metron_pass=None):
    """Attempt to retrieve a valid cover image URL from Metron or ComicVine
    when GCD doesn't have a cover or points to files1.comics.org (protected by Cloudflare 403)."""
    if not series:
        return None

    cache_key = f"{str(series).strip().lower()}|{str(number or '').strip()}"
    cached_cov = tagger_cache.get_query("gcd_fallback_cover", cache_key)
    if cached_cov is not None:
        return cached_cov or None

    import os
    try:
        from tagger_app.scheduler.state import scheduler_config
    except Exception:
        scheduler_config = {}

    cv_key = comicvine_api_key or scheduler_config.get("comicvine_api_key") or os.environ.get("COMICVINE_API_KEY")
    m_user = metron_user or scheduler_config.get("metron_user") or os.environ.get("METRON_USER")
    m_pass = metron_pass or scheduler_config.get("metron_pass") or os.environ.get("METRON_PASSWORD") or os.environ.get("METRON_PASS")

    # 1. Try Metron
    if m_user and m_pass:
        try:
            from tagger_app.sources.metron import search_metron_multi
            m_query = f"{series} #{number}" if number else series
            metron_results = search_metron_multi(m_query, m_user, m_pass)
            for item in metron_results:
                cov = item.get("cover_image_url")
                if cov and "comics.org" not in cov:
                    tagger_cache.set_query("gcd_fallback_cover", cache_key, cov)
                    return cov
        except Exception as e:
            print(f"[-] Metron cover fallback failed: {e}")

    # 2. Try ComicVine
    if cv_key:
        try:
            from tagger_app.sources.comicvine import search_comicvine_multi
            cv_query = f"{series} #{number}" if number else series
            cv_results = search_comicvine_multi(cv_query, cv_key, limit=3)
            for item in cv_results:
                cov = item.get("cover_image_url")
                if cov and "comics.org" not in cov:
                    tagger_cache.set_query("gcd_fallback_cover", cache_key, cov)
                    return cov
        except Exception as e:
            print(f"[-] ComicVine cover fallback failed: {e}")

    tagger_cache.set_query("gcd_fallback_cover", cache_key, "")
    return None


def search_gcd_multi(query, comicvine_api_key=None, metron_user=None, metron_pass=None):
    cached = tagger_cache.get_query("gcd", query)
    if cached is not None:
        for it in cached:
            if not it.get("cover_image_url") or "comics.org" in str(it.get("cover_image_url")):
                fb = find_fallback_cover(it.get("series"), it.get("number"),
                                         comicvine_api_key=comicvine_api_key,
                                         metron_user=metron_user,
                                         metron_pass=metron_pass)
                it["cover_image_url"] = fb if fb else None
        return cached

    out = []
    try:
        # GCD's /series/name/ lookup wants the series name only — strip any '#N'
        # issue suffix, otherwise it searches for a series literally named "X #N".
        import re
        series_query = re.sub(r'\s*#\s*[\d.]+\s*$', '', query).strip() or query
        url = f"https://www.comics.org/api/series/name/{requests.utils.quote(series_query)}/"
        domain_limiter.wait_for_domain("comics.org")
        r = requests.get(url, headers={"Accept": "application/json", "User-Agent": "comic-tagger-bench/1.0"}, timeout=10)
        if r.status_code == 200:
            results = r.json().get("results", [])
            for s in results[:3]:
                series_genre = s.get('genre') or ''
                for iss_url in s.get("active_issues", [])[:3]:
                    cached_iss = tagger_cache.get_entity("gcd_issue", iss_url)
                    if cached_iss is not None:
                        if not cached_iss.get("cover_image_url") or "comics.org" in str(cached_iss.get("cover_image_url")):
                            fb = find_fallback_cover(cached_iss.get("series"), cached_iss.get("number"),
                                                     comicvine_api_key=comicvine_api_key,
                                                     metron_user=metron_user,
                                                     metron_pass=metron_pass)
                            cached_iss["cover_image_url"] = fb if fb else None
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
                        # Do not use images from GCD (comics.org) as they are Cloudflare protected.
                        # Match via Metron or ComicVine; if that does not find a cover, set to None.
                        fb = find_fallback_cover(d.get('series_name'), str(d.get('number', '')),
                                                 comicvine_api_key=comicvine_api_key,
                                                 metron_user=metron_user,
                                                 metron_pass=metron_pass)
                        cov = fb if fb else None
                        writers, pencillers, inkers, colorists, letterers, editors = [], [], [], [], [], []
                        total_pages = 0
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
                            try:
                                sp = story.get('page_count')
                                if sp:
                                    total_pages += int(sp)
                            except (ValueError, TypeError):
                                pass

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
                            "cover_image_url": cov,
                            "genres": [g.strip() for g in series_genre.split(',') if g.strip()] or ["Comics"],
                            "pages": str(total_pages) if total_pages > 0 else None
                        }
                        tagger_cache.set_entity("gcd_issue", iss_url, item_meta)
                        out.append(item_meta)

        tagger_cache.set_query("gcd", query, out)
        return out
    except Exception as e:
        print(f"[-] GCD search multi failed: {e}")
        return []


def resolve_gcd(filename, cover_path=None, on_progress=None, existing_meta=None,
                comicvine_api_key=None, metron_user=None, metron_pass=None):
    if on_progress:
        on_progress("Searching GCD...")
    query = clean_search_query(filename)

    res = search_gcd_multi(query, comicvine_api_key=comicvine_api_key, metron_user=metron_user, metron_pass=metron_pass)
    candidates = []
    for r in res:
        if not r.get("cover_image_url") or "comics.org" in str(r.get("cover_image_url")):
            fb = find_fallback_cover(r.get("series"), r.get("number"),
                                     comicvine_api_key=comicvine_api_key,
                                     metron_user=metron_user,
                                     metron_pass=metron_pass)
            r["cover_image_url"] = fb if fb else None
        candidates.append(score_candidate(filename, r, cover_path=cover_path, default_source="GCD"))
    return candidates
