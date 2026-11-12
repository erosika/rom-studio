# Scene 13: share it

Part two. **[run]** = done and seen working on this engine, 2026-11-10. **[not run]** = not
tried: a guess until it is. Run: `kit patch` on the first game (a 32 MB game from a 16 MB
original), checked by the kit and by a separate patching program. Not run: another person on
another computer applying it and playing.

## The one idea
"The game you built contains the original game's pictures and music, so it is never sent to
anyone. What you send is a patch: a file that holds only what you changed, plus directions
for rebuilding your game from the other person's own copy of the original."

## Ask (one at a time, with a default)
1. "Where is your own copy of the original game file?" It must be the very file the decomp
   rebuilds; when the decomp has `rom.sha1` at its top, that is the file's sha1. Never fetch,
   guess or download one: if the user has none, say a patch cannot be made without it, and
   stop.
2. "Who is it for?" Only to word the hand-over; the patch is the same for everyone.

## Recipe
1. `kit build`, so the patch is of the game as it is now. **[run]**
2. `kit patch --original <their file>`. It writes `out/game.bps`, applies it again to check
   itself, and prints the original's sha1, whether it matches `rom.sha1`, the patch's size and
   how much of it is new. To skip `--original` next time, add `"original_game": "<file>"` to
   `settings.json` in the game folder. **[run]**
3. If it says the original is NOT the file the decomp names, tell the user: the receiver needs
   exactly the same file (same sha1), or the patch will not apply. **[not run]**
4. `kit patch --check <their file>` before sending, if anything changed since. **[run]**
5. The hand-over, in plain words: send only `game.bps`; the other person applies it to their
   own copy of the same original with any program that applies BPS patches, and plays the
   result. Give them the sha1 so they can check their file first. **[not run]** by a second
   person.

## Gotchas
- The patch is large when the engine itself grew (16 MB on the first game): most of that is
  the engine's own new parts, not the original's. A patching program of its own made one of
  nearly the same size. **[run]**
- A save from the built game works only with the same patch: a new patch after more scenes
  may not load an old save. **[not run]**
- Never attach the built game "to make it easier": it holds the original game's art and
  music. Only the patch travels.

## Check it
Done when `kit patch` printed "checked" and `kit patch --check` matched, and the user has the
file. Say plainly that nobody else has applied it yet until someone has.

## What they now know
"You know your game can travel without the original: a patch is your changes and the
directions to apply them."
