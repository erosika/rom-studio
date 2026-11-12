# Scene 1: restyle a place

Part one. **[run]** = done and seen in the running game on this engine. **[not run]** = not
tried: a guess until your picture shows it. Two sources for the marks here: **(kit)** = run
with the kit's own commands on a test game, built and looked at in the game, 2026-11-10;
**(first game)** = done in the first game made with this studio and recorded in its `game.md`
Notes "Lab look round 6", "round 7" and "round 8" (seen in the game there, with the tools the
kit's `restyle.py` and `objects.py` were lifted from). Tell the user "the first pass comes
out rough; we correct it together", and change a mark when a step holds or fails for you.

## The one idea
"Every place is built from a sheet of small square pictures (a tileset), and many places share
one sheet. The places themselves only say which picture goes where. So if we redraw the sheet,
every place built from it changes at once, and we never touch the places themselves."

## Ask (one at a time, with a default)
1. "Which place first?" Default: the starting town chosen in the interview.
2. "What should it look like?" A description ("a grey harbour, slate roofs, wet stone"), or a
   real source ("like my band's website"): then load `restyle-from-a-source.md` and measure the
   palette before painting.
3. "What is this place called in your game, in one or two words?" It becomes the place's lore
   id (`lore-ids.md`); scene 2 puts the name on screen.

## Concept picture first (before steps 4 to 7)
A first version drawn from measured colours alone came out flat (identical houses, blob roofs,
bare ground) and was rejected. What was accepted had streets made of something, a named square,
buildings that differ from each other, built roofs, and jokes as furniture. **[run]** (first
game, one town: concept, shapes, drawing, seen in the game; the rejected version came first)
- **Ask the image model for a concept of the whole place**, if your host can make pictures:
  the user's words for the look, where the water, the square and the houses are, seen from
  above as the game shows places. **No real company, person or game names in the prompt**:
  describe the look instead. Ask how many pictures you may make; save them in `refs/`, show
  them, and the one the user picks is the direction. No image tool: ask for a sketch or photo.
- **Pick shapes from it, not pixels.** Write them under Look in the lore file: each building's
  roof shape, door and one detail; what the streets are made of; the square's name; which
  jokes become furniture (a bench, a sign, a plinth with a pun on it).
- **Then draw at true size**, square by square (16 by 16 dots), with step 7: for a whole town
  the shapes pass is part of this scene, not an extra. Do not shrink the concept into tiles.
  A built roof: rows of tiles that follow its shape, an eave one dot wider than the roof, a
  dark shadow line under it on the wall, lit from one side.
- The sheet fills up: the accepted town used 511 of its 512 squares. Count before adding.

## Recipe
1. **Start the place's lore file.** `kit lore new <id> "<NAME>"`, then fill in the line under
   the title as `` Engine map `<MapName>`; tilesets <A> and <B>. `` (as `kit maps --all` prints
   them; only the map name in backticks: `kit lore` finds the place's pictures by it) and
   `## Look` from the user's answer: a `Mood:` line, the colours, what differs from its
   neighbours. **[run]** (kit)
2. **Find the sheets and who shares them.** `kit maps --all` prints each map's two tilesets
   (a first one shared widely, a second one for that kind of place), after the word `tilesets`.
   That short name is what `kit tileset` takes (any capitals): `kit tileset <name> maps`
   lists every map that uses one: tell the user how many places will change. Start with the
   second one of the user's town. **[run]** (kit)
3. **The role table.** `kit tileset <name> roles` writes `roles.json` beside the tileset (a
   first guess for every building block: ground, path, floor, tall_grass, foliage, water,
   ledge, flower, roof, door, object) and a numbered sheet. Look at the sheet and correct
   `"role"` where a block is labelled wrongly. **[run]** (kit; the guesses are rough)
4. **The profile** is the user's look as one JSON file in their game (for example
   `tools/<id>.json`): `ramps` (dark to light colours for neutral, green, blue, warm, yellow,
   red: where every old colour of that family lands), `plate` (the flat colour of ground, path
   and floor), optional `treatments` per role, and `"lore": "<id>"`. Colours are `#RRGGBB`;
   each ramp has two or more, dark to light; a family left out uses `neutral`:
   ```
   {"name": "harbour", "lore": "salt-harbour",
    "ramps": {"neutral": ["#101418", "#8090a0", "#f0f0e8"], "green": ["#14301c", "#4a7a50", "#b8d8a8"],
              "blue": ["#0c1c38", "#3a6898", "#a8c8e8"], "warm": ["#2a1810", "#8a5a38", "#e8c8a0"]},
    "plate": {"ground": "#c8d0c0", "path": "#d8d0b8", "floor": "#b0b8c0"},
    "treatments": {"foliage": "flat"}}
   ```
   Treatments: `flat`, `plate`, `reeds`, `slats`, `ripples`, `seams`, `keep` (the top of
   `KIT/restyle.py` says what each does). The colours are the user's: ask, or measure. **[run]** (kit)
5. **Restyle.** `kit tileset <name> restyle --profile tools/<id>.json`. Every run starts from
   the original art, so run it as often as you like; it also notes itself under Lineage in the
   lore file. Never changed: the sheet's size, tile positions, the building blocks, what they
   do, **which dots are see-through**, and every map. Animated tiles named in the engine's
   animation file go through the same pass. `--palette-only` repaints colours and leaves the
   dots: offer it if the redraw is not landing after two rounds. **[run]** (kit: second and
   first tileset of the starting town; first game: ten tilesets)
6. **Before and after.** `kit tileset <name> before-after`: three maps from the last kept
   scene and now. Show the user; fix roles or the profile and run step 5 again. **[run]** (kit)
7. **Whole objects of the user's own** (houses, trees, signs) are the second pass, when the
   user wants shapes changed and not only fills. `kit tileset <name> objects` lists candidate
   objects with footprint and where one stands; `kit redraw dump <map> x y w h` shows the
   tiles there. The drawings live in the user's own art module (`tools/<name>.py`). Start it
   from `references/starter-art.py` beside this file: copy it into the game as
   `tools/my_art.py`, fill in its three marked lines (the shared sheet, the map and top-left
   square of one 4 x 4 house from the objects list, the lore id) and run the preview; it draws
   one plain house, and every further object is another function like it **[run]** (the
   preview, on a second game). Each group carries `'lore': '<id>'`. The calls, all of them:
   on a canvas `im = Im(w, h)`: `rect(x, y, w, h, c)` filled, `box(x, y, w, h, c)` outline,
   `hl(x, y, n, c)` / `vl(x, y, n, c)` lines, `px(x, y, c)`, `text(x, y, 'WORDS', c)` (capitals,
   3 dots wide), `art(x, y, rows, key)` (rows of letters, one per dot), `blit(other, x, y)`;
   on `run`: `claim(name, map, x, y, im, ground=...)` (the squares keep their blocks and now show
   the picture), `append(name, map, x, y, im, slot, ground=...)` (new blocks for a wholly new
   picture; `slot` is a palette slot of the place's own sheet), `direct(name, tile, slot, im, x,
   y, ground)` (one 8x8 tile), `door(png, im, slots)` and `strip(png, im, slot)` (door and
   animation frames), `set_colour(sheet, slot, position, '#hex')`, `reserve(...)` (tile numbers
   an animation writes, so new art stays off them), `preview(name, places, scale)`. The top of
   `KIT/objects.py` has the full wording. A sheet holds 512 blocks: the number in use is the size in bytes of
   the sheet's `metatiles.bin` divided by 16. After EVERY `--write`, run `git status --short` in the game
   folder: a write can rebuild sheets beyond the place you meant (a module that draws several
   places, or one that calls another); put back anything you did not mean to touch
   (`git checkout -- <file>`) before building **[run]** (it happened: one place's write put
   three other places back to older art).
   `kit redraw tools/<name>.py` makes previews, `--write` writes. A drawing placed with
   `claim` keeps the old blocks, so repeated tiles must agree (it prints the clashes); `append`
   puts new blocks on the map for a wholly new picture (each square keeps what it does; the
   player no longer walks behind it unless a top picture is given). After any later restyle of
   that tileset, run the redraw again. **[run]** (kit: `append` on two houses; first game:
   `claim`, `direct`, `door`, `append`, `remap`, `repal`) `claim` with a drawing that fits the
   tile repeats: **[run]** (first game), **[not run]** (kit: the test drawing clashed, as printed).
8. **Build and walk one** of the maps in the game, at a stated hour: `kit shot --time 12:00
   --at <group.number>,<x>,<y>`, and once with `--time 00:00`. **[run]** (kit)

## Gotchas
- **Trees and ground often share palette positions**: on a light ground plate the trees go
  pale with it. Seen (kit). The fix that held (first game) is to redraw the tree as an object
  with its own dark outline, or pick a plate colour close to the old ground's brightness.
- **Some art is not on the sheet**: door frames (`graphics/door_anims/`; `--strips
  <picture>:<palette slot>` flattens them with the tileset's palette **[run]** (first game),
  **[not run]** (kit)), the rustle in tall grass and the dust on ledges
  (`graphics/field_effects/pics/`). List for the user what still shows original art.
- Outdoors the engine may tint colours by the hour: look at midday and at midnight. **[run]**
- Lettering drawn on a building can be half covered by the town-name banner on arrival and
  read as another word: check it as in `rename-it.md`. **[run]** (first game)
- A first tileset touches almost every place: start with a second one. Do not rename or
  re-register a tileset. Tile slots that an animation writes into must not be reused by
  `append`: list them with `reserve` in the art module (top of `KIT/objects.py`). **[run]** (first game)
- Not tried: decomps that keep three layers per block, and the engine family that splits its ids
  differently (the kit says so and stops). **[not run]**

## Check it in the game
`kit build`; `kit shot --time 12:00 --at ...` in the town, on a path, by a house, at the
water, in grass; `kit press` a walk across it and into a wall of each redrawn object. The
game is the truth, not `kit map`. Done when a walk through one town shows the new look, and
the user has seen before and after of three places. With the scene card, also say: how many
places changed, what still shows original art, and which roles were guesses. Then
`kit lore <id>`: the file, its pictures and its lineage should all be there.

## What they now know
"You know places are built from a shared sheet of small pictures: change it, and they all change."
