// kit/gates.ts: for the "road between" scene. Finds the maps on the walking path between two maps and lists the places in
// their scripts where a story switch decides whether the player gets through. Approximate by design: candidates, not certainties.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { arr, json, listMaps, short, type MapInfo } from "./maps";

export type Gate = { map: string; file: string; kind: "trigger" | "on-arrival" | "turns-back" | "person-by-switch" | "obstacle"; label: string; at: number[][]; who?: string; switches: string[]; when?: string; moves_player: boolean; text: string };

/** The maps walked through from one map to another, by joins and doors (fewest maps), plus caves and woods that open off the path. */
export function pathBetween(game: string, from: string, to: string): { path: MapInfo[]; side: MapInfo[] } {
  const all = listMaps(game), byId = new Map(all.map((m) => [short(m.id), m])), find = (n: string) => all.find((m) => m.name.toLowerCase() === n.toLowerCase() || short(m.id).toLowerCase() === n.toLowerCase().replace(/^map_/, ""));
  const a = find(from), b = find(to); if (!a || !b) throw new Error(`no map named ${!a ? from : to}. kit maps --all lists them.`);
  const next = (m: MapInfo) => [...m.joins.map((j) => j.to), ...m.doors.map((d) => d.to)].map((id) => byId.get(id)).filter(Boolean) as MapInfo[];
  const prev = new Map<MapInfo, MapInfo | null>([[a, null]]), queue = [a];
  while (queue.length && !prev.has(b)) { const m = queue.shift()!; for (const n of next(m)) if (!prev.has(n)) { prev.set(n, m); queue.push(n); } }
  if (!prev.has(b)) throw new Error(`no way found from ${a.name} to ${b.name} by joins and doors`);
  const path: MapInfo[] = []; for (let m: MapInfo | null = b; m; m = prev.get(m) ?? null) path.unshift(m);
  const side = [...new Set(path.flatMap(next))].filter((m) => !path.includes(m) && m.type !== "indoor" && m.doors.some((d) => path.some((p) => short(p.id) === d.to))); // one map can be cut in two by a wood or a cave
  return { path, side };
}

const IGNORE = /^(VAR_RESULT|VAR_FACING|VAR_0x80|VAR_TEMP_|VAR_LAST_TALKED|FLAG_TEMP_)/;
/** Candidate gates in one map: read from its map.json and its script file. */
export function gatesIn(game: string, m: MapInfo): Gate[] {
  const dir = join(game, "data/maps", m.name), inc = join(dir, "scripts.inc"), map = json(join(dir, "map.json")), out: Gate[] = [];
  const file = `data/maps/${m.name}/${existsSync(join(dir, "scripts.pory")) ? "scripts.pory" : "scripts.inc"}`, blocks = new Map<string, string[]>();
  let cur: string[] = [];
  for (const line of existsSync(inc) ? readFileSync(inc, "utf8").split("\n") : []) { const l = /^(\w+)::?/.exec(line); if (l) blocks.set(l[1]!, (cur = [])); else cur.push(line.trim()); }
  const textOf = (label: string) => (blocks.get(label) ?? []).filter((l) => l.startsWith(".string")).map((l) => /"(.*)"/.exec(l)?.[1] ?? "").join("").replace(/\\[nlp]/g, " ").replace(/\$$/, "").trim();
  const read = (label: string, depth = 0, seen = new Set<string>()): { switches: Set<string>; moves: boolean; texts: string[] } => { // what a script checks, whether it walks the player, what it says
    const r = { switches: new Set<string>(), moves: false, texts: [] as string[] };
    if (seen.has(label) || depth > 3) return r; seen.add(label);
    for (const l of blocks.get(label) ?? []) {
      for (const s of l.match(/\b(FLAG|VAR)_\w+/g) ?? []) if (!IGNORE.test(s) && /^(goto_if|call_if|compare|checkflag|switch|setvar|setflag|clearflag)/.test(l)) r.switches.add(s);
      if (/^applymovement\s+(LOCALID_PLAYER|OBJ_EVENT_ID_PLAYER)\b/.test(l)) r.moves = true;
      const t = /^(?:msgbox|message)\s+(\w+)/.exec(l); if (t) r.texts.push(textOf(t[1]!) || `(text ${t[1]}, in another file)`);
      const g = /^(?:goto|call)(?:_if_\w+)?\s+(?:.*,\s*)?(\w+)$/.exec(l);
      if (g && blocks.has(g[1]!)) { const sub = read(g[1]!, depth + 1, seen); sub.switches.forEach((s) => r.switches.add(s)); r.moves ||= sub.moves; r.texts.push(...sub.texts); }
    }
    return r;
  };
  const add = (kind: Gate["kind"], label: string, at: number[][], extra: Partial<Gate>, first: string[] = []) => { const r = read(label); out.push({ map: m.name, file, kind, label, at, switches: [...new Set([...first, ...r.switches])], moves_player: r.moves, text: r.texts[0] ?? "", ...extra }); };
  // squares that start a script while a story number has a certain value: the usual way a road is closed
  const trig = new Map<string, { at: number[][]; scripts: string[]; e: any }>();
  for (const e of arr(map.coord_events)) if (e.type === "trigger" && e.script) { const k = `${e.var}|${e.var_value}`, t = trig.get(k); trig.set(k, { at: [...(t?.at ?? []), [e.x, e.y]], scripts: [...new Set([...(t?.scripts ?? []), e.script as string])], e }); }
  for (const { at, scripts, e } of trig.values()) if (!IGNORE.test(e.var)) { // one entry per story number and value, however many squares and scripts share it
    add("trigger", scripts[0]!, at, { when: `${e.var} is ${e.var_value}` }, [e.var]);
    const g = out.at(-1)!; for (const sc of scripts.slice(1)) { const r = read(sc); g.moves_player ||= r.moves; g.text ||= r.texts[0] ?? ""; r.switches.forEach((x) => g.switches.includes(x) || g.switches.push(x)); }
    g.label = scripts.join(", ");
  }
  // scripts the map starts by itself on arrival while a story number has a certain value
  for (const lines of blocks.values()) for (const l of lines) { const a = /^map_script_2\s+(\w+),\s*(\w+),\s*(\w+)/.exec(l); if (a && !IGNORE.test(a[1]!)) add("on-arrival", a[3]!, [], { when: `${a[1]} is ${a[2]}` }, [a[1]!]); }
  for (const o of arr(map.object_events)) {
    const who = short(typeof o.local_id === "string" && o.local_id.startsWith("LOCALID_") ? o.local_id : o.graphics_id), flag = String(o.flag ?? "0"), script = String(o.script ?? "");
    if (/CUTTABLE_TREE|BREAKABLE_ROCK|PUSHABLE_BOULDER/.test(o.graphics_id)) { out.push({ map: m.name, file: `data/maps/${m.name}/map.json`, kind: "obstacle", label: script, at: [[o.x, o.y]], who, switches: [], moves_player: false, text: "" }); continue; }
    if (/ITEM_BALL|BERRY_TREE/.test(o.graphics_id)) continue;
    const r = blocks.has(script) ? read(script) : null;
    if (r?.moves && r.switches.size) add("turns-back", script, [[o.x, o.y]], { who });
    else if (/^FLAG_/.test(flag)) add("person-by-switch", script, [[o.x, o.y]], { who, when: `hidden while ${flag} is set` }, [flag]);
  }
  for (const e of arr(map.bg_events)) { const r = e.script && blocks.has(e.script) ? read(e.script) : null; if (r?.moves && r.switches.size) add("turns-back", e.script, [[e.x, e.y]], {}); }
  return out;
}
export function gateText(g: Gate): string {
  const what = { trigger: "squares that start a script", "on-arrival": "a script that starts on arrival", "turns-back": "talking or looking here can move the player", "person-by-switch": "a person who is only sometimes there", obstacle: "an obstacle that needs a field move" }[g.kind];
  return `  ${g.kind}: ${what}${g.who ? ` (${g.who})` : ""}${g.at.length ? ` at ${g.at.map((p) => `(${p})`).join(" ")}` : ""}${g.when ? `, ${g.kind === "person-by-switch" ? "" : "while "}${g.when}` : ""}${g.moves_player ? (g.kind === "on-arrival" ? "; it walks the player (a scene plays)" : "; it WALKS THE PLAYER (likely turns them back or leads them)") : ""}\n    ${g.file}  ${g.label || "(no script)"}${g.switches.length ? `  switches: ${g.switches.join(", ")}` : ""}${g.text ? `\n    says: "${g.text.slice(0, 160)}${g.text.length > 160 ? "..." : ""}"` : ""}`;
}
