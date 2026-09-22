"""Filename -> search query normalization, shared by every source resolver."""
import re


def clean_search_query(filename):
    """Derive a search query from a comic filename.

    Drops: the .cbz extension; bracketed tags like (2024) / (Digital) / [scan];
    explicit volume markers (v2, vol. 3); explicit issue markers (#2); and
    zero-padded issue numbers (01, 002, 0007).

    Keeps bare numbers without a leading zero (e.g. the '2' in
    "Justice League vs Godzilla vs Kong 2"), since those are often part of the title.
    """
    q = filename
    if q.lower().endswith('.cbz'):
        q = q[:-4]
    q = re.sub(r'[\(\[\{].*?[\)\]\}]', '', q)                              # (2024) (Digital) [scan]
    q = re.sub(r'\bv(ol|olume)?\.?\s*\d+\b', '', q, flags=re.IGNORECASE)   # v2 / vol. 3
    q = re.sub(r'#\d+\b', '', q)                                          # #2
    q = re.sub(r'\b0\d+\b', '', q)                                        # zero-padded issue nums: 01, 002
    q = ' '.join(q.split()).strip()
    return q
