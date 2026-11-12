// pane/layout.test.ts: the Now tab's arrangement, measured in a real headless browser (a
// chrome-headless-shell) against the sample game: a large preview surface, a separate review surface on
// the right, and the scene shelf below the preview. Colors are not tested here: they come from the host.
// Local pages only, so it runs with --no-sandbox. Run: bun test pane/layout.test.ts   (CHROME=<path> to use another headless Chrome; skipped when none)
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
setDefaultTimeout(30_000);
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME ?? ""; // skipped unless CHROME names a headless Chrome
const have = existsSync(CHROME);
const PORT = 8990 + Math.floor(Math.random() * 100), CDP = 9390 + Math.floor(Math.random() * 100), URL_ = `http://127.0.0.1:${PORT}/`;
const game = mkdtempSync(join(tmpdir(), "pane-layout-")), data = mkdtempSync(join(tmpdir(), "pane-layout-data-")), profile = mkdtempSync(join(tmpdir(), "pane-layout-chrome-"));
let server: ReturnType<typeof Bun.spawn>, chrome: ReturnType<typeof Bun.spawn>, sock: WebSocket;
let next = 0;
const pending = new Map<number, (d: any) => void>();
const send = (method: string, params: object = {}) => new Promise<any>((done) => { const id = ++next; pending.set(id, done); sock.send(JSON.stringify({ id, method, params })); });
const run = async (expression: string) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;

async function open(width: number, height: number, hash = "") {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await send("Page.navigate", { url: URL_ + hash });
  for (let i = 0; i < 80; i++) { if (await run(`(() => { const i = document.querySelector('#feed-body .entry.first .shot img'); return !!i && i.complete && i.naturalWidth > 0; })()`)) break; await Bun.sleep(100); }
  if (process.env.LAYOUT_SHOTS) writeFileSync(join(process.env.LAYOUT_SHOTS, `now-${width}.png`), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
}
const box = (sel: string) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(), s = getComputedStyle(e);
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, radius: Math.max(parseFloat(s.borderTopLeftRadius), parseFloat(s.borderBottomLeftRadius)), border: Math.max(parseFloat(s.borderTopWidth), parseFloat(s.borderBottomWidth)), bg: s.backgroundColor }; })()`;

beforeAll(async () => {
  if (!have) return;
  cpSync(join(import.meta.dir, "sample"), game, { recursive: true });
  server = Bun.spawn(["bun", join(import.meta.dir, "server.ts"), "--game", game, "--port", String(PORT), "--data", data], { stdout: "ignore", stderr: "ignore" });
  chrome = Bun.spawn([CHROME, "--headless", `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, "--no-sandbox", "--no-first-run", "--disable-gpu", "--hide-scrollbars", "--remote-allow-origins=*", "about:blank"], { stdout: "ignore", stderr: "ignore" });
  let ws = "";
  for (let i = 0; i < 80 && !ws; i++) { try { ws = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t: any) => t.type === "page")?.webSocketDebuggerUrl ?? ""; } catch {} if (!ws) await Bun.sleep(100); }
  for (let i = 0; i < 50; i++) { try { await fetch(URL_); break; } catch { await Bun.sleep(100); } }
  sock = new WebSocket(ws);
  sock.onmessage = (m) => { const d = JSON.parse(String(m.data)); pending.get(d.id)?.(d); pending.delete(d.id); };
  await new Promise((done) => { sock.onopen = done; });
}, 30_000);
afterAll(() => { sock?.close(); chrome?.kill(); server?.kill(); for (const d of [game, data, profile]) rmSync(d, { recursive: true, force: true }); });

test.skipIf(!have)("wide: large preview, separate review on the right, scene shelf below the preview", async () => {
  await open(1440, 900);
  const stage = await run(box("#feed-body .entry.first .stage")), review = await run(box("#feed-body .entry.first .review")), shelf = await run(box("#streams-box"));
  expect(stage, "the newest entry has its own preview surface").not.toBeNull();
  expect(review.left - stage.right, "review is a physically separate surface").toBeGreaterThanOrEqual(12);
  expect(Math.abs(review.top - stage.top)).toBeLessThanOrEqual(2);
  for (const s of [stage, review, shelf]) { expect(s.radius, "roomy rounded surfaces").toBeGreaterThanOrEqual(12); expect(s.border).toBeGreaterThanOrEqual(1); expect(s.bg).not.toBe("rgba(0, 0, 0, 0)"); }
  expect(shelf.top, "the scene shelf sits below the preview").toBeGreaterThanOrEqual(stage.bottom);
  expect(Math.abs(shelf.left - stage.left)).toBeLessThanOrEqual(2);
  expect(shelf.right).toBeLessThanOrEqual(review.left);
  expect(review.bottom, "the review column runs beside the shelf too").toBeGreaterThanOrEqual(shelf.bottom - 2);

});

test.skipIf(!have)("the preview is the actual picture, large, at its own aspect ratio with square pixels", async () => {
  await open(1440, 900);
  const img = await run(`(() => { const i = document.querySelector('#feed-body .entry.first .shot img'), r = i.getBoundingClientRect(); return { w: r.width, h: r.height, nw: i.naturalWidth, nh: i.naturalHeight, src: i.getAttribute('src'), rendering: getComputedStyle(i).imageRendering }; })()`);
  expect(img.src).toContain("shots/");
  expect(img.w, "large main preview").toBeGreaterThanOrEqual(700);
  expect(Math.abs(img.w / img.h - img.nw / img.nh)).toBeLessThan(0.01 * (img.nw / img.nh));
  expect(img.rendering).toBe("pixelated");
});

test.skipIf(!have)("nothing moves: no animations or transitions", async () => {
  await open(1440, 900);
  expect(await run(`document.getAnimations().length`)).toBe(0);
  expect(await run(`[...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).transitionDuration.split(',').some((d) => parseFloat(d) > 0)).length`)).toBe(0);
});

test.skipIf(!have)("phone: one column, no sideways scrolling; the Source tab still opens", async () => {
  await open(390, 844);
  expect(await run(`document.documentElement.scrollWidth`)).toBeLessThanOrEqual(390);
  const stage = await run(box("#feed-body .entry.first .stage")), review = await run(box("#feed-body .entry.first .review"));
  expect(review.top).toBeGreaterThanOrEqual(stage.bottom);
  await open(1440, 900, "#source");
  expect(await run(`!document.getElementById('tab-source').hidden && !!document.querySelector('#tabs a[href="#source"]')`)).toBe(true);
});

test("the layout stylesheet brings no colors of its own; the host or pane palette supplies them", () => {
  const css = readFileSync(join(import.meta.dir, "desktop.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const values = [...css.matchAll(/:\s*([^;{}]+)[;}]/g)].map((m) => m[1]).join("\n"); // declaration values only, not #ids
  expect(values.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|\b(white|black)\b/gi) ?? []).toEqual([]);
  expect(css).not.toMatch(/animation|transition/i);
});
