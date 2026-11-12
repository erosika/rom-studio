# A new tileset for a new place

Part two. For a new room or town (`scene-07-a-new-room.md`) that should not look like any
existing place. To change how existing places look, use `restyle-a-place.md` instead.
**[run]** = done and seen in the running game on this engine, 2026-11-10. **[not run]** = not
tried here: a guess until your picture shows it.
Run today: one indoor set with animations, walked in the game; one outdoor set, built and
rendered but **not walked in the game**.

## How to work
Draw with code, at real size: one script in `tools/` holds each piece as rows of letters, one
letter per dot, with a table of letter to colour and its role. Geometric things (floors, walls,
panels, desks, screens, doors) come out right quickly; organic ones (plants, animals, cloth)
take rounds. Show the user the script's whole-room preview early and expect two or three rounds.

## Recipe **[run]**
One script draws every piece and writes, in `data/tilesets/secondary/<name>/`: `tiles.png`
(128 x 256, 16 colours), `palettes/00.pal` to `15.pal`, `metatiles.bin`,
`metatile_attributes.bin`; plus the room's `map.bin` and `border.bin`, and two previews (the
whole room, and solid squares in red). Look at the previews before building.

- A square (metatile) is a 16 x 16 bottom picture and an optional top picture, each in **one**
  palette. The script cuts them into 8 x 8 tiles and drops duplicates.
- A second tileset owns palettes 06-12, and tiles and squares numbered 512 up. Pair it with an
  existing first tileset and use **only** your own squares on the map.
- A square's attribute is its behaviour + layer type x 4096. Layer 1: both pictures under the
  player. Layer 2: top picture over the player (tall things). Never 0: the engine then shows an
  original tile through every see-through dot.
- Register in four places, each in the half of the file **not** under the `#if IS_...`
  switch for the engine's other game:
  `src/data/tilesets/graphics.h` (tiles with `-num_tiles 512`, and palettes),
  `src/data/tilesets/metatiles.h`, `src/data/tilesets/headers.h`, `include/tilesets.h`; copy an
  existing second tileset's lines. Then name it as `secondary_tileset` in the layout entry.
- Append new squares at the end of the script's list so existing numbers do not move.
- Small animation (a blinking cursor, a drifting readout), only with the user's yes: reserve
  fixed tiles at the end of the sheet, write frames as strips under `anim/<group>/`, add a
  block at the end of `src/tileset_anims.c` and a line in `include/tileset_anims.h`, set
  `.callback` in the header. Half a second a step or slower, and small.


## Check it in the game
Walk every part of the room, walk into every solid thing, and take two pictures a second apart
for anything animated. Outdoors under time-of-day tint: **[not run]**.
