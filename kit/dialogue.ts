// kit/dialogue.ts: every line a player can read, taken from the game folder's scripts and grouped by the place it is said in.
// The pane's Dialogue tab is the same code.
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { walk } from "./find";
import { childEnv } from "./env";

export type State = "new" | "changed" | "same"; // against the day the game folder was set up
export type Text = { label: string; boxes: string[] };
export type Marked = Text & { state: State };
export type Place = { place: string; file: string; order: number | null; texts: Marked[] }; // order: how early a player reaches the place; null when that cannot be told
export type Dialogue = { places: Place[]; texts: number; boxes: number };
const BIG = 5_000_000, STR = /"((?:[^"\\]|\\.)*)"/g, ROOTS = ["data/maps", "data/scripts", "data/text"];

/** One text as the game shows it: a box per page break, line breaks as spaces. */
export function boxesOf(raw: string): string[] {
  return raw.replace(/\$$/, "").split("\\p").map((b) => b.replace(/\\[nlNL]/g, " ").replace(/\\"/g, '"').replace(/\s+/g, " ").trim()).filter(Boolean);
}
const strings = (s: string) => [...s.matchAll(STR)].map((m) => m[1]!).join("");

/** The texts of a script written in the short script language: text blocks, and lines written straight into a script. */
export function scriptTexts(src: string): Text[] {
  const out: Text[] = [];
  for (const m of src.matchAll(/^(text|script)\s*(?:\([^)]*\)\s*)?(\w+)\s*\{/gm)) {
    let i = m.index! + m[0].length, depth = 1, quoted = false; const from = i;
    for (; i < src.length && depth; i++) {
      const c = src[i];
      if (quoted) { if (c === "\\") i++; else if (c === '"') quoted = false; }
      else if (c === '"') quoted = true; else if (c === "{") depth++; else if (c === "}") depth--;
    }
    const body = src.slice(from, i - 1);
    if (m[1] === "text") { const boxes = boxesOf(strings(body)); if (boxes.length) out.push({ label: m[2]!, boxes }); }
    else [...body.matchAll(/(?:msgbox|message|format)\(\s*(?:format\(\s*)?"((?:[^"\\]|\\.)*)"/g)].forEach((s, n) => { const boxes = boxesOf(s[1]!); if (s[1]!.includes(" ") && boxes.length) out.push({ label: `${m[2]} (line ${n + 1})`, boxes }); });
  }
  return out;
}
/** The texts of an assembly script: a label followed by .string lines. */
export function asmTexts(src: string): Text[] {
  const out: Text[] = []; let label = "", raw = "";
  const end = () => { const boxes = boxesOf(raw); if (label && boxes.length) out.push({ label, boxes }); raw = ""; };
  for (const line of src.split("\n")) {
    const l = /^(\w+)::?\s*(?:@.*)?$/.exec(line.trim()), s = /^\s*\.string\s+"((?:[^"\\]|\\.)*)"/.exec(line);
    if (l) { end(); label = l[1]!; } else if (s) raw += s[1]; else if (line.trim() && !line.trim().startsWith("@")) { end(); label = ""; }
  }
  end();
  return out;
}
const placeOf = (file: string) => file.startsWith("data/maps/") ? basename(dirname(file)).replace(/_/g, " / ").replace(/([a-z])([A-Z])/g, "$1 $2") : `Shared: ${basename(file).replace(/\.\w+$/, "").replace(/_/g, " ")}`;

type Since = { added: Set<string>; before: Map<string, Map<string, string>> };
/** What the scripts held when the game folder was set up: which files are new since, and each older file's texts then. Null when that cannot be told. */
export function sinceSetup(game: string): Since | null {
  const env = childEnv({ GIT_OPTIONAL_LOCKS: "0" });
  const git = (...a: string[]) => { const r = Bun.spawnSync(["git", "-C", game, ...a], { stderr: "ignore", env }); return r.exitCode === 0 ? r.stdout.toString().trim() : null; };
  if (!existsSync(join(game, ".git"))) return null;
  const start = git("rev-parse", "-q", "--verify", "kit-start^{commit}") || git("log", "--grep=^base:", "--format=%H")?.split("\n").pop() || git("rev-list", "--max-parents=0", "HEAD")?.split("\n")[0];
  const diff = start ? git("diff", "--name-status", "--no-renames", start, "--", ...ROOTS) : null, fresh = git("ls-files", "--others", "--exclude-standard", "--", ...ROOTS), then = start ? git("ls-tree", "-r", "--name-only", start, "--", ...ROOTS) : null;
  if (diff == null || fresh == null || then == null) return null;
  const was = new Set(then.split("\n")), added = new Set(fresh.split("\n").filter(Boolean)), old: string[] = [];
  for (const line of diff.split("\n").filter(Boolean)) {
    const [how, file] = line.split("\t") as [string, string], twin = file.replace(/\.pory$/, ".inc"); // a script rewritten in the short language is compared with what its file said before
    if (how === "M") old.push(file); else if (how === "A" && file.endsWith(".pory") && was.has(twin)) old.push(twin); else if (how === "A") added.add(file);
  }
  for (const f of [...added]) { const twin = f.replace(/\.pory$/, ".inc"); if (f.endsWith(".pory") && was.has(twin)) { added.delete(f); old.push(twin); } }
  const before = new Map<string, Map<string, string>>();
  if (old.length) { // every older version in one call
    const r = Bun.spawnSync(["git", "-C", game, "cat-file", "--batch"], { stdin: Buffer.from(old.map((f) => `${start}:${f}\n`).join("")), stderr: "ignore", env, maxBuffer: 400_000_000 });
    const out = r.stdout as Buffer; let at = 0;
    for (const f of old) {
      const nl = out.indexOf(10, at); if (nl < 0) break;
      const head = out.subarray(at, nl).toString().split(" "), size = Number(head[2]);
      if (head[1] !== "blob") { at = nl + 1; continue; }
      const src = out.subarray(nl + 1, nl + 1 + size).toString("utf8"); at = nl + 1 + size + 1;
      before.set(f, new Map((f.endsWith(".pory") ? scriptTexts : asmTexts)(src).map((t) => [t.label, t.boxes.join("\n")])));
    }
  }
  return { added, before };
}

/** The order a player reaches the maps in, roughly: from the map a new game starts on, outward through joins and doors; a building comes right after the place its door is in. */
export function storyOrder(game: string): Map<string, number> {
  const dir = join(game, "data/maps"), rank = new Map<string, number>(); if (!existsSync(dir)) return rank;
  const maps = new Map<string, { folder: string; joins: string[]; doors: string[] }>();
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    let m: any; try { m = JSON.parse(readFileSync(join(dir, e.name, "map.json"), "utf8")); } catch { continue; }
    if (typeof m?.id !== "string") continue;
    const doors: string[] = (Array.isArray(m.warp_events) ? m.warp_events : []).map((w: any) => String(w?.dest_map ?? ""));
    for (const f of readdirSync(join(dir, e.name)).filter((n) => /\.(pory|inc)$/.test(n))) { // a script may carry the player on: a lift, a boat
      const p = join(dir, e.name, f); if (statSync(p).size < BIG) for (const w of readFileSync(p, "utf8").matchAll(/\bwarp\w*[ (]\s*(MAP_\w+)/g)) doors.push(w[1]!);
    }
    maps.set(m.id, { folder: e.name, joins: (Array.isArray(m.connections) ? m.connections : []).map((c: any) => String(c?.map ?? "")), doors });
  }
  let start: string | undefined;
  try { const s = JSON.parse(readFileSync(join(game, "settings.json"), "utf8")).start_map; if (typeof s === "string") start = [...maps].find(([id, m]) => id === s || m.folder === s)?.[0]; } catch {}
  for (const f of ["src/overworld.c", "src/new_game.c"]) { // where the engine sets a new game down
    if (start || !existsSync(join(game, f))) continue;
    const hits = [...readFileSync(join(game, f), "utf8").matchAll(/(?:SetWarpDestination|SetWarpData)\([^;]*?MAP_GROUP\((MAP_\w+)\)/g)].map((h) => h[1]!).filter((id) => maps.has(id));
    start = f.endsWith("new_game.c") ? hits.at(-1) : hits.length === 1 ? hits[0] : undefined;
  }
  if (!start) return rank;
  const queue = [start], seen = new Set<string>();
  const visit = (id: string) => {
    const m = maps.get(id); if (!m || seen.has(id)) return;
    seen.add(id); rank.set(m.folder, rank.size);
    for (const d of m.doors) { const to = maps.get(d); if (to && !seen.has(d)) { if (to.joins.length) queue.push(d); else visit(d); } } // indoors now; another town waits its turn
    queue.push(...m.joins);
  };
  while (queue.length) visit(queue.shift()!);
  return rank;
}
/** The places in the order a player reaches them; the ones that order cannot place come last, by name. */
export const inStoryOrder = (places: Place[]) => [...places].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.file.localeCompare(b.file));

/** Every text in the game folder's scripts, each marked new, changed or same against the day of setup. A generated file is skipped when the script it was made from is there. */
export function readDialogue(game: string): Dialogue {
  if (!existsSync(game)) throw new Error(`No game folder at ${game}.`);
  const files: string[] = [];
  for (const root of ROOTS) if (existsSync(join(game, root))) for (const f of walk(join(game, root))) files.push(`${root}/${f}`);
  const have = new Set(files), since = sinceSetup(game), story = storyOrder(game), places: Place[] = []; let texts = 0, boxes = 0;
  for (const file of files.sort()) {
    const pory = file.endsWith(".pory"); if (!pory && !/\.(inc|s)$/.test(file)) continue;
    if (!pory && have.has(file.replace(/\.(inc|s)$/, ".pory"))) continue;
    const full = join(game, file); if (statSync(full).size > BIG) continue;
    const found = (pory ? scriptTexts : asmTexts)(readFileSync(full, "utf8")); if (!found.length) continue;
    const old = since?.before.get(file) ?? since?.before.get(file.replace(/\.pory$/, ".inc")), fresh = !since || since.added.has(file);
    const marked = found.map((t) => ({ ...t, state: (fresh ? "new" : !old ? "same" : old.get(t.label) === t.boxes.join("\n") ? "same" : "changed") as State }));
    texts += marked.length; boxes += marked.reduce((n, t) => n + t.boxes.length, 0);
    places.push({ place: placeOf(file), file, order: (file.startsWith("data/maps/") ? story.get(basename(dirname(file))) : undefined) ?? null, texts: marked });
  }
  return { places, texts, boxes };
}
/** Only the texts that hold the words (any capitals), in their label or in what is said, in the wanted states. */
export function filterDialogue(d: Dialogue, query: string, glob?: string | null, states: State[] = ["new", "changed", "same"]): Dialogue {
  const low = query.toLowerCase().trim(), within = glob?.trim().replace(/\*+$/, "").replace(/\/$/, "") ?? "";
  const places = d.places.filter((p) => !within || p.file.startsWith(within) || p.place.toLowerCase().includes(within.toLowerCase()))
    .map((p) => ({ ...p, texts: p.texts.filter((t) => states.includes(t.state) && (!low || t.label.toLowerCase().includes(low) || t.boxes.some((b) => b.toLowerCase().includes(low)))) })).filter((p) => p.texts.length);
  return { places, texts: places.reduce((n, p) => n + p.texts.length, 0), boxes: places.reduce((n, p) => n + p.texts.reduce((m, t) => m + t.boxes.length, 0), 0) };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const said = (b: string) => esc(b).replace(/^([A-Z][A-Z0-9 .'-]{1,24}):/, "<b>$1:</b>").replace(/\{(\w+)[^}]*\}/g, "<i>$1</i>");
/** The whole of it as one page that needs nothing else: the places down the left, what is said on the right, a search box. */
export function dialoguePage(d: Dialogue, title = "All dialogue"): string {
  const nav = d.places.map((p, n) => `<a href="#p${n}" data-n="${n}">${esc(p.place)} <span>${p.texts.length}</span></a>`).join("");
  const body = d.places.map((p, n) => `<section id="p${n}"><h2>${esc(p.place)} <small>${esc(p.file)}</small></h2>${p.texts.map((t) => `<div class="t"><div class="l">${esc(t.label)}</div>${t.boxes.map((b) => `<p>${said(b)}</p>`).join("")}</div>`).join("")}</section>`).join("\n");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
:root{--bg:#14161a;--fg:#e8e4d8;--dim:#8d8a80;--line:#2a2d34;--acc:#e0a94a;--card:#1b1e24}@media (prefers-color-scheme: light){:root{--bg:#f4f3ef;--fg:#1c1e22;--dim:#6c6a63;--line:#d6d3ca;--acc:#7a5200;--card:#fff}}
*{box-sizing:border-box}body{background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,sans-serif;margin:0}
.wrap{display:grid;grid-template-columns:260px minmax(0,1fr);max-width:1180px;margin:auto}
aside{position:sticky;top:0;height:100vh;overflow-y:auto;padding:14px 10px 14px 16px;border-right:1px solid var(--line)}
aside h1{font-size:18px;margin:0 0 2px}aside p{color:var(--dim);font-size:12px;margin:0 0 10px}
#q{width:100%;padding:9px;font-size:16px;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:6px;margin-bottom:10px}
nav a{display:flex;justify-content:space-between;gap:8px;color:var(--fg);text-decoration:none;font-size:13px;padding:4px 6px;border-radius:5px}nav a:hover{background:var(--card)}nav a span{color:var(--dim)}
main{padding:6px 20px 60px;min-width:0}h2{font-size:17px;margin:26px 0 8px;color:var(--acc)}h2 small{color:var(--dim);font-weight:400;font-size:12px;overflow-wrap:anywhere}
.t{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:8px 12px;margin:8px 0}.t p{margin:4px 0}.l{font:11px ui-monospace,monospace;color:var(--dim);overflow-wrap:anywhere}b{color:var(--acc);font-weight:600}i{color:var(--dim)}
@media (max-width:760px){.wrap{display:block}aside{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}nav{max-height:180px;overflow-y:auto}}
</style><div class="wrap"><aside><h1>${esc(title)}</h1><p>${d.texts} texts, ${d.boxes} text boxes, ${d.places.length} places. One paragraph is one text box.</p><input id="q" type="search" placeholder="Search a name, a word, a place" autocomplete="off"><nav>${nav}</nav></aside><main>
${body}
</main></div><script>const q=document.getElementById('q');q.oninput=()=>{const v=q.value.toLowerCase();document.querySelectorAll('section').forEach((s,n)=>{let c=0;s.querySelectorAll('.t').forEach(t=>{const h=!v||t.textContent.toLowerCase().includes(v);t.style.display=h?'':'none';c+=h});s.style.display=c?'':'none';const a=document.querySelector('nav a[data-n="'+n+'"]');a.style.display=c?'':'none';a.lastChild.textContent=c})}</script></html>
`;
}

export function dialogueText(d: Dialogue): string {
  if (!d.texts) return "No text found here. Texts are read from the scripts under data/maps, data/scripts and data/text.";
  return `${d.places.map((p) => `${p.place}  (${p.file})\n${p.texts.map((t) => `  ${t.label}\n${t.boxes.map((b) => `    ${b}`).join("\n")}`).join("\n")}`).join("\n\n")}\n${d.texts} text${d.texts === 1 ? "" : "s"}, ${d.boxes} text box${d.boxes === 1 ? "" : "es"}, in ${d.places.length} place${d.places.length === 1 ? "" : "s"}.`;
}

// ---- the user's notes on single texts: dialogue-notes.jsonl in the game folder, written by the pane, read by the agent ----
export type Note = { t: string; id: string; file: string; label: string; note: string; said: string };
const notesFile = (game: string) => join(game, "dialogue-notes.jsonl"), noteId = (file: string, label: string) => Bun.hash(`${file}|${label}`).toString(36).slice(0, 10);
const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
/** The notes still waiting: the latest per text, without the ones taken back or marked done. */
export function readNotes(game: string): Note[] {
  const latest = new Map<string, Note>();
  if (existsSync(notesFile(game))) for (const line of readFileSync(notesFile(game), "utf8").split("\n")) {
    let o: any; try { o = line.trim() ? JSON.parse(line) : null; } catch { continue; }
    if (typeof o?.done === "string") latest.delete(o.done);
    else if (typeof o?.id === "string" && typeof o.file === "string" && typeof o.label === "string" && typeof o.note === "string") { if (o.note) latest.set(o.id, { t: String(o.t), id: o.id, file: o.file, label: o.label, note: o.note, said: String(o.said ?? "") }); else latest.delete(o.id); }
  }
  return [...latest.values()].sort((a, b) => a.t.localeCompare(b.t));
}
/** Writes, changes or (with an empty note) takes back the note on one text. */
export function addNote(game: string, n: { file?: unknown; label?: unknown; note?: unknown; said?: unknown }): Note {
  const word = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const file = word(n.file, 300), label = word(n.label, 200);
  if (!label || !ROOTS.some((r) => file.startsWith(`${r}/`)) || file.includes("..") || /[\n\0]/.test(file + label)) throw new Error("which text? (its file and its name)");
  const row = { t: stamp(), id: noteId(file, label), file, label, note: word(n.note, 2000), said: word(n.said, 4000) };
  appendFileSync(notesFile(game), JSON.stringify(row) + "\n");
  return row;
}
/** Marks notes as dealt with: one text's name, or "all". Returns how many. */
export function doneNotes(game: string, which: string): number {
  const hit = readNotes(game).filter((n) => which === "all" || n.label === which || n.id === which);
  if (hit.length) appendFileSync(notesFile(game), hit.map((n) => JSON.stringify({ t: stamp(), done: n.id }) + "\n").join(""));
  return hit.length;
}
/** The waiting notes as plain text to read or hand over: the place, the text's name, what it says now, the note. */
export function notesText(game: string): string {
  const notes = readNotes(game); if (!notes.length) return "No notes are waiting.";
  const d = readDialogue(game), out = [`# Dialogue notes (${notes.length})`];
  for (const n of notes) {
    const place = d.places.find((p) => p.file === n.file), now = place?.texts.find((t) => t.label === n.label);
    out.push("", `## ${place?.place ?? n.file}: ${n.label}`, `file: ${n.file}`, ...(now ? now.boxes.map((b) => `> ${b}`) : ["> (this text is no longer in the scripts)"]),
      ...(now && n.said && now.boxes.join("\n") !== n.said ? ["(the text has changed since this note was written; it then read:)", ...n.said.split("\n").map((b) => `> ${b}`)] : []), "", `NOTE: ${n.note}`);
  }
  return out.join("\n");
}

export const DIALOGUE_HELP = `kit dialogue ["<words>"] [--in <place or folder>] [--only new|changed] [--all] [--page <file.html>] [--json]   every line a player can
                             read, by the place it is said in: the text's name, then one line per text box; with words, only the texts
                             that hold them. Reads what you wrote since setup: texts in new scripts and texts you changed in old ones
                             (--only picks one of the two); --all adds the original game's untouched texts. --page writes it as one
                             page to open in a browser (places down the left, a search box); --story lists the places in the
                             order a player reaches them (from the starting map outward; settings.json start_map names it when
                             the engine's own start cannot be read) instead of by file name
  kit dialogue --notes [--json]   the notes the user wrote on single texts in the pane's Dialogue tab: each text as it reads now, then the note
  kit dialogue --done "<text's name>" | --done all   mark a note as dealt with once the text is changed (it leaves the user's list)`;
export function dialogueCommand(game: string, args: string[]): number {
  const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i < 0 ? undefined : args.splice(i, 2)[1]; }, flag = (n: string) => { const i = args.indexOf(`--${n}`); if (i >= 0) args.splice(i, 1); return i >= 0; };
  const asJson = flag("json"), all = flag("all"), notes = flag("notes"), story = flag("story"), within = opt("in"), page = opt("page"), only = opt("only"), done = opt("done");
  try {
    if (done !== undefined) { const n = doneNotes(game, done); console.log(n ? `Marked ${n} note${n === 1 ? "" : "s"} as dealt with.` : `No waiting note on "${done}". See them with: kit dialogue --notes`); return n ? 0 : 1; }
    if (notes) { console.log(asJson ? JSON.stringify(readNotes(game), null, 1) : notesText(game)); return 0; }
    if (only !== undefined && only !== "new" && only !== "changed") throw new Error(`--only is new or changed; got "${only}"`);
    const whole = readDialogue(game), d = filterDialogue(whole, args.join(" "), within, all ? undefined : only ? [only] : ["new", "changed"]);
    if (story) d.places = inStoryOrder(d.places);
    if (page) { const to = resolve(page); writeFileSync(to, dialoguePage(d)); console.log(`Wrote ${d.texts} texts in ${d.places.length} places to ${to}`); return 0; }
    console.log(asJson ? JSON.stringify(d, null, 1) : dialogueText(d) + (all ? "" : "\nThe original game's untouched texts are left out; add --all to read them too."));
    return 0;
  } catch (e) { console.error(`kit dialogue: ${(e as Error).message}`); return 1; }
}
