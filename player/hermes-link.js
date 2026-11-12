// Talk to your agent from inside the game. The game's base keeps a small mailbox in its memory (the START
// menu's agent entry); this is the other end. The game never waits on us:
//   openSeq   game -> page   the player chose the entry: open the box for their words
//   msgSeq    page -> game   a message is ready in text[] (kind, optional menu labels)
//   shownSeq  game -> page   the player has finished reading it; the next can be written
//   choiceSeq game -> page   the player picked choiceResult from the last menu (127 = B)
//   hostSeq   page -> game   the openSeq this page has seen (only for games marked "AK"): the game knows someone is here
// The emulator keeps the game's memory inside its own; we keep hold of that when it is made and find
// the mailbox by its first eight bytes.
import { encodeMessages, encodeLabel, splitReply, TEXT_MAX, CHOICES_MAX, CHOICE_LEN } from "/game-text.js";

const LO = 0x4d524548, HI = 0x424d5345; // "HERMESMB" as two little-endian words
const OFF = { openSeq: 8, msgSeq: 9, shownSeq: 10, version: 11, msgKind: 12, choiceCount: 13, choiceSeq: 14, choiceResult: 15, choices: 16, text: 112, hostSeq: 1112, ackMark: 1113 };
const ECHO = 1, CHOICE = 2, TYPE = "TYPE";
let memory = null;

/** The emulator's memory, once it has been made. */
export const gameMemory = () => memory;
/** Call before the emulator's script is loaded. */
export function captureMemory() {
  const Real = WebAssembly.Memory;
  function Kept(desc) { const m = new Real(desc); if (!memory || desc?.shared) memory = m; return m; }
  Kept.prototype = Real.prototype;
  WebAssembly.Memory = Kept;
}

export async function startLink(emu, { log, key }) {
  const info = await (await fetch("/hermes/info", { headers: { "x-key": key() } })).json().catch(() => null);
  if (!info?.on || !memory) { log(`agent link: off (${!info ? "no answer from the server" : !info.mailbox ? "this game has no mailbox" : !info.on ? "switched off in settings.json" : "the emulator's memory was not found"})`); return; }
  const table = info.table, box = document.getElementById("ask"), input = document.getElementById("askText");
  let base = -1, lastScan = 0, seen = null, pending = Promise.resolve(), options = [];
  const outbox = [];
  const heap = () => new Uint8Array(memory.buffer);
  // The game file holds the same eight bytes (its source constant) and can pass for a mailbox by chance: the live one
  // also has small, consistent counters, and the base's test hook sits at its known distance when the game has one.
  const live = (h, b) => h[b] === 0x48 && h[b + 7] === 0x42 && h[b + OFF.version] === 2 && h[b + OFF.msgKind] <= 2 && h[b + OFF.choiceCount] <= CHOICES_MAX
    && ((h[b + OFF.msgSeq] - h[b + OFF.shownSeq]) & 0xff) <= 1 && (!info.hook || (h[b + info.hook - info.mailbox] === 0x53 && h[b + info.hook - info.mailbox + 7] === 0x42));
  const here = (h) => base >= 0 && live(h, base);

  function locate(h) {
    if (here(h)) return true;
    if (performance.now() - lastScan < 1000) return false;
    lastScan = performance.now(); base = -1;
    const words = new Uint32Array(memory.buffer, 0, memory.buffer.byteLength >>> 2);
    for (let i = words.indexOf(LO); i !== -1; i = words.indexOf(LO, i + 1)) if (words[i + 1] === HI && live(h, i * 4)) { base = i * 4; seen = null; log(`agent link: mailbox found`); break; }
    return base >= 0;
  }
  function where(h) { // where the player is, from the base's test hook if this game has one
    if (!info.hook) return null;
    const p = base + (info.hook - info.mailbox), dv = new DataView(memory.buffer, p, 36);
    return h[p] === 0x53 && h[p + 8] === 1 ? { group: h[p + 28], num: h[p + 29], x: dv.getInt16(30, true), y: dv.getInt16(32, true) } : null;
  }
  function writeNext(h) {
    if (!outbox.length || h[base + OFF.msgSeq] !== h[base + OFF.shownSeq]) return;
    const msg = outbox.shift(), labels = (msg.choices ?? []).slice(0, CHOICES_MAX);
    h.set(msg.bytes, base + OFF.text);
    labels.forEach((l, n) => h.set(encodeLabel(l, table, CHOICE_LEN), base + OFF.choices + n * CHOICE_LEN));
    h[base + OFF.choiceCount] = labels.length;
    h[base + OFF.msgKind] = labels.length ? CHOICE : (msg.kind ?? 0);
    Atomics.store(h, base + OFF.msgSeq, (h[base + OFF.msgSeq] + 1) & 0xff); // publish last
  }
  /** Queue words for the game's message box; a long text becomes several messages, the menu goes on the last. */
  function show(text, kind, choices) {
    const parts = encodeMessages(text, table, TEXT_MAX, kind === ECHO ? 2 : Infinity);
    parts.forEach((bytes, i) => outbox.push({ bytes, kind, choices: i === parts.length - 1 ? choices : [] }));
  }
  function say(text) { // one turn at a time, in order
    show(`${info.player}: ${text}`, ECHO);
    const at = base >= 0 ? where(heap()) : null;
    pending = pending.then(async () => {
      let reply;
      try {
        const res = await fetch("/hermes/ask", { method: "POST", headers: { "content-type": "application/json", "x-key": key() }, body: JSON.stringify({ text, at }) });
        reply = (await res.json()).reply ?? "No signal. Try me again.";
      } catch { reply = "No signal. Try me again."; }
      const r = splitReply(reply); options = r.options;
      show(`${info.agent}: ${r.text}`, 0, options.length ? [...options, TYPE] : []);
    });
  }
  function openBox() { // one line under the screen; the game keeps running behind it
    if (!box.hidden) return input.focus();
    box.hidden = false; emu.toggleInput(false); input.value = ""; input.focus(); box.scrollIntoView({ block: "nearest" }); // a phone shows its keyboard only on a tap: the box must be in view to be tapped
    const close = (text) => { box.hidden = true; emu.toggleInput(true); input.blur(); box.onsubmit = document.getElementById("askCancel").onclick = input.onkeydown = null; if (text) say(text); };
    box.onsubmit = (e) => { e.preventDefault(); close(input.value.trim()); };
    document.getElementById("askCancel").onclick = () => close("");
    input.onkeydown = (e) => { if (e.key === "Escape") close(""); e.stopPropagation(); };
  }
  setInterval(() => {
    try {
      const h = heap(); if (!locate(h)) return;
      const now = { open: h[base + OFF.openSeq], choice: h[base + OFF.choiceSeq] };
      // a game that waits for us to answer its entry marks itself "AK" after the text: tell it the open we have seen,
      // or it says "No signal here" after a second and a half (a plain emulator has nobody at this end)
      if (h[base + OFF.ackMark] === 0x41 && h[base + OFF.ackMark + 1] === 0x4b) h[base + OFF.hostSeq] = now.open;
      if (seen && now.open !== seen.open) { openBox(); log("agent link: the game asked for the text box; opened"); }
      if (seen && now.choice !== seen.choice) { const i = h[base + OFF.choiceResult]; if (i === options.length) openBox(); else if (options[i]) say(options[i]); }
      seen = now; writeNext(h);
    } catch (err) { log(`agent link error: ${err?.message ?? err}`); }
  }, 150);
  window.agentLink = { say, open: openBox, get found() { return base >= 0; }, get waiting() { return outbox.length; } }; // for scripts and the console
}
