// kit/maps.ts: read the tree's own map files. listMaps() summarises maps; renderMap() draws a whole map to a PNG
// from its layout and tilesets (block data, metatiles, tile sheets, palettes), for any map in any supplied tree.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { canvas, decodeIndexed, encodePng } from "./png";

export const json = (f: string) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch (e) { throw new Error(`${f} cannot be read (${(e as Error).message})`); } }; // says which file
export const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
export const short = (s: unknown) => String(s ?? "").replace(/^(MAP_|LOCALID_|OBJ_EVENT_GFX_|gTileset_)/, "");
export const u16s = (f: string) => { const b = readFileSync(f); return Array.from({ length: b.length >> 1 }, (_, i) => b.readUInt16LE(i * 2)); };

export type MapInfo = { name: string; id: string; layout: string; type: string; group: number; number: number; width: number; height: number; tilesets: string[];
  joins: { direction: string; to: string; offset: number }[]; doors: { door: number; x: number; y: number; to: string; to_door: string }[]; people: number; signs: number; triggers: number };

export function layouts(game: string): Map<string, any> { return new Map(json(join(game, "data/layouts/layouts.json")).layouts.filter((l: any) => l?.id).map((l: any) => [l.id, l])); }
/** Every map with its group and number (the numbers `where` and `warp` use), optionally leaving out the names in `skip`. */
export function listMaps(game: string, skip: Set<string> = new Set()): MapInfo[] {
  const groups = json(join(game, "data/maps/map_groups.json")), lay = layouts(game), out: MapInfo[] = [];
  groups.group_order.forEach((g: string, gi: number) => (groups[g] as string[]).forEach((name, ni) => {
    if (skip.has(name)) return;
    const m = json(join(game, "data/maps", name, "map.json")), l = lay.get(m.layout);
    out.push({ name, id: m.id, layout: m.layout, type: String(m.map_type ?? "").replace("MAP_TYPE_", "").toLowerCase(), group: gi, number: ni, width: l?.width ?? 0, height: l?.height ?? 0, tilesets: [short(l?.primary_tileset), short(l?.secondary_tileset)],
      joins: arr(m.connections).map((c: any) => ({ direction: c.direction, to: short(c.map), offset: c.offset })),
      doors: arr(m.warp_events).map((w: any, i: number) => ({ door: i, x: w.x, y: w.y, to: short(w.dest_map), to_door: String(w.dest_warp_id) })),
      people: arr(m.object_events).length, signs: arr(m.bg_events).length, triggers: arr(m.coord_events).length });
  }));
  return out;
}
/** Map names in the list of maps as it was in an older version of the file (the text of map_groups.json). */
export function mapNames(groupsJson: string): Set<string> { const g = JSON.parse(groupsJson); return new Set(g.group_order.flatMap((k: string) => g[k])); }
export function mapText(m: MapInfo): string {
  return [`${m.name}  map ${m.group}.${m.number}  ${m.width}x${m.height} squares  people ${m.people}, signs ${m.signs}, triggers ${m.triggers}  tilesets ${m.tilesets.join(" + ")}`,
    ...m.joins.map((j) => `  joins ${j.direction}: ${j.to}${j.offset ? ` (shifted ${j.offset})` : ""}`),
    ...m.doors.map((d) => `  door ${d.door} at (${d.x},${d.y}) -> ${d.to} door ${d.to_door}`)].join("\n");
}

// ---- drawing ----
export type Tileset = { dir: string; tiles: { w: number; h: number; px: Uint8Array }; pals: (number[][] | null)[]; meta: number[]; per: number };
export function tileset(game: string, symbol: string): Tileset {
  // where the tileset's files are: its header names its tile and metatile data, and those name their folders
  const src = (f: string) => { const p = join(game, "src/data/tilesets", f); return existsSync(p) ? readFileSync(p, "utf8") : ""; };
  const head = new RegExp(`${symbol}\\s*=\\s*\\{([^}]*)\\}`).exec(src("headers.h"))?.[1] ?? "";
  const folder = (field: string, file: string, leaf: string) => { const s = new RegExp(`\\.${field}\\s*=\\s*(\\w+)`).exec(head)?.[1]; const m = s && new RegExp(`${s}\\[\\][^"]*"([^"]+)/${leaf}`).exec(src(file)); return m ? join(game, m[1]!) : null; };
  const guess = short(symbol).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase(), byName = ["primary", "secondary"].map((k) => join(game, "data/tilesets", k, guess)).find(existsSync);
  const tdir = folder("tiles", "graphics.h", "tiles\\."), mdir = folder("metatiles", "metatiles.h", "metatiles\\.bin") ?? tdir ?? byName, tilesDir = tdir ?? byName;
  if (!tilesDir || !mdir || !existsSync(join(tilesDir, "tiles.png"))) throw new Error(`cannot find the files of tileset ${symbol} (looked in src/data/tilesets/headers.h and data/tilesets/*/${guess})`);
  const pdir = [mdir, tilesDir].find((d) => existsSync(join(d, "palettes"))) ?? mdir;
  const pals = Array.from({ length: 16 }, (_, i) => { const f = join(pdir, "palettes", `${String(i).padStart(2, "0")}.pal`); return existsSync(f) ? readFileSync(f, "utf8").split(/\r?\n/).slice(3, 19).map((l) => l.trim().split(/\s+/).map(Number)) : null; });
  const meta = u16s(join(mdir, "metatiles.bin")), attr = readFileSync(join(mdir, "metatile_attributes.bin")).length, n8 = meta.length / 8;
  const per = attr === n8 * 2 || attr === n8 * 4 ? 8 : 12; // 12: the tree stores three layers per metatile
  return { dir: mdir, tiles: decodeIndexed(readFileSync(join(tilesDir, "tiles.png")), `${symbol} tiles.png`), pals, meta, per };
}

export type Overlay = "people" | "doors" | "joins" | "collision";
export type Tiles = { prim: Tileset; sec: Tileset; NT: number; NM: number; NP: number };
/** The two tilesets of a layout and how ids split between them: the layout's own family, else the tree's defines, else the usual numbers. */
export function tilesOf(game: string, l: any): Tiles {
  const fm = existsSync(join(game, "include/fieldmap.h")) ? readFileSync(join(game, "include/fieldmap.h"), "utf8") : "", def = (k: string, d: number) => Number(new RegExp(`#define ${k}\\s+(\\d+)`).exec(fm)?.[1] ?? d);
  const [NT, NM, NP] = l.layout_version === "frlg" ? [640, 640, 7] : [def("NUM_TILES_IN_PRIMARY", 512), def("NUM_METATILES_IN_PRIMARY", 512), def("NUM_PALS_IN_PRIMARY", 6)];
  return { prim: tileset(game, l.primary_tileset), sec: tileset(game, l.secondary_tileset), NT, NM, NP };
}
/** Draw one 16x16 building block (metatile) into RGBA pixels of width w at (ox, oy). */
export function drawBlock({ prim, sec, NT, NM, NP }: Tiles, id: number, px: Uint8Array, w: number, ox: number, oy: number) {
  const ts = id < NM ? prim : sec, at = (id < NM ? id : id - NM) * ts.per;
  // a metatile is 2x2 tiles per layer, lower layers first. The three layer types (normal, covered, split) differ only in
  // which layers go in front of people; flat on a picture they stack the same way, so drawing in order is right for all three.
  for (let k = 0; k < ts.per; k++) {
    const t = ts.meta[at + k]; if (t === undefined) continue;
    const tile = t & 0x3ff, sheet = tile < NT ? prim.tiles : sec.tiles, ti = tile < NT ? tile : tile - NT, p = t >> 12, pal = (p < NP ? prim : sec).pals[p] ?? prim.pals[p] ?? sec.pals[p];
    const cols = sheet.w >> 3, sx0 = (ti % cols) * 8, sy0 = Math.floor(ti / cols) * 8; if (sy0 + 8 > sheet.h || !pal) continue;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const c = sheet.px[(sy0 + (t & 0x800 ? 7 - y : y)) * sheet.w + sx0 + (t & 0x400 ? 7 - x : x)]! & 15; if (!c) continue; // colour 0 is see-through
      px.set(pal[c] ?? [255, 0, 255], ((oy + (k & 2 ? 8 : 0) + y) * w + ox + (k & 1 ? 8 : 0) + x) * 4);
    }
  }
}
/** Enlarge RGBA pixels by a whole number. */
export function enlarge(px: Uint8Array, w: number, h: number, scale: number): Uint8Array {
  const W = w * scale, big = new Uint8Array(W * h * scale * 4);
  for (let y = 0; y < h * scale; y++) for (let x = 0; x < W; x++) { const s = (Math.floor(y / scale) * w + Math.floor(x / scale)) * 4; big.set(px.subarray(s, s + 4), (y * W + x) * 4); }
  return big;
}
/** Draw the whole map. Returns the PNG, the pixels and a legend in plain lines. */
export function renderMap(game: string, name: string, overlays: Set<Overlay>, scale = 2): { png: Uint8Array; rgba: Uint8Array; width: number; height: number; legend: string[] } {
  const file = join(game, "data/maps", name, "map.json");
  if (!existsSync(file)) { const all = readdirSync(join(game, "data/maps")).filter((d) => d.toLowerCase().includes(name.toLowerCase())).slice(0, 8); throw new Error(`no map named ${name}.${all.length ? ` Did you mean: ${all.join(", ")}?` : " kit maps --all lists them."}`); }
  const m = json(file), lay = layouts(game), l = lay.get(m.layout); if (!l) throw new Error(`${name} names the layout ${m.layout}, which is not in data/layouts/layouts.json`);
  const T = tilesOf(game, l), blocks = u16s(join(game, l.blockdata_filepath));
  const w = l.width * 16, h = l.height * 16, px = new Uint8Array(w * h * 4), back = T.prim.pals[0]?.[0] ?? [0, 0, 0];
  for (let i = 0; i < w * h; i++) px.set([...back, 255], i * 4);
  for (let by = 0; by < l.height; by++) for (let bx = 0; bx < l.width; bx++) drawBlock(T, blocks[by * l.width + bx]! & 0x3ff, px, w, bx * 16, by * 16);
  // enlarge, then draw the overlays at the final size so labels stay sharp
  const W = w * scale, H = h * scale, big = enlarge(px, w, h, scale), S = 16 * scale, fs = scale >= 2 ? 2 : 1;
  const cv = canvas(big, W, H), placed: number[][] = [], legend = [`${name}: ${l.width}x${l.height} squares, tilesets ${short(l.primary_tileset)} + ${short(l.secondary_tileset)}`];
  if (overlays.has("collision")) { let n = 0; blocks.forEach((b, i) => { if (b & 0xc00 && i < l.width * l.height) { n++; cv.box((i % l.width) * S, Math.floor(i / l.width) * S, S, S, [255, 40, 40], 0.4); } }); legend.push(`collision: ${n} of ${l.width * l.height} squares cannot be walked on (tinted red)`); }
  if (overlays.has("doors")) arr(m.warp_events).forEach((d: any, i: number) => { cv.frame(d.x * S, d.y * S, S, S, [0, 230, 255], scale); cv.label(d.x * S, d.y * S - 7 * fs, `D${i}`, [0, 230, 255], fs); legend.push(`door D${i} at (${d.x},${d.y}) -> ${short(d.dest_map)} door ${d.dest_warp_id}`); });
  const names: string[] = arr(m.object_events).map((o: any) => (typeof o.local_id === "string" && o.local_id.startsWith("LOCALID_") ? short(o.local_id) : short(o.graphics_id)));
  let lead = names.length > 1 ? names[0]!.split("_").slice(0, -1) : []; // words every name starts with say nothing on a label
  for (const n of names) while (lead.length && !n.startsWith(lead.join("_") + "_")) lead = lead.slice(0, -1);
  if (overlays.has("people")) arr(m.object_events).forEach((o: any, i: number) => {
    const who = names[i]!.slice(lead.length ? lead.join("_").length + 1 : 0), d = Math.round(S / 2);
    cv.box(o.x * S + (S - d) / 2 - scale, o.y * S + (S - d) / 2 - scale, d + 2 * scale, d + 2 * scale, [0, 0, 0]); cv.box(o.x * S + (S - d) / 2, o.y * S + (S - d) / 2, d, d, [255, 220, 0]);
    const text = who.slice(0, 14), lw = (text.length * 4 + 1) * fs; let ly = (o.y + 1) * S; // step down past labels already there
    while (placed.some((r) => Math.abs(r[1]! - ly) < 7 * fs && o.x * S < r[0]! + r[2]! && r[0]! < o.x * S + lw)) ly += 7 * fs + 1;
    placed.push([o.x * S, ly, lw]); cv.label(o.x * S, ly, text, [255, 220, 0], fs); legend.push(`person ${who} at (${o.x},${o.y})${o.script && o.script !== "0x0" && o.script !== "NULL" ? `  script ${o.script}` : ""}`);
  });
  if (overlays.has("joins")) arr(m.connections).forEach((c: any) => {
    const side = c.direction === "up" || c.direction === "down", len = side ? l.width : l.height, mid = Math.max(1, Math.min(len - 2, c.offset + 3)), a = 5 * scale, green = [80, 255, 120];
    const cx = side ? mid * S + S / 2 : c.direction === "left" ? a + 2 : W - a - 3, cy = side ? (c.direction === "up" ? a + 2 : H - a - 3) : mid * S + S / 2;
    for (let i = 0; i <= a; i++) { // a filled arrowhead pointing off the edge
      if (c.direction === "up") cv.box(cx - i, cy - a + i, 2 * i + 1, 1, green); else if (c.direction === "down") cv.box(cx - i, cy + a - i, 2 * i + 1, 1, green);
      else if (c.direction === "left") cv.box(cx - a + i, cy - i, 1, 2 * i + 1, green); else if (c.direction === "right") cv.box(cx + a - i, cy - i, 1, 2 * i + 1, green);
    }
    if (side || c.direction === "left" || c.direction === "right") cv.label(side ? cx + a + 2 : c.direction === "left" ? cx + a + 2 : cx - a - 2 - (short(c.map).length * 4 + 1) * fs, side ? (c.direction === "up" ? 2 : H - 7 * fs - 2) : cy - 3 * fs, short(c.map), green, fs);
    legend.push(`joins ${c.direction}: ${short(c.map)}${c.offset ? ` (shifted ${c.offset})` : ""}`);
  });
  return { png: encodePng(big, W, H), rgba: big, width: W, height: H, legend };
}
