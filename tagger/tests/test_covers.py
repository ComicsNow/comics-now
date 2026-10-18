"""Cover comparison uses perceptual hashing (pHash).

A correct cover (same art, different resolution/compression) should score high; an
unrelated cover should score clearly lower. Network is mocked.
"""
import io

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


def test_gcd_find_fallback_cover_comicvine(monkeypatch):
    from tagger_app.sources import gcd
    monkeypatch.setattr(
        "tagger_app.sources.comicvine.search_comicvine_multi",
        lambda query, api_key, limit=3: [{"cover_image_url": "https://comicvine.gamespot.com/cover123.jpg"}]
    )
    cov = gcd.find_fallback_cover("Batman", "1", comicvine_api_key="mock_cv_key")
    assert cov == "https://comicvine.gamespot.com/cover123.jpg"


def test_gcd_find_fallback_cover_metron(monkeypatch):
    from tagger_app.sources import gcd
    monkeypatch.setattr(
        "tagger_app.sources.metron.search_metron_multi",
        lambda query, user, pwd: [{"cover_image_url": "https://metron.cloud/cover456.jpg"}]
    )
    cov = gcd.find_fallback_cover("Spawn", "1", metron_user="u", metron_pass="p")
    assert cov == "https://metron.cloud/cover456.jpg"


def test_gcd_find_fallback_cover_description_similarity(monkeypatch):
    from tagger_app.sources import gcd
    # Two candidates returned: Candidate B has description matching GCD's description
    candidates = [
        {"cover_image_url": "https://comicvine.gamespot.com/cover_wrong.jpg", "description": "Totally different unrelated storyline in space."},
        {"cover_image_url": "https://comicvine.gamespot.com/cover_correct.jpg", "description": "The Court of Owls attacks Gotham City and Bruce Wayne."}
    ]
    monkeypatch.setattr(
        "tagger_app.sources.comicvine.search_comicvine_multi",
        lambda query, api_key, limit=5: candidates
    )
    cov = gcd.find_fallback_cover(
        "Batman", "1",
        description="Batman fights the Court of Owls across Gotham City.",
        comicvine_api_key="mock_key"
    )
    assert cov == "https://comicvine.gamespot.com/cover_correct.jpg"


def test_gcd_rate_limiting_auth(monkeypatch):
    from tagger_app.sources import gcd
    from tagger_app.core.limiter import domain_limiter

    # Anonymous search -> 1.5s delay
    monkeypatch.setattr("requests.get", lambda *a, **k: type("Resp", (), {"status_code": 404})())
    gcd.search_gcd_multi("Test Series")
    assert domain_limiter._delays["comics.org"] == 1.5

    # Authenticated search -> 0.5s delay
    gcd.search_gcd_multi("Test Series", gcd_user="user", gcd_pass="pass")
    assert domain_limiter._delays["comics.org"] == 0.5


def test_gcd_filters_nn_issues(monkeypatch):
    from tagger_app.sources import gcd
    from tagger_app.core.cache import tagger_cache
    tagger_cache.clear()

    # Mock series response with 3 issue URLs
    series_resp = {
        "results": [{
            "name": "3-D Batman",
            "active_issues": ["https://www.comics.org/api/issue/1/", "https://www.comics.org/api/issue/2/", "https://www.comics.org/api/issue/3/"]
        }]
    }

    issue_1 = {"series_name": "3-D Batman", "number": "[nn]", "notes": "Slipcase"}
    issue_2 = {"series_name": "3-D Batman", "number": "#[nn] #[nn]", "notes": "Double"}
    issue_3 = {"series_name": "3-D Batman", "number": "1", "notes": "Regular issue"}

    def fake_get(url, *args, **kwargs):
        class Resp:
            status_code = 200
            def json(self):
                if "series/name" in url:
                    return series_resp
                if "/issue/1/" in url:
                    return issue_1
                if "/issue/2/" in url:
                    return issue_2
                if "/issue/3/" in url:
                    return issue_3
                return {}
        return Resp()

    monkeypatch.setattr("requests.get", fake_get)
    results = gcd.search_gcd_multi("3-D Batman")
    assert len(results) == 1
    assert results[0]["number"] == "1"


def test_gcd_resolve_skips_nn_candidates(monkeypatch):
    from tagger_app.sources import gcd
    # Mock search_gcd_multi returning an item with [nn] and a regular item
    monkeypatch.setattr(
        gcd,
        "search_gcd_multi",
        lambda *args, **kwargs: [
            {"series": "3-D Batman", "number": "#[nn] #[nn]", "title": "3-D Batman #[nn] #[nn]"},
            {"series": "3-D Batman", "number": "[nn]", "title": "3-D Batman #[nn]"},
            {"series": "3-D Batman", "number": "1", "title": "3-D Batman #1"}
        ]
    )
    candidates = gcd.resolve_gcd("3-D Batman 01.cbz")
    assert len(candidates) == 1
    meta, score, source_url = candidates[0]
    assert meta.get("number") == "1"


def test_gcd_search_multi_rejects_ssrf_issue_urls(monkeypatch):
    from tagger_app.sources import gcd
    series_resp = {
        "results": [{
            "genre": "Superhero",
            "active_issues": [
                "http://169.254.169.254/latest/meta-data/",
                "https://attacker.com/steal-creds",
                "https://www.comics.org/api/issue/999/",
                "http://localhost:3000/internal-api"
            ]
        }]
    }

    fetched_urls = []
    def fake_get(url, *args, **kwargs):
        fetched_urls.append(url)
        class Resp:
            status_code = 200
            def json(self):
                if "series/name" in url:
                    return series_resp
                if "issue/999" in url:
                    return {"series_name": "Safe Series", "number": "1"}
                return {}
        return Resp()

    monkeypatch.setattr("requests.get", fake_get)
    results = gcd.search_gcd_multi("Safe Series")
    # Verify that ONLY the legitimate comics.org URL was requested and SSRF targets were blocked
    assert "http://169.254.169.254/latest/meta-data/" not in fetched_urls
    assert "https://attacker.com/steal-creds" not in fetched_urls
    assert "http://localhost:3000/internal-api" not in fetched_urls
    assert "https://www.comics.org/api/issue/999/" in fetched_urls
    assert len(results) == 1


def test_compare_covers_python_blocks_metadata_and_loopback_ssrf(monkeypatch, tmp_path):
    from tagger_app.core import covers
    dummy_img = tmp_path / "local.jpg"
    dummy_img.write_bytes(b"dummy")

    network_calls = []
    def fake_get(url, *args, **kwargs):
        network_calls.append(url)
        class Resp:
            status_code = 404
            content = b""
        return Resp()

    monkeypatch.setattr("requests.get", fake_get)

    # 1. Cloud metadata IP must be blocked with 0.0 score and NO network call
    score_meta = covers.compare_covers_python(str(dummy_img), "http://169.254.169.254/latest/meta-data/")
    assert score_meta == 0.0
    assert len(network_calls) == 0

    # 2. Localhost / loopback must be blocked with 0.0 score and NO network call
    score_loop = covers.compare_covers_python(str(dummy_img), "http://127.0.0.1:3000/secret.jpg")
    assert score_loop == 0.0
    assert len(network_calls) == 0

    # 3. LAN URL (e.g. 192.168.0.50) must NOT be blocked by SSRF (safe for local setups)
    covers.compare_covers_python(str(dummy_img), "http://192.168.0.50/cover.jpg")
    assert "http://192.168.0.50/cover.jpg" in network_calls






