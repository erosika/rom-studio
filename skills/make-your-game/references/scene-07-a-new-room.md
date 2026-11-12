# Scene 7: a new room

Part two: for when the user's game needs a place that does not exist. Outdoors, also read
`a-new-outdoor-place.md`. For tiles of its own, `a-new-tileset.md`.

**[run]** = done and seen in the running game on this engine, 2026-11-10. **[not run]** = from
older notes on the plain engine: a guess until your picture shows it.

## The one idea
"A place in the game is a grid of squares, like graph paper (the game calls it a map). Every
square has a picture and a rule: you can walk on it or you cannot. A door is a square that sends
you to a square on another map (a warp)." Nothing else yet.

## Ask (one at a time, with a default)
1. "What is the new place?" ("the lamp room at the top of the lighthouse: the lamp, a desk?")
2. "Which existing door leads to it?" Show the town with `kit map <name> --overlay doors` and
   propose one ("the door of the tall house by the water?").

## Recipe
Example names: map `MyRoom`, constant `MAP_MY_ROOM`, layout `LAYOUT_MY_ROOM`, group
`gMapGroup_MyGame`. Use the user's own words for the real ones.

1. **The squares.** `data/layouts/MyRoom/map.bin` is width x height numbers, two bytes each, low
   byte first, row by row from the top-left. Each number: bits 0-9 the picture (a metatile id:
   0-511 from the map's first tileset, 512 up from its second), bits 10-11 blocked (0 walkable,
   1 solid), bits 12-15 height (3 = ordinary floor). `border.bin` is four such numbers, a 2x2
   block repeated outside the edge. **[run]**
   - You cannot read a `.bin` by eye. Write one small script in `tools/` that holds the room as
     rows of letters, writes both files, prints the grid back with solid squares marked, and
     checks the start square can reach the door. **[run]**
   - Quickest source of pictures **[not run]**: copy `map.bin` and `border.bin` from an existing
     small indoor layout folder under `data/layouts/` and have the script change squares from
     there. Never point your map at the existing layout itself: every map using it would change.
   - What a square does when stepped on (door, counter) is the low byte of that metatile's entry
     in its tileset's `metatile_attributes.bin`; names in
     `include/constants/metatile_behaviors.h`. **[run]**
2. **Register the layout.** Append one entry to `data/layouts/layouts.json`: copy an existing
   indoor entry with every field; change `id`, `name`, `width`, `height` and both file paths;
   keep its tileset pair. **[run]**
3. **The map.** New folder `data/maps/MyRoom/` with **[run]**:
   - `map.json`: copy an existing indoor map's, keep every field, set `id`, `name`, `layout`,
     and empty the lists: `"connections": null`, `"object_events": []`, `"warp_events": []`,
     `"coord_events": []`, `"bg_events": []`.
   - `scripts.pory` containing `mapscripts MyRoom_MapScripts {}`; then `kit build` makes `scripts.inc` from it
     (command in `kit-today.md`). Without this label the build fails at its last step.
4. **Include the scripts.** In `data/event_scripts.s` add
   `.include "data/maps/MyRoom/scripts.inc"` after the last map include and **before** the first line
   that starts `.if IS_` (the block for the engine's other game). At the very end of the list it lands inside that block and the build fails
   at the link step. **[run]**
5. **Register the map in a new group.** In `data/maps/map_groups.json` add
   `"gMapGroup_MyGame": ["MyRoom"]` and append `"gMapGroup_MyGame"` as the **last** entry of
   `group_order`. Later maps of this game are appended to this group. Never insert into an
   existing group: that renumbers maps a saved game points at. **[run]**
6. **Start a new game here** (only if the user wants the game to begin in this room; needs the
   kit's base, see `kit-today.md`). In `include/studio_maps.h` set `STUDIO_START_MAP_GROUP` to
   `MAP_GROUP(MAP_MY_ROOM)`, `STUDIO_START_MAP_NUM` to `MAP_NUM(MAP_MY_ROOM)`, and
   `STUDIO_START_X` / `_Y` to the start square (the header says it is generated; that is out of
   date, edit it by hand). In `src/zz_studio_maps.c`, in `StudioMaps_NewGameStart` after
   `WarpIntoMap();`, also set `gSaveBlock1Ptr->lastHealLocation` (`mapGroup`, `mapNum`,
   `warpId = WARP_ID_NONE`, `x`, `y`) to the same square, so losing a battle returns here, and
   add `FlagSet(FLAG_SYS_B_DASH);` so the player can run. **[run]**
7. **Facing.** A new game drops the player facing down. To face into the room, add to
   `mapscripts` the entry `MAP_SCRIPT_ON_WARP_INTO_MAP_TABLE [ VAR_TEMP_1, 0: <script> ]` whose
   script is `turnobject(LOCALID_PLAYER, DIR_NORTH)`. It runs on every arrival, which is
   harmless when the only way in is a door in the bottom wall. **[run]**
8. **The door.** Give the door square a walkable metatile with behaviour `MB_SOUTH_ARROW_WARP`
   (an exit mat in the bottom wall); the squares beside it are solid. With no door event on it,
   it does nothing. **[run]** To join it to another map, append to each map's `warp_events` an entry
   `{"x":..,"y":..,"elevation":0,"dest_map":"MAP_OTHER","dest_warp_id":"0"}`; `dest_warp_id` is
   the 0-based position of the other map's entry in its list. The door fires when the player
   walks **down** onto the square; they arrive **on** the other door square, facing up. **[run]**
   between two new rooms. Onto an existing map **[not run]**: repoint that map's existing door
   entry (`dest_map`, `dest_warp_id`) at the new room rather than adding a door; the old inside
   is then unreachable, which is fine. Never delete or reorder its entries.

## Gotchas
- Changing `map_groups.json` rebuilds most of the game: minutes, not seconds (not timed). Tell
  the user before that build. Later edits to the map take seconds. **[run]**
- `map.bin` must be exactly width x height x 2 bytes, and `(width + 15) x (height + 14)` must
  stay at or under 10240. **[not run]** as failures; a 24 x 22 room is fine **[run]**.
- A metatile id must exist in the map's tileset pair, or the square draws as garbage. **[not run]**

## Check it in the game
```
kit build
kit maps                       # your new map and its group.number
kit shot --at <group.number>,<x>,<y>   # the first look at the room
kit press <walk to each wall>  # every wall reports BLOCKED; walk a loop of the floor
kit press <walk to the door>   # then a picture standing at the door
```

Then walk in through the existing door and out again. Done when the picture shows the player
in the room, a walk around it stops at every wall, and the door works both ways. Write the
map's group and number and the door squares in `game.md` Notes.

## What they now know
"You know what a map is: a grid of squares, each with a picture and a rule about walking, and a
door square that leads to another. Your game now has a place that was not there before."
