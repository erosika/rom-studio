# ROM Studio reference

A **kit** the agent uses, a **pane** the user watches, and a **player** that shows the game.
Its one job: keep the user up to speed with what the agent is doing with their prompts, little
by little. This page is where the contracts are defined: the game folder, the kit's commands,
the feed and the files beside it, the pane's tabs, the player and its flash guard. Items marked
*unverified* have not been tried.

## The user's game is a git repo

The game folder is a clone of the engine source (the decomp) at a pinned version, with the
user's changes committed on top.

- The decomp source is the only source of truth. There is no second format, no apply step.
- The base patches (calm patches, the HERMES menu, the headless test hook) are committed once,
  as the first commits. They are never re-applied at build time.
- One commit per kept scene. History is the progress record; revert is undo; the diff against
  the pin is the user's game.
- `game.md`, `feed.jsonl`, `shots/`, `refs/` (reference pictures the user sends from the pane)
  and a small settings file (player name and the like) live in the same folder.
- Built ROMs stay out of git and are never distributed. Sharing is a patch (scene 13).

Engine base: bring your own decomp. `kit setup --decomp` copies the tree the user supplies; the
kit names and fetches no engine. The base (calm patches, the START menu's agent entry, the test
hook, the quick start) is optional and is not shipped in this repository: it is patches against
one version of one engine, looked for in `kit/base/` and applied only to that version (recognised
by the hash of one file of the tree). When the folder is absent, or the tree is another version,
setup says so and goes on; everything except flags, creature gifts, exact message text, the quick
start, the calm changes, the game's own settings header and the in-game agent link works without it.

## The kit

One small command-line tool, `kit/kit`. The skills name these commands; the host wrapper
(`kit/mcp.ts`) exposes them as tools one-to-one. The game folder is `--game <dir>`, else
`$ROM_STUDIO_GAME`, else `rom-studio-game` beside the checkout (in the home folder when the checkout is installed as a host plugin). The settings file is
`settings.json` (`player_name`, `player_look`, `original_game`; `private_scenes`: scenes that are only built on the owner's own machine, and `kit patch` refuses while it is true; and the user's choices from the pane:
`image_model`, an optional `image_models` list of `{id, label, note}` to choose from, `workers` as a
list of `{name, how, model, note, enabled}`, and `default_worker`). The kit and the pane change one
key at a time and leave every key they do not know as it is.

**The in-game agent link.** The base puts an agent entry in the START menu and a mailbox in the game's memory
(`gHermesMailbox`). The other end is the player page: `player/hermes-link.js` finds the mailbox in the emulator's memory,
opens one line under the screen when the player chooses the entry, shows the player's words in the game, sends them to
`POST /hermes/ask` on the player server, and writes the answer into the game's message box in the game's own characters
(`player/game-text.js`: wrapped to the box by the game's glyph widths, long answers split between boxes; numbered lines in
an answer become a menu). The server runs the host's own command line, one named conversation, with a time limit:
`<hermes_command> chat --query-file - -Q -c <hermes_session> --create-if-missing --source game`. Settings: `hermes_link`
(false switches it off; on by default when the game has the mailbox), `hermes_command` (default `hermes`),
`hermes_session` (default `rom-studio-game`), `hermes_preface` (what the agent is told before the player's words; the default says
only that the words come from inside the user's game and how short to be: a game writes its own, in its tablet's voice),
`hermes_timeout` (seconds, default 60, 240 at most; after that the command is stopped and the game shows "No signal. Try me
again."). The agent is also told where the player is when the game has the test hook (the place's name and square). The
words go to the command on its standard input, never as an argument; no flag that approves tools or skips a permission is
passed, so the agent can do what the user's own host setup lets a quiet one-shot chat do and no more, and a question it
would ask a person meets a closed input and the time limit; a session name that is not plain letters, digits, dots, dashes
or underscores falls back to `game`. One question at a time. Over the phone link the game file, the agent link's two routes
and the page's log line all need the key (compared in constant time); the page and the emulator's own files do not. Both
servers answer only to this computer's own names (a name from elsewhere pointed at it is refused) and refuse a request a
page on another site made, apart from opening the page itself. `kit status` says whether the game has the mailbox and whether the link is on. Not tried on a real
phone; the driver's headless emulator has no link (it has no page).

| Command | Does | Returns |
|---|---|---|
| `kit status` | Is the toolchain there, is there a game folder, what the decomp is (read from the tree), whether the base is applied, which scene are we on | Plain text, and what to do next if something is missing |
| `kit setup --decomp <folder or git url> [--no-base]` | Bring your own decomp: toolchain check, a copy of the user's decomp into the game folder (their original is untouched), the calm and helper base only if the tree is the version it was made for (skipped, and said so, otherwise), starter `game.md`, first build. With no `--decomp` and no game folder it stops and explains what a decomp is. A git address is `https://`, `ssh://`, `git://` or `git@host:path`; anything else is taken as a folder. The script compiler it downloads is checked against a recorded sha256 before it is unpacked. The kit names and fetches no engine | Progress lines; safe to rerun |
| `kit build` | Incremental build of the game folder. First regenerates every map script whose source (`.pory`) is newer than its generated file, and writes the settings header | OK plus seconds taken, or the first real error with file and line |
| `kit play [--phone] [--stop]` | Starts the player, or reuses the one already running for this game folder. Reload the page after a build | A link for this computer; with `--phone`, also one for a phone on the same network |
| `kit shot [--at group.number,x,y] [--name file.png] [--scale n] [steps]` | A picture from the real game, optionally after placing the player and running driver steps. Default file: `shots/s<current scene>-<next number>.png` | PNG path |
| `kit press <buttons or steps>` | Drives the headless game: walk, talk, advance text. Every run starts from a fresh new game, so the whole route goes on one line | Where the player is now, plus a PNG |
| `kit where [steps]` | Map, position, facing, any open text box | Plain text |
| `kit maps [--all] [--json]` | Lists the user's own maps (added since setup; `--all` for every map): size, group.number, joins, door targets, counts of people, signs and triggers | Plain text or JSON |
| `kit map <name> [--png file] [--overlay people,doors,joins,collision\|all] [--scale n]` | Draws a whole map from the tree's own layout and tileset files; overlays mark people (dots with names), doors, joins (arrows) and squares that cannot be walked on (tint). Default file `shots/maps/<name>.png` | PNG path and a legend |
| `kit tileset <name> roles\|maps\|before-after` | `roles`: a first-guess role for every building block of a tileset (from its behaviour, where maps use it and its main colour), as `roles.json` beside the tileset plus a labelled contact sheet; never replaces an existing table without `--force`. `maps`: the maps that use it. `before-after [--maps a,b,c] [--png file]`: three maps drawn from the last kept commit and from now, side by side | Paths, a summary |
| `kit gates --from <map> --to <map> [--json]` | For the road-between scene: the maps on the walk between two maps (by joins and doors) and, in each, candidates for story gates: trigger squares, scripts that walk the player, people present only under a switch, obstacles. Candidates, not certainties | Plain text or JSON |
| `kit tileset <name> restyle --profile <file>`, `objects`; `kit redraw <art module> [--write]` | The in-place redraw of scene 1, lifted from the first game: `restyle` repaints a tileset by role from the original art in the colours of the user's profile (`kit/restyle.py`); `objects` lists candidate multi-block objects; `redraw` writes the user's own drawings into the tiles of existing objects, or onto the map as new blocks (`kit/objects.py`). No drawing, palette or map name is built in: the profile and the art module are the user's files | Summary, previews, lineage lines |
| `kit lore [<id>] [--json]`, `check`, `new <id> "<NAME>"` | The context and lineage index: one file per town, scene or notable object (`lore/<id>.md`: Look, Voice, Easter eggs, Links, Lineage); everything else links by id (`lore: <id>` comments in scripts, `"lore"` fields in tool tables, `lore id` columns in notes). One id shows its file, what references it, its pictures in time order and its lineage (heading plus `git log` of the file and of the referencing files). `kit/lore.ts` | Plain text or JSON |
| `kit music [--kind song\|effect\|sample\|cry] [--yours] [--json]`, `play\|render\|where <name>`, `replace <name> <file.mid\|.wav> [--voicegroup g] [--volume n] [--keep-loop]` | The game's songs and effects (name, number, MIDI file, voice group, volume, length, which maps have it as their music, whether it differs from the first commit), samples and cries, read from the tree. `play`/`render`: songs and effects are recorded from the built game by the headless emulator (driver steps `bytes` and `audio`), samples are their own files. `replace`: the user's file in place, converted aside with the tree's own tools first and refused with the reason if that fails; the old file stays in git. No generation. `kit/music.ts`; the pane's Music tab (`pane/music.js`, `pane/music.ts`) is the same code | Plain text or JSON; a `.wav` path |
| `kit find "<text>" [--in <glob>] [--regex] [--max n] [--json]`, `kit find --file <path> [--at <line>] [--span n]` | Search the game folder's source with `git grep` (what git keeps plus new files; ignored build output and binaries skipped; a plain walk when the folder is not in git): file, line number, the line, grouped by file, 200 lines at most with a count of the rest. `--file`: numbered lines around a line; a path outside the game folder is refused. `kit/find.ts`; the pane's Source tab (`pane/source.js`, `pane/source.ts`) is the same code, and also brings a decomp in: a folder, a git address or an archive (checked entry by entry, links never made) handed to `kit setup`, refused when the game folder already holds a game | Plain text or JSON |
| `kit dialogue ["<words>"] [--in <place or folder>] [--only new\|changed] [--all] [--page <file.html>] [--json]` | Every line a player can read, by the place it is said in, read from the scripts under `data/maps`, `data/scripts` and `data/text` (`.pory` text blocks and lines written into a script; `.string` lines in `.inc` files that no `.pory` generates). Each text is marked against the setup commit: `new` (its file was added since), `changed` (an older file's text reads differently now) or `same`. Default is new and changed; `--all` adds the untouched original. `--page` writes one self-contained page (places down the left, a search box). `--story` lists the places in the order a player reaches them: from the map a new game starts on (read from the engine's source, or `start_map` in settings.json), outward through map joins and doors, a building right after the place its door is in; places it cannot reach come last. The tab offers the same order, A to Z, and for notes the order they were written. The pane's Dialogue tab is the same reading (`kit/dialogue.ts`, `pane/dialogue.ts`, `pane/dialogue.js`). |
| `kit dialogue --notes [--json]`, `kit dialogue --done "<text's name>" \| --done all` | The notes the user wrote on single texts in the pane's Dialogue tab (`dialogue-notes.jsonl` in the game folder: one row per save, the latest per text counts, an empty note takes it back). `--notes` prints each waiting note with its place, the text as it reads now, and the wording it was written against when that has changed since. `--done` marks a note dealt with, so it leaves the user's list. The tab also exports the same text as a file and copies it. |
| `kit scenes [--json]` | The scenes in `game.md` with ticks and, for each, its feed entries (by their `scene`) and pictures (from those entries, else by file name: `s2-...`, `2-...`, `scene2-...`). `kit shot` names pictures `s<scene>-<number>.png` | Plain text or JSON |
| `kit note "<sentence>" [--shot png] [--next "<sentence>"] [--asked "<words>"] [--scene "<name>"] [--by "<stream>"] [--before png] [--answers <entry time>] [--lore <id>]` | Appends to the feed. The scene defaults to the first unticked one in `game.md`. `--by` says who wrote it when several agents work at once; `--before` is a second picture shown beside `--shot`; `--answers` marks a "needs work" as dealt with; `--lore` also writes the sentence, dated, under Lineage in `lore/<id>.md` | The entry |
| `kit reviews [--open] [--scene "<name>"] [--json]` | What the user answered to feed entries in the pane (`reviews.jsonl`): "looks right" or "needs work", with a note. `--open`: only "needs work" that no later entry answers | Plain text or JSON |
| `kit decide "<question>" [--options "a\|b"] [--recommend "<option>"] [--scene "<name>"] [--detail "<line>"]`, `kit decisions [--open] [--json]` | A question for the user, appended to `decisions.jsonl` and shown under Decisions in the pane; `decisions` prints the questions with the answers given | The id; plain text or JSON |
| `kit settings [key] [value]`, `kit workers [--json]` | Read or set a key of `settings.json`; the helpers the user switched on and the default one. `kit status` also prints the chosen `image_model`. The kit makes no pictures: the agent's own tool reads the choice | Plain text or JSON |
| `kit keep "<scene name>"` | Commits the scene, ticks it in `game.md` | The commit |
| `kit undo [--yes]` | With changes not kept yet: lists them and stops; with `--yes` (the user agreed) sets them aside with `git stash` and is back at the last kept scene. With nothing changed: takes back the last kept scene with a revert commit | What was undone, and the one command that brings it back |
| `kit patch [--original <file>] [--file <x.bps>]`, `kit patch --check <original>` | Writes `out/game.bps` from the original game file (`original_game` in `settings.json`) to the built game and re-applies it to check itself; `--check` applies a patch to a copy and compares | Path, size |

How it is built:

- **Build** (`kit/build.sh`) regenerates changed map scripts, runs `make`, copies the ROM to
  `out/game.gba` and dumps its symbols to `out/game.sym`. One build at a time, under a lock file.
- **Headless game**: `kit/emu/studio-emu.c`, a small C program on the emulator library with a
  line protocol over stdin, built on the user's machine by `kit setup`; `kit/drive.ts` drives it.
- **Host wrapper**: `kit/mcp.ts`, one stdio MCP server carrying the kit's commands one to one, so
  any host that speaks MCP sees the same tools. Tried over stdio by hand; adding it to a host's
  config is *unverified*.

Rules for the kit:

- Every command prints something a person could read. Errors say what to do.
- No locks beyond the build's, no releases, snapshots, provenance records, or multi-user
  handling. One user, one game folder, one build at a time.
- `kit build` must show the first real error plainly, with file and line.
- The script compiler is named only where it is fetched and run (`kit/kit.ts`, `kit/build.sh`);
  everywhere a user reads, it is "the script compiler".

## The feed

`feed.jsonl` in the game folder, append-only, one JSON object per line:

```json
{"t":"2026-11-12T14:03:10Z","scene":"2 Someone to talk to","asked":"put my grandmother by the stove","did":"Added a woman standing by the stove. She faces down and says your line when you talk to her.","shot":"shots/0042.png","next":"Building the game so you can try it."}
```

- `asked`: the user's request in their words, shortened. Present on the first entry after a
  prompt, so each prompt visibly leads to what was done about it.
- `did`: one or two plain sentences. What changed in the game, not which files.
- `shot`: optional picture from the real game.
- `next`: optional, what is about to happen.
- A `detail` field may hold file names and the diff summary, shown only when the user opens it.
- All optional: `by` (who
  wrote it: a stream name, when several agents post at once), `before` (a second picture, shown
  beside `shot` as before and after), `answers` (the `t` of an entry the user marked "needs work",
  when this entry deals with it).

Two more append-only files sit beside the feed, written by the pane when the user answers and
read by the kit:

- `reviews.jsonl`: `{"t","id","entry","scene","verdict":"right"|"work","note"}`. `entry` is the feed
  entry's `t`; `id` is a short hash of its time, scene and sentence (two entries can share a
  second). The latest line for an entry wins.
- `decisions.jsonl`: a question `{"t","id","scene","question","options","recommend","detail"}` from
  `kit decide`, and an answer `{"t","answer_to":"<id>","answer"}` from the pane. The latest answer wins.

The agent writes an entry after each meaningful change, not at the end. "Little by little" is the
requirement: several small entries per prompt, each a sentence.

How it reaches the pane: `kit note` appends the line. The pane's own small server
(`pane/server.ts`: this computer only unless `--bind` says otherwise, and then another device needs the link with the key it
prints at start, `/k/<key>/`, kept in `<data>/pane-key.txt`; no page on another site can read from it, write to it or start
anything in it; the pane and the player answer only to this computer's own names and bare addresses, plus any name listed in `$ROM_STUDIO_HOSTS` (comma separated: for a reverse proxy the owner put in front, with its own certificate); writing routes take `application/json` or a file, with a size limit read as the body arrives) reads the file, and the page asks it every three seconds, so the feed
survives a reload and needs no host. Inside Hermes the plugin also sends a "feed changed"
event that makes the page look at once (not seen in the desktop app yet).

## The pane

One screen, phone width first:

1. **Now**: the latest picture, the latest `did`, and `next` while work is in progress.
2. **Play**: opens the game at the latest build.
3. **Feed**: earlier entries, newest first, grouped under the prompt that caused them.
4. **Your game**: the ladder with ticks, from `game.md`.

More tabs sit beside that first screen:

- **Gallery**: every picture in `shots/`, newest first, as a grid. Filter chips by group (the
  scene when the feed names one, else the start of the file name), a search box on file names, a
  "New" mark for pictures newer than this browser's last look, a star that puts a picture on a
  "Kept" shelf (remembered in `pane-state.json` in the pane's data folder, outside the game folder: `--data <dir>`, by default `pane/data/`; the Hermes plugin passes the host's data folder for the plugin), and a shelf
  for `refs/` with the control that sends a reference picture. Opening a picture gives a large
  view with previous and next (arrow keys, swipe), copy path, and Compare: two pictures at one scale.
- **Dialogue**: every line a player can read (`kit dialogue`), the places down the left and what is said in the chosen place on the right. Chips choose new scripts, changed lines, the untouched original, everything, or the texts with the user's notes; the places come in the order a player reaches them, A to Z, or for notes the order they were written; a search looks through all of it. Every text has a Note button: the note is kept in `dialogue-notes.jsonl` in the game folder for the agent (`kit dialogue --notes`), and all waiting notes can be exported as a file or copied.
- **Scenes**: each scene with its tick, its idea, and the pictures and feed entries that name it.
  The list comes from `kit scenes --json` when the kit has it, else from tick lines in `game.md`,
  else from headings that say "scene N"; pictures tied to no scene are grouped by file name.
- **Maps**: a card per map the user made (added since the engine's first commit): size, people,
  doors and where they lead, a picture with layers for people, doors and blocked squares, and a
  line drawing of which map leads to which. The picture is `kit map <name> --png` (drawn into the pane's own data folder, not the game) when the kit
  has it, else a `shots/*render*.png` matched by name, else a plan drawn from the blocked squares.

`next` is shown when the newest entry has one, so the last entry for a prompt leaves it out. The
newest entry is under Now; Feed lists the ones before it.

Answering the agent, and the rest:

- **Answers on entries.** Each feed entry has "Looks right", "Needs work" and a note box; the
  answer is appended to `reviews.jsonl` and shown on the entry, and a stream's tile counts its
  open "needs work". The agent reads them with `kit reviews --open`.
- **Tiles by stream or by scene.** When entries carry `by`, a switch on the first screen groups
  the tiles by who is working or by scene. The Scenes tab is always the game's scene list.
- **Before and after.** An entry with `before` shows the two pictures side by side (stacked on a phone).
- **Decisions** tab: the agent's open questions newest first, each with its options as buttons
  (the recommended one marked) and a free answer; the first screen says how many are waiting.
- **Settings** tab: the picture model (a list when `image_models` is set, else a text field) and
  the helpers (on or off, the default, model, command, note, add, remove). It writes only those
  keys of `settings.json`.
- **Music** tab: the game's songs, effects and samples, the same code as `kit music`; a listening page
  (`/listen/`) lists audio files left under the game's `out/music/`.
- **Source** tab: search of the game folder's source (the same code as `kit find`), and bringing a
  decomp in: a folder, a git address or an archive, handed to `kit setup`; refused when the game folder
  already holds a game.
- **Lore** tab: the lore index, read-only.
- The first screen says whether the last build worked and when (`out/.last-build`).

No map, people or scene editors and no change ledger: beyond the answers and the settings
above, the tabs only show. If the user wants something in the game changed they say so in the
chat, or mark an entry "needs work" with a note. The feed is sentences about the game with
pictures, not a log of tool calls.

The pane listens on 127.0.0.1 unless started with `--bind`. From this computer it needs no
sign-in; from any other device it needs the link with its key; a page on another site is refused
(the feed section above has the rule in full, `kit/web.ts` the code).

## The player

`player/server.ts` serves a page with the emulator (the `@thenick775/mgba-wasm` package, fetched
by `bun install` at setup from the lockfile) and the built game. It needs cross-origin isolation
headers on every response, which browsers honour only on localhost or https: so the phone link
(`kit play --phone`) is https with a certificate made on the user's machine and a key in the
link. Reaching it from a real phone is *unverified*.

On this computer the player also passes `/pane/` on to the pane (`$ROM_STUDIO_PANE_LOCAL`, default
`http://127.0.0.1:8778`), so an owner who puts one trusted address in front of the player reaches
both; `$ROM_STUDIO_HOSTS` names that address to both servers.

**Calm is a hard requirement and has two layers.**

- **In the game:** the calm patches are part of the base commits.
- **In the player:** the flash guard (`player/guard.js`, tests in `player/guard.test.ts`) sits
  between the emulator and the screen: always on with no switch; timed in milliseconds, not
  frames; and checked against local and colour flashes, not only whole-screen brightness. No
  surface shows the game without it.
- Nothing in the pane animates on its own.

Also:

- **Saves** are kept by the browser. A build must never destroy a save without saying so.
- Touch controls on phones.

## Not in ROM Studio

Release directories and rollback. Provenance and hash records. A change ledger separate from
git. Layout-percentage and style checkers. Multi-user accounts. Map, people or scene editors in
the pane. Any check that takes longer than the change it checks.
