// pane/map.test.ts: the pane asks the kit for a whole-map picture with a named output file, kept in the
// pane's data folder (not the game), and serves it. The kit is replaced by a stand-in that behaves like
// `kit map` (it refuses a bare --png). Run: bun test pane/map.test.ts
import { afterAll, beforeAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 8890 + Math.floor(Math.random() * 100), URL_ = `http://127.0.0.1:${PORT}`;
const root = mkdtempSync(join(tmpdir(), "pane-map-")), game = join(root, "game"), data = join(root, "data"), calls = join(root, "calls.txt");
let server: ReturnType<typeof Bun.spawn>;
const PNG = "\x89PNG\r\n\x1a\nstand-in";

beforeAll(async () => {
  const here = import.meta.dir, kit = join(here, "../kit");
  cpSync(here, join(root, "pane"), { recursive: true, filter: (f) => !f.includes("/sample") });
  cpSync(kit, join(root, "kit"), { recursive: true, filter: (f) => !f.endsWith("/kit.ts") && !f.includes("/emu") });
  writeFileSync(join(root, "kit/kit.ts"), `import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"; import { dirname } from "node:path";
const a = process.argv.slice(2); appendFileSync(${JSON.stringify(calls)}, a.join(" ") + "\\n");
if (a[0] !== "map") process.exit(1);
const i = a.indexOf("--png"), out = a[i + 1];
if (i < 0 || !out || out.startsWith("--")) { console.error("--png needs a value. See: kit help"); process.exit(1); }
mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, ${JSON.stringify(PNG)});
console.log("map picture: " + out + " (16x16)\\nFoo: 1x1 squares, tilesets a + b");`);
  mkdirSync(game, { recursive: true }); writeFileSync(join(game, "game.md"), "# Test\n"); writeFileSync(join(game, "Makefile"), "");
  const g = (...a: string[]) => Bun.spawnSync(["git", "-C", game, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);
  g("init", "-q"); g("add", "."); g("commit", "-qm", "engine"); // the map below is added after the engine's first commit
  mkdirSync(join(game, "data/maps/Foo"), { recursive: true }); mkdirSync(join(game, "data/layouts/Foo"), { recursive: true });
  writeFileSync(join(game, "data/maps/Foo/map.json"), JSON.stringify({ name: "Foo", layout: "LAYOUT_FOO", object_events: [], warp_events: [], connections: [] }));
  writeFileSync(join(game, "data/layouts/layouts.json"), JSON.stringify({ layouts: [{ id: "LAYOUT_FOO", name: "Foo_Layout", width: 1, height: 1, blockdata_filepath: "data/layouts/Foo/map.bin" }] }));
  writeFileSync(join(game, "data/layouts/Foo/map.bin"), Buffer.from([1, 0]));
  server = Bun.spawn(["bun", join(root, "pane/server.ts"), "--game", game, "--port", String(PORT), "--data", data], { stdout: "ignore", stderr: "inherit" });
  for (let i = 0; i < 50; i++) { try { await fetch(URL_); return; } catch { await Bun.sleep(100); } }
});
afterAll(() => { server?.kill(); rmSync(root, { recursive: true, force: true }); });

test("a made map's picture is the kit's render, written to the pane data folder and served", async () => {
  const s = await (await fetch(`${URL_}/state`)).json();
  expect(s.maps.map((m: { name: string }) => m.name)).toContain("Foo");
  const r = await fetch(`${URL_}/map/Foo`);
  expect(r.status).toBe(200);
  expect(await r.text()).toBe(PNG);
  const asked = readFileSync(calls, "utf8").split("\n").find((l) => l.startsWith("map Foo"))!;
  expect(asked).toContain(`--png ${join(data, "maps", "Foo.png")}`);
  expect(existsSync(join(game, "shots"))).toBe(false); // nothing written into the game for a preview
  // asked once: the answer is kept until the map's files change
  await fetch(`${URL_}/map/Foo`);
  expect(readFileSync(calls, "utf8").split("\n").filter((l) => l.startsWith("map Foo")).length).toBe(1);
});
