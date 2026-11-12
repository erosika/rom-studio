// kit/find.ts: search the game folder's source, and read the lines around one. The pane's Source tab is the same code.
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export type Hit = { line: number; text: string; mark: [number, number] | null };
export type Found = { query: string; in: string | null; regex: boolean; files: { file: string; hits: Hit[] }[]; shown: number; more: number; atLeast: boolean };
export type Lines = { file: string; at: number; from: number; to: number; total: number; lines: { n: number; text: string }[] };
const WIDE = 300, STOP = 200_000, BIG = 5_000_000, SKIP = new Set([".git", "node_modules", "out", "build"]);

/** The file a path names, when it is inside the game folder; says why when it is not. */
export function inside(game: string, path: string): string {
  const root = realpathSync(game), to = resolve(root, path);
  if (!path || (to !== root && !to.startsWith(root + sep))) throw new Error(`"${path}" is outside the game folder. Give a path inside ${game}, as kit find prints it.`);
  if (!existsSync(to)) throw new Error(`No file "${path}" in the game folder.`);
  const real = realpathSync(to); // a link inside the folder may point out of it
  if (real !== root && !real.startsWith(root + sep)) throw new Error(`"${path}" is a link to a place outside the game folder; not read.`);
  return real;
}
const binary = (file: string) => { const b = Buffer.alloc(8000), fd = openSync(file, "r"); try { return b.subarray(0, readSync(fd, b, 0, 8000, 0)).includes(0); } finally { closeSync(fd); } };

/** Up to 2*span+1 lines of a file around line `at`, numbered. */
export function fileLines(game: string, path: string, at = 1, span = 20): Lines {
  const file = inside(game, path), st = statSync(file);
  if (!st.isFile()) throw new Error(`"${path}" is a folder, not a file.`);
  if (st.size > BIG) throw new Error(`"${path}" is ${Math.round(st.size / 1e6)} MB: too big to show.`);
  if (binary(file)) throw new Error(`"${path}" is not text (a picture, sound or built file).`);
  const all = readFileSync(file, "utf8").split("\n"); if (all.at(-1) === "") all.pop();
  const total = all.length, mid = Math.min(Math.max(1, Math.floor(at) || 1), Math.max(1, total)), n = Math.min(Math.max(0, Math.floor(span) || 0), 500);
  const from = Math.max(1, mid - n), to = Math.min(total, mid + n);
  return { file: relative(realpathSync(game), file), at: mid, from, to, total, lines: all.slice(from - 1, to).map((text, i) => ({ n: from + i, text })) };
}

const globRe = (g: string) => new RegExp("^" + g.split("**").map((p) => p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")).join(".*") + "$");
const wider = (g: string) => (g.includes("/") ? g : `**/${g}`); // "*.inc" means at any depth
export function* walk(dir: string, rel = ""): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) yield* walk(join(dir, e.name), rel + e.name + "/"); }
    else if (e.isFile()) yield rel + e.name;
  }
}

/** Every line of the game folder's source that holds the text (or matches the pattern), grouped by file, capped. */
export async function findText(game: string, query: string, o: { in?: string | null; regex?: boolean; max?: number } = {}): Promise<Found> {
  if (!query) throw new Error("Nothing to look for: give some text.");
  if (!existsSync(game)) throw new Error(`No game folder at ${game}.`);
  const max = Math.max(1, Math.floor(o.max ?? 200) || 200), glob = o.in?.trim() || null, regex = !!o.regex;
  let re: RegExp | null = null; try { re = regex ? new RegExp(query) : null; } catch { if (!existsSync(join(game, ".git"))) throw new Error(`"${query}" is not a pattern this can read.`); }
  const low = query.toLowerCase(), files = new Map<string, Hit[]>(); let seen = 0, atLeast = false;
  const add = (file: string, line: number, text: string) => {
    if (++seen > max) return;
    let i = re ? text.search(re) : text.toLowerCase().indexOf(low), len = re ? (i < 0 ? 0 : re.exec(text.slice(i))![0].length) : query.length, cut = 0;
    if (text.length > WIDE) { cut = i > WIDE - 100 ? i - 100 : 0; text = text.slice(cut, cut + WIDE); }
    files.set(file, [...(files.get(file) ?? []), { line, text, mark: i < 0 || len === 0 ? null : [i - cut, Math.min(i - cut + len, text.length)] }]);
  };
  if (existsSync(join(game, ".git"))) { // tracked and new files; what git ignores (build output) and binaries are skipped
    const cmd = ["git", "-C", game, "grep", "-n", "-I", "-z", "--no-color", "--untracked", ...(regex ? ["-E"] : ["-F", "-i"]), "-e", query, "--", ...(glob ? [`:(glob)${wider(glob)}`, `:(glob)${wider(glob).replace(/\/+$/, "")}/**`] : [])];
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }), err = new Response(p.stderr).text(), dec = new TextDecoder();
    let buf = "";
    for await (const chunk of p.stdout) {
      buf += dec.decode(chunk, { stream: true });
      for (let nl; (nl = buf.indexOf("\n")) >= 0; buf = buf.slice(nl + 1)) { const [file, n, ...t] = buf.slice(0, nl).split("\0"); if (file && n) add(file, Number(n), t.join("\0")); }
      if (seen >= STOP) { atLeast = true; p.kill(); break; } // a word on every line: stop counting
    }
    const code = await p.exited;
    if (!atLeast && code > 1) throw new Error((await err).replace(/^fatal: (-e option, )?/, "").trim() || "The search failed.");
  } else {
    const want = glob ? [globRe(wider(glob)), globRe(`${wider(glob).replace(/\/+$/, "")}/**`)] : null;
    for (const file of walk(game)) {
      if (want && !want.some((w) => w.test(file))) continue;
      const full = join(game, file); if (statSync(full).size > BIG || binary(full)) continue;
      readFileSync(full, "utf8").split("\n").forEach((text, i) => { if (re ? re.test(text) : text.toLowerCase().includes(low)) add(file, i + 1, text); });
    }
  }
  return { query, in: glob, regex, files: [...files].map(([file, hits]) => ({ file, hits })), shown: Math.min(seen, max), more: Math.max(0, seen - max), atLeast };
}

export function foundText(f: Found): string {
  if (!f.shown) return `Nothing holds "${f.query}"${f.in ? ` in ${f.in}` : ""}. ${f.regex ? "A pattern is matched as written, capitals included." : "Try fewer letters, or --regex for a pattern."}`;
  const body = f.files.map((x) => `${x.file}\n${x.hits.map((h) => `  ${h.line}: ${h.text.trim()}`).join("\n")}`).join("\n");
  return `${body}\n${f.shown} line${f.shown === 1 ? "" : "s"} in ${f.files.length} file${f.files.length === 1 ? "" : "s"}.${f.more ? ` ${f.atLeast ? "More than " : ""}${f.more} more not shown: narrow it with --in <glob>, or raise --max.` : ""}`;
}

export const FIND_HELP = `kit find "<text>" [--in <glob>] [--regex] [--max n] [--json]   search the game folder's source (not build output or binaries): file, line number, the line;
                             plain text in any capitals by default, --regex for a pattern, --in data/maps/** to look in one place; 200 lines at most unless --max
  kit find --file <path> [--at <line>] [--span n] [--json]   the lines of one file around a line (20 each side), numbered`;
export async function findCommand(game: string, args: string[]): Promise<number> {
  const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i < 0 ? undefined : args.splice(i, 2)[1]; }, flag = (n: string) => { const i = args.indexOf(`--${n}`); if (i >= 0) args.splice(i, 1); return i >= 0; };
  const asJson = flag("json"), regex = flag("regex"), glob = opt("in"), max = opt("max"), file = opt("file"), at = opt("at"), span = opt("span");
  try {
    if (file) {
      const r = fileLines(game, file, at === undefined ? 1 : Number(at), span === undefined ? 20 : Number(span)), w = String(r.to).length;
      console.log(asJson ? JSON.stringify(r, null, 1) : `${r.file}  (lines ${r.from} to ${r.to} of ${r.total})\n${r.lines.map((l) => `${l.n === r.at && at !== undefined ? ">" : " "}${String(l.n).padStart(w)}  ${l.text}`).join("\n")}`);
      return 0;
    }
    if (!args.length) throw new Error(`kit find needs the text to look for.\n  ${FIND_HELP}`);
    if (max !== undefined && !(Number(max) >= 1)) throw new Error(`--max is a number of lines; got "${max}"`);
    const r = await findText(game, args.join(" "), { in: glob, regex, max: max === undefined ? undefined : Number(max) });
    console.log(asJson ? JSON.stringify(r, null, 1) : foundText(r));
    return 0;
  } catch (e) { console.error(`kit find: ${(e as Error).message}`); return 1; }
}
