#!/usr/bin/env python3
"""
Comics Now - Modal GPU Guided View Helper Script
Handles credit checks and remote GPU inference for comic panel detection.
"""

import argparse
import asyncio
import io
import json
import os
import pathlib
import sys
import time

# Prioritize internal scripts/modal helper package, with fallback to MODAL_BACKFILL_DIR
LOCAL_MODAL_DIR = str(pathlib.Path(__file__).parent / "modal")
if os.path.exists(LOCAL_MODAL_DIR) and LOCAL_MODAL_DIR not in sys.path:
    sys.path.insert(0, LOCAL_MODAL_DIR)

BACKFILL_DIR = os.environ.get("MODAL_BACKFILL_DIR")
if BACKFILL_DIR and os.path.exists(BACKFILL_DIR) and BACKFILL_DIR not in sys.path:
    sys.path.append(BACKFILL_DIR)


def check_credits() -> dict:
    try:
        from modal.workspace import _Workspace
        ws = _Workspace.from_context()
        summary = asyncio.run(ws.billing.summary(cycle="this month"))
        total_credits = float(abs(summary.adjustments.get("Credits", 0)))
        metered_cost = float(summary.metered_cost)
        billed_cost = float(summary.billed_cost)
        remaining = max(0.0, total_credits - metered_cost)
        spend_limit_exceeded = billed_cost > 0 or (total_credits > 0 and metered_cost >= total_credits)
        ws_name = getattr(ws, "_name", None) or "default"

        return {
            "ok": True,
            "workspace": ws_name,
            "totalCredits": round(total_credits, 2),
            "meteredCost": round(metered_cost, 2),
            "billedCost": round(billed_cost, 2),
            "availableCredits": round(remaining, 2),
            "spendLimitExceeded": spend_limit_exceeded,
            "currency": "USD"
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc)
        }


def check_environment() -> dict:
    credit_res = check_credits()
    if not credit_res.get("ok"):
        return credit_res

    models_uploaded = False
    app_deployed = False

    try:
        import modal
        vol = modal.Volume.from_name("comics-guided-models", create_if_missing=False)
        entries = vol.listdir("/")
        entry_names = {e.path.lower() for e in entries}
        has_manga = any("manga" in e for e in entry_names)
        has_bubble = any("bubble" in e for e in entry_names)
        models_uploaded = bool(has_manga and has_bubble)
    except Exception:
        models_uploaded = False

    try:
        import modal
        fn = modal.Function.from_name("comics-guided-view", "detect_pages_batch")
        fn.hydrate()
        app_deployed = bool(getattr(fn, "object_id", None))
    except Exception:
        app_deployed = False

    ready = bool(models_uploaded and app_deployed)

    res = dict(credit_res)
    res.update({
        "modelsUploaded": models_uploaded,
        "appDeployed": app_deployed,
        "ready": ready
    })
    return res


def setup_environment(models_dir: str = "/opt/comics-now/models") -> dict:
    import subprocess
    import pathlib

    models_path = pathlib.Path(models_dir)
    if not models_path.exists():
        models_path = pathlib.Path(__file__).parent.parent / "models"

    env_status = check_environment()
    models_uploaded = env_status.get("modelsUploaded", False)

    app_file = pathlib.Path(__file__).parent / "modal" / "modal_app.py"
    if not app_file.exists():
        app_file = pathlib.Path(__file__).parent / "modal_app.py"

    if not models_uploaded:
        onnx_files = sorted(models_path.rglob("*.onnx"))
        if not onnx_files:
            return {
                "ok": False,
                "error": f"No .onnx models found under {models_path} to upload."
            }

        res = subprocess.run(
            [sys.executable, "-m", "modal", "run", f"{app_file}::upload_models"],
            env=os.environ,
            capture_output=True,
            text=True
        )
        if res.returncode != 0:
            return {
                "ok": False,
                "error": f"Failed to upload models to Modal Volume: {res.stderr or res.stdout}"
            }

    deploy_res = subprocess.run(
        [sys.executable, "-m", "modal", "deploy", str(app_file)],
        env=os.environ,
        capture_output=True,
        text=True
    )
    if deploy_res.returncode != 0:
        return {
            "ok": False,
            "error": f"Failed to deploy Modal app: {deploy_res.stderr or deploy_res.stdout}"
        }

    return {
        "ok": True,
        "modelsUploaded": True,
        "appDeployed": True,
        "ready": True,
        "message": "Modal environment initialized and deployed successfully"
    }


def process_comic(comic_id: str, comic_path: str, comic_type: str, output_dir: str) -> dict:
    if not os.path.exists(comic_path):
        raise FileNotFoundError(f"Comic file not found: {comic_path}")

    try:
        import runner
        from modal_app import app, detect_pages_batch
        import modal
    except ImportError as e:
        raise RuntimeError(f"Failed to import Modal backfill modules from {BACKFILL_DIR}: {e}")

    pages = runner.list_pages(comic_path)
    if not pages:
        raise ValueError(f"No image pages found in {comic_path}")

    # Read and compress pages to WebP
    all_raw = runner.read_pages(comic_path, pages)
    batch_size = getattr(runner, "BATCH_SIZE", 15)

    def _prepare_entry(pname):
        wb, ow, oh = runner.prepare_page_webp(all_raw[pname])
        return pname, [pname, wb, ow, oh]

    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=1) as pool:
        prepared_dict = dict(pool.map(_prepare_entry, pages))

    batch_slices = [pages[i : i + batch_size] for i in range(0, len(pages), batch_size)]
    pages_result = {}
    total_panels = 0

    # Determine whether deployed function exists or we need app.run()
    remote_fn = None
    try:
        remote_fn = modal.Function.from_name("comics-guided-view", "detect_pages_batch")
    except Exception:
        remote_fn = None

    def _execute_batches(fn):
        nonlocal total_panels
        for idx, batch_names in enumerate(batch_slices):
            batch_data = [prepared_dict[pname] for pname in batch_names]
            batch_out = fn.remote(batch_data, comic_type)
            for p_name, p_data in batch_out.items():
                pages_result[p_name] = p_data
                total_panels += len(p_data.get("panels", []))

    if remote_fn:
        try:
            _execute_batches(remote_fn)
        except Exception:
            # Fall back to ephemeral app session
            with app.run():
                _execute_batches(detect_pages_batch)
    else:
        with app.run():
            _execute_batches(detect_pages_batch)

    if total_panels == 0 and len(pages) > 0:
        raise RuntimeError(f"Modal GPU detection returned 0 panels across {len(pages)} pages")

    out_dir_path = pathlib.Path(output_dir)
    out_dir_path.mkdir(parents=True, exist_ok=True)
    safe_comic_id = pathlib.Path(str(comic_id)).name
    sidecar_path = out_dir_path / f"{safe_comic_id}.json"

    result_payload = {
        "comicId": comic_id,
        "type": comic_type,
        "pages": pages_result
    }
    sidecar_path.write_text(json.dumps(result_payload, indent=2))

    return {
        "ok": True,
        "panels": total_panels,
        "pagesProcessed": len(pages),
        "pageCount": len(pages),
        "outputPath": str(sidecar_path)
    }


def main():
    parser = argparse.ArgumentParser(description="Comics Now Modal Guided Detection")
    parser.add_argument("--check-credits", action="store_true", help="Check available Modal credits")
    parser.add_argument("--check-environment", action="store_true", help="Check Modal environment status (volume models and deployed app)")
    parser.add_argument("--setup-environment", action="store_true", help="Initialize Modal environment (upload models and deploy app)")
    parser.add_argument("--process-comic", action="store_true", help="Process comic via Modal")
    parser.add_argument("--comic-id", type=str, help="Comic ID")
    parser.add_argument("--comic-path", type=str, help="Comic archive path")
    parser.add_argument("--type", type=str, default="western", help="Comic type (western|manga)")
    parser.add_argument("--output-dir", type=str, default="/opt/comics-now/metadata/guided_view", help="Sidecar output directory")

    args = parser.parse_args()

    if args.check_credits:
        res = check_credits()
        print(json.dumps(res))
        sys.exit(0 if res.get("ok") else 1)

    if args.check_environment:
        res = check_environment()
        print(json.dumps(res))
        sys.exit(0 if res.get("ok") else 1)

    if args.setup_environment:
        res = setup_environment()
        print(json.dumps(res))
        sys.exit(0 if res.get("ok") else 1)

    if args.process_comic:
        if not args.comic_id or not args.comic_path:
            res = {"ok": False, "error": "Missing required arguments --comic-id or --comic-path"}
            print(json.dumps(res))
            sys.exit(1)
        try:
            res = process_comic(args.comic_id, args.comic_path, args.type, args.output_dir)
            print(json.dumps(res))
            sys.exit(0)
        except Exception as exc:
            res = {"ok": False, "error": str(exc)}
            print(json.dumps(res))
            sys.exit(1)

    parser.print_help()
    sys.exit(1)


if __name__ == "__main__":
    main()
