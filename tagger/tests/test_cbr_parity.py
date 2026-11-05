"""CBR parity for the Python tagger.

Node resolves a cover image for CBR archives and passes it as ``cover_path``.
The Python side must accept that cover, treat adjacent sidecars as first-class
metadata for non-ZIP files, and never attempt to repack a RAR archive.
"""
import os
import zipfile

import pytest

from tagger_app.blueprints import api_v1
from tagger_app.core import comicinfo, metadata
from tagger_app.core import tagger as tagger_module
from tagger_app.core.enrichment import check_comic_info_completeness
from tagger_app.core.query import clean_search_query, strip_comic_extension


def _write_cbr(path):
    path.write_bytes(b"Rar!\x1a\x07\x00mock-rar-payload")
    return path


def _complete_xml(series="Mock Series"):
    return comicinfo.generate_comic_info_xml({
        "series": series,
        "number": "1",
        "publisher": "Mock Publisher",
        "year": "2020",
        "title": series,
    })


# --------------------------------------------------------------- extensions
@pytest.mark.parametrize("filename,expected", [
    ("Mock Comic 001.cbz", "Mock Comic 001"),
    ("Mock Comic 001.cbr", "Mock Comic 001"),
    ("Mock Comic 001.CBR", "Mock Comic 001"),
    ("Mock Comic 001.rar", "Mock Comic 001"),
    ("Mock Comic 001.pdf", "Mock Comic 001"),
    ("Mock Comic 001", "Mock Comic 001"),
])
def test_strip_comic_extension(filename, expected):
    assert strip_comic_extension(filename) == expected


def test_clean_search_query_strips_cbr_extension():
    assert clean_search_query("Mock Series 001 (2020) (Digital).cbr") == "Mock Series"
    assert clean_search_query("Mock Series 001 (2020) (Digital).CBR") == "Mock Series"


def test_similarity_ignores_cbr_extension():
    assert metadata.calculate_similarity("Mock Series.cbr", "Mock Series (2020)") == 1.0
    assert metadata.calculate_similarity("Mock Series.CBR", "Mock Series (2020)") == 1.0


# --------------------------------------------------------------- sidecars
def test_read_comic_info_xml_reads_sidecar_next_to_cbr(tmp_path):
    cbr = _write_cbr(tmp_path / "mock-comic.cbr")
    comicinfo.write_comic_info_sidecar(str(cbr), _complete_xml())

    info = comicinfo.read_comic_info_xml(str(cbr))

    assert info is not None
    assert info.get("series") == "Mock Series"
    assert str(info.get("number")) == "1"


def test_sidecar_wins_over_stale_archive_metadata(tmp_path):
    cbz = tmp_path / "mock-comic.cbz"
    with zipfile.ZipFile(cbz, "w") as z:
        z.writestr("ComicInfo.xml", _complete_xml("Archive Series"))
        z.writestr("001.jpg", b"not-a-real-image")
    comicinfo.write_comic_info_sidecar(str(cbz), _complete_xml("Sidecar Series"))

    info = comicinfo.read_comic_info_xml(str(cbz))

    assert info.get("series") == "Sidecar Series"


def test_complete_sidecar_marks_cbr_complete(tmp_path):
    cbr = _write_cbr(tmp_path / "mock-comic.cbr")
    comicinfo.write_comic_info_sidecar(str(cbr), _complete_xml())

    is_incomplete, reason = check_comic_info_completeness(str(cbr))

    assert is_incomplete is False
    assert reason is None


def test_cbr_without_sidecar_is_incomplete(tmp_path):
    cbr = _write_cbr(tmp_path / "mock-comic.cbr")

    is_incomplete, _reason = check_comic_info_completeness(str(cbr))

    assert is_incomplete is True


def test_write_comic_info_falls_back_to_sidecar_for_cbr(tmp_path):
    cbr = _write_cbr(tmp_path / "mock-comic.cbr")
    before = cbr.read_bytes()

    comicinfo.write_comic_info(str(cbr), _complete_xml(), storage_mode="archive")

    assert cbr.read_bytes() == before
    sidecar = comicinfo.sidecar_path_for(str(cbr))
    assert os.path.exists(sidecar)
    assert "Mock Series" in open(sidecar, encoding="utf-8").read()


# --------------------------------------------------------------- process()
def _prepare_process(monkeypatch, captured, cover_result=None, raises=False):
    monkeypatch.setattr(tagger_module, "is_already_enhanced", lambda *a, **k: False)
    monkeypatch.setattr(tagger_module, "check_comic_info_completeness", lambda *a, **k: (True, "No ComicInfo.xml found"))
    monkeypatch.setattr(tagger_module, "read_comic_info_xml", lambda *a, **k: {})

    def fake_extract(*_args, **_kwargs):
        if raises:
            raise ValueError("cannot read RAR")
        return cover_result

    monkeypatch.setattr(tagger_module, "extract_cover_from_cbz", fake_extract)

    def fake_query(_filename, cover_path=None, **_kwargs):
        captured["cover_path"] = cover_path
        return []

    monkeypatch.setattr(tagger_module, "query_all_sources_sequentially", fake_query)


def test_process_uses_supplied_cover_for_cbr(tmp_path, monkeypatch):
    cbr = _write_cbr(tmp_path / "mock-comic.cbr")
    cover = tmp_path / "mock-cover.jpg"
    cover.write_bytes(b"mock-image-bytes")
    captured = {}
    _prepare_process(monkeypatch, captured)

    result = tagger_module.process_single_cbz_file(
        str(cbr),
        "mock-api-key",
        force_reprocess=True,
        cover_path=str(cover),
    )

    assert captured["cover_path"] == str(cover)
    assert result["status"] == "skipped"


def test_process_falls_back_when_supplied_cover_is_missing(tmp_path, monkeypatch):
    cbr = _write_cbr(tmp_path / "mock-comic.cbr")
    generated = tmp_path / "generated-cover.jpg"
    generated.write_bytes(b"mock-image-bytes")
    captured = {}
    _prepare_process(monkeypatch, captured, cover_result=str(generated))

    result = tagger_module.process_single_cbz_file(
        str(cbr),
        "mock-api-key",
        force_reprocess=True,
        cover_path=str(tmp_path / "missing-cover.jpg"),
    )

    assert captured["cover_path"] == str(generated)
    assert result["status"] == "skipped"


def test_process_survives_unreadable_cover(tmp_path, monkeypatch):
    cbr = _write_cbr(tmp_path / "mock-comic.cbr")
    captured = {}
    _prepare_process(monkeypatch, captured, raises=True)

    result = tagger_module.process_single_cbz_file(
        str(cbr),
        "mock-api-key",
        force_reprocess=True,
        cover_path=str(tmp_path / "missing-cover.jpg"),
    )

    assert captured["cover_path"] is None
    assert result["status"] == "skipped"


# --------------------------------------------------------------- endpoints
@pytest.mark.parametrize("endpoint", ["/api/tag-file", "/api/tag-file-stream"])
def test_tag_endpoints_forward_cover_path(client, monkeypatch, tmp_path, endpoint):
    cbr = _write_cbr(tmp_path / "mock-comic.cbr")
    cover = tmp_path / "mock-cover.jpg"
    cover.write_bytes(b"mock-image-bytes")
    captured = {}

    def fake_process(**kwargs):
        captured.update(kwargs)
        return {"filename": "mock-comic.cbr", "status": "skipped", "candidates": []}

    monkeypatch.setattr(api_v1, "process_single_cbz_file", fake_process)
    monkeypatch.setattr(api_v1, "write_scan_log", lambda **_kwargs: None)

    resp = client.post(endpoint, json={
        "path": str(cbr),
        "cover_path": str(cover),
        "metadata_storage": "sidecar",
    })

    assert resp.status_code == 200
    assert captured["cover_path"] == str(cover)
    assert captured["metadata_storage"] == "sidecar"
