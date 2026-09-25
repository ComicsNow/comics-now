"""Unit tests for field-by-field best metadata selection and synthesis."""
import pytest
from tagger_app.core.metadata import (
    score_description_quality,
    merge_best_metadata_fields,
    clean_description,
)
from app import consolidate_all_candidates, enrich_metadata_from_other_sources


# ---------------------------------------------------------------------------
# Description Quality Scoring Tests
# ---------------------------------------------------------------------------
def test_score_description_quality_empty_and_foreign():
    assert score_description_quality("") == 0.0
    assert score_description_quality(None) == 0.0
    assert score_description_quality("No description available.") == 0.0
    # Foreign language should score 0.0
    german = "Der junge Peter Parker wird von einer radioaktiven Spinne gebissen und erhält übermenschliche Kräfte."
    assert score_description_quality(german) == 0.0


def test_score_description_quality_richness():
    short_stub = "Issue #1 of the series."
    rich_synopsis = (
        "Following the harrowing events of the previous arc, Batman finds himself pushed to his mental "
        "and physical limits. As the Joker unleashes chaos across Gotham City, ancient secrets buried "
        "beneath Arkham Asylum begin to surface.\n\n"
        "With stunning artwork and gripping dialogue, this milestone issue redefines the Dark Knight's "
        "greatest conflict for a whole new generation."
    )

    score_stub = score_description_quality(short_stub)
    score_rich = score_description_quality(rich_synopsis)

    assert score_stub < 0.5
    assert score_rich > 1.5
    assert score_rich > score_stub


# ---------------------------------------------------------------------------
# Field-by-Field Synthesis Tests
# ---------------------------------------------------------------------------
def test_merge_best_metadata_description_competition():
    """Richer plot description from a secondary source wins over a 1-sentence stub from primary."""
    cand_cv = {
        "title": "Watchmen #1",
        "series": "Watchmen",
        "number": "1",
        "publisher": "DC Comics",
        "description": "Who watches the Watchmen? First issue.",
        "writer": "Alan Moore",
        "penciller": "Dave Gibbons",
        "source_url": "https://comicvine.gamespot.com/watchmen-1"
    }
    cand_gr = {
        "title": "Watchmen (1986) #1",
        "series": "Watchmen",
        "number": "1",
        "publisher": "DC Comics",
        "description": (
            "This Hugo Award-winning graphic novel chronicles the fall from grace of a group of super-heroes "
            "plagued by all-too-human failings. Along the way, the concept of the superhero is dissected as "
            "an assassin begins targeting former masked heroes in a cold-war landscape.\n\n"
            "Considered one of the greatest graphic novels of all time."
        ),
        "source_url": "https://www.goodreads.com/book/show/12345"
    }

    candidates = [
        {"metadata": cand_cv, "score": 0.95, "source": "ComicVine"},
        {"metadata": cand_gr, "score": 0.88, "source": "Goodreads"},
    ]

    merged = merge_best_metadata_fields(candidates)

    # Creators should come from ComicVine
    assert merged["writer"] == "Alan Moore"
    assert merged["penciller"] == "Dave Gibbons"
    # Description must be the rich synopsis from Goodreads, not the 1-sentence stub
    assert "Hugo Award-winning" in merged["description"]
    # Both sources should be attributed
    assert "comicvine.gamespot.com" in merged["source_url"]
    assert "goodreads.com" in merged["source_url"]


def test_merge_best_metadata_creator_role_union():
    """Complementary creator credits across sources are combined into full creative team."""
    cand_a = {
        "series": "Saga",
        "number": "1",
        "writer": "Brian K. Vaughan",
        "publisher": "Image",
        "source_url": "https://comicvine.gamespot.com/saga-1"
    }
    cand_b = {
        "series": "Saga",
        "number": "1",
        "writer": "Brian K. Vaughan",
        "penciller": "Fiona Staples",
        "letterer": "Fonografiks",
        "source_url": "https://metron.cloud/issue/saga-1"
    }

    candidates = [
        (cand_a, 0.92, "https://comicvine.gamespot.com/saga-1"),
        (cand_b, 0.90, "https://metron.cloud/issue/saga-1"),
    ]

    merged = merge_best_metadata_fields(candidates)

    assert merged["writer"] == "Brian K. Vaughan"
    assert merged["penciller"] == "Fiona Staples"
    assert merged["letterer"] == "Fonografiks"
    assert merged["publisher"] == "Image"


def test_merge_best_metadata_date_specificity():
    """Specific ISO YYYY-MM-DD date wins over a year-only date."""
    cand_year_only = {
        "series": "Batman",
        "number": "404",
        "year": "1987",
        "publish_date": "1987",
        "source_url": "SourceA"
    }
    cand_full_date = {
        "series": "Batman",
        "number": "404",
        "publish_date": "1987-02-15",
        "source_url": "SourceB"
    }

    candidates = [
        {"metadata": cand_year_only, "score": 0.94, "source": "SourceA"},
        {"metadata": cand_full_date, "score": 0.89, "source": "SourceB"},
    ]

    merged = merge_best_metadata_fields(candidates)

    assert merged["year"] == "1987"
    assert merged["month"] == "2"
    assert merged["day"] == "15"
    assert merged["publish_date"] == "1987-02-15"


def test_merge_best_metadata_lore_union():
    """Characters, teams, locations, and genres are unioned without duplicates."""
    cand1 = {
        "series": "Justice League",
        "number": "1",
        "characters": "Superman, Batman, Wonder Woman",
        "teams": "Justice League",
        "genres": ["Superhero", "Action"],
        "source_url": "Source1"
    }
    cand2 = {
        "series": "Justice League",
        "number": "1",
        "characters": "Batman, Flash, Green Lantern",
        "teams": "Justice League of America",
        "genres": ["Adventure", "Superhero"],
        "source_url": "Source2"
    }

    candidates = [
        (cand1, 0.93, "Source1"),
        (cand2, 0.91, "Source2"),
    ]

    merged = merge_best_metadata_fields(candidates)

    chars = [c.strip() for c in merged["characters"].split(",")]
    assert set(chars) == {"Superman", "Batman", "Wonder Woman", "Flash", "Green Lantern"}

    teams = [t.strip() for t in merged["teams"].split(",")]
    assert set(teams) == {"Justice League", "Justice League of America"}

    assert set(merged["genres"]) == {"Superhero", "Action", "Adventure"}


def test_merge_best_metadata_distinct_issue_title():
    """Distinct story/chapter title is preferred over redundant series name."""
    cand_redundant = {
        "series": "Sandman",
        "title": "Sandman #1",
        "issue_title": "Sandman",
        "number": "1",
        "source_url": "Source1"
    }
    cand_story_title = {
        "series": "Sandman",
        "title": "Sleep of the Just",
        "issue_title": "Sleep of the Just",
        "number": "1",
        "source_url": "Source2"
    }

    candidates = [
        {"metadata": cand_redundant, "score": 0.95, "source": "Source1"},
        {"metadata": cand_story_title, "score": 0.88, "source": "Source2"},
    ]

    merged = merge_best_metadata_fields(candidates)

    assert merged["series"] == "Sandman"
    assert merged["issue_title"] == "Sleep of the Just"
    assert merged["number"] == "1"


def test_consolidate_all_candidates_end_to_end():
    """consolidate_all_candidates synthesizes fields across candidates belonging to the same issue."""
    raw = [
        ({
            "series": "Daredevil",
            "number": "1",
            "publisher": "Marvel",
            "writer": "Chip Zdarsky",
            "source_url": "https://comicvine.gamespot.com/daredevil-1"
        }, 0.96, "ComicVine"),
        ({
            "series": "Daredevil",
            "number": "1",
            "publisher": "Marvel",
            "penciller": "Marco Checchetto",
            "description": "Matt Murdock must face his inner demons in this acclaimed new chapter.",
            "source_url": "https://metron.cloud/issue/daredevil-1"
        }, 0.91, "Metron")
    ]

    results = consolidate_all_candidates(raw)
    assert len(results) == 1
    best_meta, score, src_str = results[0]

    assert score == 0.96
    assert best_meta["series"] == "Daredevil"
    assert best_meta["number"] == "1"
    assert best_meta["writer"] == "Chip Zdarsky"
    assert best_meta["penciller"] == "Marco Checchetto"
    assert "Matt Murdock" in best_meta["description"]
    assert "comicvine.gamespot.com" in src_str
    assert "metron.cloud" in src_str
