# Changelog

## 0.2.0

- **An agent plays the game.** `kit agent-play` lets an agent play the built game a step at a time:
  your own agent as a command (it gets a short list of variables, no keys), or a model by its key
  (`--provider anthropic|openai`; the game's pictures and text go to that API and nowhere else).
  Caps on steps and time, a save that carries on, a log with every picture, and a read-only page
  to watch on behind the flash guard. Not served over MCP.
- **Player.** Save and load under the picture (a save point and the game's own save, kept per
  game, with export and import, and what survives a rebuild said plainly); a text line that types
  into the game's naming screen on a phone; a pace line and low power; plain messages for a
  missing game, a lost connection, a newer build and a browser that lacks something; it carries on
  after the tab sleeps. A page that an older running player cannot serve says so, and `kit play`
  starts a fresh player.
- **Pane.** Send note saves a note on its own, neither "looks right" nor "needs work"; a note waits
  for the agent like "needs work", and `kit reviews --open` lists it as NOTE.
- **Patch.** `kit patch` also refuses when the built game was made with private scenes on, or
  before that setting last changed.

## 0.1.0

The first version packaged for the Hermes plugin catalog.

- **After review.** Every program the plugin and the kit start now gets a short list of variables
  by name (`kit/env.ts`), never the host's environment, so no provider key reaches the pane, the
  build, a decomp's Makefile or the emulator; `kit/build.sh` clears its own environment before
  `make`. The in-game link runs `hermes` only: a `hermes_command` in `settings.json` that names
  another program is ignored unless the user names it in `ROM_STUDIO_HERMES_COMMAND`.

- **Plugin.** The repository root is the plugin. Its agent half starts the pane for the game
  folder you set, on 127.0.0.1, watches the feed and tells the desktop pane when it changes, and
  stops the pane when the plugin is unloaded. The desktop half shows the pane on the right and at
  `/rom-studio`. One backend route says where the pane is. The plugin registers no tools or hooks.
- **Settings.** `game_folder`, `pane_url` and `pane_port` are declared in the manifest and set in
  Hermes's own settings; `ROM_STUDIO_GAME`, `ROM_STUDIO_PANE_URL` and `ROM_STUDIO_PANE_PORT` are
  fallbacks read from the process environment. No `.env` file is read.
- **Kit.** 26 commands: set a game up from a decomp you supply, build it, play it, take pictures
  from the running game, press buttons, draw maps, redraw tilesets, search the source, read every line a player can read (with the notes you left on them), hear and
  replace music, keep a lore index, write the feed, read the user's answers, keep and undo
  scenes, and make a patch that checks itself. The same commands are served as MCP tools.
- **Pane.** Ten tabs: Now (feed, play link, scene list), Gallery, Scenes, Maps, Music, Dialogue
  (every line by place, with a note on any text for your agent), Source,
  Lore, Decisions and Settings.
- **Look.** The first screen is a large picture with the review beside it and the scene list below. Inside
  the desktop app the pane takes the app's own colours, light or dark mode and font (sent to the pane's
  address only); opened on its own it keeps its own dark and light choice.
- **Player.** The built game in a browser with touch controls, a flash guard that is always on,
  and a phone link over https with a key. A game built with the optional base can also reach your
  own agent from its START menu (default conversation `rom-studio-game`).
- **Who may ask.** The pane and the player answer only under this computer's own names (plus
  `ROM_STUDIO_HOSTS`), refuse pages on other sites, limit every upload, and send a content policy.
  From another device the pane needs the key in its link.
- **Not shipped.** The optional base (patches for one engine version) is not in this repository;
  `kit setup` says so and goes on.
- **Skill.** `make-your-game`: thirteen scenes, twelve of them written.
- **Kit care.** Setup takes a git address only in four plain forms; the redraw tools answer a
  broken JSON file with a sentence; the saved starts of old builds are capped at eight.
- **Setup pins.** The script compiler download is checked against a sha256, the browser emulator
  installs from the lockfile only, and the emulator library's build line checks its commit.
- **Removed.** The old picture page (`kit/gallery.py`), which listened on every address.
