"""Cover image utilities: extract a cover from a CBZ, compare two covers.

Extracted from the legacy tagger.py monolith (architecture review, step 1).
"""
import os
import zipfile

import requests

from tagger_app.config import HEADERS
from tagger_app.core.cache import tagger_cache
from tagger_app.core.limiter import domain_limiter


def extract_cover_from_cbz(cbz_path, output_dir="temp_covers"):
    """
    Extracts the first image file alphabetically from a CBZ (ZIP) archive.
    """
    print(f"[*] Analyzing CBZ: {os.path.basename(cbz_path)}")
    os.makedirs(output_dir, exist_ok=True)
    
    if not zipfile.is_zipfile(cbz_path):
        raise ValueError(f"Error: {cbz_path} is not a valid zip/cbz file.")
        
    with zipfile.ZipFile(cbz_path, 'r') as z:
        # Find all files with typical image extensions, ignoring hidden files/folders
        image_files = sorted([
            f for f in z.namelist() 
            if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')) and not f.startswith('__MACOSX')
        ])
        
        if not image_files:
            raise ValueError("Error: No image files found in the CBZ archive.")
        
        cover_filename = image_files[0]
        print(f"[*] Found cover file inside CBZ: {cover_filename}")

        # Read cover bytes directly from ZIP in-memory to prevent subdirectory creation and renaming I/O errors
        cover_data = z.read(cover_filename)
        dest_path = os.path.join(output_dir, f"cover_{os.path.basename(cbz_path)}.jpg")

        # Downscale to 1024px wide before writing. The Gemini API normalizes images to a
        # fixed token cost regardless of resolution, so full-res covers buy nothing on input
        # but measurably increase the model's "thinking" (and thus latency). 1024px keeps
        # identification accuracy with a wide safety margin while halving thinking tokens.
        try:
            from PIL import Image
            import io
            TARGET_WIDTH = 1024
            img = Image.open(io.BytesIO(cover_data)).convert("RGB")
            w, h = img.size
            if w > TARGET_WIDTH:
                new_h = int(h * TARGET_WIDTH / w)
                img = img.resize((TARGET_WIDTH, new_h), Image.LANCZOS)
                print(f"[*] Downscaled cover {w}x{h} -> {TARGET_WIDTH}x{new_h} for faster identification")
            img.save(dest_path, format="JPEG", quality=85)
        except Exception as e:
            # If PIL is unavailable or the image can't be decoded, fall back to the raw bytes
            print(f"[-] Cover downscale skipped ({e}); writing original bytes")
            with open(dest_path, "wb") as out_f:
                out_f.write(cover_data)

        print(f"[+] Cover extracted successfully to: {dest_path}")
        return dest_path

def compare_covers_python(local_image_path, candidate_image_url, hash_size=16):
    """
    Compares a local cover image against a candidate cover URL using a perceptual hash
    (pHash). pHash is robust to resolution, compression and minor colour shifts — far less
    noisy than histogram correlation for "same art, different file" comparisons.

    Returns a confidence score between 0.0 (unrelated) and 1.0 (identical), computed as
    1 - (Hamming distance / number of hash bits).
    """
    if not local_image_path or not candidate_image_url:
        return 0.0

    try:
        from PIL import Image
        import io
        import imagehash

        # Check candidate cover pHash cache
        h_cand = tagger_cache.get_cover_phash(candidate_image_url)
        if h_cand is None:
            # Rate limit download
            domain_limiter.wait_for_domain(candidate_image_url)
            headers = {"User-Agent": HEADERS["User-Agent"]}
            img_res = requests.get(candidate_image_url, headers=headers, timeout=10)
            if img_res.status_code != 200:
                print(f"[-] Failed to download candidate cover: HTTP {img_res.status_code}")
                return 0.0

            cand_img = Image.open(io.BytesIO(img_res.content)).convert("RGB")
            h_cand = imagehash.phash(cand_img, hash_size=hash_size)
            tagger_cache.set_cover_phash(candidate_image_url, h_cand)

        local_img = Image.open(local_image_path).convert("RGB")
        h_local = imagehash.phash(local_img, hash_size=hash_size)

        bits = hash_size * hash_size
        distance = h_local - h_cand            # Hamming distance
        score = max(0.0, min(1.0, 1.0 - (distance / bits)))
        print(f"[+] pHash cover comparison score: {score:.3f} (distance {distance}/{bits})")
        return round(score, 3)

    except Exception as e:
        print(f"[-] Cover comparison failed: {e}")
        return 0.0
