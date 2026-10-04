"""ComicVine story-arc reading order: fetch_comicvine_arc_position should query the
story_arc resource, sort issues by cover_date, and return the 1-based reading position
of a given issue within the arc.
"""
from tagger_app.sources import comicvine


class _FakeResp:
    def __init__(self, payload, status=200):
        self._p = payload
        self.status_code = status

    def json(self):
        return self._p


def test_arc_position_sorts_by_cover_date(monkeypatch):
    def fake_get(url, params=None, headers=None, timeout=None):
        assert "story_arc/4045-40431" in url
        return _FakeResp({"results": {
            "id": 40431,
            "name": "Civil War",
            "issues": [
                {"id": 1003, "cover_date": "2006-08-01"},
                {"id": 1001, "cover_date": "2006-07-01"},
                {"id": 1002, "cover_date": "2006-07-15"},
            ],
        }})

    monkeypatch.setattr(comicvine.requests, "get", fake_get)
    pos = comicvine.fetch_comicvine_arc_position("4045-40431", "4000-1002", "KEY")
    assert pos == {"name": "Civil War", "position": 2, "total": 3}


def test_arc_position_none_when_issue_absent(monkeypatch):
    def fake_get(url, params=None, headers=None, timeout=None):
        return _FakeResp({"results": {"id": 40431, "name": "Civil War",
                                      "issues": [{"id": 1001, "cover_date": "2006-07-01"}]}})

    monkeypatch.setattr(comicvine.requests, "get", fake_get)
    pos = comicvine.fetch_comicvine_arc_position("4045-40431", "4000-9999", "KEY")
    assert pos is None


def test_arc_position_handles_bare_numeric_ids(monkeypatch):
    def fake_get(url, params=None, headers=None, timeout=None):
        return _FakeResp({"results": {"id": 7, "name": "Arc",
                                      "issues": [{"id": 50, "cover_date": "2020-01-01"},
                                                 {"id": 51, "cover_date": "2020-02-01"}]}})

    monkeypatch.setattr(comicvine.requests, "get", fake_get)
    # arc_id and issue_id given without the 4045-/4000- prefixes
    pos = comicvine.fetch_comicvine_arc_position("7", "51", "KEY")
    assert pos == {"name": "Arc", "position": 2, "total": 2}
