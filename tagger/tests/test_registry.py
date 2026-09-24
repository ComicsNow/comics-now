"""Tests for the source registry and the registry-driven orchestrator.

Resolvers are monkeypatched so these stay offline and assert dispatch/enablement
behavior rather than real network results.
"""
import pytest

from tagger_app.sources import (
    registry, comicvine, metron, gcd, lcg, goodreads, blackwells, waterstones, googlebooks, amazon,
)
from tagger_app.sources.registry import SOURCES, SourceContext


# --------------------------------------------------------------- enablement
def test_no_selection_enables_all():
    for s in SOURCES:
        assert s.is_enabled(None) is True
        assert s.is_enabled([]) is True


def test_canonical_id_and_alias_enable():
    cv = next(s for s in SOURCES if s.id == "src-comicvine")
    assert cv.is_enabled(["src-comicvine"]) is True
    assert cv.is_enabled(["comicvine"]) is True
    assert cv.is_enabled(["src-metron"]) is False

    gb = next(s for s in SOURCES if s.id == "src-googlebooks")
    assert gb.is_enabled(["src-googlebooks"]) is True
    assert gb.is_enabled(["googlebooks"]) is True
    assert gb.is_enabled(["google_books"]) is True

    amz = next(s for s in SOURCES if s.id == "src-amazon")
    assert amz.is_enabled(["src-amazon"]) is True
    assert amz.is_enabled(["amazon"]) is True
    assert amz.is_enabled(["amz"]) is True


def test_metron_gcd_combo_alias_enables_both():
    metron_src = next(s for s in SOURCES if s.id == "src-metron")
    gcd_src = next(s for s in SOURCES if s.id == "src-gcd")
    assert metron_src.is_enabled(["src-metron-gcd"]) is True
    assert gcd_src.is_enabled(["src-metron-gcd"]) is True
    # ...but the combo alias should not enable an unrelated source
    ws = next(s for s in SOURCES if s.id == "src-waterstones")
    assert ws.is_enabled(["src-metron-gcd"]) is False


def test_registry_order_and_coverage():
    ids = [s.id for s in SOURCES]
    assert ids == [
        "src-comicvine", "src-metron", "src-gcd", "src-lcg",
        "src-goodreads", "src-blackwells", "src-waterstones",
        "src-googlebooks", "src-amazon",
    ]


# --------------------------------------------------------------- dispatch
@pytest.fixture()
def record_resolvers(monkeypatch):
    """Replace every resolver with a recorder that logs the call and returns []."""
    calls = []

    def make(name):
        def fake(filename, *args, **kwargs):
            calls.append((name, filename, args, kwargs))
            return []
        return fake

    monkeypatch.setattr(comicvine, "resolve_comicvine", make("comicvine"))
    monkeypatch.setattr(metron, "resolve_metron", make("metron"))
    monkeypatch.setattr(gcd, "resolve_gcd", make("gcd"))
    monkeypatch.setattr(lcg, "resolve_lcg", make("lcg"))
    monkeypatch.setattr(goodreads, "resolve_goodreads", make("goodreads"))
    monkeypatch.setattr(blackwells, "resolve_blackwells", make("blackwells"))
    monkeypatch.setattr(waterstones, "resolve_waterstones", make("waterstones"))
    monkeypatch.setattr(googlebooks, "resolve_googlebooks", make("googlebooks"))
    monkeypatch.setattr(amazon, "resolve_amazon", make("amazon"))
    return calls


def test_orchestrator_runs_only_enabled(app_module, record_resolvers):
    progress = []
    app_module.query_all_sources_sequentially(
        "Some Comic v01 (2025).cbz",
        enabled_sources=["src-comicvine", "src-gcd"],
        on_progress=lambda fn, src, msg: progress.append((src, msg)),
    )
    called = {c[0] for c in record_resolvers}
    assert called == {"comicvine", "gcd"}
    # disabled sources should emit a Skipped message
    skipped = {src for src, msg in progress if msg == "Skipped (Disabled)"}
    assert "Metron" in skipped and "Waterstones" in skipped
    assert ("ComicVine", "Searching ComicVine...") in progress


def test_orchestrator_passes_credentials(app_module, record_resolvers):
    app_module.query_all_sources_sequentially(
        "x.cbz",
        comicvine_api_key="CVKEY",
        google_books_api_key="GBKEY",
        metron_user="u", metron_pass="p",
        enabled_sources=["src-comicvine", "src-metron", "src-googlebooks"],
    )
    by_name = {c[0]: c for c in record_resolvers}
    # ComicVine resolver receives the api key positionally
    assert "CVKEY" in by_name["comicvine"][2]
    # Google Books resolver receives api_key as kwarg
    assert by_name["googlebooks"][3].get("api_key") == "GBKEY"
    # Metron resolver receives user/pass as kwargs
    assert by_name["metron"][3].get("metron_user") == "u"
    assert by_name["metron"][3].get("metron_pass") == "p"


def test_orchestrator_survives_source_exception(app_module, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("upstream down")
    monkeypatch.setattr(comicvine, "resolve_comicvine", boom)
    monkeypatch.setattr(gcd, "resolve_gcd", lambda *a, **k: [])
    progress = []
    # should not raise despite ComicVine blowing up
    app_module.query_all_sources_sequentially(
        "x.cbz", enabled_sources=["src-comicvine", "src-gcd"],
        on_progress=lambda fn, src, msg: progress.append((src, msg)),
    )
    assert any(src == "ComicVine" and msg.startswith("Search failed") for src, msg in progress)
