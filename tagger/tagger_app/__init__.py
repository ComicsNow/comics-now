"""tagger_app package (incremental decomposition of the legacy tagger.py monolith)."""
try:
    import urllib3.contrib
    if not hasattr(urllib3.contrib, 'appengine'):
        urllib3.contrib.appengine = None
except Exception:
    pass

