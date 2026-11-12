// kit/music.ts: the game's songs, sound effects and samples, read from the tree: list them, say where each is heard,
// record one from the built game with the headless emulator, and put the user's own file in place of one.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { childEnv } from "./env";

const KIT = import.meta.dir, env = process.env;
const TOOL_PATH = [join(env.ARM_GCC ?? join(env.HOME ?? "", ".local/opt/arm-gnu-14.2"), "bin"), env.PATH].join(":");
const MIDI_DIR = "sound/songs/midi", CFG = `${MIDI_DIR}/midi.cfg`, SAMPLES = "sound/direct_sound_samples";
const text = (f: string) => { try { return readFileSync(f, "utf8"); } catch { return ""; } };
const mtime = (f: string) => { try { return statSync(f).mtimeMs; } catch { return 0; } };
const sh = (cmd: string[], cwd?: string) => { const r = Bun.spawnSync(cmd, { cwd, env: childEnv({ PATH: TOOL_PATH }), stdout: "pipe", stderr: "pipe", timeout: 120_000, killSignal: "SIGKILL" }); return { ok: r.exitCode === 0, out: (r.stdout.toString() + r.stderr.toString()).trim() }; }; // a tool that hangs is stopped
const FFMPEG = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-protocol_whitelist", "file,pipe"]; // reads the one file it is given: a file that names others on the network is not followed
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}${s < 10 ? `.${Math.floor((s % 1) * 10)}` : ""}`;

export type Kind = "song" | "effect" | "sample" | "cry";
export type Options = { voicegroup: string | null; volume: number | null; priority: number | null; reverb: number | null; raw: string };
export type Sound = { kind: Kind; name: string; file: string | null; yours: boolean; seconds: number | null; bytes: number;
  number?: number; label?: string; player?: string; tracks?: number; options?: Options; loops?: boolean; heard?: string[]; rate?: number };

// ---- file formats ----
export function readMidi(b: Uint8Array) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), str = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
  if (b.length < 22 || str(0, 4) !== "MThd" || dv.getUint32(4) !== 6) throw new Error("it is not a MIDI file (no MThd header at the start)");
  const format = dv.getUint16(8), ntrks = dv.getUint16(10), div = dv.getInt16(12);
  if (format > 1) throw new Error(`it is MIDI format ${format}; the converter takes format 0 or 1. Export it again as format 1`);
  if (div <= 0) throw new Error("its timing is in film frames (SMPTE); export it with ticks per beat");
  const tempos: [number, number][] = [], marks: Record<string, number> = {}, pairs = new Set<string>(), programs = new Set<number>();
  let o = 14, end = 0, hanging = 0, eot: { at: number; delta: number; tick: number; stop: number } | null = null;
  for (let t = 0; t < ntrks; t++) {
    if (o + 8 > b.length || str(o, 4) !== "MTrk") throw new Error(`its track ${t + 1} is damaged (no MTrk header)`);
    const stop = o + 8 + dv.getUint32(o + 4), open = new Map<number, number>(); let p = o + 8, tick = 0, status = 0;
    if (stop > b.length) throw new Error(`its track ${t + 1} is cut short`);
    const vlq = () => { let v = 0, c: number; do { c = b[p++]!; v = (v << 7) | (c & 127); } while (c & 128 && p < stop); return v; };
    while (p < stop) {
      const at = p, delta = vlq(); tick += delta; let s = b[p]!;
      if (s < 0x80) s = status; else p++;
      if (s === 0xff) {
        const type = b[p++]!, n = vlq();
        if (type === 0x2f) { if (t === 0) eot = { at, delta, tick, stop }; break; }
        if (type === 0x51 && n === 3) tempos.push([tick, (b[p]! << 16) | (b[p + 1]! << 8) | b[p + 2]!]);
        if (t === 0 && type >= 1 && type <= 7 && n <= 2 && ["[", "]", "]["].includes(str(p, n))) marks[str(p, n)] = tick; // the converter reads these from the first track only
        p += n;
      } else if (s === 0xf0 || s === 0xf7) { const n = vlq(); p += n; }
      else if (s < 0x80) throw new Error(`its track ${t + 1} is damaged (a data byte with no event before it)`);
      else {
        status = s; const hi = s & 0xf0, ch = s & 15, a = b[p++]!, v = hi === 0xc0 || hi === 0xd0 ? 0 : b[p++]!, key = ch * 128 + a;
        if (hi === 0x90 && v > 0) { pairs.add(`${t}.${ch}`); open.set(key, (open.get(key) ?? 0) + 1); }
        else if (hi === 0x80 || hi === 0x90) open.set(key, Math.max(0, (open.get(key) ?? 0) - 1));
        else if (hi === 0xc0) programs.add(a);
      }
    }
    end = Math.max(end, tick); for (const n of open.values()) hanging += n; o = stop;
  }
  tempos.sort((x, y) => x[0] - y[0]);
  const at = (tick: number) => { let s = 0, last = 0, us = 500000; for (const [t, u] of tempos) { if (t >= tick) break; s += ((t - last) * us) / div / 1e6; last = t; us = u; } return s + ((tick - last) * us) / div / 1e6; };
  const loops = marks["["] !== undefined && marks["]"] !== undefined;
  return { format, ntrks, div, tracks: pairs.size, programs: [...programs].sort((x, y) => x - y), hanging, end, eot, loops, seconds: at(loops ? marks["]"]! : end), loopFrom: loops ? at(marks["["]!) : null };
}
/** The same file with "[" at its start and "]" at its end, so the whole of it repeats. */
function loopWhole(b: Uint8Array, m: ReturnType<typeof readMidi>): Uint8Array {
  if (!m.eot) throw new Error("its first track has no end marker, so loop marks cannot be added");
  const vlq = (v: number) => { const out = [v & 127]; while ((v >>= 7)) out.unshift((v & 127) | 128); return out; };
  const body = [0, 0xff, 6, 1, 0x5b, ...b.subarray(22, m.eot.at), ...vlq(m.eot.delta + m.end - m.eot.tick), 0xff, 6, 1, 0x5d, 0, 0xff, 0x2f, 0];
  const out = new Uint8Array([...b.subarray(0, 18), 0, 0, 0, 0, ...body, ...b.subarray(m.eot.stop)]);
  new DataView(out.buffer).setUint32(18, body.length); return out;
}
export function readWav(b: Uint8Array) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), id = (o: number) => String.fromCharCode(...b.subarray(o, o + 4));
  if (b.length < 20 || id(0) !== "RIFF" || id(8) !== "WAVE") throw new Error("it is not a .wav file");
  let rate = 0, channels = 0, bits = 0, format = 0, frames = 0, loop: [number, number] | null = null, key = 60;
  for (let o = 12; o + 8 <= b.length; ) {
    const n = dv.getUint32(o + 4, true), d = o + 8;
    if (id(o) === "fmt ") { format = dv.getUint16(d, true); channels = dv.getUint16(d + 2, true); rate = dv.getUint32(d + 4, true); bits = dv.getUint16(d + 14, true); }
    if (id(o) === "data") frames = Math.min(n, b.length - d) / Math.max(1, (channels * bits) / 8);
    if (id(o) === "smpl" && n >= 36) { key = dv.getUint32(d + 12, true); if (dv.getUint32(d + 28, true) >= 1 && n >= 60) loop = [dv.getUint32(d + 44, true), dv.getUint32(d + 48, true)]; }
    o = d + n + (n & 1);
  }
  if (!rate || !frames) throw new Error("it is a .wav file with no sound in it");
  return { rate, channels, bits, format, frames, loop, key, seconds: frames / rate };
}
function withLoop(wav: Uint8Array, key: number, from: number, to: number): Uint8Array { // appends a sampler chunk: the note it was recorded at and one loop
  const c = new Uint8Array(68), dv = new DataView(c.buffer); c.set([0x73, 0x6d, 0x70, 0x6c]); // "smpl"
  dv.setUint32(4, 60, true); dv.setUint32(20, key, true); dv.setUint32(36, 1, true); dv.setUint32(52, from, true); dv.setUint32(56, to, true);
  const out = new Uint8Array(wav.length + 68); out.set(wav); out.set(c, wav.length); new DataView(out.buffer).setUint32(4, out.length - 8, true); return out;
}

// ---- the tree ----
function parseOptions(raw: string): Options {
  const one = (k: string) => new RegExp(`(?:^|\\s)-${k}(\\S+)`).exec(raw)?.[1], n = (k: string) => (one(k) === undefined ? null : Number(one(k)));
  return { voicegroup: one("G")?.replace(/^_/, "") ?? null, volume: n("V"), priority: n("P"), reverb: n("R"), raw: raw.trim() };
}
const cfgLines = (s: string) => new Map([...s.matchAll(/^(\S+)\.mid:[ \t]*(.*)$/gm)].map((m) => [m[1]!, m[2]!.trim()]));
const firstCommit = (game: string) => sh(["git", "-C", game, "rev-list", "--max-parents=0", "HEAD"]).out.split("\n").pop() ?? "";
function walk(dir: string, out: string[] = []): string[] { for (const e of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) e.isDirectory() ? walk(join(dir, e.name), out) : out.push(join(dir, e.name)); return out; }
const isGame = (game: string) => existsSync(join(game, "sound/song_table.inc")) && existsSync(join(game, "include/constants/songs.h"));
export const NOT_THIS = "This game folder has no sound/song_table.inc and include/constants/songs.h, so kit music does not know how it keeps its music.";

/** Every song and effect in the song table, then every sample and cry file. */
export function listSounds(game: string, kind?: Kind): Sound[] {
  if (!isGame(game)) throw new Error(NOT_THIS);
  const root = firstCommit(game), was = root ? cfgLines(sh(["git", "-C", game, "show", `${root}:${CFG}`]).out) : new Map<string, string>();
  const changed = new Set(root ? `${sh(["git", "-C", game, "diff", "--name-only", root, "--", "sound"]).out}\n${sh(["git", "-C", game, "ls-files", "--others", "--exclude-standard", "sound"]).out}`.split("\n") : []);
  const out: Sound[] = [];
  if (!kind || kind === "song" || kind === "effect") {
    const names = new Map<number, string>(), defined = new Set<string>(); for (const m of text(join(game, "include/constants/songs.h")).matchAll(/^#define\s+(\w+)\s+(\d+)\b/gm)) { defined.add(m[1]!); if (!names.has(+m[2]!)) names.set(+m[2]!, m[1]!); }
    const limits = new Map([...text(join(game, "sound/music_player_table.inc")).matchAll(/NUM_TRACKS_(\w+),\s*(\d+)/g)].map((m) => [m[1]!, +m[2]!]));
    const cfg = cfgLines(text(join(game, CFG))), heard = new Map<string, string[]>();
    for (const d of existsSync(join(game, "data/maps")) ? readdirSync(join(game, "data/maps")) : []) { const m = /"music":\s*"(\w+)"/.exec(text(join(game, "data/maps", d, "map.json"))); if (m) heard.set(m[1]!, [...(heard.get(m[1]!) ?? []), d]); }
    [...text(join(game, "sound/song_table.inc")).matchAll(/^\s*song\s+(\w+)\s*,\s*(\w+)/gm)].forEach((m, number) => {
      const label = m[1]!, player = m[2]!.replace(/^MUSIC_PLAYER_/, ""), k: Kind = player === "BGM" ? "song" : "effect", file = `${MIDI_DIR}/${label}.mid`, has = existsSync(join(game, file));
      if (/dummy_song_header/.test(label) || (kind && kind !== k)) return;
      const name = defined.has(label.toUpperCase()) ? label.toUpperCase() : names.get(number) ?? label.toUpperCase(); // a number can have a second name: the song's own wins
      let mid: ReturnType<typeof readMidi> | null = null; try { if (has) mid = readMidi(readFileSync(join(game, file))); } catch {}
      out.push({ kind: k, name, number, label, player, tracks: limits.get(player), file: has ? file : null, options: cfg.has(label) ? parseOptions(cfg.get(label)!) : undefined,
        seconds: mid ? Math.round(mid.seconds * 10) / 10 : null, loops: mid?.loops, bytes: has ? statSync(join(game, file)).size : 0, yours: changed.has(file) || (cfg.has(label) && was.size > 0 && was.get(label) !== cfg.get(label)), heard: heard.get(name) ?? [] });
    });
  }
  if (!kind || kind === "sample" || kind === "cry") for (const f of walk(join(game, SAMPLES)).filter((f) => /\.(wav|aif)$/i.test(f)).sort()) {
    const rel = relative(game, f), name = relative(join(game, SAMPLES), f).replace(/\.\w+$/, ""), k: Kind = name.startsWith("cries/") ? "cry" : "sample";
    if (kind && kind !== k) continue;
    let w: ReturnType<typeof readWav> | null = null; try { if (/\.wav$/i.test(f)) w = readWav(readFileSync(f)); } catch {}
    out.push({ kind: k, name, file: rel, yours: changed.has(rel), seconds: w ? Math.round(w.seconds * 100) / 100 : null, loops: w ? !!w.loop : undefined, rate: w?.rate, bytes: statSync(f).size });
  }
  return out;
}
export function findSound(game: string, name: string): Sound {
  const all = listSounds(game), n = name.toLowerCase().replace(/\.(mid|wav|aif)$/, ""), hit = all.filter((s) => s.name.toLowerCase() === n || s.label === n || s.name.toLowerCase() === `cries/${n}`);
  if (hit.length === 1) return hit[0]!;
  const near = all.filter((s) => s.name.toLowerCase().includes(n)).slice(0, 8).map((s) => s.name);
  throw new Error(hit.length ? `"${name}" is the name of ${hit.length} things: ${hit.map((s) => s.name).join(", ")}. Use the full name.` : `There is no song, effect or sample called "${name}".${near.length ? ` Close: ${near.join(", ")}.` : ""} kit music lists them.`);
}
export function soundText(s: Sound): string {
  const o = s.options, facts = s.kind === "song" || s.kind === "effect"
    ? [`#${s.number}`, s.file ?? "no midi file (written by hand or empty)", o ? [o.voicegroup && `group ${o.voicegroup}`, o.volume !== null && `vol ${o.volume}`, o.reverb !== null && `rev ${o.reverb}`, o.priority !== null && `pri ${o.priority}`].filter(Boolean).join(" ") : "no build options line",
      s.seconds !== null ? `${clock(s.seconds)}${s.loops ? " loops" : ""}` : "", s.heard?.length ? `map music in ${s.heard.length}: ${s.heard.slice(0, 3).join(", ")}${s.heard.length > 3 ? "..." : ""}` : ""]
    : [s.file!, s.rate ? `${s.rate} Hz` : "", s.seconds !== null ? `${s.seconds} s${s.loops ? " loops" : ""}` : "", `${s.bytes} bytes`];
  return `${s.yours ? "yours " : "      "}${s.kind.padEnd(6)} ${s.name.padEnd(28)} ${facts.filter(Boolean).join("  ")}`;
}

/** Where a song or effect is used, or which instruments and songs use a sample. */
export function whereHeard(game: string, s: Sound): string[] {
  if (s.kind === "song" || s.kind === "effect") {
    const uses = sh(["git", "-C", game, "grep", "-n", "-w", "-e", s.name, "--", "data", "src", ":!data/maps/*/map.json"]).out.split("\n").filter(Boolean);
    return [...(s.heard?.length ? [`the music of ${s.heard.length} maps: ${s.heard.join(", ")}`] : [`not the music of any map`]),
      ...(uses.length ? [`named in ${uses.length} lines of scripts and code:`, ...uses.slice(0, 40).map((l) => `  ${l.length > 160 ? `${l.slice(0, 160)}...` : l}`), ...(uses.length > 40 ? [`  (${uses.length - 40} more: git grep -w ${s.name})`] : [])] : ["not named in any script or code"])];
  }
  const data = text(join(game, "sound/direct_sound_data.inc")).split("\n"), i = data.findIndex((l) => l.includes(`"${s.file!.replace(/\.\w+$/, ".bin")}"`));
  const sym = i > 0 ? /^(\w+)::/.exec(data.slice(0, i).reverse().find((l) => /^\w+::/.test(l)) ?? "")?.[1] : null;
  if (!sym) return [`${s.file} is not listed in sound/direct_sound_data.inc, so the game does not include it`];
  const groups = new Map<string, string>(); // voice group -> its text
  for (const f of walk(join(game, "sound/voicegroups"))) { const t = text(f); for (const m of t.matchAll(/^voice_group\s+(\w+)/gm)) groups.set(m[1]!, t); }
  const direct = [...groups].filter(([, t]) => new RegExp(`\\b${sym}\\b`).test(t)).map(([g]) => g);
  const using = [...groups].filter(([g, t]) => direct.includes(g) || direct.some((d) => new RegExp(`\\bvoicegroup_${d}\\b`).test(t))).map(([g]) => g); // one level of groups inside groups
  const songs = [...cfgLines(text(join(game, CFG)))].filter(([, o]) => using.includes(parseOptions(o).voicegroup ?? "")).map(([l]) => l);
  const cry = new RegExp(`\\b${sym}\\b`).test(text(join(game, "sound/cry_tables.inc")).replace(/^[^\n]*::/gm, "")) || s.kind === "cry";
  return [`in the game as ${sym}`, ...(cry ? ["a cry: played when its creature appears or is looked up"] : []),
    direct.length ? `an instrument in ${direct.length} voice groups: ${direct.slice(0, 12).join(", ")}${direct.length > 12 ? "..." : ""}` : "not an instrument in any voice group",
    ...(songs.length ? [`${songs.length} songs and effects are built with those groups: ${songs.slice(0, 12).join(", ")}${songs.length > 12 ? "..." : ""}`] : [])];
}

// ---- listening ----
export const ROUTE = "recorded from the built game by the headless emulator: the game's own instruments, as of the last build";
/** A .wav a person can listen to. Songs and effects are recorded from the built game; samples and cries are their own files. */
export function render(game: string, s: Sound, o: { seconds?: number; out?: string } = {}): { file: string; route: string; note: string } {
  const out = o.out ? resolve(o.out) : null;
  if (s.kind === "sample" || s.kind === "cry") {
    const src = join(game, s.file!);
    if (/\.wav$/i.test(src)) { if (out) copyFileSync(src, out); return { file: out ?? src, route: "the sample file itself, as it is in the tree", note: "" }; }
    const to = out ?? join(game, "out/music", `${s.name.replace(/\W+/g, "-")}.wav`); mkdirSync(dirname(to), { recursive: true });
    if (!Bun.which("ffmpeg") || !sh([...FFMPEG, "-i", src, to]).ok) throw new Error(`${s.file} is not a .wav and ffmpeg could not convert it. Open the file itself.`);
    return { file: to, route: "the sample file, converted to .wav by ffmpeg", note: "" };
  }
  const rom = join(game, "out/game.gba"), emu = join(KIT, "emu/bin/studio-emu");
  if (!existsSync(rom) || !existsSync(rom.replace(/\.gba$/, ".sym"))) throw new Error("Songs are recorded from the built game, and it has not been built yet. Run: kit build");
  if (!existsSync(emu)) throw new Error(`Songs are recorded with the headless emulator, and it is not built. Run: bash ${join(KIT, "emu/build.sh")}   (kit status says what it needs)`);
  const table = text(join(game, "data/script_cmd_table.inc")), cmds = [...table.matchAll(/^\s*script_cmd_table_entry\s+\S+\s+ScrCmd_(\w+)/gm)].map((m) => m[1]!);
  const op = (n: string) => { const i = (cmds.length ? cmds : [...table.matchAll(/^\s*\.4byte\s+ScrCmd_(\w+)/gm)].map((m) => m[1]!)).indexOf(n); if (i < 0) throw new Error(`This game's script commands have no "${n}", so the kit cannot start a song in it.`); return i; };
  const hex = (...b: number[]) => b.map((x) => (x & 255).toString(16).padStart(2, "0")).join(""), n = s.number!;
  const secs = Math.min(600, Math.max(1, o.seconds ?? (s.seconds === null ? 30 : s.kind === "effect" ? s.seconds + 1 : Math.min(s.seconds + (s.loops ? 6 : 2), 150))));
  const wav = out ?? join(game, "out/music", `${s.label}-${Math.round(secs * 10)}.wav`), stale = s.file && mtime(join(game, s.file)) > mtime(rom) || mtime(join(game, CFG)) > mtime(rom);
  const note = stale ? "The song's file or the options file changed after the last build, so this may still be the old sound. Run: kit build" : "";
  if (!out && mtime(wav) > mtime(rom)) return { file: wav, route: ROUTE, note };
  mkdirSync(dirname(wav), { recursive: true });
  const quiet = hex(op("playbgm"), 0, 0, 0, op("end")), start = s.kind === "song" ? hex(op("playbgm"), n, n >> 8, 0, op("end")) : hex(op("playse"), n, n >> 8, op("end")); // the field's own music is stopped first
  const r = Bun.spawnSync([process.execPath, join(KIT, "drive.ts"), "bytes", quiet, "wait", "120", "audio", `${wav}.part`, "bytes", start, "wait", String(Math.round(secs * 60)), "audio", "off"], { cwd: game, env: childEnv({ GAME_DIR: game, ROM: rom }), stdout: "pipe", stderr: "pipe", timeout: 300_000, killSignal: "SIGKILL" }); // the emulator runs many times faster than the game: this long means it is stuck
  if (r.exitCode !== 0 || !existsSync(`${wav}.part`)) throw new Error(`The recording failed: ${(r.stderr.toString() || r.stdout.toString()).trim().split("\n").pop()}`);
  renameSync(`${wav}.part`, wav);
  return { file: wav, route: ROUTE, note };
}
/** A smaller copy for a browser, when ffmpeg is there; else the .wav itself. */
export function compact(wav: string): string {
  const to = wav.replace(/\.wav$/, ".m4a");
  if (mtime(to) > mtime(wav)) return to;
  if (Bun.which("ffmpeg") && sh([...FFMPEG, "-i", wav, "-ar", "44100", "-c:a", "aac", "-b:a", "160k", to]).ok) return to;
  rmSync(to, { force: true }); return wav;
}

// ---- replacing ----
export type ReplaceOptions = { voicegroup?: string; volume?: string; priority?: string; reverb?: string; rate?: string; keepLoop?: boolean; force?: boolean };
/** Puts the user's file in place of a song, effect, sample or cry. Throws a plain reason when the result would not build or would not sound. */
export function replace(game: string, s: Sound, fileArg: string, o: ReplaceOptions = {}): string[] {
  const file = resolve(fileArg), ext = extname(file).toLowerCase(), lines: string[] = [], tmp = mkdtempSync(join(tmpdir(), "kit-music-"));
  if (!existsSync(file)) throw new Error(`There is no file at ${file}.`);
  const backup = (rel: string) => { // an uncommitted earlier version is not in git yet: set it aside
    if (sh(["git", "-C", game, "diff", "--quiet", "HEAD", "--", rel]).ok && sh(["git", "-C", game, "ls-files", "--error-unmatch", rel]).ok) return `git -C ${game} checkout HEAD -- ${rel}`;
    const to = join(game, "out/music/replaced", `${Date.now()}-${basename(rel)}`); mkdirSync(dirname(to), { recursive: true }); copyFileSync(join(game, rel), to); return `cp ${to} ${join(game, rel)}   (it had changes not kept in git, so a copy was set aside)`;
  };
  try {
    if (s.kind === "song" || s.kind === "effect") {
      if (ext !== ".mid" && ext !== ".midi") throw new Error(`${s.name} is a ${s.kind}: notes played on the game's instruments, built from a MIDI file. Give a .mid file${[".wav", ".aif", ".mp3", ".flac", ".ogg"].includes(ext) ? `; a recording cannot stand in for it. To change how its instruments sound, replace a sample (kit music --kind sample), and kit music where <sample> says which songs use it` : ""}.`);
      if (!s.file || !s.options) throw new Error(`${s.name} has no MIDI file and options line in ${CFG} (it is written by hand or empty), so there is nothing to put yours in place of.`);
      let bytes = new Uint8Array(readFileSync(file)), m = readMidi(bytes); const old = (() => { try { return readMidi(readFileSync(join(game, s.file!))); } catch { return null; } })();
      if (!m.tracks) throw new Error("it has no notes in it");
      if (m.hanging) throw new Error(`${m.hanging} of its notes start and never stop; the converter refuses that. Export it again with every note ended`);
      if (s.tracks && m.tracks > s.tracks && !o.force) throw new Error(`it has ${m.tracks} parts (one per track and channel that plays notes) and the game plays ${s.name} on a player with ${s.tracks} track${s.tracks > 1 ? "s" : ""}: the rest would be silent. Merge or drop parts down to ${s.tracks}, or add --force to accept that`);
      if (o.keepLoop && !m.loops && old?.loops) { bytes = loopWhole(bytes, m); m = readMidi(bytes); lines.push("Your file has no loop marks, so the whole of it was set to repeat (a \"[\" at its start and a \"]\" at its end)."); }
      let raw = s.options.raw; const set = (flag: string, v: string) => { raw = new RegExp(`(^|\\s)-${flag}\\S*`).test(raw) ? raw.replace(new RegExp(`(^|\\s)-${flag}\\S*`), `$1-${flag}${v}`) : `${raw} -${flag}${v}`; };
      const num = (what: string, v: string, max: number) => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`--${what} is a whole number from 0 to ${max}; got "${v}"`); return n; };
      if (o.voicegroup !== undefined) {
        const g = o.voicegroup.replace(/^voicegroup/, "").replace(/^_/, ""), all = walk(join(game, "sound/voicegroups")).map(text).join("\n") + text(join(game, "sound/voice_groups.inc"));
        const suffix = new RegExp(`^\\s*voice_group\\s+${g}\\b`, "m").test(all) || new RegExp(`\\bvoicegroup_${g}::`).test(all) ? `_${g}` : /^\d+$/.test(g) && new RegExp(`\\bvoicegroup${g.padStart(3, "0")}::`).test(all) ? g.padStart(3, "0") : null;
        if (!suffix) throw new Error(`there is no voice group "${g}" in sound/voicegroups. The groups are the files there; a song's group is shown by kit music`);
        set("G", suffix);
      }
      if (o.volume !== undefined) set("V", String(num("volume", o.volume, 127)).padStart(3, "0"));
      if (o.priority !== undefined) set("P", String(num("priority", o.priority, 255)));
      if (o.reverb !== undefined) set("R", String(num("reverb", o.reverb, 127)));
      const tool = join(game, "tools/mid2agb/mid2agb"), size = (mid: Uint8Array | Buffer, opts: string, dir: string): number | null => { // convert and assemble aside, as the build will
        mkdirSync(join(tmp, dir)); writeFileSync(join(tmp, dir, `${s.label}.mid`), mid);
        const c = sh([tool, join(tmp, dir, `${s.label}.mid`), join(tmp, dir, `${s.label}.s`), ...opts.split(/\s+/).filter(Boolean)]);
        if (!c.ok) throw new Error(`the game's converter refuses it: ${c.out.split("\n").pop()}`);
        const a = sh(["arm-none-eabi-as", "-mcpu=arm7tdmi", "-I", "sound", "-o", join(tmp, dir, "o.o"), join(tmp, dir, `${s.label}.s`)], game);
        if (!a.ok) { if (/not found|ENOENT/.test(a.out) || !Bun.which("arm-none-eabi-as", { PATH: TOOL_PATH })) return null; throw new Error(`the converted song does not assemble: ${a.out.split("\n").find((l) => /rror/.test(l)) ?? a.out.split("\n").pop()}`); }
        return Number(sh(["arm-none-eabi-size", join(tmp, dir, "o.o")]).out.split("\n")[1]?.trim().split(/\s+/)[3] ?? NaN) || null;
      };
      let before: number | null = null, after: number | null = null;
      if (existsSync(tool)) { after = size(bytes, raw, "new"); try { before = size(readFileSync(join(game, s.file)), s.options.raw, "old"); } catch {} }
      else lines.push("The game's converter is not built yet (it is built by the first kit build), so the file was checked by the kit's own reading only.");
      const undo = [backup(s.file)]; writeFileSync(join(game, s.file), bytes);
      if (raw !== s.options.raw) { const cfg = text(join(game, CFG)), was = new RegExp(`^(${s.label}\\.mid:[ \\t]*).*$`, "m"); undo.push(backup(CFG)); writeFileSync(join(game, CFG), cfg.replace(was, (_, head) => head + raw)); lines.push(`Build options: ${s.options.raw}  ->  ${raw}`); }
      lines.unshift(`${s.name} is now ${basename(file)}: ${clock(m.seconds)}, ${m.tracks} part${m.tracks > 1 ? "s" : ""}${s.tracks ? ` (its player has ${s.tracks} tracks)` : ""}, ${m.loops ? `repeats from ${clock(m.loopFrom!)}` : s.kind === "song" ? "NO loop marks: it plays once and then there is silence (add markers named [ and ] in your editor, or run this again with --keep-loop)" : "plays once"}.`);
      lines.push(`Its instruments are the voice group ${parseOptions(raw).voicegroup ?? "dummy"}: the program numbers in your file (${m.programs.join(", ") || "none: all parts play program 0"}) pick the instrument in each slot of sound/voicegroups/${parseOptions(raw).voicegroup ?? "dummy"}.inc.`);
      lines.push(after !== null ? `Size in the game: ${after} bytes${before !== null ? ` (was ${before}, ${after - before >= 0 ? "+" : ""}${after - before})` : ""}.` : "Size in the game: not measured (the game's compiler is not on this computer's path).");
      lines.push(`To take it back: ${undo.join("   and   ")}`);
    } else {
      if (ext === ".mid" || ext === ".midi") throw new Error(`${s.name} is a ${s.kind}: a recording. Give a .wav file (one channel).`);
      const cry = s.kind === "cry", flags = cry ? ["-b", "-c", "-l", "1", "--no-pad"] : ["-b"], dst = join(game, s.file!), ff = Bun.which("ffmpeg");
      if (!/\.wav$/i.test(dst)) throw new Error(`${s.file} is not a .wav in this tree, and the kit only replaces .wav samples.`);
      const old = (() => { try { return readWav(readFileSync(dst)); } catch { return null; } })(); let w: ReturnType<typeof readWav> | null = null; try { w = readWav(readFileSync(file)); } catch (e) { if (ext === ".wav" || !ff) throw e; }
      if (!w && !ff) throw new Error("it is not a .wav file, and ffmpeg is not installed to convert it");
      const want = o.rate !== undefined ? Number(o.rate) : Math.min(w?.rate ?? Infinity, old?.rate ?? 22050);
      if (!Number.isInteger(want) || want < 2000 || want > 48000) throw new Error(`--rate is samples per second, from 2000 to 48000; got "${o.rate}"`);
      const plain = w && w.channels === 1 && w.format === 1 && (w.bits === 8 || w.bits === 16) && w.rate === want; let bytes: Uint8Array;
      if (plain) bytes = new Uint8Array(readFileSync(file));
      else {
        if (!ff) throw new Error(`it is ${w!.channels} channels, ${w!.bits} bit, ${w!.rate} Hz; the game takes one channel, 8 or 16 bit, and ffmpeg is not installed to convert it. Export it as mono 16 bit at ${want} Hz`);
        const c = sh([...FFMPEG, "-i", file, "-ac", "1", "-ar", String(want), "-c:a", "pcm_u8", "-map_metadata", "-1", "-bitexact", join(tmp, "n.wav")]);
        if (!c.ok) throw new Error(`ffmpeg could not read it: ${c.out.split("\n").pop()}`);
        bytes = new Uint8Array(readFileSync(join(tmp, "n.wav"))); lines.push(`Converted to one channel, 8 bit, ${want} Hz${w ? ` (yours was ${w.channels} channel${w.channels > 1 ? "s" : ""}, ${w.bits} bit, ${w.rate} Hz)` : ""}: the console plays 8 bit sound, and the file it replaces was ${old?.rate ?? "?"} Hz. --rate <n> keeps more, at one byte per sample.`);
      }
      const now = readWav(bytes), scale = w ? now.frames / w.frames : 1;
      if (now.seconds > 60 && !o.force) throw new Error(`it is ${Math.round(now.seconds)} seconds long, about ${now.frames} bytes in the game. A sample is one note or one hit; a whole track belongs in a song. Add --force if you mean it`);
      if (!plain && w?.loop) bytes = withLoop(bytes, w.key, Math.round(w.loop[0] * scale), Math.min(now.frames - 1, Math.round(w.loop[1] * scale)));
      else if (!now.loop && old?.loop && o.keepLoop && !cry) { bytes = withLoop(bytes, w?.key ?? 60, 0, now.frames - 1); lines.push("Your file has no loop points, so the whole of it was set to repeat while a note is held."); }
      else if (!now.loop && old?.loop && !cry) lines.push("The sample it replaces repeats while a note is held and yours has no loop points, so long notes will stop when it ends (set loop points in your editor, or run this again with --keep-loop to repeat the whole of it).");
      const tool = join(game, "tools/wav2agb/wav2agb"); let after: number | null = null;
      if (existsSync(tool)) { writeFileSync(join(tmp, "new.wav"), bytes); const c = sh([tool, ...flags, join(tmp, "new.wav"), join(tmp, "new.bin")]); if (!c.ok) throw new Error(`the game's converter refuses it: ${c.out.split("\n").pop()}`); after = statSync(join(tmp, "new.bin")).size; }
      else lines.push("The game's converter is not built yet (it is built by the first kit build), so the file was checked by the kit's own reading only.");
      const bin = dst.replace(/\.wav$/i, ".bin"), before = existsSync(bin) ? statSync(bin).size : null, undo = backup(s.file!); writeFileSync(dst, bytes);
      lines.unshift(`${s.name} is now ${basename(file)}: ${now.seconds.toFixed(2)} s at ${now.rate} Hz, one channel${cry ? ", stored compressed" : ""}.`);
      lines.push(after !== null ? `Size in the game: ${after} bytes${before !== null ? ` (was ${before}, ${after - before >= 0 ? "+" : ""}${after - before})` : ""}.` : "Size in the game: not measured.");
      if (!cry) lines.push(`Every song and effect that uses this instrument changes with it: kit music where ${s.name}`);
      lines.push(`To take it back: ${undo}`);
    }
  } catch (e) { throw new Error(`Nothing was changed. ${/^[a-z]/.test((e as Error).message) ? `${basename(file)}: ` : ""}${(e as Error).message}`); }
  finally { rmSync(tmp, { recursive: true, force: true }); }
  lines.push("Rebuild to hear it in the game: kit build");
  return lines;
}

// ---- the command ----
export const MUSIC_HELP = `kit music [--kind song|effect|sample|cry] [--yours] [--json]   every song and effect (number, file, voice group, volume, length, where it is map music) and the samples
  kit music play <name> [--seconds n]            record it from the built game and play it on this computer (samples and cries: the file itself)
  kit music render <name> [--out file.wav] [--seconds n]   the same recording as a .wav file, without playing it
  kit music where <name>                         the maps, scripts and code that play it; for a sample, the instruments and songs that use it
  kit music replace <name> <file.mid|.wav> [--voicegroup g] [--volume 0-127] [--keep-loop] [--rate n] [--force]
                             your file in place of a song or effect (.mid) or a sample or cry (.wav); checked first, refused with the reason if it would not build`;
export function musicCommand(game: string, args: string[]): number {
  const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i < 0 ? undefined : args.splice(i, 2)[1]; }, flag = (n: string) => { const i = args.indexOf(`--${n}`); if (i >= 0) args.splice(i, 1); return i >= 0; };
  const asJson = flag("json"), kind = opt("kind") as Kind | undefined, yours = flag("yours"), seconds = opt("seconds"), out = opt("out");
  const o: ReplaceOptions = { voicegroup: opt("voicegroup"), volume: opt("volume"), priority: opt("priority"), reverb: opt("reverb"), rate: opt("rate"), keepLoop: flag("keep-loop"), force: flag("force") };
  const [what, name, file] = args;
  try {
    if (kind && !["song", "effect", "sample", "cry"].includes(kind)) throw new Error(`--kind is one of song, effect, sample, cry; got "${kind}"`);
    if (!what || what === "list") {
      const all = listSounds(game, kind).filter((s) => !yours || s.yours);
      if (asJson) { console.log(JSON.stringify(all, null, 1)); return 0; }
      const count = (k: Kind) => all.filter((s) => s.kind === k).length, shown = kind || yours ? all : all.filter((s) => s.kind === "song" || s.kind === "effect");
      console.log(shown.map(soundText).join("\n"));
      console.log(`${count("song")} songs, ${count("effect")} effects, ${count("sample")} samples, ${count("cry")} cries; ${all.filter((s) => s.yours).length} changed since the game folder's first commit (marked yours).${kind || yours ? "" : "\nSamples and cries: kit music --kind sample   kit music --kind cry"}\nListen: kit music play <name>, or the Music tab of the pane.`);
      return 0;
    }
    if (!["play", "render", "where", "replace"].includes(what)) throw new Error(`kit music has no "${what}".\n  ${MUSIC_HELP}`);
    if (!name) throw new Error(`kit music ${what} needs a name as kit music prints it, for example a song's constant.`);
    const s = findSound(game, name);
    if (what === "where") { console.log(`${soundText(s).trim()}\n${whereHeard(game, s).join("\n")}`); return 0; }
    if (what === "replace") { if (!file) throw new Error("kit music replace needs the file to put in its place: kit music replace <name> <file.mid|.wav>"); console.log(replace(game, s, file, o).join("\n")); return 0; }
    if (seconds !== undefined && !(Number(seconds) > 0)) throw new Error(`--seconds is a number of seconds; got "${seconds}"`);
    const r = render(game, s, { seconds: seconds === undefined ? undefined : Number(seconds), out });
    console.log(`sound: ${r.file}\nroute: ${r.route}${r.note ? `\n${r.note}` : ""}`);
    if (what === "play") {
      const player = env.ROM_STUDIO_AUDIO_PLAYER ? [env.ROM_STUDIO_AUDIO_PLAYER] : Bun.which("ffplay") ? ["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet"] : Bun.which("aplay") ? ["aplay", "-q"] : null;
      if (!player) console.log("No player found on this computer (ffplay or aplay): open the file, or use the Music tab of the pane.");
      else console.log(Bun.spawnSync([...player, r.file], { env: childEnv(), stdout: "ignore", stderr: "ignore" }).exitCode === 0 ? `played with ${player[0]}` : `${player[0]} could not play it here (no sound device?): open the file, or use the Music tab of the pane.`);
    }
    return 0;
  } catch (e) { console.error(`kit music: ${(e as Error).message}`); return 1; }
}
