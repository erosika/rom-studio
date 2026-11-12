// kit/web.ts: what the pane and the player check before they answer a browser, and a body read with a limit.
import { createHash, timingSafeEqual } from "node:crypto";

const OWN_NAME = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/i;
/** The Host header names this computer or a bare address; a name from elsewhere that was pointed here does not pass. */
// names the owner put in front of this computer themselves (a reverse proxy with its own certificate): $ROM_STUDIO_HOSTS, comma separated
const EXTRA_NAMES = new Set((process.env.ROM_STUDIO_HOSTS ?? "").split(",").map((n) => n.trim().toLowerCase()).filter((n) => /^[a-z0-9.-]+$/.test(n)));
export const hostIsOwn = (req: Request) => { const h = (req.headers.get("host") ?? "").replace(/:\d+$/, "").toLowerCase(); return OWN_NAME.test(h) || EXTRA_NAMES.has(h); };
/** The other end of the connection is this computer. */
export const isLoopback = (address: string | undefined) => !!address && /^(::ffff:)?127\.|^::1$/.test(address);
/** Two keys compared without the time taken saying how much of one was right. */
export function sameKey(a: string, b: string): boolean {
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(a), h(b));
}
/** Why a browser's request is refused, or null. A page on another site may open one of our pages; it may not read, write or start anything. */
export function fromElsewhere(req: Request, page: boolean): string | null {
  const site = req.headers.get("sec-fetch-site"), origin = req.headers.get("origin"), mode = req.headers.get("sec-fetch-mode");
  let other = !!site && site !== "same-origin" && site !== "none";
  if (origin) { try { other ||= new URL(origin).host !== req.headers.get("host"); } catch { other = true; } }
  if (!other || (req.method === "GET" && page && (!mode || mode === "navigate"))) return null;
  return "Refused: this request came from a page on another site.";
}
/** A JSON body says it is JSON: a form or a plain request made by another site's page cannot. */
export const saysJson = (req: Request) => /^application\/json\b/i.test(req.headers.get("content-type") ?? "");
/** The body, read as it arrives; null as soon as it is longer than the limit. */
export async function bodyUpTo(req: Request, max: number): Promise<Uint8Array | null> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return null;
  const parts: Uint8Array[] = []; let n = 0;
  if (req.body) for await (const chunk of req.body) { n += chunk.byteLength; if (n > max) return null; parts.push(chunk); }
  return Buffer.concat(parts);
}
/** The answer to a body past the limit; the connection ends with it, since the rest of the body was never read. */
export const tooBig = (text: string, headers: Record<string, string> = {}) => new Response(text, { status: 413, headers: { ...headers, Connection: "close" } });
/** Headers for every answer: the type given is the type, other sites cannot embed it, and our address is not passed on. */
export const SAFE = { "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin", "Referrer-Policy": "no-referrer" };
/** A part of a file for a Range header: [from, to], "all" when there is none to honour, null when it cannot be met. */
export function byteRange(header: string | null, size: number): [number, number] | "all" | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!m || (!m[1] && !m[2])) return "all";
  const from = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2])), to = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return from > to ? null : [from, to];
}
