"""ROM Studio, agent half.

When a game folder is set, this starts the pane page for it on this computer only (127.0.0.1), unless one already
answers there, watches the game's feed.jsonl and tells the desktop pane each time it changes. The page also checks by
itself every three seconds, so the event only makes it quicker (and is the only path when Hermes runs plugins in a
separate process, where the event is dropped).

What it is doing is kept in plain words in <hermes home>/plugin-data/rom-studio/status.json, where the backend route
(dashboard/plugin_api.py) reads it for the pane: no game folder, a folder that is not there, no bun, the port used by
another program, a page for another game on that port, a page that stopped. The page's own output goes to pane.log
beside it (the page prints no key for 127.0.0.1, and the status keeps none).

If the page stops it is started again; on unload, or when this Hermes exits, a page this half started is stopped.
One started by the user, or by another Hermes process, is left alone.

Settings: plugin.yaml's config_schema (game_folder, pane_url, pane_port), set in the desktop app or with
`hermes config set plugins.entries.rom-studio.settings.<key> <value>`, and read again every ten seconds, so a change
needs no restart; else ROM_STUDIO_GAME, ROM_STUDIO_PANE_URL, ROM_STUDIO_PANE_PORT in the environment Hermes starts with. The skills beside the checkout are registered as
rom-studio:<name> (rom-studio:make-your-game).
"""
import atexit
import os
import re
import subprocess
import threading
import time
from pathlib import Path

from . import common as C

SERVER = C.REPO / "pane" / "server.ts"
START_DELAY = 4.0   # a command that loads plugins only for a moment (doctor, a quick list) starts no page
CHECK_EVERY = 10.0  # how often the page is looked at, and started again if it stopped
RETRY_AFTER = 30.0  # after a page stopped by itself, wait this long before starting another
FEED_EVERY = 2.0

GAME = PANE_URL = ""
PORT = C.DEFAULT_PORT
_page = None        # the page process, only when this half started it
_started = 0.0
_failed_at = 0.0
_said = None        # the last status written, so an unchanged one is not written every ten seconds
_lock = threading.Lock()
_watchers = []      # the stop switches of this module's watcher threads


def _feed_changed():
    try:
        from hermes_cli.plugin_events import broadcast_plugin_event
        broadcast_plugin_event(C.PLUGIN_ID, "feed", {})
    except Exception:
        pass  # no desktop connected to this process: the page's own check covers it


_KEEP = re.compile(r"^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LANGUAGE|LC_[A-Z_]+|TZ|TERM|TMPDIR|XDG_RUNTIME_DIR|HERMES_HOME|ARM_GCC|MGBA_PREFIX|SCRIPT_TOOL|JOBS|GAME_DIR|GAME|ROM|SYM|PORT|REDRAW_BASE|ROM_STUDIO_[A-Z0-9_]+)$")


def _child_env(bun=None):
    """What the page (and everything it starts) may see: a short list by name, never this process's own environment,
    which holds the agent's provider keys. The same list as kit/env.ts. bun's own folder goes first on PATH, so the
    kit commands the page runs find it even when Hermes was started with a short PATH."""
    env = {k: v for k, v in os.environ.items() if _KEEP.match(k)}
    if bun:
        env["PATH"] = os.pathsep.join([str(Path(bun).parent), *([env["PATH"]] if env.get("PATH") else [])])
    return env


def _status(state, message, **more):
    global _said
    key = (state, message, tuple(sorted(more.items())))
    if key != _said:
        _said = key
        C.write_status(state, message, port=PORT, **more)
    return state


def _log():
    return C.data_dir() / "pane.log"


def _why_it_stopped():
    """The page's last line, in a sentence's place: what the page itself said before it stopped."""
    try:
        lines = [l.strip() for l in _log().read_text(encoding="utf-8", errors="replace").splitlines() if l.strip()]
    except OSError:
        lines = []
    last = C.redact(lines[-1])[:240] if lines else "it said nothing"
    return last.rstrip(".")


def _start(bun):
    global _page, _started
    # --until-stdin-closes with a pipe only this process holds: if Hermes ends without an unload or its exit handlers
    # (killed, or a host that leaves through os._exit), the pipe closes and the page stops with it
    cmd = [bun, str(SERVER), "--game", GAME, "--port", str(PORT), "--bind", "127.0.0.1", "--data", str(C.data_dir()), "--until-stdin-closes"]  # its state in Hermes's folder for this plugin, never the install folder
    with open(_log(), "wb") as out:  # a fresh log for each start: it holds the page's own words only
        _page = subprocess.Popen(cmd, cwd=str(C.REPO), env=_child_env(bun), stdin=subprocess.PIPE, stdout=out,
                                 stderr=subprocess.STDOUT, start_new_session=True)  # Ctrl+C in a terminal is for Hermes, not the page
    _started = time.time()


def _stop_page():
    """Stop the page if this half started it."""
    global _page
    page, _page = _page, None
    if page is None or page.poll() is not None:
        return
    page.terminate()
    try:
        page.wait(timeout=5)
    except subprocess.TimeoutExpired:
        page.kill()


def _check():
    """Look at the page once: start it if nothing answers, and say in the status what is going on."""
    global _page, _failed_at
    if PANE_URL:
        return _status("external", C.say("external"), url=PANE_URL)
    if not Path(GAME).is_dir():
        return _status("no-folder", C.say("no-folder", game=GAME))
    if not SERVER.is_file():
        return _status("no-server", C.say("no-server", why=f"{SERVER} is missing"))
    with _lock:
        why = None
        if _page is not None and _page.poll() is not None:  # our page stopped by itself
            why, _page, _failed_at = _why_it_stopped(), None, time.time()
        who, other = C.probe(PORT)
        local = f"http://127.0.0.1:{PORT}/"
        if who == "pane":
            if C.same_folder(other, GAME):
                return _status("running", C.say("running", game=GAME), url=local, ours=_page is not None)
            return _status("other-game", C.say("other-game", port=PORT, other=other))
        if who == "other":
            return _status("port-taken", C.say("port-taken", port=PORT))
        if _page is not None:  # started, not answering yet
            if time.time() - _started < 20:
                return _status("starting", C.say("starting", game=GAME), url=local)
            _stop_page()
            why, _failed_at = "it did not answer for 20 seconds", time.time()
        if why is not None:
            if "could not open" in why:  # the page's own words when its port is held
                return _status("port-taken", C.say("port-taken", port=PORT))
            return _status("stopped", C.say("stopped", why=why))
        if _failed_at and time.time() - _failed_at < RETRY_AFTER:
            return _said[0] if _said else "stopped"
        if not C.port_free(PORT):
            return _status("port-taken", C.say("port-taken", port=PORT))
        bun = C.find_bun()
        if not bun:
            return _status("no-bun", C.say("no-bun"))
        try:
            _start(bun)
        except OSError as e:
            _failed_at = time.time()
            return _status("stopped", C.say("stopped", why=f"it could not be started ({e.strerror or e})"))
        return _status("starting", C.say("starting", game=GAME), url=local)


def _apply(settings):
    """New settings (saved in the desktop app's form while Hermes runs): our page for the old ones stops."""
    global GAME, PANE_URL, PORT, _failed_at, _said
    if settings == (GAME, PANE_URL, PORT):
        return False
    with _lock:
        _stop_page()
    GAME, PANE_URL, PORT = settings
    _failed_at, _said = 0.0, None
    return True


def _watch(stop, get):
    if stop.wait(START_DELAY):
        return
    seen, checked = None, 0.0
    while not stop.is_set():
        if time.time() - checked >= CHECK_EVERY:
            checked = time.time()
            try:
                _apply(C.read_settings(get))  # a changed setting takes effect here, without a restart
                if not GAME and not PANE_URL:
                    _status("no-game", C.say("no-game"))
                else:
                    _check()
            except Exception as e:  # never take Hermes down; say it plainly instead
                _status("stopped", C.say("stopped", why=f"the plugin met an error it did not expect ({type(e).__name__})"))
        try:
            now = (Path(GAME) / "feed.jsonl").stat().st_mtime_ns if GAME else None
        except OSError:
            now = None
        if now != seen:
            seen = now
            _feed_changed()
        stop.wait(FEED_EVERY)
    with _lock:
        _stop_page()  # unloaded while the page was starting: it does not outlive the switch


def _exit():
    for stop in _watchers:
        stop.set()
    with _lock:
        _stop_page()


def _unload(stop):
    def unload():
        stop.set()
        with _lock:
            _stop_page()
        _status("unloaded", C.say("unloaded"))
    return unload


def _register_skills(ctx):
    """The skills of this checkout, loadable as rom-studio:<name> without copying anything."""
    add = getattr(ctx, "register_skill", None)
    skills = C.REPO / "skills"
    if not callable(add) or not skills.is_dir():
        return
    for child in sorted(skills.iterdir()):
        if (child / "SKILL.md").is_file():
            try:
                add(child.name, child / "SKILL.md")
            except Exception:
                pass  # an older Hermes: the skill can still be linked into its skills folder


def register(ctx):
    global GAME, PANE_URL, PORT, _said
    _register_skills(ctx)
    _said = None
    get = getattr(ctx, "get_config", None)
    GAME, PANE_URL, PORT = C.read_settings(get)  # read now, not at import; the watcher reads them again as they change
    if not GAME and not PANE_URL:
        _status("no-game", C.say("no-game"))  # nothing is started until a game folder is chosen
    elif PANE_URL:
        _status("external", C.say("external"), url=PANE_URL)
    stop = threading.Event()
    _watchers.append(stop)
    threading.Thread(target=_watch, args=(stop, get), name="rom-studio-pane", daemon=True).start()
    if len(_watchers) == 1:
        atexit.register(_exit)  # this Hermes exiting without an unload still stops our page
    on_unload = getattr(ctx, "on_unload", None)
    if callable(on_unload):
        on_unload(_unload(stop))  # switched off or reloaded: the watcher ends and our page stops
