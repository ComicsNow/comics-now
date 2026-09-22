"""Thread-safe per-domain rate limiter to avoid DDoS / rate limit triggers."""
import time
import random
import threading
from urllib.parse import urlparse


class DomainRateLimiter:
    """Enforces minimum intervals and anti-bot jitter between requests to the same domain.
    
    Prevents triggering Web Application Firewalls (Cloudflare, AWS WAF) or API rate limits
    (e.g., ComicVine 200 req/hr) while allowing independent domains to execute without blocking each other.
    """
    def __init__(self):
        self._last_call = {}
        self._lock = threading.Lock()
        # Minimum seconds between requests per domain
        self._delays = {
            "comicvine.gamespot.com": 1.0,  # 1 req/sec max (well within 200/hr limit)
            "metron.cloud": 0.5,
            "comics.org": 0.5,
            "leagueofcomicgeeks.com": 1.0,
            "goodreads.com": 2.0,
            "blackwells.co.uk": 2.0,
            "waterstones.com": 2.0,
            "googleapis.com": 0.2,
            "amazon.com": 2.5,
            "amazon.co.uk": 2.5,
            "amazon.": 2.5,
            "media-amazon.com": 0.2,
        }
        self._local = threading.local()
        self._default_delay = 0.5

    def set_thread_callback(self, cb):
        self._local.callback = cb

    def clear_thread_callback(self):
        self._local.callback = None

    def wait_for_domain(self, url_or_domain: str, jitter: bool = True, on_wait=None):
        """Sleep only if the elapsed time since the last request to this domain is less than the minimum interval."""
        if not url_or_domain:
            return
        if "://" in url_or_domain:
            domain = urlparse(url_or_domain).netloc.lower()
        else:
            domain = url_or_domain.lower()

        # Match known domain aliases
        matched_domain = domain
        for key in self._delays:
            if key in domain:
                matched_domain = key
                break

        min_interval = self._delays.get(matched_domain, self._default_delay)

        with self._lock:
            now = time.time()
            last = self._last_call.get(matched_domain, 0.0)
            elapsed = now - last
            if elapsed < min_interval:
                sleep_time = min_interval - elapsed
                if jitter and min_interval >= 1.0:
                    sleep_time += random.uniform(0.1, 0.3)
                
                cb = on_wait or getattr(self._local, "callback", None)
                if cb and sleep_time >= 0.3:
                    try:
                        cb(f"Rate defense / API cooldown: waiting {round(sleep_time, 1)}s ({matched_domain})")
                    except Exception:
                        pass

                time.sleep(sleep_time)
                self._last_call[matched_domain] = time.time()
            else:
                self._last_call[matched_domain] = now

    def reset(self):
        """Reset all rate limiting timestamps (for testing/cleanup)."""
        with self._lock:
            self._last_call.clear()


domain_limiter = DomainRateLimiter()
