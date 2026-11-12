#!/usr/bin/env bun
// kit/drive.ts: boot the built ROM to the field, run the steps given as arguments, exit.
//   bun kit/drive.ts where shot shots/a.png
//   bun kit/drive.ts warp 0 9 5 5 walk UP:3,LEFT:2 press A wait 60 shot shots/b.png --scale 3 where
// Every run starts from the same cached "player can first walk" state (one per ROM hash). Works with or without the
// base's test hook; without it there is no flag or creature command and no message capture.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { encodePng } from "./png";

const KIT = import.meta.dir;
const GAME = resolve(process.env.GAME_DIR ?? join(KIT, "../../rom-studio-game"));
const ROM = process.env.ROM ?? join(GAME, "out/game.gba");
const SYM = process.env.SYM ?? ROM.replace(/\.gba$/, ".sym");
const BIN = join(KIT, "emu/bin/studio-emu");
const KEY: Record<string, number> = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128, R: 256, L: 512 };
const FACING = ["none", "down", "up", "left", "right"];
// the test hook's mailbox offsets (src/zz_studio.c, version 1)
const MB = { cmdSeq: 9, cmd: 11, mapGroup: 12, mapNum: 13, warpId: 14, x: 16, y: 18, arg: 20, fieldFrames: 24, msgText: 44 };

const die = (msg: string): never => { console.error(`drive: ${msg}`); process.exit(1); };
if (!existsSync(BIN)) die(`emulator not built. Run: bash ${KIT}/emu/build.sh`);
if (!existsSync(ROM) || !existsSync(SYM)) die(`no ROM at ${ROM} (or no .sym beside it). Run: ${KIT}/build.sh`);

// ---- emulator: one line in, one line out ----
const proc = Bun.spawn([BIN, ROM], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
const reader = proc.stdout.getReader();
const dec = new TextDecoder();
let buf = "";
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
  if (/[\0-\x1f]/.test(c)) throw new Error("a step may not hold a line break or control character"); // one line is one command to the emulator
  proc.stdin.write(c + "\n"); await proc.stdin.flush();
  const r = await line();
  if (!r.startsWith("ok")) throw new Error(`emulator: ${c.split(" ")[0]}: ${r}`);
  return r.slice(2).trim();
}
const frames = (n: number) => cmd(`frames ${n}`);
const read = async (a: number, n: number) => Uint8Array.from(Buffer.from(await cmd(`read ${a.toString(16)} ${n}`), "hex"));
const write = (a: number, bytes: number[]) => cmd(`write ${a.toString(16)} ${Buffer.from(bytes).toString("hex")}`);
async function tap(mask: number, hold = 4, after = 8) { await cmd(`keys ${mask}`); await frames(hold); await cmd("keys 0"); await frames(after); }

// ---- game: found through the build's symbol table ----
// With the base's test hook (gStudioMailbox) the game reports itself and takes commands. Without it, position is
// read from the save block and control from the main callbacks; there is no message capture and no flag or creature command.
const symText = readFileSync(SYM, "utf8");
const sym = (n: string): number | null => { const m = new RegExp(`^([0-9a-f]{8}) .* ${n}$`, "m").exec(symText); return m ? parseInt(m[1]!, 16) : null; };
const need = (n: string): number => sym(n) ?? die(`the symbol ${n} is not in ${SYM}: this step does not know this engine`);
const HOOK = sym("gStudioMailbox"), MBOX = HOOK ?? 0;
const u32 = async (a: number) => new DataView((await read(a, 4)).buffer).getUint32(0, true);
const w32 = (a: number, v: number) => write(a, [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]);
const NO_HOOK = "this build has no test hook (the kit's base is not applied)";

async function state() {
  if (HOOK === null) { // no hook: the save block has the map and the square, the player's object its facing
    const sb1 = await u32(need("gSaveBlock1Ptr"));
    if (sb1 >>> 24 !== 2 && sb1 >>> 24 !== 3) return { ready: false, fieldFrames: 0, group: 0, num: 0, x: 0, y: 0, facing: 0, msgCount: 0 };
    const b = await read(sb1, 6), dv = new DataView(b.buffer), objs = sym("gObjectEvents"), av = sym("gPlayerAvatar");
    const facing = objs && av ? (await read(objs + 0x24 * (await read(av + 5, 1))[0]! + 0x18, 1))[0]! & 15 : 0;
    return { ready: true, fieldFrames: 0, group: b[4]!, num: b[5]!, x: dv.getInt16(0, true), y: dv.getInt16(2, true), facing, msgCount: 0 };
  }
  const b = await read(MBOX, 36), dv = new DataView(b.buffer);
  return { ready: String.fromCharCode(...b.subarray(0, 8)) === "STUDIOMB" && b[8] === 1, fieldFrames: dv.getUint32(24, true),
    group: b[28]!, num: b[29]!, x: dv.getInt16(30, true), y: dv.getInt16(32, true), facing: b[34]!, msgCount: b[35]! };
}
async function hasControl(): Promise<boolean> {
  if (HOOK !== null) { const a = (await state()).fieldFrames; await frames(2); return (await state()).fieldFrames > a; }
  await frames(2); // no hook: the field's callbacks are running, no script holds the controls, no fade is in progress
  const main = need("gMain"), fade = sym("gPaletteFade");
  return (await u32(main)) === (need("CB1_Overworld") | 1) && (await u32(main + 4)) === (need("CB2_Overworld") | 1)
    && (await read(need("sLockFieldControls"), 1))[0] === 0 && (!fade || ((await read(fade + 7, 1))[0]! & 0x80) === 0);
}
/** Run frames until the player has had control on 3 checks in a row. False if that never happens. */
async function waitForField(maxFrames = 1800): Promise<boolean> {
  for (let f = 0, steady = 0; f < maxFrames; f += 10) {
    await frames(8);
    steady = (await hasControl()) ? steady + 1 : 0;
    if (steady >= 3) return true;
  }
  return false;
}
async function command(c: number, fields: [number, number, number][]) { // [offset, size, value]; cmdSeq bumped last
  for (const [off, size, v] of fields) await write(MBOX + off, size === 1 ? [v & 255] : [v & 255, (v >> 8) & 255]);
  await write(MBOX + MB.cmd, [c]);
  await write(MBOX + MB.cmdSeq, [((await read(MBOX + MB.cmdSeq, 1))[0]! + 1) & 255]);
}
function decode(b: Uint8Array): string { // game charset, enough to read a message
  let s = "";
  for (let i = 0; i < b.length && b[i] !== 0xff; i++) {
    const c = b[i]!;
    if (c >= 0xbb && c <= 0xd4) s += String.fromCharCode(65 + c - 0xbb);
    else if (c >= 0xd5 && c <= 0xee) s += String.fromCharCode(97 + c - 0xd5);
    else if (c >= 0xa1 && c <= 0xaa) s += String.fromCharCode(48 + c - 0xa1);
    else if (c === 0xfc) { s += ""; i += b[i + 1] === 4 ? 4 : [0x07, 0x09, 0x0a, 0x0f, 0x15, 0x16, 0x17, 0x18].includes(b[i + 1]!) ? 1 : 2; }
    else if (c === 0xfd) { s += "{}"; i++; }
    else s += ({ 0x00: " ", 0xfe: " / ", 0xfa: " // ", 0xfb: " // ", 0xab: "!", 0xac: "?", 0xad: ".", 0xae: "-", 0xb0: "...", 0xb1: '"', 0xb2: '"', 0xb3: "'", 0xb4: "'", 0xb8: ",", 0xba: "/", 0xf0: ":", 0x1b: "e", 0x5c: "(", 0x5d: ")", 0x2d: "&", 0x2e: "+", 0x35: "=", 0x36: ";" } as Record<number, string>)[c] ?? "?";
  }
  return s;
}
async function where() {
  const s = await state(), control = await hasControl(), buf = sym("gStringVar4");
  const msg = HOOK === null ? (buf ? decode(await read(buf, 256)) : "") : s.msgCount ? decode(await read(MBOX + MB.msgText, 256)) : "";
  const tail = HOOK === null ? `  messages not counted (no test hook)${msg ? `  text buffer, may be old: "${msg}"` : ""}` : `  messages ${s.msgCount}${msg ? `  last message: "${msg}"` : ""}`;
  console.log(`where: map ${s.group}.${s.num}  x ${s.x}  y ${s.y}  facing ${FACING[s.facing] ?? s.facing}  control ${control ? "yes" : "no"}${tail}`);
}

const SAVE_CLOCK_OFFSET = 0x98; // where the save keeps the clock offset (days, hours, minutes, seconds) in the engines tried
let heldTime: number | null = null;
/** The game's own clock, after it has had a few frames to read the cartridge clock. */
async function clock() {
  await frames(8); const b = await read(need("gLocalTime"), 5), p = (n: number) => String(n).padStart(2, "0");
  return { secs: b[2]! * 3600 + b[3]! * 60 + b[4]!, text: `${p(b[2]!)}:${p(b[3]!)}:${p(b[4]!)}` };
}

// ---- pictures ----
async function shot(path: string, scale: number) {
  const out = resolve(path), tmp = `${out}.${process.pid}.rgba`;
  mkdirSync(dirname(out), { recursive: true });
  await cmd(`shot ${tmp}`);
  const rgba = new Uint8Array(readFileSync(tmp)); rmSync(tmp, { force: true });
  let lit = 0; for (let i = 0; i < rgba.length; i += 4) if (rgba[i]! + rgba[i + 1]! + rgba[i + 2]! > 24) lit++;
  writeFileSync(out, encodePng(rgba, 240, 160, scale));
  console.log(`shot: ${out} (${240 * scale}x${160 * scale})${lit < 400 ? "  WARNING: the frame is almost all black (mid-fade? try `wait 60` first)" : ""}`);
}

// ---- boot, cached per ROM ----
async function boot() {
  const hash = createHash("sha1").update(readFileSync(ROM)).digest("hex").slice(0, 12);
  const ss = join(KIT, ".cache", `field-${hash}.ss`);
  if (existsSync(ss)) { try { await cmd(`load ${ss}`); return; } catch { rmSync(ss, { force: true }); } }
  mkdirSync(dirname(ss), { recursive: true });
  await cmd("reset");
  for (let i = 0; ; i++) { // with the base's quick start a few presses of A; without it, through the whole opening (START leaves the name screen)
    await frames(30);
    const s = await state();
    if (HOOK === null ? s.ready && (await hasControl()) : s.ready && s.fieldFrames > 0) break;
    if (i >= (HOOK === null ? 1500 : 60)) die("never reached the field from boot (does the opening need more than A and START? does the first map take control forever?)");
    await tap(i % 4 === 3 && HOOK === null ? KEY.START! : KEY.A!, 3, 3);
  }
  if (HOOK === null) console.log(`boot: ${NO_HOOK}; pressed through the opening to the first moment the player can walk`);
  if (!(await waitForField())) console.log("boot: reached the field but the player has no steady control (an opening scene may be running)");
  await cmd(`save ${ss}.${process.pid}.tmp`); renameSync(`${ss}.${process.pid}.tmp`, ss);
  try { // every build leaves one of these (about 0.3 MB): keep the eight newest, an old build's start is never loaded again
    const dir = dirname(ss), old = readdirSync(dir).filter((f) => /^field-[0-9a-f]{12}\.ss$/.test(f)).map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(8);
    for (const o of old) rmSync(join(dir, o.f), { force: true });
  } catch {}
  console.log(`boot: fresh start cached for ROM ${hash}`);
}

// ---- steps ----
const args = process.argv.slice(2);
const USAGE = `usage: bun kit/drive.ts <step> [<step> ...]   (steps run in order, from a fresh quick start each run)
  press A,B,UP,START      tap buttons one after another (NAME:frames holds longer, A+B together)
  walk UP:3,LEFT:2        walk whole squares; says where it stopped if blocked
  warp <group> <num> <x> <y>
  wait <frames>           60 frames = 1 second
  shot <file.png> [--scale 3]
  where                   map, square, facing, control, last message
  flag set|clear <id>
  givemon <species number> <level>   put a creature in the party (numbers are in include/constants/species.h)
  script <name>           start a script by name, e.g. a trainer's, to reach a battle
  gender <0 boy|1 girl>   change the saved look
  time [HH:MM|midday|midnight]   print the game's clock, or set it and hold it there (put it before warp: the day and night tint follows on the next map change)
  rtc host|<ms>           the cartridge clock itself: the computer's clock, or frozen at that Unix time in milliseconds
  save <file> / load <file>   keep or restore a moment (same ROM only)
  audio <file.wav>|off    record what the game plays (stereo, the console's own rate) until audio off
  reset                   switch the console off and on: the game from its very first screen
  video <file.mp4>|off    record the picture, every frame, until video off (needs ffmpeg; 240x160, no sound)
  bytes <hex>             run script commands given as bytes (kit music uses it to start a song by number)`;
if (!args.length || args[0] === "help" || args[0] === "--help") { console.log(USAGE); process.exit(0); }
const num = (v: string | undefined, what: string) => { const n = Number(v); if (v === undefined || !Number.isInteger(n)) die(`${what} must be a whole number, got "${v}"\n${USAGE}`); return n; };
const mask = (names: string) => names.split("+").reduce((m, k) => m | (KEY[k.toUpperCase()] ?? die(`unknown button "${k}". Buttons: ${Object.keys(KEY).join(" ")}`)), 0);

try {
  if (!(await line()).startsWith("ready")) die("the emulator did not start");
  await boot();
  for (let i = 0; i < args.length; ) {
    const step = args[i++]!;
    if (step === "press") {
      const list = args[i++] ?? die("press needs buttons, e.g. press A,A,UP");
      for (const p of list.split(",")) { const [k, n] = p.split(":"); await tap(mask(k!), n ? num(n, "hold frames") : 4, 12); }
      console.log(`press: ${list}`);
    } else if (step === "walk") {
      const list = args[i++] ?? die("walk needs a path, e.g. walk UP:3,LEFT:2");
      let blocked = "";
      path: for (const p of list.split(",")) {
        const [k, n] = p.split(":"); const m = mask(k!);
        for (let j = 0; j < (n ? num(n, "squares") : 1); j++) {
          const a = await state(); let moved = false;
          await cmd(`keys ${m}`);
          for (let f = 0; f < 60 && !moved; f += 2) { await frames(2); const b = await state(); moved = b.x !== a.x || b.y !== a.y || b.group !== a.group || b.num !== a.num; }
          await cmd("keys 0"); await frames(16);
          if (!moved) { blocked = `  BLOCKED going ${k} after ${j} of ${n ?? 1} (wall, person, or no control)`; break path; }
        }
      }
      const s = await state();
      console.log(`walk: ${list} -> map ${s.group}.${s.num} (${s.x},${s.y})${blocked}`);
    } else if (step === "warp") {
      const [g, n, x, y] = [num(args[i++], "map group"), num(args[i++], "map number"), num(args[i++], "x"), num(args[i++], "y")];
      if (!(await waitForField(600))) console.log("warp: the player has no control right now; trying anyway");
      if (HOOK !== null) await command(1, [[MB.mapGroup, 1, g], [MB.mapNum, 1, n], [MB.warpId, 1, 0xff], [MB.x, 2, x], [MB.y, 2, y]]);
      else { // no hook: write where the save says the player is, then have the game load that map
        const sb1 = await u32(need("gSaveBlock1Ptr")), xy = [x & 255, (x >> 8) & 255, y & 255, (y >> 8) & 255];
        await write(sb1, xy); await write(sb1 + 4, [g, n, 0xff, 0, ...xy]); await w32(need("gMain") + 4, need("CB2_LoadMap") | 1);
      }
      let s = await state(), landed = false;
      for (let f = 0; f < 600 && !landed; f += 10) { await frames(10); s = await state(); landed = s.group === g && s.num === n && s.x === x && s.y === y; }
      if (!landed) die(`warp to ${g}.${n} (${x},${y}) did not land: at ${s.group}.${s.num} (${s.x},${s.y}). Check the map group/number and the square; if a message or scene was open, close it first (press B or A) because the game takes commands only while the player has control.`);
      const free = await waitForField(600);
      console.log(`warp: at map ${g}.${n} (${x},${y})${free ? "" : "  (the player has no control: a scene is running; use wait / press)"}`);
      if (heldTime !== null) { const c = await clock(); console.log(Math.abs(c.secs - heldTime) <= 120 ? `time: the game's clock here is ${c.text}` : `time: WARNING, the game's clock here is ${c.text}, not the hour asked for (an indoor map may not read the clock; or this engine keeps its own)`); }
    } else if (step === "wait") { const n = num(args[i++], "frames"); await frames(n); console.log(`wait: ${n} frames`);
    } else if (step === "shot") {
      const path = args[i++] ?? die("shot needs a file, e.g. shot shots/a.png");
      let scale = 1; if (args[i] === "--scale") { i++; scale = num(args[i++], "scale"); }
      await shot(path, scale);
    } else if (step === "where") await where();
    else if (step === "flag") {
      const op = args[i++], id = num(args[i++], "flag id");
      if (op !== "set" && op !== "clear") die(`flag needs set or clear, got "${op}"`);
      if (HOOK === null) { console.log(`flag: NOT DONE, ${NO_HOOK}`); continue; }
      await command(op === "set" ? 2 : 3, [[MB.arg, 2, id]]); await frames(4);
      const q = await read(MBOX + MB.cmdSeq, 2);
      console.log(`flag: ${op} ${id}${q[0] === q[1] ? "" : "  NOT APPLIED YET: the game takes commands only while the player has control; wait or press first"}`);
    } else if (step === "givemon") {
      const sp = num(args[i++], "species number"), lv = num(args[i++], "level");
      if (HOOK === null) { console.log(`givemon: NOT DONE, ${NO_HOOK}`); continue; }
      await command(5, [[MB.arg, 2, sp], [22, 2, lv]]); await frames(6);
      console.log(`givemon: species ${sp} at level ${lv}`);
    } else if (step === "gender") {
      const g = num(args[i++], "gender (0 boy, 1 girl)");
      await write((await u32(need("gSaveBlock2Ptr"))) + 8, [g]);
      console.log(`gender: ${g === 0 ? "boy" : "girl"} (shows from the next screen that draws the player)`);
    } else if (step === "rtc") {
      const v = args[i++] ?? die("rtc needs host or a Unix time in milliseconds");
      await cmd(v === "host" ? "rtc host" : `rtc fixed ${num(v, "milliseconds")}`); await frames(4);
      console.log(`rtc: ${v === "host" ? "the computer's clock" : `frozen at ${v} ms`}  (game clock ${await clock().then((c) => c.text)})`);
    } else if (step === "time") {
      const want = /^(\d{1,2}):(\d{2})$/.exec(({ midday: "12:00", noon: "12:00", midnight: "00:00" } as Record<string, string>)[args[i] ?? ""] ?? args[i] ?? "");
      if (!want) { console.log(`time: ${(await clock()).text}`); continue; }
      i++; const target = Number(want[1]) * 3600 + Number(want[2]) * 60; if (Number(want[1]) > 23 || Number(want[2]) > 59) die(`time takes an hour of the day as HH:MM, got "${want[0]}"`);
      // the game's hour is the cartridge clock (this computer's local time) minus an offset kept in the save: freeze the cartridge clock where the difference is the hour asked for
      const off = await read((await u32(need("gSaveBlock2Ptr"))) + SAVE_CLOCK_OFFSET, 5), d = new Date(), sod = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
      const to = d.getTime() + ((((target + off[2]! * 3600 + off[3]! * 60 + off[4]! - sod) % 86400) + 86400) % 86400) * 1000;
      await cmd(`rtc fixed ${to}`); const now = await clock(); heldTime = target;
      console.log(Math.abs(now.secs - target) <= 2 ? `time: ${now.text}, held there (rtc ${to}). The day and night tint follows on the next map change`
        : `time: set to ${want[0]} by calculation (rtc ${to}); the game still shows ${now.text} because it reads its clock only outdoors or on a map change. The next warp reports it`);
    } else if (step === "script") { // start a script by its name in the symbol file, as if something on the map had triggered it
      const name = args[i++] ?? die("script needs a script's name, e.g. script MyMap_EventScript_Rival"), ctx = need("sGlobalScriptContext");
      await w32(ctx + 92, need("gScriptCmdTable")); await w32(ctx + 96, need("gScriptCmdTableEnd"));
      await w32(ctx + 8, need(name)); await write(ctx, [0, 1, 0, 0]);
      await write(need("sLockFieldControls"), [1]); await write(need("sGlobalScriptContextStatus"), [0]);
      await frames(4);
      console.log(`script: ${name} started`);
    } else if (step === "bytes") { // script commands given as bytes, run from the game's text buffer: how kit music starts a song by its number
      const hex = args[i++] ?? die("bytes needs script bytes in hex"), ctx = need("sGlobalScriptContext"), at = need("gStringVar4");
      if (!(await waitForField(600))) console.log("bytes: the player has no control right now; trying anyway");
      await cmd(`write ${at.toString(16)} ${hex}`); await w32(ctx + 92, need("gScriptCmdTable")); await w32(ctx + 96, need("gScriptCmdTableEnd"));
      await w32(ctx + 8, at); await write(ctx, [0, 1, 0, 0]); await write(need("sLockFieldControls"), [1]); await write(need("sGlobalScriptContextStatus"), [0]);
      await frames(4); console.log(`bytes: ${hex} run`);
    } else if (step === "audio") { // record what the game plays to a .wav, until `audio off`
      const to = args[i++] ?? die("audio needs a .wav file, or off"), r = await cmd(to === "off" ? "audio off" : `audio ${resolve(to)}`);
      console.log(to === "off" ? `audio: stopped, ${r} sample frames` : `audio: recording to ${resolve(to)} at ${r} Hz`);
    } else if (step === "reset") { await cmd("reset"); console.log("reset: the console is switched off and on (the card and the title come next)");
    } else if (step === "video") { // record every frame to an .mp4 through ffmpeg, until `video off`
      const to = args[i++] ?? die("video needs an .mp4 file, or off");
      if (to !== "off") mkdirSync(dirname(resolve(to)), { recursive: true });
      const r = await cmd(to === "off" ? "video off" : `video ${resolve(to)}`);
      console.log(to === "off" ? `video: stopped, ${r} frames (${(Number(r) / 59.7275).toFixed(1)} s)` : `video: recording to ${resolve(to)}`);
    } else if (step === "save" || step === "load") { const p = resolve(args[i++] ?? die(`${step} needs a file`)); await cmd(`${step} ${p}`); console.log(`${step}: ${p}`);
    } else die(`unknown step "${step}"\n${USAGE}`);
  }
} catch (e) { console.error(`drive: ${(e as Error).message}`); process.exitCode = 1; }
try { proc.stdin.write("quit\n"); await proc.stdin.flush(); } catch {}
setTimeout(() => proc.kill("SIGKILL"), 1000).unref();
await proc.exited;
