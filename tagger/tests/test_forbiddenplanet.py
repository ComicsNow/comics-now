"""Unit tests for Forbidden Planet metadata source, Google referrer headers, and HTML/JSON-LD parsers."""
import pytest
from bs4 import BeautifulSoup
from tagger_app.config import get_browser_headers
from tagger_app.core.limiter import domain_limiter
from tagger_app.sources.forbiddenplanet import (
    parse_forbiddenplanet_product_soup,
)


def test_forbiddenplanet_headers_google_referrer():
    """Verify that get_browser_headers generates realistic Google search referrer headers for Forbidden Planet."""
    headers = get_browser_headers(query="Batman Year One")
    assert "google.com/search?q=Batman" in headers["Referer"]
    assert "Chrome/" in headers["User-Agent"]
    assert headers["Sec-Fetch-Site"] == "cross-site"
    assert headers["Sec-Fetch-Mode"] == "navigate"


def test_forbiddenplanet_domain_limiter_delay():
    """Verify that domain_limiter has a registered delay for forbiddenplanet.com of at least 1.0s (robots.txt Crawl-delay)."""
    assert "forbiddenplanet.com" in domain_limiter._delays
    assert domain_limiter._delays["forbiddenplanet.com"] >= 1.0


def test_parse_forbiddenplanet_product_soup_json_ld():
    """Verify standard Forbidden Planet product page parsing when schema.org Product JSON-LD is present."""
    html = """<html>
    <head><title>Saga: Volume 1 @ ForbiddenPlanet.com</title>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Product",
      "name": "Saga: Volume 1",
      "description": "From bestselling writer Brian K. Vaughan and artist Fiona Staples, Saga is an epic space opera.",
      "image": "https://dyn.media.forbiddenplanet.com/products/saga1.jpg",
      "gtin13": "9781607066019",
      "mpn": "AUG120491",
      "releaseDate": "2012-10-10",
      "url": "https://forbiddenplanet.com/90634-saga-volume-1/"
    }
    </script>
    <meta property="twitter:image" content="https://dyn.media.forbiddenplanet.com/hires/saga1.jpg">
    </head>
    <body>
        <h1>Saga: Volume 1</h1>
        <dl class="row clearfix one-whole txt-left">
            <dt>Author</dt><dd><a href="/catalog/?tag=author:brian-k-vaughan">Brian K Vaughan</a></dd>
            <dt>Artist</dt><dd><a href="/catalog/?tag=artist:fiona-staples">Fiona Staples</a></dd>
            <dt>Publisher</dt><dd><a href="/catalog/?tag=publisher:image-comics">Image Comics</a></dd>
            <dt>Type</dt><dd>Graphic Novel</dd>
            <dt>Binding</dt><dd>Trade Paperback</dd>
            <dt>ISBN</dt><dd>9781607066019</dd>
        </dl>
    </body>
    </html>"""
    soup = BeautifulSoup(html, 'html.parser')
    meta = parse_forbiddenplanet_product_soup(soup, 'https://forbiddenplanet.com/90634-saga-volume-1/')

    assert meta is not None
    assert meta["title"] == "Saga: Volume 1"
    assert "Brian K Vaughan" in meta["authors"]
    assert "Fiona Staples" in meta["authors"]
    assert meta["writer"] == "Brian K Vaughan"
    assert meta["penciller"] == "Fiona Staples"
    assert meta["isbn"] == "9781607066019"
    assert meta["publisher"] == "Image"
    assert meta["publish_date"] == "2012-10-10"
    assert "bestselling writer Brian K. Vaughan" in meta["description"]
    # Check highest resolution twitter:image was selected over json_ld image
    assert meta["cover_image_url"] == "https://dyn.media.forbiddenplanet.com/hires/saga1.jpg"


def test_parse_forbiddenplanet_product_soup_dl_tables_fallback():
    """Verify fallback parsing when JSON-LD is missing and metadata is only in <dl> specification tables."""
    html = """<html>
    <head><title>Batman: The Long Halloween (New Edition) @ ForbiddenPlanet.com</title>
    <meta property="og:description" content="Christmas. St. Patrick's Day. Easter. As the calendar pages turn, so do the bodies.">
    <meta property="og:image" content="https://media.forbiddenplanet.com/products/long_halloween.jpg">
    </head>
    <body>
        <h1>Batman: The Long Halloween (New Edition)</h1>
        <dl>
            <dt>Author</dt><dd>Jeph Loeb</dd>
            <dt>Artist</dt><dd>Tim Sale</dd>
            <dt>Publisher</dt><dd>DC Comics</dd>
            <dt>ISBN</dt><dd>9781401232597</dd>
            <dt>Publication Date</dt><dd>2011-11-09</dd>
            <dt>Binding</dt><dd>Graphic Novel</dd>
        </dl>
    </body>
    </html>"""
    soup = BeautifulSoup(html, 'html.parser')
    meta = parse_forbiddenplanet_product_soup(soup, 'https://forbiddenplanet.com/75393-batman-the-long-halloween-new-edition/')

    assert meta is not None
    assert meta["title"] == "Batman: The Long Halloween (New Edition)"
    assert "Jeph Loeb" in meta["authors"]
    assert "Tim Sale" in meta["authors"]
    assert meta["writer"] == "Jeph Loeb"
    assert meta["penciller"] == "Tim Sale"
    assert meta["isbn"] == "9781401232597"
    assert meta["publisher"] == "DC Comics"
    assert meta["publish_date"] == "2011-11-09"
    assert "Christmas. St. Patrick's Day." in meta["description"]
    assert meta["cover_image_url"] == "https://media.forbiddenplanet.com/products/long_halloween.jpg"


def test_parse_forbiddenplanet_single_issue():
    """Verify single comic issue parsing with series and creators."""
    html = """<html>
    <head>
    <script type="application/ld+json">
    {
      "@type": "Product",
      "name": "Absolute Batman #25 (Cover A Nick Dragotta Gatefold Triptych)",
      "releaseDate": "2026-10-28",
      "gtin13": "76194138584602511",
      "description": "ABSOLUTE BATMAN CELEBRATES 25 ISSUES! All the villains. All the heroes."
    }
    </script>
    </head>
    <body>
        <dl>
            <dt>Series</dt><dd><a href="#">Absolute Batman</a></dd>
            <dt>Author</dt><dd><a href="#">Scott Snyder</a></dd>
            <dt>Artist</dt><dd><a href="#">Nick Dragotta</a></dd>
            <dt>Publisher</dt><dd><a href="#">DC Comics</a></dd>
            <dt>Type</dt><dd>Comic</dd>
        </dl>
    </body>
    </html>"""
    soup = BeautifulSoup(html, 'html.parser')
    meta = parse_forbiddenplanet_product_soup(soup, 'https://forbiddenplanet.com/506375-absolute-batman-25/')

    assert meta is not None
    assert "Absolute Batman #25" in meta["title"]
    assert meta["series"] == "Absolute Batman"
    assert meta["writer"] == "Scott Snyder"
    assert meta["penciller"] == "Nick Dragotta"
    assert meta["publisher"] == "DC Comics"
    assert meta["publish_date"] == "2026-10-28"
    assert "ABSOLUTE BATMAN CELEBRATES 25 ISSUES!" in meta["description"]


def test_parse_forbiddenplanet_empty_or_malformed():
    """Verify graceful handling when product page HTML is empty or malformed."""
    soup = BeautifulSoup("<html><body><div>Page not found</div></body></html>", 'html.parser')
    meta = parse_forbiddenplanet_product_soup(soup, 'https://forbiddenplanet.com/missing/')
    assert meta is None
