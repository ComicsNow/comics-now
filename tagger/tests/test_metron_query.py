"""Metron query parsing: a query like 'Detective Comics #22' must be split into
series_name='Detective Comics' + number='22' before hitting the Metron API —
passing the raw '#22' as series_name finds nothing.
"""
from tagger_app.sources import metron


def test_split_series_number_basic():
    assert metron.split_series_number("Detective Comics #22") == ("Detective Comics", "22")


def test_split_series_number_no_number():
    assert metron.split_series_number("Saga") == ("Saga", None)


def test_split_series_number_decimal_and_spaces():
    assert metron.split_series_number("The Amazing Spider-Man  #  529") == ("The Amazing Spider-Man", "529")


def test_split_series_number_hash_absent_but_trailing_number():
    # Without a '#', a trailing bare number is NOT treated as issue number (series may end in a number)
    assert metron.split_series_number("2000 AD") == ("2000 AD", None)


def test_metron_search_passes_clean_series_and_number(monkeypatch):
    captured = {}

    class _FakeSeries:
        name = "Detective Comics"

    class _FakeIssue:
        id = 1
        number = "22"
        series = _FakeSeries()
        publisher = None
        store_date = None
        cover_date = None
        image = None
        desc = ""
        credits = []
        characters = []
        teams = []
        locations = []
        arcs = []
        rating = None
        page_count = None

    class _FakeApi:
        def issues_list(self, params=None):
            captured["params"] = params
            return [_FakeIssue()]

        def issue(self, _id):
            return _FakeIssue()

    import types
    fake_mokkari = types.SimpleNamespace(api=lambda u, p: _FakeApi())
    monkeypatch.setitem(__import__("sys").modules, "mokkari", fake_mokkari)
    # Bypass cache so the search actually runs
    monkeypatch.setattr(metron.tagger_cache, "get_query", lambda *a, **k: None)
    monkeypatch.setattr(metron.tagger_cache, "set_query", lambda *a, **k: None)
    monkeypatch.setattr(metron.tagger_cache, "get_entity", lambda *a, **k: None)
    monkeypatch.setattr(metron.tagger_cache, "set_entity", lambda *a, **k: None)

    metron.search_metron_multi("Detective Comics #22", "user", "pass")
    assert captured["params"]["series_name"] == "Detective Comics"
    assert captured["params"]["number"] == "22"
    assert "cover_year" not in captured["params"]


def test_metron_search_passes_cover_year(monkeypatch):
    captured = {}

    class _FakeSeries:
        name = "Batman"

    class _FakeIssue:
        id = 1
        number = "8"
        series = _FakeSeries()
        publisher = None
        store_date = None
        cover_date = None
        image = None
        desc = ""
        credits = []
        characters = []
        teams = []
        locations = []
        arcs = []
        rating = None
        page_count = None

    class _FakeApi:
        def issues_list(self, params=None):
            captured["params"] = params
            return [_FakeIssue()]

        def issue(self, _id):
            return _FakeIssue()

    import types
    fake_mokkari = types.SimpleNamespace(api=lambda u, p: _FakeApi())
    monkeypatch.setitem(__import__("sys").modules, "mokkari", fake_mokkari)
    monkeypatch.setattr(metron.tagger_cache, "get_query", lambda *a, **k: None)
    monkeypatch.setattr(metron.tagger_cache, "set_query", lambda *a, **k: None)
    monkeypatch.setattr(metron.tagger_cache, "get_entity", lambda *a, **k: None)
    monkeypatch.setattr(metron.tagger_cache, "set_entity", lambda *a, **k: None)

    metron.search_metron_multi("Batman #8", "user", "pass", year="2011")
    assert captured["params"]["series_name"] == "Batman"
    assert captured["params"]["number"] == "8"
    assert captured["params"]["cover_year"] == "2011"
