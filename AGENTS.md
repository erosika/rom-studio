# For coding agents working on this repository

ROM Studio is a Hermes plugin plus a toolkit for making a game from a decomp the user supplies.
Read `README.md` (what a user sees), `docs/STUDIO.md` (the contracts) and `docs/PRINCIPLES.md`
(the rules) before changing anything.

## Layout

    plugin.yaml          the Hermes manifest: name, version, requires_hermes, config_schema
    __init__.py          agent half: starts and stops the pane, watches the feed, registers the skills
    dashboard/           backend route /api/plugins/rom-studio/where (plugin_api.py) and its manifest
    desktop/plugin.js    desktop half: the pane in a frame; plain ESM, no build step
    kit/                 the command-line kit
      kit                bash entry point; kit.ts holds every command
      mcp.ts             the same commands as MCP tools over stdio, one to one, no logic
      drive.ts           drives the headless emulator (shot, press, where)
      build.sh           one build at a time
      emu/               the headless emulator's C source and its build script (output: emu/bin/, ignored)
      web.ts             what the pane and the player check before answering a browser
      *.py               redraw helpers (need Pillow)
    pane/                the page the user watches: server.ts, index.html, pane.js, music, source, listen
      sample/            a small neutral game folder for trying the pane
    player/              the built game in a browser: server.ts, play.js, guard.js (flash guard), hermes-link.js
    skills/              Agent Skills; make-your-game is the guided path
    docs/                STUDIO.md (reference), PRINCIPLES.md (rules), images/ (README pictures)
    catalog/             the catalog entry and the pull request text

The plugin is the repository root because a catalog install keeps one folder and the plugin runs
the pane and the kit from it. Do not move the manifest or the halves into a subfolder.

## Run and test each part

Never point a command at a game folder you were not given. The kit's default game folder is
`rom-studio-game` beside the checkout: if one exists there it is somebody's real game. Pass
`--game <scratch folder>` or set `ROM_STUDIO_GAME` every time.

    cd player && bun install --frozen-lockfile && cd ..   # once: the browser emulator
    bun test                                              # all tests (kit, pane, player)
    ./kit/kit help                                        # the kit's manual
    ./kit/kit status --game <folder>                      # tools present, state of a game folder
    cp -r pane/sample /tmp/sample-game
    bun pane/server.ts --game /tmp/sample-game --port 8796    # the pane on a spare port
    hermes plugins validate . --install-deps              # the catalog's gate; must pass
    hermes plugins doctor .                               # loads the plugin with the real loader

- Two tests need a built game and the headless emulator and are skipped without them. They look
  for a game at `$ROM_STUDIO_GAME`, else beside the checkout, and only read it.
- The pane: load every tab (`#now`, `#gallery`, `#scenes`, `#maps`, `#music`, `#source`, `#lore`,
  `#decisions`, `#settings`) at laptop and phone width in a headless browser and look at the pictures.
- The agent half outside a host: import `__init__.py`, call `register()` with an object that has
  `get_config`, `on_unload` and `register_skill`, and check the page starts on 127.0.0.1 and
  stops on unload.
- Stop every server you start. Use spare ports, not 8778 or 4870.

## How to prove a change

- Kit: a real build of a real game folder, then a picture from the running game
  (`kit press` or `kit shot`) that shows the change. Reading the code is not a check.
- Pane or player: a screenshot of the page with the change, at both widths.
- Anything a user would notice: a `kit note` entry in the feed of the game folder you tested with.
- Report what you ran, what you did not, and what failed, in those words.

## Rules that matter

- **Neutral.** No franchise, game, engine, creature, character or place names, and no personal
  names, in code, comments, examples, tests, docs or commit messages. The only exceptions are a
  tool's name where it is fetched or run, and one value of the engine's own layout files that
  `kit/objects.py` has to compare against. The optional base (patches for one engine version) is
  kept out of this repository for that reason: do not add it back without the owner's yes. Before committing, run a grep for personal names, home paths and private network addresses over the tree;
  it must come back empty apart from the licence holder and the manifest author.
- **Comments say why, in one line.** No block comments restating the code.
- **Small plain commits**, by path, one sentence saying what changed in behaviour. No
  attribution lines.
- **No pushing, publishing or releasing without the owner's yes.** Never touch `~/.hermes`.
- **Never build a checker or an editor.** No style, layout or art checkers; no map, people or
  scene editors in the pane. See `docs/PRINCIPLES.md` 5, 8 and 9.
- **Budgets.** Keep each part readable in a sitting; a change that grows a part a lot says why.
- **The flash guard is always on.** No switch, no bypass, no surface without it.
- **Saves survive.** Append; never reorder or delete what a save refers to by number.
- **Docs stay small.** Contracts go in `docs/STUDIO.md`; update it in the commit that changes one.

## Where the contracts are

`docs/STUDIO.md`: the game folder's files, every kit command and what it returns, the feed and
the files beside it (`feed.jsonl`, `reviews.jsonl`, `decisions.jsonl`, `settings.json`), the
pane's tabs, the player and the guard. `kit/kit.ts`'s help text and `kit/mcp.ts`'s tool table
must agree with it, and `skills/make-your-game/references/kit-today.md` tells the agent what
each command does today: change all of them together.

## What not to touch

- `kit/web.ts` and the gates in `pane/server.ts` and `player/server.ts` (own names only, no
  other site's page, the key for other devices, body limits) without running
  `pane/server.test.ts` and `player/server.test.ts`.
- `player/guard.js` without running `player/guard.test.ts` and reading its numbers.
- `player/bun.lock`: the pin for the browser emulator. Change it only with the package version.
- The checksum and commit pins in `kit/kit.ts`, unless you fetched the new file yourself.

## Marketplace constraints the code must keep satisfying

The plugin is listed in the Hermes plugin catalog at an exact commit. These hold at every commit
that may be pinned (the numbers are the catalog's admission rules):

- **No self-update (3).** Nothing fetches and replaces this repository's files.
- **Capabilities match (6).** `plugin.yaml` `provides_tools` and `provides_hooks` list exactly
  what `register()` registers (today: nothing). `catalog/rom-studio.yaml` repeats them.
- **Desktop half inside the SDK (8).** `desktop/plugin.js` imports only `@hermes/plugin-sdk`,
  `react` and `react/jsx-runtime`; no `eval`, no script injection, no reaching into the app's markup.
- **No core overrides (9).** Import only documented Hermes modules (`hermes_cli.plugin_events`,
  `hermes_cli.config`, `plugins.plugin_storage`); never rebind anything in Hermes.
- **No credential or `.env` reads (11).** Settings come from `ctx.get_config` and
  `load_config_readonly()`, with `os.environ` as the only fallback. There are no secrets.
- **Approvals respected (12).** No flag that skips or auto-approves anything, anywhere: not in
  code, not in a skill, not in an example of a helper's command.
- **Disclosures current (13).** A new process, port, download, shell command or place written to
  goes into `README.md` ("What it starts, writes and sends"), `SECURITY.md` and
  `catalog/rom-studio.yaml` in the same commit.
- **Loopback by default.** Every server binds 127.0.0.1 unless the user asks otherwise with a
  flag, and then other devices need a key. No hostname or address of a real machine in any file.
- **Truthful metadata (14).** `version` in `plugin.yaml`, `dashboard/manifest.json`, `kit/mcp.ts`,
  `CHANGELOG.md` and the catalog entry move together. `requires_hermes` is a SemVer floor that
  really has every surface used.
- **No binaries (17).** No compiled program, bytecode, archive or `node_modules` is tracked
  (`git ls-files | xargs file`). What setup downloads is pinned by checksum or lockfile, comes
  from its author's own release, and is disclosed. State never goes into tracked paths.
