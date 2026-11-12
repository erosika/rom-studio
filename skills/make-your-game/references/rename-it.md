# Scene 2: rename it

Part one. **[run]** = done and seen in the running game on this engine, 2026-11-10. **[not
run]** = not tried: a guess until your picture shows it. Marks with **(first game)** come from
the first game made with this studio (its `game.md` Notes "Script (round 6, the world in place)" and "Script (round 7)"): the existing places on
its path renamed in the place-name list and seen on arrival, and every sign on those maps reworded.
That game reworded signs by writing new scripts beside the old ones (step 4, the way to use);
editing the old words in `scripts.inc` directly is still **[not run]**.

## The one idea
"A place has a name the game shows when you arrive, kept in one list. A sign is a square with
words. Renaming is changing that list, then finding everywhere else the old name is said."

## Ask (one at a time, with a default)
1. "What is your starting town called?" Propose the name the user gave in scene 1 (it is the
   title of the place's lore file): at most 16 characters **[not run]**, in capitals like the
   original names. If they change it now, change the title and keep the lore id as it is.
2. "What does the sign at its entrance say?" (the new name and one line.) Ask the same two
   for each further place only when the user's game reaches it.

## Recipe
1. **The name.** The map's `map.json` names its entry in `"region_map_section"`
   (`MAPSEC_...`). In `src/data/region_map/region_map_sections.json`, find the entry with that
   `"id"` and change only its `"name"`. Leave the `"id"` and the order alone: saved games and
   maps refer to them. **[run]** (first game). A decomp without that file keeps the names in
   `src/`: search for the old name in capitals there. **[not run]** Then put the name in the
   title of the place's lore file and the old name under its `## Lineage` (`lore-ids.md`).
2. **Do not rename what the player never sees**: map folder names, `MAP_...` and `MAPSEC_...`
   constants, script names, flags named after the place. They are the engine's own labels;
   renaming them touches hundreds of files and changes nothing on screen.
3. **Find every place the old name is said.** Search `data/` and `src/` for it in capitals.
   List the hits by map, tell the user the count, change those on maps their game has
   reached, and note the rest in `game.md` as "still says the old name". **[not run]**
4. **Signs** are the `bg_events` in the map's `map.json`: each has `x`, `y` (the sign's
   square) and a `script`. The map picture does not mark signs: find one by its square (count squares on `kit map
   <name>` from the top-left, which is 0,0; each square is 16 dots) or
   walk the driver to it and press A. `<your id>` below is the place's lore id. **Use this way [run] (first game)**: leave `scripts.inc` as it is,
   write the new words in a new file `data/maps/<Map>/<your id>.pory` beside it, and point the
   sign's `script` in `map.json` at the new script. Include the generated file right after the
   map's own line in `data/event_scripts.s`:
   `.include "data/maps/<Map>/<your id>.inc"`. `kit build` makes the `.inc` from the `.pory`.
   ```
   // lore: salt-harbour
   script <Map>_Sign_Entrance {
       msgbox(<Map>_Sign_Entrance_Text, MSGBOX_SIGN)
   }
   text <Map>_Sign_Entrance_Text {
       format("SALT HARBOUR. Where the fog comes in first.")
   }
   ```
   `format()` fits the words to the box; `\p` in the words starts a new box. Script names must
   be new: start them with the map's name. (Editing the old words in `scripts.inc` instead:
   `.string "SALT HARBOUR\n"` lines, `\n` a second line, `$` the end, about 34 characters a
   line, not fitted for you. **[not run]**) When most of a map is rewritten, the same file
   also takes the people: `rewrite-the-people.md`, step 7.
5. Words in shared files (`data/text/`, `data/scripts/`) are used by several maps: changing
   one changes all its uses. **[not run]**

## Gotchas
- Editing the place names rebuilds most of the game (minutes, expected: not the two-minute
  fault); the banner does not show on a map where a script starts by itself on arrival. **[run]**
- A map with a `scripts.pory` beside its `scripts.inc`: edit the `.pory`; the build
  regenerates the other. A map with only `scripts.inc`: edit that. **[run]**

## Check it in the game
Every kit run starts from a new game, so each line carries the whole route:
```
kit build
kit shot --at <group.number>,<x>,<y> wait 60          # arriving: the banner with the new name
kit press warp <group> <num> <x> <y> walk <to the square below the sign> press UP,A wait 40
                        # prints the sign's exact words (" / " a line break) and takes a picture
kit shot press START wait 30                          # the pause menu; then add press DOWN
                        # until the picture shows SAVE chosen, then press A wait 60: the save box
```
The save box **[run]** (a fresh game on the base): `kit shot press START wait 40 press DOWN wait 8
press DOWN wait 8 press DOWN wait 8 press A wait 90`; SAVE is the fourth entry at a fresh start and
moves down once the player has creatures, so look at the menu picture first and count.
**Look at the arrival picture where the banner sits over lettering on a building**: the banner
can cover part of a word and leave a different word on screen. If it does, move the lettering
or split it over two lines. **[run]** (first game: a name on a building front was split into
two lines for this reason)
Done when banner, sign and save box say the new name. In `game.md` Notes: old name, new name,
what still says the old one.

## What they now know
"You know where a place's name lives and how a sign holds its words."
