# Scene 11: your own interface

Part two. **[run]** = done and seen in the running game on this engine, 2026-11-10. **[not run]** = not
tried here: a guess until your picture shows it.
Run today: the dialogue box, the menu frame, the option screen and the place-name banner,
recoloured and reframed by one script.

## The one idea
"The boxes that words appear in are pictures too, with their own short list of colours. The
same list colours every box and all the text in them, so changing it changes them all at once."

## Ask (one at a time)
1. "Light boxes with dark words, or dark boxes with light words?" Propose the one that suits
   the palette the game already has (if a place was restyled from a source, use that written
   palette: `restyle-from-a-source.md`).
2. "Plain corners, or something of yours in the frame?" ("clipped corners and one small mark?")

## Recipe **[run]**
One script in `tools/` with the colours as a short table at the top (fill, text, text shadow,
line, accent) draws every file; change colours there and nowhere else.

`graphics/text_window/message_box.png` holds the dialogue frame and a palette that is also every
text colour in the field: 1 fill, 2 text, 3 text shadow. Recolouring it recolours dialogue,
menus, yes/no and the save box together. The menu frame is `graphics/text_window/1.png`; frame
dots use colours 10-15 only. Full screens (bag, team) use other files and stay as they were.
Battle text boxes: **[not run]**.

To see the save box in a picture **[run]** (a fresh game on the base): `kit shot --name
save-box.png press START wait 40 press DOWN wait 8 press DOWN wait 8 press DOWN wait 8 press A
wait 90`. At a fresh start the menu reads BAG, the base's own entry, the player's card, SAVE,
OPTION, EXIT, so SAVE is three presses down; once the player has creatures the menu grows at
the top, so take `kit shot press START wait 40` first and count. The box asks "Would you like
to save the game?" with YES already chosen; one more `press A wait 240` saves.


- The place-name banner has its own pictures under `graphics/map_popup/` and a per-place theme
  table in `src/map_name_popup.c`. The option screen's text colours are
  `graphics/interface/option_menu_text.pal`.
- Keep the text clearly lighter or darker than the fill, and lighten any red, green or blue
  text colour enough to read on it.

## Gotchas
- The frame shares its palette with the place-name banner, and the engine sometimes overwrites
  its first ten colours: that is why frame dots use 10-15 only. **[run]**
- The small "more text" arrow uses text colours 2 and 4. Check it on the new fill. **[run]**
- **[not run]**: battle text boxes; the sign-style box; the naming screen; other full screens
  that load the dialogue colours directly.

## Check it in the game
`kit build`, then one picture each of: a person talking, a yes/no, the pause menu, the save
box, an item being received, the option screen. Done when words are readable in every one.

## What they now know
"You know the boxes are pictures with one shared list of colours. Your game now speaks in
your colours."
