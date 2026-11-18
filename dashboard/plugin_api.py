"""Backend half: tells the pane where its page is and what the agent half last said about it.

Mounted by Hermes at /api/plugins/rom-studio/. GET /where answers
  {"url": <address to show, or null>, "state": <one word>, "message": <a sentence for the person>,
   "answering": true|false|null, "game": <folder or null>}
"answering" is a quick look from this computer (null for a page somebody runs at another computer's address).
Settings come from Hermes's own plugin settings, else the process environment; no .env file is read here.
"""
import asyncio
import importlib.util
import socket
import time
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter

router = APIRouter()


def _common():
    """The plugin's shared helpers (../common.py), loaded by path: Hermes mounts this file on its own."""
    spec = importlib.util.spec_from_file_location("rom_studio_plugin_common", Path(__file__).resolve().parent.parent / "common.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


C = _common()
SHOWN = {"running", "starting"}  # states in which the page itself is shown


def _answers(port):
    """Does anything accept a connection on 127.0.0.1:<port> right now? Half a second at most."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


@router.get("/where")
async def where():
    settings = C.settings_from_config()
    game, url, port = C.read_settings(lambda key, default=None: settings.get(key, default))
    if url:  # a page the user runs: shown as it is, with its key if the link has one
        where_to = urlparse(url)
        local = where_to.hostname in ("127.0.0.1", "localhost", "::1")
        answering = await asyncio.to_thread(_answers, where_to.port or (443 if where_to.scheme == "https" else 80)) if local else None
        return {"url": url, "state": "external", "message": C.say("external"), "answering": answering, "game": game or None}
    if not game:
        return {"url": None, "state": "no-game", "message": C.say("no-game"), "answering": False, "game": None}
    if not Path(game).is_dir():
        return {"url": None, "state": "no-folder", "message": C.say("no-folder", game=game), "answering": False, "game": game}
    status = C.read_status() or {}
    state, message = status.get("state"), status.get("message")
    answering = await asyncio.to_thread(_answers, port)
    if state is None or status.get("port") != port or state in ("no-game", "no-folder", "external", "unloaded"):
        # nothing said yet for these settings: they changed a moment ago, or the agent half is not loaded
        state = "running" if answering else "waiting"
        message = C.say("running", game=game) if answering else (
            "The ROM Studio page is not running yet. Hermes starts it a few seconds after the plugin is switched on.")
    elif state in SHOWN and not answering and time.time() - float(status.get("t") or 0) > 30:
        state, message = "waiting", "The ROM Studio page is not answering. Hermes looks again within ten seconds and starts it if it stopped."
    # the address only once something answers there: a frame on a closed port shows the browser's own error page
    return {"url": f"http://127.0.0.1:{port}/" if state in SHOWN and answering else None, "state": state, "message": message,
            "answering": answering, "game": game}
