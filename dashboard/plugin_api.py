"""Backend half: tells the pane where the page is. Mounted by the host at /api/plugins/rom-studio/."""
import os

from fastapi import APIRouter

router = APIRouter()
DEFAULT_PORT = 8778


def settings():
    """This plugin's own settings as the host keeps them (plugins.entries.rom-studio.settings); {} when there are none."""
    try:
        from hermes_cli.config import load_config_readonly
        entry = ((load_config_readonly() or {}).get("plugins") or {}).get("entries", {}).get("rom-studio") or {}
        found = entry.get("settings")
        return found if isinstance(found, dict) else {}
    except Exception:
        return {}


def read_settings():
    """The same rule as the agent half: the host's settings first, then the process environment."""
    s = settings()
    game = str(s.get("game_folder") or os.environ.get("ROM_STUDIO_GAME", "")).strip()
    url = str(s.get("pane_url") or os.environ.get("ROM_STUDIO_PANE_URL", "")).strip()
    try:
        port = int(s.get("pane_port") or os.environ.get("ROM_STUDIO_PANE_PORT", 0) or DEFAULT_PORT)
    except (TypeError, ValueError):
        port = DEFAULT_PORT
    return game, url, port if 0 < port < 65536 else DEFAULT_PORT


@router.get("/where")
async def where():
    game, url, port = read_settings()
    if not game:
        return {"url": None, "error": "No game folder yet. Open Settings, Plugins, ROM Studio and fill in the game folder, then restart Hermes."}
    return {"url": url or f"http://127.0.0.1:{port}/", "game": game}
