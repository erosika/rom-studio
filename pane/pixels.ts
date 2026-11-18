// pane/pixels.ts: the Pixels tab's routes. Open a game picture as the game shows it, with the find tool's marks; save the
// user's hand edits into the edits file beside the picture and apply them: the same code as `kit pixel`.
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, sep } from "node:path";
import { type Doc, type Edit, docText, editPicture, editsFile, find, openPic, origFile, readDoc, undoPicture } from "../kit/pixel";
import { bodyUpTo, saysJson, tooBig } from "../kit/web";

const HERE = import.meta.dir, MAX_PIXELS = 1_048_576, fresh = { "Cache-Control": "no-cache" };
const b64 = (a: Uint8Array | Uint32Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString("base64");

// a picture inside the game folder and nowhere else, whatever the name says or links to
function pictureIn(game: string, rel: string | null): string {
  if (!rel || !/\.png$/i.test(rel) || rel.split(/[\\/]/).includes("..")) throw new Error("name a .png picture inside the game folder");
  const file = join(game, rel);
  if (!existsSync(file) || !realpathSync(file).startsWith(realpathSync(game) + sep)) throw new Error(`no picture at ${rel}`);
  return file;
}
function tracked(game: string, pattern: string): string[] {
  const r = Bun.spawnSync(["git", "-C", game, "ls-files", "-co", "--exclude-standard", "--", pattern], { stdout: "pipe", stderr: "ignore" });
  return r.stdout.toString().split("\n").filter(Boolean);
}
function opened(game: string, rel: string) {
  const file = pictureIn(game, rel), p = openPic(file), [x0, y0, w, h] = p.crop as [number, number, number, number], doc = readDoc(file);
  if (w * h > MAX_PIXELS) throw new Error(`${rel} is ${w} x ${h}: too large for this editor. Use kit pixel edit with an edits file.`);
  const src = new Uint32Array(w * h), row = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { src[y * w + x] = p.src[(y0 + y) * p.vw + x0 + x]!; row[y * w + x] = p.row[(y0 + y) * p.vw + x0 + x]!; }
  return { file: rel, x0, y0, w, h, sheet: b64(p.px), src: b64(src), row: b64(row), palettes: p.palettes, top: Math.min((1 << p.depth) - 1, p.palettes[0]!.length - 1),
    marks: find(p).filter((f) => f.pts.length), drawnAs: p.view?.map ? `as the game draws it (${p.view.map}${p.view.palette ? `, ${p.view.palette}` : ""}): a change to a tile shows in every place that draws it` : "",
    edits: doc?.edits.length ?? 0, saves: new Set(doc?.edits.map((e) => e.saved).filter(Boolean)).size, original: existsSync(origFile(file)) };
}

/** Answers the Pixels tab's requests; null when the request is not one of them. */
export async function pixelsRoute(req: Request, path: string, game: string): Promise<Response | null> {
  if (path === "/pixels.js") return new Response(Bun.file(join(HERE, "pixels.js")), { headers: fresh });
  if (!path.startsWith("/pixels/")) return null;
  const q = new URL(req.url).searchParams, rel = q.get("file");
  try {
    if (req.method === "GET" && path === "/pixels/list") {
      const words = (q.get("q") ?? "").toLowerCase().split(/\s+/).filter(Boolean), edited = tracked(game, "*.png.edits.json").map((f) => f.replace(/\.edits\.json$/, ""));
      const found = words.length ? tracked(game, "*.png").filter((f) => words.every((w) => f.toLowerCase().includes(w))) : [];
      return Response.json({ edited, found: found.slice(0, 80), more: Math.max(0, found.length - 80) }, { headers: fresh });
    }
    if (req.method === "GET" && path === "/pixels/open") return Response.json(opened(game, rel!), { headers: fresh });
    if (req.method === "POST" && (path === "/pixels/save" || path === "/pixels/back")) {
      if (!saysJson(req)) return new Response("the body must be sent as application/json", { status: 415 });
      const raw = await bodyUpTo(req, 2_000_000); if (!raw) return tooBig("too big");
      const file = pictureIn(game, rel), at = editsFile(file), before = existsSync(at) ? readFileSync(at, "utf8") : null, picture = readFileSync(file);
      const doc: Doc = readDoc(file) ?? { picture: basename(file), ...(openPic(file).view?.map ? { view: openPic(file).view } : {}), edits: [] };
      let lines: string[] = [];
      try {
        if (path === "/pixels/save") {
          const b = JSON.parse(Buffer.from(raw).toString("utf8")), saved = new Date().toISOString(), why = String(b.note ?? "").trim().slice(0, 200);
          if (!Array.isArray(b.edits) || !b.edits.length || b.edits.length > 20_000) throw new Error("nothing to save");
          doc.edits.push(...b.edits.map((e: Edit) => ({ ...(e.set ? { set: e.set } : e.fill ? { fill: e.fill } : {}), ...(why ? { why } : {}), by: "hand", saved })));
          writeFileSync(at, docText(doc)); lines = editPicture(file).lines;
        } else {
          const last = [...doc.edits].reverse().find((e) => e.saved)?.saved; if (!last) throw new Error("no save made here to take back");
          doc.edits = doc.edits.filter((e) => e.saved !== last);
          if (doc.edits.length) { writeFileSync(at, docText(doc)); lines = editPicture(file).lines; }
          else { lines = [existsSync(origFile(file)) ? undoPicture(file) : "No edits left."]; rmSync(at, { force: true }); }
        }
      } catch (e) { if (before == null) rmSync(at, { force: true }); else writeFileSync(at, before); writeFileSync(file, picture); throw e; } // a save that fails leaves both files as they were
      return Response.json({ ...opened(game, rel!), said: lines.slice(-2) }, { headers: fresh });
    }
  } catch (e) { return new Response((e as Error).message, { status: 400 }); }
  return new Response("not found", { status: 404 });
}
