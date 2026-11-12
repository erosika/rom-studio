// player/checks.test.ts: what the play page says and decides, and that the guard is the only way to its screen. Run: bun test player/checks
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GAME_FPS, advice, buildOfName, fileName, lacks, lacksSaves, namingMax, namingTextOffset, pace, pointProblem, saveProblem } from "./checks.js";
import { findRam, frameCandidates, signature, stateBytes, stillCounting } from "./ram.js";

const fine = { wasm: true, secure: true, isolated: true, shared: true, webgl: true, storage: true };

test("a browser or an address that cannot run the emulator is told why, in one sentence each", () => {
  expect(lacks(fine)).toBeNull();
  expect(lacks({ ...fine, wasm: false })).toContain("WebAssembly");
  expect(lacks({ ...fine, secure: false, isolated: false })).toContain("https link"); // a plain http address on the network
  expect(lacks({ ...fine, isolated: false })).toContain("shared memory");
  expect(lacks({ ...fine, shared: false })).toContain("shared memory");
  expect(lacks({ ...fine, webgl: false })).toContain("WebGL");
  expect(lacksSaves(fine)).toBeNull(); expect(lacksSaves({ storage: false })).toContain("Export");
});

test("pace: the emulator's speed against the display, and when it counts as slow", () => {
  const two = (o: object) => ({ ms: 2000, frames: Math.round(GAME_FPS * 2), shows: 120, drawn: 120, cost: 240, gap: 18, held: 0, ...o });
  const good = pace(two({}));
  expect(good.slow).toBe(false); expect(good.line).toBe("game 100% · screen 60 Hz · 60 pictures a second · 2.0 ms each · longest wait 18 ms · guard held 0");
  expect(pace(two({ shows: 240 })).slow).toBe(false); // a 120 Hz display is still fed 60 pictures
  const slow = pace(two({ frames: 100 })); expect(slow.slow).toBe(true); expect(slow.why).toBe("the game is running at 84% of its speed");
  expect(pace(two({ frames: 100 }), { sound: true }).line).toContain("sound drifts 9.8 s a minute");
  expect(pace(two({ drawn: 60 })).why).toBe("only 30 pictures a second reach the screen");
  expect(pace(two({ drawn: 60 }), { lowPower: true }).slow).toBe(false); // low power shows every other picture on purpose
  expect(pace(two({ gap: 400 })).why).toBe("the picture stopped for 400 ms");
  const unknown = pace(two({ frames: null })); expect(unknown.slow).toBe(false); expect(unknown.line).toStartWith("game speed not known here");
  expect(advice("x", false)).toContain("Low power (under saves and settings)"); expect(advice("x", true)).toContain("already on");
});

test("a file is taken as the game's save or as a save point only when it can be one", () => {
  const save = new Uint8Array(131072).fill(0xff); save[10] = 1;
  expect(saveProblem(save)).toBeNull(); expect(saveProblem(new Uint8Array([...save, ...new Uint8Array(16)]))).toBeNull(); // with another emulator's clock at the end
  expect(saveProblem(new Uint8Array(1000))).toContain("not a save");
  expect(saveProblem(new Uint8Array(131072).fill(0xff))).toBe("That save file is empty.");
  const small = new Uint8Array(32768); small[0] = 9; expect(saveProblem(small, 131088)).toContain("another game"); expect(saveProblem(save, 131088)).toBeNull();
  expect(pointProblem(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0]))).toBeNull(); expect(pointProblem(new Uint8Array(0x61000))).toBeNull();
  expect(pointProblem(save)).toContain("not a save point");
  const at = new Date(2026, 10, 12, 14, 2).getTime();
  expect(fileName("save", "abc123", "0badf00d", at)).toBe("save-abc123-0badf00d-20261112-1402.sav");
  expect(buildOfName(fileName("point", "abc123", "0badf00d", at))).toBe("0badf00d"); expect(buildOfName("renamed.ss1")).toBeNull();
});

test("the naming screen's text is found from the engine's source, and its length from the game file; anything unsure gives nothing", () => {
  const three = "struct NamingScreenData\n{\n    u8 tilemapBuffer1[0x800];\n    u8 tilemapBuffer2[0x800]; // a note\n    u8 tilemapBuffer3[0x800];\n    u8 textBuffer[16];\n    u8 state;\n};";
  expect(namingTextOffset(three)).toBe(0x1800);
  expect(namingTextOffset("struct NamingScreenData {\n u8 tilemapBuffers[4][0x800];\n u8 textBuffer[16];\n};")).toBe(0x2000);
  expect(namingTextOffset("struct NamingScreenData {\n u8 a[SOME_COUNT];\n u8 textBuffer[16];\n};")).toBeNull(); // a size that is not a plain number
  expect(namingTextOffset("struct NamingScreenData {\n u16 a[4];\n u8 textBuffer[16];\n};")).toBeNull();
  expect(namingTextOffset("struct Other { u8 textBuffer[16]; };")).toBeNull();
  const rom = new Uint8Array(0x200), tpl = 0x100; rom.set([1, 7, 2, 1, 0, 0, 0, 0, 0x40, 0, 0, 0x08], tpl); // copies the old name, 7 letters, title in the game file
  const words = [0, 0, 0, 0, 0x08000003, 0x08000150, 0x12345678, 0x08000000 + tpl], read = (a: number, n: number) => (a - 0x08000000 + n <= rom.length ? rom.subarray(a - 0x08000000, a - 0x08000000 + n) : null);
  expect(namingMax((i: number) => words[i] ?? 0, read)).toBe(7); // an odd address and one that points at something else are passed over
  expect(namingMax(() => 0, read)).toBeNull();
});

test("the game's memory and the frame counter are found in the emulator's memory, not in a copy of the save point left behind", async () => {
  const state = new Uint8Array(0x61000), dv = new DataView(state.buffer);
  dv.setUint32(0, 0x01000007, true); dv.setUint32(4, 0xbaadf00d, true); dv.setUint32(0x1fc, 4321, true);
  for (let i = 0; i < 4096; i++) state[0x21000 + 0x300 + i] = (i * 37 + (i >> 3)) & 0xff; // the game's memory: empty, then something
  expect(signature(state)).toBeGreaterThanOrEqual(0x21000 + 0x300);
  const heap = new Uint8Array(0x100000), words = new Uint32Array(heap.buffer);
  heap.set(state, 0x1000); // the copy the emulator made to write the save point: found first, and not it
  const live = 0x80000; heap.set(state.subarray(0x21000), live); words[0x70000 >> 2] = 4321; words[0x70010 >> 2] = 4321;
  expect(findRam(heap, state)).toBe(live);
  const { frame, found } = frameCandidates(heap, state); expect(frame).toBe(4321); expect(found).toEqual([(0x1000 + 0x1fc) >> 2, 0x70000 >> 2, 0x70010 >> 2]);
  words[0x70000 >> 2] = 4335; words[0x70010 >> 2] = 99999; // one is the counter, 14 frames on; one was something else
  expect(stillCounting(heap, found, frame)).toEqual([0x70000 >> 2]);
  expect(findRam(new Uint8Array(0x100000), state)).toBe(-1);
  // as the emulator keeps it: a picture with the packed bytes in a private part
  const packed = new Uint8Array(await new Response(new Blob([state]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const chunk = (type: string, body: Uint8Array) => { const c = new Uint8Array(12 + body.length); new DataView(c.buffer).setUint32(0, body.length); c.set([...type].map((ch) => ch.charCodeAt(0)), 4); c.set(body, 8); return c; };
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", new Uint8Array(13)), ...chunk("gbAs", packed), ...chunk("IEND", new Uint8Array(0))]);
  expect(await stateBytes(png)).toEqual(state); expect(await stateBytes(state)).toBe(state);
  expect(await stateBytes(new Uint8Array(100))).toBeNull(); expect(await stateBytes(png.subarray(0, 40))).toBeNull();
});

test("the guard is the only way to the visible screen, and nothing switches it off", () => {
  const page = readFileSync(join(import.meta.dir, "play.js"), "utf8"), html = readFileSync(join(import.meta.dir, "index.html"), "utf8");
  const draws = [...page.matchAll(/\bout\.(putImageData|drawImage|fillRect|fillText|strokeRect|clearRect)\(/g)].map((m) => m[1]);
  expect(draws).toEqual(["putImageData"]); // one place puts a picture on the visible canvas
  expect(page).toMatch(/guard\.step\([^;]*shown\.data\);\s*out\.putImageData\(shown, 0, 0\);/); // and it is the guarded picture
  expect(page).not.toMatch(/videoFrame(Ended|Started)Callback\s*:/); // counting frames that way makes the emulator wait for the page
  expect(html).toMatch(/#emu \{[^}]*opacity: 0;/); // what the emulator draws is never seen
  expect(html.toLowerCase()).not.toMatch(/id="[^"]*guard|guard[^<]{0,40}type="checkbox"/); // no control for it
  expect(html).toMatch(/animation: none !important; transition: none !important/);
  expect(html).toMatch(/<script type="module" src="\/play\.js" onerror="older\(\)">/); // a page whose parts cannot be fetched says so
});
