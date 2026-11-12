#!/usr/bin/env bun
// player/server.ts: serves the play page and the built ROM. This computer only by default.
//   bun player/server.ts          http://127.0.0.1:<port>/   (laptop)
//   bun player/server.ts --lan    also https://<this computer>:<port+1>/#k=<key> for a phone on the same network
// The emulator needs cross-origin isolation, which browsers grant only on localhost or https; so the
// phone address is https with a certificate made here (the phone shows a warning once), and the ROM, the
// agent link and the page's log line are only answered over it with the key.
// The agent link runs the host's own command line with the player's words on its standard input, never as an
// argument: no flag that approves tools or skips a permission is passed, so the agent can do what the user's own
// host setup lets a quiet one-shot chat do and no more; a question it would ask a person meets a closed input.
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { tableFrom } from "./game-text.js";
import { childEnv } from "../kit/env";
import { bodyUpTo, fromElsewhere, hostIsOwn, sameKey, saysJson, tooBig } from "../kit/web";

const HERE = import.meta.dir;
const ROM = process.env.ROM ?? join(HERE, "../../rom-studio-game/out/game.gba");
const MGBA = join(HERE, "node_modules/@thenick775/mgba-wasm/dist");
const ISOLATED = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const FILES: Record<string, [string, string]> = {
  "/": [join(HERE, "index.html"), "text/html; charset=utf-8"],
  "/play.js": [join(HERE, "play.js"), "text/javascript"],
  "/guard.js": [join(HERE, "guard.js"), "text/javascript"],
  "/game-text.js": [join(HERE, "game-text.js"), "text/javascript"],
  "/hermes-link.js": [join(HERE, "hermes-link.js"), "text/javascript"],
  "/mgba/mgba.js": [join(MGBA, "mgba.js"), "text/javascript"],
  "/mgba/mgba.wasm": [join(MGBA, "mgba.wasm"), "application/wasm"],
};
let zipped: { mtime: number; body: Uint8Array } | null = null; // the ROM is mostly padding: gzip once per build

// ---- the in-game agent link: the game's START menu entry asks, this forwards the words to the user's agent ----
// settings.json in the game folder: hermes_link (default on when the game has the mailbox), hermes_command (default
// "hermes"), hermes_session (one named conversation, continued across messages), hermes_preface, hermes_timeout (seconds).
const GAME = process.env.GAME ?? dirname(dirname(ROM));
const settings = (): Record<string, any> => { try { const s = JSON.parse(readFileSync(join(GAME, "settings.json"), "utf8")); return s && typeof s === "object" ? s : {}; } catch { return {}; } };
const symbol = (name: string): number | null => { try { const m = new RegExp(`^([0-9a-f]{8}) .* ${name}$`, "m").exec(readFileSync(ROM.replace(/\.gba$/, ".sym"), "utf8")); return m ? parseInt(m[1]!, 16) : null; } catch { return null; } };
const read = (rel: string) => { try { return readFileSync(join(GAME, rel), "utf8"); } catch { return ""; } };
export const PREFACE = "[Note: these words were typed inside the user's own game, through the agent entry of its START menu, and your reply is shown in the game's " +
  "two-line message box. Answer as yourself, briefly: plain text, no markdown, no emoji, under 300 characters unless asked for more. If you offer choices, " +
  "put each on its own line as \"1. ...\", \"2. ...\" (two to four, 14 characters or fewer each); the game turns them into a menu.]";
let places: Map<string, string> | null = null; // "group.num" -> the place's name in the game
function place(at: any): string {
  if (!at || typeof at.group !== "number") return "";
  if (!places) {
    places = new Map();
    try {
      const ids = new Map<string, string>(), names = new Map<string, string>();
      for (const m of read("include/constants/map_groups.h").matchAll(/(MAP_\w+)\s*=\s*\((\d+) \| \((\d+) << 8\)\)/g)) ids.set(m[1]!, `${m[3]}.${m[2]}`);
      for (const s of JSON.parse(read("src/data/region_map/region_map_sections.json") || "{}").map_sections ?? []) if (s.name) names.set(s.id, s.name);
      for (const d of readdirSync(join(GAME, "data/maps"))) { const j = read(`data/maps/${d}/map.json`); if (!j) continue; const m = JSON.parse(j), k = ids.get(m.id); if (k) places.set(k, names.get(m.region_map_section) ?? d); }
    } catch {}
  }
  const name = places.get(`${at.group}.${at.num}`);
  return name ? `[In the game right now the player is at ${name}, square ${Number(at.x) || 0},${Number(at.y) || 0}.]` : "";
}
let busy = false;
const NO_SIGNAL = "No signal. Try me again.", REPLY_MAX = 20_000;
/** The host's command. settings.json can be written by `kit settings`, so a command there counts only when it is still
 *  the host's own (`hermes`, or a path to it); any other program has to be named by the user, in ROM_STUDIO_HERMES_COMMAND. */
export function hermesCommand(s: Record<string, any>, own = process.env.ROM_STUDIO_HERMES_COMMAND): string[] {
  const words = (v: unknown) => String(v ?? "").split(/\s+/).filter(Boolean);
  if (words(own).length) return words(own);
  const set = words(s.hermes_command);
  return set.length && /(^|\/)hermes$/.test(set[0]) ? set : ["hermes"];
}
/** The command line the words are handed to: the host's own, one named conversation, quiet, the words on standard input. */
export function agentCommand(s: Record<string, any>): string[] {
  const cmd = hermesCommand(s), session = /^[\w.][\w.-]{0,63}$/.test(String(s.hermes_session ?? "")) ? String(s.hermes_session) : "rom-studio-game"; // never a word that reads as a flag; the default is this plugin's own, not a name another tool may use
  return [...cmd, "chat", "--query-file", "-", "-Q", "-c", session, "--create-if-missing", "--source", "game"];
}
export async function ask(text: string, at: unknown): Promise<string> {
  const s = settings(), secs = Math.min(Math.max(Number(s.hermes_timeout) || 60, 1), 240); // the connection itself is given up on after 255 s
  const body = [typeof s.hermes_preface === "string" ? s.hermes_preface : PREFACE, place(at), "", text].filter((l, i) => l || i === 2).join("\n");
  let proc: ReturnType<typeof Bun.spawn>;
  try { proc = Bun.spawn(agentCommand(s), { cwd: homedir(), env: childEnv(), stdin: new Blob([body]), stdout: "pipe", stderr: "pipe" }); }
  catch { return NO_SIGNAL; }
  let timer: ReturnType<typeof setTimeout>, hard: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((done) => { timer = setTimeout(() => { proc.kill(); hard = setTimeout(() => proc.kill("SIGKILL"), 2000); done("late"); }, secs * 1000); });
  const read = async (stream: ReadableStream<Uint8Array>, max: number) => { let out = ""; const dec = new TextDecoder(); for await (const c of stream) if (out.length < max) out += dec.decode(c, { stream: true }); return out; };
  const done = Promise.all([read(proc.stdout as ReadableStream<Uint8Array>, REPLY_MAX), read(proc.stderr as ReadableStream<Uint8Array>, 4000), proc.exited]);
  const r = await Promise.race([done, late]); clearTimeout(timer!); // a child of the command may hold the pipes open: the time limit does not wait for them
  if (r === "late") { done.catch(() => {}).finally(() => clearTimeout(hard)); console.log(`agent link: no answer in ${secs} s; the command was stopped`); return NO_SIGNAL; }
  const [out, err, code] = r;
  if (code !== 0) { console.log(`agent link: the command failed: ${(err.trim().split("\n").at(-1) ?? String(code)).replace(/[^\x20-\x7e]/g, " ").slice(0, 300)}`); return NO_SIGNAL; }
  return out.trim().slice(0, REPLY_MAX) || "…";
}
function linkInfo() {
  const s = settings(), mailbox = symbol("gHermesMailbox"), charmap = read("charmap.txt");
  return { mailbox, hook: symbol("gStudioMailbox"), on: mailbox !== null && !!charmap && s.hermes_link !== false, player: String(s.player_name ?? "YOU").toUpperCase(), agent: String(s.hermes_name ?? "HERMES"),
    table: tableFrom(charmap, read("src/fonts.c")) };
}

const PANE = process.env.ROM_STUDIO_PANE_LOCAL ?? "http://127.0.0.1:8778"; // where the pane listens on this computer
const DROP = /^(host|origin|referer|cookie|connection|content-length|sec-fetch-.*)$/i; // checked here; the pane is asked as this computer
/** One listener's answers. `key` is null on this computer's own address; over the network it is needed for the game, the agent link and the log. */
export function handler(key: string | null, host: string | null = null) {
  const no = (text: string, status: number) => new Response(text, { status, headers: ISOLATED });
  return async (req: Request) => {
    const path = new URL(req.url).pathname, pane = path === "/pane" || path.startsWith("/pane/");
    if (key ? (req.headers.get("host") ?? "").replace(/:\d+$/, "") !== host : !hostIsOwn(req)) return no("open the player by the address it printed", 403);
    const other = fromElsewhere(req, path === "/" || (!key && (path === "/pane" || path === "/pane/"))); if (other) return no(other, 403);
    const keyed = () => !key || sameKey(req.headers.get("x-key") ?? "", key);
    // the pane under the same secure address as the game, so one trusted link serves both (only on the keyless local side)
    if (!key && path === "/pane") return Response.redirect("/pane/", 302);
    if (!key && pane) {
      const headers = new Headers(); req.headers.forEach((v, k) => { if (!DROP.test(k)) headers.set(k, v); });
      const r = await fetch(PANE + path.slice(5) + new URL(req.url).search, { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body, redirect: "manual", keepalive: req.method === "GET" }).catch(() => null); // a body the pane refuses half-sent must not share a connection with the next request
      if (!r) return new Response("the pane is not running", { status: 502 });
      const h = new Headers(r.headers); h.delete("content-encoding"); h.delete("content-length");
      return new Response(r.body, { status: r.status, headers: h });
    }
    if (path === "/log" && req.method === "POST") {
      if (!keyed()) return no("open the full link with its key once", 401);
      const said = await bodyUpTo(req, 4000);
      console.log(`page: ${Buffer.from(said ?? []).toString("utf8").replace(/[^\x20-\x7e]/g, " ").slice(0, 500)}`); return no("ok", 200); // one line, whatever was sent
    }
    if (path === "/hermes/info" && req.method === "GET") return keyed() ? Response.json(linkInfo(), { headers: ISOLATED }) : no("open the full link with its key once", 401);
    if (path === "/hermes/ask" && req.method === "POST") {
      if (!keyed()) return no("open the full link with its key once", 401);
      if (!saysJson(req)) return no("the words must be sent as application/json", 415);
      const raw = await bodyUpTo(req, 16_000); if (!raw) return tooBig("too long", ISOLATED);
      let b: { text?: unknown; at?: unknown } = {}; try { b = JSON.parse(Buffer.from(raw).toString("utf8")) ?? {}; } catch {}
      const { text, at } = b;
      if (!text || typeof text !== "string") return Response.json({ error: "empty" }, { status: 400, headers: ISOLATED });
      if (!linkInfo().on) return Response.json({ reply: "The link is switched off." }, { headers: ISOLATED });
      if (busy) return Response.json({ reply: "Still answering the last one." }, { headers: ISOLATED });
      busy = true;
      try { const t0 = Date.now(), reply = await ask(text.slice(0, 2000), at); console.log(`agent link: answered in ${Math.round((Date.now() - t0) / 1000)} s`); return Response.json({ reply }, { headers: ISOLATED }); }
      finally { busy = false; }
    }
    if (path === "/rom" && req.method === "GET") {
      if (!keyed()) return no("open the full link with its key once", 401);
      if (!existsSync(ROM)) return no("no ROM built yet", 404);
      const mtime = Bun.file(ROM).lastModified;
      if (zipped?.mtime !== mtime) zipped = { mtime, body: Bun.gzipSync(new Uint8Array(readFileSync(ROM))) };
      return new Response(zipped.body, { headers: { ...ISOLATED, "Content-Type": "application/octet-stream", "Content-Encoding": "gzip" } });
    }
    const f = req.method === "GET" ? FILES[path] : undefined;
    return f ? new Response(Bun.file(f[0]), { headers: { ...ISOLATED, "Content-Type": f[1] } }) : no("not found", 404);
  };
}

if (import.meta.main) {
if (!existsSync(join(MGBA, "mgba.js"))) { console.error(`emulator files missing. Run: cd ${HERE} && bun install`); process.exit(1); }
let port = Number(process.env.PORT ?? 4870);
for (let tries = 0; ; tries++, port += 2) {
  try { Bun.serve({ hostname: "127.0.0.1", port, idleTimeout: 255, fetch: handler(null) }); break; } // an answer from the agent may take a minute
  catch (e) { if (tries >= 20) { console.error(`no free port near ${port}: set PORT`); process.exit(1); } }
}
console.log(`play on this computer:  http://127.0.0.1:${port}/`);

if (process.argv.includes("--lan")) {
  const dir = join(HERE, ".cert"), crt = join(dir, "cert.pem"), pem = join(dir, "key.pem"), keyFile = join(dir, "key.txt");
  const ips = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === "IPv4" && !a.internal && /^(192\.168\.|10\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(a.address)).map((a) => a!.address);
  if (!ips.length) { console.error("no home-network address found (a private IPv4 address); not opening a phone address"); }
  else {
    mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700); // the certificate's key and the link's key: the owner's eyes only
    const covers = existsSync(crt) ? Bun.spawnSync(["openssl", "x509", "-in", crt, "-noout", "-ext", "subjectAltName"], { env: childEnv() }).stdout.toString() : "";
    if (!ips.every((i) => covers.includes(`IP Address:${i}`))) { // a new address since the certificate was made
      const r = Bun.spawnSync(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "365", "-subj", "/CN=player", "-addext", `subjectAltName=${ips.map((i) => `IP:${i}`).join(",")}`, "-keyout", pem, "-out", crt], { env: childEnv() });
      if (r.exitCode !== 0) { console.error(`could not make a certificate (is openssl installed?): ${r.stderr.toString().slice(-200)}`); process.exit(1); }
    }
    if (!existsSync(keyFile)) writeFileSync(keyFile, crypto.randomUUID().replaceAll("-", ""), { mode: 0o600 });
    for (const f of [pem, keyFile]) chmodSync(f, 0o600);
    const key = readFileSync(keyFile, "utf8").trim();
    if (key.length < 16) { console.error(`the key in ${keyFile} is too short to be safe: delete the file and start again`); process.exit(1); }
    for (const ip of ips) {
      try { Bun.serve({ hostname: ip, port: port + 1, idleTimeout: 255, tls: { cert: Bun.file(crt), key: Bun.file(pem) }, fetch: handler(key, ip) }); }
      catch { console.error(`could not open ${ip}:${port + 1} for the phone address: is another player using it? Set PORT to move this one.`); continue; }
      console.log(`play on a phone (same network; accept the certificate warning once):  https://${ip}:${port + 1}/#k=${key}`); // the link is the only place the key is printed
    }
  }
}
}
