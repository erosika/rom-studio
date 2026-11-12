# Scene 4: your look

Part one. **[run]** = done and seen in the running game on this engine, 2026-11-10. **[not run]** = not
tried here: a guess until your picture shows it.
Run today: both players' walking and running sheets redrawn, new people with their own colours.
The large battle picture is the second half of this scene: `battle-pictures.md`.

## The one idea
"Every picture in the game is small, drawn dot by dot, and can use only 16 colours at a time,
one of them see-through. The 16 colours are a list kept beside the picture (a palette). A
person is 16 dots wide and 32 tall. That is why this art looks the way it does, and why we draw
it at its real size."

## Ask (one at a time)
The art direction is entirely the user's. Do not propose a style; ask.

1. "What do you look like in your game?" A description, or a picture to work from; a picture
   outranks any written description, including your own earlier one.
2. After each sheet: "What is wrong with it?"

## How to work (each of these was learned the hard way today)
- **Draw with code, at real size.** One script in `tools/` holds each picture as rows of
  letters, one letter per dot, with a table of letter to colour, and writes the image and
  palette files. Changing a dot is changing a letter, and the output is always legal (right
  size, 16 colours). Never shrink a large picture down: it comes out as a blob.
- **Start from the engine's own player proportions**, measured on the original player's walking
  sheet (16 x 32 a frame; columns 0-15, rows 0-31): head outline columns 2-13, rows 12-22; hair
  or a hat tops out at row 10 or 11 and stays within 1 dot of the head at the sides; body rows
  23-30, shoulders columns 2-13, arms to columns 1 and 14, legs columns 3-12, each foot 3
  wide, feet on row 30; side view body columns 4-11. One-dot dark outline, two or three shades
  per material, calm shapes (three or four small tufts of hair, not a spiky ball). A first try
  that ignored this came back as "too big, hair too wild". **[run]**
- **Own palette per character.** Never borrow an engine person's colours. **[run]**
- **Judge colours in the game, on the floor they will stand on, not on the sheet.** A dark
  greyish-green jacket read as blue-grey on a dark floor; it read as green only once green was
  clearly the highest of the three values (34, 70, 44). **[run]**
- **Faces, hair and cloth take the rounds.** Tell the user this before you start. If they liked
  an earlier version better, go back to it and change only what they named.
- **Show a 6x sheet early**: every frame side by side, six times enlarged, before wiring
  anything into the game; then the picture from the game. **Expect two or three rounds** and
  say so at the start. A rejection changes the drawing or the approach, never adds a check.


## Recipe A: the player, in place **[run]**
The player's walking and running sheets are the two files named `walking.png` and `running.png`
in each player's folder under `graphics/object_events/pics/people/`; each is nine 16 x 32
frames (layout under recipe B), and both use that player's palette file in
`graphics/object_events/palettes/`. The script rewrites those files and the palette; nothing
is registered, because the files already are. Keep each palette position's job (skin, hair,
cloth, outline) so the sheets you have not redrawn stay sensible: the cycling, swimming and
fishing sheets share the palette and show their old drawing in the new colours until each is
redrawn. Say which ones still do. Then the battle picture: `battle-pictures.md`.

## Recipe B: a new person's look **[run]**
The sheet is 144 x 32, 16 colours, colour 0 see-through: nine 16 x 32 frames in the order
facing down, up, left, two walking down, two up, two left (right is left mirrored by the
engine). Walk frames are the standing figure one row lower with the feet redrawn. The palette
file is text: `JASC-PAL`, `0100`, `16`, then 16 lines of `r g b`.

1. The script writes `graphics/object_events/pics/people/<name>.png` and
   `graphics/object_events/palettes/<name>.pal`.
2. `include/constants/event_objects.h`: `OBJ_EVENT_GFX_<NAME>,` directly above
   `NUM_OBJ_EVENT_GFX`, and `#define OBJ_EVENT_PAL_TAG_<NAME> 0x....` with the number after the
   highest existing tag.
3. `src/data/object_events/object_event_graphics.h`, at the end: a picture line and a palette
   line, copied from an existing 16 x 32 person (`-mwidth 2 -mheight 4`).
4. `src/data/object_events/object_event_pic_tables.h`, at the end: a table with the one line
   `overworld_ascending_frames(gObjectEventPic_<Name>, 2, 4),`.
5. `src/data/object_events/object_event_graphics_info.h`, at the end: copy an existing 16 x 32
   person's block; change its name, `.paletteTag` and `.images`.
   (`.shadowSize = SHADOW_SIZE_NONE` removes the shadow, for a thing that is not a person.)
6. `src/data/object_events/object_event_graphics_info_pointers.h`: an `extern` line, and
   `[OBJ_EVENT_GFX_<NAME>] = &gObjectEventGraphicsInfo_<Name>,` in the table.
7. `src/event_object_movement.c`, table `sObjectEventSpritePalettes`: a row
   `{gObjectEventPal_<Name>, OBJ_EVENT_PAL_TAG_<NAME>},` near the end, above the
   `STUDIO_CHARACTER_SPRITE_PALETTES` line; not at the top, other code counts on the first rows.
8. Use the name as a person's `"graphics_id"` (`rewrite-the-people.md`). Always the name, never the number.

## Check it in the game
The 6x sheet first. Then `kit build`, and `kit shot` the player on a real map from the front,
the side and the back, and once mid-walk and mid-run. **[not run]** today, so check it or say
"not tested": outdoors under time-of-day tint; beside water (no reflection colours were made);
the sheets not redrawn.

## What they now know
"You know what the art is made of: small pictures, 16 colours each, drawn dot by dot, with a
separate list of colours you can change. The person walking around your game is now you."
