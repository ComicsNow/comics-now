"""Metron metadata source.

Extracted from the legacy tagger.py monolith and optimized for high performance,
domain rate limiting, and multi-level caching.
"""

from tagger_app.core.metadata import score_candidate
from tagger_app.core.query import clean_search_query
from tagger_app.core.cache import tagger_cache
from tagger_app.core.limiter import domain_limiter


def search_metron_multi(query, user, pwd):
    if not user or not pwd:
        return []

    cached = tagger_cache.get_query("metron", query)
    if cached is not None:
        return cached

    try:
        import mokkari
        domain_limiter.wait_for_domain("metron.cloud")
        m = mokkari.api(user, pwd)
        res = list(m.issues_list(params={"series_name": query}))
        out = []
        for item in res[:5]:
            cached_full = tagger_cache.get_entity("metron_issue", item.id)
            if cached_full is not None:
                out.append(cached_full)
                continue

            domain_limiter.wait_for_domain("metron.cloud")
            full = m.issue(item.id)
            item_meta = {
                "title": f"{full.series.name if full.series else ''} #{full.number}",
                "series": full.series.name if full.series else '',
                "number": str(full.number),
                "publisher": full.publisher.name if full.publisher else None,
                "publish_date": full.store_date or full.cover_date,
                "cover_image_url": str(full.image) if full.image else None,
                "source_url": f"https://metron.cloud/issue/{full.id}/",
                "description": full.desc
            }
            tagger_cache.set_entity("metron_issue", item.id, item_meta)
            out.append(item_meta)

        tagger_cache.set_query("metron", query, out)
        return out
    except Exception as e:
        print(f"[-] Metron search multi failed: {e}")
        return []


def resolve_metron(filename, metron_user=None, metron_pass=None, cover_path=None, on_progress=None, existing_meta=None):
    if not metron_user or not metron_pass:
        if on_progress:
            on_progress("Metron credentials not set. Skipping.")
        return []
    if on_progress:
        on_progress("Searching Metron...")
    query = clean_search_query(filename)

    res = search_metron_multi(query, metron_user, metron_pass)
    candidates = []
    for r in res:
        candidates.append(score_candidate(filename, r, cover_path=cover_path, default_source="Metron"))
    return candidates
