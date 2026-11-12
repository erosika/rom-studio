// pane/source.ts: the Source tab's routes. What the decomp in the game folder is, a search through it and the lines around
// a hit (the same code as `kit find`), and bringing a decomp in: a folder, a git address or an archive handed to `kit setup`.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileLines, findText, walk } from "../kit/find";
import { bodyUpTo, saysJson, tooBig } from "../kit/web";
import { childEnv } from "../kit/env";

const HERE = import.meta.dir, KIT = join(HERE, "../kit/kit.ts");
export const ARCHIVE_MAX = 600_000_000;
const UNPACKED_MAX = 4_000_000_000, FILES_MAX = 300_000, UNPACK_MS = 15 * 60_000, KINDS = /\.(zip|tar\.gz|tgz)$/i;
let job: { proc: ReturnType<typeof Bun.spawn>; from: string } | null = null;

// Checks every entry before writing one; writes only plain files and folders, so no link is ever made or followed.
const UNPACK = `
import os, shutil, sys, tarfile, zipfile
src, dest, cap, most = sys.argv[1], os.path.realpath(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
def big(): sys.exit("Refused: the archive unpacks to more than %d GB or holds more than %d files. Nothing was unpacked." % (cap // 10**9, most))
def check(name):
    n = name.replace("\\\\", "/")
    if n.startswith("/") or n[1:2] == ":" or ".." in n.split("/") or "\\0" in n or not (os.path.realpath(os.path.join(dest, n)) + os.sep).startswith(dest + os.sep):
        sys.exit("Refused: the archive holds a path that would unpack outside its folder (" + name + "). Nothing was unpacked.")
def put(name, data, mode):
    to = os.path.join(dest, name); os.makedirs(os.path.dirname(to), exist_ok=True)
    with open(to, "wb") as f: shutil.copyfileobj(data, f)
    global wrote; wrote += os.path.getsize(to)
    if wrote > cap: big() # an entry that holds more than it said
    os.chmod(to, 0o755 if mode & 0o111 else 0o644)
try:
    if zipfile.is_zipfile(src):
        z = zipfile.ZipFile(src); items = [(i.filename, i.is_dir(), ((i.external_attr >> 16) & 0o170000) in (0, 0o100000), i.file_size, i.external_attr >> 16, i) for i in z.infolist()]
        read = z.open
    else:
        t = tarfile.open(src, "r:*"); items = []; total = 0
        for m in t: # counted while the list is read, so an archive that swells without end is given up on early
            total += m.size if m.isreg() else 0
            if total > cap or len(items) >= most: big()
            items.append((m.name, m.isdir(), m.isreg(), m.size if m.isreg() else 0, m.mode, m))
        read = t.extractfile
except Exception as e:
    sys.exit("Not an archive this can read (a .zip or .tar.gz is needed): " + str(e))
for name, *_ in items: check(name)
if sum(i[3] for i in items) > cap or len(items) > most: big()
n = wrote = 0
for name, isdir, plain, size, mode, item in items:
    if isdir: os.makedirs(os.path.join(dest, name), exist_ok=True)
    elif plain: put(name, read(item), mode); n += 1
print(n)
`;

/** Unpacks a .zip or .tar.gz into a fresh folder; throws the plain reason when it holds a path that climbs out. */
export async function unpack(archive: string, dest: string): Promise<number> {
  mkdirSync(dest, { recursive: true });
  const p = Bun.spawn(["python3", "-I", "-c", UNPACK, archive, dest, String(UNPACKED_MAX), String(FILES_MAX)], { env: childEnv(), stdout: "pipe", stderr: "pipe" });
  let late = false; const timer = setTimeout(() => { late = true; p.kill("SIGKILL"); }, UNPACK_MS);
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]); clearTimeout(timer);
  if (code !== 0) { rmSync(dest, { recursive: true, force: true }); throw new Error(late ? "Unpacking took more than 15 minutes and was stopped. Unpack it yourself and give the folder instead." : err.trim().split("\n").pop() || "The archive could not be unpacked."); }
  return Number(out);
}
/** The folder of an unpacked tree that holds the Makefile: the top, or the nearest folder below it. */
export function treeRoot(dir: string): string | null {
  for (let level = [dir], depth = 0; level.length && depth < 4; depth++) {
    const hit = level.find((d) => existsSync(join(d, "Makefile"))); if (hit) return hit;
    level = level.flatMap((d) => readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(d, e.name)));
  }
  return null;
}

const holds = (game: string) => { try { return readdirSync(game).length > 0; } catch { return false; } };
const isGame = (game: string) => existsSync(join(game, "Makefile"));
const pidFile = (data: string) => join(data, "source-setup.pid"), logFile = (data: string) => join(data, "source-setup.log");
function running(data: string): boolean {
  if (job) return true;
  try { const pid = Number(readFileSync(pidFile(data), "utf8")); if (!(pid > 1)) return false; process.kill(pid, 0); return true; } catch { return false; } // one started before this server was
}
/** Why setup may not start, as a sentence for the user; null when it may. */
export function refusal(game: string, data: string): string | null {
  if (running(data)) return "A setup is already running. Its progress is on this page; wait for it to end.";
  if (isGame(game)) return `There is already a game in ${game}, and setup never overwrites a game. To build on another decomp, start the studio with a new, empty game folder (--game <new folder>). If this game's first build did not finish, ask your agent to run: kit setup`;
  if (holds(game)) return `${game} holds files that are not a game. Setup needs an empty or new folder: start the studio with --game <new folder>, or move those files away yourself.`;
  return null;
}
/** Starts `kit setup --decomp <from>` on its own, its progress going to a log in the data folder. */
export function startSetup(game: string, data: string, from: string, unpacked?: string): void {
  const no = refusal(game, data); if (no) throw new Error(no);
  if (!from || from.startsWith("-") || /[\0\n]/.test(from)) throw new Error("Give your decomp's folder or its git address.");
  mkdirSync(data, { recursive: true }); const log = logFile(data);
  writeFileSync(log, `Setting up from ${from}\n`);
  const fd = openSync(log, "a"); // one appending handle for both streams, so the lines stay in order
  const proc = Bun.spawn([process.execPath, KIT, "setup", "--decomp", from, "--game", game], { env: childEnv(), stdin: "ignore", stdout: fd, stderr: fd, detached: true } as any);
  closeSync(fd); writeFileSync(pidFile(data), String(proc.pid)); job = { proc, from }; proc.unref();
  proc.exited.then((code) => {
    job = null; rmSync(pidFile(data), { force: true }); if (unpacked) rmSync(unpacked, { recursive: true, force: true }); // the game folder has its own copy by now
    appendFileSync(log, code === 0 ? "[setup finished]\n" : "[setup stopped: the reason is on the line above]\n");
  });
}
function progress(data: string) {
  let lines: string[] = []; try { lines = readFileSync(logFile(data), "utf8").split(/[\r\n]+/).filter(Boolean); } catch {}
  const run = running(data), last = lines.at(-1) ?? "";
  return { running: run, ok: run || !lines.length ? null : last === "[setup finished]", lines: lines.slice(-30) };
}

function info(game: string, data: string) {
  const exists = existsSync(game), game_ = exists && isGame(game), folders = new Map<string, number>();
  if (game_) {
    const ls = existsSync(join(game, ".git")) ? Bun.spawnSync(["git", "-C", game, "ls-files"], { env: childEnv({ GIT_OPTIONAL_LOCKS: "0" }) }).stdout.toString().split("\n").filter(Boolean) : [...walk(game)];
    for (const f of ls) { const top = f.includes("/") ? f.slice(0, f.indexOf("/")) : ""; folders.set(top, (folders.get(top) ?? 0) + 1); }
  }
  let says: Record<string, string> = {};
  if (game_) try {
    const out = Bun.spawnSync([process.execPath, KIT, "status", "--game", game], { env: childEnv(), stderr: "ignore", timeout: 20_000 }).stdout.toString();
    says = Object.fromEntries(["decomp", "base", "last build"].map((k) => [k, new RegExp(`^${k}: (.*)$`, "m").exec(out)?.[1] ?? ""]).filter(([, v]) => v));
  } catch {}
  return { game, exists, isGame: game_, holdsFiles: holds(game), says, files: folders.get("") ?? 0, refusal: refusal(game, data),
    folders: [...folders].filter(([name]) => name).map(([name, files]) => ({ name, files })).sort((a, b) => a.name.localeCompare(b.name)) };
}

async function archive(req: Request, name: string, game: string, data: string) {
  const kind = KINDS.exec(name)?.[0].toLowerCase(); if (!kind) throw new Error("The archive must be a .zip or a .tar.gz file.");
  const no = refusal(game, data); if (no) throw new Error(no);
  const big = `Too big: an archive of ${ARCHIVE_MAX / 1e6} MB at most. Unpack it yourself and give the folder instead.`;
  if (Number(req.headers.get("content-length") ?? 0) > ARCHIVE_MAX) return tooBig(big); // before a byte of it is read
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14), file = join(data, `source-upload-${stamp}${kind}`), dest = join(data, `decomp-${stamp}`);
  if (existsSync(dest)) throw new Error("Another archive arrived this second. Send it again.");
  mkdirSync(data, { recursive: true });
  try {
    const w = Bun.file(file).writer(); let size = 0; // to disk as it arrives, never all in memory
    try { if (req.body) for await (const chunk of req.body) { size += chunk.byteLength; if (size > ARCHIVE_MAX) break; w.write(chunk); await w.flush(); } } finally { await w.end(); }
    if (size > ARCHIVE_MAX) return tooBig(big);
    if (!size) throw new Error("The archive arrived empty.");
    const files = await unpack(file, dest), root = treeRoot(dest);
    if (!root) { rmSync(dest, { recursive: true, force: true }); throw new Error(`Unpacked ${files} files, but none of the top folders holds a Makefile, so this does not look like a decomp. Nothing was set up.`); }
    startSetup(game, data, root, dest);
    return Response.json({ started: true, from: root, files });
  } finally { rmSync(file, { force: true }); }
}

/** Answers the Source tab's requests; null when the request is not one of them. */
export async function sourceRoute(req: Request, path: string, game: string, data: string): Promise<Response | null> {
  if (path === "/source.js") return new Response(Bun.file(join(HERE, "source.js")), { headers: { "Cache-Control": "no-cache" } });
  if (!path.startsWith("/source/")) return null;
  const [, , what, ...rest] = path.split("/"), q = new URL(req.url).searchParams, fresh = { headers: { "Cache-Control": "no-cache" } };
  try {
    if (req.method === "GET" && what === "search") return Response.json(await findText(game, q.get("q") ?? "", { in: q.get("in"), regex: q.get("regex") === "1" }), fresh);
    if (req.method === "GET" && what === "file") return Response.json(fileLines(game, q.get("path") ?? "", Number(q.get("at") ?? 1), Number(q.get("span") ?? 20)), fresh);
    if (req.method === "GET" && what === "info") return Response.json(info(game, data), fresh);
    if (req.method === "GET" && what === "setup") return Response.json(progress(data), fresh);
    if (req.method === "POST" && what === "setup") {
      if (!saysJson(req)) return new Response("the body must be sent as application/json", { status: 415 });
      const raw = await bodyUpTo(req, 100_000); if (!raw) return tooBig("too big");
      let b: any; try { b = JSON.parse(Buffer.from(raw).toString("utf8")); } catch { throw new Error("the body must be JSON"); }
      startSetup(game, data, String(b?.from ?? "").trim());
      return Response.json({ started: true });
    }
    if (req.method === "PUT" && what === "archive") return await archive(req, rest.join("/"), game, data);
  } catch (e) { return new Response((e as Error).message, { status: 400 }); }
  return new Response("not found", { status: 404 });
}
