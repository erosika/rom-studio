# Changelog

## 0.1.0

The first version packaged for the Hermes plugin catalog.

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
