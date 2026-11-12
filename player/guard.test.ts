// Flash guard check with made-up flashing pictures, then with real walking frames from the game.
//   ~/.bun/bin/bun test player/guard.test.ts
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGuard } from "./guard.js";

const W = 240, H = 160;
type Paint = (x: number, y: number, t: number, frame: number) => [number, number, number];
const lin = (b: number) => { const c = b / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

const LIN = Float64Array.from({ length: 256 }, (_, i) => lin(i));
/** Each picture as 8x8 blocks of summed linear luminance and red (30 x 20 blocks). */
function blocks(f: Uint8Array) {
  const l = new Float64Array(600), r = new Float64Array(600);
  for (let y = 0, p = 0; y < H; y++) for (let x = 0; x < W; x++, p += 4) { const b = (y >> 3) * 30 + (x >> 3), R = LIN[f[p]!]!; l[b] += 0.2126 * R + 0.7152 * LIN[f[p + 1]!]! + 0.0722 * LIN[f[p + 2]!]!; r[b] += R; }
  return { l, r };
}
/** Mean linear luminance (and red) of a box (multiples of 8), per picture. */
function boxSeries(frames: Uint8Array[], x0: number, y0: number, w: number, h: number) {
  return frames.map((f) => {
    const g = ((f as any).blocks ??= blocks(f)); let l = 0, r = 0;
    for (let y = y0 >> 3; y < (y0 + h) >> 3; y++) for (let x = x0 >> 3; x < (x0 + w) >> 3; x++) { l += g.l[y * 30 + x]; r += g.r[y * 30 + x]; }
    return [l / (w * h), r / (w * h)];
  });
}
/** Most opposite changes of at least `size` inside any one second (two of them make one flash). */
function worstSecond(values: number[], times: number[], size = 0.1): number {
  const at: number[] = []; let dir = 0, ext = values[0]!;
  for (let i = 1; i < values.length; i++) {
    const v = values[i]!;
    if (dir === 0) { if (Math.abs(v - ext) >= size) { dir = Math.sign(v - ext); at.push(times[i]!); ext = v; } }
    else if ((v - ext) * dir > 0) ext = v;
    else if ((ext - v) * dir >= size) { dir = -dir; at.push(times[i]!); ext = v; }
  }
  let worst = 0;
  for (let i = 0; i < at.length; i++) { let j = i; while (j < at.length && at[j]! - at[i]! <= 1000) j++; worst = Math.max(worst, j - i); }
  return worst;
}
/** Worst second over: whole screen, quarters, every 16x16 square, and 40x40 boxes shifted off the guard's grid. */
function worstAnywhere(frames: Uint8Array[], times: number[]) {
  const boxes: [number, number, number, number][] = [[0, 0, W, H], [0, 0, 120, 80], [120, 0, 120, 80], [0, 80, 120, 80], [120, 80, 120, 80]];
  for (let y = 0; y + 16 <= H; y += 16) for (let x = 0; x + 16 <= W; x += 16) boxes.push([x, y, 16, 16]);
  for (let y = 16; y + 40 <= H; y += 40) for (let x = 24; x + 40 <= W; x += 40) boxes.push([x, y, 40, 40]);
  let lum = 0, red = 0;
  for (const b of boxes) { const s = boxSeries(frames, ...b); lum = Math.max(lum, worstSecond(s.map((v) => v[0]!), times)); red = Math.max(red, worstSecond(s.map((v) => v[1]!), times, 0.2)); }
  return { lum, red };
}
function run(paint: Paint, fps: number, seconds: number) {
  const guard = createGuard(W, H), raw: Uint8Array[] = [], out: Uint8Array[] = [], times: number[] = [];
  let damped = 0;
  for (let f = 0; f < fps * seconds; f++) {
    const t = (f * 1000) / fps, a = new Uint8Array(W * H * 4), b = new Uint8Array(W * H * 4);
    for (let y = 0, p = 0; y < H; y++) for (let x = 0; x < W; x++, p += 4) { const c = paint(x, y, t, f); a[p] = c[0]; a[p + 1] = c[1]; a[p + 2] = c[2]; a[p + 3] = 255; }
    damped += guard.step(a, t, b).damped;
    raw.push(a); out.push(b); times.push(t);
  }
  return { raw: worstAnywhere(raw, times), out: worstAnywhere(out, times), frames: out, times, damped };
}
type C = [number, number, number];
const calm: C = [90, 120, 90], WHITE: C = [255, 255, 255], BLACK: C = [0, 0, 0], RED: C = [255, 0, 0], BLUE: C = [0, 0, 255], G1: C = [150, 150, 150], G2: C = [90, 90, 90], DARK: C = [20, 20, 40], P1: C = [120, 160, 110], P2: C = [100, 140, 100];
const blink = (hz: number, t: number) => Math.floor((t / 1000) * hz * 2) % 2 === 0;
const CASES: Record<string, Paint> = {
  "whole screen black/white 30 Hz": (_x, _y, _t, f) => (f % 2 ? WHITE : BLACK),
  "whole screen black/white 10 Hz": (_x, _y, t) => (blink(10, t) ? WHITE : BLACK),
  "whole screen black/white 3 Hz": (_x, _y, t) => (blink(3, t) ? WHITE : BLACK),
  "whole screen grey steps 8 Hz (small swing)": (_x, _y, t) => (blink(8, t) ? G1 : G2),
  "red/blue 10 Hz": (_x, _y, t) => (blink(10, t) ? RED : BLUE),
  "one quarter flashing 10 Hz": (x, y, t) => (x < 120 && y < 80 && blink(10, t) ? WHITE : calm),
  "48x48 block across region edges 10 Hz": (x, y, t) => (x >= 60 && x < 108 && y >= 60 && y < 108 && blink(10, t) ? WHITE : calm),
  "white flash for 100 ms every 700 ms": (_x, _y, t) => (t % 700 < 100 ? WHITE : DARK),
};
for (const [name, paint] of Object.entries(CASES))
  for (const fps of [30, 60, 120])
    test(`${name} @ ${fps} pictures/s`, { timeout: 120_000 }, () => {
      const r = run(paint, fps, 6);
      console.log(`  ${name} @${fps}: changes in the worst second: in ${r.raw.lum} lum / ${r.raw.red} red -> out ${r.out.lum} lum / ${r.out.red} red`);
      expect(r.raw.lum + r.raw.red).toBeGreaterThan(3); // the made-up input really flashes
      expect(r.out.lum).toBeLessThanOrEqual(2); // at most one flash (two opposite changes) in any second
      expect(r.out.red).toBeLessThanOrEqual(2);
    });

test("one cut from black to white becomes a fade of the same length at 30, 60 and 120 pictures/s", { timeout: 120_000 }, () => {
  for (const fps of [30, 60, 120]) {
    const r = run((_x, _y, t) => (t >= 1000 ? WHITE : BLACK), fps, 3);
    const s = boxSeries(r.frames, 0, 0, W, H).map((v) => v[0]!);
    const reached = r.times[s.findIndex((v) => v > 0.9)]! - 1000, biggest = Math.max(...s.slice(1).map((v, i) => (v - s[i]!) / (1000 / fps)));
    console.log(`  cut @${fps}: 90% reached after ${reached.toFixed(0)} ms, fastest change ${(biggest * 100).toFixed(2)}% of full range per ms`);
    expect(reached).toBeGreaterThanOrEqual(0); expect(reached).toBeLessThan(60);
    expect(s.at(-1)!).toBeGreaterThan(0.99); // and it does arrive
  }
});

test("a still picture and a steady pan pass unchanged", () => {
  const r = run((x, y, _t, f) => (((x + f) >> 3) + (y >> 3)) % 2 ? P1 : P2, 60, 3);
  const a = r.frames.at(-1)!, guard = createGuard(W, H), b = new Uint8Array(W * H * 4);
  expect(r.damped).toBeLessThan(24 * 10); // only the fade-in from black at the very start
  for (let i = 0; i < 40; i++) guard.step(a, i * 16, b);
  expect(Buffer.compare(a, b)).toBe(0);
});

const KIT = join(import.meta.dir, "../kit"), ROM = join(import.meta.dir, "../../rom-studio-game/out/game.gba");
test.skipIf(!existsSync(ROM) || !existsSync(join(KIT, ".cache")))("real game: walking around from the start is hardly touched", () => {
  // the start saved for THIS build (the kit names it by the game file's hash); any other saved start plays as garbage
  const state = join(KIT, ".cache", `field-${createHash("sha1").update(readFileSync(ROM)).digest("hex").slice(0, 12)}.ss`), dir = mkdtempSync(join(tmpdir(), "guard-"));
  if (!existsSync(state)) Bun.spawnSync([join(KIT, "kit"), "--game", join(import.meta.dir, "../../rom-studio-game"), "where"]);
  expect(existsSync(state)).toBe(true);
  const walk = [16, 16, 128, 128, 32, 32, 64, 16, 16, 128]; // key masks, 40 frames each
  let script = `load ${state}\nframes 30\n`;
  walk.forEach((m, i) => { script += `keys ${m}\n`; for (let f = 0; f < 40; f++) script += `frames 1\nshot ${dir}/${String(i * 40 + f).padStart(4, "0")}.rgba\n`; });
  Bun.spawnSync([join(KIT, "emu/bin/studio-emu"), ROM], { stdin: Buffer.from(script + "quit\n") });
  const files = readdirSync(dir).sort(), guard = createGuard(W, H), out = new Uint8Array(W * H * 4);
  let damped = 0, total = 0;
  files.forEach((f, i) => { const r = guard.step(new Uint8Array(readFileSync(join(dir, f))), i * 16.74, out); if (i > 30) { damped += r.damped; total += r.regions; } });
  rmSync(dir, { recursive: true, force: true });
  console.log(`  real walking: ${files.length} pictures, regions held back ${damped} of ${total} (${((100 * damped) / total).toFixed(1)}%)`);
  expect(files.length).toBe(400);
  expect(damped / total).toBeLessThan(0.05);
});

test("four door fades in a row (out, a short dark hold, in) are shown exactly: a fade is not a flash", () => {
  const g = createGuard(W, H), out = new Uint8Array(W * H * 4), inp = new Uint8Array(W * H * 4);
  let t = 0, held = 0, lag = 0;
  const frame = (scene: number, bright: number, check = false) => {
    for (let y = 0, p = 0; y < H; y++) for (let x = 0; x < W; x++, p += 4) {
      const v = ((x >> 4) + (y >> 4) + scene) % 3, c = scene ? [40 + v * 90, 200 - v * 60, 250 - v * 20] : [240 - v * 30, 240 - v * 100, 60 + v * 80];
      inp[p] = c[0]! * bright; inp[p + 1] = c[1]! * bright; inp[p + 2] = c[2]! * bright; inp[p + 3] = 255;
    }
    const r = g.step(inp, t, out); t += 1000 / 60;
    if (check) { held += r.damped; for (let p = 0; p < inp.length; p += 4) lag = Math.max(lag, Math.abs(inp[p]! - out[p]!)); }
  };
  for (let i = 0; i < 120; i++) frame(0, 1);
  for (let k = 0; k < 4; k++) {
    for (let i = 16; i >= 0; i--) frame(k % 2, i / 16);
    for (let i = 0; i < 8; i++) frame(k % 2, 0);
    for (let i = 0; i <= 16; i++) frame((k + 1) % 2, i / 16);
    for (let i = 0; i < 30; i++) frame((k + 1) % 2, 1, true);
  }
  expect(held).toBe(0); expect(lag).toBeLessThanOrEqual(1);
});
