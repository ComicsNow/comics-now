"""Unit tests for the extracted tagger_app.persistence modules.

The DB/log paths are module-level constants; tests monkeypatch them to temp
locations so nothing touches the real tracking DB or scan_logs/.
"""
import io
import os
import json
import zipfile

import pytest

from tagger_app.persistence import tracking_db, scan_logs


@pytest.fixture()
def temp_db(monkeypatch, tmp_path):
    db = tmp_path / "tracking.db"
    monkeypatch.setattr(tracking_db, "DB_TRACKING_PATH", str(db))
    tracking_db.init_tracking_db()
    return str(db)


def _make_cbz(path, notes=None):
    with zipfile.ZipFile(path, "w") as z:
        if notes is not None:
            z.writestr("ComicInfo.xml", f"<ComicInfo><Notes>{notes}</Notes></ComicInfo>")
        else:
            z.writestr("01.jpg", b"x")


# --------------------------------------------------------------- check_sources_match
def test_check_sources_match_alias_and_miss():
    assert tracking_db.check_sources_match({"src-comicvine"}, ["comicvine"]) is True
    assert tracking_db.check_sources_match({"src-comicvine"}, ["src-metron"]) is False
    # empty enabled means "any recorded source counts"
    assert tracking_db.check_sources_match({"src-lcg"}, []) is True
    assert tracking_db.check_sources_match(set(), []) is False


# --------------------------------------------------------------- mark/is_already_enhanced
def test_mark_then_is_already_enhanced(temp_db, tmp_path):
    cbz = tmp_path / "c.cbz"
    _make_cbz(cbz)
    tracking_db.mark_as_enhanced(str(cbz), ["src-comicvine"])
    assert tracking_db.is_already_enhanced(str(cbz), ["src-comicvine"]) is True
    # a source that was not recorded is not considered done
    assert tracking_db.is_already_enhanced(str(cbz), ["src-metron"]) is False


def test_is_already_enhanced_missing_file(temp_db):
    assert tracking_db.is_already_enhanced("/no/such/file.cbz") is False


# --------------------------------------------------------------- legacy XML fallback
def test_parse_sources_from_cbz_xml(tmp_path):
    cbz = tmp_path / "sig.cbz"
    _make_cbz(cbz, notes="Tag Comics Now! - matched via ComicVine")
    assert tracking_db.parse_sources_from_cbz_xml(str(cbz)) == {"src-comicvine"}


def test_legacy_fallback_toggle(temp_db, tmp_path):
    cbz = tmp_path / "sig.cbz"
    _make_cbz(cbz, notes="Tag Comics Now! - matched via ComicVine")
    # with fallback on, the XML signature is read (and migrated) -> already enhanced
    assert tracking_db.is_already_enhanced(str(cbz), ["src-comicvine"], legacy_xml_fallback=True) is True
    # with fallback off and nothing in a fresh DB, it is not enhanced
    fresh = tmp_path / "sig2.cbz"
    _make_cbz(fresh, notes="Tag Comics Now! - matched via ComicVine")
    assert tracking_db.is_already_enhanced(str(fresh), ["src-comicvine"], legacy_xml_fallback=False) is False


# --------------------------------------------------------------- scan logs
def test_write_scan_log(monkeypatch, tmp_path):
    monkeypatch.setattr(scan_logs, "LOGS_DIR", str(tmp_path))
    scan_logs.write_scan_log(
        scan_type="single", target="/x.cbz", total_files=1,
        tagged_count=1, skipped_count=0, failed_count=0,
        results=[{"filename": "x.cbz", "status": "tagged", "matched_title": "X",
                  "metadata": {"title": "X", "series": "X", "number": "1"}}],
    )
    logs = list(tmp_path.glob("scan_log_*.json"))
    assert len(logs) == 1
    data = json.loads(logs[0].read_text())
    assert data["type"] == "single" and data["tagged_count"] == 1
    assert data["results"][0]["filename"] == "x.cbz"
