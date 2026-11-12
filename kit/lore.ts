// kit/lore.ts: the lore index. One small file per town, scene or notable object (lore/<id>.md); everything else points
// at it by id: `lore: <id>` in a comment, a "lore" field in a tool's table, a lore id column in notes. Read-only except newLore.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";

export const HEADINGS = ["Look", "Voice", "Easter eggs", "Links", "Lineage"];
const ID = /^[a-z0-9][a-z0-9-]*$/;
const SKIP = new Set([".git", "build", "out", "shots", "refs", "node_modules", "sound", "graphics", "test", "docs", "asm", "libagbsyscall", "constants", "migration_scripts", "dev_scripts", ".github"]);
const TEXT = /\.(pory|inc|py|sh|ts|js|json|md|c|h|s|party|txt)$/;

export type LoreFile = { id: string; name: string; mood: string; file: string; text: string; intro: string; sections: Record<string, string>; missing: string[] };
export type Ref = { id: string; file: string; line: number; kind: "script" | "tool" | "notes" | "lore" | "source"; context: string; text: string };
export type Commit = { hash: string; date: string; subject: string; files: string[] };

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Every lore file, parsed: its name (the title line), its mood (the Mood line of Look, else Look's first line), its sections. */
export function loreFiles(game: string): LoreFile[] {
  const dir = join(game, "lore"); if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name).sort().map((f) => { // plain files only: a link could lead out of the game folder
    const text = readFileSync(join(dir, f), "utf8"), parts = text.split(/^## +(.+?)\s*$/m), sections: Record<string, string> = {};
    for (let i = 1; i < parts.length; i += 2) sections[parts[i]!] = (parts[i + 1] ?? "").trim();
    const head = parts[0]!, name = /^# +(.+)$/m.exec(head)?.[1]?.trim() ?? f.slice(0, -3), intro = head.replace(/^# +.+$/m, "").trim();
    const look = (sections.Look ?? "").split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
    const mood = (look.find((l) => /^mood\b/i.test(l))?.replace(/^mood:?\s*/i, "") ?? look[0] ?? intro.split("\n")[0] ?? "").replace(/\s+/g, " ");
    return { id: f.slice(0, -3), name, mood, file: `lore/${f}`, text, intro, sections, missing: HEADINGS.filter((h) => !(h in sections)) };
  });
}

function walk(game: string, dir: string, out: string[]) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name), rel = relative(game, p);
    if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith(".") && !/^tools\/[^/]+$/.test(rel)) walk(game, p, out); } // tools/<folder> is the engine's own tool sources
    else if (e.isFile() && TEXT.test(e.name)) out.push(rel);
  }
}
/** What a tag in a script file is attached to: the block right under it, else the block it is inside, else the whole file. */
function scriptContext(lines: string[], at: number): string {
  const label = (l: string) => /^(?:script|text|movement|mapscripts|mart|raw)\b[^\w]*(?:\([^)]*\)\s*)?(\w+)?/.exec(l)?.[1] ?? /^(\w+)::?\s*(?:@.*)?$/.exec(l)?.[1];
  const n = lines.filter((l) => label(l)).length;
  if (!lines.slice(0, at).some((l) => label(l))) return `the whole file (${n} block${n === 1 ? "" : "s"})`; // a tag above the first block is the file's
  for (let i = at + 1; i <= at + 3 && i < lines.length; i++) { const n = label(lines[i]!); if (n) return `block ${n}`; if (lines[i]!.trim() && !/^\s*(\/\/|@|#)/.test(lines[i]!)) break; }
  for (let i = at - 1; i >= 0; i--) { const b = label(lines[i]!); if (b) return `inside block ${b}`; }
  return "the whole file";
}
function toolContext(lines: string[], at: number): string {
  for (let i = at; i >= 0; i--) { const m = /^\s*(def|class)\s+(\w+)/.exec(lines[i]!) ?? /^()(\w+)\s*=/.exec(lines[i]!); if (m) return m[1] ? `${m[1]} ${m[2]}` : `table ${m[2]}`; }
  return "top of the file";
}
/** Every place in the game folder that names a lore id. */
export function scanRefs(game: string): Ref[] {
  const files: string[] = [], out: Ref[] = []; walk(game, game, files);
  for (const file of files) {
    const full = join(game, file); if (statSync(full).size > 2_000_000) continue;
    const text = readFileSync(full, "utf8"); if (!text.includes("lore")) continue;
    const lines = text.split("\n"), own = /^lore\/(.+)\.md$/.exec(file)?.[1], md = file.endsWith(".md");
    const kind: Ref["kind"] = own ? "lore" : md ? "notes" : /^data\/(maps|scripts)\//.test(file) ? "script" : file.startsWith("tools/") ? "tool" : "source";
    let heading = "", col = -1;
    lines.forEach((l, i) => {
      const ids = new Set<string>();
      if (md) { const h = /^#+ +(.+)$/.exec(l); if (h) heading = h[1]!.trim(); }
      if (md && l.trimStart().startsWith("|")) { // a table with a "lore id" column
        const cells = l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()), hc = cells.findIndex((c) => /^lore id$/i.test(c));
        if (hc >= 0) col = hc; else if (col >= 0 && !/^[-: ]+$/.test(cells[col] ?? "-")) for (const c of (cells[col] ?? "").replace(/`/g, "").split(",")) if (ID.test(c.trim())) ids.add(c.trim());
      } else col = -1;
      for (const m of l.matchAll(/\blore:\s*([a-z0-9][a-z0-9-]*(?:\s*,\s*[a-z0-9][a-z0-9-]*)*)(?![\w.]*\.md)/g)) for (const id of m[1]!.split(",")) ids.add(id.trim());
      for (const m of l.matchAll(/["']lore["']\s*[:=]\s*(\[[^\]]*\]|["'][a-z0-9-]+["'])/g)) for (const q of m[1]!.matchAll(/["']([a-z0-9][a-z0-9-]*)["']/g)) ids.add(q[1]!);
      for (const m of l.matchAll(/\blore\/([a-z0-9][a-z0-9-]*)\.md\b/g)) ids.add(m[1]!);
      for (const id of ids) {
        if (id === own) continue;
        const context = kind === "script" ? scriptContext(lines, i) : kind === "notes" || kind === "lore" ? (heading ? `under "${heading}"` : "top of the file") : toolContext(lines, i);
        out.push({ id, file, line: i + 1, kind, context, text: l.trim().replace(/\s+/g, " ").slice(0, 160) });
      }
    });
  }
  return out;
}

/** Pictures in shots/ that belong to each id: named after the id, the name, or an engine map the file's first lines name. The longest match wins. */
export function picturesByLore(game: string, lore: LoreFile[]): Map<string, { file: string; t: string }[]> {
  const dir = join(game, "shots"), by = new Map<string, { file: string; t: string }[]>(lore.map((l) => [l.id, []]));
  if (!existsSync(dir)) return by;
  const tokens = lore.flatMap((l) => {
    const maps = [...l.intro.matchAll(/`([A-Z][A-Za-z0-9]+)[`_*]/g)].map((m) => m[1]!);
    const t = new Set([squash(l.id), squash(l.name.replace(/^the /i, "")), ...maps.flatMap((m) => [squash(m), squash(m.replace(/(Town|City)$/, ""))])]);
    return [...t].filter((x) => x.length >= 4).map((token) => ({ id: l.id, token }));
  });
  const all: string[] = []; const rec = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) rec(join(d, e.name)); else if (/\.png$/i.test(e.name)) all.push(relative(game, join(d, e.name))); } }; rec(dir);
  for (const file of all) {
    const name = squash(file.replace(/^shots\//, "").replace(/\.png$/i, "")), hits = tokens.filter((t) => name.includes(t.token)), best = Math.max(0, ...hits.map((h) => h.token.length));
    const named = lore.filter((l) => l.text.includes(file)).map((l) => l.id); // a picture the lore file itself names
    for (const id of new Set([...hits.filter((h) => h.token.length === best).map((h) => h.id), ...named])) by.get(id)!.push({ file, t: statSync(join(game, file)).mtime.toISOString().replace(/\.\d+Z$/, "Z") });
  }
  for (const list of by.values()) list.sort((a, b) => a.t.localeCompare(b.t) || a.file.localeCompare(b.file));
  return by;
}

/** Commits that touched the given files (read-only git log), newest first. */
export function commitsFor(game: string, files: string[], limit = 30): Commit[] {
  if (!files.length || !existsSync(join(game, ".git"))) return [];
  const r = Bun.spawnSync(["git", "-C", game, "log", `-${limit}`, "--date=format-local:%Y-%m-%d %H:%M", "--format=%x01%h%x02%ad%x02%s", "--name-only", "--", ...files], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) return [];
  return r.stdout.toString().split("\x01").filter((c) => c.trim()).map((c) => { const [head, ...rest] = c.split("\n"), [hash, date, subject] = head!.split("\x02"); return { hash: hash!, date: date!, subject: subject!, files: rest.filter(Boolean) }; });
}

export function loreReport(game: string, id: string) {
  const all = loreFiles(game), f = all.find((l) => l.id === id);
  if (!f) { const near = all.filter((l) => l.id.includes(id) || id.includes(l.id) || squash(l.name).includes(squash(id))).map((l) => l.id); throw new Error(`no lore file lore/${id}.md.${near.length ? ` Did you mean: ${near.join(", ")}?` : ""} kit lore lists every id; kit lore new ${id} "<NAME>" makes one.`); }
  const references = scanRefs(game).filter((r) => r.id === id), pictures = picturesByLore(game, all).get(id)!;
  const refFiles = [...new Set(references.filter((r) => r.kind !== "notes" && r.kind !== "lore").map((r) => r.file))]; // notes files change in every commit and would say nothing
  return { id: f.id, name: f.name, mood: f.mood, file: f.file, text: f.text, sections: f.sections, missing_headings: f.missing, references, pictures,
    lineage: { text: f.sections.Lineage ?? null, commits_file: commitsFor(game, [f.file]), commits_references: commitsFor(game, refFiles) } };
}

export function loreCheck(game: string) {
  const all = loreFiles(game), refs = scanRefs(game), ids = new Set(all.map((l) => l.id)), missing = new Map<string, Ref[]>();
  for (const r of refs) if (!ids.has(r.id)) missing.set(r.id, [...(missing.get(r.id) ?? []), r]);
  const kinds = (id: string) => new Set(refs.filter((r) => r.id === id).map((r) => r.kind));
  return { files: all.length, references: refs.length,
    missing_file: [...missing].map(([id, at]) => ({ id, at: at.map((r) => `${r.file}:${r.line}`) })),
    unreferenced: all.filter((l) => !kinds(l.id).size).map((l) => l.id),
    only_in_notes: all.filter((l) => { const k = kinds(l.id); return k.size > 0 && ![...k].some((x) => x === "script" || x === "tool" || x === "source"); }).map((l) => l.id),
    missing_headings: all.filter((l) => l.missing.length).map((l) => ({ id: l.id, missing: l.missing })) };
}

export function newLore(game: string, id: string, name: string): string {
  if (!ID.test(id)) throw new Error(`a lore id is lower-case letters, digits and hyphens (harbour-town), got "${id}"`);
  const file = join(game, "lore", `${id}.md`);
  if (existsSync(file)) throw new Error(`lore/${id}.md already exists; it was not touched. Edit it, or choose another id.`);
  mkdirSync(join(game, "lore"), { recursive: true });
  writeFileSync(file, `# ${name}\n\nOne line: what this is and which map, sheet or object in the files it is.\n\n${HEADINGS.map((h) => `## ${h}\n\n`).join("")}`, { flag: "wx" });
  return file;
}

/** One line under Lineage that a kit command owns: replaced when the same command runs again, so the heading says what is true now. */
export function setLineage(game: string, id: string, key: string, text: string): boolean {
  const file = join(game, "lore", `${id}.md`); if (!ID.test(id) || !existsSync(file)) return false;
  let s = readFileSync(file, "utf8"); const line = `- ${key}: ${text}`, lines = s.split("\n"), at = lines.findIndex((l) => l.startsWith(`- ${key}: `));
  if (at >= 0) lines[at] = line;
  else {
    let h = lines.findIndex((l) => /^## +Lineage\s*$/.test(l)); if (h < 0) { while (lines.length && !lines.at(-1)!.trim()) lines.pop(); lines.push("", "## Lineage", ""); h = lines.length - 2; }
    let end = lines.findIndex((l, i) => i > h && /^## /.test(l)); if (end < 0) end = lines.length; while (end > h + 1 && !lines[end - 1]!.trim()) end--;
    lines.splice(end, 0, ...(end === h + 1 ? ["", line] : [line]));
  }
  s = lines.join("\n"); writeFileSync(file, s.endsWith("\n") ? s : s + "\n"); return true;
}

// ---- plain text ----
const local = (iso: string) => { const d = new Date(iso), p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const rule = (t: string) => `── ${t} ${"─".repeat(Math.max(3, 70 - t.length))}`;
export function listText(game: string): string {
  const all = loreFiles(game); if (!all.length) return `No lore files yet (no lore/ folder in the game). Make the first with: kit lore new <id> "<NAME>"`;
  const w = Math.max(...all.map((l) => l.id.length)), n = Math.max(...all.map((l) => l.name.length));
  return all.map((l) => `${l.id.padEnd(w)}  ${l.name.padEnd(n)}  ${l.mood.length > 110 ? l.mood.slice(0, 109) + "…" : l.mood}`).join("\n") + `\n${all.length} lore files. kit lore <id> shows one with everything that points at it.`;
}
export function reportText(r: ReturnType<typeof loreReport>): string {
  const out = [`${r.name}  ·  ${r.id}  ·  ${r.file}`, "", r.text.trim(), "", rule(`referenced by (${r.references.length})`)];
  const group: [Ref["kind"], string][] = [["script", "script files"], ["tool", "tools"], ["source", "source"], ["notes", "notes"], ["lore", "other lore files"]];
  for (const [k, title] of group) { const rs = r.references.filter((x) => x.kind === k); if (rs.length) out.push(`${title}:`, ...rs.map((x) => `  ${x.file}:${x.line}  ${x.context}${k === "script" ? "" : `  ▸ ${x.text.length > 90 ? x.text.slice(0, 89) + "…" : x.text}`}`)); }
  if (!r.references.length) out.push("  nothing points at this id yet. Tag a script with a comment `lore: " + r.id + "`, or give a tool's table entry a \"lore\" field.");
  out.push("", rule(`pictures (${r.pictures.length}, oldest first)`), ...r.pictures.slice(-40).map((p) => `  ${local(p.t)}  ${p.file}`));
  if (r.pictures.length > 40) out.splice(out.length - 40, 0, `  (${r.pictures.length - 40} older ones not shown; --json has all)`);
  if (!r.pictures.length) out.push("  none in shots/ named after this id, its name or its map");
  out.push("", rule("lineage"), r.lineage.text === null ? "  (the file has no Lineage heading)" : r.lineage.text || "  (the Lineage heading is empty)");
  const commits = (title: string, cs: Commit[], files: boolean) => { out.push(title, ...(cs.length ? cs.map((c) => `  ${c.hash}  ${c.date}  ${c.subject}${files ? `  (${c.files.length > 3 ? `${c.files.slice(0, 3).join(", ")} and ${c.files.length - 3} more` : c.files.join(", ")})` : ""}`) : ["  none yet (not kept, or not in git)"])); };
  commits(`kept versions that changed ${r.file}:`, r.lineage.commits_file, false);
  commits("kept versions that changed the script, tool and source files pointing at it:", r.lineage.commits_references, true);
  if (r.missing_headings.length) out.push("", `missing headings: ${r.missing_headings.join(", ")}`);
  return out.join("\n");
}
export function checkText(c: ReturnType<typeof loreCheck>): string {
  const out = [`${c.files} lore files, ${c.references} references.`], ok = "  ✓ none";
  out.push("ids referenced with no file:", ...(c.missing_file.length ? c.missing_file.map((m) => `  ✗ ${m.id}  ${m.at.slice(0, 4).join(", ")}${m.at.length > 4 ? ` and ${m.at.length - 4} more` : ""}`) : [ok]));
  out.push("files nothing references:", ...(c.unreferenced.length ? c.unreferenced.map((i) => `  ✗ ${i}`) : [ok]));
  out.push("files only notes and other lore files reference (no script, tool or source points at them):", ...(c.only_in_notes.length ? c.only_in_notes.map((i) => `  · ${i}`) : [ok]));
  out.push("files missing headings:", ...(c.missing_headings.length ? c.missing_headings.map((m) => `  ✗ ${m.id}: ${m.missing.join(", ")}`) : [ok]));
  return out.join("\n");
}
