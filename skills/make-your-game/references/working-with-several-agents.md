# Working with several agents

For when more than one agent edits the same game folder at once. One agent is the lead. This
arrangement worked on 2026-11-10 with five agents on one scene.

## Before parallel work starts: the lead writes a contract in `game.md`

- **Names**: the map's name, constant and layout id, and that it is appended to the game's group.
- **Size and squares**: width, height, and the coordinates (x, y from 0 at the top-left) of
  everything two agents must agree on: where the player starts and faces, where each person
  stands, which squares must be walkable, the door square.
- **Shared ids**: names of new people looks and story switches. Until a look exists, the script
  owner uses a stand-in and swaps it when the board says done.

## One owner per file

- Every file, or part of a list, has exactly one owner, named on the board. Edit only yours.
- Need a change in someone else's file? Write it under "Requests" in `game.md` and carry on.
- Finish an edit before you build. Never leave a half-written file on disk.
- If the build fails in a file you do not own: wait a minute, retry up to three times, then
  write a request. Do not fix it yourself.
- Only the lead runs git. Nobody else commits, stashes, checks out, resets or cleans. The lead
  commits at checkpoints, in plain words.

## The handoff board

A table in `game.md`, one row per agent: what it owns, status, where its pictures are. When you
finish or stop, update your row and add a Notes section with what the next agent needs: ids and
squares you took, what is not done, what is not tested. Whoever lays out a room lists every
readable object with its square, so the script owner can attach words without guessing.

## Pictures

All in `shots/`, named `<stream>-<what it shows>.png` (`script-03-choice-box.png`). Say which
are from the running game and which are a script's own render. Delete outdated ones.

## Several places at once
When each agent takes a different place (a town, its gym, its road), one shared folder is too
tight. **[run]** for the copies, the reserved switches and the feed (first game: six places at
once); **[not run]** for bringing the work back together at the end.
1. **Reserve first, in the main folder, and keep it**: give each place its own story switches
   (rename unused entries in `include/constants/flags.h`, a few per place) and, if it needs
   trainers, its trainer ids (`the-first-leader.md`, step 3). Before renaming an "unused"
   switch, search `src/` and `data/` for its old name: one was still used by name and the
   build stopped linking until the old name was defined again.
2. **One copy of the game folder per place, on its own branch**: copy the whole folder with
   its build (`cp -a`, so the first build is quick; about 0.7 GB each), then in the copy
   `git switch -c place/<lore id>`. Each agent works and builds only in its copy
   (`kit --game <copy> ...`). Check the free disk space first.
3. **In the main folder, shared files are added to only at the end**: the list of included
   scripts (`data/event_scripts.s`), the trainer list, the place-name list, anything past the
   reserved switches. An agent adds what it needs in its own copy so it builds, and lists each
   added line in its Notes; the lead adds them to the main folder once, place by place,
   building after each.
4. **Feed notes go to the main folder** so the user watches one feed:
   `kit --game <main folder> note "<sentence>" --scene "<place name>"`. Pictures stay in the
   copy: give the note a sentence, or copy the picture into the main folder's `shots/` first.

## Who helps, and what the user thinks **[run]**
- **Before handing work out, run `kit workers`.** It lists the helpers the user switched on in the
  pane's Settings tab, the command that starts each, its model, and the default. Use only those;
  if the list is empty, do the work yourself or ask with `kit decide`.
- **Every note says who wrote it**: `kit note "<sentence>" --shot <png> --scene "<place>" --by
  "<stream>"` (`art`, `script`, `play test`). The pane then shows one tile per stream, so the
  user sees which have gone quiet.
- **The user answers in the pane, not in the chat.** Each agent runs `kit reviews --open --scene
  "<its stream or place>"` when it starts and after each step. A "needs work" with a note is the
  user's correction (a note alone is a remark or a pick: act on it the same way): fix that one thing, then `kit note "<what changed>" --shot <png> --before
  <old png> --answers <entry time>` so it stops showing as waiting.
- **Choices that are the user's go to `kit decide`**, with your recommended option, and the agent
  carries on. The lead reads `kit decisions` at each checkpoint and passes answers on. Do not
  bury such a choice in a report: on the first game about forty were, and most were never seen.
- **Pictures you generate use the user's model**: read `image_model` (`kit settings image_model`)
  and pass it to your picture tool.
- **Notes about one place go to that place**: add `--lore <id>` so the sentence lands under
  Lineage in its lore file. One shared notes file for every agent grew past three thousand
  lines in a day and collected clashing edits.

## What slipped today
A list of readable squares arrived late and the script owner guessed two; two streams each
waited on a section the other had not written. Write "this did not exist when I looked" and
carry on. Done still means built, walked to, and a picture shows it; otherwise "not tested".
