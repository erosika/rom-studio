// pane/dialogue.ts: the Dialogue tab's routes. Every line a player can read, the same reading as `kit dialogue`.
import { join } from "node:path";
import { type Dialogue, addNote, notesText, readDialogue, readNotes } from "../kit/dialogue";
import { bodyUpTo, saysJson, tooBig } from "../kit/web";

const HERE = import.meta.dir, KEEP_MS = 3000;
let kept: { game: string; at: number; all: Dialogue } | null = null;

/** Answers the Dialogue tab's requests; null when the request is not one of them. */
export async function dialogueRoute(req: Request, path: string, game: string): Promise<Response | null> {
  if (path === "/dialogue.js") return new Response(Bun.file(join(HERE, "dialogue.js")), { headers: { "Cache-Control": "no-cache" } });
  const fresh = { "Cache-Control": "no-cache" };
  try {
    if (path === "/dialogue/notes" && req.method === "GET") return Response.json(readNotes(game), { headers: fresh });
    if (path === "/dialogue/notes.md" && req.method === "GET") return new Response(notesText(game) + "\n", { headers: { ...fresh, "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": 'attachment; filename="dialogue-notes.md"' } });
    if (path === "/dialogue/note" && req.method === "POST") {
      if (!saysJson(req)) return new Response("the body must be sent as application/json", { status: 415 });
      const raw = await bodyUpTo(req, 100_000); if (!raw) return tooBig("too big");
      let b: any; try { b = JSON.parse(Buffer.from(raw).toString("utf8")); } catch { throw new Error("the body must be JSON"); }
      return Response.json(addNote(game, b ?? {}));
    }
  } catch (e) { return new Response((e as Error).message, { status: 400 }); }
  if (path !== "/dialogue/all") return path.startsWith("/dialogue/") ? new Response("not found", { status: 404 }) : null;
  if (req.method !== "GET") return new Response("not allowed", { status: 405 });
  try {
    if (!kept || kept.game !== game || Date.now() - kept.at > KEEP_MS) kept = { game, at: Date.now(), all: readDialogue(game) }; // a tab left open asks often
    return Response.json(kept.all, { headers: { "Cache-Control": "no-cache" } });
  } catch (e) { return new Response((e as Error).message, { status: 400 }); }
}
