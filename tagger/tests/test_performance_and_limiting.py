"""Tests for rate limiting, universal multi-source caching, and tiered early-exit tagging."""
import time
from unittest.mock import patch, MagicMock

from tagger_app.core.limiter import DomainRateLimiter
from tagger_app.core.cache import TaggerCache, tagger_cache
from tagger_app.sources import comicvine, gcd


def test_domain_rate_limiter_spacing():
    """Verify that domain rate limiter enforces minimum intervals for the same domain."""
    limiter = DomainRateLimiter()
    limiter._delays["test.domain.com"] = 0.1  # 100ms

    start = time.time()
    limiter.wait_for_domain("https://test.domain.com/path1")
    limiter.wait_for_domain("https://test.domain.com/path2")
    elapsed = time.time() - start

    assert elapsed >= 0.09, f"Elapsed time {elapsed}s was less than expected 0.1s"


def test_domain_rate_limiter_independent_domains():
    """Verify that separate domains do not block each other."""
    limiter = DomainRateLimiter()
    limiter._delays["domainA.com"] = 0.5
    limiter._delays["domainB.com"] = 0.5

    start = time.time()
    limiter.wait_for_domain("https://domainA.com/api")
    limiter.wait_for_domain("https://domainB.com/api")
    elapsed = time.time() - start

    # Should execute almost immediately since they are different domains
    assert elapsed < 0.2, f"Separate domains blocked each other unexpectedly: {elapsed}s"


def test_tagger_cache_queries_and_entities():
    """Verify query caching, entity caching, and TTL expiration."""
    cache = TaggerCache(ttl_seconds=1, max_entries=5)

    # 1. Query caching
    cache.set_query("gcd", "Batman", [{"title": "Batman #1"}])
    assert cache.get_query("gcd", "Batman") == [{"title": "Batman #1"}]
    assert cache.get_query("gcd", "batman") == [{"title": "Batman #1"}]  # Case insensitive
    assert cache.get_query("gcd", "Superman") is None

    # 2. Entity caching
    cache.set_entity("comicvine_volume", "12345", "DC Comics")
    assert cache.get_entity("comicvine_volume", "12345") == "DC Comics"
    assert cache.get_entity("comicvine_volume", 12345) == "DC Comics"
    assert cache.get_entity("comicvine_volume", "99999") is None

    # 3. Cover pHash caching
    cache.set_cover_phash("https://img.example.com/cover.jpg", "mock_phash_val")
    assert cache.get_cover_phash("https://img.example.com/cover.jpg") == "mock_phash_val"
    assert cache.get_cover_phash("https://img.example.com/other.jpg") is None

    # 4. TTL expiration
    time.sleep(1.1)
    assert cache.get_query("gcd", "Batman") is None
    assert cache.get_entity("comicvine_volume", "12345") is None
    assert cache.get_cover_phash("https://img.example.com/cover.jpg") is None


def test_tagger_cache_lru_eviction():
    """Verify that exceeding max_entries clears safely."""
    cache = TaggerCache(ttl_seconds=3600, max_entries=3)
    cache.set_query("test", "q1", [1])
    cache.set_query("test", "q2", [2])
    cache.set_query("test", "q3", [3])
    cache.set_query("test", "q4", [4])  # triggers clear and adds q4

    assert cache.get_query("test", "q4") == [4]


def test_comicvine_query_and_volume_cache():
    """Verify comicvine search uses and populates cache."""
    tagger_cache.clear()

    mock_search_resp = MagicMock()
    mock_search_resp.status_code = 200
    mock_search_resp.json.return_value = {
        "results": [{
            "id": 1001,
            "name": "The Dark Knight",
            "issue_number": "1",
            "cover_date": "2020-01-01",
            "volume": {"id": 5001, "name": "Batman", "api_detail_url": "https://comicvine.gamespot.com/api/volume/4050-5001/"},
            "image": {"medium_url": "https://comicvine.gamespot.com/cover.jpg"},
            "site_detail_url": "https://comicvine.gamespot.com/issue/4000-1001/"
        }]
    }

    mock_issue_resp = MagicMock()
    mock_issue_resp.status_code = 200
    mock_issue_resp.json.return_value = {
        "results": {
            "name": "The Dark Knight",
            "issue_number": "1",
            "volume": {"id": 5001, "name": "Batman", "api_detail_url": "https://comicvine.gamespot.com/api/volume/4050-5001/"},
            "person_credits": [{"name": "Scott Snyder", "role": "writer"}]
        }
    }

    def fake_cv_get(url, **kwargs):
        if "/search/" in url:
            return mock_search_resp
        return mock_issue_resp

    with patch("requests.get", side_effect=fake_cv_get) as mock_get:
        # First call fetches from network
        res1 = comicvine.search_comicvine_multi("Batman", "test_key", limit=5)
        assert len(res1) == 1
        assert "Batman" in res1[0]["title"]
        assert mock_get.call_count >= 1

        # Second call hits cache (0 network requests)
        call_count_before = mock_get.call_count
        res2 = comicvine.search_comicvine_multi("Batman", "test_key", limit=5)
        assert res2 == res1
        assert mock_get.call_count == call_count_before


def test_gcd_query_cache():
    """Verify GCD search uses cache."""
    tagger_cache.clear()

    mock_series_resp = MagicMock()
    mock_series_resp.status_code = 200
    mock_series_resp.json.return_value = {
        "results": [{
            "active_issues": ["https://www.comics.org/api/issue/1/"]
        }]
    }

    mock_issue_resp = MagicMock()
    mock_issue_resp.status_code = 200
    mock_issue_resp.json.return_value = {
        "series_name": "Saga",
        "number": "1",
        "publication_date": "2012-03-14",
        "publisher_name": "Image Comics",
        "cover": "https://www.comics.org/cover.jpg"
    }

    def side_effect(url, **kwargs):
        if "series/name" in url:
            return mock_series_resp
        return mock_issue_resp

    with patch("requests.get", side_effect=side_effect) as mock_get:
        res1 = gcd.search_gcd_multi("Saga")
        assert len(res1) == 1
        assert res1[0]["publisher"] == "Image Comics"
        count_first = mock_get.call_count

        # Second call should hit query cache
        res2 = gcd.search_gcd_multi("Saga")
        assert res2 == res1
        assert mock_get.call_count == count_first


def test_tiered_early_exit_skips_tier2():
    """Verify that high-confidence Tier 1 match with complete metadata skips Tier 2 scrapers."""
    from app import query_all_sources_sequentially

    # Mock Tier 1 (ComicVine) returning high confidence complete match
    mock_tier1_candidate = {
        "title": "Watchmen #1",
        "series": "Watchmen",
        "number": "1",
        "publisher": "DC Comics",
        "publish_date": "1986-09-01",
        "year": "1986",
        "writer": "Alan Moore",
        "source_url": "https://comicvine.gamespot.com/watchmen-1"
    }

    tier2_called = {"called": False}

    def mock_goodreads_resolve(filename, **kwargs):
        tier2_called["called"] = True
        return []

    with patch("tagger_app.sources.comicvine.resolve_comicvine", return_value=[(mock_tier1_candidate, 0.98, "ComicVine")]), \
         patch("tagger_app.sources.metron.resolve_metron", return_value=[]), \
         patch("tagger_app.sources.gcd.resolve_gcd", return_value=[]), \
         patch("tagger_app.sources.lcg.resolve_lcg", return_value=[]), \
         patch("tagger_app.sources.goodreads.resolve_goodreads", side_effect=mock_goodreads_resolve):

        results = query_all_sources_sequentially("Watchmen #01 (1986).cbz", comicvine_api_key="mock_key")
        assert len(results) >= 1
        best_meta, best_score, best_src = results[0]
        assert best_score >= 0.92
        # Verify Tier 2 was skipped
        assert tier2_called["called"] is False
