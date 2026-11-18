// kit/plugin.test.ts: kit plugin install / uninstall / status against a stand-in `hermes` command that records what it
// was asked and keeps a tiny config, in a scratch Hermes home. (The real Hermes run is in docs/HERMES.md.)
import { afterAll, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, ".."), KIT = join(REPO, "kit/kit.ts"), PLUGIN = REPO;
const scratch = mkdtempSync(join(tmpdir(), "kit-plugin-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const bin = join(scratch, "bin"), game = join(scratch, "my-game");
mkdirSync(bin); mkdirSync(game);
// the stand-in: every call is one line in $HERMES_HOME/calls.txt; "plugins enable/remove" and "config set/get/unset"
// keep their effect in plain files, and "plugins remove" on a link takes out the link only, as Hermes does
writeFileSync(join(bin, "hermes"), `#!/bin/bash
echo "$*" >> "$HERMES_HOME/calls.txt"
case "$1 $2" in
  "plugins enable") echo "$3" >> "$HERMES_HOME/enabled.txt" ;;
  "plugins remove") [ -L "$HERMES_HOME/plugins/$3" ] && rm "$HERMES_HOME/plugins/$3"; rm -f "$HERMES_HOME/enabled.txt" "$HERMES_HOME/settings.txt" ;;
  "config set") echo "$3=$4" >> "$HERMES_HOME/settings.txt" ;;
  "config unset") rm -f "$HERMES_HOME/settings.txt" ;;
  "config get") if [ "$3" = plugins.enabled ]; then cat "$HERMES_HOME/enabled.txt" 2>/dev/null | sed 's/^/- /'; else grep "^$3=" "$HERMES_HOME/settings.txt" 2>/dev/null | tail -1 | cut -d= -f2-; fi ;;
esac
`);
chmodSync(join(bin, "hermes"), 0o755);

function kit(args: string[], o: { path?: string } = {}) {
  const r = Bun.spawnSync([process.execPath, KIT, "plugin", ...args], { env: { PATH: o.path ?? `${bin}:${join(process.execPath, "..")}:/usr/bin:/bin`, HOME: scratch, LANG: "C.UTF-8" }, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}
const newHome = () => mkdtempSync(join(scratch, "home-"));
const calls = (home: string) => (existsSync(join(home, "calls.txt")) ? readFileSync(join(home, "calls.txt"), "utf8").trim().split("\n") : []);

test("install: one command links the checkout in, saves the game folder in Hermes's plugin settings (no .env) and switches it on", () => {
  const home = newHome(), r = kit(["install", "--home", home, "--game", game]);
  expect(r.code).toBe(0);
  const link = join(home, "plugins/rom-studio");
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  expect(readlinkSync(link)).toBe(PLUGIN);
  expect(calls(home)).toEqual([`config set plugins.entries.rom-studio.settings.game_folder ${game}`, "plugins enable rom-studio"]);
  expect(existsSync(join(home, ".env"))).toBe(false);
  expect(r.out).toContain("Capabilities, Plugins, ROM Studio: switch it on");
  expect(kit(["install", "--home", home, "--game", game]).code).toBe(0); // again: same link, nothing doubled on disk
  expect(readlinkSync(link)).toBe(PLUGIN);
});

test("install: the pane address and port are saved too, and wrong ones are refused with a sentence", () => {
  const home = newHome();
  expect(kit(["install", "--home", home, "--game", game, "--port", "8790", "--pane-url", "http://192.168.1.4:8778/k/abc/"]).code).toBe(0);
  expect(calls(home)).toContain("config set plugins.entries.rom-studio.settings.pane_port 8790");
  const badPort = kit(["install", "--home", newHome(), "--port", "eighty"]), badUrl = kit(["install", "--home", newHome(), "--pane-url", "ftp://x"]);
  expect(badPort.code).toBe(1); expect(badPort.out).toContain("--port needs a port number");
  expect(badUrl.code).toBe(1); expect(badUrl.out).toContain("http:// or https://");
});

test("install: a ROM Studio installed another way (a folder) is left alone; an old link elsewhere is replaced", () => {
  const home = newHome(), folder = join(home, "plugins/rom-studio");
  mkdirSync(folder, { recursive: true }); writeFileSync(join(folder, "plugin.yaml"), "name: rom-studio\n");
  const r = kit(["install", "--home", home, "--game", game]);
  expect(r.code).toBe(1);
  expect(r.out).toContain("hermes plugins remove rom-studio");
  expect(readFileSync(join(folder, "plugin.yaml"), "utf8")).toBe("name: rom-studio\n");
  expect(calls(home)).toEqual([]);
  const other = newHome(); mkdirSync(join(other, "plugins"));
  symlinkSync(join(scratch, "old-checkout/plugin"), join(other, "plugins/rom-studio"));
  const again = kit(["install", "--home", other, "--game", game]);
  expect(again.code).toBe(0); expect(again.out).toContain("Replacing the link");
  expect(readlinkSync(join(other, "plugins/rom-studio"))).toBe(PLUGIN);
});

test("uninstall: the link, the settings and the switch go; the checkout and a foreign desktop copy stay", () => {
  const home = newHome();
  kit(["install", "--home", home, "--game", game]);
  const ours = join(home, "desktop-plugins/rom-studio");
  mkdirSync(ours, { recursive: true }); writeFileSync(join(ours, ".hermes-package.json"), JSON.stringify({ package: "rom-studio", source: join(home, "plugins/rom-studio/desktop"), linked: true }));
  const r = kit(["uninstall", "--home", home]);
  expect(r.code).toBe(0);
  expect(existsSync(join(home, "plugins/rom-studio"))).toBe(false);
  expect(existsSync(join(PLUGIN, "plugin.yaml"))).toBe(true);
  expect(existsSync(ours)).toBe(false);
  expect(calls(home)).toContain("plugins remove rom-studio");
  expect(existsSync(join(home, "settings.txt"))).toBe(false);
  const other = newHome(), foreign = join(other, "desktop-plugins/rom-studio");
  mkdirSync(foreign, { recursive: true }); writeFileSync(join(foreign, ".hermes-package.json"), JSON.stringify({ package: "rom-studio", source: "/somewhere/else/desktop" }));
  expect(kit(["uninstall", "--home", other]).code).toBe(0);
  expect(existsSync(foreign)).toBe(true);
});

test("uninstall: a folder installed another way is refused, and kept", () => {
  const home = newHome(), folder = join(home, "plugins/rom-studio");
  mkdirSync(folder, { recursive: true });
  const r = kit(["uninstall", "--home", home]);
  expect(r.code).toBe(1);
  expect(existsSync(folder)).toBe(true);
  expect(calls(home)).toEqual([]);
});

test("status: linked, switched on, the game folder, and the pane's own sentence", () => {
  const home = newHome();
  kit(["install", "--home", home, "--game", game]);
  mkdirSync(join(home, "plugin-data/rom-studio"), { recursive: true });
  writeFileSync(join(home, "plugin-data/rom-studio/status.json"), JSON.stringify({ state: "running", message: `The ROM Studio page for ${game} is open.` }));
  const r = kit(["status", "--home", home]);
  expect(r.code).toBe(0);
  expect(r.out).toContain(`Plugin: linked to ${PLUGIN}`);
  expect(r.out).toContain("Switched on in Hermes: yes");
  expect(r.out).toContain(`Game folder: ${game}`);
  expect(r.out).toContain("The pane says: The ROM Studio page for");
});

test("no Hermes on this computer: a plain sentence, nothing written", () => {
  const home = newHome(), r = kit(["install", "--home", home, "--game", game], { path: `${join(process.execPath, "..")}:/usr/bin:/bin` });
  expect(r.code).toBe(1);
  expect(r.out).toContain("Hermes is not installed");
  expect(existsSync(join(home, "plugins"))).toBe(false);
});
