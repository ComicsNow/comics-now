"""Unit tests for Google Books source resolver."""
import pytest
from unittest.mock import patch, MagicMock

from tagger_app.sources.googlebooks import (
    search_googlebooks_multi, resolve_googlebooks, _extract_volume_metadata,
)
from tagger_app.core.cache import tagger_cache


@pytest.fixture(autouse=True)
def clear_cache():
    tagger_cache.clear()
    yield
    tagger_cache.clear()


def test_extract_volume_metadata_full():
    item = {
        "id": "abc123xyz",
        "volumeInfo": {
            "title": "Batman: Year One",
            "subtitle": "Deluxe Edition",
            "authors": ["Frank Miller", "David Mazzucchelli", "DC Comics"],
            "publisher": "DC Comics",
            "publishedDate": "2007-01-10",
            "description": "<p>A classic Batman origin story.</p>",
            "categories": ["Comics & Graphic Novels"],
            "pageCount": 144,
            "industryIdentifiers": [
                {"type": "ISBN_10", "identifier": "1401207529"},
                {"type": "ISBN_13", "identifier": "9781401207526"}
            ],
            "imageLinks": {
                "thumbnail": "http://books.google.com/books/content?id=abc123xyz&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api",
                "extraLarge": "http://books.google.com/books/content?id=abc123xyz&printsec=frontcover&img=1&zoom=4&edge=curl&source=gbs_api"
            },
            "infoLink": "https://books.google.com/books?id=abc123xyz"
        }
    }

    meta = _extract_volume_metadata(item)
    assert meta["title"] == "Batman: Year One: Deluxe Edition"
    assert meta["authors"] == ["Frank Miller", "David Mazzucchelli"]  # "DC Comics" corporate suffix removed
    assert meta["writer"] == "Frank Miller, David Mazzucchelli"
    assert meta["publisher"] == "DC Comics"
    assert meta["publish_date"] == "2007-01-10"
    assert meta["description"] == "A classic Batman origin story."
    assert meta["isbn"] == "9781401207526"
    assert meta["pages"] == "144"
    assert meta["cover_image_url"].startswith("https://")
    assert "&edge=curl" not in meta["cover_image_url"]
    assert meta["source_url"] == "https://books.google.com/books?id=abc123xyz"


def test_search_googlebooks_multi_mocked(monkeypatch):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "items": [
            {
                "id": "vol1",
                "volumeInfo": {
                    "title": "Watchmen",
                    "authors": ["Alan Moore", "Dave Gibbons"],
                    "publisher": "DC Comics",
                    "publishedDate": "1987",
                    "description": "Who watches the Watchmen?",
                    "industryIdentifiers": [{"type": "ISBN_13", "identifier": "9780930289232"}],
                    "imageLinks": {"thumbnail": "http://example.com/cover.jpg"},
                    "infoLink": "https://books.google.com/books?id=vol1"
                }
            }
        ]
    }

    with patch("requests.get", return_value=mock_response) as mock_get:
        results = search_googlebooks_multi("Watchmen", api_key="TESTKEY")
        assert len(results) == 1
        assert results[0]["title"] == "Watchmen"
        assert results[0]["isbn"] == "9780930289232"
        mock_get.assert_called_once()
        args, kwargs = mock_get.call_args
        assert kwargs["params"]["key"] == "TESTKEY"
        assert kwargs["params"]["q"] == "Watchmen"


def test_resolve_googlebooks_mocked(monkeypatch):
    mock_meta = {
        "title": "Watchmen",
        "authors": ["Alan Moore"],
        "publisher": "DC Comics",
        "publish_date": "1987",
        "description": "Graphic novel",
        "isbn": "9780930289232",
        "cover_image_url": "https://example.com/cover.jpg",
        "source_url": "https://books.google.com/books?id=vol1"
    }

    with patch("tagger_app.sources.googlebooks.search_googlebooks_multi", return_value=[mock_meta]):
        progress_msgs = []
        cands = resolve_googlebooks(
            "Watchmen (1987).cbz",
            api_key="KEY",
            on_progress=lambda msg: progress_msgs.append(msg)
        )
        assert len(cands) == 1
        meta, score, src = cands[0]
        assert meta["title"] == "Watchmen"
        assert score > 0.0
        assert src == "https://books.google.com/books?id=vol1"
        assert "Searching Google Books..." in progress_msgs
