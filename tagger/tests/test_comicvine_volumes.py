"""ComicVine volume search: resolve_comicvine should query both issues and volumes,
and volume candidates must carry the must-have fields (series, number, publisher, year).
"""
import pytest

from tagger_app.sources import comicvine


class _FakeResp:
    def __init__(self, payload, status=200):
        self._p = payload
        self.status_code = status

    def json(self):
        return self._p


def test_search_volumes_uses_volume_resource(monkeypatch):
    captured = {}

    def fake_get(url, params=None, headers=None, timeout=None):
        captured["params"] = params
        return _FakeResp({"results": [{"site_detail_url": "https://comicvine.gamespot.com/v/4050-1/"}]})

    monkeypatch.setattr(comicvine.requests, "get", fake_get)
    monkeypatch.setattr(comicvine, "fetch_comicvine_metadata",
                        lambda url, key: {"title": "Saga", "publisher": "Image", "publish_date": "2014"})

    out = comicvine.search_comicvine_volumes("Saga", "KEY", limit=3)
    assert captured["params"]["resources"] == "volume"
    assert out and out[0]["title"] == "Saga"


def test_resolve_runs_both_issue_and_volume(monkeypatch):
    calls = []
    monkeypatch.setattr(comicvine, "search_comicvine_multi",
                        lambda q, k, limit=5: (calls.append("issue") or
                                               [{"title": "Saga #3", "cover_image_url": None,
                                                 "source_url": "issue-url"}]))
    monkeypatch.setattr(comicvine, "search_comicvine_volumes",
                        lambda q, k, limit=5: (calls.append("volume") or
                                               [{"title": "Saga", "publisher": "Image",
                                                 "publish_date": "2014", "cover_image_url": None,
                                                 "source_url": "volume-url"}]))

    cands = comicvine.resolve_comicvine("Saga Vol 3 (2014).cbz", "KEY", cover_path=None)
    assert "issue" in calls and "volume" in calls
    assert len(cands) == 2


def test_volume_candidate_has_must_have_fields(monkeypatch):
    monkeypatch.setattr(comicvine, "search_comicvine_multi", lambda q, k, limit=5: [])
    monkeypatch.setattr(comicvine, "search_comicvine_volumes",
                        lambda q, k, limit=5: [{"title": "Saga", "publisher": "Image",
                                                "publish_date": "2014", "cover_image_url": None,
                                                "source_url": "volume-url"}])

    cands = comicvine.resolve_comicvine("Saga Vol 3 (2014).cbz", "KEY", cover_path=None)
    assert len(cands) == 1
    meta, score, url = cands[0]
    assert meta["series"] == "Saga"            # series
    assert meta["number"] == "3"               # issue/volume number recovered from filename
    assert meta["publisher"] == "Image"        # publisher
    assert meta["year"] == "2014"              # year (from start_year)


def test_volume_number_defaults_when_absent(monkeypatch):
    monkeypatch.setattr(comicvine, "search_comicvine_multi", lambda q, k, limit=5: [])
    monkeypatch.setattr(comicvine, "search_comicvine_volumes",
                        lambda q, k, limit=5: [{"title": "Watchmen", "publisher": "DC",
                                                "publish_date": "1986", "cover_image_url": None,
                                                "source_url": "v"}])
    cands = comicvine.resolve_comicvine("Watchmen (1986).cbz", "KEY", cover_path=None)
    meta = cands[0][0]
    assert meta["series"] == "Watchmen" and meta["number"] == "1"  # normalize default
