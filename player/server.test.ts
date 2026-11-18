// player/server.test.ts: the player's own routes against a made-up game folder: who may ask for what. Run: bun test player
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const game = mkdtempSync(join(tmpdir(), "player-test-")), KEY = "k".repeat(32);
let local: (req: Request) => Promise<Response>, far: (req: Request) => Promise<Response>, pane: ReturnType<typeof Bun.serve>;
const logLine = (h: typeof local, headers: Record<string, string> = {}, host = "127.0.0.1:4870") =>
  h(new Request(`http://${host}/log`, { method: "POST", headers: { host, ...headers }, body: "hello" }));

beforeAll(async () => {
  mkdirSync(join(game, "out")); writeFileSync(join(game, "out/game.gba"), "not a real game"); writeFileSync(join(game, "out/game.sym"), "02000000 00000004 B gStudioMailbox\n"); writeFileSync(join(game, "charmap.txt"), "'A' = BB\n");
  pane = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req) => Response.json({ path: new URL(req.url).pathname, host: req.headers.get("host"), origin: req.headers.get("origin") }) });
  Object.assign(process.env, { ROM: join(game, "out/game.gba"), GAME: game, ROM_STUDIO_PANE_LOCAL: `http://127.0.0.1:${pane.port}` });
  const { handler } = await import("./server"); local = handler(null); far = handler(KEY, "10.0.0.7");
});
afterAll(() => { pane.stop(true); rmSync(game, { recursive: true, force: true }); });

test("a page on another site cannot reach the game, the log or the pane; a name pointed at this computer is not answered", async () => {
  expect((await logLine(local, { origin: "http://elsewhere.example" })).status).toBe(403);
  expect((await logLine(local, { "sec-fetch-site": "cross-site" })).status).toBe(403);
  expect((await logLine(local, { "sec-fetch-site": "same-site" })).status).toBe(403);
  expect((await logLine(local, {}, "elsewhere.example")).status).toBe(403);
  expect((await logLine(local)).status).toBe(200);
  const get = (path: string, headers: Record<string, string> = {}, h = local, host = "127.0.0.1:4870") => h(new Request(`http://${host}${path}`, { headers: { host, ...headers } }));
  for (const path of ["/rom", "/game", "/pane/state"]) expect((await get(path, { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors" })).status).toBe(403);
  expect((await get("/pane/music/play/x", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" })).status).toBe(403);
  expect((await get("/rom", {}, local, "elsewhere.example:4870")).status).toBe(403);
  expect((await get("/rom")).status).toBe(200); expect((await get("/rom")).headers.get("access-control-allow-origin")).toBeNull();
  for (const path of ["/..%2Fserver.ts", "/mgba/..%2F..%2Fpackage.json", "/play.js/../server.ts", "/rom/../settings.json"]) expect((await get(path)).status).toBe(404); // only the named files are served
});

test("the pane is passed on only from this computer's own address, to the one configured place, as this computer", async () => {
  const get = (h: typeof local, path: string, host: string, headers: Record<string, string> = {}) => h(new Request(`http://${host}${path}`, { headers: { host, ...headers } }));
  const seen = await (await get(local, "/pane//elsewhere.example/state", "127.0.0.1:4870", { origin: "http://127.0.0.1:4870", cookie: "a=b" })).json();
  expect(seen).toMatchObject({ host: `127.0.0.1:${pane.port}`, origin: null }); expect(seen.path).toEndWith("elsewhere.example/state"); // still the local pane, whatever the path says
  for (const path of ["/pane", "/pane/", "/pane/state"]) expect((await get(far, path, "10.0.0.7:4871", { "x-key": KEY })).status).toBe(404); // not on the network side, key or no key
});

test("over the network every route that serves the game needs the key", async () => {
  const host = "10.0.0.7:4871", req = (path: string, key?: string, method = "GET") => far(new Request(`https://${host}${path}`, { method, headers: { host, "content-type": "application/json", ...(key ? { "x-key": key } : {}) }, body: method === "POST" ? JSON.stringify({ text: "hi" }) : undefined }));
  for (const [path, method] of [["/rom", "GET"], ["/game", "GET"], ["/log", "POST"]] as const) {
    expect(`${path} ${(await req(path, undefined, method)).status}`).toBe(`${path} 401`);
    expect(`${path} ${(await req(path, "k".repeat(31) + "x", method)).status}`).toBe(`${path} 401`);
    expect(`${path} ${(await req(path, KEY, method)).status}`).toBe(`${path} 200`);
  }
  expect((await req("/", undefined)).status).toBe(200); // the page itself, which then asks for the rest with the key
  expect((await far(new Request("https://elsewhere.example/rom", { headers: { host: "elsewhere.example", "x-key": KEY } }))).status).toBe(403);
});

test("the page is told which game and build this is without being told where it lives, and where the naming screen keeps its text", async () => {
  const get = async () => (await local(new Request("http://127.0.0.1:4870/game", { headers: { host: "127.0.0.1:4870" } }))).json();
  const first = await get();
  expect(first.id).toMatch(/^[0-9a-f]{12}$/); expect(JSON.stringify(first)).not.toContain(game); // a name for its saves that gives away no folder
  expect(first.build).toBeString(); expect(first.naming).toBeNull(); expect(first.chars).toEqual({ A: 0xbb });
  mkdirSync(join(game, "src"), { recursive: true }); writeFileSync(join(game, "src/naming_screen.c"), "struct NamingScreenData\n{\n    u8 tilemapBuffer1[0x800];\n    u8 textBuffer[16];\n    u8 state;\n};\n");
  writeFileSync(join(game, "out/game.sym"), "02000000 00000004 B gStudioMailbox\n02031314 00000004 b sNamingScreen\n");
  expect((await get()).naming).toBeNull(); // asked every few seconds: the game folder is read again only after a rebuild
  await Bun.sleep(20); writeFileSync(join(game, "out/game.gba"), "a newer build of the game");
  const second = await get();
  expect(second.id).toBe(first.id); expect(second.build).not.toBe(first.build); expect(second.naming).toEqual({ at: 0x02031314, text: 0x800 });
  rmSync(join(game, "out/game.gba")); expect((await get()).build).toBeNull(); // nothing built: the page waits and says so
  for (const f of ["/hermes-link.js", "/hermes/info"]) expect((await local(new Request(`http://127.0.0.1:4870${f}`, { headers: { host: "127.0.0.1:4870" } }))).status).toBe(404); // the Hermes link is not in this player
  for (const f of ["/ram.js", "/checks.js", "/play.js", "/guard.js"]) expect((await local(new Request(`http://127.0.0.1:4870${f}`, { headers: { host: "127.0.0.1:4870" } }))).status).toBe(200);
  writeFileSync(join(game, "out/game.gba"), "not a real game");
});
