// A plain listening page for audio files the agents leave under the game's out/music folder (previews, candidates, sketches).
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { byteRange } from "../kit/web";

const AUDIO: Record<string, string> = { ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg" };
// other folders of audio to list beside the game's own, from $ROM_STUDIO_LISTEN_DIRS as name=path pairs separated by ":" (the owner's own material; never part of a game)
const EXTRA: [string, string][] = (process.env.ROM_STUDIO_LISTEN_DIRS ?? "").split(":").map((x) => x.split("=") as [string, string]).filter(([n, d]) => /^[\w-]+$/.test(n ?? "") && d && existsSync(d)).map(([n, d]) => [n, resolve(d)]);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const kind = (name: string) => AUDIO[name.slice(name.lastIndexOf(".")).toLowerCase()];

// a folder may say what its files are in the first line of an about.txt beside them
function about(root: string, dir: string) {
  try { const t = readFileSync(join(root, dir, "about.txt"), "utf8").split("\n")[0]!.trim(); return t ? `<p>${esc(t.slice(0, 400))}</p>` : ""; } catch { return ""; }
}
function folders(root: string, dir = "", depth = 0): { dir: string; files: string[] }[] {
  const here = join(root, dir), names = existsSync(here) ? readdirSync(here).sort() : [];
  const files = names.filter((n) => kind(n) && statSync(join(here, n)).isFile());
  const below = depth < 3 ? names.filter((n) => !n.startsWith(".") && statSync(join(here, n)).isDirectory()).flatMap((n) => folders(root, dir ? `${dir}/${n}` : n, depth + 1)) : [];
  return [...(files.length ? [{ dir, files }] : []), ...below];
}

export function listenRoute(req: Request, path: string, game: string): Response | null {
  if (path !== "/listen" && !path.startsWith("/listen/")) return null;
  const root = resolve(game, "out/music");
  if (path === "/listen") return Response.redirect("listen/", 302);
  if (path === "/listen/") {
    const groups = [...folders(root), ...EXTRA.flatMap(([n, d]) => folders(d).map((g) => ({ dir: `@${n}${g.dir ? `/${g.dir}` : ""}`, files: g.files })))];
    const body = groups.length ? groups.map((g) => `<section><h2>${esc(g.dir || "out/music")} · ${g.files.length}</h2>${g.dir.startsWith("@") ? "" : about(root, g.dir)}${g.files.map((f) =>
      `<figure><figcaption>${esc(f.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "))}</figcaption><audio controls preload="none" src="${esc((g.dir ? `${g.dir}/${f}` : f).split("/").map(encodeURIComponent).join("/"))}"></audio></figure>`).join("")}</section>`).join("")
      : "<p>Nothing to listen to yet: audio files placed under the game's out/music folder appear here.</p>";
    return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>Listen</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0 auto;max-width:760px;padding:16px;background:#14161a;color:#e8eaee}h1{font-size:18px}h2{font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:#9aa1ae;margin:28px 0 8px}
figure{margin:0 0 10px;padding:10px 12px;border:1px solid #323743;border-radius:10px;background:#1d2026}figcaption{margin-bottom:6px}audio{width:100%}a{color:#7fd1b9}
@media (prefers-color-scheme: light){body{background:#f4f3ef;color:#1c1e22}figure{background:#fff;border-color:#d6d3ca}h2{color:#5d6470}a{color:#156b55}}</style>
<h1>Listen</h1><p><a href="../">Back to the pane</a> · Nothing plays until you press play.</p>${body}</html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "Content-Security-Policy": "default-src 'self'; script-src 'none'; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'" } });
  }
  const rel = path.slice("/listen/".length), extra = rel.startsWith("@") ? EXTRA.find(([n]) => rel.startsWith(`@${n}/`)) : undefined; // the path arrives already decoded
  const base = extra ? extra[1] : root, file = resolve(base, extra ? rel.slice(extra[0].length + 2) : rel), inside = (f: string) => f.startsWith(base + sep);
  if ((rel.startsWith("@") && !extra) || !inside(file) || !kind(file) || !existsSync(file)) return new Response("not found", { status: 404 });
  try { if (!realpathSync(file).startsWith(realpathSync(base) + sep)) throw 0; } catch { return new Response("not found", { status: 404 }); } // a link that leads out of the folder
  const f = Bun.file(file), part = byteRange(req.headers.get("range"), f.size), head = { "Content-Type": kind(file)!, "Accept-Ranges": "bytes" };
  if (part === "all") return new Response(f, { headers: head });
  if (!part) return new Response("no such range", { status: 416, headers: { "Content-Range": `bytes */${f.size}` } });
  return new Response(f.slice(part[0], part[1] + 1), { status: 206, headers: { ...head, "Content-Range": `bytes ${part[0]}-${part[1]}/${f.size}` } }); // seeking in a player asks for a part of the file
}
