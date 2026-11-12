# Scene 9: a story beat

**[run]** = done and seen in the running game on this engine, 2026-11-10. **[not run]** = not
tried here: a guess until your picture shows it.

## The one idea
"The game remembers things with switches. A switch is off until something you do turns it on
(the game calls it a flag), and anything in the world can look at it: a person says something
new, a door opens, someone is gone. For a choice with more than two answers the game keeps a
small number instead (a variable)."

## Ask (one at a time, with a default)
1. "What does the player do?" ("tell your grandmother what you want to do this summer, from
   three answers?")
2. "What is different afterwards?" ("she answers differently depending on what you said, and
   the door to the lamp room opens?")
3. If a choice: "What are the answers?" Propose them; keep them short, they share one small box.

## Recipe
1. **Take a switch.** In `include/constants/flags.h` rename a `FLAG_UNUSED_0x...` define,
   keeping its number: `#define FLAG_MYGAME_TOLD_GRANDMOTHER 0x20`. For a number, rename a
   `VAR_UNUSED_0x...` define in `include/constants/vars.h`. Write each in `game.md` Notes with
   its number and meaning; never give a taken one a second meaning. **[run]**
2. **A yes/no question** **[run]**: `msgbox(MyRoom_Text_Ask, MSGBOX_YESNO)`, then
   `if (var(VAR_RESULT) == YES) { setflag(FLAG_...) ... } else { ... }`.
3. **Several answers, remembered** **[run]**. Inside a script that starts with `lock`,
   `faceplayer` and ends with `release`:
   ```
   message(MyRoom_Text_AskSummer)
   waitmessage
   dynmultichoice(16, 3, TRUE, 4, 0, DYN_MULTICHOICE_CB_NONE,
       MyRoom_Text_ChoiceFish, MyRoom_Text_ChoiceRead, MyRoom_Text_ChoiceNotSure)
   switch (var(VAR_RESULT)) {
       case 0: setvar(VAR_MYGAME_SUMMER, 1)
               msgbox(MyRoom_Text_OnFish, MSGBOX_DEFAULT)
       case 1: setvar(VAR_MYGAME_SUMMER, 2)
               msgbox(MyRoom_Text_OnRead, MSGBOX_DEFAULT)
       default: setvar(VAR_MYGAME_SUMMER, 3)
               msgbox(MyRoom_Text_OnNotSure, MSGBOX_DEFAULT)
   }
   ```
   Arguments: left, top (in 8-dot cells), `TRUE` so the back button cannot skip it, rows before
   it scrolls, the row selected at first, no callback, then the answers, each its own
   `text Name { "FISH ALL DAY" }`. The result counts from 0; store 1 and up so that 0 keeps
   meaning "not asked". Each `case` runs only its own lines.
4. **Different words afterwards** **[run]**: at the top of the person's script,
   `if (flag(FLAG_...)) { switch (var(VAR_MYGAME_SUMMER)) { case 1: msgbox(...) ... } release end }`.
5. **Someone appears or leaves** **[run]**: put a flag name in the person's `"flag"` field in
   `map.json`; while that flag is on, the person is not there. To make them leave during a
   scene: `removeobject(LOCALID_...)` then `setflag(...)`.
6. **Something happens when you step on a square** **[run]**: append to `coord_events`
   `{"type": "trigger", "x":.., "y":.., "elevation": 3, "var": "VAR_TEMP_2", "var_value": "0",
   "script": "..."}`. It runs while the variable has that value; switch it off for good with
   `MAP_SCRIPT_ON_TRANSITION { if (flag(...)) { setvar(VAR_TEMP_2, 1) } }`. A live trigger on a
   door square wins over the door: that is how a door stays shut until the story opens it (the
   script says a line and steps the player back: `applymovement(LOCALID_PLAYER, <movement>)`,
   `waitmovement(0)`, with `movement Name { walk_up }`).
7. **Something happens by itself on arrival, once** **[run]**:
   `MAP_SCRIPT_ON_FRAME_TABLE [ VAR_TEMP_0, 0: MyRoom_EventScript_Arrive ]`. The script must
   `setvar(VAR_TEMP_0, 1)` first or it runs forever; then `end` if its real flag is on,
   otherwise `lockall`, `setflag(...)`, its lines, `releaseall`.
8. **Someone walks with you** **[run]** (offer only if the story wants a companion): set
   `FNPC_ENABLE_NPC_FOLLOWERS` to `TRUE` in `include/config/follower_npc.h`, give the person a
   hide flag (step 5), then in their script
   `setfollowernpc(LOCALID_..., FNPC_ALL_LAND, <a talk script>)`. They walk behind, turn
   corners, come through doors and can be talked to. The one talk script is used on every map,
   so it picks its words from story flags and uses `facefollowernpc`, not `faceplayer`.
   `checkfollowernpc` tells a script whether they are there; `destroyfollowernpc` ends it.

## Gotchas
- **`VAR_TEMP_*` reset each time a map is entered.** Use them for "this visit" only, and a real
  flag or variable for anything the game must remember. **[run]**
- **An arrival script (step 7) hides the place-name banner** on every arrival, since a script
  starts each time even when it ends at once. If the banner matters, key the table entry on a
  real variable instead. **[run]** for the cause; the fix **[not run]**.
- **The companion grows the save file.** Switch it on before the user has a saved game they care
  about, and tell them. **[run]** with no saves; with a save, or across save and continue,
  **[not run]**.
- **Hide the companion before any scripted walk** (`hidefollowernpc`) or they are left behind.
  With the feature off, every companion command stops the build. **[run]**
- Flags and variables are stored in saved games by number. Renaming an unused one is safe;
  moving or reusing one is not.

## Check it in the game
```
kit build
kit press <walk to the person> A <A through the lines; DOWN and A to choose>
kit where        # the reply to that answer, word for word
kit shot         # one of the choice box open, one of the reply
kit press <talk to them again>      # then kit where: the "afterwards" line
```

Walk the whole beat once as a player would. Then, to check each answer or the changed world
without replaying everything, set the switch first and go there: `flag set <number>` before
`warp` (see `kit-today.md`; both work only while the player can walk). Take a "before" and an
"after" picture of the same spot. Done when the two pictures differ the way the user asked,
and the player can walk afterwards on every path through the conversation.

## What they now know
"You know how the game remembers: a switch for yes or no, a number for a choice, and anyone or
anything can change because of them. That is all a story is made of here."
