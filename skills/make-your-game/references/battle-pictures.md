# Battle pictures: a person's large picture

**[run]** = done and seen in the running game on this engine, 2026-11-10. **[not run]** = not
tried here. Run today: three new people's front pictures, a front picture and a back strip
for each of the two players, a back strip for a partner. Example: "the lighthouse keeper".

## The one idea
"A person has two pictures. The small one walks around the map. The large one, 64 dots square,
is what you see when you face them in a battle; the player also has a large one seen from
behind. Like everything here it has 16 colours, one of them see-through."

## Ask (one at a time)
1. "Will you draw the keeper yourself, or shall I?" Their drawing can be any size; the tool
   fits it. A drawing outranks any description.
2. "How do they stand, and what is in their hands?" Propose one pose in a sentence ("lantern
   raised, coat blowing") so that "sure" is an answer. After each sheet: "What is wrong with it?"

## What the game needs (read off the engine's own files)
- **Front**: `graphics/trainers/front_pics/<name>.png`, 64 x 64, whole figure, feet on row 62,
  row 0 and the outer columns empty. **Palette**: `graphics/trainers/palettes/<name>.pal`.
- **Back** (players, partners): `graphics/trainers/back_pics/<name>.png`, 64 x 256: four frames
  stacked downwards, seen from behind, cut off at the waist by the bottom edge. Frame 0 ball in
  hand, 1 arm back, 2 the throw, 3 standing (shown first). Front and back share **one** palette.
- **Proportions** (measured on the engine's own adult pictures; the user's first reaction to a
  big-headed figure was "too cute"): about five heads tall. Skull 11 dots wide and 12 tall, chin
  on row 16 to 18, shoulders two rows lower and 12 to 15 wide, waist near row 30, crotch near
  row 38, knees near row 48, feet on row 62; arms 4 to 5 wide, thighs 6. Stand them
  three-quarter: far eye narrower, far arm and leg partly behind the body, both toes one way.

## Recipe
`P` = `python3 KIT/portraits.py` (KIT as in `kit-today.md`), run from the game folder.

1. **Their drawing** **[run]**: `P front drawing.png lighthouse_keeper` writes the picture and
   palette (crops, fits, cuts to 15 colours, hardens the edge; `--outline` adds a dark edge).
   A strip: `P back strip.png <name>`. Both: `P pair front.png strip.png <name>`. Enlarged pixel
   art comes back dot for dot; a soft picture comes out legal but muddy: offer to redraw it.
2. **You draw** **[run]**: a script in `tools/` using `Fig` from the same file: shapes in
   layers (far limbs, body, clothes, near limbs, head, face, hair, folds, outline), each shaded
   from the upper left in three tones; face and fingers placed dot by dot with `stamp`; then
   `convert(name, front=..., back=strip(frames), keep_canvas=True)`.
3. **Lint** **[run]**: `P lint graphics/trainers/front_pics/lighthouse_keeper.png` fails, in
   plain words, on: wrong size; more than 16 colours; soft (half see-through) dots; stray single
   dots; touching the top or sides; a back frame short of the bottom; colours unlike the `.pal`.
4. **Register a new person** **[run]**: `P register lighthouse_keeper` prints the lines,
   `--apply` writes them. Three places, append only:
   - `include/constants/trainers.h`: `TRAINER_PIC_LIGHTHOUSE_KEEPER,` above `TRAINER_PIC_COUNT,`.
   - `src/data/graphics/trainers.h`: the two `INCGFX` lines (picture, palette) above
     the first `static const union AnimCmd sAnimCmd_...[] =` line.
   - same file, table `gTrainerPicInfo`: a `[TRAINER_PIC_LIGHTHOUSE_KEEPER] = { .frontPic =
     TRAINER_FRONT_PIC(...) },` entry above the closing `};`. With `--back` it also adds
     `.backPic = TRAINER_BACK_PIC(4, ..., <the stock players' back animation>)`: 4 is the vertical
     offset, the last name (copy it from the stock players' entries) is the four-frame throw. Nothing else: no size table, no second list. A person
     who fights **beside** the player needs that back strip, then an entry in
     `include/constants/battle_partner.h` and `src/data/battle_partners.party` (`Pic:`). **[run]**
5. **Replace the player** **[run]**: no registration. Write over the stock players' files in
   those three folders (each folder holds a girl's and a boy's files, named after the original two); the menu card and battles follow.
6. **Give it to someone you can battle** **[run]**: a block in `src/data/trainers.party` with
   `Pic: Lighthouse Keeper`. A new block needs an id (here `#define TRAINER_KEEPER 855` and
   `STUDIO_TRAINERS_COUNT 1` in `include/constants/studio_trainers.h`) and a script line
   `trainerbattle_no_intro TRAINER_KEEPER, <defeat text>`.

## Check it in a battle
- Sheet first: `P sheet shots/keeper-4x.png <engine picture> <yours>` (4x, dark ground). **[run]**
- Player's front, on the menu card: `kit shot press START wait 30 press DOWN press A wait 150`. **[run]**
- Player's back: give the player a creature, `warp` beside tall grass, `walk` to and fro until
  it prints `BLOCKED` (the battle began), `wait 420`, `shot`; `press A wait 28 shot` catches the
  throw. **[run]**, with the creature given by a driver step the kit lacks; with the kit, set
  the story flags that reach the first creature instead. **[not run]**
- A new person's front, or a partner's back (`multi_2_vs_1 TRAINER_KEEPER, <text>, PARTNER_X`):
  started by script name with another step the kit lacks **[run]**; the user's way is a person
  on a map with that script line. **[not run]**

## The honest lesson
- Every figure took two to four rounds, and the whole cast was redrawn once: round one was
  four heads tall and square-on. Draw to the numbers above from the first sheet.
- The large picture must match the small one: a back view with hair to the waist was sent
  back because the small sprite's hair is short.
- Faces, hands and hair need dots placed by hand; a hand under five dots wide disappears under
  its own outline. Code-drawn figures are stiffer than the engine's own: say so plainly.
- Picture files first, registration second: a registered name with no file stops every build.

## Angle: the two sides face each other

The two sides of a battle stand on the screen's diagonal and look at each other. Draw neither
dead-on.

- Back strip (the player's side, lower left): a three-quarter view from behind, turned toward
  the upper right. The head is in near profile facing right: the back of the hair fills the left
  two thirds, then the cheek, the jaw, one eye and the nose tip. The spine sits right of the
  torso's centre, the shoulders slope, the bottom edge cuts the figure between ribs and waist.
  The head is about twice as tall as on a front picture (20 to 24 rows of the 64).
  Frames: 0 ready (free hand up at the left, ball low at the right hip), 1 wind-up (lean back),
  2 throw (drop and lean right, the arm out to the upper right, hand open), 3 standing.
- Front picture (the other side, upper right): turned three-quarter to our left with weight on
  one leg or mid-stride: features one column left of centre, far eye narrow, far arm half
  behind the body, both toes pointing left. A figure standing to attention is the weakest
  pose that passes.
- Measure the pose on five or six of the engine's own strips before drawing, write the numbers
  down, and keep the character's design and palette exactly as approved: only the angle changes.
