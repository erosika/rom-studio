// kit/music.test.ts: kit music end to end against a small made-up tree, and against a real built game when one is beside the checkout. Run: bun test kit
import { afterAll, beforeAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSounds, readMidi, readWav } from "./music";
import { musicRoute } from "../pane/music";

const game = mkdtempSync(join(tmpdir(), "music-test-")), files = mkdtempSync(join(tmpdir(), "music-files-"));
const kit = (...a: string[]) => { const r = Bun.spawnSync(["bun", join(import.meta.dir, "kit.ts"), "music", ...a, "--game", game]); return { ok: r.exitCode === 0, out: r.stdout.toString() + r.stderr.toString() }; };
const put = (rel: string, body: string | Uint8Array) => { mkdirSync(join(game, rel, ".."), { recursive: true }); writeFileSync(join(game, rel), body); };
const track = (...b: number[]) => [0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, b.length, ...b];
/** A one-bar song: `parts` channels each playing one note, with loop marks if asked. */
function midi(parts: number, loop: boolean): Uint8Array {
  const lead = track(0, 0xff, 0x51, 3, 7, 0xa1, 0x20, ...(loop ? [0, 0xff, 6, 1, 0x5b, 0x83, 0, 0xff, 6, 1, 0x5d] : []), 0, 0xff, 0x2f, 0);
  const notes = Array.from({ length: parts }, (_, ch) => track(0, 0xc0 | ch, 5, 0, 0x90 | ch, 60, 100, 0x83, 0, 0x80 | ch, 60, 0, 0, 0xff, 0x2f, 0));
  return new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, parts + 1, 0, 96, ...lead, ...notes.flat()]);
}
function wav(channels: number, bits: number, rate: number, frames: number): Uint8Array {
  const n = frames * channels * (bits / 8), b = new Uint8Array(44 + n), dv = new DataView(b.buffer);
  b.set([0x52, 0x49, 0x46, 0x46], 0); dv.setUint32(4, 36 + n, true); b.set([0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20], 8);
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, channels, true); dv.setUint32(24, rate, true); dv.setUint32(28, rate * channels * (bits / 8), true);
  dv.setUint16(32, channels * (bits / 8), true); dv.setUint16(34, bits, true); b.set([0x64, 0x61, 0x74, 0x61], 36); dv.setUint32(40, n, true);
  for (let i = 44; i < b.length; i++) b[i] = bits === 8 ? 128 + Math.round(60 * Math.sin(i / 5)) : (i * 37) & 255;
  return b;
}

beforeAll(() => {
  put("Makefile", ""); put("game.md", "# My game\n");
  put("include/constants/songs.h", "#define MUS_HARBOUR 0\n#define FIRST_SONG 0\n#define SE_CLICK 1\n#define MUS_EMPTY 2\n");
  put("sound/song_table.inc", "gSongTable::\n\tsong mus_harbour, MUSIC_PLAYER_BGM, 0\n\tsong se_click, MUSIC_PLAYER_SE1, 1\n\tsong mus_empty, MUSIC_PLAYER_BGM, 0\n");
  put("sound/music_player_table.inc", "\t.equiv NUM_TRACKS_BGM, 4\n\t.equiv NUM_TRACKS_SE1, 1\n");
  put("sound/songs/midi/midi.cfg", "mus_harbour.mid:   -E -R50 -G_harbour -V080\nse_click.mid:      -E -G_clicks -V100 -P5\n");
  put("sound/songs/midi/mus_harbour.mid", midi(2, true)); put("sound/songs/midi/se_click.mid", midi(1, false));
  put("sound/voicegroups/harbour.inc", "voice_group harbour\n\tvoice_directsound 60, 0, DirectSoundWaveData_bell, 255, 0, 255, 0\n"); put("sound/voicegroups/clicks.inc", "voice_group clicks\n");
  put("sound/direct_sound_data.inc", "DirectSoundWaveData_bell::\n\t.incbin \"sound/direct_sound_samples/bell.bin\"\n");
  put("sound/direct_sound_samples/bell.wav", wav(1, 8, 8000, 4000)); put("sound/direct_sound_samples/cries/gull.wav", wav(1, 8, 8000, 2000));
  put("data/maps/HarbourTown/map.json", '{ "id": "MAP_HARBOUR_TOWN", "music": "MUS_HARBOUR" }'); put("data/maps/HarbourTown/scripts.inc", "\tplayse SE_CLICK\n");
  for (const a of [["init", "-q"], ["add", "-A"], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first"]]) Bun.spawnSync(["git", "-C", game, ...a]);
  writeFileSync(join(files, "tune.mid"), midi(3, false)); writeFileSync(join(files, "wide.mid"), midi(6, true)); writeFileSync(join(files, "cut.mid"), midi(3, true).subarray(0, 40));
  writeFileSync(join(files, "hit.wav"), wav(1, 8, 8000, 1000)); writeFileSync(join(files, "stereo.wav"), wav(2, 16, 44100, 8000));
});
afterAll(() => { rmSync(game, { recursive: true, force: true }); rmSync(files, { recursive: true, force: true }); });

test("the list reads names, numbers, build options, lengths and map music from the tree", () => {
  const all = JSON.parse(kit("--json").out), song = all.find((s: any) => s.name === "MUS_HARBOUR");
  expect(all.map((s: any) => `${s.kind} ${s.name}`)).toEqual(["song MUS_HARBOUR", "effect SE_CLICK", "song MUS_EMPTY", "sample bell", "cry cries/gull"]);
  expect(song).toMatchObject({ number: 0, file: "sound/songs/midi/mus_harbour.mid", tracks: 4, loops: true, seconds: 2, yours: false, heard: ["HarbourTown"], options: { voicegroup: "harbour", volume: 80, reverb: 50 } });
  expect(kit("where", "SE_CLICK").out).toContain("data/maps/HarbourTown/scripts.inc:1");
  expect(kit("where", "bell").out).toMatch(/voice groups: harbour[\s\S]*mus_harbour/);
});

test("a refused file changes nothing and says why", () => {
  const before = readFileSync(join(game, "sound/songs/midi/mus_harbour.mid"));
  for (const [name, file, why] of [["MUS_HARBOUR", "hit.wav", /built from a MIDI file/], ["MUS_HARBOUR", "cut.mid", /cut short|damaged/], ["MUS_HARBOUR", "wide.mid", /6 parts.*4 tracks/], ["bell", "tune.mid", /Give a \.wav/], ["MUS_EMPTY", "tune.mid", /no MIDI file/]] as const) {
    const r = kit("replace", name, join(files, file)); expect(r.ok).toBe(false); expect(r.out).toMatch(/Nothing was changed/); expect(r.out).toMatch(why);
  }
  expect(kit("replace", "MUS_HARBOUR", join(files, "tune.mid"), "--voicegroup", "nowhere").out).toMatch(/no voice group "nowhere"/);
  expect(readFileSync(join(game, "sound/songs/midi/mus_harbour.mid")).equals(before)).toBe(true);
  expect(Bun.spawnSync(["git", "-C", game, "status", "--short", "sound"]).stdout.toString()).toBe("");
});

test("a song is replaced: the loop is kept, the options line is rewritten, the old one is in git", () => {
  const r = kit("replace", "MUS_HARBOUR", join(files, "tune.mid"), "--keep-loop", "--volume", "64", "--voicegroup", "clicks");
  expect(r.ok).toBe(true); expect(r.out).toMatch(/set to repeat/); expect(r.out).toContain("checkout HEAD -- sound/songs/midi/mus_harbour.mid");
  const m = readMidi(readFileSync(join(game, "sound/songs/midi/mus_harbour.mid")));
  expect(m).toMatchObject({ tracks: 3, loops: true, seconds: 2, loopFrom: 0, hanging: 0 });
  expect(readFileSync(join(game, "sound/songs/midi/midi.cfg"), "utf8")).toBe("mus_harbour.mid:   -E -R50 -G_clicks -V064\nse_click.mid:      -E -G_clicks -V100 -P5\n");
  expect(listSounds(game, "song")[0]).toMatchObject({ name: "MUS_HARBOUR", yours: true, options: { voicegroup: "clicks", volume: 64 } });
});

test("the pane's routes list, replace a sample and serve it for listening", async () => {
  const ask = (method: string, path: string, body?: Uint8Array) => musicRoute(new Request(`http://x${path}`, { method, body }), path.split("?")[0]!, game);
  expect((await (await ask("GET", "/music/list"))!.json()).sounds.length).toBe(5);
  expect(await ask("GET", "/state")).toBeNull();
  const no = (await ask("PUT", "/music/replace/bell?file=tune.mid", midi(1, false)))!; expect(no.status).toBe(400); expect(await no.text()).toMatch(/Give a \.wav/);
  const yes = (await ask("PUT", "/music/replace/bell?file=hit.wav", wav(1, 8, 8000, 1000)))!; expect(yes.status).toBe(200); expect((await yes.json()).lines[0]).toMatch(/bell is now hit\.wav: 0\.13 s at 8000 Hz/);
  const heard = (await ask("GET", "/music/play/bell"))!; expect(heard.headers.get("content-type")).toBe("audio/wav"); expect(readWav(new Uint8Array(await heard.arrayBuffer())).frames).toBe(1000);
  expect((await (await ask("GET", "/music/list"))!.json()).sounds.find((s: any) => s.name === "bell").yours).toBe(true);
});

test.skipIf(!Bun.which("ffmpeg"))("a stereo recording is made one channel at the rate of the sample it replaces", () => {
  const r = kit("replace", "cries/gull", join(files, "stereo.wav")); expect(r.ok).toBe(true); expect(r.out).toMatch(/Converted to one channel, 8 bit, 8000 Hz/);
  expect(readWav(new Uint8Array(readFileSync(join(game, "sound/direct_sound_samples/cries/gull.wav")))).channels).toBe(1);
});

// the recording itself needs a real built game and the headless emulator; names are read from that game, none is written here.
// It records from a copy of the last finished build, so a build going on in that folder meanwhile changes nothing here.
const real = process.env.ROM_STUDIO_GAME ?? join(import.meta.dir, "../../rom-studio-game"), PARTS = ["out/game.gba", "out/game.sym", "data/script_cmd_table.inc", "include/constants/songs.h", "sound/song_table.inc", "sound/music_player_table.inc", "sound/songs/midi"];
const stamp = () => PARTS.slice(0, 2).map((f) => { const st = statSync(join(real, f)); return `${st.size} ${st.mtimeMs}`; }).join();
const whyNot = !existsSync(join(import.meta.dir, "emu/bin/studio-emu")) ? "the headless emulator is not built" : !PARTS.every((f) => existsSync(join(real, f))) ? "there is no built game beside the checkout"
  : statSync(join(real, PARTS[1]!)).mtimeMs < statSync(join(real, PARTS[0]!)).mtimeMs ? "a build is just now putting that game's new files in place" : null; // the game file goes in first, its symbols a moment later
if (whyNot) console.log(`the recording test is skipped: ${whyNot}`);
test.skipIf(!!whyNot)("an effect is recorded from the built game, and the empty song records as silence", () => {
  const snap = join(files, "built"), before = stamp();
  for (const f of PARTS) cpSync(join(real, f), join(snap, f), { recursive: true });
  if (stamp() !== before) { console.log("the recording test is skipped: that game was rebuilt while it was being copied"); return; }
  writeFileSync(join(snap, "Makefile"), ""); writeFileSync(join(snap, "game.md"), "# My game\n"); Bun.spawnSync(["git", "-C", snap, "init", "-q"]);
  const loud = (f: string) => { const b = readFileSync(f), dv = new DataView(b.buffer, b.byteOffset, b.byteLength); let max = -32768, min = 32767; for (let i = 44; i + 1 < b.length; i += 2) { const v = dv.getInt16(i, true); max = Math.max(max, v); min = Math.min(min, v); } return (max - min) / 2; }; // swing, not level: a stopped wave channel rests at a steady offset, which is not sound
  const all = listSounds(snap), effects = all.filter((s) => s.kind === "effect" && s.file && (s.seconds ?? 0) > 0.2).slice(0, 3), empty = all.find((s) => s.kind === "song" && s.seconds === 0 && s.file);
  if (!effects.length) { console.log("the recording test is skipped: that game has no effect longer than a fifth of a second"); return; }
  const run = (name: string, out: string) => { const r = Bun.spawnSync(["bun", join(import.meta.dir, "kit.ts"), "music", "render", name, "--seconds", "2", "--out", out, "--game", snap]); return r.stdout.toString() + r.stderr.toString(); };
  let heard = 0; // one effect may be a quiet one in this game: the first of three that sounds is enough
  for (const e of effects) {
    expect(run(e.name, join(files, "effect.wav"))).toContain("recorded from the built game");
    const w = readWav(new Uint8Array(readFileSync(join(files, "effect.wav")))); expect(w.channels).toBe(2); expect(w.seconds).toBeGreaterThan(1.5);
    if ((heard = Math.max(heard, loud(join(files, "effect.wav")))) > 500) break;
  }
  expect(heard).toBeGreaterThan(500);
  if (empty) { expect(run(empty.name, join(files, "empty.wav"))).toContain("recorded from the built game"); expect(loud(join(files, "empty.wav"))).toBeLessThan(50); }
}, 120_000);
