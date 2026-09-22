"""Source registry.

Declares the available metadata providers in priority order, tier grouping, how each one is
enabled (alias matching), the progress message it emits, and a uniform adapter to
invoke its resolver.
"""
from dataclasses import dataclass
from typing import Callable, Optional

from tagger_app.sources import (
    comicvine, metron, gcd, lcg, goodreads, blackwells, waterstones, googlebooks, amazon,
)


@dataclass(frozen=True)
class SourceContext:
    """Inputs shared across all source resolvers for a single lookup."""
    comicvine_api_key: Optional[str] = None
    google_books_api_key: Optional[str] = None
    metron_user: Optional[str] = None
    metron_pass: Optional[str] = None
    cover_path: Optional[str] = None
    existing_meta: Optional[dict] = None


@dataclass(frozen=True)
class Source:
    id: str
    label: str
    aliases: frozenset
    search_message: str
    resolve: Callable  # (filename, ctx: SourceContext, on_progress) -> list | None
    tier: int = 1

    def is_enabled(self, enabled_sources):
        # No explicit selection means "all sources enabled" (legacy default).
        if not enabled_sources:
            return True
        if self.id in enabled_sources:
            return True
        return any(alias in enabled_sources for alias in self.aliases)


SOURCES = [
    Source(
        "src-comicvine", "ComicVine",
        frozenset({"src-comicvine", "comicvine"}),
        "Searching ComicVine...",
        lambda f, ctx, prog: comicvine.resolve_comicvine(
            f, ctx.comicvine_api_key, cover_path=ctx.cover_path,
            on_progress=prog, existing_meta=ctx.existing_meta),
        tier=1,
    ),
    Source(
        "src-metron", "Metron",
        frozenset({"src-metron", "metron", "src-metron-gcd", "metron-gcd"}),
        "Searching Metron...",
        lambda f, ctx, prog: metron.resolve_metron(
            f, metron_user=ctx.metron_user, metron_pass=ctx.metron_pass,
            cover_path=ctx.cover_path, on_progress=prog, existing_meta=ctx.existing_meta),
        tier=1,
    ),
    Source(
        "src-gcd", "GCD",
        frozenset({"src-gcd", "gcd", "src-metron-gcd", "metron-gcd"}),
        "Searching Grand Comics Database (GCD)...",
        lambda f, ctx, prog: gcd.resolve_gcd(
            f, cover_path=ctx.cover_path, on_progress=prog, existing_meta=ctx.existing_meta),
        tier=1,
    ),
    Source(
        "src-lcg", "League of Comic Geeks",
        frozenset({"src-lcg", "lcg"}),
        "Searching League of Comic Geeks...",
        lambda f, ctx, prog: lcg.resolve_lcg(
            f, cover_path=ctx.cover_path, on_progress=prog, existing_meta=ctx.existing_meta),
        tier=1,
    ),
    Source(
        "src-goodreads", "Goodreads",
        frozenset({"src-goodreads", "goodreads"}),
        "Searching Goodreads...",
        lambda f, ctx, prog: goodreads.resolve_goodreads(
            f, cover_path=ctx.cover_path, on_progress=prog, existing_meta=ctx.existing_meta),
        tier=2,
    ),
    Source(
        "src-blackwells", "Blackwell's",
        frozenset({"src-blackwells", "blackwells"}),
        "Searching Blackwell's...",
        lambda f, ctx, prog: blackwells.resolve_blackwells(
            f, cover_path=ctx.cover_path, on_progress=prog, existing_meta=ctx.existing_meta),
        tier=2,
    ),
    Source(
        "src-waterstones", "Waterstones",
        frozenset({"src-waterstones", "waterstones"}),
        "Searching Waterstones...",
        lambda f, ctx, prog: waterstones.resolve_waterstones(
            f, cover_path=ctx.cover_path, on_progress=prog, existing_meta=ctx.existing_meta),
        tier=2,
    ),
    Source(
        "src-googlebooks", "Google Books",
        frozenset({"src-googlebooks", "googlebooks", "google_books", "google-books"}),
        "Searching Google Books...",
        lambda f, ctx, prog: googlebooks.resolve_googlebooks(
            f, api_key=ctx.google_books_api_key, cover_path=ctx.cover_path,
            on_progress=prog, existing_meta=ctx.existing_meta),
        tier=2,
    ),
    Source(
        "src-amazon", "Amazon",
        frozenset({"src-amazon", "amazon", "amz"}),
        "Searching Amazon...",
        lambda f, ctx, prog: amazon.resolve_amazon(
            f, cover_path=ctx.cover_path, on_progress=prog, existing_meta=ctx.existing_meta),
        tier=2,
    ),
]
