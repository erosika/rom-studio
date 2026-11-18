# rom-studio 0.3.0

Bumps `plugin-catalog/rom-studio.yaml` to 0.3.0 and re-pins `sha`. I am the owner of the plugin's repository.

## What changed since 0.2.0

- **Less surface.** The in-game agent link is out of the player: `player/hermes-link.js`,
  `GET /hermes/info`, `POST /hermes/ask` and the `hermes_*` game settings are gone, so nothing in
  the package runs `hermes` any more. The description and the known issues drop those sentences.
- **Settings without a restart.** The agent half reads `game_folder`, `pane_url` and `pane_port`
  again every ten seconds (`ctx.get_config`), and restarts or stops its page to match.
- **The page's lifetime.** Still one background process, `bun pane/server.ts`, on 127.0.0.1 only,
  started only once a game folder is set. New: it is started again if it stops, and it is given a
  pipe only the agent half holds (`--until-stdin-closes`), so it also stops when Hermes is killed
  outright. Its output goes to `pane.log` in `plugin_data_dir`, with any key hidden; what the pane
  says now is `status.json` beside it. Children still get a short list of variables by name,
  never the host's environment.
- **Dashboard.** The route `GET /api/plugins/rom-studio/where` now answers a state and a sentence
  as well as the address, and the dashboard tab is shown (`tab.path` `/rom-studio`, icon `Cpu`).
- **Desktop half.** Adds `SIDEBAR_NAV_AREA` (when the app has it), `host.navigate` to the plugin's
  own settings and `ctx.os.openExternal` for "Open in browser". The iframe sandbox is unchanged.
- **Not Hermes surfaces:** a new look for the page with two bundled typefaces (SIL OFL 1.1, their
  licences beside them; the page still loads nothing from outside), `kit plugin install | uninstall
  | status` for a linked checkout, `kit pixel` and `kit codes`.

No new tools, hooks, middleware, env vars or downloads. `requires_hermes` stays `>=0.21.6`; every
surface above is present in that tag. Run on 0.23 only: `hermes plugins validate` and `doctor`
pass, the web dashboard tab and the desktop workspace (`hermes webapp`) were seen on Linux.
