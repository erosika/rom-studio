# Scene 6: the road between

Part one. **[run]** = done and seen in the running game on this engine, 2026-11-10. **[not
run]** = not tried: a guess until your picture shows it. Run today on new maps: switches,
trigger squares, people who appear or leave (`scene-09-a-story-beat.md`), and a start that
skips the original opening by setting its switches. Gates of an existing game: **[not run]**.

## The one idea
"Between your first town and the first gym the original game stops you several times: someone
blocks the path until you have done something, a scene plays when you step somewhere. Each of
these is a gate: a switch the game checks. For each one we decide: keep it and make it yours,
or take it away."

## Ask
First build the list (recipe 1), then show it in plain words, one line a gate, in the order a
player meets them ("1. You cannot leave town until you have a creature. 2. On the path, a
scene where you help someone."). Then, **one gate at a time**: "Keep this and reword it, or
remove it?", with your proposed answer from the brief.

## Recipe
1. **List the gates.** For each map on the way (`kit maps --all` shows how maps join and
   where doors lead), read `map.json` and `scripts.inc` for **[not run]**:
   - `coord_events` (squares that start a script while a variable has a value);
   - the map's own script tables at the top of `scripts.inc` (things that run on arrival);
   - people whose `"flag"` is set (they appear or vanish with a switch) and who stand in a
     way through;
   - scripts that check a flag or variable before letting something happen.
   Write each in `game.md` Notes: where, what the player sees, which switch, what sets it.
   Shared scripts under `data/scripts/` count too.
2. **Keep and reword**: change only the words and the looks, as in `rewrite-the-people.md`.
   The instructions, the switch and the order stay. This is the safe choice; say so.
3. **Remove**: do not delete the trigger, the person or the script. Make the game start as
   if the gate were already passed: at the start of a new game, set its flag or variable to
   the value it has afterwards. With the kit's base the place is the quick-start function in
   `src/` (the kit's `status` says whether the base is applied; search `src/` for
   `VarSet(` near "quick start"); without it, the end of `NewGameInitData` in
   `src/new_game.c`: `FlagSet(FLAG_...);` or `VarSet(VAR_..., <value>);`. **[run]** for the
   original opening (the base does exactly this); for other gates **[not run]**.
4. **What a removed gate gave the player** must still arrive: a first creature, an item,
   running. Give it another way (`scene-10-a-gift.md`) or the game cannot be finished. Check
   each removed gate for what it handed over. **[not run]**
5. **One gate, then check.** Change one, build, walk through it, then the next. Gates depend
   on each other; changing several at once hides which one broke the road.

## Gotchas
- A variable often counts through several gates (0, 1, 2 ...). Setting it past one gate
  passes every earlier one too. Read every place that checks it. **[not run]**
- A hidden person may be needed later by another script: search for their name. **[not run]**
- If a gym moved in the order, the badge checks and "next" messages on the road move with it:
  `the-first-leader.md`, "When a gym moves in the game's order".
- Changes at the start of a new game do not reach an existing saved game: the user must
  start a new game to see them. Every switch you set goes in `game.md` Notes with why.

## Check it in the game
From a fresh start, walk the whole road as a player would, in one `kit press` line per
stretch, with a picture at each gate: kept ones show their new words, removed ones do not
stop the player. `flag set <number>` and `warp` (see `kit-today.md`) let you look at one gate
without replaying the rest. Done when a new game can be walked from the first town to the gym
door. Say plainly which stretches you walked and which you did not.

## What they now know
"You know what holds a story together: switches the game checks along the road."
