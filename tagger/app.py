"""Comics-Now ComicTagger Backend Application.

Decomposed modular Flask service with single-responsibility blueprints:
- `tagger_app.blueprints.ui`: Browser UI, local file browsing, sessions, download & cleanup.
- `tagger_app.blueprints.manual_tagger`: Interactive manual tagging, search & folder batching.
- `tagger_app.blueprints.api_v1`: REST v1 endpoints (tagging, streaming, metadata search, health).
- `tagger_app.blueprints.logs`: Log inspection, log deletion, and enhanced history tracking.
- `tagger_app.blueprints.scheduler_routes`: Scheduler config, manual trigger & library enhance SSE.
"""

import os
from flask import Flask

from tagger_app.config import (
    UPLOAD_FOLDER,
    STATIC_TEMP_DIR,
    LOGS_DIR,
    DB_TRACKING_PATH,
)
from tagger_app.persistence.tracking_db import (
    init_tracking_db,
    mark_as_enhanced,
    is_already_enhanced,
)
from tagger_app.persistence.scan_logs import write_scan_log
from tagger_app.core.enrichment import (
    consolidate_all_candidates,
    enrich_metadata_from_other_sources,
    query_all_sources_sequentially,
    check_comic_info_completeness,
)
from tagger_app.core.tagger import process_single_cbz_file
from tagger_app.core.enhancer import enhance_single_cbz_file
from tagger_app.core.comicinfo import (
    generate_comic_info_xml,
    write_comic_info,
    write_comic_info_to_cbz,
    read_comic_info_xml,
)
from tagger_app.scheduler.scanner import (
    start_scheduler,
    run_scheduled_scan,
    run_library_enhance_background,
    sessions,
    active_scans,
    active_scans_lock,
)
from tagger_app.core.metadata import normalize_metadata
from tagger_app.sources.comicvine import search_comicvine_multi
from tagger_app.sources.gcd import search_gcd_multi
from tagger_app.sources.lcg import search_lcg_multi
from tagger_app.sources.metron import search_metron_multi
from tagger_app.sources.goodreads import search_goodreads_multi
from tagger_app.sources.blackwells import search_blackwells_multi
from tagger_app.sources.waterstones import search_waterstones_multi
from tagger_app.sources.googlebooks import search_googlebooks_multi
from tagger_app.sources.amazon import search_amazon_multi
from tagger_app.sources.forbiddenplanet import search_forbiddenplanet_multi

# Import Blueprints
from tagger_app.blueprints.ui import ui_bp
from tagger_app.blueprints.manual_tagger import manual_tagger_bp
from tagger_app.blueprints.api_v1 import api_v1_bp
from tagger_app.blueprints.logs import logs_bp
from tagger_app.blueprints.scheduler_routes import scheduler_bp

# Flask Application Instance
app = Flask(__name__)

# Register Blueprints
app.register_blueprint(ui_bp)
app.register_blueprint(manual_tagger_bp)
app.register_blueprint(api_v1_bp)
app.register_blueprint(logs_bp)
app.register_blueprint(scheduler_bp)


def _env_flag(name, default=False):
    """Parse a boolean-ish environment variable."""
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


def get_run_config():
    """Resolve server run settings from the environment.

    Security (SEC-001): debug defaults to OFF. The Werkzeug debugger allows arbitrary
    code execution, so it must never be enabled by default.

    The server binds 0.0.0.0 by default so it is reachable across the user's trusted
    LAN (an intentional requirement). No app-level authentication is enforced — the
    deployment relies on the local network being trusted (SEC-002 accepted as risk).
    """
    return {
        "host": os.environ.get("APP_HOST", "0.0.0.0"),
        "port": int(os.environ.get("APP_PORT", "5000")),
        "debug": _env_flag("FLASK_DEBUG", default=False),
        "threaded": True,
    }


def create_app():
    """Application factory: initialize services and return the configured Flask app.

    Importing this module no longer has side effects — call create_app() to run the
    tracking-DB init and start the background scheduler worker. This keeps imports
    (and tests/tooling) free of thread/disk side effects.
    """
    init_tracking_db()
    # In debug mode Werkzeug runs the app twice (reloader); only start the worker in the
    # main/reloaded process so we don't spawn two scheduler threads.
    if os.environ.get("WERKZEUG_RUN_MAIN") == "true" or not get_run_config()["debug"]:
        start_scheduler()
    return app


if __name__ == '__main__':
    create_app()
    cfg = get_run_config()
    if cfg["debug"]:
        print("[!] WARNING: Flask debug mode is ON (Werkzeug debugger allows code execution). "
              "Never use this on an exposed host.")
    app.run(**cfg)
