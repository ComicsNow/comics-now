"""Unit tests for Amazon metadata source and DOM extraction strategies."""
from bs4 import BeautifulSoup
from tagger_app.config import get_browser_headers
from tagger_app.sources.amazon import parse_amazon_product_soup


def test_browser_headers_google_referrer():
    """Verify that get_browser_headers generates realistic Google search referrer headers."""
    headers = get_browser_headers(query="Watchmen Alan Moore")
    assert "google.com/search?q=Watchmen" in headers["Referer"]
    assert "Chrome/" in headers["User-Agent"]
    assert headers["Sec-Fetch-Site"] == "cross-site"
    assert headers["Sec-Fetch-Mode"] == "navigate"


def test_parse_amazon_product_soup_standard():
    """Verify standard Amazon product page parsing with dynamic high-res image extraction."""
    html = """<html>
    <head><title>Watchmen</title></head>
    <body>
        <span id="productTitle">Watchmen (2019 Edition)</span>
        <div id="bylineInfo">
            <span class="author"><a href="#">Alan Moore</a> (Author)</span>
            <span class="author"><a href="#">Dave Gibbons</a> (Illustrator)</span>
            <span class="author"><a href="#">John Higgins</a> (Colorist)</span>
        </div>
        <div id="bookDescription_feature_div">
            <div class="a-expander-content">
                A hit HBO original series, Watchmen, the groundbreaking series from award-winning author Alan Moore, presents a world where the mere presence of American superheroes changed history.
            </div>
        </div>
        <div id="detailBullets_feature_div">
            <ul>
                <li><span class="a-text-bold">Publisher : </span><span>DC Comics; Annotated edition (May 20, 2019)</span></li>
                <li><span class="a-text-bold">Print length : </span><span>416 pages</span></li>
                <li><span class="a-text-bold">ISBN-10 : </span><span>1779501129</span></li>
                <li><span class="a-text-bold">ISBN-13 : </span><span>978-1779501127</span></li>
            </ul>
        </div>
        <img id="landingImage" data-a-dynamic-image='{"https://images.amazon.com/thumb.jpg":[200,300],"https://images.amazon.com/hires.jpg":[1000,1500]}' src="https://images.amazon.com/thumb.jpg" />
    </body>
    </html>"""
    soup = BeautifulSoup(html, 'html.parser')
    meta = parse_amazon_product_soup(soup, 'https://www.amazon.com/dp/1779501129')

    assert meta is not None
    assert meta["title"] == "Watchmen (2019 Edition)"
    assert "Alan Moore" in meta["authors"]
    assert "Dave Gibbons" in meta["authors"]
    assert meta["writer"] == "Alan Moore"
    assert meta["penciller"] == "Dave Gibbons"
    assert meta["colorist"] == "John Higgins"
    assert meta["isbn"] == "9781779501127"
    assert meta["publisher"] == "DC Comics"
    assert meta["pages"] == "416"
    assert "HBO original series" in meta["description"]
    # Verify highest resolution cover was chosen from data-a-dynamic-image
    assert meta["cover_image_url"] == "https://images.amazon.com/hires.jpg"


def test_parse_amazon_product_soup_fuzzy_semantic_fallback():
    """Verify resilient dumb/fuzzy fallback extraction when class names/IDs are missing or changed."""
    html = """<html>
    <body>
        <h1><span>Saga Deluxe Edition Vol. 1</span></h1>
        <div class="unknown_authors_class">
            <span>by Brian K. Vaughan (Author), Fiona Staples (Artist)</span>
        </div>
        <div class="unknown_narrative_box">
            <p>From the bestselling team of Brian K. Vaughan and Fiona Staples comes Saga, a sweeping space opera fantasy comic book series.</p>
        </div>
        <div class="random_spec_grid">
            <div>Random Header</div>
            <div>Print length: 504 pages</div>
            <div>Publisher: Image Comics</div>
            <div>ISBN-13: 978-1632150783</div>
            <div>Publication date: November 25, 2014</div>
        </div>
        <meta property="og:image" content="https://m.media-amazon.com/images/saga.jpg" />
    </body>
    </html>"""
    soup = BeautifulSoup(html, 'html.parser')
    meta = parse_amazon_product_soup(soup, 'https://www.amazon.com/dp/1632150786')

    assert meta is not None
    assert meta["title"] == "Saga Deluxe Edition Vol. 1"
    assert meta["isbn"] == "9781632150783"
    assert meta["publisher"] == "Image"
    assert meta["pages"] == "504"
    assert meta["cover_image_url"] == "https://m.media-amazon.com/images/saga.jpg"


def test_parse_amazon_anti_bot_detection():
    """Verify graceful return when Amazon returns a robot check challenge."""
    html = """<html>
    <body>
        <h4>Robot Check</h4>
        <p>Enter the characters you see below</p>
        <form action="/errors/validateCaptcha"></form>
    </body>
    </html>"""
    soup = BeautifulSoup(html, 'html.parser')
    meta = parse_amazon_product_soup(soup, 'https://www.amazon.com/dp/B000000000')
    assert meta is None
