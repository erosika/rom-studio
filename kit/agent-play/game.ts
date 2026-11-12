// kit/agent-play/game.ts: one headless game kept running for a whole session: frames, buttons, where the player is, the
// message text, pictures, and a moment saved and restored. The same emulator and the same readings as kit/drive.ts,
// which starts a fresh game for every command and so cannot be shared.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Move, Where } from "./shapes";

export const W = 240, H = 160, FRAME_MS = 1000 / 59.7275;
const FACING = ["none", "down", "up", "left", "right"];
const MB_TEXT = 44; // the test hook's mailbox: where the last field message is kept (the base's hook source, version 1)

export type Game = Awaited<ReturnType<typeof openGame>>;

/** Start the emulator on a built game. `quiet` is the environment the emulator is given: it needs nothing of ours. */
export async function openGame(bin: string, rom: string, symFile: string, quiet: Record<string, string>) {
  const proc = Bun.spawn([bin, rom], { env: quiet, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  const reader = proc.stdout.getReader(), dec = new TextDecoder(), dir = mkdtempSync(join(tmpdir(), "agent-play-")), raw = join(dir, "frame.rgba");
  let buf = "", closed = false;
  async function line(): Promise<string> {
    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl >= 0) { const l = buf.slice(0, nl); buf = buf.slice(nl + 1); return l; }
      const { value, done } = await reader.read();
      if (done) return "err emulator exited";
      buf += dec.decode(value, { stream: true });
    }
  }
  async function cmd(c: string): Promise<string> {
    if (/[\0-\x1f]/.test(c)) throw new Error("a command to the emulator may not hold a line break");
    proc.stdin.write(c + "\n"); await proc.stdin.flush();
    const r = await line();
    if (!r.startsWith("ok")) throw new Error(`emulator: ${c.split(" ")[0]}: ${r}`);
    return r.slice(2).trim();
  }
  if (!(await line()).startsWith("ready")) throw new Error("the emulator did not start");

  const symText = readFileSync(symFile, "utf8");
  const sym = (n: string): number | null => { const m = new RegExp(`^([0-9a-f]{8}) .* ${n}$`, "m").exec(symText); return m ? parseInt(m[1]!, 16) : null; };
  const HOOK = sym("gStudioMailbox"), BOX = sym("sFieldMessageBoxMode");
  const read = async (a: number, n: number) => Uint8Array.from(Buffer.from(await cmd(`read ${a.toString(16)} ${n}`), "hex"));
  const u32 = async (a: number) => new DataView((await read(a, 4)).buffer).getUint32(0, true);

  let played = 0; // frames run in this session
  let watch: ((rgba: Uint8Array) => void) | null = null, paceFrom = 0, paceFrames = 0;
  /** Run frames. While someone watches, at the game's own speed, handing over every second picture. */
  async function frames(n: number) {
    if (!watch) { await cmd(`frames ${n}`); played += n; return; }
    for (let left = n; left > 0; ) {
      const now = performance.now();
      if (now - (paceFrom + paceFrames * FRAME_MS) > 250) { paceFrom = now; paceFrames = 0; } // after a pause (the agent thinking) the clock starts again
      const k = Math.min(2, left);
      await cmd(`frames ${k}`); left -= k; played += k; paceFrames += k;
      watch(await picture());
      const ahead = paceFrom + paceFrames * FRAME_MS - performance.now();
      if (ahead > 1) await Bun.sleep(ahead);
    }
  }
  /** The screen now: RGBA bytes, 240 by 160. */
  async function picture(): Promise<Uint8Array> { await cmd(`shot ${raw}`); return new Uint8Array(readFileSync(raw)); }

  async function state() {
    if (HOOK === null) { // no hook: the save block has the map and the square, the player's object its facing
      const ptr = sym("gSaveBlock1Ptr"), sb1 = ptr ? await u32(ptr) : 0;
      if (sb1 >>> 24 !== 2 && sb1 >>> 24 !== 3) return { ready: false, fieldFrames: 0, group: 0, num: 0, x: 0, y: 0, facing: 0, msgCount: 0 };
      const b = await read(sb1, 6), dv = new DataView(b.buffer), objs = sym("gObjectEvents"), av = sym("gPlayerAvatar");
      const facing = objs && av ? (await read(objs + 0x24 * (await read(av + 5, 1))[0]! + 0x18, 1))[0]! & 15 : 0;
      return { ready: true, fieldFrames: 0, group: b[4]!, num: b[5]!, x: dv.getInt16(0, true), y: dv.getInt16(2, true), facing, msgCount: 0 };
    }
    const b = await read(HOOK, 36), dv = new DataView(b.buffer);
    return { ready: String.fromCharCode(...b.subarray(0, 8)) === "STUDIOMB" && b[8] === 1 && dv.getUint32(24, true) > 0, fieldFrames: dv.getUint32(24, true),
      group: b[28]!, num: b[29]!, x: dv.getInt16(30, true), y: dv.getInt16(32, true), facing: b[34]!, msgCount: b[35]! };
  }
  async function hasControl(): Promise<boolean> {
    if (HOOK !== null) { const a = (await state()).fieldFrames; await frames(2); return (await state()).fieldFrames > a; }
    await frames(2);
    const main = sym("gMain"), cb1 = sym("CB1_Overworld"), cb2 = sym("CB2_Overworld"), lock = sym("sLockFieldControls"), fade = sym("gPaletteFade");
    if (!main || !cb1 || !cb2 || !lock) return false;
    return (await u32(main)) === (cb1 | 1) && (await u32(main + 4)) === (cb2 | 1) && (await read(lock, 1))[0] === 0 && (!fade || ((await read(fade + 7, 1))[0]! & 0x80) === 0);
  }
  let countWhenFree = -1; // how many messages had started when the player could last move
  /** Where the player is, or null before the game has a player on a map. */
  async function where(): Promise<Where | null> {
    const s = await state();
    if (!s.ready) return null;
    const control = await hasControl();
    if (control) countWhenFree = s.msgCount;
    return { map: `${s.group}.${s.num}`, x: s.x, y: s.y, facing: FACING[s.facing] ?? String(s.facing), control };
  }
  /** The text in the message box now, "" when none is open. The engine's own mark goes off once a message is fully printed, though the
   *  box stays until it is pressed away: so a message that began since the player could last move, while the player still cannot, counts as open. */
  async function text(control: boolean): Promise<string> {
    if (control) return "";
    if (HOOK === null) { const buf = sym("gStringVar4"); return buf ? decode(await read(buf, 256)) : ""; } // no count without the hook: this may be an old message
    const count = (await state()).msgCount, printing = BOX !== null && (await read(BOX, 1))[0] !== 0;
    return count && (printing || count !== countWhenFree) ? decode(await read(HOOK + MB_TEXT, 256)) : "";
  }

  /** Make an agent's moves; says in words what happened. */
  async function make(moves: Move[]): Promise<string> {
    const said: string[] = [];
    for (const m of moves) {
      if (m.op === "wait") { await frames(m.frames); said.push(`waited ${m.frames}`); }
      else if (m.op === "press") { await cmd(`keys ${m.mask}`); await frames(m.hold); await cmd("keys 0"); await frames(12); said.push(`pressed ${m.text}`); }
      else {
        let done = 0;
        for (; done < m.squares; done++) {
          const a = await state(); let moved = false;
          await cmd(`keys ${m.mask}`);
          for (let f = 0; f < 60 && !moved; f += 2) { await frames(2); const b = await state(); moved = b.x !== a.x || b.y !== a.y || b.group !== a.group || b.num !== a.num; }
          await cmd("keys 0"); await frames(16);
          if (!moved) break;
        }
        said.push(done === m.squares ? `walked ${m.name}:${done}` : `walked ${m.name}:${done} of ${m.squares}, BLOCKED (wall, person, or no control)`);
        if (done < m.squares) break; // the rest of the answer was planned from a place the player did not reach
      }
    }
    return said.join("; ");
  }

  async function close() {
    if (closed) return; closed = true;
    try { proc.stdin.write("quit\n"); await proc.stdin.flush(); } catch {}
    setTimeout(() => proc.kill("SIGKILL"), 1000).unref();
    await proc.exited; rmSync(dir, { recursive: true, force: true });
  }
  return {
    frames, picture, where, text, make, close,
    reset: () => cmd("reset"), save: (file: string) => cmd(`save ${file}`), load: (file: string) => cmd(`load ${file}`),
    played: () => played, hasHook: HOOK !== null,
    /** From now on every second picture goes to `to`, and the game runs at its own speed. */
    watched(to: (rgba: Uint8Array) => void) { watch = to; },
  };
}

function decode(b: Uint8Array): string { // game charset, enough to read a message
  let s = "";
  for (let i = 0; i < b.length && b[i] !== 0xff; i++) {
    const c = b[i]!;
    if (c >= 0xbb && c <= 0xd4) s += String.fromCharCode(65 + c - 0xbb);
    else if (c >= 0xd5 && c <= 0xee) s += String.fromCharCode(97 + c - 0xd5);
    else if (c >= 0xa1 && c <= 0xaa) s += String.fromCharCode(48 + c - 0xa1);
    else if (c === 0xfc) i += b[i + 1] === 4 ? 4 : [0x07, 0x09, 0x0a, 0x0f, 0x15, 0x16, 0x17, 0x18].includes(b[i + 1]!) ? 1 : 2;
    else if (c === 0xfd) { s += "{}"; i++; }
    else s += ({ 0x00: " ", 0xfe: " / ", 0xfa: " // ", 0xfb: " // ", 0xab: "!", 0xac: "?", 0xad: ".", 0xae: "-", 0xb0: "...", 0xb1: '"', 0xb2: '"', 0xb3: "'", 0xb4: "'", 0xb8: ",", 0xba: "/", 0xf0: ":", 0x1b: "e", 0x5c: "(", 0x5d: ")", 0x2d: "&", 0x2e: "+", 0x35: "=", 0x36: ";" } as Record<number, string>)[c] ?? "?";
  }
  return s;
}
