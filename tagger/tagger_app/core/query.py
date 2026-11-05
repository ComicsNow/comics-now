"""Filename -> search query normalization, shared by every source resolver."""
import re

COMIC_EXTENSIONS = ('.cbz', '.cbr', '.rar', '.pdf')


def strip_comic_extension(filename):
    """Remove a known comic container extension, case-insensitively."""
    if not filename:
        return filename
    lower = filename.lower()
    for extension in COMIC_EXTENSIONS:
        if lower.endswith(extension):
            return filename[:-len(extension)]
    return filename


def clean_search_query(filename):
    """Derive a search query from a comic filename.

    Drops: known comic extensions (.cbz/.cbr/.rar/.pdf); bracketed tags like
    (2024) / (Digital) / [scan];
    explicit volume markers (v2, vol. 3); explicit issue markers (#2); and
    zero-padded issue numbers (01, 002, 0007).

    Keeps bare numbers without a leading zero (e.g. the '2' in
    "Justice League vs Godzilla vs Kong 2"), since those are often part of the title.
    """
    q = strip_comic_extension(filename)
    q = re.sub(r'[\(\[\{].*?[\)\]\}]', '', q)                              # (2024) (Digital) [scan]
    q = re.sub(r'\bv(ol|olume)?\.?\s*\d+\b', '', q, flags=re.IGNORECASE)   # v2 / vol. 3
    q = re.sub(r'#\d+\b', '', q)                                          # #2
    q = re.sub(r'\b0\d+\b', '', q)                                        # zero-padded issue nums: 01, 002
    q = ' '.join(q.split()).strip()
    return q
