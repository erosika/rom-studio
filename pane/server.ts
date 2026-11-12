#!/usr/bin/env bun
// pane/server.ts: one page that shows what the agent is doing with a game folder.
//   bun pane/server.ts --game <dir> [--port 8778] [--bind 127.0.0.1] [--play <url>] [--data <dir>]
// The game folder can also come from $ROM_STUDIO_GAME, the play link from $ROM_STUDIO_PLAY.
// This computer only unless --bind says otherwise. --bind 0.0.0.0 (or a private network address) lets a phone on the same
// network open it, and only at the link with the key that is printed at start (/k/<key>/, kept in <data>/pane-key.txt).
// A page on another site may open the pane; it cannot read from it, write to it or start anything in it.
// It reads feed.jsonl, shots/, game.md, lore/ and the maps. In the game folder it writes only what the user does on
// the page: refs/ (reference pictures), reviews.jsonl (answers to feed entries), decisions.jsonl (answers to the
// agent's questions) and settings.json (image model and helpers; other keys are kept as they are).
// Kept pictures are remembered in <data>/pane-state.json, outside the game.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { loreFiles, loreReport } from "../kit/lore";
import { musicRoute } from "./music";
import { listenRoute } from "./listen";
import { ARCHIVE_MAX, sourceRoute } from "./source";
import { dialogueRoute } from "./dialogue";
import { addReview, answer, decisions, entryId, reviews, setSettings, settings } from "../kit/inbox";
import { SAFE, bodyUpTo, tooBig, fromElsewhere, hostIsOwn, isLoopback, sameKey, saysJson } from "../kit/web";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const gameArg = arg("game") ?? process.env.ROM_STUDIO_GAME;
if (!gameArg) { // a folder that is not there yet is fine: the Source tab sets a game up in it
  console.error(`no game folder${gameArg ? ` at ${gameArg}` : ""}. Run: bun pane/server.ts --game <your game folder>`);
  process.exit(1);
}
const HERE = import.meta.dir, GAME = resolve(gameArg), SHOTS = join(GAME, "shots"), REFS = join(GAME, "refs");
const PORT = Number(arg("port") ?? process.env.PORT ?? 8778), BIND = arg("bind") ?? "127.0.0.1";
const PLAY = arg("play") ?? process.env.ROM_STUDIO_PLAY ?? null;
const STATE_FILE = join(resolve(arg("data") ?? join(HERE, "data")), "pane-state.json");
const PAGE: Record<string, string> = { "/": "index.html", "/index.html": "index.html", "/pane.css": "pane.css", "/pane.js": "pane.js", "/desktop.css": "desktop.css", "/theme.js": "theme.js" };
const REF_TYPES = /\.(png|jpe?g|webp|gif)$/i, REF_MAX = 20_000_000; // reference pictures only, 20 MB each at most
const PICTURE: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
const DATA = dirname(STATE_FILE), KEY_FILE = join(DATA, "pane-key.txt"), LOCAL_ONLY = /^(127\.|localhost$|::1$)/.test(BIND);
// the key other devices need in the link; made once and kept, so a link sent to a phone stays good
const KEY = (() => {
  try { const k = readFileSync(KEY_FILE, "utf8").trim(); if (/^[0-9a-f]{32}$/.test(k)) return k; } catch {}
  const k = crypto.randomUUID().replaceAll("-", "");
  mkdirSync(DATA, { recursive: true }); writeFileSync(KEY_FILE, `${k}\n`, { mode: 0o600 }); chmodSync(KEY_FILE, 0o600);
  return k;
})();
const save = (file: string, body: string) => { const tmp = `${file}.tmp-${process.pid}`; writeFileSync(tmp, body); renameSync(tmp, file); }; // whole or not at all

const mtime = (path: string) => { try { return statSync(path).mtimeMs; } catch { return null; } };
const text = (path: string) => { try { return readFileSync(path, "utf8"); } catch { return ""; } };
const json = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
// pictures in a folder, newest first
function pictures(dir: string, type: RegExp) {
  let names: string[] = [];
  try { names = readdirSync(dir); } catch {}
  return names.filter((f) => type.test(f)).map((name) => ({ name, t: mtime(join(dir, name)) ?? 0 })).sort((a, b) => b.t - a.t);
}
// remember a slow answer until the files it came from change
const memo = new Map<string, { key: string; value: unknown }>();
function cached<T>(name: string, key: string, make: () => T): T {
  if (memo.get(name)?.key !== key) memo.set(name, { key, value: make() });
  return memo.get(name)!.value as T;
}
// ask the kit; null when it has no such command yet or fails
function kit(...args: string[]) {
  try {
    const r = Bun.spawnSync(["bun", join(HERE, "../kit/kit.ts"), ...args, "--game", GAME], { stderr: "ignore", timeout: 20_000 });
    return r.exitCode === 0 ? r.stdout.toString().trim() : null;
  } catch { return null; }
}
const git = (...args: string[]) => Bun.spawnSync(["git", "-C", GAME, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, stderr: "ignore" }).stdout.toString().trim();

// feed.jsonl in file order; a line that is not an entry is skipped, never fatal. A picture the feed names is looked for
// where the entry says (in shots/, or elsewhere: agents working in their own copy of the game post pictures from there),
// then by its file name in shots/. One that is nowhere is reported as lost, so the page can say so.
let far: string[] = [], farBefore: string[] = []; // entry number -> a picture outside the top of shots/ (the entry's, and its "before")
function feed(have: Map<string, number>) {
  const out: Record<string, unknown>[] = [];
  far = []; farBefore = [];
  for (const line of text(join(GAME, "feed.jsonl")).split("\n")) {
    const e = line.trim() && json(line);
    if (!e || typeof e.did !== "string") continue;
    const more: Record<string, unknown> = { shot: null, shotT: null, id: entryId(e) };
    for (const k of ["t", "scene", "asked", "next", "by", "detail", "answers"]) if (e[k] != null && typeof e[k] !== "string") e[k] = typeof e[k] === "number" ? String(e[k]) : undefined; // the page expects words
    if (typeof e.shot === "string" && e.shot) {
      const name = basename(e.shot), file = resolve(GAME, e.shot), t = /\.png$/i.test(file) ? mtime(file) : null;
      if (have.has(name) && (dirname(file) === SHOTS || t == null)) Object.assign(more, { shot: name, shotT: have.get(name) });
      else if (t != null) { far[out.length] = file; Object.assign(more, { far: `far/${out.length}/${encodeURIComponent(name)}`, farPath: file, shotT: t }); }
      else more.lost = e.shot;
    }
    if (typeof e.before === "string" && e.before) { // the same search for the picture shown beside it
      const name = basename(e.before), file = resolve(GAME, e.before), t = /\.png$/i.test(file) ? mtime(file) : null;
      if (have.has(name) && (dirname(file) === SHOTS || t == null)) Object.assign(more, { before: name, beforeT: have.get(name) });
      else if (t != null) { farBefore[out.length] = file; Object.assign(more, { before: null, beforeFar: `farb/${out.length}/${encodeURIComponent(name)}`, beforeT: t }); }
      else more.before = null;
    }
    out.push({ ...e, ...more });
  }
  return out;
}

// The scene list. First the kit's own answer; then "- [ ] 1 Your room: ..." lines in game.md (under a
// heading that mentions scenes, else any that start with a number); then headings that say "scene 2".
function scenes() {
  const fromKit = json(kit("scenes", "--json") ?? "");
  if (Array.isArray(fromKit) && fromKit.length && fromKit.every((s) => s?.name)) return { from: "kit", list: fromKit.map((s, i) => ({ n: s.n ?? i + 1, name: s.name, label: s.label ?? s.name, idea: s.idea ?? "", done: !!s.done })) };
  const ticks: { text: string; done: boolean; listed: boolean }[] = [], heads = new Map<number, string>();
  let under = "";
  for (const line of text(join(GAME, "game.md")).split("\n")) {
    if (/^#+\s/.test(line)) {
      under = line;
      const h = line.match(/scene\s+(\d+)(?:,\s*([^)]+))?/i);
      if (h && !heads.get(+h[1])) heads.set(+h[1], h[2]?.trim() ?? "");
    }
    const m = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (m) ticks.push({ text: m[2].trim(), done: m[1] !== " ", listed: /scene/i.test(under) });
  }
  const list = ticks.some((t) => t.listed) ? ticks.filter((t) => t.listed) : ticks.filter((t) => /^\d/.test(t.text));
  if (list.length) return { from: "list", list: list.map((t, i) => {
    const m = t.text.match(/^(\d+)?[.)]?\s*([^:]*):?\s*(.*)$/)!;
    return { n: m[1] ? +m[1] : i + 1, name: m[2].trim(), label: `${m[1] ?? ""} ${m[2]}`.trim(), idea: m[3].trim(), done: t.done };
  }) };
  return { from: heads.size ? "headings" : null, list: [...heads].sort((a, b) => a[0] - b[0]).map(([n, idea]) => ({ n, name: `Scene ${n}`, label: `Scene ${n}`, idea, done: null })) };
}

// The maps the user made: map folders added since the engine's first commit, or not committed yet.
function madeMaps() {
  const root = git("rev-list", "--max-parents=0", "HEAD").split("\n").pop();
  if (!root) return [];
  const files = `${git("diff", "--name-only", "--diff-filter=A", root, "--", "data/maps")}\n${git("ls-files", "--others", "--exclude-standard", "data/maps")}`;
  return [...new Set([...files.matchAll(/^data\/maps\/([^/]+)\/map\.json$/gm)].map((m) => m[1]))];
}
function maps() {
  const names = cached("made", String(mtime(join(GAME, "data/maps/map_groups.json"))), madeMaps);
  const layoutsFile = join(GAME, "data/layouts/layouts.json"), file = (n: string) => join(GAME, "data/maps", n, "map.json");
  return cached("maps", [mtime(layoutsFile), ...names.map((n) => mtime(file(n)))].join(), () => {
    const layouts: any[] = json(text(layoutsFile))?.layouts ?? [];
    const mine = names.flatMap((name) => {
      try {
        const j = json(text(file(name))), l = layouts.find((x) => x.id === j.layout), bin = readFileSync(join(GAME, l.blockdata_filepath));
        let blocked = ""; // one character per square, row by row: 1 where the player cannot walk
        for (let i = 0; i + 1 < bin.length; i += 2) blocked += (bin.readUInt16LE(i) >> 10) & 3 ? "1" : "0";
        const spots = (list: any[] | null, to?: string) => (list ?? []).map((o) => ({ x: o.x, y: o.y, ...(to ? { to: o[to] } : {}) }));
        return [{ name, id: j.id, width: l.width, height: l.height, t: mtime(join(GAME, l.blockdata_filepath)), blocked,
          people: spots(j.object_events), doors: spots(j.warp_events, "dest_map"), joins: (j.connections ?? []).map((c: any) => ({ dir: c.direction, to: c.map })) }];
      } catch { return []; }
    });
    const fromKit = json(kit("maps", "--json") ?? ""); // the kit's answer wins field by field once it exists
    const all = mine.map((m) => ({ ...m, ...(Array.isArray(fromKit) ? fromKit.find((k) => k?.name === m.name) : null) }));
    const nameOf = (id: string) => all.find((m) => m.id === id)?.name ?? String(id).replace(/^MAP_/, "").toLowerCase().replace(/_/g, " ");
    return all.map((m) => ({ ...m, doors: m.doors.map((d: any) => ({ ...d, to: nameOf(d.to) })), joins: m.joins.map((c: any) => ({ ...c, to: nameOf(c.to) })) }));
  });
}
// A picture of a whole map: the kit's render when it can make one; until then a whole-map render
// already in shots/, matched by the words of the map's name (the last part of the name counts most).
function mapPicture(name: string) {
  const to = join(DATA, "maps", `${name}.png`); // drawn into the pane's own folder: looking at a map writes nothing in the game
  const fromKit = cached(`png ${name}`, String(mtime(join(GAME, "data/maps", name, "map.json"))), () => (/^\w[\w.-]*$/.test(name) && kit("map", name, "--png", to) ? to : ""));
  if (fromKit && existsSync(fromKit)) return fromKit;
  const parts = name.split("_").map((p) => p.split(/(?=[A-Z])/).map((w) => w.toLowerCase()));
  const score = (f: string) => parts.reduce((sum, words, i) => sum + words.filter((w) => f.toLowerCase().split(/[^a-z0-9]+/).includes(w)).length * (i + 1), 0);
  const best = pictures(SHOTS, /render.*\.png$/i).map((p) => ({ ...p, s: score(p.name) })).sort((a, b) => b.s - a.s)[0];
  return best?.s ? join(SHOTS, best.name) : null;
}

const kept = (): string[] => { const k = json(text(STATE_FILE))?.[GAME]?.kept; return Array.isArray(k) ? k.filter((x) => typeof x === "string") : []; };
function keep(name: string, on: boolean) {
  const all = json(text(STATE_FILE)) ?? {};
  if (!/\.png$/i.test(name) || name.length > 200) return new Response("a picture's file name is needed", { status: 400 });
  all[GAME] = { kept: [...new Set([...kept().filter((k) => k !== name), ...(on ? [name] : [])])] };
  mkdirSync(DATA, { recursive: true });
  save(STATE_FILE, JSON.stringify(all, null, 1));
  return new Response("ok");
}

// what the user answered, by entry id; the agent's questions with their answers; the last build's result
const inbox = () => cached("inbox", [mtime(join(GAME, "feed.jsonl")), mtime(join(GAME, "reviews.jsonl")), mtime(join(GAME, "decisions.jsonl"))].join(), () => ({
  reviews: Object.fromEntries(reviews(GAME).map((r) => [r.id, { verdict: r.verdict, note: r.note ?? "", t: r.t, handled: r.handled }])), decisions: decisions(GAME) }));
// the player kit play started, if it is still up: its link for this computer and its link for other devices
function player() {
  const r = json(text(join(GAME, "out/.player.json")));
  try { process.kill(r.pid, 0); } catch { return {}; }
  const links = (Array.isArray(r.lines) ? r.lines : []).map((l: unknown) => String(l).split(/\s+/).pop()!).filter((l: string) => /^https?:\/\//.test(l)); // a link the page may put in href
  return { play: links[0] ?? null, playFar: links[1] ?? null, playLinks: links.slice(1) };
}
const lastBuild = () => { const f = join(GAME, "out/.last-build"), t = mtime(f); return t == null ? null : { text: text(f).trim(), t }; };
function state() {
  const shots = pictures(SHOTS, /\.png$/i), s = cached("scenes", String(mtime(join(GAME, "game.md"))), scenes);
  return { dir: GAME, feed: feed(new Map(shots.map((p) => [p.name, p.t]))), ...inbox(), lastBuild: lastBuild(), shots, refs: pictures(REFS, REF_TYPES), kept: kept(),
    scenes: s.list, scenesFrom: s.from, maps: maps(), built: mtime(join(GAME, "out/game.gba")), ...(PLAY ? { play: PLAY, playFar: PLAY } : { play: null, playFar: null, ...player() }),
    page: Math.max(...Object.values(PAGE).map((f) => mtime(join(HERE, f)) ?? 0)) }; // lets an open page notice it is older than these files
}

async function saveRef(req: Request, rawName: string) {
  // letters, digits, dash, underscore and dot only; 80 characters at most
  const name = rawName.replace(/[^\p{L}\p{N}\-_.]/gu, "").slice(0, 80);
  if (!REF_TYPES.test(name)) return new Response("pictures only: png, jpg, jpeg, webp or gif", { status: 400 });
  const body = await bodyUpTo(req, REF_MAX);
  if (!body) return tooBig("too big: 20 MB at most");
  const head = Buffer.from(body.subarray(0, 12)).toString("latin1"), is = /^\x89PNG/.test(head) ? "png" : /^\xff\xd8\xff/.test(head) ? "jpeg" : /^GIF8[79]a/.test(head) ? "gif" : /^RIFF....WEBP/s.test(head) ? "webp" : null;
  if (is !== PICTURE[name.split(".").pop()!.toLowerCase()]?.slice(6)) return new Response("that file is not the kind of picture its name says", { status: 400 });
  mkdirSync(REFS, { recursive: true });
  await Bun.write(join(REFS, name), body);
  return new Response("ok");
}

// The lore index (lore/<id>.md): the list, and one id with what points at it, its pictures and its lineage. Read-only.
const loreKey = () => [mtime(join(GAME, "lore")), mtime(SHOTS), mtime(join(GAME, "game.md")), mtime(join(GAME, ".git/HEAD")), mtime(join(GAME, ".git/logs/HEAD"))].join();
function lore(id: string | null) {
  if (!id) return cached("lore", loreKey(), () => loreFiles(GAME).map(({ id, name, mood }) => ({ id, name, mood })));
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || !existsSync(join(GAME, "lore", `${id}.md`))) return null;
  return cached(`lore ${id}`, `${loreKey()},${mtime(join(GAME, "lore", `${id}.md`))}`, () => {
    const r = loreReport(GAME, id);
    return { ...r, pictures: r.pictures.filter((p) => /^shots\/[^/]+$/.test(p.file)).map((p) => ({ name: basename(p.file), t: Date.parse(p.t) })) }; // the pane serves the top of shots/ only
  });
}

// what the page may change in settings.json; every other key stays as it is
const SETTABLE = ["image_model", "image_models", "workers", "default_worker"];
async function post(req: Request, path: string) {
  if (!saysJson(req)) return new Response("the body must be sent as application/json", { status: 415 });
  const raw = await bodyUpTo(req, 1_000_000); if (!raw) return tooBig("too big");
  let b: any; try { b = JSON.parse(Buffer.from(raw).toString("utf8")); } catch { return new Response("the body must be JSON", { status: 400 }); }
  if (!b || typeof b !== "object" || Array.isArray(b)) return new Response("the body must be one JSON object", { status: 400 });
  try {
    if (path === "/review") return Response.json(addReview(GAME, b));
    if (path === "/decision") return Response.json(answer(GAME, String(b.id ?? ""), String(b.answer ?? "")));
    if (path === "/settings") {
      const bad = Object.keys(b).find((k) => !SETTABLE.includes(k)); if (bad) throw new Error(`the page may set only ${SETTABLE.join(", ")}; not "${bad}"`);
      if (b.workers !== undefined && !(Array.isArray(b.workers) && b.workers.every((w: any) => w && typeof w.name === "string" && w.name.trim() && typeof w.how === "string"))) throw new Error("each helper needs a name and a command");
      for (const k of ["image_model", "default_worker"]) if (b[k] != null && typeof b[k] !== "string") throw new Error(`${k} is a name`);
      if (b.image_models != null && !Array.isArray(b.image_models)) throw new Error("image_models is a list");
      return Response.json(setSettings(GAME, b));
    }
  } catch (e) { return new Response((e as Error).message, { status: 400 }); }
  return new Response("not found", { status: 404 });
}

// a picture, as a picture and nothing else; `within` also refuses a link that leads out of that folder
function send(file: string | null, ok = true, within?: string) {
  const type = PICTURE[file?.split(".").pop()?.toLowerCase() ?? ""];
  if (!file || !ok || !type || !existsSync(file)) return new Response("no such picture", { status: 404 });
  if (within) { try { if (!realpathSync(file).startsWith(realpathSync(within) + sep)) throw 0; } catch { return new Response("no such picture", { status: 404 }); } }
  return new Response(Bun.file(file), { headers: { "Content-Type": type } });
}
const index = text(join(HERE, "index.html")), inline = /<script>([\s\S]*?)<\/script>/.exec(index)?.[1] ?? "";
// the page runs its own scripts and the one small script written into it, loads only from here, and sends nothing elsewhere
const POLICY = `default-src 'self'; script-src 'self' 'sha256-${new Bun.CryptoHasher("sha256").update(inline).digest("base64")}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'`;
const isPage = (path: string) => path in PAGE || path === "/listen" || path === "/listen/";
async function handle(req: Request, path: string) {
  const name = basename(path);
  const music = await musicRoute(req, path, GAME); if (music) return music;
  const heard = listenRoute(req, path, GAME); if (heard) return heard;
  const source = await sourceRoute(req, path, GAME, DATA); if (source) return source;
  const lines = await dialogueRoute(req, path, GAME); if (lines) return lines;
  if (req.method === "PUT" && path.startsWith("/refs/")) return saveRef(req, name);
  if (path.startsWith("/kept/") && (req.method === "PUT" || req.method === "DELETE")) return keep(name, req.method === "PUT");
  if ((req.method === "POST" || req.method === "PUT") && ["/review", "/decision", "/settings"].includes(path)) return post(req, path);
  if (req.method !== "GET") return new Response("not allowed", { status: 405 });
  if (path === "/settings") { try { return Response.json(settings(GAME), { headers: { "Cache-Control": "no-cache" } }); } catch (e) { return new Response(`settings.json cannot be read: ${(e as Error).message}`, { status: 500 }); } }
  if (path === "/state") {
    const body = JSON.stringify(state());
    const etag = `"${Bun.hash(body).toString(36)}"`; // unchanged since the page last asked: answer 304
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
    return new Response(body, { headers: { "Content-Type": "application/json", ETag: etag, "Cache-Control": "no-cache" } });
  }
  if (path === "/lore" || path.startsWith("/lore/")) { const r = lore(path === "/lore" ? null : name); return r ? Response.json(r, { headers: { "Cache-Control": "no-cache" } }) : new Response("no such lore id", { status: 404 }); }
  if (path.startsWith("/shots/")) return send(join(SHOTS, name), /\.png$/i.test(name), GAME);
  if (path.startsWith("/refs/")) return send(join(REFS, name), REF_TYPES.test(name), GAME);
  if (path.startsWith("/farb/")) { if (!farBefore.length) state(); return send(farBefore[Number(path.split("/")[2])] ?? null); }
  if (path.startsWith("/far/")) { if (!far.length) state(); return send(far[Number(path.split("/")[2])] ?? null); } // only pictures the feed names
  if (path.startsWith("/map/")) return send(maps().some((m) => m.name === name) ? mapPicture(name) : null);
  if (PAGE[path]) return new Response(Bun.file(join(HERE, PAGE[path])), { headers: { "Cache-Control": "no-cache", ...(PAGE[path] === "index.html" ? { "Content-Security-Policy": POLICY } : {}) } });
  return new Response("not found", { status: 404 });
}
// who may ask: this computer by its own name, or anyone holding the key; and no page on another site
async function gate(req: Request, peer: string | undefined) {
  let path: string; try { path = decodeURIComponent(new URL(req.url).pathname); } catch { return new Response("that address is not valid", { status: 400 }); }
  const k = /^\/k\/([^/]+)(\/.*)?$/.exec(path);
  if (k) {
    if (!sameKey(k[1]!, KEY)) return new Response("That key is not this pane's. Use the link printed when the pane started.", { status: 401 });
    if (!k[2]) return new Response(null, { status: 302, headers: { Location: `${basename(path)}/` } });
    path = k[2];
  } else {
    if (!isLoopback(peer)) return new Response("From another device this pane opens only at its full link, the one with the key, printed when the pane started.", { status: 401 });
    if (!hostIsOwn(req)) return new Response("Open the pane as http://127.0.0.1 or http://localhost on this computer.", { status: 403 });
    const no = fromElsewhere(req, isPage(path)); if (no) return new Response(no, { status: 403 });
  }
  return handle(req, path);
}

let server;
try {
  server = Bun.serve({ hostname: BIND, port: PORT, maxRequestBodySize: ARCHIVE_MAX + 1_000_000, idleTimeout: 255, // an archive is unpacked and a song recorded before the answer goes out
    fetch: async (req, srv) => {
      const res = await gate(req, srv.requestIP(req)?.address).catch((e) => { console.error(`pane: ${req.method} ${new URL(req.url).pathname.replace(/^\/k\/[^/]+/, "")}: ${e?.stack ?? e}`); /* the key is never written out */ return new Response("The studio could not answer that; its own output says why.", { status: 500 }); });
      for (const [h, v] of Object.entries(SAFE)) res.headers.set(h, v);
      return res;
    } });
} catch (e) {
  console.error(`could not open ${BIND}:${PORT} (${(e as Error).message}). Is the pane already running? Try --port <other>.`);
  process.exit(1);
}
console.log(`pane for ${GAME}`);
console.log(LOCAL_ONLY ? `open:  http://${BIND.includes(":") ? `[${BIND}]` : BIND}:${server.port}/` : `open:  http://${BIND === "0.0.0.0" ? "<this computer's address>" : BIND}:${server.port}/k/${KEY}/   (other devices need this whole link; keep it to yourself)`);
