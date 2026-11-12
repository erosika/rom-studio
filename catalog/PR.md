# Add rom-studio to the plugin catalog

Adds one file, `plugin-catalog/rom-studio.yaml`. I am the owner of the plugin's repository.

## What it does

ROM Studio lets a person make their own small game by talking with their agent, one scene at a
time, from a decomp (the community-made source of an original handheld game) that they supply.
The plugin's pane shows each change as a sentence with a picture taken from the running game, a
play link, the scene list, a gallery, maps, music, the game's dialogue with the user's notes on it, a source search, the agent's open questions
and settings. The same repository carries the command-line kit the agent runs, a browser player
with a flash guard that is always on, and the `make-your-game` skill. It names and fetches no
game or engine; what a user may share is a patch, never a built game.

## Hermes surfaces used

- Agent half (`__init__.py`): `ctx.get_config` for the three `config_schema` settings,
  `ctx.on_unload`, `ctx.register_skill`, `hermes_cli.plugin_events.broadcast_plugin_event`
  (`plugin.rom-studio.feed`), `plugins.plugin_storage.plugin_data_dir`. No tools, hooks,
  middleware, commands or capabilities.
- Dashboard backend (`dashboard/plugin_api.py`): one route, `GET /api/plugins/rom-studio/where`,
  reading the settings with `hermes_cli.config.load_config_readonly`. The dashboard tab is hidden.
- Desktop half (`desktop/plugin.js`, plain ESM, 72 lines): `PANES_AREA` (a pane on the right),
  `ROUTES_AREA` (`/rom-studio`), `ctx.rest`, `ctx.onEvent`. It shows the local pane page in a sandboxed iframe and posts two messages only to that page's origin: the feed message, and the app's own colours, mode and font so the pane matches the theme.
- The package is a root-layout unified package; only `desktop/` is published to the desktop app.

## Disclosures (rule 13)

- **Background process.** Once a game folder is set, the agent half starts `bun pane/server.ts`
  bound to 127.0.0.1 (port 8778 by default) unless something already answers there, and stops it
  on unload and at exit. With no game folder set it starts nothing. A thread stats the game's
  `feed.jsonl` every two seconds.
- **Who can reach the pane.** From 127.0.0.1 there is no sign-in: programs on the user's computer
  can read the game folder's pictures and source through it, post answers, upload reference
  pictures and replacement audio, change the helper list in the game's `settings.json`, and start
  `kit setup` into an empty game folder from a folder, a git address (four plain forms, never
  read as an option) or an uploaded archive (unpacked entry by entry, no links). Pages on other
  sites and requests under a foreign Host name are refused (`kit/web.ts`), every body is read
  with a size limit, and the page carries a content policy. It leaves loopback only if the user
  starts it themselves with `--bind`; any other device then needs the link with the pane's key
  (`/k/<key>/`, a random key kept 0600 in the plugin's data folder).
- **`ROM_STUDIO_HOSTS` and the `/pane/` pass-through.** The player passes `/pane/` to the local
  pane (`ROM_STUDIO_PANE_LOCAL`, default `http://127.0.0.1:8778`) and both servers also answer to
  host names the user lists in `ROM_STUDIO_HOSTS`, for a user who puts their own reverse proxy in
  front. Unset by default.
- **Shell commands.** The kit (run by the agent under Hermes's approvals, or by the user) runs
  git, make, the C and Arm compilers, python3, ffmpeg, curl, openssl, and the user's decomp's own
  build scripts.
- **Downloads at `kit setup` only, never at load:** the script compiler, a prebuilt Linux program
  from its author's GitHub release (`huderlem/poryscript` 3.6.1), verified against a sha256 in
  `kit/kit.ts`; the npm package `@thenick775/mgba-wasm` 2.6.0, pinned by sha512 in
  `player/bun.lock` and installed with `--frozen-lockfile`; the user's decomp if they gave a git
  address. A headless emulator is compiled from `kit/emu/studio-emu.c` against a libmgba the user
  builds themselves (the printed build line checks the commit).
- **Player.** `kit play` serves the built game on 127.0.0.1; `--phone` adds the user's private
  network addresses over https with a self-made certificate and a key in the link.
- **In-game agent link.** Only a game built with the optional base has it, and the base (patches
  for one engine version) is not shipped in this repository. Where present, text typed in the
  game's START menu entry (in the player) is piped to the user's own `hermes chat --query-file -
  -Q -c rom-studio-game --create-if-missing --source game`, stopped after 60 seconds, with the
  user's normal tools and approvals and no approval-changing flag; a session name that reads as
  a flag is refused (`player/server.ts`, `agentCommand()`; its test feeds it such a name).
  `"hermes_link": false` in the game's `settings.json` turns it off.
- **Writes:** the game folder; `<HERMES_HOME>/plugin-data/rom-studio/` (starred pictures, the pane's key, an
  archive during setup); inside the plugin folder the ignored caches `kit/.cache/`,
  `kit/emu/bin/`, `player/node_modules/`, `player/.cert/`.
- **Reads outside its own data:** the game folder the user names, and `plugins.entries.rom-studio`
  in Hermes's config. No `.env`, no `auth.json`, no credentials. Environment fallbacks
  `ROM_STUDIO_GAME`, `ROM_STUDIO_PANE_URL`, `ROM_STUDIO_PANE_PORT` are plain `os.environ` reads of
  non-secret values.
- **Network to third parties at run time:** none. No telemetry.

## The admission rules

1. Human-merged gate: this PR.
2. Exact SHA pin: `sha` is the full 40-character commit of the public repository.
3. No self-updating code: nothing fetches or replaces the plugin's files; the only downloads are setup's two pinned tools (`kit/kit.ts`, `setup()`).
4. SHA bumps are new PRs: understood.
5. Owner submission: the repository is mine.
6. Declared capabilities match: no tools, hooks or middleware in `plugin.yaml`, in `register()` (`__init__.py`) or in the entry; `validate` confirms.
7. Install scanner: `security scan — safe`, no warnings.
8. Desktop inside the SDK: `desktop/plugin.js` imports `@hermes/plugin-sdk`, `react`, `react/jsx-runtime` only; no eval, no script injection, no app markup queries; `desktop surface` check passes.
9. No runtime overrides: imports only `hermes_cli.plugin_events`, `hermes_cli.config`, `plugins.plugin_storage` (all on the public API list); `no core override` passes with no import warnings.
10. Dependencies: no Python dependencies. One npm dependency for the player, exact version, sha512 in `player/bun.lock`.
11. Credentials: the plugin has none. Settings are non-secret `config_schema` keys read through `ctx.get_config` / `load_config_readonly` (`__init__.py`, `dashboard/plugin_api.py`); no `.env` or credential file is read.
12. Approvals: no auto-approve or skip flag is passed anywhere in the tree (code, skills, examples); the one place such a word appears is `player/server.test.ts`, which checks that a session name shaped like a flag is refused; the in-game link runs `hermes chat` with no such flag (`player/server.ts`, `agentCommand()`); nothing waits on a prompt at load.
13. Disclosures: above, in `README.md` ("What it starts, writes and sends") and in `SECURITY.md`.
14. Compatibility: `requires_hermes: ">=0.21.6"` in both `plugin.yaml` and the entry. Every surface used exists at tag v0.21.6 (checked in the hermes-agent source); the plugin has been run on 0.23.1 only. `version` 0.2.0 matches `plugin.yaml`.
15. Not a skin or fork of a bundled plugin.
16. One lineage: an original plugin, not derived from a listed one.
17. No unscannable payloads: `git ls-files | xargs file` shows only text, JSON and PNG; no binaries, bytecode, archives or `node_modules`. The two things setup fetches come from their authors' own releases, are pinned by checksum, and are disclosed.
18. No login backend is registered.

## Validation

At the pinned commit, on Hermes 0.23.1, Linux:

- `hermes plugins validate . --install-deps`: passed, every check green, no warnings.
- `hermes plugins doctor .`: runtime discovery, manifest parsing, import and registration passed; 0 tools, 0 hooks.
- `bun test` from a fresh clone after `bun install --frozen-lockfile` in `player/`: 76 pass, 6 skipped (two need a built game, four need a headless browser named in CHROME), 0 fail.
- The agent half with a stand-in context: nothing starts with no game folder; with one, the pane answers on 127.0.0.1 only and is gone after unload.
- The gates: `pane/server.test.ts` and `player/server.test.ts` cover foreign sites, foreign Host names, the key and the body limits.
- The pane against the sample folder (`pane/sample`): all ten tabs loaded in headless Chromium at 1280 and 390 pixels wide.
- Not tested: the pane inside the desktop app, the feed event arriving, the skill loaded through the plugin, a real phone, macOS, Windows.

## Screenshots

- `docs/images/pane-now.png`: the pane's first screen (the latest entry with its picture, the review beside it)
- `docs/images/pane-gallery.png`: the Gallery tab
- `docs/images/pane-scenes-phone.png`: the Scenes tab at phone width
- `docs/images/banner.png`: the card image (2:1)

All show the neutral sample folder shipped in `pane/sample/`.
