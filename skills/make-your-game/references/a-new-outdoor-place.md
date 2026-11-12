# A new outdoor place

Part two, a variant of scene 7 (`scene-07-a-new-room.md`, called "the room page" below) for a
new town or path. Existing towns are restyled and renamed in part one, not rebuilt.

**Nobody has built this scene on this engine yet.** Most steps come from older notes on the
plain engine. **[run]** = done and seen in the running game on this engine, 2026-11-10 (in an
indoor scene). **[not run]** = never tried here: do it, look at the picture, and if it holds,
change the mark in this file. Tell the user first: "this one is new ground, so it may take a
few tries."

## The one idea
"Outside is another map, just bigger, and your door leads onto it. Big outdoor maps can also be
joined edge to edge, so you walk from one to the next without a door (a connection). A sign is a
square you can read, and a place has a name the game shows when you arrive."

## Ask (one at a time, with a default)
1. "What is outside your door?" ("a small harbour: your house, two others, a path down to the
   water?") A sketch in words is enough: "houses along the top, water at the bottom".
2. "What is the place called?" Propose one; at most 16 characters **[not run]**.
3. "There is a sign by the path. What does it say?" (the place name and one line).

## Recipe
1. **The town map.** Make it as the room page makes a room (layout files, layout entry, map folder,
   script include before the first `.if IS_...` line) and **append it to your game's existing group** in
   `data/maps/map_groups.json`, after the room. **[run]** for a second indoor map; outdoors
   **[not run]**:
   - Copy an existing small town's `map.json` and layout entry for the outdoor fields
     (`"map_type": "MAP_TYPE_TOWN"`, a weather value, `allow_cycling`, `allow_running` and
     `show_map_name` true, an outdoor tileset pair).
   - Start small: 20 x 20 is plenty. Write the squares with the room page's script; the picture ids
     now come from the outdoor pair. Make `border.bin` trees or water so the edge does not
     look cut off.
2. **The door outside** **[not run]**. The house's door square needs a metatile whose behaviour
   is `MB_ANIMATED_DOOR` (`include/constants/metatile_behaviors.h`): find one in the tileset's
   `metatile_attributes.bin`, or copy the square from an existing town's layout. The door
   square is solid with height 0; the square below it is walkable.
3. **Join the two doors.** Append a `warp_events` entry on the town's door square pointing at
   the room, and one on the room's door square (the room page, step 8) pointing at the town; each
   `dest_warp_id` is the 0-based position of the other's entry. **[run]** between two rooms;
   with an outdoor door **[not run]**. Expect to arrive outside on the square **below** the
   door **[not run]**, and inside on the mat facing up **[run]**.
4. **The sign.** Append to the town's `bg_events` the same entry as a readable thing in `scene-08-someone-new-to-talk-to.md`,
   on the solid sign square, with `msgbox(MyTown_Text_Sign, MSGBOX_SIGN)`. **[run]** indoors.
   `"player_facing_dir": "BG_EVENT_PLAYER_FACING_NORTH"` makes it readable only from below
   **[not run]**.
5. **The name** **[run]**. Append `{"id": "MAPSEC_MY_TOWN", "name": "MY TOWN"}` as the **last**
   entry of `map_sections` in `src/data/region_map/region_map_sections.json`. Add one row for
   it at the end of **each** of the two per-place tables in `src/map_name_popup.c`
   (`sMapSectionToThemeId` and the second one further down), copying the last row's form. Set
   `"region_map_section": "MAPSEC_MY_TOWN"` in the town's and the room's `map.json`. This
   rebuilds most of the game (minutes).
6. **Where you wake up after losing** **[not run]**. Optional. Append an
   entry to `src/data/heal_locations.json` (copy an existing entry's fields) and call
   `setrespawn(HEAL_LOCATION_MY_TOWN)` from the town's `MAP_SCRIPT_ON_TRANSITION`.
7. **A second outdoor map joined at the edge** **[not run]**, only if the town needs it now. In
   the town's `map.json`: `"connections": [{"map": "MAP_MY_PATH", "offset": 0, "direction":
   "down"}]`, and the mirror on the path (`"up"`, minus the offset). The format was read in
   this engine's own maps; nothing was built with it.

## Gotchas
- **Write a connection on both maps.** One-sided: you walk out and cannot walk back. **[not run]**
- **Joined maps must use the same tileset pair**: the neighbour's visible strip is drawn with
  the current map's tiles, so a different pair shows wrong pictures until you cross. **[not run]**
- **Squares along a join must match**: at least one walkable on both sides, at the same height.
  Only outdoor maps join at edges; rooms use doors. **[not run]**
- In `map.json`, `connections` is `null`, `0` or a list in this engine's own maps: replace it
  with a list, do not push onto it blindly. **[run]** (seen in the files).
- **The name banner does not show if a script starts by itself on arrival**; the engine hides it
  whenever a script starts. **[run]** The banner was seen on arriving on a map with no such
  script **[run]**; when walking across a join **[not run]**.
- A `dest_warp_id` that does not exist drops the player somewhere wrong. Count from 0. **[not run]**
- A door metatile the engine has no opening animation for shows a default door. **[not run]**
- The town map in the pause menu, and flying, are not part of this scene.

## Check it in the game
```
kit build
kit press <walk from the start down through the room's door>
kit where        # on the town map (<your group>.<number>), below the house door
kit shot         # outside, the house behind the player
kit press <walk to below the sign> UP A
kit where        # the sign's exact words
kit shot
kit press A <walk back up into the door>
kit where        # back in the room, on the mat, facing up
```

Also one picture from the far side of the town looking back. If you made a join, walk across
and back, with a picture a few squares before the edge: the pictures ahead must not change as
you cross. Done when the user can walk out of their door, read the sign and walk back in. Add
to `game.md` Notes: the town's group and number, both door squares, the place-name entry.

## What they now know
"You know how places connect: doors pair up between maps, big maps join at their edges, a sign
is a square with words, and a place has a name. Your room is now somewhere."
