"""SEC-007 — every outbound HTTP call must set a timeout.

A request without a timeout can hang forever on an unresponsive upstream, blocking the
worker thread. We assert this statically (AST) so new timeout-less calls fail CI.
"""
import ast
import os
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Scan the web layer plus every module in the tagger_app package (where the HTTP calls
# now live after the decomposition).
SOURCES = ["app.py"] + sorted(
    os.path.relpath(p, ROOT) for p in glob.glob(os.path.join(ROOT, "tagger_app", "**", "*.py"), recursive=True)
)
HTTP_METHODS = {"get", "post", "put", "delete", "head", "patch", "request"}


def _requests_calls_without_timeout(path):
    tree = ast.parse(open(path).read())
    offenders = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        # match requests.get(...), requests.post(...), session.get(...), etc.
        if isinstance(func, ast.Attribute) and func.attr in HTTP_METHODS:
            base = func.value
            is_requests = (isinstance(base, ast.Name) and base.id in ("requests", "session", "scraper")) \
                or (isinstance(base, ast.Attribute) and base.attr in ("requests", "session"))
            if not is_requests:
                continue
            has_timeout = any(kw.arg == "timeout" for kw in node.keywords)
            if not has_timeout:
                offenders.append((func.attr, node.lineno))
    return offenders


def test_no_requests_without_timeout():
    all_offenders = {}
    for src in SOURCES:
        off = _requests_calls_without_timeout(os.path.join(ROOT, src))
        if off:
            all_offenders[src] = off
    assert not all_offenders, f"HTTP calls missing timeout (SEC-007): {all_offenders}"
