"""Security regression tests for Comics Now Tagger."""

import hashlib
import os
import sys

import pytest

TAGGER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if TAGGER_DIR not in sys.path:
    sys.path.insert(0, TAGGER_DIR)

import zipfile
from tagger_app.config import is_safe_browse_dir, is_safe_cbz_path
from tagger_app.core import comicinfo, covers
from tagger_app.persistence import tracking_db
from tagger_app.scheduler import state


def test_is_safe_cbz_path_validation(tmp_path):

    real_cbz = tmp_path / "issue01.cbz"
    real_cbz.write_bytes(b"PK\x03\x04")

    txt_file = tmp_path / "notes.txt"
    txt_file.write_text("hello")

    dir_cbz = tmp_path / "folder.cbz"
    dir_cbz.mkdir()

    symlink_cbz = tmp_path / "link.cbz"
    symlink_cbz.symlink_to(real_cbz)

    subdir = tmp_path / "sub"
    subdir.mkdir()

    assert is_safe_cbz_path(str(real_cbz)) is True
    assert is_safe_cbz_path(str(symlink_cbz)) is False
    assert is_safe_cbz_path(str(txt_file)) is False
    assert is_safe_cbz_path(str(dir_cbz)) is False
    assert is_safe_cbz_path(f"{subdir}/../issue01.cbz") is False
    assert is_safe_cbz_path("../issue01.cbz") is False
    assert is_safe_cbz_path(str(tmp_path / "missing.cbz")) is False
    assert is_safe_cbz_path("") is False
    assert is_safe_cbz_path(None) is False


def test_is_safe_browse_dir_validation(tmp_path):
    allowed_dir = tmp_path / "comics"
    allowed_dir.mkdir()

    symlink_dir = tmp_path / "link_dir"
    symlink_dir.symlink_to(allowed_dir)

    assert is_safe_browse_dir(str(allowed_dir)) is True
    assert is_safe_browse_dir(str(symlink_dir)) is False
    assert is_safe_browse_dir(f"{allowed_dir}/../comics") is False
    assert is_safe_browse_dir("/etc") is False
    assert is_safe_browse_dir("/etc/ssh") is False
    assert is_safe_browse_dir("/proc") is False
    assert is_safe_browse_dir("/sys") is False
    assert is_safe_browse_dir("/root") is False
    assert is_safe_browse_dir("/boot") is False
    assert is_safe_browse_dir("/dev") is False
    assert is_safe_browse_dir("/run") is False
    assert is_safe_browse_dir("/var/log") is False
    assert is_safe_browse_dir("/var/run") is False
    assert is_safe_browse_dir("") is False


def test_load_local_rejects_symlink_and_cleans_session_on_error(client, tmp_path):
    real_cbz = tmp_path / "valid.cbz"
    real_cbz.write_bytes(b"PK\x03\x04")
    symlink_cbz = tmp_path / "evil_link.cbz"
    symlink_cbz.symlink_to(real_cbz)

    resp_sym = client.post("/load-local", json={"file_path": str(symlink_cbz)})
    assert resp_sym.status_code in (400, 403)

    corrupt_cbz = tmp_path / "corrupt.cbz"
    corrupt_cbz.write_bytes(b"not-a-valid-zip-archive")
    resp_err = client.post("/load-local", json={"file_path": str(corrupt_cbz)})
    assert resp_err.status_code == 500

    session_id = hashlib.md5(str(corrupt_cbz).encode("utf-8")).hexdigest()
    resp_dl = client.get(f"/download/{session_id}")
    assert resp_dl.status_code == 404


def test_api_tag_routes_reject_symlinks_and_non_cbz(client, tmp_path):
    real_cbz = tmp_path / "issue.cbz"
    real_cbz.write_bytes(b"PK\x03\x04")
    symlink_cbz = tmp_path / "link.cbz"
    symlink_cbz.symlink_to(real_cbz)
    non_cbz = tmp_path / "secret.txt"
    non_cbz.write_text("secret")

    for endpoint in ("/api/apply-tag", "/api/tag-file", "/api/tag-file-stream"):
        resp_sym = client.post(
            endpoint, json={"path": str(symlink_cbz), "metadata": {"Title": "Test"}}
        )
        assert resp_sym.status_code in (400, 403)

        resp_txt = client.post(
            endpoint, json={"path": str(non_cbz), "metadata": {"Title": "Test"}}
        )
        assert resp_txt.status_code in (400, 403)


def test_batch_tag_rejects_unsafe_folder(client, tmp_path):
    target_dir = tmp_path / "real_folder"
    target_dir.mkdir()
    symlink_dir = tmp_path / "sym_folder"
    symlink_dir.symlink_to(target_dir)

    resp_etc = client.post("/batch-tag", json={"folder_path": "/etc", "metadata": {}})
    assert resp_etc.status_code in (400, 403)

    resp_sym = client.post(
        "/batch-tag", json={"folder_path": str(symlink_dir), "metadata": {}}
    )
    assert resp_sym.status_code in (400, 403)


def test_browse_files_blocks_sensitive_directories(client, tmp_path):
    resp_etc = client.get("/browse-files?path=/etc")
    data = resp_etc.get_json()
    assert resp_etc.status_code in (400, 403) or (
        isinstance(data, dict) and data.get("current_path") != "/etc"
    )

    real_dir = tmp_path / "library"
    real_dir.mkdir()
    sym_dir = tmp_path / "sym_library"
    sym_dir.symlink_to(real_dir)
    resp_sym = client.get(f"/browse-files?path={sym_dir}")
    data_sym = resp_sym.get_json()
    assert resp_sym.status_code in (400, 403) or (
        isinstance(data_sym, dict) and data_sym.get("current_path") != str(sym_dir)
    )


def test_tagger_internal_token_middleware(client, tmp_path, monkeypatch):
    monkeypatch.setenv("TAGGER_INTERNAL_TOKEN", "mock-tagger-internal-token-001")

    health_resp = client.get("/api/health")
    assert health_resp.status_code == 200

    unauth_resp = client.get(f"/browse-files?path={tmp_path}")
    assert unauth_resp.status_code == 401

    wrong_resp = client.get(
        f"/browse-files?path={tmp_path}",
        headers={"X-Tagger-Token": "wrong-token"},
    )
    assert wrong_resp.status_code == 401

    ok_resp = client.get(
        f"/browse-files?path={tmp_path}",
        headers={"X-Tagger-Token": "mock-tagger-internal-token-001"},
    )
    assert ok_resp.status_code == 200


def test_is_safe_cover_url_and_redirect_ssrf(monkeypatch, tmp_path):
    for bad_url in [
        "http://127.0.0.2:5000/a.jpg",
        "http://[::ffff:127.0.0.1]/a.jpg",
        "http://[::ffff:169.254.169.254]/a.jpg",
        "http://[fe80::1]/a.jpg",
        "http://0.0.0.0/a.jpg",
        "http://metadata.google.internal/a.jpg",
    ]:
        assert covers.is_safe_cover_url(bad_url) is False, f"Expected unsafe: {bad_url}"

    assert covers.is_safe_cover_url("http://192.168.0.50/cover.jpg") is True
    assert covers.is_safe_cover_url("https://comicvine.gamespot.com/cover.jpg") is True

    local = tmp_path / "local.jpg"
    local.write_bytes(b"dummy")

    class _RedirectedResp:
        status_code = 200
        url = "http://127.0.0.1:5000/secret"
        content = b"not-an-image"

    monkeypatch.setattr(covers.requests, "get", lambda *args, **kwargs: _RedirectedResp())
    assert covers.compare_covers_python(str(local), "https://comicvine.gamespot.com/redirect.jpg") == 0.0


def test_comicinfo_and_tracking_reject_xxe_and_oversized_xml(tmp_path):
    """[M-3] Reject DOCTYPE/ENTITY declarations and >2MB XML in ComicInfo/tracking readers."""
    cbz_dtd = tmp_path / "dtd.cbz"
    sidecar_dtd = tmp_path / "dtd.ComicInfo.xml"
    cbz_dtd.write_bytes(b"placeholder")
    sidecar_dtd.write_text(
        '<?xml version="1.0"?><!DOCTYPE ComicInfo><ComicInfo><Title>Blocked</Title></ComicInfo>',
        encoding="utf-8",
    )
    assert comicinfo.read_comic_info_xml(str(cbz_dtd)) is None

    cbz_entity = tmp_path / "entity.cbz"
    with zipfile.ZipFile(cbz_entity, "w") as zf:
        zf.writestr(
            "ComicInfo.xml",
            '<!entity x "y"><ComicInfo><Title>Blocked</Title><Notes>Tag Comics Now! comicvine</Notes></ComicInfo>',
        )
    assert comicinfo.read_comic_info_xml(str(cbz_entity)) is None
    assert tracking_db.parse_sources_from_cbz_xml(str(cbz_entity)) == set()

    oversized = "<ComicInfo><Title>Big</Title><Notes>Tag Comics Now! comicvine</Notes><Summary>" + ("A" * (2 * 1024 * 1024 + 64)) + "</Summary></ComicInfo>"
    cbz_big = tmp_path / "big.cbz"
    with zipfile.ZipFile(cbz_big, "w") as zf:
        zf.writestr("ComicInfo.xml", oversized)
    assert comicinfo.read_comic_info_xml(str(cbz_big)) is None
    assert tracking_db.parse_sources_from_cbz_xml(str(cbz_big)) == set()


def test_scheduler_save_config_sets_0600_permissions(tmp_path, monkeypatch):
    """[M-4] Scheduler state writes must restrict config file permissions to 0o600."""
    cfg_file = tmp_path / "scheduler_config.json"
    monkeypatch.setattr(state, "CONFIG_FILE", str(cfg_file))
    state.save_scheduler_data()
    assert (cfg_file.stat().st_mode & 0o777) == 0o600
