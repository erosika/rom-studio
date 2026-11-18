// pane/layout.test.ts: the Now tab's arrangement, measured in a real headless browser (a
// chrome-headless-shell) against the sample game: a large preview surface, a separate review surface on
// the right, and the scene shelf below the preview; and the look of ROM Studio's video (mono name with the pink
// "for Hermes Agent", cyan label pills, the footer wordmark), readable in dark and in light.
// Local pages only, so it runs with --no-sandbox. Run: bun test pane/layout.test.ts   (CHROME=<path> to use another headless Chrome; skipped when none)
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
setDefaultTimeout(30_000);
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childEnv } from "../kit/env";

const CHROME = process.env.CHROME ?? ""; // skipped unless CHROME names a headless Chrome
const have = existsSync(CHROME);
const PORT = 8990 + Math.floor(Math.random() * 100), CDP = 9390 + Math.floor(Math.random() * 100), URL_ = `http://127.0.0.1:${PORT}/`;
const game = mkdtempSync(join(tmpdir(), "pane-layout-")), data = mkdtempSync(join(tmpdir(), "pane-layout-data-")), profile = mkdtempSync(join(tmpdir(), "pane-layout-chrome-"));
let server: ReturnType<typeof Bun.spawn>, chrome: ReturnType<typeof Bun.spawn>, sock: WebSocket;
let next = 0;
const pending = new Map<number, (d: any) => void>();
const send = (method: string, params: object = {}) => new Promise<any>((done) => { const id = ++next; pending.set(id, done); sock.send(JSON.stringify({ id, method, params })); });
const run = async (expression: string) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;

async function open(width: number, height: number, hash = "", scheme = "dark") {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
  await send("Page.navigate", { url: URL_ + hash });
  for (let i = 0; i < 80; i++) { if (await run(`(() => { const i = document.querySelector('#feed-body .entry.first .shot img'); return !!i && i.complete && i.naturalWidth > 0; })()`)) break; await Bun.sleep(100); }
  if (process.env.LAYOUT_SHOTS) writeFileSync(join(process.env.LAYOUT_SHOTS, `now-${width}.png`), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
}
const box = (sel: string) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(), s = getComputedStyle(e);
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, radius: Math.max(parseFloat(s.borderTopLeftRadius), parseFloat(s.borderBottomLeftRadius)), border: Math.max(parseFloat(s.borderTopWidth), parseFloat(s.borderBottomWidth)), bg: s.backgroundColor }; })()`;

beforeAll(async () => {
  if (!have) return;
  cpSync(join(import.meta.dir, "sample"), game, { recursive: true });
  server = Bun.spawn(["bun", join(import.meta.dir, "server.ts"), "--game", game, "--port", String(PORT), "--data", data], { env: childEnv(), stdout: "ignore", stderr: "ignore" });
  // a short environment by name, as the player's page test does: with an agent host's whole environment the browser never finished a navigation
  chrome = Bun.spawn([CHROME, "--headless", `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, "--no-sandbox", "--no-first-run", "--disable-gpu", "--hide-scrollbars", "--remote-allow-origins=*", "about:blank"], { env: childEnv(), stdout: "ignore", stderr: "ignore" });
  let ws = "";
  for (let i = 0; i < 80 && !ws; i++) { try { ws = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`, { signal: AbortSignal.timeout(1000) })).json()).find((t: any) => t.type === "page")?.webSocketDebuggerUrl ?? ""; } catch {} if (!ws) await Bun.sleep(100); }
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

test.skipIf(!have)("every view is in sight: at a phone or a 380px side pane the tabs wrap, nothing hides behind a sideways scroll", async () => {
  for (const [w, h] of [[390, 844], [380, 800]]) {
    await open(w, h);
    const tabs = await run(`(() => { const t = document.getElementById('tabs'), r = t.getBoundingClientRect(); return { scroll: t.scrollWidth - t.clientWidth, right: Math.max(...[...t.querySelectorAll('a')].filter((a) => !a.hidden).map((a) => a.getBoundingClientRect().right)), width: ${w} }; })()`);
    expect(tabs.scroll, `no hidden tabs at ${w}px`).toBeLessThanOrEqual(1);
    expect(tabs.right).toBeLessThanOrEqual(w);
  }
});

test.skipIf(!have)("Pause updates keeps the page as it is: no asking the studio while paused, and the switch says so", async () => {
  await open(1440, 900);
  await run(`localStorage.paneStill = ""; document.getElementById('still').click(); true`);
  expect(await run(`document.getElementById('still').getAttribute('aria-pressed')`)).toBe("true");
  expect(await run(`document.getElementById('status').textContent`)).toContain("Updates paused");
  const asked = await run(`(async () => { let n = 0; const f = window.fetch; window.fetch = (...a) => { if (String(a[0]).startsWith('state')) n++; return f(...a); }; window.postMessage('feed', '*'); await new Promise((r) => setTimeout(r, 3500)); window.fetch = f; return n; })()`);
  expect(asked, "nothing asked while paused").toBe(0);
  await run(`document.getElementById('still').click(); true`);
  expect(await run(`document.getElementById('still').textContent`)).toBe("Pause updates");
  expect(await run(`localStorage.paneStill`)).toBe("");
});

test.skipIf(!have)("no tab writes a stray null or undefined where its words go", async () => {
  for (const tab of ["now", "gallery", "dialogue", "music", "pixels", "source", "lore", "reports", "decisions", "settings"]) {
    await open(1440, 900, `#${tab}`);
    await Bun.sleep(400);
    expect(await run(`/\\b(null|undefined|NaN)\\b/.test(document.getElementById('tab-${tab}')?.innerText ?? '')`), `#${tab}`).toBe(false);
  }
}, 30_000);

test.skipIf(!have)("the look of ROM Studio's video: the name in mono with \"for Hermes Agent\" in pink, cyan label pills, the footer wordmark", async () => {
  for (const [scheme, pink, accent] of [["dark", "rgb(255, 126, 182)", "rgb(88, 218, 232)"], ["light", "rgb(184, 50, 111)", "rgb(8, 104, 117)"]]) {
    await open(1440, 900, "", scheme);
    const look = await run(`(async () => { await document.fonts.ready; const q = (s) => document.querySelector(s), cs = (s) => getComputedStyle(q(s));
      return { brand: cs('h1.brand').fontFamily, mono: document.fonts.check('600 12px "IBM Plex Mono"'), forColor: cs('h1.brand .for').color, pill: cs('#streams-h .pill').backgroundColor,
        tab: cs('#tabs a[aria-current="true"]').backgroundColor, mark: q('footer .wordmark')?.textContent, markFor: cs('footer .wordmark .for').color }; })()`);
    expect(look.brand, scheme).toContain("IBM Plex Mono");
    expect(look.mono, "the mono face loads from the pane itself").toBe(true);
    expect(look.forColor, `${scheme}: the editorial pink`).toBe(pink);
    expect(look.markFor).toBe(pink);
    expect(look.pill, `${scheme}: a heading is a cyan pill`).toBe(accent);
    expect(look.tab, `${scheme}: the open tab is a filled pill`).toBe(accent);
    expect(look.mark).toBe("ROM Studio for Hermes Agent");
  }
});

test.skipIf(!have)("every word on Now, Gallery and Decisions measures 4.5:1 or more against what is behind it, in dark and in light", async () => {
  for (const scheme of ["dark", "light"]) for (const tab of ["now", "gallery", "decisions"]) {
    await open(1440, 900, `#${tab}`, scheme);
    await Bun.sleep(300);
    const low = await run(`(() => {
      const rgb = (c) => { const n = (c.match(/[\\d.]+/g) || []).map(Number); return c.startsWith('color(') ? [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1] : n; }, lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
      const behind = (e) => { for (; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length > 3 ? c[3] > 0.5 : c.length === 3) return c; } return rgb(getComputedStyle(document.body).backgroundColor); };
      const out = []; let n = 0;
      for (const e of document.querySelectorAll('header *, main:not([hidden]) *, footer *')) {
        if (![...e.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim()) || !e.getClientRects().length || e.closest('.sr, [hidden]')) continue;
        const s = getComputedStyle(e); if (s.visibility === 'hidden' || +s.opacity < 1) continue;
        n++; const a = lum(rgb(s.color)), b = lum(behind(e)), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        if (ratio < 4.5) out.push(e.tagName + '.' + e.className + ' ' + ratio.toFixed(2) + ' ' + e.textContent.trim().slice(0, 30));
      }
      return { low: out.slice(0, 10), n }; })()`);
    expect(low.n, `${scheme} #${tab}: words measured`).toBeGreaterThan(15);
    expect(low.low, `${scheme} #${tab}`).toEqual([]);
  }
}, 60_000);

test("the pane's typefaces are open-licence and travel with their licences, unmodified", () => {
  const dir = join(import.meta.dir, "fonts"), readme = readFileSync(join(dir, "README.md"), "utf8");
  const fonts = readdirSync(dir).filter((f) => f.endsWith(".ttf"));
  expect(fonts.length).toBeGreaterThan(0);
  for (const f of fonts) {
    const licence = join(dir, f.startsWith("IBMPlexMono") ? "LICENSE-IBMPlexMono.txt" : "LICENSE-Inter.txt");
    expect(readFileSync(licence, "utf8"), f).toContain("SIL Open Font License, Version 1.1");
    expect(readme, `${f} is listed with its sha256`).toContain(`${new Bun.CryptoHasher("sha256").update(readFileSync(join(dir, f))).digest("hex")}  ${f}`);
  }
  const css = readFileSync(join(import.meta.dir, "pane.css"), "utf8");
  for (const f of fonts) expect(css, `${f} is used`).toContain(`fonts/${f}`);
});
