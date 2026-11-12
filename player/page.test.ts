// player/page.test.ts: the play page in a real headless browser, at a phone's size and a desk's, against a game folder
// with no built game in it: what it says while it waits, where the save controls are, and the flash guard measured on
// the visible screen. Local pages only, so it runs with --no-sandbox. Run: bun test player/page   (CHROME=<path to a headless Chrome>; skipped when none)
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
setDefaultTimeout(40_000);
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childEnv } from "../kit/env";

const CHROME = process.env.CHROME ?? "";
const have = existsSync(CHROME) && existsSync(join(import.meta.dir, "node_modules/@thenick775/mgba-wasm/dist/mgba.js"));
const PORT = 5890 + Math.floor(Math.random() * 100), CDP = 9590 + Math.floor(Math.random() * 100), URL_ = `http://127.0.0.1:${PORT}/`;
const game = mkdtempSync(join(tmpdir(), "player-page-")), profile = mkdtempSync(join(tmpdir(), "player-page-chrome-"));
let server: ReturnType<typeof Bun.spawn>, chrome: ReturnType<typeof Bun.spawn>, sock: WebSocket, next = 0;
const pending = new Map<number, (d: any) => void>();
const send = (method: string, params: object = {}) => new Promise<any>((done) => { const id = ++next; pending.set(id, done); sock.send(JSON.stringify({ id, method, params })); });
const run = async (expression: string) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const status = () => run(`document.getElementById('status').textContent`);
async function open(width: number, height: number, query = "") {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await send("Page.navigate", { url: URL_ + query });
  for (let i = 0; i < 100; i++) { if (await run(`location.search === ${JSON.stringify(query)} && !!document.getElementById('status') && document.getElementById('status').textContent !== 'loading'`)) return; await Bun.sleep(100); }
}

beforeAll(async () => {
  if (!have) return;
  mkdirSync(join(game, "out"));
  server = Bun.spawn(["bun", join(import.meta.dir, "server.ts")], { env: childEnv({ PORT: String(PORT), ROM: join(game, "out/game.gba"), GAME: game }), stdout: "ignore", stderr: "ignore" });
  chrome = Bun.spawn([CHROME, "--headless", `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, "--no-sandbox", "--no-first-run", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars", "--remote-allow-origins=*", "about:blank"], { env: childEnv(), stdout: "ignore", stderr: "ignore" });
  let ws = "";
  for (let i = 0; i < 80 && !ws; i++) { try { ws = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`, { signal: AbortSignal.timeout(1000) })).json()).find((t: any) => t.type === "page")?.webSocketDebuggerUrl ?? ""; } catch {} if (!ws) await Bun.sleep(100); }
  for (let i = 0; i < 50; i++) { try { await fetch(URL_); break; } catch { await Bun.sleep(100); } }
  sock = new WebSocket(ws);
  sock.onmessage = (m) => { const d = JSON.parse(String(m.data)); pending.get(d.id)?.(d); pending.delete(d.id); };
  await new Promise((done) => { sock.onopen = done; });
}, 40_000);
afterAll(() => { sock?.close(); chrome?.kill(); server?.kill(); for (const d of [game, profile]) rmSync(d, { recursive: true, force: true }); });

for (const [name, w, h] of [["phone", 390, 844], ["desk", 1280, 800]] as const) {
  test.skipIf(!have)(`${name}: with no built game the page says so and waits; save and load sit under the picture; nothing moves or scrolls sideways`, async () => {
    await open(w, h, `?at=${name}`);
    expect(await status()).toStartWith("No built game on the computer yet.");
    expect(await run(`document.documentElement.scrollWidth`)).toBeLessThanOrEqual(w);
    expect(await run(`document.getAnimations().length`)).toBe(0);
    const at = await run(`(() => { const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: b.height }; }; return { screen: document.querySelector('.screen').getBoundingClientRect().bottom, save: r('pointSave'), load: r('pointLoad'), more: r('more'), pad: r('pad') }; })()`);
    for (const b of [at.save, at.load, at.more]) { expect(b.top).toBeGreaterThanOrEqual(at.screen); expect(b.bottom).toBeLessThanOrEqual(at.pad.top); expect(b.h).toBeGreaterThanOrEqual(44); } // between the picture and the pad, big enough for a thumb
    expect(at.pad.bottom, "the whole pad is on the first screen").toBeLessThanOrEqual(h);
    expect(await run(`document.getElementById('pointSave').disabled && document.getElementById('panel').hidden`)).toBe(true); // nothing to save before a game runs
    await run(`document.getElementById('more').click()`);
    const panel = await run(`document.getElementById('panel').hidden ? '' : document.getElementById('panel').textContent`);
    expect(panel).toContain("after the game is rebuilt it cannot be loaded"); expect(panel).toContain("carries on after the game is rebuilt"); expect(panel).toContain("low power");
  });
}

test.skipIf(!have)("the guard, measured on the visible screen of the real page: a strobe fed in does not come out, at full rate and in low power", async () => {
  for (const low of [false, true]) {
    await run(`localStorage.${low ? "setItem('lowPower', '1')" : "removeItem('lowPower')"}`);
    await open(390, 844, `?selftest&low=${low}`);
    let text = ""; for (let i = 0; i < 150 && !text.startsWith("selftest"); i++) { await Bun.sleep(100); text = await status(); }
    expect(text).toMatch(/fed (1\d|2\d), visible [0-2] \(PASS\)/);
    expect(text.includes("(low power)")).toBe(low);
  }
  await run(`localStorage.removeItem('lowPower')`);
});
