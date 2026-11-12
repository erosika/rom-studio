"""ROM Studio, agent half. Run by the host's own loader and checker; not yet seen inside the desktop app.

When the user has set a game folder it starts the pane page for it on this computer (unless one already
answers there), watches the game's feed.jsonl and tells the desktop pane each time it changes. The page also
checks by itself every three seconds, so the event only makes it quicker (and is the only path when the host
runs plugins in a separate process, where the event is dropped). On unload the watcher ends and a page this
half started is stopped.

Settings (plugin.yaml config_schema, kept by the host under plugins.entries.rom-studio.settings):
game_folder, pane_url, pane_port. Each falls back to an environment variable read from the process
environment only: ROM_STUDIO_GAME, ROM_STUDIO_PANE_URL, ROM_STUDIO_PANE_PORT.
"""
import atexit
import os
import subprocess
import threading
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent  # the plugin is the repository root: the pane, kit and skills sit beside this file
SERVER = HERE / "pane" / "server.ts"
DEFAULT_PORT = 8778
GAME = PANE_URL = ""
PORT = DEFAULT_PORT
_stop = threading.Event()
_page = None  # the page process, only when this half started it


def read_settings(get):
    """(game folder, address of a page that is already running, port): the host's settings first, then the environment."""
    game = str(get("game_folder", "") or os.environ.get("ROM_STUDIO_GAME", "")).strip()
    url = str(get("pane_url", "") or os.environ.get("ROM_STUDIO_PANE_URL", "")).strip()
    try:
        port = int(get("pane_port", 0) or os.environ.get("ROM_STUDIO_PANE_PORT", 0) or DEFAULT_PORT)
    except (TypeError, ValueError):
        port = DEFAULT_PORT
    return (os.path.expanduser(game) if game else ""), url, port if 0 < port < 65536 else DEFAULT_PORT


def _feed_changed():
    try:
        from hermes_cli.plugin_events import broadcast_plugin_event
        broadcast_plugin_event("rom-studio", "feed", {})
    except Exception:
        pass  # no desktop connected to this process: the page's own check covers it


def _data_dir():
    """Where the page keeps its own small state: the host's folder for this plugin, never the install folder."""
    try:
        from plugins.plugin_storage import plugin_data_dir
        return str(plugin_data_dir("rom-studio"))
    except Exception:
        return None  # outside a host: the page's default


def _start_page():
    """Our own page on this computer only (127.0.0.1): start it unless one already answers."""
    global _page
    if PANE_URL or not SERVER.is_file():
        return
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{PORT}/state", timeout=2).close()
    except Exception:
        data = _data_dir()
        cmd = ["bun", str(SERVER), "--game", GAME, "--port", str(PORT), "--bind", "127.0.0.1", *(["--data", data] if data else [])]
        try:
            _page = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError:
            pass  # bun is not installed: the pane says it cannot reach the page


def _stop_page():
    """Stop the page if this half started it. One started by the user, or by another process, is left alone."""
    global _page
    page, _page = _page, None
    if page is None or page.poll() is not None:
        return
    page.terminate()
    try:
        page.wait(timeout=5)
    except subprocess.TimeoutExpired:
        page.kill()


def _watch():
    _start_page()
    if _stop.is_set():
        _stop_page()  # unloaded while the page was starting
    feed, seen = Path(GAME) / "feed.jsonl", None
    while not _stop.is_set():
        try:
            now = feed.stat().st_mtime_ns
        except OSError:
            now = None
        if now != seen:
            seen = now
            _feed_changed()
        _stop.wait(2)


def _unload():
    _stop.set()
    _stop_page()


def _register_skills(ctx):
    """The skills beside this file, so the agent can load them as rom-studio:<name> without copying anything."""
    add = getattr(ctx, "register_skill", None)
    skills = HERE / "skills"
    if not callable(add) or not skills.is_dir():
        return
    for child in sorted(skills.iterdir()):
        if (child / "SKILL.md").is_file():
            try:
                add(child.name, child / "SKILL.md")
            except Exception:
                pass  # an older host: the skill can still be copied or linked into its skills folder


def register(ctx):
    global GAME, PANE_URL, PORT
    _register_skills(ctx)
    get = getattr(ctx, "get_config", None)
    GAME, PANE_URL, PORT = read_settings(get if callable(get) else (lambda key, default=None: default))  # read now, not at import
    if not GAME:
        return  # no game folder set: nothing is started
    _stop.clear()
    threading.Thread(target=_watch, name="rom-studio-feed", daemon=True).start()
    atexit.register(_unload)  # the host exiting without an unload still stops the page
    on_unload = getattr(ctx, "on_unload", None)
    if callable(on_unload):
        on_unload(_unload)  # switched off or reloaded: the watcher ends and our page stops
