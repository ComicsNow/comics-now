"""Cryptographic helper utilities and quota rate limiter for Comics Now."""
import os
import json
import time
import base64
import hashlib
from pathlib import Path
from typing import Dict, Any, List, Tuple
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

REPO_ROOT = Path(__file__).resolve().parents[3]
if not (REPO_ROOT / "comics-now.db").exists() and (Path(__file__).resolve().parents[2] / "comics-now.db").exists():
    REPO_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_SECRET = REPO_ROOT / "data" / ".app_secret"
DEFAULT_CONFIG = REPO_ROOT / "config.json"


def decrypt_secret(enc_str: str, secret_file: Path | str = DEFAULT_SECRET) -> str:
    """Decrypt Comics Now AES-256-GCM ciphertext (enc:v1:<iv>:<tag>:<ciphertext>)."""
    if not enc_str or not str(enc_str).startswith("enc:v1:"):
        return str(enc_str)
    p = Path(secret_file)
    if not p.exists():
        return str(enc_str)
    try:
        key = p.read_bytes()
        if len(key) != 32:
            key = hashlib.sha256(key).digest()
        parts = str(enc_str).split(":")
        if len(parts) != 5:
            return str(enc_str)
        iv = base64.b64decode(parts[2])
        tag = base64.b64decode(parts[3])
        ciphertext = base64.b64decode(parts[4])
        aesgcm = AESGCM(key)
        return aesgcm.decrypt(iv, ciphertext + tag, None).decode("utf-8")
    except Exception:
        return str(enc_str)


def load_continuity_gemini_config(config_path: Path | str = DEFAULT_CONFIG) -> Dict[str, Any]:
    """Load Gemini configuration settings with automatic AES-256-GCM decryption."""
    cfg = {}
    p = Path(config_path)
    if p.exists():
        try:
            with open(p, "r", encoding="utf-8") as f:
                cfg = json.load(f)
        except Exception:
            pass

    raw_key = os.environ.get("GEMINI_API_KEY") or cfg.get("geminiApiKey", "")
    secret_path = p.parent / "data" / ".app_secret" if (p.parent / "data" / ".app_secret").exists() else DEFAULT_SECRET
    decrypted_key = decrypt_secret(raw_key, secret_path)
    model = os.environ.get("GEMINI_MODEL") or cfg.get("geminiModel", "gemini-3.1-flash-lite")
    storage_mode = cfg.get("metadata_storage", "sidecar")

    return {
        "api_key": str(decrypted_key).strip(),
        "model": str(model).strip() or "gemini-3.1-flash-lite",
        "metadata_storage": str(storage_mode).strip().lower() or "sidecar",
    }


class TokenRateLimiter:
    """Sliding-window rate and token limiter for Gemini Free Tier (15 RPM / 250k TPM)."""

    def __init__(self, max_rpm: int = 12, max_tpm: int = 200_000, min_delay: float = 5.0):
        self.max_rpm = max_rpm
        self.max_tpm = max_tpm
        self.min_delay = min_delay
        self.last_call_time: float = 0.0
        self.usage_history: List[Tuple[float, int]] = []

    def wait_if_needed(self, estimated_tokens: int) -> None:
        """Enforce minimum delay and sliding 60-second token limits."""
        now = time.time()
        self.usage_history = [(t, tok) for t, tok in self.usage_history if now - t < 60.0]

        current_tpm = sum(tok for _, tok in self.usage_history)
        if current_tpm + estimated_tokens > self.max_tpm and self.usage_history:
            oldest_t, _ = self.usage_history[0]
            sleep_for = max(0.1, 60.0 - (now - oldest_t) + 0.5)
            print(f"    [Quota Protection] Rolling TPM at {current_tpm:,} tokens. Pausing {sleep_for:.1f}s...")
            time.sleep(sleep_for)
            now = time.time()
            self.usage_history = [(t, tok) for t, tok in self.usage_history if now - t < 60.0]

        elapsed = now - self.last_call_time
        if self.min_delay > 0 and elapsed < self.min_delay:
            time.sleep(self.min_delay - elapsed)

        self.last_call_time = time.time()
        self.usage_history.append((self.last_call_time, estimated_tokens))
