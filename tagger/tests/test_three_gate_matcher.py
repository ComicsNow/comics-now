"""Unit and integration tests for the 3-Gate Continuity Matcher (Cover -> Title -> Volume/Issue)."""
import sqlite3
import pytest
from pathlib import Path
from PIL import Image
import imagehash
from tagger_app.continuity.db import init_continuity_db, upsert_reading_order
from tagger_app.continuity.three_gate_matcher import ThreeGateMatcher


@pytest.fixture
def test_setup(tmp_path):
    ro_path = tmp_path / "reading-orders.db"
    ro_conn = sqlite3.connect(str(ro_path))
    ro_conn.row_factory = sqlite3.Row
    init_continuity_db(ro_conn)

    upsert_reading_order(ro_conn, {
        "id": "batman-fear-state",
        "title": "Batman: Fear State",
        "publisher": "DC Comics",
        "issue_count": 1,
    })

    # Create dummy cover images with patterns
    covers_dir = tmp_path / "covers"
    covers_dir.mkdir()

    from PIL import ImageDraw

    # Cover A: Pattern A (vertical stripes)
    img_a = Image.new("RGB", (100, 150), color=(255, 255, 255))
    draw_a = ImageDraw.Draw(img_a)
    for x in range(0, 100, 10):
        draw_a.line([(x, 0), (x, 150)], fill=(0, 0, 0), width=3)
    path_a = covers_dir / "ul_vol2.png"
    img_a.save(path_a)
    hash_a = str(imagehash.dhash(img_a))

    # Cover B: Pattern B (horizontal stripes)
    img_b = Image.new("RGB", (100, 150), color=(255, 255, 255))
    draw_b = ImageDraw.Draw(img_b)
    for y in range(0, 150, 15):
        draw_b.line([(0, y), (100, y)], fill=(0, 0, 0), width=3)
    path_b = covers_dir / "hq_iss7.png"
    img_b.save(path_b)
    hash_b = str(imagehash.dhash(img_b))

    ro_conn.execute(
        """
        INSERT INTO reading_order_collections (
            id, reading_order_id, position, title, subtitle, volume_number, release_year, cover_hash
        ) VALUES ('col_1', 'batman-fear-state', 5, 'Batman: Urban Legends', 'Volume 2', '2', 2022, ?)
        """,
        (hash_a,),
    )

    ro_conn.execute(
        """
        INSERT INTO reading_order_issues (
            reading_order_id, position, series_name, issue_number, publication_date, cover_hash
        ) VALUES ('batman-fear-state', 4, 'Harley Quinn', '7', '2021-11-01', ?)
        """,
        (hash_b,),
    )

    ro_conn.commit()
    ro_conn.close()

    return {
        "ro_db": str(ro_path),
        "covers_dir": covers_dir,
        "hash_a": hash_a,
        "hash_b": hash_b,
        "img_a": img_a,
        "img_b": img_b,
    }


def test_gate1_cover_distance_rejection(test_setup, tmp_path):
    matcher = ThreeGateMatcher(ro_db_path=test_setup["ro_db"])
    matcher.load_indices()

    # Comic with matching cover A (Urban Legends Vol 2)
    comic_thumb_matching = tmp_path / "thumb_match.jpg"
    test_setup["img_a"].save(comic_thumb_matching)

    # Comic with non-matching green cover (e.g. Urban Legends Vol 3)
    img_c = Image.new("RGB", (100, 150), color=(10, 200, 30))
    comic_thumb_mismatched = tmp_path / "thumb_mismatch.jpg"
    img_c.save(comic_thumb_mismatched)

    comic_match = {
        "id": "c1",
        "name": "01 Batman - Urban Legends - Vol. 2 [DC Comics] (2022).cbz",
        "series": "Batman - Urban Legends",
        "publisher": "DC Comics",
        "metadata": '{"Volume": "2", "Year": 2022}',
        "thumb_path": str(comic_thumb_matching),
    }

    res_match = matcher.match_comic(comic_match)
    assert res_match is not None
    assert res_match["matchedArc"] == "Batman: Fear State"
    assert res_match["storyArcNumber"] == "5"

    comic_mismatch = {
        "id": "c2",
        "name": "01 Batman - Urban Legends - Vol. 3 [DC Comics] (2022).cbz",
        "series": "Batman - Urban Legends",
        "publisher": "DC Comics",
        "metadata": '{"Volume": "3", "Year": 2022}',
        "thumb_path": str(comic_thumb_mismatched),
    }

    # Gate 1 visual hash mismatch MUST reject the comic!
    res_mismatch = matcher.match_comic(comic_mismatch)
    assert res_mismatch is None


def test_gate2_publisher_guard(test_setup, tmp_path):
    matcher = ThreeGateMatcher(ro_db_path=test_setup["ro_db"])
    matcher.load_indices()

    # Even if cover matches by coincidence, mismatched publisher must be rejected by Gate 2
    comic_thumb = tmp_path / "thumb.jpg"
    test_setup["img_a"].save(comic_thumb)

    comic_marvel = {
        "id": "c3",
        "name": "Civil War #1.cbz",
        "series": "Civil War",
        "publisher": "Marvel Comics",
        "metadata": '{"Year": 2006}',
        "thumb_path": str(comic_thumb),
    }

    res = matcher.match_comic(comic_marvel)
    assert res is None


def test_gate3_volume_alignment(test_setup, tmp_path):
    matcher = ThreeGateMatcher(ro_db_path=test_setup["ro_db"])
    matcher.load_indices()

    comic_thumb = tmp_path / "thumb.jpg"
    test_setup["img_a"].save(comic_thumb)

    # Vol 2 comic with Vol 2 metadata matches collection with volume 2
    comic = {
        "id": "c4",
        "name": "Batman: Urban Legends.cbz",
        "series": "Batman: Urban Legends",
        "publisher": "DC Comics",
        "metadata": '{"Volume": "2", "Year": 2022}',
        "thumb_path": str(comic_thumb),
    }
    res = matcher.match_comic(comic)
    assert res is not None
    assert res["storyArcNumber"] == "5"


def test_two_pass_collection_precedence(tmp_path):
    ro_path = tmp_path / "ro_two_pass.db"
    ro_conn = sqlite3.connect(str(ro_path))
    ro_conn.row_factory = sqlite3.Row
    init_continuity_db(ro_conn)

    upsert_reading_order(ro_conn, {
        "id": "absolute-universe",
        "title": "Absolute Universe",
        "publisher": "DC Comics",
        "issue_count": 1,
    })

    from PIL import ImageDraw

    # Pattern for comic thumbnail: vertical stripes
    img_comic = Image.new("RGB", (100, 150), color=(255, 255, 255))
    draw_c = ImageDraw.Draw(img_comic)
    for x in range(0, 100, 10):
        draw_c.line([(x, 0), (x, 150)], fill=(0, 0, 0), width=3)
    thumb_path = tmp_path / "gl_thumb.jpg"
    img_comic.save(thumb_path)
    hash_comic = str(imagehash.dhash(img_comic))

    # Issue has identical artwork to comic thumbnail (dist = 0)
    hash_iss = hash_comic

    # Collection has a trade dress logo in corner (dist = 4 bits)
    img_coll = img_comic.copy()
    draw_coll = ImageDraw.Draw(img_coll)
    draw_coll.rectangle([0, 0, 15, 15], fill=(0, 0, 0))
    hash_coll = str(imagehash.dhash(img_coll))

    # Insert collection at position 5
    ro_conn.execute(
        """
        INSERT INTO reading_order_collections (
            id, reading_order_id, position, title, subtitle, release_year, cover_hash
        ) VALUES ('col_gl', 'absolute-universe', 5, 'Absolute Green Lantern: Volume 1', 'Without Fear', 2025, ?)
        """,
        (hash_coll,),
    )

    # Insert issue range at position 8
    ro_conn.execute(
        """
        INSERT INTO reading_order_issues (
            reading_order_id, position, series_name, issue_number, publication_date, cover_hash
        ) VALUES ('absolute-universe', 8, 'Absolute Green Lantern', '1-6', '2025-01-01', ?)
        """,
        (hash_iss,),
    )
    ro_conn.commit()
    ro_conn.close()

    matcher = ThreeGateMatcher(ro_db_path=str(ro_path))
    matcher.load_indices()

    comic_vol1 = {
        "id": "c_gl_1",
        "name": "01 Absolute Green Lantern - Vol: 1 [DC Comics] (2025).cbz",
        "series": "Absolute Green Lantern",
        "publisher": "DC Comics",
        "metadata": '{"Volume": "1", "Number": "1", "Year": 2025}',
        "thumb_path": str(thumb_path),
    }

    res = matcher.match_comic(comic_vol1)
    assert res is not None
    # MUST match Collection #5 in Pass 1, NOT Issue #8 in Pass 2!
    assert res["matchedType"] == "collection"
    assert res["storyArcNumber"] == "5"


def test_corrupt_thumbnail_rejection(test_setup, tmp_path):
    matcher = ThreeGateMatcher(ro_db_path=test_setup["ro_db"])
    matcher.load_indices()

    corrupt_thumb = tmp_path / "corrupt.jpg"
    corrupt_thumb.write_text("not an image")

    comic = {
        "id": "c_corrupt",
        "name": "Batman #1.cbz",
        "series": "Batman",
        "publisher": "DC Comics",
        "metadata": '{"Number": "1"}',
        "thumb_path": str(corrupt_thumb),
    }

    res = matcher.match_comic(comic)
    # Corrupt thumbnail must NOT fall back to dist=0 and produce false positives
    assert res is None
