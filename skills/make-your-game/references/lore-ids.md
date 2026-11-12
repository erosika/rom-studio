# Lore ids: the game's memory, one small file per thing

The game folder keeps what each place, scene and notable object IS, in the user's words, next
to the files that make it. Everything else points at it by a short id. This is how a later
session (or another agent) finds out why a town looks and talks the way it does, and what was
done to it. **[run]**: the commands on a test game and on the first game made with this studio
(14 lore files, 88 references), 2026-11-10.

## The pattern
- **One file per town, road, room, scene or notable object**: `lore/<id>.md`. The id is short,
  lower-case, with hyphens (`harbour-town`, `lamp-room`, `the-old-buoy`). People do not get
  files: they are lines in the place they belong to, or in the brief.
- **Fixed headings**, in this order (`kit lore new <id> "<NAME>"` writes them):
  - the title, then one line: which map, sheet or object in the files this is
  - `## Look`: a `Mood:` line first (it is the one-line summary `kit lore` lists), colours,
    motif, what differs from its neighbours, what is drawn and what is not yet
  - `## Voice`: how people here talk, what they never say, who lives here
  - `## Easter eggs`: one line each: where (map and square), art or words, what it is
  - `## Links`: `- lore: <other id>`, one per line
  - `## Lineage`: what this was in the original game and what was done to it, oldest first.
    `kit tileset ... restyle` and `kit redraw` keep one line each here by themselves
- **Everything else links by id.** Never copy the lore text; point at it:
  - a script file: a comment `lore: <id>`. Above the first block it tags the whole file;
    right above one block it tags that block. (`// lore: harbour-town` in a `.pory`,
    `@ lore: harbour-town` in a hand-written `.inc`.)
  - a tool's table: a `"lore": "<id>"` field (a restyle profile, a group in an art module)
  - notes: a `lore id` column in a table in `game.md`, or `lore: <id>` in a line
  - pictures: name them after the id (`harbour-town-after.png`); `kit lore` finds them by the
    id, the name, or the map the file's first line names

## Commands
- `kit lore`: every id with its name and mood.
- `kit lore <id>`: the file; everything that points at it (script blocks, tool entries, notes
  lines, pictures oldest first); its lineage (the heading, then the kept versions that changed
  the lore file and the files pointing at it). `--json` for a program.
- `kit lore check`: ids referenced with no file, files nothing references, files missing a
  heading. Run it before `kit keep`.
- `kit lore new <id> "<NAME>"`: never replaces a file.

## When, on the path
- Scene 1: `kit lore new` for the place being restyled; fill `Look`; `"lore"` in the profile.
- Scene 2: the name goes in the title; the old name goes under `Lineage`.
- Scene 3: fill `Voice` before writing lines; tag the map's script file; each hidden joke or
  reference gets a line under `Easter eggs`.
- Later scenes: a new room, a story beat or a gift that matters gets its own file when the
  user would want to find it again. Do not make files nobody will read.
- Starting a session on a place: `kit lore <id>` first, then write in that voice and look.
