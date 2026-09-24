"""LCG now parses metadata directly off the comic page (no ComicVine proxy)."""
from tagger_app.sources import lcg
from tagger_app.core.metadata import normalize_metadata

# Mirrors the real LCG comic page: OG tags + a "Released" line in the details block.
SAMPLE_HTML = """
<html><head>
<title>Daredevil #8 Reviews</title>
<meta property="og:title" content="Daredevil #8 Reviews">
<meta property="og:description" content="Read reviews and discussion of Daredevil #8 from Chip Zdarsky, published by Marvel Comics">
<meta property="og:image" content="https://s3.amazonaws.com/comicgeeks/comics/covers/medium-3616996.jpg">
<meta property="og:url" content="https://leagueofcomicgeeks.com/comic/3616996/daredevil-8">
</head><body>
<div class="details"> Marvel Comics &middot; Released Jul 17, 2019 </div>
</body></html>
"""


def test_parse_lcg_page_extracts_must_haves():
    meta = lcg.parse_lcg_product_page(SAMPLE_HTML, "https://leagueofcomicgeeks.com/comic/3616996/daredevil-8")
    assert meta["series"] == "Daredevil"
    assert meta["number"] == "8"
    assert meta["publisher"] == "Marvel"
    assert meta["publish_date"] == "Jul 17, 2019"
    assert meta["writer"] == "Chip Zdarsky"
    assert meta["description"] == ""
    assert meta["cover_image_url"].endswith("medium-3616996.jpg")
    assert meta["source_url"].endswith("/daredevil-8")


def test_parse_lcg_page_normalizes_to_year_and_number():
    meta = normalize_metadata(lcg.parse_lcg_product_page(SAMPLE_HTML, "x"))
    assert meta["year"] == "2019"          # derived from publish_date
    assert meta["number"] == "8"
    assert meta["series"] == "Daredevil"
    assert meta["publisher"] == "Marvel"


def test_parse_lcg_page_handles_missing_fields():
    meta = lcg.parse_lcg_product_page("<html><head></head><body></body></html>", "u")
    assert meta["source_url"] == "u"
    assert meta["series"] == ""           # no title -> empty, doesn't crash


def test_lcg_no_longer_imports_comicvine():
    # LCG must be an independent source now, not a ComicVine proxy.
    import inspect
    src = inspect.getsource(lcg)
    assert "search_comicvine_multi" not in src
    assert "requires ComicVine API Key" not in src
