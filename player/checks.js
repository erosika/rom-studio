// What the play page says and decides, kept apart from the page so it can be tested: what the browser lacks, how
// the game is keeping time, whether a file is a save, and what a saved file is called. No DOM here.
export const GAME_FPS = 59.7275; // pictures a second the original machine makes

/** One plain sentence when this browser or this address cannot run the emulator, else null. */
export function lacks(env) {
  if (!env.wasm) return "This browser cannot run the emulator (it has no WebAssembly). Use a current Safari, Chrome or Firefox.";
  if (!env.secure) return "This address cannot run the emulator. On the computer open http://127.0.0.1 as printed; on a phone open the https link that `kit play --phone` printed.";
  if (!env.isolated || !env.shared) return "This browser did not give the page the shared memory the emulator needs. Open the link as it was printed (not inside another app's built-in browser), or update the browser.";
  if (!env.webgl) return "This browser has its graphics (WebGL) switched off, which the emulator draws with. Switch it on or try another browser.";
  return null;
}
/** A second line when the game can run but something smaller is missing. */
export function lacksSaves(env) {
  return env.storage ? null : "This browser keeps nothing for this page (private browsing?): saves and save points last only until the page is closed. Export them to keep them.";
}

/** How the last stretch went. `s`: ms, frames (the emulator's, or null when not known), shows (times the display asked), drawn (pictures put on screen), cost (ms spent on them), gap (longest wait between two asks), held (regions the guard held back). */
export function pace(s, o = {}) {
  const secs = s.ms / 1000, hz = s.shows / secs, drawn = s.drawn / secs, speed = s.frames === null ? null : s.frames / secs / GAME_FPS;
  const want = Math.min(o.lowPower ? 30 : 60, hz), each = s.drawn ? s.cost / s.drawn : 0;
  const slowGame = speed !== null && speed < 0.95, slowScreen = hz > 5 && drawn < want * 0.8, uneven = s.gap > 120;
  const parts = [speed === null ? "game speed not known here" : `game ${Math.round(speed * 100)}%`, `screen ${Math.round(hz)} Hz`, `${Math.round(drawn)} pictures a second`, `${each.toFixed(1)} ms each`, `longest wait ${Math.round(s.gap)} ms`, `guard held ${s.held}`];
  if (o.sound && speed !== null && Math.abs(speed - 1) > 0.005) parts.push(`sound drifts ${Math.abs((speed - 1) * 60).toFixed(1)} s a minute`);
  return { speed, hz, drawn, each, slow: slowGame || slowScreen || uneven, line: parts.join(" · "),
    why: slowGame ? `the game is running at ${Math.round(speed * 100)}% of its speed` : slowScreen ? `only ${Math.round(drawn)} pictures a second reach the screen` : uneven ? `the picture stopped for ${Math.round(s.gap)} ms` : "" };
}
/** After this many slow stretches in a row the page says so. */
export const SLOW_RUN = 3;
export const advice = (why, lowPower) => `Slow here: ${why}. ${lowPower ? "Low power is already on; closing other tabs and apps is what is left." : "Low power (under saves and settings) asks less of this device."}`;

const SAVE_SIZES = [512, 8192, 32768, 65536, 131072];
/** Why these bytes cannot be this game's own save, or null. `now`: the size of the save the game has, when it has one. */
export function saveProblem(bytes, now = 0) {
  const n = bytes.length, plain = SAVE_SIZES.find((s) => n === s || n === s + 16); // some emulators add a 16-byte clock
  if (!plain) return `That file is not a save of this kind of game (${n} bytes; a save is 32, 64 or 128 KB).`;
  if (now && plain !== SAVE_SIZES.find((s) => now === s || now === s + 16)) return `That save is ${plain} bytes and this game's is ${now}: it belongs to another game.`;
  if (bytes.every((b) => b === 0xff) || bytes.every((b) => b === 0)) return "That save file is empty.";
  return null;
}
/** Why these bytes cannot be a save point of this emulator, or null. */
export function pointProblem(bytes) {
  const png = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  return png || bytes.length === 0x61000 ? null : "That file is not a save point made by this player.";
}

const two = (n) => String(n).padStart(2, "0");
export const clock = (ms) => { const d = new Date(ms); return `${two(d.getHours())}:${two(d.getMinutes())}`; };
/** "save-<game>-<build>-20261112-1402.sav": the build is in the name because a save point only fits its own build. */
export function fileName(kind, id, build, ms) {
  const d = new Date(ms);
  return `${kind === "point" ? "savepoint" : "save"}-${id}-${build}-${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}.${kind === "point" ? "ss1" : "sav"}`;
}
/** The build a save point's file name says it was made on, or null when the name was changed. */
export const buildOfName = (name) => /^savepoint-[0-9a-z]+-([0-9a-f]{8})-/.exec(name)?.[1] ?? null;

/** Where the text being typed sits in the naming screen's memory, from the engine's own source: only when everything before it is a plain byte array. */
export function namingTextOffset(source) {
  const body = /struct\s+NamingScreenData\s*\{([^}]*)\}/.exec(source)?.[1]; if (!body) return null;
  let at = 0;
  for (const line of body.split(";").map((l) => l.replace(/\/\/.*$/gm, "").trim()).filter(Boolean)) {
    const m = /^u8\s+(\w+)((?:\[\s*(?:0x[0-9a-fA-F]+|\d+)\s*\])+)$/.exec(line); if (!m) return null;
    if (m[1] === "textBuffer") return at;
    at += [...m[2].matchAll(/\[\s*(0x[0-9a-fA-F]+|\d+)\s*\]/g)].reduce((a, d) => a * Number(d[1]), 1);
  }
  return null;
}
/** The naming screen's own rules, read from the game: looks through the screen's memory after the text for the
 *  address of its template in the game file. `word(i)` is the i-th 32-bit word after the text; `rom(addr, n)` reads the game file. */
export function namingMax(word, rom, words = 0x200) {
  for (let i = 4; i < words; i++) { // the text itself is 16 bytes
    const p = word(i); if (p < 0x08000000 || p >= 0x0a000000 || p & 3) continue;
    const t = rom(p, 12); if (!t) continue;
    const title = (t[8] | (t[9] << 8) | (t[10] << 16) | (t[11] << 24)) >>> 0;
    if (t[0] <= 1 && t[1] >= 1 && t[1] <= 15 && t[2] < 16 && t[3] <= 1 && t[4] < 8 && title >= 0x08000000 && title < 0x0a000000) return t[1];
  }
  return null;
}
