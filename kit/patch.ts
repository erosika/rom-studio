// kit/patch.ts: a BPS patch from the original game file to the built game, and applying one to check it.
// BPS is the format common patching programs read. The patch holds only the bytes the original does not have;
// for everything else it says where to copy from in the receiver's own original, so no original art travels.

const TABLE = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function crc32(b: Uint8Array, end = b.length): number { let c = -1; for (let i = 0; i < end; i++) c = TABLE[(c ^ b[i]!) & 255]! ^ (c >>> 8); return (c ^ -1) >>> 0; }

class Out {
  buf: Uint8Array; n = 0;
  constructor(size: number) { this.buf = new Uint8Array(size); }
  room(k: number) { if (this.n + k > this.buf.length) { const b = new Uint8Array(Math.max(this.buf.length * 2, this.n + k)); b.set(this.buf.subarray(0, this.n)); this.buf = b; } }
  byte(x: number) { this.room(1); this.buf[this.n++] = x; }
  bytes(b: Uint8Array) { this.room(b.length); this.buf.set(b, this.n); this.n += b.length; }
  num(v: number) { for (;;) { const x = v % 128; v = Math.floor(v / 128); if (v === 0) { this.byte(0x80 | x); return; } this.byte(x); v--; } } // BPS numbers
  signed(v: number) { this.num(Math.abs(v) * 2 + (v < 0 ? 1 : 0)); }
  u32(v: number) { for (let i = 0; i < 4; i++) this.byte((v >>> (8 * i)) & 255); }
}

const HB = 22, K = 8, DEPTH = 24, MIN = 8, GOOD = 4096; // hash bits, bytes hashed, candidates tried, shortest copy, long enough to stop looking
function hash(b: Uint8Array, i: number): number {
  const lo = b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24), hi = b[i + 4]! | (b[i + 5]! << 8) | (b[i + 6]! << 16) | (b[i + 7]! << 24);
  return (Math.imul(lo, 0x9e3779b1) ^ Math.imul(hi ^ (lo >>> 15), 0x85ebca77)) >>> (32 - HB);
}

/** Greedy: at each place take the longest of: same place in the original, anywhere in the original, earlier in the new game; else a new byte. */
export function makeBps(src: Uint8Array, dst: Uint8Array): { patch: Uint8Array; literal: number } {
  const o = new Out(Math.min(dst.length, 1 << 24) + 64);
  o.bytes(new TextEncoder().encode("BPS1")); o.num(src.length); o.num(dst.length); o.num(0);
  const sHead = new Int32Array(1 << HB).fill(-1), sPrev = new Int32Array(Math.max(src.length, 1));
  for (let i = 0; i + K <= src.length; i++) { const h = hash(src, i); sPrev[i] = sHead[h]!; sHead[h] = i; }
  const tHead = new Int32Array(1 << HB).fill(-1), tPrev = new Int32Array(Math.max(dst.length, 1));
  let pos = 0, lit = 0, done = 0, sRel = 0, tRel = 0, literal = 0;
  const flush = () => { if (pos > lit) { o.num((pos - lit - 1) * 4 + 1); o.bytes(dst.subarray(lit, pos)); literal += pos - lit; } };
  while (pos < dst.length) {
    const max = dst.length - pos; let len = 0, mode = 0, from = 0;
    if (pos < src.length) { const m = Math.min(max, src.length - pos); let n = 0; while (n < m && src[pos + n] === dst[pos + n]) n++; if (n >= MIN) len = n; }
    if (len < GOOD && pos + K <= dst.length) {
      const h = hash(dst, pos);
      for (let c = sHead[h]!, d = 0; c >= 0 && d < DEPTH && len < GOOD; c = sPrev[c]!, d++) {
        const m = Math.min(max, src.length - c); let n = 0; while (n < m && src[c + n] === dst[pos + n]) n++;
        if (n >= MIN && n > len) { len = n; mode = 2; from = c; }
      }
      for (; done < pos && done + K <= dst.length; done++) { const g = hash(dst, done); tPrev[done] = tHead[g]!; tHead[g] = done; }
      for (let c = tHead[h]!, d = 0; c >= 0 && d < DEPTH && len < GOOD; c = tPrev[c]!, d++) {
        let n = 0; while (n < max && dst[c + n] === dst[pos + n]) n++;
        if (n >= MIN && n > len) { len = n; mode = 3; from = c; }
      }
    }
    if (!len) { pos++; continue; }
    flush(); o.num((len - 1) * 4 + mode);
    if (mode === 2) { o.signed(from - sRel); sRel = from + len; }
    if (mode === 3) { o.signed(from - tRel); tRel = from + len; }
    pos += len; lit = pos;
  }
  flush();
  o.u32(crc32(src)); o.u32(crc32(dst)); o.u32(crc32(o.buf, o.n));
  return { patch: o.buf.slice(0, o.n), literal };
}

/** Applies a BPS patch to the original; throws with a plain reason when it does not fit. */
export function applyBps(patch: Uint8Array, src: Uint8Array): Uint8Array {
  const fail = (why: string): never => { throw new Error(why); };
  if (patch.length < 19 || new TextDecoder().decode(patch.subarray(0, 4)) !== "BPS1") fail("this is not a BPS patch");
  const u32 = (i: number) => (patch[i]! | (patch[i + 1]! << 8) | (patch[i + 2]! << 16) | (patch[i + 3]! << 24)) >>> 0, end = patch.length - 12;
  if (crc32(patch, patch.length - 4) !== u32(patch.length - 4)) fail("the patch file is damaged (its own check number does not match)");
  if (crc32(src) !== u32(end)) fail("it was made from a different original game file (the original's check number does not match)");
  let p = 4;
  const num = () => { let v = 0, s = 1; for (;;) { if (p >= end) fail("the patch file is damaged (it ends early)"); const x = patch[p++]!; v += (x & 127) * s; if (x & 128) return v; s *= 128; v += s; } };
  const srcSize = num(), dstSize = num(), meta = num(); p += meta; // not p += num(): p would be read before num() moves it
  if (srcSize !== src.length) fail(`it was made from an original of ${srcSize} bytes, and this one has ${src.length}`);
  if (dstSize > 1 << 26) fail("the patch file is damaged (it says the game is larger than any cartridge)");
  const out = new Uint8Array(dstSize); let o = 0, sRel = 0, tRel = 0;
  while (p < end) {
    const d = num(), len = Math.floor(d / 4) + 1, mode = d % 4;
    if (o + len > dstSize) fail("the patch file is damaged (it writes past the end)");
    if (mode === 0) out.set(src.subarray(o, o + len), o);
    else if (mode === 1) { out.set(patch.subarray(p, p + len), o); p += len; }
    else {
      const r = num(), off = (r % 2 ? -1 : 1) * Math.floor(r / 2);
      if (mode === 2) { sRel += off; out.set(src.subarray(sRel, sRel + len), o); sRel += len; }
      else { tRel += off; for (let i = 0; i < len; i++) out[o + i] = out[tRel + i]!; tRel += len; }
    }
    o += len;
  }
  if (o !== dstSize || crc32(out) !== u32(end + 4)) fail("the result is not the game the patch was made from");
  return out;
}
