"""Submodules for tagger_app.core.metadata."""
from tagger_app.core.metadata_parts.publishers import (
    CANONICAL_PUBLISHER_MAP,
    COMMON_ENGLISH_WORDS,
    COMMON_FOREIGN_WORDS,
    IGNORED_FOREIGN_PUBLISHERS,
    normalize_publisher,
    is_foreign_publisher,
    is_english_text,
    clean_description,
)
from tagger_app.core.metadata_parts.creators import (
    clean_author_names,
    resolve_creator_roles,
)
from tagger_app.core.metadata_parts.titles import (
    VOL_SPLIT_PATTERN,
    STANDALONE_VOL_PATTERN,
    clean_format_and_edition,
    is_title_same_as_series,
    normalize_metadata,
)
from tagger_app.core.metadata_parts.scoring import (
    calculate_similarity,
    score_candidate,
    score_description_quality,
)
from tagger_app.core.metadata_parts.merger import (
    merge_best_metadata_fields,
)

__all__ = [
    "CANONICAL_PUBLISHER_MAP",
    "COMMON_ENGLISH_WORDS",
    "COMMON_FOREIGN_WORDS",
    "IGNORED_FOREIGN_PUBLISHERS",
    "VOL_SPLIT_PATTERN",
    "STANDALONE_VOL_PATTERN",
    "clean_author_names",
    "clean_format_and_edition",
    "is_title_same_as_series",
    "normalize_publisher",
    "is_foreign_publisher",
    "is_english_text",
    "clean_description",
    "resolve_creator_roles",
    "normalize_metadata",
    "calculate_similarity",
    "score_candidate",
    "score_description_quality",
    "merge_best_metadata_fields",
]
