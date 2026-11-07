"""Gemini Vision Arbiter for Story Arc cover matching and borderline verification."""
import os
import json
import base64
from pathlib import Path
from typing import Optional, Dict, Any
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[3]
if not (REPO_ROOT / "config.json").exists() and (Path(__file__).resolve().parents[2] / "config.json").exists():
    REPO_ROOT = Path(__file__).resolve().parents[2]

CONFIG_FILE = REPO_ROOT / "config.json"
RO_COVERS_DIR = REPO_ROOT / "cache" / "ro_covers"


def load_gemini_config() -> Dict[str, Any]:
    """Load Gemini configuration settings from config.json or environment."""
    cfg = {}
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                cfg = json.load(f)
        except Exception:
            pass

    api_key = os.environ.get("GEMINI_API_KEY") or cfg.get("geminiApiKey", "")
    model = os.environ.get("GEMINI_MODEL") or cfg.get("geminiModel", "gemini-3.5-flash-lite")
    enabled = bool(cfg.get("geminiCoverMatchEnabled", True))

    return {
        "api_key": api_key.strip() if api_key else "",
        "model": model.strip() if model else "gemini-3.5-flash-lite",
        "enabled": enabled,
    }


class GeminiArbiter:
    """Multimodal vision arbiter comparing comic covers against reading order covers."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        enabled: Optional[bool] = None,
    ):
        cfg = load_gemini_config()
        self.api_key = api_key if api_key is not None else cfg["api_key"]
        self.model = model if model is not None else cfg["model"]
        self.enabled = enabled if enabled is not None else cfg["enabled"]

    def _read_image_base64(self, file_path: str) -> Optional[Dict[str, str]]:
        """Read and format image file as base64 with MIME type."""
        p = Path(file_path)
        if not p.exists() or p.stat().st_size == 0:
            return None
        try:
            ext = p.suffix.lower()
            mime = "image/png" if ext == ".png" else ("image/webp" if ext == ".webp" else "image/jpeg")
            with open(p, "rb") as f:
                data = base64.b64encode(f.read()).decode("utf-8")
            return {"mime_type": mime, "data": data}
        except Exception:
            return None

    def _call_gemini_vision(self, img_local: Dict[str, str], img_ro: Dict[str, str]) -> Any:
        """Execute multimodal comparison using google.genai Client."""
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=self.api_key)

        prompt = (
            "You are an expert comic book archivist and cover art identifier.\n"
            "Compare Image A (user comic book cover) with Image B (reading order story arc cover).\n"
            "Determine if they depict the same comic book issue or collected volume edition.\n"
            "Note: Image A and Image B may have slight variations in publisher trade dress, anniversary banners, "
            "barcode boxes, or minor cropping differences.\n"
            "Respond in JSON format conforming to the schema:\n"
            "{ \"match\": boolean, \"confidence\": float (0.0 to 1.0), \"reason\": string }"
        )

        part_a = types.Part.from_bytes(
            data=base64.b64decode(img_local["data"]),
            mime_type=img_local["mime_type"],
        )
        part_b = types.Part.from_bytes(
            data=base64.b64decode(img_ro["data"]),
            mime_type=img_ro["mime_type"],
        )

        response = client.models.generate_content(
            model=self.model,
            contents=[prompt, "Image A (User Comic Cover):", part_a, "Image B (Story Arc Cover):", part_b],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
        )
        return response

    def verify_cover_pair(self, local_cover_path: str, ro_cover_path: str) -> Dict[str, Any]:
        """Visually verify if two cover images depict the same comic edition."""
        if not self.enabled or not self.api_key:
            return {"match": False, "confidence": 0.0, "reason": "Gemini Arbiter disabled or API key missing"}

        img_local = self._read_image_base64(local_cover_path)
        img_ro = self._read_image_base64(ro_cover_path)

        if not img_local or not img_ro:
            return {"match": False, "confidence": 0.0, "reason": "Failed to read cover image files"}

        try:
            resp = self._call_gemini_vision(img_local, img_ro)
            text = getattr(resp, "text", "") or ""
            # Strip markdown fences if present
            cleaned = text.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

            parsed = json.loads(cleaned)
            return {
                "match": bool(parsed.get("match", False)),
                "confidence": float(parsed.get("confidence", 0.0)),
                "reason": str(parsed.get("reason", "")),
            }
        except Exception as e:
            return {"match": False, "confidence": 0.0, "reason": f"Gemini vision call failed: {e}"}
