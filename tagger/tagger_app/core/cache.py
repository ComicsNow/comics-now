"""Universal in-memory caching for all metadata sources and cover hashes with TTL."""
import time
import threading


class TaggerCache:
    """Thread-safe multi-category in-memory cache with TTL and LRU-style size limiting."""
    def __init__(self, ttl_seconds=7200, max_entries=1000):
        self._ttl = ttl_seconds
        self._max_entries = max_entries
        self._queries = {}             # (source, query) -> (results, ts)
        self._entities = {}            # (source, identifier) -> (data, ts)
        self._cover_phashes = {}       # image_url -> (phash_val, ts)
        self._lock = threading.Lock()

    def get_query(self, source: str, query: str):
        """Retrieve cached search query results if not expired."""
        with self._lock:
            key = (source.lower(), query.strip().lower())
            item = self._queries.get(key)
            if item:
                val, ts = item
                if time.time() - ts <= self._ttl:
                    return val
                del self._queries[key]
            return None

    def set_query(self, source: str, query: str, results):
        """Cache search query results."""
        with self._lock:
            if len(self._queries) >= self._max_entries:
                self._queries.clear()
            key = (source.lower(), query.strip().lower())
            self._queries[key] = (results, time.time())

    def get_entity(self, source: str, identifier: str):
        """Retrieve cached entity / volume / product metadata if not expired."""
        with self._lock:
            key = (source.lower(), str(identifier).strip())
            item = self._entities.get(key)
            if item:
                val, ts = item
                if time.time() - ts <= self._ttl:
                    return val
                del self._entities[key]
            return None

    def set_entity(self, source: str, identifier: str, data):
        """Cache entity / volume / product metadata."""
        with self._lock:
            if len(self._entities) >= self._max_entries:
                self._entities.clear()
            key = (source.lower(), str(identifier).strip())
            self._entities[key] = (data, time.time())

    def get_cover_phash(self, url: str):
        """Retrieve cached candidate cover pHash if not expired."""
        if not url:
            return None
        with self._lock:
            item = self._cover_phashes.get(url)
            if item:
                val, ts = item
                if time.time() - ts <= self._ttl:
                    return val
                del self._cover_phashes[url]
            return None

    def set_cover_phash(self, url: str, phash_val):
        """Cache candidate cover pHash."""
        if not url or phash_val is None:
            return
        with self._lock:
            if len(self._cover_phashes) >= self._max_entries:
                self._cover_phashes.clear()
            self._cover_phashes[url] = (phash_val, time.time())

    def clear(self):
        """Clear all caches."""
        with self._lock:
            self._queries.clear()
            self._entities.clear()
            self._cover_phashes.clear()


tagger_cache = TaggerCache()
