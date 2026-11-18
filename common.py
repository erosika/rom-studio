"""ROM Studio plugin, the parts both halves share: the settings, where the pane's status is kept, and what
each state says to the person using it.

The agent half (__init__.py) writes the status; the backend route (dashboard/plugin_api.py) reads it for the
desktop and dashboard panes. Plain words only: the person reading them is making a game, not debugging one.
"""
import json
import os
import re
import shutil
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

PLUGIN_ID = "rom-studio"
DEFAULT_PORT = 8778
HERE = Path(__file__).resolve().parent  # the plugin is the repository root: the pane, kit and skills sit beside this file
REPO = HERE
SETTINGS_PLACE = "Settings, Plugins, rom-studio"  # where the desktop app shows this plugin's settings


def read_settings(get=None):
    """(game folder, address of a page that is already running, port).

    Hermes's own plugin settings first (plugins.entries.rom-studio.settings, the form in the desktop app), then the
    process environment: ROM_STUDIO_GAME, ROM_STUDIO_PANE_URL, ROM_STUDIO_PANE_PORT. No .env file is read here;
    Hermes loads its own into the environment."""
    get = get if callable(get) else (lambda key, default=None: default)
    game = str(get("game_folder", "") or os.environ.get("ROM_STUDIO_GAME", "")).strip()
    url = str(get("pane_url", "") or os.environ.get("ROM_STUDIO_PANE_URL", "")).strip()
    try:
        port = int(get("pane_port", 0) or os.environ.get("ROM_STUDIO_PANE_PORT", 0) or DEFAULT_PORT)
    except (TypeError, ValueError):
        port = DEFAULT_PORT
    return (os.path.expanduser(game) if game else ""), url, port if 0 < port < 65536 else DEFAULT_PORT


def settings_from_config():
    """This plugin's settings as Hermes keeps them, for code that has no plugin context (the backend route)."""
    try:
        from hermes_cli.config import load_config_readonly
        entry = ((load_config_readonly() or {}).get("plugins") or {}).get("entries", {}).get(PLUGIN_ID) or {}
        found = entry.get("settings")
        return found if isinstance(found, dict) else {}
    except Exception:
        return {}


def data_dir():
    """<hermes home>/plugin-data/rom-studio: this plugin's own small files (the status, the page's output)."""
    try:
        from plugins.plugin_storage import plugin_data_dir
        return Path(plugin_data_dir(PLUGIN_ID))
    except Exception:  # outside a host (tests, a plain python): the same place by hand
        home = Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")
        path = home / "plugin-data" / PLUGIN_ID
        path.mkdir(parents=True, exist_ok=True)
        return path


_KEY = re.compile(r"/k/[0-9a-f]{16,}")
_SECRETISH = re.compile(r"(?i)\b(key|token|secret|password|ticket)=[^\s&]+")


def redact(text):
    """A pane link's key and anything that looks like a credential, taken out of text that is shown or kept."""
    return _SECRETISH.sub(r"\1=<hidden>", _KEY.sub("/k/<key>", str(text)))


def write_status(state, message, **more):
    """Say what the pane is doing. Written whole or not at all; never holds a key or a credential."""
    body = {"state": state, "message": redact(message), "t": time.time(), "pid": os.getpid(),
            **{k: redact(v) if isinstance(v, str) else v for k, v in more.items()}}
    try:
        folder = data_dir()
        fd, tmp = tempfile.mkstemp(prefix=".status-", dir=folder)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(body, f)
        os.replace(tmp, folder / "status.json")
    except OSError:
        pass  # a read-only home: the pane still works, only its messages are missing
    return body


def read_status():
    try:
        found = json.loads((data_dir() / "status.json").read_text(encoding="utf-8"))
        return found if isinstance(found, dict) else None
    except (OSError, ValueError):
        return None


def find_bun():
    """bun on the PATH, else where its own installer puts it (a Hermes started by the system may have a short PATH)."""
    found = shutil.which("bun")
    if found:
        return found
    for folder in (os.environ.get("BUN_INSTALL"), str(Path.home() / ".bun")):
        if folder and os.access(Path(folder) / "bin" / "bun", os.X_OK):
            return str(Path(folder) / "bin" / "bun")
    return None


PROBE_TIMEOUT = 8.0  # a big game's state takes a moment to read
_STATE_HEAD = re.compile(r'\s*\{\s*"dir"\s*:\s*("(?:[^"\\]|\\.)*")\s*,\s*"feed"\s*:\s*\[')  # how the page's /state begins


def probe(port, timeout=None):
    """Who answers on 127.0.0.1:<port>: ("pane", its game folder), ("other", None) or ("none", None)."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/state", timeout=timeout or PROBE_TIMEOUT) as r:
            head = r.read(16_384).decode("utf-8", "replace")  # a big game's state is megabytes; its folder comes first
        found = _STATE_HEAD.match(head)
        return ("pane", json.loads(found.group(1))) if found else ("other", None)
    except urllib.error.HTTPError:
        return "other", None  # something with a web server, not a ROM Studio page
    except (OSError, ValueError):
        # refused or nothing there: free. A port held by a program that is not a web server (it accepts and says
        # nothing, or speaks something else) also lands here; the page then fails to start and its own line says why.
        return "none", None


def port_free(port):
    """Can a page listen on 127.0.0.1:<port>? (A listener on every address, or a program that accepts and stays
    silent, holds it too.) SO_REUSEADDR, as the page's own server, so a recently closed page does not count."""
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def same_folder(a, b):
    try:
        return Path(a).resolve() == Path(b).resolve()
    except OSError:
        return False


# What each state says. {port}, {game}, {other} and {why} are filled in. Every message ends with what to do.
MESSAGES = {
    "no-game": "No game folder yet. Choose one in " + SETTINGS_PLACE + ": a folder made by kit setup, or a new empty folder. The page opens a few seconds later.",
    "no-folder": "ROM Studio cannot find the game folder {game}. Check the folder in " + SETTINGS_PLACE + ".",
    "no-server": "This copy of the plugin has no pane beside it ({why}). Install it from a full ROM Studio folder with: kit plugin install",
    "no-bun": "ROM Studio needs bun to show its page, and bun is not on this computer. Install it from https://bun.sh; the page opens a few seconds later.",
    "port-taken": "Port {port} on this computer is used by another program. Choose another port in " + SETTINGS_PLACE + ".",
    "other-game": "Port {port} already shows a ROM Studio page for another game ({other}). Stop that page, or choose another port in " + SETTINGS_PLACE + ".",
    "stopped": "The ROM Studio page stopped: {why}. Hermes tries again in half a minute.",
    "starting": "Starting the ROM Studio page for {game}.",
    "running": "The ROM Studio page for {game} is open.",
    "external": "Showing the ROM Studio page you started yourself.",
    "unloaded": "ROM Studio is switched off.",
}


def say(state, **fill):
    return MESSAGES[state].format(**{k: redact(v) for k, v in fill.items()})
