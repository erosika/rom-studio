# Scene 8: someone new to talk to

Part two: adding a person who was not there. Changing people who already exist is
`rewrite-the-people.md`.

**[run]** = done and seen in the running game on this engine, 2026-11-10. **[not run]** = from
older notes on the plain engine: a guess until your picture shows it.

This is the loop to get fast and right: a changed line is back on screen in about two minutes.

## The one idea
"A person in the game is a thing standing on a square, with a short list of instructions that
runs when you press the button in front of them (the game calls it a script). Their words go in
a box that only fits so much, so long lines are split for you."

## Ask (one at a time, with a default)
1. "Who is new here?" ("your grandmother?")
2. "Where is she standing?" ("by the stove, facing you as you come in?")
3. "What does she say?" Write two short lines in the user's tone and offer them: "'You're up
   early. The lamp won't light itself.' Use that?"

Pick the person's look yourself from the engine's existing people (the `OBJ_EVENT_GFX_*` names
in `include/constants/event_objects.h`) and say which in plain words ("an older woman in a blue
dress"). Their own art is `your-look.md`.

## Recipe
1. **Place the person.** Append one entry to `object_events` in `data/maps/MyRoom/map.json`
   **[run]**:
   ```json
   {"local_id": "LOCALID_MYROOM_GRANDMOTHER", "graphics_id": "OBJ_EVENT_GFX_WOMAN_1",
    "x": 6, "y": 5, "elevation": 3, "movement_type": "MOVEMENT_TYPE_FACE_DOWN",
    "movement_range_x": 0, "movement_range_y": 0, "trainer_type": "TRAINER_TYPE_NONE",
    "trainer_sight_or_berry_tree_id": "0",
    "script": "MyRoom_EventScript_Grandmother", "flag": "0"}
   ```
   `elevation` is the height of the floor they stand on (3). `local_id` is the name scripts use
   to point at this person later.
2. **Write the script and the words** in `data/maps/MyRoom/scripts.pory` **[run]**:
   ```
   script MyRoom_EventScript_Grandmother {
       msgbox(MyRoom_Text_Grandmother, MSGBOX_NPC)
   }
   text MyRoom_Text_Grandmother {
       format("You're up early, {PLAYER}.\pThe lamp won't light itself.")
   }
   ```
   `MSGBOX_NPC` stops the player, turns the person to face them, shows the words and lets go.
   `format()` splits lines to the box width (208 dots, two lines a box); `\p` starts a new box;
   `{PLAYER}` is the player's name.
3. `kit build`: it regenerates `scripts.inc` from the `.pory` (it prints `script regenerated:`).
4. **Things to read** (a bookshelf, a note on the desk) are the same idea without a person
   **[run]**: append to `bg_events` in `map.json`, on the **solid** square the thing is drawn on,
   `{"type": "sign", "x": 3, "y": 2, "elevation": 0, "player_facing_dir":
   "BG_EVENT_PLAYER_FACING_ANY", "script": "MyRoom_EventScript_Bookshelf"}`; its script is one
   line, `msgbox(MyRoom_Text_Bookshelf, MSGBOX_SIGN)`. Offer one or two: they make a room lived in.
5. **Talking across a desk or counter** **[run]**: give the furniture square between the person
   and the player the behaviour `MB_COUNTER` in the tileset's `metatile_attributes.bin`; the
   button then reaches the person behind it. If you cannot change the tile, put a `bg_events`
   entry on the furniture square that runs the person's script (also **[run]**; such a script
   should not use `faceplayer`).

## Gotchas
- **The words did not change in the game**: `scripts.inc` was not regenerated. The build does
  not do it for you. **[run]**
- **Append people, never insert or remove.** People are numbered by position in the list, and
  scripts and saved games use those numbers. **[run]** as practice; the breakage **[not run]**.
- A script with more than one `msgbox` starts with `lock` and `faceplayer` and must reach
  `release` on every path; an early exit is `release` then `end`. Otherwise the player stays
  frozen. **[run]** as the pattern; the freeze **[not run]**.
- Only characters in the engine's text table (`charmap.txt`) can be shown. Keep to plain quotes,
  `...` and `-`. **[not run]**
- A person is two squares tall on screen: their head covers the square above. Do not stand them
  directly below something the user wants seen. **[run]**
- A script that starts by itself when the map loads hides the place-name banner on that arrival
  (`scene-09-a-story-beat.md` covers such scripts). **[run]**
- At most 64 people on a map **[not run]**. People, the player and effects share 16 colour sets
  on screen; four custom people in one room were fine **[run]**.

## Check it in the game
```
kit build
kit press <walk to the square in front of them> A    # then wait about a second
kit where        # "last message" is the exact words: " / " is a line break, " // " a new box
kit shot         # the box open, the person facing the player
kit press A,A    # close it
kit where        # control yes: the player can walk again
```

Compare the message from `kit where` with what the user asked for, word for word. Try a second
side if the person can be reached from there, and do the same for each readable thing. Done
when the picture shows the box open with the right words and the player can walk afterwards.

## What they now know
"You know how people work: someone stands on a square, and a short script runs when you talk to
them. You can put anyone anywhere and give them something to say, and the same trick makes a
bookshelf or a note readable."
