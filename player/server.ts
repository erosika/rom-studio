#!/usr/bin/env bun
// player/server.ts: serves the play page and the built ROM. This computer only by default.
//   bun player/server.ts          http://127.0.0.1:<port>/   (laptop)
//   bun player/server.ts --lan    also https://<this computer>:<port+1>/#k=<key> for a phone on the same network
// The emulator needs cross-origin isolation, which browsers grant only on localhost or https; so the
// phone address is https with a certificate made here (the phone shows a warning once), and the ROM and the
// page's log line are only answered over it with the key.
// The live link to the user's own Hermes (a box for typed words under the screen, the page<->agent relay) is not in
// this player; it was taken out in 0.3.0.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { tableFrom } from "./game-text.js";
import { namingTextOffset } from "./checks.js";
import { childEnv } from "../kit/env";
import { bodyUpTo, fromElsewhere, hostIsOwn, sameKey } from "../kit/web";

const HERE = import.meta.dir;
const ROM = process.env.ROM ?? join(HERE, "../../rom-studio-game/out/game.gba");
const MGBA = join(HERE, "node_modules/@thenick775/mgba-wasm/dist");
const ISOLATED = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const FILES: Record<string, [string, string]> = {
  "/": [join(HERE, "index.html"), "text/html; charset=utf-8"],
  "/play.js": [join(HERE, "play.js"), "text/javascript"],
  "/guard.js": [join(HERE, "guard.js"), "text/javascript"],
  "/game-text.js": [join(HERE, "game-text.js"), "text/javascript"],
  "/ram.js": [join(HERE, "ram.js"), "text/javascript"],
  "/checks.js": [join(HERE, "checks.js"), "text/javascript"],
  "/mgba/mgba.js": [join(MGBA, "mgba.js"), "text/javascript"],
  "/mgba/mgba.wasm": [join(MGBA, "mgba.wasm"), "application/wasm"],
};
let zipped: { mtime: number; body: Uint8Array } | null = null; // the ROM is mostly padding: gzip once per build

// the game folder: where the build's symbols and the naming screen's source are read from
const GAME = process.env.GAME ?? dirname(dirname(ROM));
const symbol = (name: string): number | null => { try { const m = new RegExp(`^([0-9a-f]{8}) .* ${name}$`, "m").exec(readFileSync(ROM.replace(/\.gba$/, ".sym"), "utf8")); return m ? parseInt(m[1]!, 16) : null; } catch { return null; } };
const read = (rel: string) => { try { return readFileSync(join(GAME, rel), "utf8"); } catch { return ""; } };
/** What the page needs to know about the game before and while it runs: a name for its saves that stays the same across
 *  builds (and gives away no folder), which build is on disk now (null: none yet), and where the game's own naming screen keeps its text. */
export function gameInfo() {
  let build: string | null = null; try { const st = statSync(ROM); build = `${Math.round(st.mtimeMs).toString(36)}-${st.size.toString(36)}`; } catch {}
  if (known?.build !== build) { // read again only when the game was rebuilt: the page asks every few seconds
    const at = symbol("sNamingScreen"), text = at === null ? null : namingTextOffset(read("src/naming_screen.c"));
    known = { build, rest: { id: createHash("sha256").update(GAME).digest("hex").slice(0, 12), naming: at !== null && text !== null ? { at, text } : null, chars: tableFrom(read("charmap.txt")).chars } };
  }
  return { build, ...known.rest };
}
let known: { build: string | null; rest: { id: string; naming: { at: number; text: number } | null; chars: Record<string, number> } } | null = null;

const PANE = process.env.ROM_STUDIO_PANE_LOCAL ?? "http://127.0.0.1:8778"; // where the pane listens on this computer
const DROP = /^(host|origin|referer|cookie|connection|content-length|sec-fetch-.*)$/i; // checked here; the pane is asked as this computer
/** One listener's answers. `key` is null on this computer's own address; over the network it is needed for the game and the log. */
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
    if (path === "/game" && req.method === "GET") return keyed() ? Response.json(gameInfo(), { headers: ISOLATED }) : no("open the full link with its key once", 401);
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
  try { Bun.serve({ hostname: "127.0.0.1", port, idleTimeout: 255, fetch: handler(null) }); break; }
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
