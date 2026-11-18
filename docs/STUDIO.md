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

**The in-game agent link is not in the player.** The player page is a plain player. Its side of the link
(`player/hermes-link.js`, the line under the screen for the player's words, `GET /hermes/info` and `POST /hermes/ask`
on the player server, the message wrapping and reply menus in `player/game-text.js`, the `hermes_link`,
`hermes_command`, `hermes_session`, `hermes_preface` and `hermes_timeout` settings, and their tests) was taken out in 0.3.0.
What stayed: the memory capture (now in `player/ram.js`), the naming-screen box and `game-text.js`'s table,
`normalize` and `encodeLabel` for it. The base's START entry and mailbox are unchanged; with this player
nothing answers them. Over the phone link the game file and the page's log line need the key (compared in constant
time); the page and the emulator's own files do not. Both servers answer only to this computer's own names (a name
from elsewhere pointed at it is refused) and refuse a request a page on another site made, apart from opening the page
itself.

| Command | Does | Returns |
|---|---|---|
| `kit status` | Is the toolchain there, is there a game folder, what the decomp is (read from the tree), whether the base is applied, which scene are we on | Plain text, and what to do next if something is missing |
| `kit setup --decomp <folder or git url> [--no-base]` | Bring your own decomp: toolchain check, a copy of the user's decomp into the game folder (their original is untouched), the calm and helper base only if the tree is the version it was made for (skipped, and said so, otherwise), starter `game.md`, first build. With no `--decomp` and no game folder it stops and explains what a decomp is. A git address is `https://`, `ssh://`, `git://` or `git@host:path`; anything else is taken as a folder. The script compiler it downloads is checked against a recorded sha256 before it is unpacked. The kit names and fetches no engine | Progress lines; safe to rerun |
| `kit build` | Incremental build of the game folder. First regenerates every map script whose source (`.pory`) is newer than its generated file, writes the settings header, and writes the cheat-code table from `codes.json` when the game has one (`kit/codes.ts`; a problem in the codes stops the build with the problem named) | OK plus seconds taken, or the first real error with file and line |
| `kit play [--phone] [--stop]` | Starts the player, or reuses the one already running for this game folder. After a build the open page offers the new one (or reload it) | A link for this computer; with `--phone`, also one for a phone on the same network |
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
| `kit pixel find <png...> [--crop x,y,w,h] [--map map.bin --pal file.pal --width 32] [--scale 8] [--out dir] [--json]`, `kit pixel edit <png> [edits.json] [--undo]`, `kit pixel variant <base.png> <new.png>`, `kit pixel colours [png...]` | The pixel step, after any generated or redrawn picture. `find` reads an indexed picture (a `tiles.png` with a `map.bin` and a `.pal` beside it is read as the picture the game shows: one copy of a repeated picture, up to the first empty row) and reports single pixels and pairs that touch nothing of their colour, colours used by under 4 pixels, hardly-used colours that sit between their two neighbours (a soft edge left behind), small patches (3 pixels to 2% of the picture) in a tinted colour far in hue from every tinted colour around them, and palette entries that are the same or nearly the same colour; many findings alike are grouped and marked as probably texture. It writes `out/pixels/<name>.find.png` (8x, a line every 8 pixels, coordinates every 16, each finding ringed and numbered: red to look at, yellow probably texture), `.close.png` (a close-up of each) and `.find.txt`. `edit` applies the edits file kept beside the picture (`<png>.edits.json`: `set [x, y, colour]`, `fill [x, y, w, h, colour]`, `replace [x, y, w, h, from, to]`, `copy [from x, from y, w, h, to x, to y]`, each with an optional `why`) to the picture's colour numbers: every chunk of the PNG but the pixels is written back as it was, so palette, size and depth cannot change. The picture before the first edit is kept as `<png>.orig`; the file records what it was applied to (`applied`), so running it again starts from the original, and after the picture is rebuilt from its source the same edits go back on the new one. `--undo` restores the original. In a tile sheet coordinates are the shown picture's and an edit lands in the tile: every place that draws the tile changes, and the tool names such tiles. It prints a before and after close-up sheet. The rule: look at the sheet, fix real specks, leave intended texture, never regenerate a picture to fix a speck. A `colour` edit (`[n, "#RRGGBB"]`) recolours without redrawing: what colour number n looks like changes, no pixel moves; the palette file the game actually reads (found from the game's source: a `.pal` named like the picture, nearest to it, e.g. `graphics/trainers/palettes/x.pal`; or the picture itself when its source makes the palette from the `.png`) is named as `"colours"` in the edits file and changed with the picture, its original kept as `<pal>.orig`. `kit/pixel.ts`; the pane's Pixels tab (`pane/pixels.js`, `pane/pixels.ts`) is the same code: search the game's pictures, open one, zoom, the picture's own palette, pencil, fill, picker, move, undo, the find marks drawn on top; Save appends to the same edits file and applies it, Take back the last save removes it. Two more edits, for repainting a garment by hand: `bucket [x, y, colour]` is the paint bucket, the pixels of one colour number joined side by side to (x, y), with an optional `"box": [x, y, w, h]` to keep it inside a box (a top drawn in the same colour as the face lines is moved off that colour below the face only); `draw [x, y]` with `"rows": ["..e4e..", ...]` puts a small typed drawing in place, one character a pixel (0-9 a-f a colour number, `.` left as it is): a hat, a hood, an outline, by hand; with `"onto": [colour numbers]` it paints only the pixels that are now one of those colours: `[0]` puts it behind the figure (a far wing, a tail), a garment's colour keeps polka dots, stripes or a zigzag on the garment and off the hair and hands. `variant` makes a new picture from a base (an outfit of a drawing she loves): a copy, and an edits file naming the base as `"base"`; every `edit` run starts from the base's pixels as they are then, so the edits file is the whole recipe and goes back on when the base is redrawn, `--undo` makes it the base again, no `.orig` is kept, and `find` on a variant lists only what is new since its base. `colours` says which palette file the game draws each picture with (the trainer tables: `TRAINER_FRONT_PIC` / `TRAINER_BACK_PIC` and the files their symbols are made from) and whether the game shows the picture's own colours; a palette file shared by a front and a back with different colours is named as the cause (a figure's throw drawn with its new photo's palette came out with green skin). With no picture it lists every picture shown in colours that are not its own, and exits 1 when there is one | Plain text or JSON; PNG paths |
| `kit codes [--check] [--json]` | The game's cheat codes as data. `GAME/codes.json` (the base's overlay brings 15 starter codes in neutral words) is checked (capitals and digits, 10 letters, no code twice, one known effect with its own fields, once and on/off codes with a save flag of their own and no flag shared, test-only effects marked test, the ALL CODES line short enough, only text the game can show; against the tree: every flag and var exists, `WE_FLAG_NO_ENCOUNTER` names the no-wild flag, followers compiled in for the follower code, a named script exists, the engine's table format) and turned into `include/studio_codes_table.h` by `kit build`, rewritten only when it changed. `STUDIO_CODES_BUILD=test` makes a test build (walking through walls, the next day); a release is a play build. The engine is the base's `src/zz_studio_codes.c`: a code never claims what it didn't do (no room in the BAG or party: says so and counts what fitted; money at its cap; setting money to what it already is; turning walking through walls off while standing inside something solid is refused until open ground; a wrong code says nothing changed and where the list is), KILLSWITCH turns every switch off at once (walking through walls stays on inside a wall, and says so), the CODES menu has an ALL CODES row (every code with a few words, six to a page; a play build leaves out test-only codes), and the base patch `0024-codes-switches` adds the switches other parts of the game read: double EXP, about four times the wild encounters, no wild encounters (the expansion's own flag), and the expansion's follower creature compiled in but off in every save until the follower code (bob off, standing still instead of walking in place, no white flash at the ball). `kit/codes.ts`, `kit/codes.test.ts` | Plain text or JSON; exit 1 on a problem |
| `kit scenes [--json]` | The scenes in `game.md` with ticks and, for each, its feed entries (by their `scene`) and pictures (from those entries, else by file name: `s2-...`, `2-...`, `scene2-...`). `kit shot` names pictures `s<scene>-<number>.png` | Plain text or JSON |
| `kit note "<sentence>" [--shot png] [--next "<sentence>"] [--asked "<words>"] [--scene "<name>"] [--by "<stream>"] [--before png] [--answers <entry time>] [--lore <id>]` | Appends to the feed. The scene defaults to the first unticked one in `game.md`. `--by` says who wrote it when several agents work at once; `--before` is a second picture shown beside `--shot`; `--answers` marks a "needs work" as dealt with; `--lore` also writes the sentence, dated, under Lineage in `lore/<id>.md` | The entry |
| `kit reviews [--open] [--scene "<name>"] [--json]` | What the user answered to feed entries in the pane (`reviews.jsonl`): "looks right" or "needs work", with a note, or a note alone. `--open`: only "needs work" and notes that no later entry answers | Plain text or JSON |
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

- **Answers on entries.** Each feed entry has "Looks right", "Needs work", a note box and "Send
  note" (the note alone, for a pick or a remark that is neither verdict); the answer is appended to
  `reviews.jsonl` and shown on the entry, and a stream's tile counts its open "needs work" and
  notes. The agent reads them with `kit reviews --open`.
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

**The look.** The
pane uses the system of ROM Studio's video: a graphite near-black backdrop with a paired light mode (the video's
captured tokens), IBM Plex Mono for the name, tabs, labels and captions and Inter for longer text (both SIL OFL 1.1,
shipped with their licences in `pane/fonts/`), headings as small cyan uppercase label pills with their counts after
them, the open tab as a filled pill, hairline rules, framed panels, game pictures pixel-sharp in a framed panel, and the
name "ROM Studio" with "for Hermes Agent" in the editorial pink, at the top and as the footer wordmark. Inside Hermes
the pane follows Hermes's colours and mode (`pane/theme.js`); the pink and the mono face stay. Every word measures
4.5:1 or more in both modes (`pane/layout.test.ts`). Nothing moves: no transitions, no hover glow; Pause updates keeps
the page still. The sample game's pictures are calm stand-ins in the same look (`pane/sample-frames.py`), not drawn
rooms. The Hermes mark is not copied into ROM Studio: the video's footer used Hermes's own mark, which only Hermes shows.

No map, people or scene editors and no change ledger: beyond the answers and the two settings
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

### The play page today

`player/index.html` and `player/play.js`, with what the page says and decides kept apart in `player/checks.js` (tested
in `player/checks.test.ts`) and the look into the emulator's memory in `player/ram.js`.

- **Save and load.** Two buttons under the picture: **save here** makes a save point (the exact moment) and **load**
  goes back to it. **saves and settings** opens the rest. There are two kinds of save and the panel says which lasts:
  - *The game's own save* (START, then SAVE, inside the game) **survives a rebuilt game** and a closed page: choose
    CONTINUE on the title screen.
  - *A save point* fits only the build it was made on. After a rebuild the page says it is from an older build and
    does not load it (loading it would show a broken game).

  Both are kept in the browser, on that device, per game (the server gives each game folder a name that stays the same
  across builds and gives away no path; the game file itself is not kept). Each can be exported to a file and imported
  again, on this device or another: `save-<game>-<build>-<date>.sav`, `savepoint-<game>-<build>-<date>.ss1`. An import
  is refused with a reason when the file is not a save of this kind, is empty, belongs to a game with another save
  size, or is a save point whose name says another build. Importing the game's save restarts the game. In a private
  window, where the browser keeps nothing, the page says so and that exporting is the way to keep a save.
- **Typing on a phone.** When the game's own naming screen opens, a text line opens under the picture with the name the
  game proposes; on a phone a tap on it brings up the phone's keyboard. **use it** writes the letters into the naming
  screen in the game's own characters (letters the game's font lacks are dropped, the length is the game's own limit),
  then presses START and A. **cancel** leaves the game's letter grid, and a **type** button brings the line back. This
  needs the naming screen's place in memory, which the server reads from the built game's symbols and the engine's
  source; when it cannot be read for sure nothing opens and the game's own letters are used. The agent entry of the
  START menu uses the same line. On a phone held upright the picture stays at the top while the keyboard is up.
- **Pace.** The panel shows, for the last two seconds: the game's speed against the original machine's (from the
  emulator's own frame counter), the display's refresh rate, pictures a second that reached the screen, the cost of
  each, the longest wait between two, how many regions the guard held, and with sound on how far the sound drifts a
  minute. Three slow stretches in a row put one line above the controls saying which of these it was. A display faster
  than 60 Hz is not fed the same picture twice. **low power** shows every other picture and asks less of the emulator
  (frame skip, a larger sound buffer); switching it reloads the page and carries straight on from the same moment.
- **Plain messages.** The page says in one sentence each: the browser has no WebAssembly; the address cannot run the
  emulator (not this computer and not https); the browser gave no shared memory (an app's built-in browser); WebGL is
  off; the phone link was opened without its key; the player on the computer was started before its last update and cannot
  hand out the page (`kit play` starts such a player again by itself); there is no built game yet (it waits and starts by itself when one
  appears); the computer does not answer; the connection was lost while playing (the game keeps running, saves stay in
  the browser) and when it is back; a newer build is ready (with a button, so a rebuild never interrupts a game); the
  emulator crashed or the browser took the graphics away (with a button to bring it back).
- **Away and back.** When the tab is hidden or the phone is locked the game and its sound stop and held buttons are
  let go; a save point of that moment is kept apart from the user's own. Coming back resumes. If the browser threw
  the page away meanwhile, the reloaded page carries on from that moment and says so. The screen is asked to stay awake.
- **The flash guard is always on.** There is no control for it and one place in the page draws on the visible canvas,
  the guarded picture (`player/checks.test.ts` holds both). `?selftest` feeds a strobe through the same path and
  measures the visible screen.
- **Checks.** `bun test player` (the guard, the server's routes, the page's decisions); `CHROME=<a headless Chrome> bun
  test player/page` opens the real page at a phone's size and a desk's. Page addresses for scripts: `?selftest`,
  `?debug`, `?report`.

## An agent plays the game

`kit agent-play` lets an agent play the built game instead of a person. It is local and private: nothing is deployed, and
the built game never leaves the game folder. `kit/agent-play/`; `kit agent-play help` prints all of this.

**The loop.** The built game runs in the headless emulator from the moment it is switched on. Each step the agent is
given one JSON object, and answers with one:

| Given (`step`) | |
|---|---|
| `picture` | The screen now: `path` of a PNG file, `width`, `height` (enlarged by `--picture-scale`, default 2); with `--inline-picture` also `png_base64` |
| `text` | The text in the message box now, `""` when none is open |
| `where` | `{map: "group.number", x, y, facing, control}`; `control` is whether the player can move; `null` before the game has a player on a map |
| `last` | The last eight steps: `{step, do, thought, result}` |
| `notes` | The agent's own running notes, as it last wrote them. They are all it remembers between steps |
| `step`, `steps_left`, `played` | This step's number over every run of the save, how many more this run allows, `{steps, seconds}` so far |
| `how` | The rules of the answer, in words |

| Answered | |
|---|---|
| `do` | Moves in the driver's step language, and only these of it: `press A,B,UP:30,A+B`, `walk UP:3,LEFT:2`, `wait 60`. At most 32 taps and squares, a hold of 120 frames, a wait of 600. A walk that is blocked ends the answer there |
| `thought` | One line, shown on the watch page and kept in the log |
| `notes` | Optional: replaces the running notes (2,000 characters at most) |
| `stop` | Optional `true`: the agent ends the run |
| `tokens` | Optional, from a command only: what this answer cost, counted against the cap |

An answer that is not one (no JSON object, a move outside the list, past a limit) presses nothing, is told back to the agent
in `last` as the result, and counts as a step. Five in a row end the run.

**Two ways to be the agent.**

- `--agent "<command>"`: the user's own agent as a command line. It is started once per step with the step as one line
  on its standard input, and what it writes to standard output is the answer (a JSON object, alone or inside other words).
  No shell reads the command line. The command is given a short plain environment (path, home, language, terminal) and
  nothing else of ours; `--agent-env NAME,NAME` lets named variables through when the user's agent needs them.
  `kit/agent-play/sample-agent.ts` is a player with no model that follows the shapes: it presses A through text, walks
  until stopped, turns, and presses A at what stopped it.
- `--provider anthropic|openai --model <id>`: a model behind an HTTP chat API that takes pictures. `openai` is the chat
  completions shape that many services and local servers speak; `--base-url` points at one (https, or http on this
  computer only). The key is read from a named environment variable (`--key-env`, by default the provider's usual
  name), kept in memory, sent only in that request's header, taken out of this process's environment as soon as it is
  read, and never written to a file, printed, logged or given to another program; what a service says back is quoted
  only with the key removed. Each step is one request with no history but `last` and `notes`. *Not tried against a
  live service*: the requests are checked in the tests against a stand-in.

**Caps.** `--steps` (default 100) is this run's budget. `--cap-steps` (10,000) and `--cap-tokens` (200,000) are over every
run of a save; they are checked before each step, so nothing is asked once a cap is reached, and the answer in
progress may pass the token cap by one answer's worth (`--reply-tokens`, default 4,000, bounds its output).
`--timeout` (120 s) bounds one answer. Ctrl-C ends the run after the step in hand.

**The save.** `out/agent-play/<--name, default play>/` in the game folder: `state.ss` (the moment after the last finished
step; the next run with the same name carries on from it), `run.json` (totals, notes, the last twenty steps),
`steps.jsonl` (one row per step: time, picture file, text, where, the moves, the thought, the result, tokens, how
long the agent took, the notes), `pictures/<step>.png`, and the save's own copy of the build it began with
(`game.gba`, `game.sym`). The copy is there because a saved moment only fits the build that made it, and because a
`kit build` while an agent plays would otherwise change the game under it. After a new build the save carries on in
its old one and says so; `--fresh` starts the new build from the beginning and moves the old save aside (never deletes it).

**Watching.** `--watch [port]` (default 8790) serves one page on 127.0.0.1 only: the live picture at the largest
whole-number size that fits, unsmoothed; the agent's latest thought; the message box text; where the player is; how
long it has played; the last twenty steps. The page is read-only: it answers GET and nothing else, has no request that
presses a button, refuses a name that is not this computer's and a page on another site, and loads no script but its own.
Every picture that leaves goes through the player's flash guard (`player/guard.js`), timed by the real clock, 25 times a
second; the guard is built into the watcher and has no switch. While watched, the game runs at its own speed instead of
as fast as it can. Nothing on the page moves on its own.

Limits, known: the message text is the field message box only (a battle's text, a menu or a name screen is read from the
picture); without the base's test hook the text may be an old one; the game's own battery save is not kept, only the
emulator's moment; one process per step makes a command agent slow to start if its program is; the watch page ends
with the run.

## Not in ROM Studio

Release directories and rollback. Provenance and hash records. A change ledger separate from
git. Layout-percentage and style checkers. Multi-user accounts. Map, people or scene editors in
the pane. Any check that takes longer than the change it checks.
