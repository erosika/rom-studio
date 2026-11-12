// kit/png.ts: the smallest PNG writer and reader the kit needs (RGB out; indexed or grey in), plus a 3x5 label font.
import { deflateSync, inflateSync } from "node:zlib";

/** RGBA pixels (w*h*4) -> PNG bytes, each pixel enlarged `scale` times. Alpha is dropped. */
export function encodePng(rgba: Uint8Array, w: number, h: number, scale = 1): Uint8Array {
  const W = w * scale, H = h * scale, raw = new Uint8Array(H * (W * 3 + 1));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = (Math.floor(y / scale) * w + Math.floor(x / scale)) * 4, d = y * (W * 3 + 1) + 1 + x * 3;
    raw[d] = rgba[s]!; raw[d + 1] = rgba[s + 1]!; raw[d + 2] = rgba[s + 2]!;
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0); out.write(type, 4, "latin1"); out.set(data, 8);
    out.writeUInt32BE(Bun.hash.crc32(out.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]);
}

/** Indexed or grey PNG (1, 2, 4 or 8 bits) -> one colour index per pixel. Tile sheets are stored this way. */
export function decodeIndexed(file: Uint8Array, name = "picture"): { w: number; h: number; px: Uint8Array } {
  const b = Buffer.from(file), idat: Buffer[] = [];
  let w = 0, h = 0, depth = 0, type = 0;
  for (let p = 8; p < b.length; ) {
    const len = b.readUInt32BE(p), kind = b.toString("latin1", p + 4, p + 8), data = b.subarray(p + 8, p + 8 + len);
    if (kind === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]!; type = data[9]!; if (data[12]) throw new Error(`${name}: interlaced pictures are not supported`); }
    if (kind === "IDAT") idat.push(data);
    p += 12 + len;
  }
  if ((type !== 3 && type !== 0) || depth > 8) throw new Error(`${name}: expected an indexed picture of 16 colours, got colour type ${type}, ${depth} bits`);
  const raw = inflateSync(Buffer.concat(idat)), stride = Math.ceil((w * depth) / 8), px = new Uint8Array(w * h), cur = new Uint8Array(stride), prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!, row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) { // undo the row filter (one byte per pixel or less, so "left" is the previous byte)
      const a = i ? cur[i - 1]! : 0, up = prev[i]!, c = i ? prev[i - 1]! : 0, pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c);
      cur[i] = (row[i]! + (f === 1 ? a : f === 2 ? up : f === 3 ? (a + up) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? up : c) : 0)) & 255;
    }
    for (let x = 0; x < w; x++) { const v = (cur[(x * depth) >> 3]! >> (8 - depth - ((x * depth) & 7))) & ((1 << depth) - 1); px[y * w + x] = type === 0 && depth === 8 ? v >> 4 : v; }
    prev.set(cur);
  }
  return { w, h, px };
}

// 3x5 letters: five rows of three dots per glyph, one octal digit per row
const GLYPHS: Record<string, string> = { A: "25755", B: "65656", C: "34443", D: "65556", E: "74647", F: "74644", G: "34553", H: "55755", I: "72227", J: "11152", K: "55655", L: "44447", M: "57755", N: "65555", O: "25552",
  P: "65644", Q: "25563", R: "65655", S: "34216", T: "72222", U: "55557", V: "55552", W: "55775", X: "55255", Y: "55222", Z: "71247", "0": "75557", "1": "26227", "2": "61247", "3": "61216", "4": "55711", "5": "74616",
  "6": "34757", "7": "71222", "8": "75757", "9": "75716", _: "00007", "-": "00700", ".": "00002", ">": "42124" };
/** A drawing surface over RGBA pixels: filled boxes, blended tints and small labels on a dark plate. */
export function canvas(rgba: Uint8Array, w: number, h: number) {
  const dot = (x: number, y: number, [r, g, b]: number[], a = 1) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const i = (y * w + x) * 4; rgba[i] = rgba[i]! * (1 - a) + r! * a; rgba[i + 1] = rgba[i + 1]! * (1 - a) + g! * a; rgba[i + 2] = rgba[i + 2]! * (1 - a) + b! * a; };
  const box = (x: number, y: number, bw: number, bh: number, c: number[], a = 1) => { for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) dot(x + i, y + j, c, a); };
  const frame = (x: number, y: number, bw: number, bh: number, c: number[], t = 1) => { box(x, y, bw, t, c); box(x, y + bh - t, bw, t, c); box(x, y, t, bh, c); box(x + bw - t, y, t, bh, c); };
  const label = (x: number, y: number, text: string, c: number[], s = 1) => {
    const t = text.toUpperCase(); x = Math.max(0, Math.min(x, w - (t.length * 4 + 1) * s)); y = Math.max(0, Math.min(y, h - 7 * s));
    box(x, y, (t.length * 4 + 1) * s, 7 * s, [0, 0, 0], 0.75);
    [...t].forEach((ch, k) => (GLYPHS[ch] ?? "00000").split("").forEach((row, j) => { for (let i = 0; i < 3; i++) if (Number(row) & (4 >> i)) box(x + (k * 4 + 1 + i) * s, y + (1 + j) * s, s, s, c); }));
  };
  return { dot, box, frame, label };
}
