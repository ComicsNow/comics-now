"""Cover comparison uses perceptual hashing (pHash).

A correct cover (same art, different resolution/compression) should score high; an
unrelated cover should score clearly lower. Network is mocked.
"""
import io

import pytest

from tagger_app.core import covers


def _img_bytes(draw_fn, size=(300, 450)):
    from PIL import Image
    img = Image.new("RGB", size, (255, 255, 255))
    draw_fn(img)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


class _FakeResp:
    def __init__(self, content, status=200):
        self.content = content
        self.status_code = status


def _patch_get(monkeypatch, content):
    monkeypatch.setattr(covers.requests, "get",
                        lambda url, headers=None, timeout=None: _FakeResp(content))


def _cover_a():
    from PIL import ImageDraw
    def d(img):
        dr = ImageDraw.Draw(img)
        dr.rectangle([0, 0, 150, 450], fill=(10, 20, 30))   # left dark block
        dr.ellipse([180, 60, 280, 160], fill=(220, 40, 40))
    return d


def _cover_b():
    from PIL import ImageDraw
    def d(img):
        dr = ImageDraw.Draw(img)
        dr.rectangle([0, 300, 300, 450], fill=(240, 230, 10))  # bottom bright block
        dr.ellipse([20, 20, 120, 120], fill=(20, 60, 200))
    return d


def test_identical_cover_scores_max(monkeypatch, tmp_path):
    content = _img_bytes(_cover_a())
    local = tmp_path / "local.jpg"
    local.write_bytes(content)              # same bytes as the "downloaded" candidate
    _patch_get(monkeypatch, content)
    score = covers.compare_covers_python(str(local), "http://x/cover.jpg")
    assert score == 1.0


def test_same_art_resized_scores_high(monkeypatch, tmp_path):
    from PIL import Image
    base = _img_bytes(_cover_a(), size=(600, 900))
    # genuinely the SAME art, just downscaled + re-encoded (what differing sources give us)
    small_img = Image.open(io.BytesIO(base)).convert("RGB").resize((200, 300), Image.LANCZOS)
    buf = io.BytesIO(); small_img.save(buf, format="JPEG", quality=80)
    local = tmp_path / "local.jpg"
    local.write_bytes(base)
    _patch_get(monkeypatch, buf.getvalue())
    score = covers.compare_covers_python(str(local), "http://x/cover.jpg")
    assert score >= 0.85, f"resized same art should stay high, got {score}"


def test_different_cover_scores_lower(monkeypatch, tmp_path):
    local = tmp_path / "local.jpg"
    local.write_bytes(_img_bytes(_cover_a()))
    _patch_get(monkeypatch, _img_bytes(_cover_b()))
    score = covers.compare_covers_python(str(local), "http://x/cover.jpg")
    assert score < 0.85, f"different art should score clearly lower, got {score}"


def test_download_failure_returns_zero(monkeypatch, tmp_path):
    local = tmp_path / "local.jpg"
    local.write_bytes(_img_bytes(_cover_a()))
    monkeypatch.setattr(covers.requests, "get",
                        lambda url, headers=None, timeout=None: _FakeResp(b"", status=404))
    assert covers.compare_covers_python(str(local), "http://x/cover.jpg") == 0.0
