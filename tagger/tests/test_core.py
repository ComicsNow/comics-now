"""Unit tests for the extracted tagger_app.core modules (architecture step 1).

These exercise the modules directly (not via the tagger shim) so the new package has
standalone coverage. A separate test asserts the shim still re-exports them.
"""
import io
import os
import zipfile
import xml.etree.ElementTree as ET

import pytest

from tagger_app.core import metadata, comicinfo, covers


# --------------------------------------------------------------- metadata
def test_calculate_similarity_identical_and_empty():
    assert metadata.calculate_similarity("Batman", "batman") == 1.0
    assert metadata.calculate_similarity("", "x") == 0.0
    assert metadata.calculate_similarity("x", "") == 0.0


def test_calculate_similarity_ignores_year_token():
    # the (2019) year token is stripped before comparison
    assert metadata.calculate_similarity("Watchmen (2019)", "Watchmen") == 1.0


def test_clean_author_names_filters_generic_and_corporate():
    out = metadata.clean_author_names(["Alan Moore", "Various", "DC Comics", "", None])
    assert out == ["Alan Moore"]


def test_normalize_metadata_splits_series_and_number():
    m = metadata.normalize_metadata({"title": "Watchmen #1"})
    assert m["series"] == "Watchmen"
    assert m["number"] == "1" and m["issue_number"] == "1"


def test_normalize_metadata_splits_volume_series_and_title():
    # Trade paperback with volume and subtitle: Series must not include Vol or subtitle
    m1 = metadata.normalize_metadata({"title": "Batman/Superman: World's Finest Vol. 9: The Merger"})
    assert m1["series"] == "Batman/Superman: World's Finest"
    assert m1["title"] == "Vol. 9: The Merger"
    assert m1["number"] == "9"
    assert m1["volume"] == "9"

    # Volume 1 format
    m2 = metadata.normalize_metadata({"series": "Assorted Crisis Events", "title": "Volume 1"})
    assert m2["series"] == "Assorted Crisis Events"
    assert m2["title"] == "Volume 1"
    assert m2["number"] == "1"
    assert m2["volume"] == "1"

    # Volume 2 format inside series
    m3 = metadata.normalize_metadata({"series": "Assorted Crisis Events Volume 2"})
    assert m3["series"] == "Assorted Crisis Events"
    assert m3["title"] == "Volume 2"
    assert m3["number"] == "2"
    assert m3["volume"] == "2"

    # Lowercase volume
    m4 = metadata.normalize_metadata({"title": "Assorted Crisis Events volume 1"})
    assert m4["series"] == "Assorted Crisis Events"
    assert m4["title"] == "volume 1"
    assert m4["number"] == "1"
    assert m4["volume"] == "1"


def test_calculate_similarity_short_substring_rejection():
    # Short substring word matches like "Crisis" vs "Assorted Crisis Events" must not get 0.90
    sim = metadata.calculate_similarity("Assorted Crisis Events v01 (2025) (Digital) (DR & Quinch-Empire).cbz", "Crisis")
    assert sim < 0.60


def test_normalize_metadata_preserves_number_in_name():
    # "100 Bullets" must not have its 100 trimmed when no explicit issue number set
    m = metadata.normalize_metadata({"title": "100 Bullets"})
    assert m["series"] == "100 Bullets"


def test_normalize_publisher_canonical_and_codex():
    assert metadata.normalize_publisher("DC") == "DC Comics"
    assert metadata.normalize_publisher("dc") == "DC Comics"
    assert metadata.normalize_publisher("DC Comics") == "DC Comics"
    assert metadata.normalize_publisher("image comics") == "Image"
    assert metadata.normalize_publisher("imagev comics") == "Image"
    assert metadata.normalize_publisher("Image") == "Image"
    assert metadata.normalize_publisher("Oni Press,US") == "Oni Press"
    assert metadata.normalize_publisher("Dark Horse Comics,U.S.") == "Dark Horse Comics"
    assert metadata.normalize_publisher("Papercutz, Inc.") == "Papercutz"
    assert metadata.normalize_publisher("Boom Studios") == "Boom! Studios"

    codex = ["DC Comics", "Image", "Top Shelf", "Boom! Studios", "Panini Comics"]
    assert metadata.normalize_publisher("Top Shelf Productions", codex=codex) == "Top Shelf"
    assert metadata.normalize_publisher("Panini", codex=codex) == "Panini Comics"


def test_clean_description_spec_dumps():
    junk_oni = "Publisher informationPublisher:Oni Press,USISBN:9798894880884Number of pages:240Dimensions:287x196x18mmWeight:970 gLanguage:English"
    assert metadata.clean_description(junk_oni) == ""

    junk_dh = "Publisher informationPublisher:Dark Horse Comics,U.S.ISBN:9781506753249Number of pages:88Dimensions:282x220mmLanguage:English"
    assert metadata.clean_description(junk_dh) == ""


def test_clean_description_bookstore_ads_and_placeholders():
    lcg_boilerplate = "Read reviews and discussion of DC Finest: War – The Big Five Arrive TP from Bill Finger, published by DC Comics"
    assert metadata.clean_description(lcg_boilerplate) == ""

    real_with_ad = "Synopsis: Duncan was the naive son of a minor nobleman, more interested in romance than war. Available now from Waterstones."
    assert metadata.clean_description(real_with_ad) == "Duncan was the naive son of a minor nobleman, more interested in romance than war."

    assert metadata.clean_description("No description available.") == ""
    assert metadata.clean_description("No synopsis available.") == ""
    assert metadata.clean_description("Why choose Blackwell's? Free UK delivery on orders over £25.") == ""


def test_clean_description_foreign_language_safeguard():
    german_desc = "Der junge Peter Parker wird von einer radioaktiven Spinne gebissen und erhält übermenschliche Kräfte."
    assert metadata.clean_description(german_desc) == ""

    french_desc = "Une aventure palpitante où le jeune héros découvre ses pouvoirs et affronte de dangereux ennemis."
    assert metadata.clean_description(french_desc) == ""

    spanish_desc = "Una historia increíble donde los héroes unen sus fuerzas para salvar el mundo de una terrible amenaza."
    assert metadata.clean_description(spanish_desc) == ""

    english_desc = "Peter Parker gains extraordinary powers after being bitten by a radioactive spider in this classic origin story."
    assert metadata.clean_description(english_desc) == "Peter Parker gains extraordinary powers after being bitten by a radioactive spider in this classic origin story."


def test_is_foreign_publisher():
    assert metadata.is_foreign_publisher("Planeta DeAgostini") is True
    assert metadata.is_foreign_publisher("Editorial Televisa") is True
    assert metadata.is_foreign_publisher("Editora Abril") is True
    assert metadata.is_foreign_publisher("ECC Ediciones") is True
    assert metadata.is_foreign_publisher("Carlsen Verlag") is True
    assert metadata.is_foreign_publisher("Glénat") is True
    assert metadata.is_foreign_publisher("Panini Comics") is True
    assert metadata.is_foreign_publisher("Panini Verlag") is True

    # Publishers in user's library are removed from foreign blacklist
    assert metadata.is_foreign_publisher("Cross Cult") is False
    assert metadata.is_foreign_publisher("Delcourt") is False
    assert metadata.is_foreign_publisher("Norma Editorial") is False
    assert metadata.is_foreign_publisher("Splitter") is False
    assert metadata.is_foreign_publisher("DC Comics") is False
    assert metadata.is_foreign_publisher("Marvel") is False
    assert metadata.is_foreign_publisher("Image") is False
    assert metadata.is_foreign_publisher("Oni Press") is False
    assert metadata.is_foreign_publisher("Dark Horse Comics") is False

    # Codex override test
    codex = ["Carlsen Verlag", "Glénat"]
    assert metadata.is_foreign_publisher("Carlsen Verlag", codex=codex) is False
    assert metadata.is_foreign_publisher("Glénat", codex=codex) is False


# --------------------------------------------------------------- comicinfo
def test_generate_comic_info_xml_is_valid_and_has_fields():
    xml = comicinfo.generate_comic_info_xml({"series": "Watchmen", "number": "1", "title": "Watchmen #1"})
    root = ET.fromstring(xml)
    assert root.tag == "ComicInfo"
    assert root.findtext("Series") == "Watchmen"
    assert root.findtext("Number") == "1"
    # Title is the same as series (plus #1), so Title must be omitted
    assert root.find("Title") is None


def test_generate_comic_info_xml_omits_title_matching_series_with_number_suffix():
    xml = comicinfo.generate_comic_info_xml({
        "series": "Do a Powerbomb Black and White",
        "title": "Do a Powerbomb Black and White #3",
        "number": "3"
    })
    root = ET.fromstring(xml)
    assert root.findtext("Series") == "Do a Powerbomb Black and White"
    assert root.findtext("Number") == "3"
    assert root.find("Title") is None

    # Also with bare digit at end
    xml2 = comicinfo.generate_comic_info_xml({
        "series": "Do a Powerbomb Black and White",
        "title": "Do a Powerbomb Black and White 3",
        "number": "3"
    })
    root2 = ET.fromstring(xml2)
    assert root2.findtext("Series") == "Do a Powerbomb Black and White"
    assert root2.find("Title") is None


def test_generate_comic_info_xml_retains_distinct_title():
    xml = comicinfo.generate_comic_info_xml({
        "series": "The Amazing Spider-Man",
        "title": "The Death of Gwen Stacy",
        "number": "121"
    })
    root = ET.fromstring(xml)
    assert root.findtext("Series") == "The Amazing Spider-Man"
    assert root.findtext("Title") == "The Death of Gwen Stacy"
    assert root.findtext("Number") == "121"


def test_is_title_same_as_series():
    assert metadata.is_title_same_as_series("Do a Powerbomb Black and White #3", "Do a Powerbomb Black and White") is True
    assert metadata.is_title_same_as_series("Do a Powerbomb Black and White 3", "Do a Powerbomb Black and White") is True
    assert metadata.is_title_same_as_series("Do a Powerbomb Black and White #03 (of 3)", "Do a Powerbomb Black and White") is True
    assert metadata.is_title_same_as_series("Do a Powerbomb Black and White", "Do a Powerbomb Black and White") is True
    assert metadata.is_title_same_as_series("Do a Powerbomb TP", "Do A Powerbomb") is True
    assert metadata.is_title_same_as_series("HC", "GoSt") is True
    assert metadata.is_title_same_as_series("Batman #45", "Batman") is True
    assert metadata.is_title_same_as_series("Batman 45", "Batman") is True
    assert metadata.is_title_same_as_series("100 Bullets #5", "100 Bullets") is True
    assert metadata.is_title_same_as_series("100 Bullets 5", "100 Bullets") is True
    assert metadata.is_title_same_as_series("Batman: Year One", "Batman") is False
    assert metadata.is_title_same_as_series("The Death of Gwen Stacy", "The Amazing Spider-Man") is False
    assert metadata.is_title_same_as_series("Volume 1: The Court of Owls", "Batman") is False


def test_clean_format_and_edition_strips_format_tags():
    assert metadata.clean_format_and_edition("Batman: Year One (TPB)") == "Batman: Year One"
    assert metadata.clean_format_and_edition("Batman: Year One [HC]") == "Batman: Year One"
    assert metadata.clean_format_and_edition("Batman: Year One {HB}") == "Batman: Year One"
    assert metadata.clean_format_and_edition("Batman: Year One (Paperback)") == "Batman: Year One"
    assert metadata.clean_format_and_edition("Batman: Year One - Hardcover") == "Batman: Year One"
    assert metadata.clean_format_and_edition("Batman: Year One - Trade Paperback") == "Batman: Year One"
    assert metadata.clean_format_and_edition("Batman: Year One SC") == "Batman: Year One"
    assert metadata.clean_format_and_edition("Batman: Year One GN") == "Batman: Year One"
    assert metadata.clean_format_and_edition("DC Finest - War - TPB") == "DC Finest - War"
    assert metadata.clean_format_and_edition("DC Finest - War (1957) - The Big Five Arrive (2025) (digital) (Son of Ultron-Empire)") == "DC Finest - War (1957) - The Big Five Arrive (2025) (Son of Ultron-Empire)"
    assert metadata.clean_format_and_edition("Batman: Digital Justice") == "Batman: Digital Justice"


def test_generate_comic_info_xml_retains_series_and_omits_title_when_title_matches():
    xml = comicinfo.generate_comic_info_xml({"series": "Batman: Year One", "title": "Batman: Year One", "number": "1"})
    root = ET.fromstring(xml)
    assert root.tag == "ComicInfo"
    assert root.findtext("Series") == "Batman: Year One"
    assert root.find("Title") is None


def test_generate_comic_info_xml_cleans_format_and_omits_matching_title():
    xml = comicinfo.generate_comic_info_xml({
        "series": "DC Finest: War – The Big Five TPB",
        "title": "DC Finest: War – The Big Five (digital)",
        "number": "1"
    })
    root = ET.fromstring(xml)
    assert root.tag == "ComicInfo"
    assert root.findtext("Series") == "DC Finest: War – The Big Five"
    assert root.find("Title") is None


def test_write_then_read_comic_info_roundtrip(tmp_path):
    cbz = tmp_path / "book.cbz"
    with zipfile.ZipFile(cbz, "w") as z:
        z.writestr("001.jpg", b"not-a-real-image")  # presence only
    xml = comicinfo.generate_comic_info_xml({"series": "Saga", "number": "3", "title": "Saga #3"})
    comicinfo.write_comic_info_to_cbz(str(cbz), xml)

    meta = comicinfo.read_comic_info_xml(str(cbz))
    assert meta is not None
    assert meta.get("series") == "Saga"
    assert str(meta.get("number")) == "3"


# --------------------------------------------------------------- covers
def _make_cbz_with_image(path):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (40, 60), (10, 20, 30)).save(buf, format="JPEG")
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("01_cover.jpg", buf.getvalue())


def test_extract_cover_from_cbz(tmp_path):
    cbz = tmp_path / "comic.cbz"
    _make_cbz_with_image(cbz)
    out = covers.extract_cover_from_cbz(str(cbz), output_dir=str(tmp_path / "covers"))
    assert os.path.exists(out)
    assert out.lower().endswith(".jpg")


def test_extract_cover_rejects_non_zip(tmp_path):
    bad = tmp_path / "bad.cbz"
    bad.write_text("nope")
    with pytest.raises(ValueError):
        covers.extract_cover_from_cbz(str(bad), output_dir=str(tmp_path))


def test_resolve_creator_roles_prunes_artist_from_writer():
    meta = {
        "writer": "James Tynion IV, Ben Templesmith",
        "penciller": "Ben Templesmith"
    }
    out = metadata.resolve_creator_roles(meta)
    assert out["writer"] == "James Tynion IV"
    assert out["penciller"] == "Ben Templesmith"


def test_resolve_creator_roles_extracts_from_description():
    meta = {
        "writer": "James Tynion IV, Martin Simmonds, Letizia Cadonici",
        "description": "Multiple Eisner Award-winning writer JAMES TYNION IV and Eisner Award-nominated artist MARTIN SIMMONDS test the limit, while fan-favorite artist LETIZIA CADONICI joins."
    }
    out = metadata.resolve_creator_roles(meta)
    assert out["writer"] == "James Tynion IV"
    assert "Martin Simmonds" in out["penciller"]
    assert "Letizia Cadonici" in out["penciller"]

