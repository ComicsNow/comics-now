"""Unit tests for tagger_app.continuity.parser."""
from bs4 import BeautifulSoup
from tagger_app.continuity.parser import (
    parse_sitemap_slugs,
    detect_publisher,
    parse_reading_order_soup,
    parse_collected_editions_soup,
)

SAMPLE_SITEMAP = """
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://readingorders.com/</loc></url>
  <url><loc>https://readingorders.com/reading-order/crisis-on-infinite-earths/</loc></url>
  <url><loc>https://readingorders.com/reading-order/secret-wars-1984/</loc></url>
  <url><loc>https://readingorders.com/reading-order/non-arc-page</loc></url>
</urlset>
"""

SAMPLE_ORDER_HTML = """
<!DOCTYPE html>
<html>
<head><title>Crisis on Infinite Earths Reading Order</title></head>
<body>
  <div class="breadcrumb">
    <a href="/publisher/dc-comics">DC Comics</a> &gt; <span>Events</span>
  </div>
  <h1 class="entry-title">Crisis on Infinite Earths</h1>
  <div class="entry-content">
    <p>A multi-universe crisis threatening all realities.</p>
  </div>
  <div class="reading-order-list">
    <div class="issue-item" data-cv-id="4050-1234">
      <span class="series-title">Crisis on Infinite Earths</span>
      <span class="issue-num">#1</span>
      <span class="part-annotation">Part 1</span>
    </div>
    <div class="issue-item">
      <span class="series-title">All-Star Squadron</span>
      <span class="issue-num">#50</span>
      <span class="part-annotation">Part 2</span>
    </div>
    <div class="issue-item">
      <span class="series-title">DC Comics Presents</span>
      <span class="issue-num">#87</span>
    </div>
  </div>
</body>
</html>
"""

SAMPLE_COLLECTIONS_HTML = """
<!DOCTYPE html>
<html>
<body>
  <div class="collected-editions-list">
    <div class="collection-item">
      <h3 class="collection-title">Crisis on Infinite Earths 35th Anniversary Deluxe Edition</h3>
      <span class="volume-num">Deluxe Edition</span>
      <span class="isbn">9781401295363</span>
      <span class="issues-collected">Collects Crisis on Infinite Earths #1-12</span>
    </div>
    <div class="collection-item">
      <h3 class="collection-title">Crisis on Infinite Earths Companion Vol. 1</h3>
      <span class="volume-num">Vol 1</span>
      <span class="isbn">9781401274597</span>
      <span class="issues-collected">Collects DC Comics Presents #87, Superman #414</span>
    </div>
  </div>
</body>
</html>
"""


def test_parse_sitemap_slugs():
    slugs = parse_sitemap_slugs(SAMPLE_SITEMAP)
    assert slugs == ["crisis-on-infinite-earths", "secret-wars-1984"]


def test_detect_publisher():
    assert detect_publisher(["DC Comics", "Events"], []) == "DC Comics"
    assert detect_publisher([], ["https://readingorders.com/publisher/marvel-comics/"]) == "Marvel Comics"
    assert detect_publisher([], []) == "Other"
    # Authoritative description extraction
    assert detect_publisher([], [], description="Reading Order for Secret Wars (1984) by Marvel Comics: Heroes and villains...") == "Marvel Comics"
    assert detect_publisher([], [], description="Reading Order for Batman: Court of Owls by DC Comics: The Court of Owls is a chilling...") == "DC Comics"
    # Global footer links presence does NOT cause misclassification
    assert detect_publisher([], ["https://www.dc.com/", "https://www.marvel.com/"], slug="secret-wars", description="Reading Order for Secret Wars (1984) by Marvel Comics: Heroes...") == "Marvel Comics"


def test_parse_reading_order_soup():
    soup = BeautifulSoup(SAMPLE_ORDER_HTML, "html.parser")
    order = parse_reading_order_soup(soup, "crisis-on-infinite-earths")
    assert order["id"] == "crisis-on-infinite-earths"
    assert order["title"] == "Crisis on Infinite Earths"
    assert order["publisher"] == "DC Comics"
    assert "multi-universe crisis" in order["description"]
    assert len(order["issues"]) == 3
    assert order["issues"][0]["series_name"] == "Crisis on Infinite Earths"
    assert order["issues"][0]["issue_number"] == "1"
    assert order["issues"][0]["position"] == 1
    assert order["issues"][0]["part_number"] == 1
    assert order["issues"][1]["series_name"] == "All-Star Squadron"
    assert order["issues"][1]["issue_number"] == "50"


def test_parse_collected_editions_soup():
    soup = BeautifulSoup(SAMPLE_COLLECTIONS_HTML, "html.parser")
    collections = parse_collected_editions_soup(soup, "crisis-on-infinite-earths")
    assert len(collections) == 2
    assert collections[0]["title"] == "Crisis on Infinite Earths 35th Anniversary Deluxe Edition"
    assert collections[0]["volume_number"] == "Deluxe Edition"
    assert collections[0]["isbn"] == "9781401295363"
    assert "Crisis on Infinite Earths #1-12" in collections[0]["issue_range"]
    assert collections[0]["position"] == 1
    assert collections[1]["volume_number"] == "Vol 1"
