// kit/agent-play/watch.ts: a page on this computer that shows the game an agent is playing. It only shows: there is no
// request that presses a button or changes anything. Every picture that leaves here has been through the player's
// flash guard, timed by the clock on the wall; the guard is made with the watcher and there is no way round it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-ignore: plain JavaScript, shared with the player's page
import { createGuard } from "../../player/guard.js";
import { encodePng } from "../png";
import { SAFE, fromElsewhere, hostIsOwn } from "../web";
import { H, W } from "./game";
import type { Past, Where } from "./shapes";

export type Showing = { playing: boolean; agent: string; thought: string; text: string; where: Where | null; steps: number; steps_left: number; played_seconds: number; last: Past[]; ended: string };
const HERE = import.meta.dir, TICK = 40; // ms between guarded pictures: 25 a second
const FILES: Record<string, [string, string]> = { "/": ["watch.html", "text/html; charset=utf-8"], "/watch.js": ["watch.js", "text/javascript; charset=utf-8"], "/watch.css": ["watch.css", "text/css; charset=utf-8"] };
const HEAD = { ...SAFE, "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" };

/** The guarded stream of pictures: `feed` takes what the game shows, `shown` is what may be seen. */
export function guarded(now: () => number = () => performance.now()) {
  const guard = createGuard(W, H), out = new Uint8Array(W * H * 4), kept = new Uint8Array(W * H * 4);
  let latest: Uint8Array | null = null, seq = 0, png: Uint8Array | null = null, waiting: (() => void)[] = [];
  return {
    feed(rgba: Uint8Array) { latest = rgba; },
    /** One beat of the clock: the newest picture goes through the guard; a changed result is a new picture to show. */
    tick() {
      if (!latest) return;
      guard.step(latest, now(), out);
      if (seq && Buffer.compare(out, kept) === 0) return;
      kept.set(out); seq++; png = null;
      for (const w of waiting.splice(0)) w();
    },
    shown: () => ({ seq, rgba: kept, png: () => (png ??= encodePng(kept, W, H)) }),
    /** Resolves when a picture newer than `after` exists, or after `ms`. */
    newer: (after: number, ms: number) => (seq > after ? Promise.resolve() : new Promise<void>((done) => { waiting.push(done); setTimeout(done, ms); })),
  };
}

/** Serve the page on 127.0.0.1. `state` is asked each time the page wants the words beside the picture. */
export function serveWatch(port: number, state: () => Showing) {
  const stream = guarded(), timer = setInterval(stream.tick, TICK);
  const server = Bun.serve({
    hostname: "127.0.0.1", port, idleTimeout: 30,
    async fetch(req) {
      const url = new URL(req.url), plain = (text: string, status: number) => new Response(text, { status, headers: { ...HEAD, "Content-Type": "text/plain; charset=utf-8" } });
      if (!hostIsOwn(req)) return plain("Refused: this page answers only to this computer's own name.", 403);
      if (req.method !== "GET" && req.method !== "HEAD") return plain("This page only shows the game. It takes nothing.", 405);
      const page = url.pathname in FILES, no = fromElsewhere(req, url.pathname === "/");
      if (no) return plain(no, 403);
      if (page) { const [file, type] = FILES[url.pathname]!; return new Response(readFileSync(join(HERE, file)), { headers: { ...HEAD, "Content-Type": type } }); }
      if (url.pathname === "/state") return new Response(JSON.stringify(state()), { headers: { ...HEAD, "Content-Type": "application/json" } });
      if (url.pathname === "/frame") {
        const after = Number(url.searchParams.get("after")) || 0;
        await stream.newer(after, 10_000);
        const s = stream.shown();
        if (s.seq <= after) return new Response(null, { status: 204, headers: HEAD });
        return new Response(s.png(), { headers: { ...HEAD, "Content-Type": "image/png", "X-Frame": String(s.seq) } });
      }
      return plain("Nothing here.", 404);
    },
  });
  return { feed: stream.feed, url: `http://127.0.0.1:${server.port}/`, stop() { clearInterval(timer); server.stop(true); } };
}
