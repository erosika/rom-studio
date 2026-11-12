// The game's memory and the emulator's frame counter, found once inside the emulator's own memory. The emulator
// offers neither, and its per-frame callback is no way to count: it makes the emulator wait for the page each frame.
// One save point is made while the game is held still; its bytes say what the game's memory holds at that moment
// and which frame it is, and both are then looked for in the emulator's memory. No DOM here except the unpacking.
const HEAD = 16, FRAME = 0x1fc, WRAM = 0x21000, WRAM_SIZE = 0x40000, STATE_SIZE = WRAM + WRAM_SIZE; // the emulator's save point layout
const EWRAM = 0x02000000, SIGN = 32;

/** The save point's own bytes: it is kept as a picture with the bytes in a private part, packed. Null when it is neither that nor plain. */
export async function stateBytes(file) {
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (file.length < 8 || dv.getUint32(0) !== 0x89504e47) return file.length === STATE_SIZE ? file : null;
  for (let p = 8; p + 12 <= file.length;) {
    const len = dv.getUint32(p), type = String.fromCharCode(...file.subarray(p + 4, p + 8));
    if (type === "gbAs") {
      const raw = new Uint8Array(await new Response(new Blob([file.subarray(p + 8, p + 8 + len)]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
      return raw.length === STATE_SIZE ? raw : null;
    }
    p += 12 + len;
  }
  return null;
}

const same = (a, at, b, from, n) => { for (let i = 0; i < n; i++) if (a[at + i] !== b[from + i]) return false; return true; };
/** Where a stretch of the game's memory with enough variety starts in the save point (a multiple of 4), or -1. */
export function signature(state) {
  for (let o = WRAM; o + SIGN <= STATE_SIZE; o += 4) {
    if (state[o] === state[o + 1] && state[o] === state[o + 2] && state[o] === state[o + 3]) continue; // skips empty memory quickly
    if (new Set(state.subarray(o, o + SIGN)).size >= 12) return o;
  }
  return -1;
}
/** Where the game's working memory starts in the emulator's memory (a byte offset), or -1. A copy of the whole save point left behind is not it. */
export function findRam(heap, state) {
  const o = signature(state); if (o < 0) return -1;
  const words = new Uint32Array(heap.buffer, 0, heap.byteLength >>> 2), first = new DataView(state.buffer, state.byteOffset).getUint32(o, true);
  for (let i = words.indexOf(first); i !== -1; i = words.indexOf(first, i + 1)) {
    const at = i * 4, start = at - o, base = at - (o - WRAM); // start: where the save point would begin if this were a copy of it
    if (base < 0 || base + WRAM_SIZE > heap.length || !same(heap, at, state, o, SIGN)) continue;
    if (start >= 0 && same(heap, start, state, 0, HEAD)) continue;
    let whole = true; for (let k = 0x40; k < WRAM_SIZE && whole; k += 0x1000) whole = same(heap, base + k, state, WRAM + k, 8); // all of it lines up, not one stretch that repeats
    if (whole) return base;
  }
  return -1;
}
/** Every place in the emulator's memory that holds the save point's frame number (word indexes; at most `most`). */
export function frameCandidates(heap, state, most = 20000) {
  const words = new Uint32Array(heap.buffer, 0, heap.byteLength >>> 2), frame = new DataView(state.buffer, state.byteOffset).getUint32(FRAME, true), found = [];
  for (let i = words.indexOf(frame); i !== -1 && found.length < most; i = words.indexOf(frame, i + 1)) found.push(i);
  return { frame, found };
}
/** Of those places, the ones that have since gone forward like a frame counter does. */
export const stillCounting = (heap, places, from, most = 600) => { const words = new Uint32Array(heap.buffer, 0, heap.byteLength >>> 2); return places.filter((i) => words[i] > from && words[i] - from <= most); };

/** Looks once. Gives { frames(), read(addr, n), write(addr, bytes), ok } for the game's working memory (0x02000000 up), or null when it cannot be found here. */
export async function probe(emu, memory, slot = 8) {
  if (!memory || typeof DecompressionStream !== "function") return null;
  const file = `${emu.filePaths().saveStatePath}/${emu.gameName.split("/").pop().replace(/\.[^.]+$/, "")}.ss${slot}`, wait = (ms) => new Promise((d) => setTimeout(d, ms));
  const heap = () => new Uint8Array(memory.buffer);
  emu.pauseGame(); await wait(60); // held still: the save point and the memory say the same thing
  let state = null, base = -1, counting = { frame: 0, found: [] };
  try {
    if (emu.saveState(slot)) state = await stateBytes(emu.FS.readFile(file));
    if (state) { base = findRam(heap(), state); counting = frameCandidates(heap(), state); }
  } finally { try { emu.FS.unlink(file); } catch {} emu.resumeGame(); }
  if (!state) return null;
  let places = counting.found, from = counting.frame;
  for (let i = 0; i < 4 && places.length > 1; i++) { await wait(250); places = stillCounting(heap(), places, from); }
  if (places.length && places.length === counting.found.length) { await wait(250); places = stillCounting(heap(), places, from); } // a single place still has to have moved
  const counter = places.length ? places[0] : -1, inRam = (addr, n) => base >= 0 && addr >= EWRAM && addr + n <= EWRAM + WRAM_SIZE;
  return {
    ok: base >= 0, counts: counter >= 0,
    frames: () => (counter >= 0 ? new Uint32Array(memory.buffer, counter * 4, 1)[0] : null),
    read: (addr, n) => (inRam(addr, n) ? heap().slice(base + addr - EWRAM, base + addr - EWRAM + n) : null),
    write: (addr, bytes) => { if (!inRam(addr, bytes.length)) return false; heap().set(bytes, base + addr - EWRAM); return true; },
  };
}
