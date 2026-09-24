"""Tests for the shared filename->query cleanser (tagger_app.core.query)."""
import pytest

from tagger_app.core.query import clean_search_query


@pytest.mark.parametrize("filename,expected", [
    # the motivating case: bracketed year/format dropped, bare '2' kept
    ("Justice League vs Godzilla vs Kong 2 (2026) (Digital).cbz",
     "Justice League vs Godzilla vs Kong 2"),
    # zero-padded issue numbers are stripped
    ("Spider-Man 002 (2024).cbz", "Spider-Man"),
    ("Saga 01.cbz", "Saga"),
    ("Daredevil 0007.cbz", "Daredevil"),
    # bare (non-zero-padded) numbers are kept
    ("Akira 2.cbz", "Akira 2"),
    ("100 Bullets 001.cbz", "100 Bullets"),   # title number kept, issue padding dropped
    # explicit volume / issue markers stripped
    ("Batman v2 #5 (2016).cbz", "Batman"),
    ("Sandman vol. 3.cbz", "Sandman"),
    # extension + internal whitespace normalization
    ("Watchmen   (1986).cbz", "Watchmen"),
])
def test_clean_search_query(filename, expected):
    assert clean_search_query(filename) == expected
