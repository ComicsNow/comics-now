"""Creator-role sanitisation: marketing blurbs scraped into creator fields
(e.g. "From ERIN CONNALLY comes THE CUTTING GARDEN") must not be stored as names."""

from tagger_app.core import metadata


def test_drops_marketing_blurb_from_penciller():
    meta = {
        "series": "The Cutting Garden",
        "penciller": "Erin Connally, ERIN CONNALLY comes THE CUTTING GARDEN",
    }
    out = metadata.resolve_creator_roles(meta)
    assert out["penciller"] == "Erin Connally"


def test_drops_blurb_with_connective_verb():
    # "presents"/"from" style promo lines are not names
    meta = {"writer": "Alan Moore, From Alan Moore presents Watchmen"}
    out = metadata.resolve_creator_roles(meta)
    names = [n.strip() for n in out["writer"].split(",") if n.strip()]
    assert names == ["Alan Moore"]


def test_keeps_legitimate_multiple_names():
    meta = {"penciller": "Jim Lee, Scott Williams"}
    out = metadata.resolve_creator_roles(meta)
    names = [n.strip() for n in out["penciller"].split(",")]
    assert "Jim Lee" in names
    assert "Scott Williams" in names


def test_keeps_hyphenated_and_short_names():
    meta = {"writer": "Jean-Paul Ardoin, R.H. Stewart"}
    out = metadata.resolve_creator_roles(meta)
    names = [n.strip() for n in out["writer"].split(",")]
    assert "Jean-Paul Ardoin" in names
    assert "R.H. Stewart" in names


def test_drops_entry_containing_series_title():
    meta = {"series": "Uncanny Valley", "penciller": "Ana Perez, The Uncanny Valley Deluxe Edition"}
    out = metadata.resolve_creator_roles(meta)
    assert out["penciller"] == "Ana Perez"
