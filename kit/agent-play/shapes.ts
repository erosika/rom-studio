// kit/agent-play/shapes.ts: what an agent is given each step, what it may answer, and when play stops. No emulator here.

export const KEY: Record<string, number> = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128, R: 256, L: 512 };
export const LIMITS = { doChars: 200, moves: 32, holdFrames: 120, squares: 20, waitFrames: 600, thoughtChars: 200, notesChars: 2000, recent: 8, shown: 20, failsInARow: 5 };

export type Where = { map: string; x: number; y: number; facing: string; control: boolean };
/** One past step, as the agent and the watch page see it. */
export type Past = { step: number; do: string; thought: string; result: string };
/** What the agent is given: one JSON object on one line. */
export type Step = {
  v: 1;
  step: number; // this step's number, counted over every run of this save
  steps_left: number; // how many more this run allows
  picture: { path: string; width: number; height: number; png_base64?: string }; // the screen now, a PNG file (and inline when asked for)
  text: string; // the text in the message box now, "" when none is open
  where: Where | null; // null until the game reports where the player is (title screen, opening)
  last: Past[]; // the last few steps, oldest first
  notes: string; // the agent's own running notes, as it last wrote them
  played: { steps: number; seconds: number };
  how: string; // the rules of the answer, in words
};
export type Move = { op: "press"; mask: number; hold: number; text: string } | { op: "walk"; mask: number; name: string; squares: number } | { op: "wait"; frames: number };
/** What the agent answers: one JSON object. */
export type Action = { moves: Move[]; do: string; thought: string; notes?: string; tokens?: number; stop: boolean };

export const HOW = `Answer with one JSON object and nothing else: {"do": "<moves>", "thought": "<one line>", "notes": "<optional: your running notes, replacing the old ones>"}.
Moves, in order, separated by spaces: press A,B,UP,START (tap buttons one after another; NAME:frames holds longer, A+B together) | walk UP:3,LEFT:2 (whole squares; stops when blocked) | wait 60 (frames; 60 is one second).
Buttons: ${Object.keys(KEY).join(" ")}. At most ${LIMITS.moves} taps and squares in one answer. {"stop": true} ends the run.`;

const whole = (v: string | undefined, what: string, max: number) => {
  const n = Number(v);
  if (v === undefined || v === "" || !Number.isInteger(n) || n < 1) throw new Error(`${what} must be a whole number from 1, got "${v ?? ""}"`);
  if (n > max) throw new Error(`${what} may be ${max} at most, got ${n}`);
  return n;
};
const mask = (names: string) => names.split("+").reduce((m, k) => { const b = KEY[k.toUpperCase()]; if (!b) throw new Error(`unknown button "${k}". Buttons: ${Object.keys(KEY).join(" ")}`); return m | b; }, 0);

/** The moves of a "do" line: press, walk and wait of the driver's step language, and nothing else of it. */
export function parseMoves(line: string): Move[] {
  if (typeof line !== "string" || !line.trim()) throw new Error('"do" is empty: give moves such as press A or walk UP:2');
  if (line.length > LIMITS.doChars) throw new Error(`"do" may be ${LIMITS.doChars} characters at most`);
  if (/[\0-\x1f]/.test(line)) throw new Error('"do" may not hold a line break or control character');
  const words = line.trim().split(/\s+/), moves: Move[] = [];
  if (!["press", "walk", "wait"].includes(words[0]!.toLowerCase())) words.unshift("press"); // a bare button list is a press
  let count = 0;
  for (let i = 0; i < words.length; ) {
    const op = words[i++]!.toLowerCase(), arg = words[i++];
    if (op === "wait") { moves.push({ op, frames: whole(arg, "wait frames", LIMITS.waitFrames) }); continue; }
    if (op !== "press" && op !== "walk") throw new Error(`"${op}" is not a move an agent may make. Moves: press, walk, wait`);
    if (!arg) throw new Error(`${op} needs ${op === "press" ? "buttons, e.g. press A,A,UP" : "a path, e.g. walk UP:3,LEFT:2"}`);
    for (const part of arg.split(",")) {
      const [k, n, more] = part.split(":");
      if (more !== undefined || !k) throw new Error(`"${part}" is not NAME or NAME:number`);
      if (op === "press") { moves.push({ op, mask: mask(k), hold: n === undefined ? 4 : whole(n, "hold frames", LIMITS.holdFrames), text: part.toUpperCase() }); count++; }
      else {
        if (!["UP", "DOWN", "LEFT", "RIGHT"].includes(k.toUpperCase())) throw new Error(`walk goes UP, DOWN, LEFT or RIGHT, not "${k}"`);
        const squares = n === undefined ? 1 : whole(n, "squares", LIMITS.squares);
        moves.push({ op, mask: mask(k), name: k.toUpperCase(), squares }); count += squares;
      }
    }
    if (count > LIMITS.moves) throw new Error(`one answer may hold ${LIMITS.moves} taps and squares at most`);
  }
  return moves;
}

/** The first JSON object in a reply: the whole of it, or the part from a brace to the last brace (a reply may wrap it in words or a code fence). */
export function findJson(reply: string): unknown {
  const t = reply.trim();
  try { return JSON.parse(t); } catch {}
  const end = t.lastIndexOf("}");
  for (let from = t.indexOf("{"); from >= 0 && from < end; from = t.indexOf("{", from + 1)) { try { return JSON.parse(t.slice(from, end + 1)); } catch {} }
  throw new Error("the agent's answer holds no JSON object");
}
const oneLine = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** An agent's answer, checked. Throws with the reason when it is not one. */
export function parseAction(reply: string | unknown): Action {
  const o = typeof reply === "string" ? findJson(reply) : reply;
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("the agent's answer is not a JSON object");
  const a = o as Record<string, unknown>, stop = a.stop === true, thought = oneLine(a.thought, LIMITS.thoughtChars);
  if (!stop && typeof a.do !== "string") throw new Error('the answer needs "do": the moves, e.g. {"do": "press A", "thought": "..."}');
  const moves = typeof a.do === "string" && (a.do.trim() || !stop) ? parseMoves(a.do) : [];
  const notes = typeof a.notes === "string" ? a.notes.slice(0, LIMITS.notesChars) : undefined;
  const tokens = typeof a.tokens === "number" && Number.isFinite(a.tokens) && a.tokens >= 0 ? Math.round(a.tokens) : undefined;
  return { moves, do: typeof a.do === "string" ? a.do.trim().replace(/\s+/g, " ") : "", thought, notes, tokens, stop };
}

export type Spent = { run: number; steps: number; tokens: number; fails: number }; // steps this run; steps and tokens over every run of the save; failed answers in a row
export type Caps = { steps: number; capSteps: number; capTokens: number };
/** Why play stops before the next step, or null. Checked before the agent is asked, so nothing is spent past a cap that is already reached. */
export function whyStop(s: Spent, c: Caps): string | null {
  if (s.run >= c.steps) return `the step budget of this run is used up (${c.steps})`;
  if (s.steps >= c.capSteps) return `the cap on steps for this save is reached (${s.steps} of ${c.capSteps})`;
  if (s.tokens >= c.capTokens) return `the cap on tokens for this save is reached (${s.tokens} of ${c.capTokens})`;
  if (s.fails >= LIMITS.failsInARow) return `the agent gave no usable answer ${LIMITS.failsInARow} times in a row`;
  return null;
}

/** A text with every occurrence of a secret taken out: for errors that quote what a service or a program said. */
export const without = (text: string, secret: string | undefined) => (secret && secret.length >= 4 ? text.split(secret).join("[key]") : text);

/** A command line as words: spaces separate, single or double quotes keep a word together. No shell reads it. */
export function words(line: string): string[] {
  const out: string[] = []; let cur = "", quote = "", any = false;
  for (const ch of line) {
    if (quote) { if (ch === quote) quote = ""; else cur += ch; }
    else if (ch === '"' || ch === "'") { quote = ch; any = true; }
    else if (/\s/.test(ch)) { if (cur || any) out.push(cur); cur = ""; any = false; }
    else cur += ch;
  }
  if (quote) throw new Error("the agent command has a quote that is not closed");
  if (cur || any) out.push(cur);
  return out;
}
