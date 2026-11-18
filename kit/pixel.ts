// kit/pixel.ts: the pixel step. `find` looks for stray pixels in an indexed picture and draws them on a zoomed sheet;
// `edit` applies explicit edits kept in a file beside the picture. Nothing here draws or regenerates: a speck is fixed by hand.
// A `colour` edit changes what one colour number looks like (hair, a sweater) without touching a pixel. The game often reads
// a picture's colours from a palette file somewhere else (graphics/trainers/palettes/x.pal, graphics/object_events/palettes/
// x.pal), not from the picture: the edits file names that file as "colours" (the command finds it), and both are changed.
// A tile sheet with a map beside it (tiles.png + map.bin + a .pal) is read as the picture the game shows, and coordinates
// are that picture's; an edit lands in the tile, so every place that draws the tile changes with it (the tool says where).
// A variant is a new picture made from a base picture (an outfit of a drawing you love): its edits file names the base, so the
// edits are the whole recipe and go back on whenever the base changes. `colours` says which palette file the game draws a
// picture with, and whether it shows the picture's own colours (a back pic sharing its front pic's palette came out green).
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { canvas, decodeIndexed, encodePng } from "./png";

export type View = { map?: string; palette?: string; width?: number; base?: number; crop?: number[] };
export type Edit = { set?: number[]; fill?: number[]; replace?: number[]; copy?: number[]; bucket?: number[]; box?: number[]; draw?: number[]; rows?: string[]; onto?: number[]; colour?: [number, string]; why?: string; saved?: string; by?: string };
/** colours: the palette file the game reads this picture's colours from, relative to the picture's folder (absent: its own).
 *  base: the picture this one is made from, relative to its folder (a variant): every run starts from the base's pixels as they are then. */
export type Doc = { picture: string; base?: string; view?: View; colours?: string; edits: Edit[]; applied?: { base: string; result: string; colours?: string } };
export type Finding = { n: number; kind: "speck" | "pair" | "rare" | "fringe" | "patch" | "palette"; pts: number[][]; text: string; texture: boolean };
/** A picture as the game shows it: `px` is the file's own pixels; seen pixel i is colour palettes[row[i]][px[src[i]]]. */
export type Pic = { file: string; w: number; h: number; depth: number; px: Uint8Array; head: Buffer[]; vw: number; vh: number; src: Uint32Array; row: Uint8Array;
  palettes: number[][][]; crop: number[]; view?: View; uses?: Map<number, number>; recoloured?: boolean };

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex").slice(0, 16);
const hex = (c: number[]) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
export const editsFile = (png: string) => `${png}.edits.json`, origFile = (png: string) => `${png}.orig`;
const sibling = (png: string, name: string) => { if (basename(name) !== name) throw new Error(`"${name}": a view names files in the picture's own folder, by name only`); return join(dirname(png), name); };
export const readDoc = (png: string, file = editsFile(png)): Doc | null => existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;

/** Open a picture; the view comes from the caller, else from its edits file, else from a map.bin beside a tiles.png. */
export function openPic(file: string, view?: View, bytes: Uint8Array = readFileSync(file)): Pic {
  const b = Buffer.from(bytes), head: Buffer[] = []; let depth = 0, type = 0; const plte: number[][] = [];
  for (let p = 8; p < b.length; ) {
    const len = b.readUInt32BE(p), kind = b.toString("latin1", p + 4, p + 8), data = b.subarray(p + 8, p + 8 + len);
    if (kind === "IHDR") { depth = data[8]!; type = data[9]!; }
    if (kind === "PLTE") for (let i = 0; i + 2 < len; i += 3) plte.push([data[i]!, data[i + 1]!, data[i + 2]!]);
    if (kind !== "IDAT" && kind !== "IEND") head.push(b.subarray(p, p + 12 + len));
    p += 12 + len;
  }
  if (type !== 3 || !plte.length) throw new Error(`${file}: not an indexed picture (one with its own palette). The pixel step edits colour numbers, so convert it to an indexed PNG first`);
  const { w, h, px } = decodeIndexed(bytes, file);
  view ??= readDoc(file)?.view ?? (basename(file) === "tiles.png" && existsSync(join(dirname(file), "map.bin")) ? { map: "map.bin", ...(existsSync(join(dirname(file), "palette.pal")) ? { palette: "palette.pal" } : {}) } : undefined);
  let palettes = [plte];
  if (view?.palette) {
    const cols = readFileSync(sibling(file, view.palette), "utf8").split(/\r?\n/).slice(3).filter((l) => l.trim()).map((l) => l.trim().split(/\s+/).map(Number));
    palettes = []; for (let i = 0; i < cols.length; i += 16) palettes.push(cols.slice(i, i + 16));
  }
  if (!view?.map) { const src = new Uint32Array(w * h).map((_, i) => i); return { file, w, h, depth, px, head, vw: w, vh: h, src, row: new Uint8Array(w * h), palettes, crop: view?.crop ?? [0, 0, w, h], view }; }
  const raw = readFileSync(sibling(file, view.map)), cells = new Uint16Array(raw.buffer, raw.byteOffset, raw.length >> 1), across = view.width ?? 32, tw = w >> 3;
  let down = Math.floor(cells.length / across);
  const sameRows = (a: number, c: number, n: number) => { for (let i = 0; i < n * across; i++) if (cells[a * across + i] !== cells[c * across + i]) return false; return true; };
  let show = down; // what to look at unless told: one copy of a repeated picture, without the blank rows under it
  while (show % 2 === 0 && show > 1 && sameRows(0, show / 2, show / 2)) show /= 2;
  for (let r = 1; r < show; r++) if (cells.subarray(r * across, (r + 1) * across).every((c) => c === 0)) { show = r; break; } // an empty row ends it
  const crop = view.crop ?? [0, 0, across * 8, show * 8], vw = across * 8, vh = down * 8, src = new Uint32Array(vw * vh), row = new Uint8Array(vw * vh), uses = new Map<number, number>();
  let base = view.base ?? 99;
  if (view.base == null) for (let cy = crop[1]! >> 3; cy < Math.ceil((crop[1]! + crop[3]!) / 8); cy++) for (let cx = crop[0]! >> 3; cx < Math.ceil((crop[0]! + crop[2]!) / 8); cx++) base = Math.min(base, cells[cy * across + cx]! >> 12);
  if (!view.palette) base = 0;
  for (let c = 0; c < across * down; c++) {
    const v = cells[c]!, t = v & 1023, hf = v & 1024, vf = v & 2048, r = Math.max(0, (v >> 12) - base);
    if (((t / tw) | 0) * 8 + 8 > h) throw new Error(`${view.map}: cell ${c} draws tile ${t}, which ${basename(file)} does not have`);
    const cx = (c % across) * 8, cy = ((c / across) | 0) * 8; // counted in the part shown: a repeat of the whole picture is not another place
    if (cx + 8 > crop[0]! && cx < crop[0]! + crop[2]! && cy + 8 > crop[1]! && cy < crop[1]! + crop[3]!) uses.set(t, (uses.get(t) ?? 0) + 1);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const i = (((c / across) | 0) * 8 + y) * vw + (c % across) * 8 + x;
      src[i] = (((t / tw) | 0) * 8 + (vf ? 7 - y : y)) * w + (t % tw) * 8 + (hf ? 7 - x : x); row[i] = r < palettes.length ? r : 0;
    }
  }
  return { file, w, h, depth, px, head, vw, vh, src, row, palettes, crop, view, uses };
}
export const seen = (p: Pic, i: number) => p.palettes[p.row[i]!]![p.px[p.src[i]!]!] ?? [255, 0, 255];

/** The picture's bytes again: every chunk but the pixels as it was (size, depth; the palette too unless a colour edit changed it), the pixels unfiltered. */
export function encodePic(p: Pic): Buffer {
  const stride = Math.ceil((p.w * p.depth) / 8), raw = new Uint8Array(p.h * (stride + 1));
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) raw[y * (stride + 1) + 1 + ((x * p.depth) >> 3)]! |= p.px[y * p.w + x]! << (8 - p.depth - ((x * p.depth) & 7));
  const chunk = (type: string, data: Uint8Array) => { const o = Buffer.alloc(12 + data.length); o.writeUInt32BE(data.length, 0); o.write(type, 4, "latin1"); o.set(data, 8); o.writeUInt32BE(Bun.hash.crc32(o.subarray(4, 8 + data.length)) >>> 0, 8 + data.length); return o; };
  const head = p.head.map((c) => (p.recoloured && c.toString("latin1", 4, 8) === "PLTE" ? chunk("PLTE", Uint8Array.from(p.palettes[0]!.flat())) : c));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...head, chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array(0))]);
}

// ---- palette files (JASC-PAL, as the game's graphics use them) ----
const palLines = (text: string) => text.split(/\r?\n/);
export function readPal(text: string): number[][] {
  const l = palLines(text); if (l[0]?.trim() !== "JASC-PAL") throw new Error("not a JASC-PAL palette file");
  return l.slice(3).filter((x) => x.trim()).map((x) => x.trim().split(/\s+/).map(Number));
}
/** The palette file with some entries changed, everything else (header, count, line ends) as it was. */
export function writePal(text: string, set: [number, number[]][]): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n", l = palLines(text), n = readPal(text).length;
  for (const [i, c] of set) { if (i >= n) throw new Error(`colour number ${i} is not in the palette file (it has ${n})`); l[3 + i] = c.join(" "); }
  return l.join(eol);
}
/** Where the game reads a picture's colours: a .pal named like the picture that the game's source includes (the nearest one to
 *  the picture), or the picture itself when the source makes its palette from the .png. null when neither is found. */
const srcText = (game: string) => { const hits: string[] = [], walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const f = join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(c|h)$/.test(e.name)) hits.push(readFileSync(f, "utf8")); } };
  walk(join(game, "src")); return hits.join("\n"); };
export function gamePalette(game: string, png: string, text?: string): { pal?: string; own?: boolean; refs: number } | null {
  const rel = relative(game, png), stem = basename(png, ".png"), dir = rel.replace(/\/[^/]+$/, "");
  if (!existsSync(join(game, "src"))) return null;
  if (rel.startsWith("..") || isAbsolute(rel)) return null; // a draft outside the game folder: matching by name alone once recoloured a walking figure's palette
  const all = text ?? srcText(game), own = all.includes(`"${rel}", ".gbapal"`) || all.includes(`"${rel.replace(/\.png$/, ".gbapal")}"`);
  if (own) return { own: true, refs: 1 };
  const pals = [...all.matchAll(/"([^"]+\/([^/"]+)\.(?:pal|gbapal))"/g)].filter((m) => m[2] === stem).map((m) => m[1]!.replace(/\.gbapal$/, ".pal"));
  const common = (a: string) => { let i = 0; while (i < a.length && a[i] === dir[i]) i++; return i; };
  const best = [...new Set(pals)].filter((f) => existsSync(join(game, f))).sort((a, b) => common(b) - common(a))[0];
  return best ? { pal: best, refs: pals.filter((f) => f === best).length } : null;
}
export type PalUse = { pic: string; pal: string; how: string };
/** Every picture the game's source pairs with a palette file in the trainer tables (TRAINER_FRONT_PIC / TRAINER_BACK_PIC), as paths in the game. */
export function paletteUses(game: string, text = srcText(game)): PalUse[] {
  const pics = new Map<string, string>(), pals = new Map<string, string>(), uses = new Map<string, PalUse>();
  for (const m of text.matchAll(/\b(\w+)\s*\[\s*\]\s*=\s*INC(?:BIN|GFX)_U(?:8|16|32)\(\s*"([^"]+)"/g)) { // the symbol and the file it is made from
    const stem = m[2]!.replace(/\.[^/]*$/, ""); if (/\.(pal|gbapal)$/.test(m[2]!)) pals.set(m[1]!, stem + ".pal"); else pics.set(m[1]!, stem + ".png");
  }
  for (const m of text.matchAll(/\b(TRAINER_FRONT_PIC|TRAINER_BACK_PIC)\(([^)]*)\)/g)) {
    const args = m[2]!.split(",").map((a) => a.trim()), pic = args.find((a) => pics.has(a)), pal = args.find((a) => pals.has(a));
    if (pic && pal) uses.set(`${pics.get(pic)}|${pals.get(pal)}`, { pic: pics.get(pic)!, pal: pals.get(pal)!, how: `${m[1]}(${pic}, ${pal})` });
  }
  return [...uses.values()];
}
/** Does the game show each picture in its own colours? A picture's colour numbers are drawn with the palette file the game pairs it
 *  with, not the PNG's own palette: when the two differ, the game shows other colours than the picture (a figure's throw drawn with its
 *  new photo's palette had green skin). With pictures named, says what each is drawn with; without, lists only the ones that differ. */
export function colourCheck(game: string, only?: string[]): { lines: string[]; problems: number } {
  const text = srcText(game), uses = paletteUses(game, text).filter((u) => existsSync(join(game, u.pic)) && existsSync(join(game, u.pal)));
  const opened = new Map<string, { pal: number[][]; used: Map<number, number> }>(), five = (c?: number[]) => (c ? c.map((v) => v >> 3).join(",") : "none");
  const look = (pic: string) => { let o = opened.get(pic); if (!o) { const p = openPic(join(game, pic)), used = new Map<number, number>(); for (const v of p.px) used.set(v, (used.get(v) ?? 0) + 1); o = { pal: p.palettes[0]!, used }; opened.set(pic, o); } return o; };
  const differs = (pic: string, cols: number[][]) => { const o = look(pic); return [...o.used.keys()].sort((a, b) => a - b).filter((i) => i > 0 && five(o.pal[i]) !== five(cols[i])); }; // colour 0 is see-through
  const lines: string[] = []; let problems = 0;
  const say = (u: PalUse) => {
    const cols = readPal(readFileSync(join(game, u.pal), "utf8")), bad = differs(u.pic, cols), o = look(u.pic), n = [...o.used.keys()].filter((i) => i > 0).length;
    const others = uses.filter((v) => v.pal === u.pal && v.pic !== u.pic), fits = others.filter((v) => !differs(v.pic, cols).length);
    if (!bad.length) { if (only) lines.push(`${u.pic}: drawn with ${u.pal} (${u.how}): the game shows its own colours${others.length ? `; that file also draws ${others.map((v) => v.pic).join(", ")}` : ""}`); return; }
    problems++;
    lines.push(`${u.pic}: drawn with ${u.pal} (${u.how}), which is NOT the picture's own colours in ${bad.length} of the ${n} it uses: ${bad.slice(0, 5).map((i) => `colour ${i} ${hex(o.pal[i] ?? [0, 0, 0])} shows as ${cols[i] ? hex(cols[i]!) : "nothing"} (${o.used.get(i)} px)`).join(", ")}${bad.length > 5 ? ` and ${bad.length - 5} more` : ""}.`
      + (fits.length ? ` That file fits ${fits.map((v) => v.pic).join(", ")} instead: one palette file is drawing two pictures with different colours. Give ${u.pic} its own palette file (its PNG's own colours) and point its table entry at it.` : ` Write the picture's own colours into ${u.pal}, or give it its own palette file.`));
  };
  if (!only) { for (const u of uses) say(u); return { lines, problems }; }
  for (const f of only) {
    const rel = relative(game, resolve(f)), mine = uses.filter((u) => u.pic === rel);
    if (mine.length) { mine.forEach(say); continue; }
    if (!existsSync(join(game, rel))) { lines.push(`${rel}: no such picture`); problems++; continue; }
    const g = rel.startsWith("graphics/") ? gamePalette(game, join(game, rel), text) : null;
    if (g?.pal) say({ pic: rel, pal: g.pal, how: "found by its name, not a table: check it is the one" });
    else if (g?.own) lines.push(`${rel}: the game makes its colours from the picture itself`);
    else lines.push(`${rel}: no trainer table in the game's source names this picture, so the game does not draw it this way (a draft, or drawn by other code: check its palette by hand)`);
  }
  return { lines, problems };
}

// ---- find ----
const dist = (a: number[], b: number[]) => Math.max(Math.abs(a[0]! - b[0]!), Math.abs(a[1]! - b[1]!), Math.abs(a[2]! - b[2]!));
const AROUND = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
/** Stray pixels, in the order worth looking at: the ones nothing else in the picture resembles first. */
export function find(p: Pic): Finding[] {
  const [ox, oy, cw, ch] = p.crop as [number, number, number, number], key = new Int32Array(cw * ch), rgb = new Map<number, number[]>(), count = new Map<number, number>();
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { // colours as the console shows them: 5 bits a channel
    const c = seen(p, (oy + y) * p.vw + ox + x), k = ((c[0]! >> 3) << 10) | ((c[1]! >> 3) << 5) | (c[2]! >> 3);
    key[y * cw + x] = k; rgb.set(k, c); count.set(k, (count.get(k) ?? 0) + 1);
  }
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= cw || y >= ch ? -1 : key[y * cw + x]!);
  const like = (x: number, y: number) => AROUND.filter(([dx, dy]) => at(x + dx!, y + dy!) === at(x, y)).map(([dx, dy]) => [x + dx!, y + dy!]);
  const name = (k: number) => hex(rgb.get(k)!), where = (pts: number[][]) => pts.slice(0, 6).map(([x, y]) => `(${x! + ox},${y! + oy})`).join(" ") + (pts.length > 6 ? ` and ${pts.length - 6} more` : "");
  const groups = new Map<string, { kind: Finding["kind"]; pts: number[][]; text: string; n: number }[]>(), out: Omit<Finding, "n">[] = [];
  // 1. single pixels and pairs that touch nothing of their own colour
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const mine = like(x, y); let pts: number[][];
    if (!mine.length) pts = [[x, y]];
    else if (mine.length === 1 && like(mine[0]![0]!, mine[0]![1]!).length === 1 && (mine[0]![1]! > y || (mine[0]![1] === y && mine[0]![0]! > x))) pts = [[x, y], mine[0]!];
    else continue;
    const ring = new Set<number>(); for (const [px, py] of pts) for (const [dx, dy] of AROUND) { const k = at(px! + dx!, py! + dy!); if (k >= 0 && k !== at(x, y)) ring.add(k); }
    const flat = ring.size === 1, sig = `${pts.length}|${at(x, y)}|${[...ring].sort().join(",")}`;
    const text = `${pts.length === 1 ? "one pixel" : "two pixels"} of ${name(at(x, y))} ${flat ? `alone in flat ${name([...ring][0]!)}` : `touching nothing of its colour (among ${[...ring].slice(0, 3).map(name).join(", ")})`}`;
    (groups.get(sig) ?? groups.set(sig, []).get(sig)!).push({ kind: pts.length === 1 ? "speck" : "pair", pts, text, n: 0 });
  }
  for (const g of [...groups.values()].sort((a, b) => a.length - b.length)) { // many alike is usually texture (stars, dots, grain): one entry for the lot
    if (g.length <= 6) for (const f of g) out.push({ kind: f.kind, pts: f.pts, text: `${f.text}${g.length > 1 ? ` (${g.length} like it)` : ""} at ${where(f.pts)}`, texture: false });
    else out.push({ kind: g[0]!.kind, pts: g.flatMap((f) => f.pts), text: `${g.length} times: ${g[0]!.text}: probably texture; at ${where(g.map((f) => f.pts[0]!))}`, texture: true });
  }
  // 2. colours hardly used; 3. colours that sit between their two neighbours and are hardly used (a soft edge left behind)
  const few = Math.max(24, Math.round(cw * ch * 0.003)), fringe = new Map<number, number[][]>();
  for (const [k, n] of count) if (n < 4) { const pts: number[][] = []; key.forEach((v, i) => { if (v === k) pts.push([i % cw, (i / cw) | 0]); }); out.push({ kind: "rare", pts, text: `${name(k)} is used by ${n} pixel${n > 1 ? "s" : ""} in the whole picture: ${where(pts)}`, texture: false }); }
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const k = at(x, y), n = count.get(k)!; if (n < 4 || n > few) continue;
    for (const [dx, dy] of AROUND.slice(0, 4)) {
      const a = at(x + dx!, y + dy!), b = at(x - dx!, y - dy!); if (a < 0 || b < 0 || a === k || b === k || a === b) continue;
      const A = rgb.get(a)!, B = rgb.get(b)!, gap = dist(A, B);
      if (gap >= 40 && dist(rgb.get(k)!, A.map((v, i) => (v + B[i]!) / 2)) <= gap / 4) { (fringe.get(k) ?? fringe.set(k, []).get(k)!).push([x, y]); break; }
    }
  }
  for (const [k, pts] of fringe) out.push({ kind: "fringe", pts, text: `${name(k)} (${count.get(k)} pixels in all) lies between the colours either side of it in ${pts.length} place${pts.length > 1 ? "s" : ""}, like a soft edge left behind: ${where(pts)}`, texture: false });
  // 3b. small patches in a hue foreign to everything around them (a grey-green square on an orange body reads as a glitch)
  const blank = (x: number, y: number) => p.px[p.src[(oy + y) * p.vw + ox + x]!] === 0; // colour 0: see-through, or the backdrop
  const hue = (c: number[]) => { const [r, g, b] = c as [number, number, number], mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    const h = !d ? 0 : mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return { h: h * 60, chroma: d }; };
  const apart = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
  const big = Math.max(24, Math.round(cw * ch * 0.02)), done = new Uint8Array(cw * ch), patches = new Map<number, number[][][]>();
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    if (done[y * cw + x] || blank(x, y)) continue;
    const k = at(x, y), blob: number[][] = [], stack = [[x, y]]; done[y * cw + x] = 1;
    while (stack.length) { const [a, b] = stack.pop()!; blob.push([a!, b!]);
      for (const [dx, dy] of AROUND.filter(([u, v]) => !u || !v)) { const X = a! + dx!, Y = b! + dy!; if (at(X, Y) === k && !done[Y * cw + X]) { done[Y * cw + X] = 1; stack.push([X, Y]); } } }
    if (blob.length < 3 || blob.length > big) continue;
    const me = hue(rgb.get(k)!); // greys (metal) and dark tints (outlines, deep shadow) are never foreign
    if (me.chroma < 24 || Math.max(...rgb.get(k)!) < 72) continue;
    const ring = new Set<number>(); for (const [a, b] of blob) for (const [dx, dy] of AROUND) { const X = a! + dx!, Y = b! + dy!; if (at(X, Y) >= 0 && at(X, Y) !== k && !blank(X, Y)) ring.add(at(X, Y)); }
    const tinted = [...ring].map((r) => hue(rgb.get(r)!)).filter((c) => c.chroma >= 40);
    if (tinted.length && tinted.every((c) => apart(c.h, me.h) > 45)) (patches.get(k) ?? patches.set(k, []).get(k)!).push(blob);
  }
  // shape can't tell them apart (a camel's green spots are squares too), so every one is listed for the eye to judge
  for (const [k, blobs] of patches) out.push({ kind: "patch", pts: blobs.flat(), texture: false,
    text: `${blobs.length > 1 ? `${blobs.length} patches` : "a patch"} of ${name(k)} (${blobs.map((b) => b.length).join(", ")} px) in a colour far from everything around ${blobs.length > 1 ? "them" : "it"}: a designed spot, or a stray square that reads as a glitch; look at ${where(blobs.map((b) => b[0]!))}` });
  // 4. palette entries that are the same or nearly the same colour, both in use
  const used = p.palettes.map(() => new Map<number, number>());
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const i = (oy + y) * p.vw + ox + x, u = used[p.row[i]!]!, v = p.px[p.src[i]!]!; u.set(v, (u.get(v) ?? 0) + 1); }
  used.forEach((u, r) => {
    const idx = [...u.keys()].sort((a, b) => a - b), pal = p.palettes[r]!, where = p.palettes.length > 1 ? `palette row ${r}: ` : "";
    const same = new Map<string, number[]>(); for (const i of idx) { const h = hex(pal[i] ?? [0, 0, 0]); (same.get(h) ?? same.set(h, []).get(h)!).push(i); }
    for (const [h, l] of same) if (l.length > 1) out.push({ kind: "palette", pts: [], text: `${where}entries ${l.join(", ")} are all ${h}: harmless if each has its own job, a wasted entry if not`, texture: true });
    for (const a of idx) for (const b of idx) if (a < b && pal[a] && pal[b] && hex(pal[a]!) !== hex(pal[b]!) && dist(pal[a]!, pal[b]!) <= 8)
      out.push({ kind: "palette", pts: [], text: `${where}entries ${a} (${hex(pal[a]!)}, ${u.get(a)} px) and ${b} (${hex(pal[b]!)}, ${u.get(b)} px) are nearly one colour: the console shows them ${dist(pal[a]!.map((v) => v >> 3), pal[b]!.map((v) => v >> 3)) ? "one step apart" : "the same"}`, texture: false });
  });
  out.sort((a, b) => Number(a.texture) - Number(b.texture));
  return out.map((f, i) => ({ ...f, n: i + 1, pts: f.pts.map(([x, y]) => [x! + ox, y! + oy]) }));
}

// ---- sheets ----
const RED = [255, 48, 48], YELLOW = [255, 208, 0];
function paint(p: Pic, x0: number, y0: number, w: number, h: number, scale: number, margin: number) {
  const W = w * scale + margin, H = h * scale + margin, rgba = new Uint8Array(W * H * 4).fill(24), c = canvas(rgba, W, H);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const X = x0 + x, Y = y0 + y; c.box(margin + x * scale, margin + y * scale, scale, scale, X < 0 || Y < 0 || X >= p.vw || Y >= p.vh ? [24, 24, 24] : seen(p, Y * p.vw + X)); }
  return { W, H, rgba, c };
}
/** The whole picture enlarged: a line every 8 pixels, coordinates every 16, each finding ringed and numbered. */
export function sheet(p: Pic, found: Finding[], scale = 8): Uint8Array {
  const [ox, oy, cw, ch] = p.crop as [number, number, number, number], M = 30; scale = Math.max(2, Math.min(scale, Math.floor(4096 / Math.max(cw, ch))));
  const { W, H, rgba, c } = paint(p, ox, oy, cw, ch, scale, M);
  for (let x = Math.ceil(ox / 8) * 8; x <= ox + cw; x += 8) { c.box(M + (x - ox) * scale, M, 1, ch * scale, [255, 255, 255], x % 16 ? 0.12 : 0.28); if (x % 16 === 0 && x < ox + cw) c.label(M + (x - ox) * scale + 1, 8, String(x), [220, 220, 220], 2); }
  for (let y = Math.ceil(oy / 8) * 8; y <= oy + ch; y += 8) { c.box(M, M + (y - oy) * scale, cw * scale, 1, [255, 255, 255], y % 16 ? 0.12 : 0.28); if (y % 16 === 0 && y < oy + ch) c.label(0, M + (y - oy) * scale + 1, String(y), [220, 220, 220], 2); }
  const ring = (cx: number, cy: number, r: number, col: number[]) => { for (let a = 0; a < 720; a++) { const s = Math.sin((a * Math.PI) / 360), k = Math.cos((a * Math.PI) / 360); c.box(Math.round(cx + k * (r + 2)), Math.round(cy + s * (r + 2)), 1, 1, [0, 0, 0]); c.box(Math.round(cx + k * r) , Math.round(cy + s * r), 2, 2, col); } };
  for (const f of [...found].reverse()) f.pts.forEach(([x, y], i) => {
    const cx = M + (x! - ox + 0.5) * scale, cy = M + (y! - oy + 0.5) * scale, col = f.texture ? YELLOW : RED;
    ring(cx, cy, scale * (f.texture ? 1.1 : 1.8), col); if (i < (f.texture ? 2 : 4)) c.label(Math.round(cx + scale * 1.6), Math.round(cy - scale * 1.6 - 14), String(f.n), col, 2);
  });
  return encodePng(rgba, W, H);
}
/** Close-ups: a square of the picture around each place, the pixels in question boxed. Used for findings, and for before and after an edit. */
export function closeUps(pics: Pic[], places: { label: string; pts: number[][]; at?: number[] }[], scale = 8, size = 25): Uint8Array {
  const cell = size * scale + 6, across = Math.max(1, Math.min(Math.floor(5 / pics.length) || 1, places.length)) , tileW = cell * pics.length + 6, W = across * tileW, H = Math.ceil(places.length / across) * (cell + 18) || 1;
  const rgba = new Uint8Array(W * H * 4).fill(24), all = canvas(rgba, W, H);
  places.forEach((pl, n) => {
    const X = (n % across) * tileW, Y = ((n / across) | 0) * (cell + 18), [fx, fy] = (pl.at ?? pl.pts[0]) as [number, number], x0 = fx - (size >> 1), y0 = fy - (size >> 1);
    pics.forEach((p, k) => {
      const part = paint(p, x0, y0, size, size, scale, 0);
      for (let y = 0; y < part.H; y++) rgba.set(part.rgba.subarray(y * part.W * 4, (y + 1) * part.W * 4), ((Y + 16 + y) * W + X + 3 + k * cell) * 4);
      if (k === 0) for (const [x, y] of pl.pts) if (Math.abs(x! - fx) <= size >> 1 && Math.abs(y! - fy) <= size >> 1) all.frame(X + 3 + (x! - x0) * scale - 1, Y + 16 + (y! - y0) * scale - 1, scale + 2, scale + 2, RED);
    });
    all.label(X + 3, Y + 1, pl.label, [230, 230, 230], 2);
  });
  return encodePng(rgba, W, H);
}

// ---- edit ----
/** Apply edits to the picture's pixels in place; returns one line per edit. Throws on anything outside the picture or the palette. */
export function applyEdits(p: Pic, edits: Edit[]): { lines: string[]; touched: number[][]; colours: [number, number[]][] } {
  const lines: string[] = [], touched: number[][] = [], colours: [number, number[]][] = [], top = Math.min((1 << p.depth) - 1, p.palettes[0]!.length - 1), tiles = new Set<number>();
  const int = (l: number[] | undefined, n: number, what: string) => { if (!Array.isArray(l) || l.length !== n || l.some((v) => !Number.isInteger(v))) throw new Error(`${what} needs ${n} whole numbers`); return l; };
  const idx = (v: number) => { if (v < 0 || v > top) throw new Error(`colour number ${v} is not in this picture's palette (0 to ${top})`); return v; };
  const at = (x: number, y: number) => { if (x < 0 || y < 0 || x >= p.vw || y >= p.vh) throw new Error(`(${x},${y}) is outside the picture (${p.vw} x ${p.vh})`); return y * p.vw + x; };
  const put = (x: number, y: number, v: number) => { const i = at(x, y), s = p.src[i]!; if (p.px[s] === v) return 0; p.px[s] = v; touched.push([x, y]); if (p.uses) tiles.add(((s / p.w / 8) | 0) * (p.w >> 3) + ((s % p.w) >> 3)); return 1; };
  edits.forEach((e, n) => {
    let changed = 0, said: string;
    try {
      if (e.set) { const [x, y, v] = int(e.set, 3, "set [x, y, colour]") as [number, number, number]; changed = put(x, y, idx(v)); said = `set (${x},${y}) to ${v}`; }
      else if (e.fill) { const [x, y, w, h, v] = int(e.fill, 5, "fill [x, y, w, h, colour]") as number[]; idx(v!); for (let j = 0; j < h!; j++) for (let i = 0; i < w!; i++) changed += put(x! + i, y! + j, v!); said = `fill ${w} x ${h} at (${x},${y}) with ${v}`; }
      else if (e.replace) { const [x, y, w, h, from, to] = int(e.replace, 6, "replace [x, y, w, h, from, to]") as number[]; idx(to!); for (let j = 0; j < h!; j++) for (let i = 0; i < w!; i++) if (p.px[p.src[at(x! + i, y! + j)]!] === from) changed += put(x! + i, y! + j, to!); said = `replace ${from} by ${to} in ${w} x ${h} at (${x},${y})`; }
      else if (e.bucket) { // the paint bucket: the run of one colour number touching (x, y) side by side, kept inside a box when given
        const [x, y, v] = int(e.bucket, 3, "bucket [x, y, colour]") as [number, number, number], [bx, by, bw, bh] = (e.box ? int(e.box, 4, "box [x, y, w, h]") : [0, 0, p.vw, p.vh]) as number[];
        const inside = (X: number, Y: number) => X >= bx! && Y >= by! && X < bx! + bw! && Y < by! + bh! && X >= 0 && Y >= 0 && X < p.vw && Y < p.vh;
        idx(v); const from = p.px[p.src[at(x, y)]!]!; if (!inside(x, y)) throw new Error(`bucket (${x},${y}) is outside its box`);
        const seenAt = new Uint8Array(p.vw * p.vh), run: number[][] = [], stack = [[x, y]]; seenAt[y * p.vw + x] = 1;
        while (stack.length) { const [a, b] = stack.pop()! as [number, number]; run.push([a, b]);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) { const X = a + dx, Y = b + dy; if (inside(X, Y) && !seenAt[Y * p.vw + X] && p.px[p.src[Y * p.vw + X]!] === from) { seenAt[Y * p.vw + X] = 1; stack.push([X, Y]); } } }
        for (const [a, b] of run) changed += put(a!, b!, v);
        said = `bucket at (${x},${y}): the ${run.length} pixels of colour ${from} joined to it${e.box ? ` inside ${bw} x ${bh} at (${bx},${by})` : ""} to ${v}`;
      }
      else if (e.draw) { // a small drawing typed as rows: one character a pixel, 0-9 a-f the colour number, "." leaves the pixel as it is
        const [x, y] = int(e.draw, 2, "draw [x, y]") as [number, number];
        if (!Array.isArray(e.rows) || !e.rows.length || e.rows.some((r) => typeof r !== "string" || !/^[0-9a-fA-F.]*$/.test(r))) throw new Error('draw needs "rows": ["..e6e..", ...], one character a pixel: 0-9 a-f a colour number, "." left as it is');
        // "onto": only pixels now of these colour numbers are drawn on: [0] puts the drawing BEHIND the figure (wings, a tail, a hood's edge)
        const onto = e.onto === undefined ? undefined : new Set(Array.isArray(e.onto) && e.onto.length && e.onto.every((v) => Number.isInteger(v)) ? e.onto.map(idx) : (() => { throw new Error('"onto" needs a list of colour numbers, e.g. [0] for behind the figure'); })());
        e.rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch !== "." && (!onto || onto.has(p.px[p.src[at(x + i, y + j)]!]!))) changed += put(x + i, y + j, idx(parseInt(ch, 16))); }));
        said = `draw ${Math.max(...e.rows.map((r) => r.length))} x ${e.rows.length} at (${x},${y})${onto ? ` onto colour${onto.size > 1 ? "s" : ""} ${[...onto].join(", ")} only` : ""}`;
      }
      else if (e.copy) { const [sx, sy, w, h, dx, dy] = int(e.copy, 6, "copy [from x, from y, w, h, to x, to y]") as number[]; const got: number[] = []; for (let j = 0; j < h!; j++) for (let i = 0; i < w!; i++) got.push(p.px[p.src[at(sx! + i, sy! + j)]!]!); got.forEach((v, k) => { changed += put(dx! + (k % w!), dy! + ((k / w!) | 0), v); }); said = `copy ${w} x ${h} from (${sx},${sy}) to (${dx},${dy})`; }
      else if (e.colour) {
        const [i, c] = Array.isArray(e.colour) ? e.colour : []; if (!Number.isInteger(i) || typeof c !== "string" || !/^#?[0-9a-f]{6}$/i.test(c)) throw new Error('colour needs [colour number, "#RRGGBB"]');
        if (p.view?.map || p.view?.palette) throw new Error("colour edits change a picture's own palette; a tile sheet's colours are shared with every map that uses them, so change them in its palette files instead");
        idx(i!); const h = c.replace("#", ""), rgb = [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16)), old = p.palettes[0]![i!]!;
        p.palettes[0]![i!] = rgb; p.recoloured = true; colours.push([i!, rgb]);
        said = `colour ${i}: ${hex(old)} > ${hex(rgb)} (${p.px.reduce((n, v) => n + (v === i ? 1 : 0), 0)} pixels use it, none moved)`;
      }
      else throw new Error("an edit is one of set, fill, replace, copy, bucket, draw, colour");
    } catch (err) { throw new Error(`edit ${n + 1}: ${(err as Error).message}`); }
    lines.push(`${String(n + 1).padStart(3)}. ${said}${e.colour ? "" : `: ${changed} pixel${changed === 1 ? "" : "s"} changed`}${e.why ? `   (${e.why})` : ""}`);
  });
  const shared = [...tiles].filter((t) => (p.uses!.get(t) ?? 0) > 1);
  if (shared.length) lines.push(`These tiles are drawn in more than one place, and every place changed with them: ${shared.map((t) => `tile ${t} (${p.uses!.get(t)} places)`).join(", ")}. Look at the whole picture.`);
  return { lines, touched, colours };
}
/** Bring the picture in line with its edits file: from the kept original when the picture is still our last result, else from the picture as it now is (new, or rebuilt from its source). */
export function editPicture(png: string, docFile = editsFile(png)): { lines: string[]; before: Pic; after: Pic; touched: number[][] } {
  const doc = readDoc(png, docFile); if (!doc) throw new Error(`no edits file at ${docFile}. Write one: {"picture": "${basename(png)}", "edits": [{"set": [x, y, colour], "why": "..."}]}`);
  if (!Array.isArray(doc.edits)) throw new Error(`${docFile}: "edits" is a list`);
  const now = readFileSync(png), orig = origFile(png), ours = doc.applied?.result === sha(now), lines: string[] = [];
  const from = doc.base ? resolve(dirname(png), doc.base) : "";
  if (from && !existsSync(from)) throw new Error(`"base": ${doc.base} is not there (the picture this one is made from)`);
  let base: Uint8Array = now;
  if (from) { // a variant: always the base's pixels as they are now, then the edits; the edits file is the whole recipe
    base = readFileSync(from);
    if (doc.applied && doc.applied.base !== sha(base)) lines.push(`${doc.base} changed since the last run: the edits go on its new pixels.`);
    if (doc.applied && !ours) lines.push(`${basename(png)} was changed by something else since the last run: that change is gone (put it in the edits file to keep it).`);
  }
  else if (ours && existsSync(orig)) base = readFileSync(orig);
  else if (!doc.applied && existsSync(orig)) { base = readFileSync(orig); lines.push(`The edits file does not say which picture it was last applied to; ${basename(orig)} is taken as the original. If the picture was rebuilt from its source since, delete ${basename(orig)} and run this again.`); }
  else if (ours) lines.push(`The picture already holds these edits and there is no ${basename(orig)} here: applied on top (git has the original).`);
  else { copyFileSync(png, orig); lines.push(doc.applied ? `The picture changed since the last run (rebuilt from its source?): its new state is kept as ${basename(orig)} and the edits go on top.` : `Original kept as ${basename(orig)}.`); }
  const before = openPic(png, doc.view, base), after = openPic(png, doc.view, base), r = applyEdits(after, doc.edits), bytes = encodePic(after);
  // the palette file the game reads, when it is not the picture: kept the same way (its original beside it, the edits on top)
  let palDone: string | undefined;
  if (doc.colours) {
    const pal = join(dirname(png), doc.colours), porig = origFile(pal);
    if (!/\.pal$/.test(pal) || !existsSync(pal)) throw new Error(`"colours": ${doc.colours} is not a .pal file beside the game's graphics`);
    if (r.colours.length || existsSync(porig)) {
      const nowPal = readFileSync(pal, "utf8"), oursPal = doc.applied?.colours === sha(Buffer.from(nowPal));
      const basePal = existsSync(porig) && (oursPal || !doc.applied?.colours) ? readFileSync(porig, "utf8") : nowPal;
      if (!existsSync(porig) && r.colours.length) copyFileSync(pal, porig);
      if (r.colours.length) { const out = writePal(basePal, r.colours); writeFileSync(pal, out); palDone = sha(Buffer.from(out)); lines.push(`${basename(pal)} (where the game reads these colours): ${r.colours.length} colour${r.colours.length > 1 ? "s" : ""} changed, its original kept as ${basename(porig)}.`); }
      else { writeFileSync(pal, basePal); rmSync(porig); lines.push(`${basename(pal)}: no colour edits any more, its original is back.`); }
    }
  } else if (r.colours.length && doc.base) lines.push(`A variant keeps its colours in its own palette. When it goes into the game, give it a palette file of these colours and point its table entry at it (kit pixel colours <png> checks what the game draws it with).`);
  else if (r.colours.length) lines.push(`These colour edits change the picture's own palette. If the game reads this picture's colours from a .pal file, name it in the edits file as "colours" (kit pixel edit finds it when it can), or the game will not show them.`);
  writeFileSync(png, bytes);
  writeFileSync(docFile, docText({ ...doc, picture: basename(png), applied: { base: sha(base), result: sha(bytes), ...(palDone ? { colours: palDone } : {}) } }));
  return { lines: [...lines, ...r.lines, `${basename(png)}: ${doc.edits.length} edits, ${new Set(r.touched.map(String)).size} pixels differ from ${doc.base ?? "the original"}. Same size${r.colours.length ? `; ${r.colours.length} palette colour${r.colours.length > 1 ? "s" : ""} changed` : ", same palette"}.`], before, after, touched: r.touched };
}
/** The original back in place. The edits file stays (it is the record); running edit again applies it again. */
export function undoPicture(png: string): string {
  const variant = readDoc(png); if (variant?.base) { copyFileSync(resolve(dirname(png), variant.base), png); delete variant.applied; writeFileSync(editsFile(png), docText(variant)); return `${basename(png)} is a copy of ${variant.base} again; its edits file is kept (run edit to put them back on).`; }
  const orig = origFile(png); if (!existsSync(orig)) throw new Error(`no ${basename(orig)} beside the picture: nothing to restore here (git has every earlier version: git log -- ${basename(png)})`);
  copyFileSync(orig, png); rmSync(orig);
  const doc = readDoc(png), pal = doc?.colours ? join(dirname(png), doc.colours) : "";
  if (pal && existsSync(origFile(pal))) { copyFileSync(origFile(pal), pal); rmSync(origFile(pal)); }
  if (doc) { delete doc.applied; writeFileSync(editsFile(png), docText(doc)); }
  return `${basename(png)} is the original again. ${doc ? `Its edits file is kept: delete ${basename(editsFile(png))} if the edits are not wanted, or run edit again to re-apply them.` : ""}`;
}
/** A new picture made from a base: a copy of it, and an edits file that names the base and has no edits yet. */
export function makeVariant(base: string, dest: string): string {
  if (existsSync(dest) || existsSync(editsFile(dest))) throw new Error(`${dest} is already there: a variant starts a new picture (edit the one there instead)`);
  openPic(base); mkdirSync(dirname(resolve(dest)), { recursive: true }); copyFileSync(base, dest);
  const view = readDoc(base)?.view, rel = relative(dirname(resolve(dest)), resolve(base));
  writeFileSync(editsFile(dest), docText({ picture: basename(dest), base: rel, ...(view ? { view } : {}), edits: [] }));
  return rel;
}
// one edit per line, so a change to the file reads as the edits that changed
export const docText = (d: Doc) => `{\n "picture": ${JSON.stringify(d.picture)},${d.base ? `\n "base": ${JSON.stringify(d.base)},` : ""}${d.view ? `\n "view": ${JSON.stringify(d.view)},` : ""}${d.colours ? `\n "colours": ${JSON.stringify(d.colours)},` : ""}\n "edits": [${d.edits.length ? `\n${d.edits.map((e) => `  ${JSON.stringify(e)}`).join(",\n")}\n ` : ""}]${d.applied ? `,\n "applied": ${JSON.stringify(d.applied)}` : ""}\n}\n`;

// ---- command ----
export const PIXEL_HELP = `  kit pixel find <png...> [--crop x,y,w,h] [--map map.bin --pal file.pal --width 32] [--scale 8] [--out dir] [--json]
                             the step after any generated or redrawn picture: stray pixels (single pixels and pairs touching nothing of their
                             colour, colours used by under 4 pixels, soft-edge leftovers, palette entries that are nearly one colour), a zoomed
                             sheet with a grid and each finding ringed and numbered (red: look at it; yellow: many alike, probably texture),
                             close-ups, and a list. A tiles.png with a map.bin beside it is read as the picture the game shows. On a variant
                             (kit pixel variant) only what is new since its base is listed
  kit pixel edit <png> [edits.json] [--undo]   apply explicit edits to the indexed picture, palette and size untouched. The edits file lives beside
                             the picture (<png>.edits.json): {"picture": "x.png", "edits": [{"set": [x, y, colour]}, {"fill": [x, y, w, h, colour]},
                             {"replace": [x, y, w, h, from, to]}, {"copy": [from x, from y, w, h, to x, to y]}, {"bucket": [x, y, colour]},
                             {"draw": [x, y], "rows": ["..e4e..", ".e454e."]}, {"colour": [n, "#RRGGBB"]}]}, each with an optional "why".
                             draw puts a small drawing typed as rows at (x, y): one character a pixel, 0-9 a-f a colour number, "." leaves
                             the pixel (a hat, a hood, a strap drawn by hand); add "onto": [0] to draw only where the picture is
                             see-through, i.e. behind the figure (wings, a tail), or other colour numbers to draw only on those (a pattern
                             on a garment, not on the hair beside it). bucket is the paint bucket: the pixels of one colour
                             number joined side by side to (x, y), to the new colour; add "box": [x, y, w, h] to keep it inside a box (a
                             sleeve, not the face lines drawn in the same colour). colour changes what colour number n looks like (new hair, a new sweater: one
                             edit per shade, keep the shades in order) and no pixel moves; the palette file the game reads (often a .pal in
                             a palettes folder, not the picture) is found and named as "colours" in the edits file, and changed with it
                             (only for a picture inside the game folder: a draft kept elsewhere changes only its own colours).
                             Run it again after the picture is rebuilt from its source and the same edits go back on. --undo restores the
                             original (kept as <png>.orig, and <pal>.orig). Never regenerate a picture to fix a speck or change a colour
  kit pixel variant <base.png> <new.png>   a new picture made from a base (an outfit of a drawing you love): a copy of the base and an edits
                             file naming it as "base", with no edits yet. Every edit run starts from the base's pixels as they are then, so
                             the edits file is the whole recipe and goes back on when the base is redrawn; --undo makes it the base again
  kit pixel colours [png...] which palette file the game draws each picture with (the trainer tables: TRAINER_FRONT_PIC, TRAINER_BACK_PIC)
                             and whether the game shows the picture's own colours. The game draws a picture's colour numbers with that file,
                             not the PNG's palette: one file drawing a front and a back with different colours gives green skin. With no
                             picture, lists every picture the game shows in colours that are not its own`;
export function pixelCommand(game: string, argv: string[]): number {
  const args = [...argv], opt = (n: string) => { const i = args.indexOf(`--${n}`); return i < 0 ? undefined : args.splice(i, 2)[1]; }, has = (n: string) => { const i = args.indexOf(`--${n}`); if (i >= 0) args.splice(i, 1); return i >= 0; };
  const what = args.shift(), rel = (f: string) => relative(game, f) || f, inGame = (f: string) => (existsSync(f) ? resolve(f) : resolve(game, f));
  try {
    if (what === "find") {
      const crop = opt("crop")?.split(",").map(Number), map = opt("map"), palette = opt("pal"), width = opt("width"), scale = Number(opt("scale") ?? 8), out = resolve(opt("out") ?? join(game, "out/pixels")), json = has("json"), all: object[] = [];
      if (!args.length) throw new Error("kit pixel find needs a picture: kit pixel find graphics/x/y.png");
      mkdirSync(out, { recursive: true });
      for (const a of args) {
        const file = inGame(a), auto = openPic(file), view = map || palette || width || crop ? { ...auto.view, ...(map ? { map } : {}), ...(palette ? { palette } : {}), ...(width ? { width: Number(width) } : {}), ...(crop ? { crop } : {}) } : undefined;
        const p = view ? openPic(file, view) : auto, baseOf = readDoc(file)?.base, stem = join(out, rel(file).replace(/\.png$/i, "").replace(/[\\/]/g, "-"));
        let found = find(p), inherited = 0;
        if (baseOf && existsSync(resolve(dirname(file), baseOf))) { // a variant: what its base already has is the base's drawing, not new
          const key = (f: Finding) => `${f.kind}|${f.pts.map(String).sort().join(" ")}|${f.text.replace(/ at .*$/, "").replace(/ \(\d+ like it\)/, "")}`, had = new Set(find(openPic(resolve(dirname(file), baseOf), view)).map(key));
          const fresh = found.filter((f) => !had.has(key(f))); inherited = found.length - fresh.length; found = fresh.map((f, i) => ({ ...f, n: i + 1 }));
        }
        const marked = found.filter((f) => f.pts.length);
        writeFileSync(`${stem}.find.png`, sheet(p, found, scale));
        if (marked.length) writeFileSync(`${stem}.close.png`, closeUps([p], marked.slice(0, 60).map((f) => ({ label: `${f.n}  ${f.pts[0]![0]},${f.pts[0]![1]}`, pts: f.pts }))));
        const look = found.filter((f) => !f.texture).length, text = [`${rel(file)}: ${p.crop[2]} x ${p.crop[3]}${p.view?.map ? ` as the game draws it (${p.view.map}${p.view.palette ? `, ${p.view.palette}` : ""})` : ""}: ${look} to look at, ${found.length - look} probably fine${baseOf ? `; ${inherited} more are in its base ${baseOf} too, so not listed` : ""}`,
          ...found.map((f) => `${String(f.n).padStart(3)}. ${f.texture ? "(texture?) " : ""}${f.kind}: ${f.text}`), `sheet: ${rel(`${stem}.find.png`)}${marked.length ? `   close-ups: ${rel(`${stem}.close.png`)}` : ""}`].join("\n");
        writeFileSync(`${stem}.find.txt`, text + "\n"); all.push({ file: rel(file), crop: p.crop, view: p.view, found, sheet: rel(`${stem}.find.png`) });
        if (!json) console.log(text + "\n");
      }
      if (json) console.log(JSON.stringify(all, null, 1));
      else console.log(`Look at each sheet. Fix a real speck with an edits file (kit pixel edit), leave intended texture alone, never regenerate to fix a speck.`);
      return 0;
    }
    if (what === "variant") {
      const [a, b] = args; if (!a || !b) throw new Error("kit pixel variant needs the base picture and the new one: kit pixel variant graphics/x.png out/y/x_hoodie.png");
      const base = inGame(a), dest = existsSync(b) || b.startsWith("/") ? resolve(b) : resolve(game, b), rel2 = makeVariant(base, dest);
      console.log(`${rel(dest)}: a copy of ${rel(base)}, and ${rel(editsFile(dest))} naming it as "base" ("${rel2}"), no edits yet. Add edits there and run kit pixel edit ${rel(dest)}.`);
      return 0;
    }
    if (what === "colours" || what === "colors") {
      const r = colourCheck(game, args.length ? args.map(inGame) : undefined);
      console.log(r.lines.join("\n") || "Every picture in the trainer tables is drawn in its own colours.");
      if (!args.length && r.problems) console.log(`\n${r.problems} picture${r.problems > 1 ? "s are" : " is"} shown in colours that are not ${r.problems > 1 ? "their" : "its"} own.`);
      return r.problems ? 1 : 0;
    }
    if (what === "edit") {
      const undo = has("undo"), out = resolve(opt("out") ?? join(game, "out/pixels")), a = args.shift(); if (!a) throw new Error("kit pixel edit needs a picture: kit pixel edit graphics/x/y.png");
      const file = inGame(a), docFile = args[0] ? inGame(args[0]) : editsFile(file);
      if (undo) { console.log(undoPicture(file)); return 0; }
      const doc = readDoc(file, docFile);
      if (doc?.edits?.some((e) => e.colour) && !doc.colours && !doc.base) { // where does the game read this picture's colours? (a variant keeps its own until it is installed)
        const g = gamePalette(game, file);
        if (g?.pal) { doc.colours = relative(dirname(file), join(game, g.pal)); writeFileSync(docFile, docText(doc)); console.log(`The game reads this picture's colours from ${g.pal}: named in the edits file as "colours", and changed with the picture.`); }
        else if (g?.own) console.log("The game reads this picture's colours from the picture itself.");
        else console.log(`Could not find where the game reads this picture's colours. If it is a .pal file, add "colours": "<path from the picture's folder>" to the edits file and run this again.`);
      }
      const r = editPicture(file, docFile); console.log(r.lines.join("\n"));
      if (doc?.edits?.some((e) => e.colour)) { // the whole picture before and after, since a colour is everywhere it is used
        const to = join(out, rel(file).replace(/\.png$/i, "").replace(/[\\/]/g, "-") + ".colours.png"); mkdirSync(out, { recursive: true });
        writeFileSync(to, closeUps([r.before, r.after], [{ label: "before > after", pts: [] , at: [r.after.vw >> 1, r.after.vh >> 1] }], Math.max(2, Math.floor(512 / Math.max(r.after.vw, r.after.vh))), Math.max(r.after.vw, r.after.vh)));
        console.log(`the whole picture before and after: ${rel(to)}`);
      }
      if (r.touched.length) { // before and after, side by side, around each place touched
        const places: number[][] = []; for (const t of r.touched) if (!places.some((q) => Math.abs(q[0]! - t[0]!) < 10 && Math.abs(q[1]! - t[1]!) < 10)) places.push(t);
        const to = join(out, rel(file).replace(/\.png$/i, "").replace(/[\\/]/g, "-") + ".edit.png"); mkdirSync(out, { recursive: true });
        writeFileSync(to, closeUps([r.before, r.after], places.slice(0, 40).map((q) => ({ label: `${q[0]},${q[1]} before > after`, pts: r.touched.filter((t) => Math.abs(q[0]! - t[0]!) < 10 && Math.abs(q[1]! - t[1]!) < 10) }))));
        console.log(`before and after: ${rel(to)}\nBuild, then look at it in the game.`);
      }
      return 0;
    }
    console.log(PIXEL_HELP); return what && what !== "help" ? 1 : 0;
  } catch (e) { console.error(`kit pixel: ${(e as Error).message}`); return 1; }
}
