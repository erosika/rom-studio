# Scene 5: the first leader

Part one. **[run]** = done and seen in the running game on this engine, 2026-11-10. **[not
run]** = not tried: a guess until your picture shows it. Run today: reaching a battle with the
kit; a new person's battle picture seen in a battle; new trainers written in the trainer file
and built, not fought. Marks with **(first game)** come from the first game made with this studio (its `game.md` Notes "Script (round 6, the world in place)" and "Script (round 7)"):
the existing first gym kept as a map and rewritten (a leader and two trainers, fought on foot,
badge and reward seen). It used NEW trainer entries appended to the list and new scripts beside
the old ones; rewriting the original trainer blocks in place is still **[not run]**.

## The one idea
"A trainer is a person with a team and three lines: before the fight, when they lose, and
afterwards. A gym is a room of them with a leader at the end, and beating the leader turns on
a story switch, the badge, that the rest of the game checks."

## Ask (one at a time, with a default)
1. "Who leads the first gym in your game?" ("the harbour master, who keeps storm creatures?")
2. "Their team?" Propose two or three creatures at about the original levels.
3. "What do they say before, when they lose, and after? And what is the badge called?"

## Recipe
1. **Find the gym.** `kit maps --all`, then `kit map <gym> --overlay people`: the leader and
   each trainer with their script names. In `data/maps/<Gym>/scripts.inc` each has a line like
   `trainerbattle_single TRAINER_<ID>, <intro text>, <defeat text>[, <script after>]`. Note
   every `TRAINER_<ID>`. **[run]** (first game)
2. **Rewrite each trainer in place** in `src/data/trainers.party`: find the block starting
   `=== TRAINER_<ID> ===`, **keep that line**, and change what is under it: `Name:`, `Class:`,
   `Pic:` (an existing picture name, or their own: `battle-pictures.md`), `Gender:`, `Items:`,
   then a blank line and each creature as its name, `Level: <n>` and optional `- <Move>`
   lines, with a blank line between creatures. The file's own header explains every field;
   names are the ones the player sees. **This is the way to use**: in place **[run]** (first game:
eight rooms' trainers and leaders rewritten in their own blocks, every leader fought and beaten).
Appending new ids after the last one also works **[run]** but the free ids run out; do not start there.
If the decomp has no `trainers.party`, its trainers are C tables in `src/data/trainers.h`: the same
fields under the same id; **[not run]**.
3. **Never add or remove trainer ids for this**: saved games store them, and the engine tried
   had two unused ones left **[run]**. If the user's gym has fewer trainers, reword the spare.
   **When the free ids run out** (they did in the first game), reuse the ids of the original
   people who stood in the room you rewrote: they are no longer on the map, so their blocks
   are free to rewrite. Search `data/` for each id first: an id used by a person on another
   map changes there too (three were shared with a road that way). **[run]** (first game: fought)
4. **The lines.** In the gym's `scripts.inc`, change the words under the intro, defeat and
   after-battle text labels (hand-split text: `rename-it.md`, step 4). **[not run]** as an edit
   of the old file; **[run]** (first game) as new scripts beside it (`rewrite-the-people.md`,
   step 7). Give the gym its own lore file and tag its script file (`lore-ids.md`). In a new
   file a trainer and a leader look like this (the leader keeps every instruction the original
   after-battle script had: the badge switch, the other switches, the reward):
   ```
   script <Gym>_Fellow {
       trainerbattle_single(TRAINER_<ID>, <Gym>_Text_FellowIntro, <Gym>_Text_FellowDefeat)
       msgbox(<Gym>_Text_FellowAfter, MSGBOX_AUTOCLOSE)
   }
   script <Gym>_Leader {
       trainerbattle_single(TRAINER_<LEADER>, <Gym>_Text_Intro, <Gym>_Text_Defeat, <Gym>_LeaderBeaten, NO_MUSIC)
       msgbox(<Gym>_Text_Again, MSGBOX_DEFAULT)      // talking to them after the win
       release
   }
   script <Gym>_LeaderBeaten {                       // runs once, straight after the win
       setflag(FLAG_BADGE0<n>_GET)                   // and every other setflag / setvar the original had here
       message(<Gym>_Text_Badge)
       waitmessage
       call(Common_EventScript_PlayGymBadgeFanfare)  // copy the original's own line for the fanfare
       msgbox(<Gym>_Text_After, MSGBOX_DEFAULT)
       giveitem(ITEM_<the original's reward>)
       release
   }
   text <Gym>_Text_Intro { format("...") }           // format() splits the lines for you
   ```
   **[run]** (first game, eight leaders).
5. **The badge.** Keep every instruction in the leader's after-battle script: it sets the
   badge flag and others the story checks, and hands over a reward. The badge's name is only
   words: search `data/` for the old name and change it in the gym's lines and the few other
   maps that say it. **[run]** (first game: badge and reward seen after the fight) The badge's picture on the player's card is not covered.
6. **The leader's look on the map**: `graphics_id`, as in `rewrite-the-people.md`. The room
   and its puzzle stay; its look changes with `restyle-a-place.md`.

## When a gym moves in the game's order
If the user makes this the third gym instead of the first (or any move), these move with it.
Write each in `game.md` Notes as done or not:
- **Its badge number**: the badge switch the leader's script sets (`FLAG_BADGE01_GET` to
  `08`). The number, not the name, decides which field move it unlocks and how strong a
  creature may be and still obey (`src/field_move.c`, `src/battle_util.c` in the engine
  tried). Swap with the gym that takes its old place. **[not run]**
- **The door or gate that holds the player**: a check for so many badges, or for one badge,
  at the gym door or on the road. **[not run]** (first game: built, not walked)
- **The levels of the people inside**: set them beside the original leader who held that
  place, leader and trainers both. **[run]** for a leader (first game: five creatures at the
  original sixth leader's levels, the battle started); the trainers **[not run]**.
- **Messages that say "next"**: people who point to the next gym, the leader's after-battle
  line, the guide at the door. Search `data/` for the gym's and town's names. **[not run]**

## Gotchas
- A mistake in the trainer file stops the build with the line number. **[run]**
- With no move lines a creature gets its usual moves for its level. Check every team can do
  damage. **[not run]**
- The leader may be listed again for rematches and phone calls later in the game; those keep
  the old name until rewritten. Note them in `game.md`. **[not run]**

## Check it in the game
The player needs a creature first (`givemon`, see `kit-today.md`; needs the kit's base):
```
kit build
kit press givemon <species number> 12 warp <group> <num> <x> <y> walk <to the leader> press A wait 60 where save /tmp/leader.ss
        # one line: every run starts from a fresh game. `where` prints the leader's line before the fight
kit shot load /tmp/leader.ss press A wait 240          # carries on from that moment: the leader's picture and first creature
```
Warp to a square no trainer can see: landing in a trainer's sight with a creature reports
"did not land" **[run]**.
**Walk up and press A.** The kit's `script` step cannot start a trainer battle: the engine
needs the person on the map to start it, and a trainer's script started by name stops with an
error screen **[run]**.
Fighting a battle through by pressing buttons with the driver is **[run]** (first game: the
gym fought on foot, badge and reward seen). Still ask the user to fight it with `kit play`
and tell you what the badge line said. `kit play` is the user's own save from the start of the
game (`kit-today.md`), so they need a creature and the walk to the gym: if the first creature or
the road is not there yet, show the driver's pictures now and keep "fight the leader yourself" as
an open line in `game.md` Notes. Done when the user has fought their leader.

## What they now know
"You know what a trainer is: a person, a team and three lines; and a badge is a switch."
