// kit/tilesets.ts: what a tileset is used for. A first-guess role for every building block (for the restyle scene),
// the maps that use it, and a before/after picture of maps from the last kept commit and now.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canvas, encodePng } from "./png";
import { drawBlock, enlarge, layouts, listMaps, renderMap, short, tilesOf, u16s, type MapInfo } from "./maps";

const key = (s: string) => short(s).toLowerCase().replace(/[_\s-]/g, "");
/** The tileset's name in the source, from what the user typed (general, General, gTileset_General). */
export function findTileset(game: string, name: string): { symbol: string; primary: boolean } {
  const all = [...layouts(game).values()], prims = new Set(all.map((l) => l.primary_tileset as string)), secs = new Set(all.map((l) => l.secondary_tileset as string));
  const symbol = [...prims, ...secs].find((s) => s && key(s) === key(name));
  if (!symbol) throw new Error(`no tileset named ${name}. Some that exist: ${[...prims, ...secs].filter(Boolean).map(short).filter((s) => key(s).includes(key(name).slice(0, 4))).slice(0, 10).join(", ") || [...prims].map(short).join(", ")}`);
  return { symbol, primary: prims.has(symbol) };
}
export function tilesetMaps(game: string, symbol: string): MapInfo[] { return listMaps(game).filter((m) => m.tilesets.includes(short(symbol))); }

const COLOURS: Record<string, number[]> = { ground: [150, 220, 120], path: [230, 200, 140], floor: [220, 220, 220], tall_grass: [60, 200, 60], foliage: [40, 150, 60], water: [90, 160, 255], ledge: [255, 170, 60], flower: [255, 130, 200], roof: [255, 110, 90], door: [0, 230, 255], object: [255, 220, 0] };
/** First guess from the block's behaviour, then from where maps put it and its main colour. A person or agent corrects it in roles.json. */
function guess(beh: string, used: number, solid: number, solidBelow: number, indoor: boolean, [r, g, b]: number[]): string {
  const green = g! > r! * 1.1 && g! > b! * 1.1, warm = r! > g! && g! >= b! && r! - b! > 50;
  if (/TALL_GRASS|LONG_GRASS/.test(beh)) return "tall_grass";
  if (/WATER|OCEAN|PUDDLE|SEAWEED|WATERFALL/.test(beh)) return "water";
  if (/JUMP_|LEDGE/.test(beh)) return "ledge";
  if (/DOOR|WARP|STAIRS|LADDER/.test(beh)) return "door";
  if (used && solid / used > 0.5) return indoor ? "object" : green ? "foliage" : warm && solidBelow / used > 0.5 ? "roof" : "object"; // hard: green is a tree or hedge, warm and resting on more hard blocks is a roof
  return indoor ? "floor" : warm && !green ? "path" : "ground";
}
/** The role table and its contact sheet (every block drawn, labelled with its number and guessed role). */
export function roleTable(game: string, name: string): { table: any; dir: string; sheet: Uint8Array; summary: string } {
  const { symbol, primary } = findTileset(game, name), maps = tilesetMaps(game, symbol), lay = layouts(game);
  if (!maps.length) throw new Error(`no map uses ${short(symbol)}, so there is nothing to guess from`);
  const partner = maps.map((m) => lay.get(m.layout)).sort((a, b) => b.width * b.height - a.width * a.height)[0], T = tilesOf(game, partner), ts = primary ? T.prim : T.sec, base = primary ? 0 : T.NM;
  const attr = readFileSync(join(ts.dir, "metatile_attributes.bin")), count = ts.meta.length / ts.per, wide = attr.length / count >= 4;
  const bh = join(game, "include/constants/metatile_behaviors.h"), names = existsSync(bh) ? [...readFileSync(bh, "utf8").matchAll(/^\s*(MB_\w+)\s*,/gm)].map((m) => m[1]!) : [];
  const stat = Array.from({ length: count }, () => ({ used: 0, solid: 0, below: 0, maps: new Map<string, number>() }));
  for (const m of maps) { // how every map uses each block: how often, how often as a wall, and whether what is under it is a wall too
    const l = lay.get(m.layout), b = u16s(join(game, l.blockdata_filepath));
    for (let i = 0; i < l.width * l.height; i++) {
      const id = (b[i]! & 0x3ff) - base, s = stat[id]; if (id < 0 || !s || (primary && (b[i]! & 0x3ff) >= T.NM)) continue;
      s.used++; if (b[i]! & 0xc00) s.solid++; if ((b[i + l.width] ?? 0xc00) & 0xc00) s.below++; s.maps.set(m.name, (s.maps.get(m.name) ?? 0) + 1);
    }
  }
  const indoor = maps.filter((m) => m.type === "indoor").length > maps.length / 2, COLS = 16, CW = 46, CH = 50, rows = Math.ceil(count / COLS), W = COLS * CW, H = rows * CH;
  const px = new Uint8Array(W * H * 4).fill(40), cv = canvas(px, W, H), tile = new Uint8Array(16 * 16 * 4), metatiles: Record<string, any> = {}, tally: Record<string, number> = {};
  for (let id = 0; id < count; id++) {
    const v = wide ? attr.readUInt32LE(id * 4) : attr.readUInt16LE(id * 2), behaviour = names[wide ? v & 0x1ff : v & 0xff] ?? `behaviour ${wide ? v & 0x1ff : v & 0xff}`, layer = wide ? (v >>> 29) & 3 : v >> 12, s = stat[id]!;
    const x = (id % COLS) * CW, y = Math.floor(id / COLS) * CH, mean = [0, 0, 0];
    tile.fill(0); for (let i = 0; i < 256; i++) tile.set([...(T.prim.pals[0]?.[0] ?? [0, 0, 0]), 255], i * 4);
    drawBlock(T, id + base, tile, 16, 0, 0);
    for (let i = 0; i < 256; i++) for (let c = 0; c < 3; c++) mean[c]! += tile[i * 4 + c]! / 256;
    const role = guess(behaviour, s.used, s.solid, s.below, indoor, mean);
    const big = enlarge(tile, 16, 16, 2); for (let r = 0; r < 32; r++) px.set(big.subarray(r * 128, r * 128 + 128), ((y + 2 + r) * W + x + 2) * 4);
    cv.label(x + 1, y + 35, `${id}${s.used ? "" : " -"}`, [255, 255, 255]); cv.label(x + 1, y + 42, role, COLOURS[role] ?? [255, 255, 255]);
    metatiles[id] = { role, behaviour, layer, main_colour: mean.map(Math.round), used: s.used, solid: s.solid, in_maps: s.maps.size, maps: Object.fromEntries([...s.maps].sort((a, b) => b[1] - a[1]).slice(0, 3)), at: [x + 2, y + 2] };
    tally[role] = (tally[role] ?? 0) + 1;
  }
  const table = { profile: indoor ? "indoor" : "outdoor", tileset: short(symbol),
    about: 'A first guess at the role of every building block, from its behaviour, where maps use it and its main colour. Edit "role" to correct it. Roles: ground, path, floor, tall_grass, foliage, water, ledge, flower, roof, door, object. "at" is where the block is drawn (32x32) on the contact sheet; "layer" is 0 normal, 1 covered, 2 split; "used" 0 means no map uses it.', metatiles };
  return { table, dir: ts.dir, sheet: encodePng(px, W, H), summary: `${short(symbol)}: ${count} blocks, ${indoor ? "indoor" : "outdoor"}, used by ${maps.length} maps. Guessed: ${Object.entries(tally).map(([k, n]) => `${n} ${k}`).join(", ")}; ${stat.filter((s) => !s.used).length} are used by no map` };
}

/** Maps drawn from two trees (the last kept commit and now), side by side, one row per map. */
export function beforeAfter(before: string, now: string, names: string[]): { png: Uint8Array; width: number; height: number; lines: string[] } {
  const rows = names.map((n) => ({ n, a: renderMap(before, n, new Set(), 1), b: renderMap(now, n, new Set(), 1) })), gap = 8, top = 10;
  const W = Math.max(...rows.map((r) => r.a.width + gap + r.b.width)), H = rows.reduce((h, r) => h + top + Math.max(r.a.height, r.b.height), 0), px = new Uint8Array(W * H * 4).fill(30), cv = canvas(px, W, H), lines: string[] = [];
  let y = 0;
  for (const r of rows) {
    cv.label(0, y + 1, `${r.n} BEFORE`, [255, 255, 255]); cv.label(r.a.width + gap, y + 1, `${r.n} NOW`, [120, 255, 120]);
    for (const [img, x0] of [[r.a, 0], [r.b, r.a.width + gap]] as const) for (let j = 0; j < img.height; j++) px.set(img.rgba.subarray(j * img.width * 4, (j + 1) * img.width * 4), ((y + top + j) * W + x0) * 4);
    let diff = 0; if (r.a.rgba.length === r.b.rgba.length) { for (let i = 0; i < r.a.rgba.length; i += 4) if (r.a.rgba[i] !== r.b.rgba[i] || r.a.rgba[i + 1] !== r.b.rgba[i + 1] || r.a.rgba[i + 2] !== r.b.rgba[i + 2]) diff++; } else diff = -1;
    lines.push(`${r.n}: ${diff < 0 ? "its size changed" : diff ? `${diff} of ${r.a.width * r.a.height} pixels differ` : "no difference"}`);
    y += top + Math.max(r.a.height, r.b.height);
  }
  return { png: encodePng(px, W, H), width: W, height: H, lines };
}

export type FoundObject = { n: number; kind: "whole" | "part"; w: number; h: number; blocks: (string | null)[][]; placed: number; at: { map: string; x: number; y: number } | null; solid: number; doors: number[][]; over_player: boolean; irregular: boolean };
/** Candidate multi-block objects of a tileset: blocks that maps always place side by side in the same arrangement (a house, a sign, a tree). */
export function findObjects(game: string, name: string): { objects: FoundObject[]; sheet: Uint8Array; width: number; height: number; summary: string } {
  const { symbol, primary } = findTileset(game, name), maps = tilesetMaps(game, symbol), lay = layouts(game);
  if (!maps.length) throw new Error(`no map uses ${short(symbol)}, so there is nothing to find objects on`);
  const partner = maps.map((m) => lay.get(m.layout)).sort((a, b) => b.width * b.height - a.width * a.height)[0], T = tilesOf(game, partner), ts = primary ? T.prim : T.sec, lo = primary ? 0 : T.NM, hi = primary ? T.NM : 1024;
  const attr = readFileSync(join(ts.dir, "metatile_attributes.bin")), count = ts.meta.length / ts.per, wide = attr.length / count >= 4;
  const bh = join(game, "include/constants/metatile_behaviors.h"), names = existsSync(bh) ? [...readFileSync(bh, "utf8").matchAll(/^\s*(MB_\w+)\s*,/gm)].map((m) => m[1]!) : [];
  const beh = (id: number) => { const v = wide ? attr.readUInt32LE((id - lo) * 4) : attr.readUInt16LE((id - lo) * 2); return names[wide ? v & 0x1ff : v & 0xff] ?? ""; };
  const own = (id: number) => id >= lo && id < hi && id - lo < count, grids = maps.map((m) => { const l = lay.get(m.layout); return { m, w: l.width as number, h: l.height as number, b: u16s(join(game, l.blockdata_filepath)) }; });
  const placed = new Map<number, number>(), solid = new Map<number, number>(), pair = [new Map<string, number>(), new Map<string, number>()], from = [new Map<number, number>(), new Map<number, number>()], into = [new Map<number, number>(), new Map<number, number>()];
  const bump = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const { w, h, b } of grids) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = b[y * w + x]!, a = v & 0x3ff; if (!own(a)) continue;
    bump(placed, a); if (v & 0xc00) bump(solid, a);
    [x + 1 < w ? b[y * w + x + 1]! & 0x3ff : -1, y + 1 < h ? b[(y + 1) * w + x]! & 0x3ff : -1].forEach((n, d) => { if (n < 0) return; bump(from[d]!, a); bump(into[d]!, n); if (own(n) && n !== a) bump(pair[d]!, `${a},${n}`); });
  }
  // a link holds when A is nearly always followed by B and B nearly always preceded by A
  const parent = new Map<number, number>(), find = (a: number): number => { const p = parent.get(a) ?? a; if (p === a) return a; const r = find(p); parent.set(a, r); return r; }, links: [number, number, number][] = [];
  pair.forEach((m, d) => { for (const [k, n] of m) { const [a, b] = k.split(",").map(Number) as [number, number]; if (n >= 0.9 * from[d]!.get(a)! && n >= 0.9 * into[d]!.get(b)!) { links.push([a, b, d]); parent.set(find(a), find(b)); } } });
  const groups = new Map<number, number[]>(); for (const [a, b] of links) for (const id of [a, b]) { const r = find(id), g = groups.get(r) ?? []; if (!g.includes(id)) g.push(id); groups.set(r, g); }
  const top = (id: number) => { for (let k = 4; k < 8; k++) if (ts.meta[(id - lo) * ts.per + k]! & 0x3ff) return true; return false; };
  const found: FoundObject[] = [];
  for (const ids of groups.values()) {
    if (!ids.some((id) => (solid.get(id) ?? 0) > (placed.get(id) ?? 0) / 2 || top(id))) continue; // flat ground patterns are not objects
    const pos = new Map<number, [number, number]>([[ids[0]!, [0, 0]]]), queue = [ids[0]!]; let irregular = false;
    while (queue.length) { const id = queue.shift()!, [x, y] = pos.get(id)!; for (const [a, b, d] of links) { const other = a === id ? b : b === id ? a : -1; if (other < 0) continue; const s = a === id ? 1 : -1, p: [number, number] = d ? [x, y + s] : [x + s, y]; const had = pos.get(other); if (!had) { pos.set(other, p); queue.push(other); } else if (had[0] !== p[0] || had[1] !== p[1]) irregular = true; } }
    const xs = [...pos.values()].map((p) => p[0]), ys = [...pos.values()].map((p) => p[1]), x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0 + 1, h = Math.max(...ys) - y0 + 1;
    const cells: (number | null)[][] = Array.from({ length: h }, () => Array(w).fill(null)); for (const [id, [x, y]] of pos) cells[y - y0]![x - x0] = id;
    let at: FoundObject["at"] = null, times = 0;
    for (const g of grids) for (let y = 0; y + h <= g.h; y++) for (let x = 0; x + w <= g.w; x++) if (cells.every((row, j) => row.every((id, i) => id === null || (g.b[(y + j) * g.w + x + i]! & 0x3ff) === id))) { times++; at ??= { map: g.m.name, x, y }; }
    found.push({ n: 0, kind: "part", w, h, blocks: cells.map((r) => r.map((id) => (id === null ? null : id.toString(16)))), placed: times, at, solid: ids.filter((id) => (solid.get(id) ?? 0) > (placed.get(id) ?? 0) / 2).length, irregular,
      doors: cells.flatMap((r, j) => r.flatMap((id, i) => (id !== null && /DOOR|WARP|STAIRS|LADDER/.test(beh(id)) ? [[i, j]] : []))), over_player: ids.some(top) });
  }
  // whole things as maps place them: touching squares of this tileset that are solid or drawn over the player, the same shape counted once
  const wholes = new Map<string, FoundObject>();
  for (const g of grids) {
    const stand = (i: number) => { const v = g.b[i]!; return own(v & 0x3ff) && ((v & 0xc00) !== 0 || top(v & 0x3ff)); }, seen = new Uint8Array(g.w * g.h);
    for (let i0 = 0; i0 < g.w * g.h; i0++) {
      if (seen[i0] || !stand(i0)) continue;
      const comp = [i0], q = [i0]; seen[i0] = 1;
      while (q.length) { const i = q.pop()!, x = i % g.w; for (const n of [x > 0 ? i - 1 : -1, x + 1 < g.w ? i + 1 : -1, i - g.w, i + g.w]) if (n >= 0 && n < g.w * g.h && !seen[n] && stand(n)) { seen[n] = 1; comp.push(n); q.push(n); } }
      const xs = comp.map((i) => i % g.w), ys = comp.map((i) => Math.floor(i / g.w)), x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0 + 1, h = Math.max(...ys) - y0 + 1;
      if (comp.length < 2 || w > 8 || h > 8 || comp.length < 0.6 * w * h) continue; // a wall of trees, a cliff line or a ring of fence is not one object
      const cells: (number | null)[][] = Array.from({ length: h }, () => Array(w).fill(null)); for (const i of comp) cells[Math.floor(i / g.w) - y0]![(i % g.w) - x0] = g.b[i]! & 0x3ff;
      const key = JSON.stringify(cells), had = wholes.get(key); if (had) { had.placed++; continue; }
      const ids = comp.map((i) => g.b[i]! & 0x3ff);
      wholes.set(key, { n: 0, kind: "whole", w, h, blocks: cells.map((r) => r.map((id) => (id === null ? null : id.toString(16)))), placed: 1, at: { map: g.m.name, x: x0, y: y0 }, solid: comp.filter((i) => g.b[i]! & 0xc00).length, irregular: false,
        doors: cells.flatMap((r, j) => r.flatMap((id, i) => (id !== null && /DOOR|WARP|STAIRS|LADDER/.test(beh(id)) ? [[i, j]] : []))), over_player: ids.some(top) });
    }
  }
  const inWhole = [...wholes.values()].map((o) => new Set(o.blocks.flat().filter(Boolean))), parts = found.filter((o) => !inWhole.some((set) => o.blocks.flat().every((id) => id === null || set.has(id))));
  found.length = 0; const order = (a: FoundObject, b: FoundObject) => b.placed - a.placed || b.w * b.h - a.w * a.h; // what is placed most is what a redraw changes most
  found.push(...[...wholes.values()].sort(order), ...parts.sort(order));
  found.forEach((o, i) => (o.n = i + 1));
  // contact sheet: each object as the maps draw it, numbered
  const S = 2, pad = 6, W = 720, placedAt: number[][] = []; let cx = pad, cy = pad, rowH = 0;
  const shown = found.slice(0, 48);
  for (const o of shown) { const ow = Math.max(o.w * 16 * S, 60), oh = o.h * 16 * S + 9; if (cx + ow + pad > W) { cx = pad; cy += rowH + pad; rowH = 0; } placedAt.push([cx, cy]); cx += ow + pad; rowH = Math.max(rowH, oh); }
  const H = Math.max(cy + rowH + pad, 20), px = new Uint8Array(W * H * 4).fill(40), cv = canvas(px, W, H), tile = new Uint8Array(16 * 16 * 4), back = T.prim.pals[0]?.[0] ?? [0, 0, 0];
  shown.forEach((o, k) => {
    const [ox, oy] = placedAt[k]!; cv.label(ox, oy, `${o.n} ${o.w}X${o.h} ${o.placed}`, [255, 255, 255]);
    o.blocks.forEach((row, j) => row.forEach((id, i) => {
      if (id === null) return; for (let p = 0; p < 256; p++) tile.set([...back, 255], p * 4); drawBlock(T, parseInt(id, 16), tile, 16, 0, 0);
      const big = enlarge(tile, 16, 16, S); for (let r = 0; r < 16 * S; r++) px.set(big.subarray(r * 16 * S * 4, (r + 1) * 16 * S * 4), ((oy + 9 + j * 16 * S + r) * W + ox + i * 16 * S) * 4);
    }));
  });
  return { objects: found, sheet: encodePng(px, W, H), width: W, height: H, summary: `${short(symbol)}: ${found.filter((o) => o.kind === "whole").length} whole things as maps place them and ${found.filter((o) => o.kind === "part").length} other parts that always go together, from ${maps.length} maps (blocks of this tileset only)` };
}
export function objectText(o: FoundObject): string {
  return `  #${o.n}  ${o.kind}  ${o.w}x${o.h} squares  placed ${o.placed}×${o.at ? `  first at ${o.at.map} (${o.at.x},${o.at.y})` : ""}  ${o.solid} solid blocks${o.doors.length ? `, door at ${o.doors.map((d) => `(+${d[0]},+${d[1]})`).join(" ")}` : ""}${o.over_player ? ", part is drawn over the player" : ""}${o.irregular ? ", arrangement varies" : ""}\n` +
    o.blocks.map((r) => `      ${r.map((id) => (id ?? "·").padStart(3)).join(" ")}`).join("\n");
}
