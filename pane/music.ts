// pane/music.ts: the Music tab's routes. The list, where a sound is heard, a recording to listen to (made on demand, kept until
// the next build), and the user's own file put in place of one: the same code as `kit music`.
import { mkdirSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { compact, findSound, listSounds, render, replace, whereHeard, type Sound } from "../kit/music";
import { bodyUpTo, byteRange, tooBig } from "../kit/web";

const HERE = import.meta.dir, MAX = 20_000_000;
let list: { at: number; value: Sound[] } | null = null; // read again after a replace, and at most every 20 seconds
const sounds = (game: string) => { if (!list || Date.now() - list.at > 20_000) list = { at: Date.now(), value: listSounds(game) }; return list.value; };
const TYPES: Record<string, string> = { ".wav": "audio/wav", ".m4a": "audio/mp4" };

// a file with byte ranges, which some browsers ask for before they will play sound
function sendAudio(req: Request, file: string) {
  const size = statSync(file).size, type = TYPES[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream", part = byteRange(req.headers.get("range"), size);
  const head = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "no-cache" };
  if (part === "all") return new Response(Bun.file(file), { headers: head });
  if (!part) return new Response("no such range", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  return new Response(Bun.file(file).slice(part[0], part[1] + 1), { status: 206, headers: { ...head, "Content-Range": `bytes ${part[0]}-${part[1]}/${size}` } });
}

/** Answers the Music tab's requests; null when the request is not one of them. */
export async function musicRoute(req: Request, path: string, game: string): Promise<Response | null> {
  if (path === "/music.js") return new Response(Bun.file(join(HERE, "music.js")), { headers: { "Cache-Control": "no-cache" } });
  if (!path.startsWith("/music/")) return null;
  const [, , what, ...rest] = path.split("/"), name = rest.join("/"), no = (e: unknown, status = 400) => new Response((e as Error).message, { status });
  try {
    if (req.method === "GET" && what === "list") return Response.json({ sounds: sounds(game), built: (() => { try { return statSync(join(game, "out/game.gba")).mtimeMs; } catch { return null; } })() }, { headers: { "Cache-Control": "no-cache" } });
    if (req.method === "GET" && what === "where") return Response.json(whereHeard(game, findSound(game, name)));
    if (req.method === "GET" && what === "play") {
      const r = render(game, findSound(game, name));
      return sendAudio(req, r.file.startsWith(join(game, "out")) ? compact(r.file) : r.file);
    }
    if (req.method === "PUT" && what === "replace") {
      const q = new URL(req.url).searchParams, file = basename(q.get("file") ?? "").replace(/[^\p{L}\p{N}\-_.]/gu, "").replace(/^\.+/, "") || "sound";
      const body = await bodyUpTo(req, MAX); // its own limit, and below its own folder so two files sent at once never share a name
      if (!body) return tooBig("too big: 20 MB at most");
      const dir = join(game, "out/music/sent", `${process.pid}-${Date.now()}`), to = join(dir, file); mkdirSync(dir, { recursive: true }); await Bun.write(to, body);
      try { const lines = replace(game, findSound(game, name), to, { keepLoop: q.get("keep-loop") === "1", voicegroup: q.get("voicegroup") ?? undefined, volume: q.get("volume") ?? undefined }); list = null; return Response.json({ lines }); }
      finally { rmSync(dir, { recursive: true, force: true }); }
    }
  } catch (e) { return no(e); }
  return new Response("not found", { status: 404 });
}
