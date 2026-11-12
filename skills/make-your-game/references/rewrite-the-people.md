# Scene 3: rewrite the people

Part one. **[run]** = done and seen in the running game on this engine, 2026-11-10. **[not
run]** = not tried: a guess until your picture shows it. Marks with **(first game)** come from
the first game made with this studio (its `game.md` Notes "Script (round 6, the world in place)" and "Script (round 7)"): the people of ten
existing outdoor maps and about thirty rooms rewritten, every line read back in the game. It
did so by step 7 below (new scripts beside the old); steps 2 and 3 as written are **[not run]**.

## The one idea
"A person in the game is a thing standing on a square, with a short list of instructions that
runs when you talk to them (a script). The instructions say what they do: just talk, give you
something, block a path. We keep what each one does and change who they are and what they say."

## Ask (one at a time, with a default)
1. Show the town (`kit map <name> --overlay people`) and its people in plain words ("a boy by
   the pond; a woman at the door who gives you a drink"). Then: "Who lives here in your
   game?" Propose a cast that fits the brief, one line each.
2. For each person the user cares about: "What do they say?" Offer lines. Write the rest
   yourself in the same voice and show them on the card.

## Recipe
0. **The voice first.** `kit lore <id>` for the place; fill `## Voice` in its lore file from
   the user's answers (how people here talk, what they never say) before writing a line.
1. **Read each person first.** `kit map <name> --overlay people` prints every person with
   their square and script name; open the script in `data/maps/<Map>/scripts.inc` and sort
   each into: **only talks** (one `msgbox`); **does something** (gives an item, heals, opens a
   shop, starts a battle, sets or checks a story switch, moves); **is part of a story gate**
   (blocks a way, appears or leaves with a flag). List them in `game.md` Notes, in a table
   with a `lore id` column. **[run]** (first game)
2. **Only talks**: change the words under the script's text label; keep the label. Text in
   `scripts.inc` is hand-split (`\n`, `\p`, `$`; about 34 characters a line): see `rename-it.md`.
   **[not run]**
3. **Does something**: keep every instruction and its order; change only the words in the
   texts it shows. A person who gives a drink still gives it; what they say about it is the
   user's. Removing the action is a story decision: `the-road-between.md`. **[not run]**
4. **Who they are.** In `data/maps/<Map>/map.json`, in the person's `object_events` entry,
   change `graphics_id` to another existing look (`OBJ_EVENT_GFX_*` names in
   `include/constants/event_objects.h`; **[run]** on a new map) and, if wanted, `x`, `y` and
   `movement_type`. Keep `script`, `flag`, `trainer_type` and the entry's position in the
   list. **[run]** (first game)
5. **Never delete or reorder people**: scripts and saved games refer to them by position. To
   make someone absent, leave the entry and note it for `the-road-between.md`. Move only
   people who just stand or wander: a scripted walk counts steps from their square. **[run]**
   (first game: nobody deleted or reordered; people of the original story hidden by a flag
   that a new game sets and nothing clears)
6. The player's family and the rival are tied into the opening: reword them here; changing
   what they do is `the-road-between.md`.
7. **The way to use, when most of a map changes [run] (first game)**: keep `scripts.inc` as
   it is, except its first label: rename `<Map>_MapScripts::` to `<Map>_MapScripts_Original::`
   so the new file can define `<Map>_MapScripts`. Write the map's new scripts in a new `.pory`
   beside it, included right after it in `data/event_scripts.s` (the file, the include line
   and a sign script are shown in `rename-it.md`, step 4); a person's script is the same with
   `MSGBOX_NPC`. The new file starts with the map's table. Keep every entry the original table
   had, pointing at the original labels, until `the-road-between.md` decides otherwise (in the
   starting town these run the opening):
   ```
   mapscripts <Map>_MapScripts {
       MAP_SCRIPT_ON_TRANSITION: <Map>_OnTransition          // a label that already exists in scripts.inc
       MAP_SCRIPT_ON_FRAME_TABLE: <Map>_OnFrame              // table kinds too: name the old table's label
   }
   ```
   (the original table in `scripts.inc` lists them as `map_script <KIND>, <label>` lines: one entry each.)
   **A person who does something** (gives an item, heals, sets a switch, starts a battle): leave
   them on their old script and change only its words (step 3), or write the same instructions in
   the new file: each `instruction arg, arg` line of the old script becomes `instruction(arg, arg)`
   inside `script <Name> { ... }`, in the same order, with `lock`, `faceplayer` first and `release`
   last as the old one has them.
   Point every person and sign in `map.json` at the new scripts. The old words stay in the
   game but nothing can reach them. Start the new file with a comment `lore: <id>`; a block
   that belongs to another id gets its own comment right above it. Each joke or reference
   goes under `## Easter eggs` in the lore file, with map and square.

## Gotchas
- A text label can be used by several people, or sit in a shared file under `data/text/`:
  search for it before changing it. **[not run]**
- A line that names an item, a creature or a place must still be true afterwards. Words in
  braces such as `{PLAYER}` are filled in by the game: keep them.

## Check it in the game
Every kit run starts from a new game, so one line carries the whole route:
```
kit build
kit press warp <group> <num> <x> <y> walk <to the square beside them> press <toward them>,A wait 40
        # prints their exact words (" / " a line break, " // " a new box) and takes a picture
```
A person who wanders is not on their listed square when the driver arrives: warp to a square next
to where they stand at the start and press toward them at once, or set their `movement_type` to a
standing one (`MOVEMENT_TYPE_FACE_DOWN`) for the check and put it back.
Without the kit's base the printed words may be an older message: read the picture. Once per
person changed; for one who does something, play it through (the item arrives, the
way opens). Then `kit lore check`: no id without a file, no file nothing points at. Done when each shows their new words, no line runs off the box, and everything
that used to happen still does.

## What they now know
"You know a person is a look, a square and a script. The town's people are yours now."
