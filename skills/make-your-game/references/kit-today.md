# The kit today

Every command the skills name exists, plus `maps`, `map`, `scenes`, `tileset`, `redraw`, `lore` and `gates`. `kit` is the file `kit/kit` in the ROM
Studio checkout (`KIT` below is that `kit/` folder; run it as `KIT/kit <command>`). If `kit` is not
found, look two folders above this skill's own folder (the skill ships inside the checkout, at `skills/make-your-game/`;
installed as a Hermes plugin, the checkout is the plugin's folder), else ask the user where the ROM Studio checkout is
and run `<checkout>/kit/kit`; it is not put on the PATH. It needs
`bun` and says how to get it if it is missing. The game folder (`GAME`) is `--game <dir>`, else
`$ROM_STUDIO_GAME`, else the folder `rom-studio-game` beside the checkout (in the home folder when the checkout is an
installed plugin); `kit status` prints which. `kit help` lists
everything, including the lines that add the same commands to an agent host as tools
(`kit/mcp.ts`; the user adds it to the host's configuration, the kit never does).

| Command | Today |
|---|---|
| `kit status` | Lists each tool as ok or MISSING with how to get it, the game folder, what the decomp is, whether the base is applied, the next unticked scene in `game.md`, the last build, and what to do next |
| `kit setup --decomp <folder or git address>` | Bring your own decomp: the user supplies it, the kit never picks or fetches one. Copies it into the game folder (the original is untouched), adds the calm and helper base only if the tree is the version the base was made for (it says plainly when it skips it, and what is then missing), writes a starter `game.md`, `feed.jsonl` and `shots/`, builds, and takes `shots/first.png`. Safe to rerun, then without `--decomp`. The first build takes minutes: tell the user before starting. The starter `game.md` has the scene list but an unwritten Brief: **do the interview anyway** and replace the Brief |
| `kit build` | Prints `OK <seconds>s <path>` or `BUILD FAILED` and the first error with file and line; full log in `GAME/out/build.log`. Regenerates map scripts first (below). A few seconds after a script change (3 to 12 s measured); minutes after a change to the list of maps or the place names. One build at a time (it waits its turn) |
| `kit play [--phone]` | Starts the player or reuses the running one, prints the link. Reload the page after a build. `--phone` adds a link for a phone on the same network: not tried on a real phone. `kit play --stop` stops it |
| `kit shot [--at group.number,x,y] [--time HH:MM] [--name file.png] [--scale 3] [steps]` | Runs the steps, saves the picture in `GAME/shots/` (as `s<scene number>-<next number>.png`, or the name given), prints its path. `--time 12:00` sets the game's clock first, so day and night pictures can be repeated. Then look at the picture |
| `kit press <buttons or steps>` | `kit press A,A` or `kit press walk UP:3 press A wait 40`; ends by printing where the player is and taking a picture |
| `kit where [steps]` | Runs the steps, prints map, square, facing, control, last message |
| `kit maps [--all] [--json]` | The user's own maps (added since setup; `--all` for every map): size, `group.number` (what `warp` and `--at` take), its two tilesets, joins, where each door leads, counts of people, signs and triggers |
| `kit map <name> [--overlay people,doors,joins,collision] [--png file]` | Draws the whole map from the tree's files into `GAME/shots/maps/<name>.png` and prints a legend (every person with square and script, every door). `--overlay all` for everything. Use it to show the user a room at once and to find squares; it is not a picture from the running game, so it does not replace `kit shot` |
| `kit tileset <name> roles` | For scene 1. Writes a first guess at the role of every building block of a tileset (ground, path, floor, tall_grass, foliage, water, ledge, flower, roof, door, object) as `roles.json` beside the tileset, with each block's behaviour, layer type, how many maps use it and the three that use it most, and draws `GAME/shots/tilesets/<name>-roles.png`: every block with its number and guessed role. The guesses are rough (rock faces and building walls come out as `object`, and a redrawn sheet loses the colour cue): look at the sheet and correct `role` in the table. It will not replace an existing `roles.json` unless you add `--force`; `--out <dir>` writes elsewhere |
| `kit tileset <name> maps` | The maps that use the tileset: restyling it changes all of them |
| `kit tileset <name> before-after [--maps a,b,c]` | Three maps that use it, drawn from the last kept scene and from the files as they are now, side by side, in `GAME/shots/tilesets/<name>-before-after.png`, with how many pixels changed in each. Show this to the user before building |
| `kit tileset <name> restyle --profile <file.json> [--palette-only] [--strips pic.png:slot,...] [--lore <id>]` | For scene 1. Redraws the tileset in place by role (`roles.json`; written first if missing) in the colours and treatments of the user's profile, always starting from the original art (read from the commit setup made, kept under `GAME/out/redraw_orig/`). Changes dots and palettes only: never the sheet's size, the building blocks or a map. Animated tiles it can find in the engine's animation file are included; it names the folders it left alone. If the profile has `"lore"` (or `--lore`), one line under that lore file's Lineage. Needs `python3` with Pillow. Known: on a light ground colour, trees that share the ground's palette positions go pale. Built and seen in the game on a test game with a made-up profile, with and without the base; not tried on a decomp of the other engine family |
| `kit tileset <name> objects [--json]` | Candidate objects of a tileset: "whole" things as maps place them (touching solid or overhead squares, at most 8 x 8) and "parts" that maps always put side by side; each with footprint, block ids, times placed, where one stands, door squares; and a numbered sheet in `GAME/shots/tilesets/<name>-objects.png`. Candidates: two things that touch come out as one. For a widely shared first tileset the list is long and partly cliffs and tree clumps |
| `kit redraw <art module.py> [--write] [--only group,...]` | Replaces whole objects by the user's own drawings, from their art module in the game folder (`KIT/objects.py` explains it at its top). Without `--write`: previews in `GAME/out/objects/` and a list of clashes. `claim`, `direct`, `door`, `strip` never touch a map or a building block; `append`, `remap`, `repal` put new blocks on the map (collision and what each square does are kept; the originals are recorded in `appended.json` beside the tileset). Groups with a `'lore'` field leave a line under that file's Lineage. After a later `restyle` of the same tileset, run it again. `kit redraw dump <map> <x> <y> <w> <h>` prints the blocks and tiles at a place. Seen in the game on a test game: `append` on two houses. `claim` with a drawing that ignores the tile repeats clashes, as it prints; `direct`, `door`, `strip`, `remap`, `repal` not tried through the kit (they were used in the first game with the tool this was lifted from) |
| `kit lore`, `kit lore <id> [--json]`, `kit lore check`, `kit lore new <id> "<NAME>"` | The lore index (`lore-ids.md`). List: every id with name and mood. One id: the file, everything pointing at it (script blocks, tool entries, notes lines), its pictures oldest first, its lineage (the Lineage heading and the kept versions that changed it and the files pointing at it). `check`: ids with no file, files nothing points at, files missing a heading. `new` never replaces a file. Only `new` writes |
| `kit gates --from <map> --to <map>` | For scene 6. Finds the maps on the walk between two maps and lists, for each, the places where a story switch may stop the player: trigger squares with the story number and value that arms them, scripts that walk the player, people who are there only under a switch, obstacles that need a field move; each with file, script name, switches and the first text. **Candidates, not certainties**: it reads scripts, it does not play. Scenes that merely play on arrival and people hidden for other reasons are listed too. Check each one in the game. With no maps given it looks at the user's own maps |
| `kit music`, `kit music play\|render\|where <name>`, `kit music replace <name> <file>` | The songs, effects, samples and cries read from the tree; a recording of one from the built game (its own instruments, as of the last build); where it is heard; the user's `.mid` or `.wav` in place of one, checked first and refused with the reason if it would not build. `music.md` |
| `kit find "<text>" [--in <glob>] [--regex]`, `kit find --file <path> --at <line>` | Every source line that holds the text (file, line number, the line; build output and binaries skipped; 200 lines at most), and the numbered lines around one. Paths outside the game folder are refused. `source.md` |
| `kit dialogue ["<words>"] [--in <place>] [--only new\|changed] [--all] [--page <file.html>]` | Every line a player can read, by place: the text's name, then one line per text box. Default is what was written since setup (texts in new scripts and texts changed in old ones); `--all` adds the untouched original. Use it to read a scene's lines together before rewriting them, to check a name or a fact is said the same way everywhere, and `--page` to hand the user one page of all of it **[run]** |
| `kit dialogue --notes`, `kit dialogue --done "<text's name>"` | The user can write a note on any text in the pane's Dialogue tab. Read the waiting notes before and after dialogue work; when you have changed a text as its note asks, mark it done and say what you changed **[run]** |
| `kit scenes [--json]` | Each scene in `game.md` with its tick, its feed entries and its pictures |
| `kit note "<sentence>" [--shot shots/x.png] [--next "..."] [--asked "..."] [--scene "..."]` | Appends one line to `GAME/feed.jsonl` and prints it. The scene is filled in from `game.md` (the first unticked one). Also: `--before shots/old.png` (shown beside `--shot` as before and after), `--by "<stream>"` (who wrote it, when several agents post), `--answers <entry time>` (this entry deals with a "needs work"), `--lore <id>` (the sentence also goes under Lineage in that lore file) **[run]** |
| `kit reviews [--open] [--scene "..."] [--json]` | What the user answered to feed entries in the pane: "looks right" or "needs work", with a note. `--open` lists the "needs work" nobody has answered. Run it before you start and after each step; when you have fixed one, post the fix with `kit note ... --answers <entry time>` **[run]** |
| `kit decide "<question>" [--options "a\|b\|c"] [--recommend "<option>"] [--detail "..."]`, `kit decisions [--open]` | For a choice that is the user's (a name, a look, which of two ways): it waits under Decisions in the pane, with your recommended option marked. Do not stop: carry on with what does not depend on it and read the answer later with `kit decisions` **[run]** |
| `kit settings [key] [value]`, `kit workers` | The user's choices in `GAME/settings.json`, set from the pane's Settings tab. `image_model`: the picture model to ask for when you generate a concept or a figure (`kit status` prints it too; the kit makes no pictures, your own tool reads this). `kit workers`: the helpers you may hand work to, the command that starts each, its model, and the default one **[run]** |
| `kit keep "<scene>"` | One commit of the whole game folder with that message, and the tick in `game.md` (matches the scene by name, with or without its number). Say if it printed that nothing was ticked |
| `kit undo` | With changes not kept yet: lists them and stops. Ask the user; on yes run `kit undo --yes`, which sets them aside (it prints how to bring them back). With nothing changed: takes back the last kept scene. Build afterwards |
| `kit patch [--original <file>] [--file <x.bps>]` | Writes the built game as one patch, `GAME/out/game.bps` (BPS, the format common patching programs read), made against the user's own copy of the original game file: `--original <file>`, or `"original_game": "<file>"` in `GAME/settings.json`. Never fetch or guess that file: ask the user. It applies the patch again to check itself and prints its size, the original's sha1 (and whether it is the one the decomp names in `rom.sha1`) and how much of it is new. `kit patch --check <original file>` applies the patch to a copy of that file and compares it with the built game; it writes nothing. A relative `--file` is inside the game folder. Run on the first game: 17 s, a 16 MB patch for a 32 MB game, and a separate patching program applied it and gave the same game byte for byte. Not tried: a person on another computer applying it |

With the base applied, the player's name and look are in `GAME/settings.json` (`player_name`, at
most 7 letters; `player_look`, `girl` or `boy`); `kit build` picks up a change.

## Without the base

`kit status` says whether the base is applied. The base is optional and is not shipped with ROM Studio's
public repository, so on most installs it is absent: setup says so and goes on. It is also skipped when the
user's decomp is not the one version the base was made for. Then build, play, `shot`, `press`, `where`, the steps `walk`, `warp`,
`script`, `gender`, note, keep, undo, maps and scenes still work, with these differences:

- No quick start: after each build the first picture run plays through the original opening by
  itself (about a minute) and every run then starts where the original game first lets the
  player walk. Use `warp` to get to a map.
- `flag` and `givemon` print NOT DONE. `where` cannot count messages; it shows the game's text
  buffer, which may hold an older text.
- No calm changes in the game (the player page's flash guard still runs), no menu entry, no
  `settings.json`.

## How the driver behaves (this is what bites)

- `shot`, `press` and `where` all use one driver (`KIT/drive.ts`). One run boots the built
  game, runs the steps in order and exits, in under a second. **Every run starts again from a fresh new game**, at the moment the player can first
  walk. Nothing carries over, so put the whole route in one line:
  `kit press walk UP:6 press A wait 40 --name talk.png`
- Steps: `press A,B,UP:30,A+B` (taps; `:n` holds for n frames), `walk UP:3,LEFT:2` (whole
  squares; prints `BLOCKED` and where it stopped), `warp <group> <num> <x> <y>`, `wait <frames>`
  (60 is one second), `shot <png> [--scale 3]`, `where`, `flag set|clear <number>`,
  `save <file>` / `load <file>`, `givemon <species number> <level>` (numbers are in
  `include/constants/species.h`), `script <script name>` (starts that script as if the player
  had triggered it. **It cannot start a trainer battle**: the engine needs the person on the
  map to start it, and a trainer's script started this way stops with an error screen. To
  reach a battle: `givemon` first, then walk up to the trainer and press A),
  `gender <0 boy|1 girl>`, `time` (prints the game's clock), `time HH:MM` (also `midday`,
  `midnight`: sets the game's clock and holds it there), `rtc host|<ms>` (the cartridge clock
  itself).
- **The clock and the tint.** The engine tried tints outdoor colours by the hour, and reads its
  clock only outdoors or on a map change. So put `time` BEFORE `warp` (`kit shot --time` does):
  the warp then prints the clock it found. Set after arriving, the clock changes but the tint
  does not until the next map change. Without `time`, pictures follow the computer's clock.
  Seen at 12:00 and 00:00, with and without the base.
- `where` prints the map as `group.number`, the square, facing, `control yes|no`, and the text
  of the last message (` / ` is a line break, ` // ` a new box). Use it to check text exactly.
- A map's group is the 0-based position of its group in `group_order` in
  `data/maps/map_groups.json`; its number is its 0-based position inside that group.
- `warp` and `flag` only work while the player has control (no message open, no scene running).
  Set flags before warping into a map whose scene starts on arrival. `flag` takes the number,
  not the name: look the name up in `include/constants/flags.h` (0x20 is 32).
- A picture that is almost black was taken during a fade: add `wait 60` before `shot`.
- Give pictures clear names (`harbour-after.png`, `stove-talk.png`), in `GAME/shots/`.
- The pane's Gallery tab shows every picture in `GAME/shots/`, newest first, with a control where the
  user can send reference pictures (they land in `GAME/refs/`).

## Scripts

Map scripts are written in the engine's script language: `<name>.pory` is the source and the `.inc` beside it is
generated. `kit build` regenerates every `.inc` whose `.pory` is newer and prints
`script regenerated: <file>` for each; a mistake in the script stops the build with the file
and line. Edit only the `.pory`. If a text change does not show up in the game, check that the
build printed that line. There is no separate command to regenerate a script: `kit build` is it.
The script compiler is fetched by `kit setup` into the kit's own folder; it does not come from the
decomp or from the base, so `.pory` files work on any decomp, with or without the base.

## What `kit play` starts from

The built game from power-on, in the browser, with the game's own save kept by that browser: the
user starts a new game or continues theirs. It cannot open a place the driver reached, so to try
something far from the start the user walks there in their own save. When that is not possible yet
(the road is a later scene), say so, show them the driver's pictures, and leave "the user has tried
it" open in `game.md` Notes until the road exists.

The driver can carry on from where an earlier run stopped: end one run with `save <full path>.ss` and
begin the next with `load <the same path>` **[run]**; a bare name lands in the folder the command was run from (a state of the running game, not the game's own save;
it only loads into the same build).

## The agent entry in the START menu

With the base, the game's START menu has an agent entry and `kit status` says "in-game agent link: ... on". In the
player page, choosing it opens a line for the user's words; they go to the user's agent (`hermes` by default) and
the answer is shown in the game's message box **[run: the page in a headless browser, and the headless driver with
the real route; not run on a phone]**. It works only in the player page: the driver has no page, so a driver picture
never shows a conversation unless a test writes one into the mailbox. If the entry is not in the menu, the game may
give it later (a story switch) or the base is not applied. To make the agent speak as something in the user's game,
set `hermes_preface` with `kit settings hermes_preface "<what it is told first>"`; `"hermes_link": false` turns the
link off.

## Not in git

`out/` (the built game), `shots/`, `refs/` and `feed.jsonl` are kept out of the game folder's git
history, so `kit undo` never touches them.

## Measured (first machine, 8 cores, other builds running at the same time)

- `kit setup` from nothing with the base: 420 s in all, the first build 408 s. Without the base:
  557 s, the first build 438 s and the first play through the opening about 110 s.
- `kit build` after a small change (one script, one source file, the player's name): 3 s.
- `kit setup` run again on a finished folder: 2 s. `kit shot`: under a second. `kit map`: under
  a second. `kit maps --all` (935 maps): 1 s.
