"""Shared pytest fixtures.

Importing ``app`` has import-time side effects (it starts the scheduler thread and
rewrites the status fields of scheduler_config.json). To keep the test run from mutating
the user's real config, we snapshot the file before import and restore it afterwards.
"""
import os
import sys
import shutil

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
CONFIG_PATH = os.path.join(ROOT, "scheduler_config.json")


@pytest.fixture(scope="session", autouse=True)
def _preserve_scheduler_config():
    backup = CONFIG_PATH + ".testbak"
    existed = os.path.exists(CONFIG_PATH)
    if existed:
        shutil.copy2(CONFIG_PATH, backup)
    yield
    if existed:
        shutil.move(backup, CONFIG_PATH)


@pytest.fixture(autouse=True)
def _clear_tagger_cache():
    from tagger_app.core.cache import tagger_cache
    tagger_cache.clear()
    yield
    tagger_cache.clear()


@pytest.fixture(scope="session")
def app_module(_preserve_scheduler_config):
    import app
    return app


@pytest.fixture()
def client(app_module):
    app_module.app.config["TESTING"] = True
    return app_module.app.test_client()
