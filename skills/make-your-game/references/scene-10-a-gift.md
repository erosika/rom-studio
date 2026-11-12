# Scene 10: a gift

**[run]** = done and seen in the running game on this engine, 2026-11-10. **[not run]** = not
tried here: a guess until your picture shows it. Run today: a new key item handed over in a
conversation, a pause-menu entry that appears only once you hold it, and a choice of one
creature out of three. Shops and money were not.

## The one idea
"Things you carry are items. Each is a row in a list: a name, a description, which pocket of
the bag it goes in, what it costs. Someone gives you one with a single instruction, and the game
plays the little tune and puts it away for you. Some belong to the story and can never be sold
or thrown away (key items)."

## Ask (one at a time, with a default)
1. "What do you receive, and from whom?" ("your grandmother gives you the brass key to the lamp
   room?")
2. "What does the bag say about it?" Write the description yourself and offer it.
3. Only if it fits their story: "Should having it change anything?" ("the lamp room door opens
   once you hold it?")

If the user wants an ordinary item the engine already has (a healing item, say), skip steps 1
and 2: the gift is one line in a script.

## Recipe
1. **The item's number.** In `include/constants/items.h` add `ITEM_BRASS_KEY = <last number +
   1>,` after the last numbered item, directly **before** `ITEMS_COUNT`. Never insert higher
   up: saved bags store these numbers. **[run]**
2. **The item's row.** In `src/data/items.h`, after the last entry **[run]**:
   ```c
   [ITEM_BRASS_KEY] =
   {
       .name = ITEM_NAME("BRASS KEY"),
       .price = 0,
       .description = COMPOUND_STRING(
           "Opens the lamp\n"
           "room. Worn smooth\n"
           "by many hands."),
       .importance = 1,
       .pocket = POCKET_KEY_ITEMS,
       .type = ITEM_USE_BAG_MENU,
       .fieldUseFunc = ItemUseOutOfBattle_CannotUse,
       .iconPic = gItemIcon_CoinCase,
       .iconPalette = gItemIconPalette_CoinCase,
   },
   ```
   `.importance = 1` makes it a key item. The description is three lines of about 18 characters,
   split by hand. The icon is borrowed from an existing item (names in
   `src/data/graphics/items.h`); tell the user it is a stand-in. Its own icon is later art work.
3. **Hand it over** **[run]**. In the giver's script: `giveitem(ITEM_BRASS_KEY)` then
   `setflag(FLAG_MYGAME_GOT_BRASS_KEY)` (take the flag as in `scene-09-a-story-beat.md`). `giveitem` plays the
   tune and shows "obtained" and "put away" by itself. Test the flag at the top of the script
   so it is given once.
4. **Let it change something** (optional). Any script can test that flag (scene 9). To show a
   pause-menu entry only once the player holds the item **[run]**: in `src/start_menu.c`,
   `BuildNormalStartMenu`, put the entry's line under a test, as its neighbours are:
   `if (FlagGet(FLAG_MYGAME_GOT_BRASS_KEY) == TRUE) AddStartMenuAction(MENU_ACTION_HERMES);`
   (the built-in assistant entry is the only one this was done to).
5. **A creature as the gift** **[run]**, if that is what the story gives:
   - Stand each creature on its square as a person with
     `"graphics_id": "OBJ_EVENT_GFX_SPECIES(<NAME>)"` (names from the `SPECIES_*` list in
     `include/constants/species.h`), each with its own hide flag in `"flag"`.
   - Its script: `lockall`, a line about it, `msgbox(..., MSGBOX_YESNO)`; on yes
     `givemon(SPECIES_<NAME>, 5)`, `removeobject(LOCALID_...)`, `setflag(<its hide flag>)`,
     `playfanfare(MUS_OBTAIN_ITEM)`, `message(...)`, `waitmessage`, `waitfanfare`, then
     `setflag(<the first FLAG_SYS_ switch in include/constants/flags.h>)` (makes the team entry
     appear in the pause menu) and your
     own "has a partner" flag; `releaseall` at the end. A variable remembers which one.
   - To offer a nickname: a yes/no, and on yes `call(Common_EventScript_GetGiftMonPartySlot)`
     then `call(Common_EventScript_NameReceivedPartyMon)`.
   - For "choose one of three", each script first tests the "has a partner" flag and, if it is
     on, says the others are staying.
6. **A shop or a price** **[not run]**. Nothing was built with money today. If the user wants a
   shop, say it is untested, copy an existing shop script from `data/maps/` (search for
   `mart` in the scripts), and report each step as not tested until seen.

## Gotchas
- **Choosing USE on the new item in the bag prints a leftover line from the original game**
  that does not fit. Seen today and not fixed. Tell the user, or write your own use function;
  do not report the item as finished without saying so. **[run]** (the fault).
- Adding an item rebuilds a large part of the game (not timed). **[run]**
- A creature given at a low level gets its default moves; check one of them does damage.
  **[run]** for three creatures.
- The team and summary screens keep the original game's wording and look. **[run]**
- **[not run]**: `giveitem` with a full bag; a typed nickname appearing in later lines; the
  summary screen was looked at for one of the three creatures only.

## Check it in the game
```
kit build
kit press <walk to the giver> A <A through the lines>
kit where        # the "obtained" line, word for word
kit shot         # the item box on screen
kit press <A to finish> START
kit shot         # the pause menu, with any entry that should now be there
kit press <open the bag, go to the key items pocket>
kit shot         # the item, its name and description, nothing cut off
```

Then one picture of the pause menu **without** the gift (a fresh start, then START) if step 4
was done, and talk to the giver again to see it is not given twice. For a creature: a picture of
the team screen with it in. Done when the bag picture shows the item with its full description.

## What they now know
"You know what an item is: a row in a list, handed over by one line in a script, and the story
can check whether you hold it. Handing over a creature works the same way."
