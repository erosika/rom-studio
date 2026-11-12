# Restyle a place from a source

Load this when the user says "make it look like ..." and points at something real: a website, a
poster, a photo. It needs a place already drawn by a script (`restyle-a-place.md`, or `a-new-tileset.md`).
**[run]** = done and seen in the running game on this engine, 2026-11-10 (one room, restyled
from three web pages). **[not run]** = not tried here: a guess until your picture shows it.

## The one idea
"A look is mostly a short list of colours, each with a job, plus a few habits: how many colours
do the work, flat or shaded, thick or thin lines, shapes that keep coming back. If we measure
those from the thing you like and repaint with them, your place joins the same family."

## Ask (one at a time)
1. "What should it look like? Send a link or a picture." ("make my harbour look like my band's
   website?") The source is theirs to name; never choose one for them.
2. "Which place first?" Ask nothing about colours: you measure, the user judges the result.

## Recipe
1. **Get the source onto disk** as pictures in `refs/`, named `<source>-<page>.png`. A photo or
   poster is already one. For a website, take real screenshots of two or three pages, top and
   full length. If the headless browser cannot load live pages from your shell (it could not
   today): fetch each page with its stylesheets, fonts and images, strip the scripts, and
   render the local copy. Send plain page requests only. Anything the site draws with scripts
   is then missing from the pictures: say so. **[run]** for web pages; a photo or poster
   **[not run]**.
2. **Measure, do not guess.** From the stylesheets, take the declared colours and what each is
   for (named colour variables are the best evidence). From the screenshots, count pixels: the
   dominant colours and what share of the screen each takes, per page. A colour declared but
   absent from every picture is noted and not used. **[run]** A photo: counts only **[not run]**.
3. **Write it down before painting**, in `game.md` under a "Palette" heading: where it was
   measured from; a table of 8 to 12 colours, each with its value, a plain name, its role, and
   its measured screen share; then four or five style rules in plain words: how many colours
   carry the look, flat or shaded, line weight, recurring motifs, how lettering is treated.
   Name one colour as the only accent. Note that the screen rounds each colour channel down to
   a multiple of 8; that is close enough, do not compensate. **[run]**
4. **Repaint by roles, in place.** The drawing script holds its colours as a table of letter
   to colour with a role beside each (outline, wall, floor, highlight, accent). Change the
   colours in that table, keep the letters, and write beside each what it now is. Then redraw
   the pieces that need it **in place**, keeping the order of squares, so every square keeps
   its number and no map changes. Give the main colours the same share of the screen they
   have in the source: the dominant one goes on the floor or walls, the accent on a few small
   marks. Remove every colour from the old look. **[run]**
5. **Carry one or two motifs** from the source into the big set pieces (a wall display, a floor
   inlay): its title lettering style, its way of shading. Take the family, not the thing: do
   not copy a logo, seal or mascot. **[run]**
6. **Compare side by side and iterate once.** Build, walk the place, take pictures, and put
   them next to the source screenshots. Fix what the comparison shows, with people standing
   in the pictures: today a person in white vanished on a white platform, so the platform
   became a pale wash of the main colour. Keep the differences the game needs (squares this
   small need a dark outline even if the source has none) and write them down. **[run]**
7. **Everyone paints from the same page.** Whoever draws the text boxes and the people reads
   the written palette, not the room, so everything lands in one family. **[run]** for the
   text boxes; people repainted to it **[not run]**.

## Gotchas
- Measured colours alone make a flat place: for a whole town, get a concept picture first and
  take its shapes (`restyle-a-place.md`, "Concept picture first"). **[run]** (first game)
- The tile sheet has a fixed size; a repaint that adds detail can run out of room. Check how
  many tiles are left before adding set pieces. **[run]** (5 were left).
- Pictures taken before the repaint show the old look: delete them or say which. **[run]**
- Outdoors under time-of-day tint; a source that is mostly dark: **[not run]**.

## Check it in the game
`kit build`, then walk every part of the place and `kit shot` each area with a clear name
(`harbour3-quay.png`), with the people who stand there. Skipping a re-check is fine if you say
so: today solid squares were not re-walked (same data) and animations were not re-pictured.

## The hand-over (required shape)
This report replaces the scene card, in this order, with no claim beyond what a picture shows:
1. **Where to look**: the picture names, yours and the source's.
2. **The palette**: what the main colours are, and that they were measured from the source,
   not invented (and what could not be captured).
3. **What changed in the place**: floor, walls, furniture, the set pieces, in a few lines.
4. **The one honest judgement call**, stated plainly, with the cheapest alternative offered as
   a choice: "It is very blue. The easy fix is a paler floor. Tell me which you prefer once
   you have looked."
5. **What now clashes** as a consequence (people or boxes still in the old colours).
6. **What was not re-checked**, and 7. **what is still in progress.**

## What they now know
"You know what a look is made of: a few colours with jobs, and a few habits. You can point at
anything and have your game take after it."
