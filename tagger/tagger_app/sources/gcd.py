"""Grand Comics Database (GCD) metadata source.

Extracted from the legacy tagger.py monolith and optimized for high performance,
domain rate limiting, and multi-level caching.
"""
import requests

from tagger_app.core.metadata import score_candidate
from tagger_app.core.query import clean_search_query
from tagger_app.core.cache import tagger_cache
from tagger_app.core.limiter import domain_limiter


def text_similarity(a: str, b: str) -> float:
    """Calculate token-based Jaccard similarity between two descriptions."""
    if not a or not b:
        return 0.0
    import re
    tokens_a = set(re.findall(r'\b\w+\b', str(a).lower()))
    tokens_b = set(re.findall(r'\b\w+\b', str(b).lower()))
    if not tokens_a or not tokens_b:
        return 0.0
    intersect = tokens_a.intersection(tokens_b)
    union = tokens_a.union(tokens_b)
    return len(intersect) / len(union) if union else 0.0


def is_gcd_cover_accessible(url: str) -> bool:
    """Check if cover URL is present."""
    return bool(url and str(url).strip())


def find_fallback_cover(series, number=None, description=None, comicvine_api_key=None, metron_user=None, metron_pass=None):
    """Attempt to retrieve a valid cover image URL from Metron or ComicVine
    when GCD doesn't have a cover or points to files1.comics.org (protected by Cloudflare 403).
    If multiple candidates exist, selects the candidate whose description is closest to GCD's description."""
    if not series:
        return None

    desc_key = hash(description or "")
    cache_key = f"{str(series).strip().lower()}|{str(number or '').strip()}|{desc_key}"
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
            candidates = []
            for item in metron_results:
                cov = item.get("cover_image_url")
                if cov and "comics.org" not in cov:
                    sim = text_similarity(item.get("description") or item.get("summary") or "", description or "")
                    candidates.append((sim, cov))
            if candidates:
                candidates.sort(key=lambda x: x[0], reverse=True)
                best_cov = candidates[0][1]
                tagger_cache.set_query("gcd_fallback_cover", cache_key, best_cov)
                return best_cov
        except Exception as e:
            print(f"[-] Metron cover fallback failed: {e}")

    # 2. Try ComicVine
    if cv_key:
        try:
            from tagger_app.sources.comicvine import search_comicvine_multi
            cv_query = f"{series} #{number}" if number else series
            cv_results = search_comicvine_multi(cv_query, cv_key, limit=5)
            candidates = []
            for item in cv_results:
                cov = item.get("cover_image_url")
                if cov and "comics.org" not in cov:
                    sim = text_similarity(item.get("description") or item.get("summary") or "", description or "")
                    candidates.append((sim, cov))
            if candidates:
                candidates.sort(key=lambda x: x[0], reverse=True)
                best_cov = candidates[0][1]
                tagger_cache.set_query("gcd_fallback_cover", cache_key, best_cov)
                return best_cov
        except Exception as e:
            print(f"[-] ComicVine cover fallback failed: {e}")

    tagger_cache.set_query("gcd_fallback_cover", cache_key, "")
    return None


def search_gcd_multi(query, gcd_user=None, gcd_pass=None, comicvine_api_key=None, metron_user=None, metron_pass=None):
    import os
    try:
        from tagger_app.scheduler.state import scheduler_config
    except Exception:
        scheduler_config = {}

    g_user = gcd_user or scheduler_config.get("gcd_user") or os.environ.get("GCD_USER")
    g_pass = gcd_pass or scheduler_config.get("gcd_pass") or os.environ.get("GCD_PASSWORD") or os.environ.get("GCD_PASS")

    # Rate limiting: 0.5s when login details available (authenticated); 1.5s for free/anonymous version
    if g_user and g_pass:
        domain_limiter.set_domain_delay("comics.org", 0.5)
        auth = (g_user, g_pass)
    else:
        domain_limiter.set_domain_delay("comics.org", 1.5)
        auth = None

    cached = tagger_cache.get_query("gcd", query)
    if cached is not None:
        import re
        valid_cached = []
        for it in cached:
            num = str(it.get("number") or "")
            title = str(it.get("title") or "")
            if re.search(r'\[\s*nn\s*\]', num, re.IGNORECASE) or re.search(r'\[\s*nn\s*\]', title, re.IGNORECASE):
                continue
            cov = it.get("cover_image_url")
            # 1. Try to get cover from GCD API
            if not cov or ("comics.org" in str(cov) and not is_gcd_cover_accessible(str(cov))):
                # 2. If cover not available, do series/number match with description closeness on Metron/ComicVine
                fb = find_fallback_cover(it.get("series"), it.get("number"),
                                         description=it.get("description"),
                                         comicvine_api_key=comicvine_api_key,
                                         metron_user=metron_user,
                                         metron_pass=metron_pass)
                # 3. If neither available, None (fallback default placeholder)
                it["cover_image_url"] = fb if fb else None
            valid_cached.append(it)
        return valid_cached

    out = []
    try:
        # GCD's /series/name/ lookup wants the series name only — strip any '#N'
        # issue suffix, otherwise it searches for a series literally named "X #N".
        import re
        series_query = re.sub(r'\s*#\s*[\d.]+\s*$', '', query).strip() or query
        url = f"https://www.comics.org/api/series/name/{requests.utils.quote(series_query)}/"
        domain_limiter.wait_for_domain("comics.org")
        r = requests.get(url, auth=auth, headers={"Accept": "application/json", "User-Agent": "comic-tagger-bench/1.0"}, timeout=10)
        if r.status_code == 200:
            results = r.json().get("results", [])
            for s in results[:3]:
                series_genre = s.get('genre') or ''
                for iss_url in s.get("active_issues", [])[:3]:
                    cached_iss = tagger_cache.get_entity("gcd_issue", iss_url)
                    if cached_iss is not None:
                        num = str(cached_iss.get("number") or "")
                        title = str(cached_iss.get("title") or "")
                        if re.search(r'\[\s*nn\s*\]', num, re.IGNORECASE) or re.search(r'\[\s*nn\s*\]', title, re.IGNORECASE):
                            continue
                        if not is_gcd_cover_accessible(cached_iss.get("cover_image_url")):
                            cached_iss["cover_image_url"] = None
                        out.append(cached_iss)
                        continue

                    domain_limiter.wait_for_domain("comics.org")
                    ir = requests.get(iss_url, auth=auth, headers={"Accept": "application/json", "User-Agent": "comic-tagger-bench/1.0"}, timeout=10)
                    if ir.status_code == 200:
                        d = ir.json()
                        raw_num = str(d.get('number') or '')
                        if re.search(r'\[\s*nn\s*\]', raw_num, re.IGNORECASE):
                            continue
                        raw_cov = d.get('cover')
                        if raw_cov and '://' in raw_cov:
                            parts = raw_cov.split('://', 1)
                            raw_cov = parts[0] + '://' + parts[1].replace('//', '/')
                        
                        final_cov = raw_cov if is_gcd_cover_accessible(raw_cov) else None

                        writers, pencillers, inkers, colorists, letterers, editors = [], [], [], [], [], []
                        total_pages = 0
                        stories = d.get('story_set') or d.get('stories') or []
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
                            "cover_image_url": final_cov,
                            "genres": [g.strip() for g in series_genre.split(',') if g.strip() and g.strip().lower() not in ["comic", "comics"]],
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
                gcd_user=None, gcd_pass=None,
                comicvine_api_key=None, metron_user=None, metron_pass=None):
    if on_progress:
        on_progress("Searching GCD...")
    query = clean_search_query(filename)

    res = search_gcd_multi(query, gcd_user=gcd_user, gcd_pass=gcd_pass,
                           comicvine_api_key=comicvine_api_key, metron_user=metron_user, metron_pass=metron_pass)
    candidates = []
    import re
    for r in res:
        num = str(r.get("number") or "")
        title = str(r.get("title") or "")
        if re.search(r'\[\s*nn\s*\]', num, re.IGNORECASE) or re.search(r'\[\s*nn\s*\]', title, re.IGNORECASE):
            continue
        cov = r.get("cover_image_url")
        if not cov or ("comics.org" in str(cov) and not is_gcd_cover_accessible(str(cov))):
            fb = find_fallback_cover(r.get("series"), r.get("number"),
                                     description=r.get("description"),
                                     comicvine_api_key=comicvine_api_key,
                                     metron_user=metron_user,
                                     metron_pass=metron_pass)
            r["cover_image_url"] = fb if fb else None
        candidates.append(score_candidate(filename, r, cover_path=cover_path, default_source="GCD"))
    return candidates
