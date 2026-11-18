// kit/plugin.ts: put ROM Studio into Hermes, and take it out again, with one command each.
//   kit plugin install [--game <folder>] [--home <hermes home>] [--pane-url <address>] [--port <n>]
//   kit plugin uninstall [--home <hermes home>]
//   kit plugin status [--home <hermes home>]
// Install links this checkout into the Hermes home (a link, so the plugin starts the pane from this
// checkout), saves the game folder in Hermes's own settings for the plugin (config.yaml, never .env), and switches the
// plugin on. Uninstall takes out exactly that: the link, the settings and the switch. A ROM Studio that was installed
// another way (a folder from the catalog or GitHub) is never touched.
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { childEnv } from "./env";

export const PLUGIN_HELP = `kit plugin install [--game <folder>] [--home <hermes home>] [--pane-url <address>] [--port <n>]   put ROM Studio into
                             Hermes: links this checkout in, saves the game folder in the plugin's settings and switches it on. The pane
                             then shows in the desktop app and in the web dashboard (kit plugin help says where)
  kit plugin uninstall [--home <hermes home>]   take it out again: the link, its settings and the switch. Nothing else
  kit plugin status [--home <hermes home>]      linked or not, switched on or not, the game folder, and what the pane says now`;

const ID = "rom-studio";
const MORE = `After installing:
  Desktop app: Capabilities, Plugins, ROM Studio: switch it on (its desktop part starts off). The pane opens on the right;
    the sidebar has a ROM Studio row too. Settings, Plugins, rom-studio holds the game folder, a pane address and the port.
  Web dashboard (hermes dashboard): the ROM Studio tab.
  The agent: the skill rom-studio:make-your-game is offered while the plugin is on.`;

type Out = { ok: boolean; out: string };
function hermesBin(): string | null {
  return Bun.which("hermes") ?? [join(homedir(), ".local/bin/hermes")].find((p) => existsSync(p)) ?? null;
}

export function pluginCommand(repo: string, game: string, args: string[]): number {
  const opt = (name: string) => { const i = args.indexOf(`--${name}`); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const sub = args.shift() ?? "help";
  const home = resolve(opt("home") ?? process.env.HERMES_HOME ?? join(homedir(), ".hermes"));
  const paneUrl = opt("pane-url"), port = opt("port");
  const source = repo, link = join(home, "plugins", ID);
  const hermes = hermesBin();
  const run = (...a: string[]): Out => {
    const r = Bun.spawnSync([hermes!, ...a], { env: childEnv({ HERMES_HOME: home }), stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 600_000 });
    return { ok: r.exitCode === 0, out: (r.stdout.toString() + r.stderr.toString()).trim() };
  };
  const say = (line: string) => console.log(line);
  const fail = (line: string) => { console.error(line); return 1; };
  const what = (): "none" | "ours" | "other-link" | "folder" => {
    let st; try { st = lstatSync(link); } catch { return "none"; }
    if (!st.isSymbolicLink()) return "folder";
    try { return realpathSync(link) === realpathSync(source) ? "ours" : "other-link"; } catch { return "other-link"; }
  };
  const setting = (key: string, value: string) => run("config", "set", `plugins.entries.${ID}.settings.${key}`, value);

  if (sub === "help" || sub === "--help") { say(`${PLUGIN_HELP}\n\n${MORE}`); return 0; }
  if (!["install", "uninstall", "status"].includes(sub)) return fail(`kit plugin: no "${sub}". Use install, uninstall or status.`);
  if (!hermes) return fail("Hermes is not installed on this computer (no hermes command). Install it first: https://hermes-agent.nousresearch.com/docs");
  if (port !== undefined && !(Number.isInteger(Number(port)) && Number(port) > 0 && Number(port) < 65536)) return fail(`--port needs a port number (1 to 65535), not "${port}".`);
  if (paneUrl !== undefined && !/^https?:\/\/[^\s]+$/.test(paneUrl)) return fail(`--pane-url needs an address that starts with http:// or https://, not "${paneUrl}".`);

  if (sub === "status") {
    const state = what();
    say(`Hermes home: ${home}`);
    say(state === "ours" ? `Plugin: linked to ${source}` : state === "none" ? "Plugin: not installed (kit plugin install puts it in)"
      : state === "folder" ? `Plugin: a ROM Studio folder installed another way, at ${link}` : `Plugin: a link to another folder, ${readlinkSync(link)}`);
    const enabled = run("config", "get", "plugins.enabled");
    if (enabled.ok) say(`Switched on in Hermes: ${new RegExp(`(^|[\\s'"\\[,-])${ID}([\\s'"\\],]|$)`, "m").test(enabled.out) ? "yes" : "no"}`);
    const chosen = run("config", "get", `plugins.entries.${ID}.settings.game_folder`);
    say(`Game folder: ${chosen.ok && chosen.out && !/not set|none|null/i.test(chosen.out) ? chosen.out : "not set"}`);
    try { const s = JSON.parse(readFileSync(join(home, "plugin-data", ID, "status.json"), "utf8")); say(`The pane says: ${s.message}`); } catch { say("The pane says: nothing yet (it speaks once Hermes has loaded the plugin)."); }
    return 0;
  }

  if (sub === "install") {
    if (!existsSync(join(source, "plugin.yaml"))) return fail(`This checkout has no plugin at ${source}.`);
    const state = what();
    if (state === "folder") return fail(`There is already a ROM Studio installed at ${link}, as a folder (from the plugin catalog or GitHub), not a link.\nIt is left as it is. To use this checkout instead, first run: hermes plugins remove ${ID}   then this again.`);
    mkdirSync(join(home, "plugins"), { recursive: true });
    if (state === "other-link") { say(`Replacing the link to ${readlinkSync(link)}.`); unlinkSync(link); }
    if (state !== "ours") symlinkSync(source, link);
    say(`Linked ${link} -> ${source}`);
    if (!existsSync(game)) say(`Note: there is no game folder at ${game} yet. The pane says so until there is one: make one with kit setup, or choose another with --game.`);
    for (const [key, value] of [["game_folder", game], ["pane_url", paneUrl], ["pane_port", port]] as const) {
      if (value === undefined) continue;
      const r = setting(key, value);
      if (!r.ok) return fail(`Hermes did not save the ${key.replace("_", " ")} setting:\n${r.out}`);
    }
    say(`Game folder saved in Hermes's settings for the plugin: ${game}`);
    const on = run("plugins", "enable", ID);
    if (!on.ok) return fail(`Hermes did not switch the plugin on:\n${on.out}`);
    say(`Switched on in Hermes (${home}).\n\n${MORE}`);
    return 0;
  }

  // uninstall
  const state = what();
  if (state === "folder") return fail(`The ROM Studio at ${link} is a folder installed another way (the catalog or GitHub), not this checkout's link.\nIt is left as it is. To remove it: hermes plugins remove ${ID}`);
  if (state === "none") {
    say("The plugin is not linked in; taking out its settings only.");
    run("config", "unset", `plugins.entries.${ID}`);
  } else {
    // for a link Hermes takes out the link only, never the folder it points to, and forgets the plugin's switch and settings
    const r = run("plugins", "remove", ID);
    if (!r.ok) { if (lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(link); run("config", "unset", `plugins.entries.${ID}`); }
    say(`Took out the link ${link}, the plugin's settings and its switch`);
  }
  // the desktop app's copy of the desktop half, only when it is this package's (the app also drops it on its next start)
  const copy = join(home, "desktop-plugins", ID);
  try {
    const marker = JSON.parse(readFileSync(join(copy, ".hermes-package.json"), "utf8"));
    if (marker.package === ID && typeof marker.source === "string" && (marker.source.startsWith(source) || marker.source.startsWith(link))) { rmSync(copy, { recursive: true, force: true }); say(`Took out the desktop app's copy ${copy}`); }
  } catch {}
  say("ROM Studio is out of Hermes. The game folder and this checkout are as they were.");
  return 0;
}
