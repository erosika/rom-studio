# Music and sound: hear it, find it, put the user's own in its place

**[run]** = done and measured on one expanded engine, 2026-11-10 (recordings checked by
loudness and length, not by ear). **[not run]** = not tried. The kit makes no music and neither
do you: the user brings the file. Example: "the harbour town's song".

## The one idea
"A song in the game is a sheet of notes (a MIDI file) played on a set of the game's own small
instruments. A sound effect is a very short song. An instrument is a short recording (a sample),
and so is a creature's cry. You can swap the notes, or swap a recording, and the game rebuilds
around it."

## How the tree keeps it (read off the engine's own files)
- **Songs and effects**: `sound/songs/midi/<name>.mid`, one line each in
  `sound/songs/midi/midi.cfg` with the build options: `-G_<voice group>` (the instrument set, a
  file in `sound/voicegroups/`), `-V<volume 0-127>`, `-R<reverb>`, `-P<priority>`. The build turns
  each `.mid` into assembly with the tree's own converter. `sound/song_table.inc` gives every song
  its number and its player (the music player, or one of the effect players);
  `include/constants/songs.h` gives the number its name.
- **Samples and cries**: `.wav` files under `sound/direct_sound_samples/` (cries in `cries/`),
  one channel, 8 bit as the console plays them, listed in `sound/direct_sound_data.inc`.
- **Where a song plays**: the `"music"` line of a map's `map.json`, and `playbgm`, `playse`,
  `playfanfare` in scripts and code.

## The commands
| Do | Command |
|---|---|
| List | `kit music` (songs and effects), `kit music --kind sample`, `--kind cry`, `--yours` (changed since the game folder's first commit), `--json` |
| Hear | `kit music play <name>` on this computer, or `kit music render <name> --out file.wav`. Songs and effects are **recorded from the built game** by the headless emulator, so they are the game's own instruments as of the last `kit build`; samples and cries are the files themselves **[run]** |
| Find | `kit music where <name>`: the maps whose music it is and every script or code line that names it; for a sample, the voice groups and songs that use it |
| Replace | `kit music replace <name> <file.mid or .wav> [--voicegroup g] [--volume n] [--keep-loop] [--rate n]`, then `kit build` **[run]** |

The user can do all of it without you in the pane's **Music** tab: a Play button per row, a search
box, a "yours" mark, and a place on each row to choose or drop a file. That runs the same check
as `kit music replace`. To ask the user for a file, say which row: "Open the Music tab, search
for `harbour`, and drop your .mid on its row." Then `kit music --yours` shows it arrived.

## What a replacement must be
- **A song or effect takes a `.mid`** (format 0 or 1, ticks per beat). A recording cannot stand
  in for a song; the kit refuses and says so.
- **Parts**: one part per track-and-channel that plays notes. The music player has a fixed number
  of tracks (the kit prints it; 10 on the engine tried) and effect players fewer. More parts than
  tracks is refused, because the extra ones would be silent (`--force` accepts that).
- **Loop**: markers named `[` and `]` in the first track are where the song repeats. Without them
  it plays once and then there is silence. `--keep-loop` repeats the whole file when it has no
  markers and the old song had.
- **Instruments**: the program numbers in the file pick slots in the voice group. The song keeps
  the old song's voice group unless `--voicegroup` names another; the kit prints the numbers
  used. A file made for other instruments will play, on whatever is in those slots: listen.
- **A sample or cry takes a `.wav`**, one channel. Anything else (stereo, 16 bit, another rate,
  an `.mp3`) is converted when `ffmpeg` is installed, to the rate of the sample it replaces
  (`--rate n` keeps more, at one byte per sample). A sample that looped: set loop points in the
  file, or `--keep-loop` to repeat the whole of it.
- The kit converts the file aside with the tree's own tools first and **refuses with the reason**
  if they fail, so a kept replacement builds. It prints the size before and after.

## The loop
1. `kit music where <name>` so you and the user know where to go and hear it.
2. `kit music replace ...`; read every line it prints to the user in plain words.
3. `kit build`, then `kit music render <name>` (or the pane) to hear the new one, then
   `kit shot --at <the map>` so the user can walk in and listen in the player.
4. `kit note` what changed; `kit keep` when the user says it is right.

Undo: the previous file is in git; the kit prints the exact command. A file that had changes not
kept yet is copied to `out/music/replaced/` first.

## What this cannot do
- **No generation**: no notes, no samples, no "make it sound like". Ask the user for a file.
- **No by-ear check**: you cannot hear. Say what you measured (length, that it is not silent) and
  ask the user to listen. Never say "it sounds right".
- The recording is of the **last build**: after a replace it is the old sound until `kit build`.
- Songs with no MIDI file (written by hand, or empty slots) are listed but cannot be replaced.
- A brand-new song number, a new voice group, the small waveform files
  (`sound/programmable_wave_samples/`) and editing a voice group's slots are not covered
  **[not run]**: they are hand edits of the files named above.
