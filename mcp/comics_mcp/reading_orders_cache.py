import json
import re
import pathlib
from typing import Optional, Dict, Any, List

CACHE_DIR = pathlib.Path("/opt/comics-now/metadata/reading_orders")


def slugify(text: str) -> str:
    """Normalize event title into a filesystem-safe slug."""
    text = text.lower().strip()
    text = re.sub(r'[\s_]+', '-', text)
    text = re.sub(r'[^a-z0-9\-]', '', text)
    text = re.sub(r'-+', '-', text)
    return text.strip('-')


def save_order(title: str, data: Dict[str, Any]) -> str:
    """Save canonical reading order to local disk cache."""
    slug = slugify(title)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    file_path = CACHE_DIR / f"{slug}.json"
    file_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return slug


def get_cached_order(title_or_slug: str) -> Optional[Dict[str, Any]]:
    """Retrieve canonical reading order from disk cache if present."""
    slug = slugify(title_or_slug)
    file_path = CACHE_DIR / f"{slug}.json"
    if not file_path.exists():
        return None
    try:
        return json.loads(file_path.read_text(encoding="utf-8"))
    except Exception:
        return None


def list_cached_orders() -> List[Dict[str, Any]]:
    """List summary metadata for all cached reading orders."""
    if not CACHE_DIR.exists():
        return []
    summaries = []
    for f in CACHE_DIR.glob("*.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            summaries.append({
                "slug": f.stem,
                "title": data.get("title", f.stem),
                "source": data.get("source", "unknown"),
                "item_count": len(data.get("items", [])),
                "description": data.get("description", "")
            })
        except Exception:
            continue
    return summaries
