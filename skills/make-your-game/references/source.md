# The source: find things in the tree, and bring a decomp in

**[run]** = done on one expanded engine and on a small made-up tree, 2026-11-10.
**[not run]** = not tried. Example: "where does the harbour sailor say his line".

## Find before you guess
The game folder holds tens of thousands of files. Search it; never guess a path or a name.

| Do | Command |
|---|---|
| Find text | `kit find "sailor"`: every line of the source that holds it, in any capitals, as file, line number and the line, grouped by file. 200 lines at most, with a count of the rest **[run]** |
| Look in one place | `--in data/maps/**`, `--in src`, `--in "*.inc"` (a glob; a bare name pattern matches at any depth) **[run]** |
| A pattern | `--regex`, matched as written, capitals included: `kit find "^HarbourTown_EventScript_\w+::" --regex` **[run]** |
| More, or as data | `--max 500`, `--json` |
| Read around a hit | `kit find --file data/maps/HarbourTown/scripts.inc --at 12 --span 20`: numbered lines, the asked line marked **[run]** |

- It searches what git keeps and what is new since the last keep. What git ignores (build output:
  `out/`, `build/`), pictures, sound and other binaries are skipped. A folder that is not kept in
  git is walked instead **[run]**.
- A path outside the game folder is refused, and so is a link inside it that points out **[run]**.
- Too many lines means the word is too common: add letters or `--in`. Do not raise `--max` first.
- The tool wrapper has the same thing as `find` (`text`, `in`, `regex`, `max`, or `file`, `at`, `span`) **[not run]** inside a host.

## The user's side: the pane's Source tab
- **Search**: the same search, typed in a box, with an "in" field and a "pattern" box. Pressing a
  line opens the lines around it. Pressing a folder at the top searches inside that folder. Point
  the user there when they want to look for themselves **[run]**.
- **Bringing a decomp in**, when the game folder is empty or not there yet: the user gives a folder
  on the computer or a git address and presses Set up, or chooses or drops an archive (`.zip` or
  `.tar.gz`, 600 MB at most). Either way the pane starts `kit setup --decomp <it>` and shows its
  progress lines; a stop (a missing tool, a failed build) is shown with the reason **[run]** on a
  made-up tree; **[not run]** with a real decomp through the page, or with a git address.
- You can do the same from the chat with `kit setup --decomp <folder or git address>`. Never
  guess a decomp, never fetch one the user did not name.

## What is refused, in a plain sentence
- Setup when the game folder already holds a game: a game is never overwritten. For another
  decomp, start the studio with a new, empty game folder (`--game <new folder>`). If the first
  build did not finish, run `kit setup` again (no `--decomp`): it carries on.
- Setup when the folder holds other files, or while another setup runs.
- An archive holding a path that would unpack outside its folder (nothing is unpacked), one with
  no `Makefile` in its top folders, one that is not a `.zip` or `.tar.gz`, one over the size
  limit. Links inside an archive are never made.
