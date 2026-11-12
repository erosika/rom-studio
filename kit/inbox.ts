// kit/inbox.ts: what the user says back, and what they chose. Three small files in the game folder, read and
// written by both the kit and the pane: reviews.jsonl (an answer to a feed entry), decisions.jsonl (a question
// from the agent and the user's answer), settings.json (image model, helpers, and whatever else is already there).
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const rows = (file: string): any[] => (existsSync(file) ? readFileSync(file, "utf8").split("\n").flatMap((l) => { try { const o = l.trim() ? JSON.parse(l) : null; return o && typeof o === "object" ? [o] : []; } catch { return []; } }) : []); // a half-written line is skipped
const now = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const add = (file: string, o: object) => { appendFileSync(file, JSON.stringify(o) + "\n"); return o; };
const short = (s: string) => Bun.hash(s).toString(36).slice(0, 8);

// ---- feed entries and the user's answers to them ----
/** A name for one feed entry that survives two entries written in the same second. */
export const entryId = (e: any) => short(`${e.t}|${e.scene ?? ""}|${e.did}`);
export const feedRows = (game: string) => rows(join(game, "feed.jsonl")).filter((e) => typeof e?.did === "string");
export type Review = { t: string; id: string; entry: string; scene?: string; verdict: "right" | "work" | "note"; note?: string };
/** "note": the user only wrote something, without saying the entry is right or needs work; it waits for an answer like "work". */
export const VERDICTS = ["right", "work", "note"];
export function addReview(game: string, r: { id: string; entry: string; scene?: string; verdict: string; note?: string }) {
  if (!VERDICTS.includes(r.verdict)) throw new Error('the verdict is "right", "work" or "note"');
  const word = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  if (r.verdict === "note" && !word(r.note, 500)) throw new Error("the note is empty");
  if (!word(r.id, 64) || !word(r.entry, 64)) throw new Error("which entry? (id and entry time)");
  return add(join(game, "reviews.jsonl"), { t: now(), id: word(r.id, 64), entry: word(r.entry, 64), scene: word(r.scene, 200) || undefined, verdict: r.verdict, note: word(r.note, 500) || undefined });
}
/** The latest answer for each entry, in feed order, with the entry and whether a later entry says it dealt with it. */
export function reviews(game: string) {
  const feed = feedRows(game), latest = new Map<string, Review>();
  for (const r of rows(join(game, "reviews.jsonl"))) if (r?.id && VERDICTS.includes(r.verdict)) latest.set(r.id, r);
  return feed.flatMap((e, i) => {
    const id = entryId(e), r = latest.get(id); if (!r) return [];
    const by = feed.slice(i + 1).find((x) => x.answers === e.t || x.answers === id); // kit note --answers <entry time>
    return [{ ...r, did: e.did, shot: e.shot, by: e.by, handled: by ? by.t : null }];
  });
}

// ---- questions for the user ----
export function ask(game: string, d: { question: string; options?: string[]; recommend?: string; scene?: string; detail?: string }) {
  const t = now();
  return add(join(game, "decisions.jsonl"), { t, id: short(`${t}|${d.question}`), scene: d.scene, question: d.question, options: d.options?.length ? d.options : undefined, recommend: d.recommend, detail: d.detail }) as any;
}
export function answer(game: string, id: string, text: string) {
  if (!text.trim()) throw new Error("the answer is empty");
  if (!decisions(game).some((d) => d.id === id)) throw new Error(`no decision "${id}"`);
  return add(join(game, "decisions.jsonl"), { t: now(), answer_to: id, answer: text.trim().slice(0, 1000) });
}
/** Every question in the order asked, each with its latest answer (null while open). */
export function decisions(game: string) {
  const all = rows(join(game, "decisions.jsonl")), said = new Map<string, any>();
  for (const a of all) if (a?.answer_to) said.set(a.answer_to, a);
  return all.filter((d) => d?.id && typeof d.question === "string").map((d) => ({ ...d, answer: said.get(d.id)?.answer ?? null, answered: said.get(d.id)?.t ?? null }));
}

// ---- settings.json ----
export const settingsFile = (game: string) => join(game, "settings.json");
export function settings(game: string): Record<string, any> {
  const f = settingsFile(game); if (!existsSync(f)) return {};
  const s = JSON.parse(readFileSync(f, "utf8")); // not valid JSON: let it be said, never overwrite it
  if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error("settings.json must hold one object");
  return s;
}
/** Change some keys and leave every other key as it is. One writer at a time; written to a new file first, then moved into place. */
export function setSettings(game: string, change: Record<string, unknown>) {
  const f = settingsFile(game), tmp = `${f}.tmp-${process.pid}`, lock = `${f}.lock`;
  for (let tries = 0; ; tries++) { // the kit and the pane may both be changing a key: the second waits, so neither loses the other's
    try { closeSync(openSync(lock, "wx")); break; } catch (e: any) {
      if (e?.code !== "EEXIST") throw e;
      let age = Infinity; try { age = Date.now() - statSync(lock).mtimeMs; } catch {}
      if (age > 10_000 || tries > 200) rmSync(lock, { force: true }); else Bun.sleepSync(20); // a writer that died left it behind
    }
  }
  try {
    const s = { ...settings(game), ...change };
    for (const k of Object.keys(s)) if (s[k] === undefined || s[k] === null) delete s[k];
    writeFileSync(tmp, JSON.stringify(s, null, 1) + "\n"); renameSync(tmp, f);
    return s;
  } finally { rmSync(lock, { force: true }); }
}
export type Worker = { name: string; how: string; model?: string; note?: string; enabled?: boolean };
export const workers = (s: Record<string, any>): Worker[] => (Array.isArray(s.workers) ? s.workers.filter((w: any) => w && typeof w.name === "string") : []);
