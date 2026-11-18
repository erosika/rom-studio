// kit/pixel.test.ts: the pixel step on a picture made here: find sees a speck, edit removes it and nothing else, undo restores the file.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { colourCheck, pixelCommand, editPicture, editsFile, find, gamePalette, makeVariant, openPic, origFile, readDoc, readPal, undoPicture } from "./pixel";

// a 16 x 16 picture of 4-bit colour numbers with a three-colour palette (or the one given)
function png(px: number[][], plte = [0, 0, 0, 255, 255, 255, 200, 40, 40]): Buffer {
  const chunk = (type: string, data: Uint8Array) => { const o = Buffer.alloc(12 + data.length); o.writeUInt32BE(data.length, 0); o.write(type, 4, "latin1"); o.set(data, 8); o.writeUInt32BE(Bun.hash.crc32(o.subarray(4, 8 + data.length)) >>> 0, 8 + data.length); return o; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(16, 0); ihdr.writeUInt32BE(16, 4); ihdr.set([4, 3, 0, 0, 0], 8);
  const raw = Buffer.alloc(16 * 9); px.forEach((row, y) => row.forEach((v, x) => { raw[y * 9 + 1 + (x >> 1)]! |= x & 1 ? v : v << 4; }));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("PLTE", Buffer.from(plte)), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]);
}
const picture = () => { const px = Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => (y >= 8 ? 1 : 0))); px[3]![5] = 2; return px; };

test("find reports the one stray pixel, with its place", () => {
  const dir = mkdtempSync(join(tmpdir(), "kit-pixel-")), file = join(dir, "a.png"); writeFileSync(file, png(picture()));
  const found = find(openPic(file)).filter((f) => f.pts.length);
  expect(found.some((f) => f.kind === "speck" && f.pts[0]![0] === 5 && f.pts[0]![1] === 3 && !f.texture)).toBe(true);
});

test("find reports a small patch in a colour foreign to everything around it, and not a patch of the body's own shade", () => {
  // see-through, orange body, its darker shade, a grey-green: the 'random green squares' an owner saw on a generated creature
  const plte = [115, 197, 164, 248, 168, 32, 200, 104, 0, 96, 128, 104];
  const px: number[][] = Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => (x >= 2 && x < 14 && y >= 2 && y < 14 ? 1 : 0)));
  for (let y = 4; y < 6; y++) for (let x = 4; x < 7; x++) px[y]![x] = 3; // a 3 x 2 grey-green patch
  for (let y = 9; y < 11; y++) for (let x = 9; x < 12; x++) px[y]![x] = 2; // a 3 x 2 patch of the body's own shade
  const dir = mkdtempSync(join(tmpdir(), "kit-pixel-")), file = join(dir, "a.png"); writeFileSync(file, png(px, plte));
  const patches = find(openPic(file)).filter((f) => f.kind === "patch");
  expect(patches.length).toBe(1);
  expect(patches[0]!.pts.length).toBe(6);
  expect(patches[0]!.pts.every(([x, y]) => px[y!]![x!] === 3)).toBe(true);
});

test("edit changes only the listed pixels, keeps the palette, runs twice the same, and undo restores the file", () => {
  const dir = mkdtempSync(join(tmpdir(), "kit-pixel-")), file = join(dir, "a.png"), first = png(picture()); writeFileSync(file, first);
  writeFileSync(editsFile(file), JSON.stringify({ picture: "a.png", edits: [{ set: [5, 3, 0], why: "speck" }, { fill: [0, 15, 2, 1, 2] }, { replace: [0, 8, 16, 1, 1, 2] }, { copy: [0, 15, 2, 1, 4, 0] }] }));
  editPicture(file);
  const p = openPic(file), at = (x: number, y: number) => p.px[y * 16 + x];
  expect([at(5, 3), at(0, 15), at(1, 15), at(2, 15), at(7, 8), at(4, 0), at(5, 0), at(6, 0), at(0, 9)]).toEqual([0, 2, 2, 1, 2, 2, 2, 0, 1]);
  expect(p.palettes[0]).toEqual([[0, 0, 0], [255, 255, 255], [200, 40, 40]]);
  expect(readFileSync(origFile(file)).equals(first)).toBe(true);
  const once = readFileSync(file); editPicture(file); // again: from the kept original, not on top of itself
  expect(readFileSync(file).equals(once)).toBe(true);
  expect(readFileSync(origFile(file)).equals(first)).toBe(true);
  writeFileSync(file, png(picture().map((r, y) => r.map((v, x) => (y === 0 && x === 15 ? 2 : v))))); // the picture is rebuilt from its source
  editPicture(file);
  const q = openPic(file); expect([q.px[3 * 16 + 5], q.px[15]]).toEqual([0, 2]); // the edits are back on, and the rebuilt pixel is kept
  undoPicture(file);
  expect(openPic(file).px[15]).toBe(2); expect(openPic(file).px[3 * 16 + 5]).toBe(2); expect(existsSync(origFile(file))).toBe(false);
});

test("an edit outside the picture or the palette is refused and the picture is not written", () => {
  const dir = mkdtempSync(join(tmpdir(), "kit-pixel-")), file = join(dir, "a.png"), first = png(picture()); writeFileSync(file, first);
  for (const bad of [{ set: [16, 0, 1] }, { set: [0, 0, 3] }, { fill: [0, 0, 1, 1] }, { nothing: 1 }, { colour: [3, "#FFFFFF"] }, { colour: [1, "white"] }]) {
    writeFileSync(editsFile(file), JSON.stringify({ picture: "a.png", edits: [bad] }));
    expect(() => editPicture(file)).toThrow();
    expect(readFileSync(file).equals(first)).toBe(true);
  }
});

test("a colour edit changes what a colour number looks like, in the picture and in the palette file the game reads, and nothing else", () => {
  const game = mkdtempSync(join(tmpdir(), "kit-pixel-")), pics = join(game, "graphics/trainers/front_pics"), pals = join(game, "graphics/trainers/palettes"), src = join(game, "src/data");
  for (const d of [pics, pals, src]) mkdirSync(d, { recursive: true });
  const file = join(pics, "kass.png"), pal = join(pals, "kass.pal"), first = png(picture()), palText = "JASC-PAL\r\n0100\r\n16\r\n0 0 0\r\n255 255 255\r\n200 40 40\r\n" + "0 0 0\r\n".repeat(13);
  writeFileSync(file, first); writeFileSync(pal, palText);
  writeFileSync(join(src, "trainers.h"), 'const u32 gTrainerFrontPic_Kass[] = INCGFX_U32("graphics/trainers/front_pics/kass.png", ".4bpp.smol");\nconst u16 gTrainerPalette_Kass[] = INCGFX_U16("graphics/trainers/palettes/kass.pal", ".gbapal");\nconst u16 gObjectEventPal_Kass[] = INCGFX_U16("graphics/object_events/palettes/kass.pal", ".gbapal");\n');
  expect(gamePalette(game, file)?.pal).toBe("graphics/trainers/palettes/kass.pal");
  const draft = join(mkdtempSync(join(tmpdir(), "kit-pixel-draft-")), "kass.png"); writeFileSync(draft, first); // a draft outside the game folder
  expect(gamePalette(game, draft)).toBeNull(); // is never paired with the game's palette by its name alone
  writeFileSync(editsFile(file), JSON.stringify({ picture: "kass.png", colours: "../palettes/kass.pal", edits: [{ colour: [2, "#C0A4E8"], why: "lilac hair" }] }));
  editPicture(file);
  const p = openPic(file);
  expect(p.palettes[0]).toEqual([[0, 0, 0], [255, 255, 255], [192, 164, 232]]);
  expect(Array.from(p.px)).toEqual(Array.from(openPic(origFile(file)).px)); // no pixel moved
  expect(readPal(readFileSync(pal, "utf8"))[2]).toEqual([192, 164, 232]);
  expect(readFileSync(pal, "utf8").split("\r\n").length).toBe(palText.split("\r\n").length); // the file's shape and line ends kept
  expect(readFileSync(origFile(pal), "utf8")).toBe(palText);
  const once = [readFileSync(file), readFileSync(pal, "utf8")]; editPicture(file); // again: the same, not on top of itself
  expect(readFileSync(file).equals(once[0] as Buffer)).toBe(true); expect(readFileSync(pal, "utf8")).toBe(once[1] as string);
  undoPicture(file);
  expect(readFileSync(file).equals(first)).toBe(true); expect(readFileSync(pal, "utf8")).toBe(palText); expect(existsSync(origFile(pal))).toBe(false);
});

test("bucket fills only the pixels of one colour joined to the start, and stays inside its box", () => {
  // two separate runs of colour 1 (a sleeve and a face line drawn in the same colour), joined only corner to corner
  const px = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => 0));
  for (let y = 8; y < 16; y++) for (let x = 0; x < 16; x++) px[y]![x] = 1; // the sleeve
  for (let y = 0; y < 7; y++) px[y]![7] = 1; // the line: rows 0 to 6 of column 7
  px[7]![8] = 1; // one pixel on the sleeve's top edge, touching the line's end (7,6) only by its corner
  const dir = mkdtempSync(join(tmpdir(), "kit-pixel-")), file = join(dir, "a.png"); writeFileSync(file, png(px));
  writeFileSync(editsFile(file), JSON.stringify({ picture: "a.png", edits: [{ bucket: [3, 12, 2], why: "the sleeve" }] }));
  editPicture(file);
  let q = openPic(file);
  expect(q.px.filter((v) => v === 2).length).toBe(16 * 8 + 1); // the sleeve and the pixel joined to it side by side
  expect([0, 3, 6].map((y) => q.px[y * 16 + 7])).toEqual([1, 1, 1]); // the line, joined only by a corner, is not
  writeFileSync(editsFile(file), JSON.stringify({ picture: "a.png", edits: [{ bucket: [3, 12, 2], box: [0, 10, 16, 6] }] }));
  editPicture(file);
  q = openPic(file);
  expect(q.px.filter((v) => v === 2).length).toBe(16 * 6); // only inside the box
  expect(q.px[8 * 16 + 3]).toBe(1);
  writeFileSync(editsFile(file), JSON.stringify({ picture: "a.png", edits: [{ bucket: [3, 2, 2], box: [0, 10, 16, 6] }] }));
  expect(() => editPicture(file)).toThrow(); // a start outside its box is refused
});

test("a variant starts from its base each run, follows the base when it is redrawn, and undo makes it the base again", () => {
  const dir = mkdtempSync(join(tmpdir(), "kit-pixel-")), base = join(dir, "graphics/may.png"), dest = join(dir, "out/hoodie.png"), first = png(picture());
  mkdirSync(join(dir, "graphics")); writeFileSync(base, first);
  expect(makeVariant(base, dest)).toBe("../graphics/may.png");
  expect(readFileSync(dest).equals(first)).toBe(true);
  expect(readDoc(dest)?.base).toBe("../graphics/may.png");
  expect(() => makeVariant(base, dest)).toThrow(); // never over a picture already there
  writeFileSync(editsFile(dest), JSON.stringify({ picture: "hoodie.png", base: "../graphics/may.png", edits: [{ replace: [0, 8, 16, 8, 1, 2], why: "a red skirt" }, { colour: [2, "#2E3654"], why: "navy" }] }));
  editPicture(dest);
  let v = openPic(dest);
  expect(v.px[12 * 16]).toBe(2); expect(v.palettes[0]![2]).toEqual([46, 54, 84]); expect(existsSync(origFile(dest))).toBe(false);
  const once = readFileSync(dest); editPicture(dest); expect(readFileSync(dest).equals(once)).toBe(true); // again: from the base, not on top of itself
  expect(readFileSync(base).equals(first)).toBe(true); // the base is never written
  writeFileSync(base, png(picture().map((r, y) => r.map((x, i) => (y === 0 && i === 0 ? 2 : x))))); // the base is redrawn
  const lines = editPicture(dest).lines.join("\n");
  expect(lines).toContain("changed since the last run");
  v = openPic(dest); expect([v.px[0], v.px[12 * 16]]).toEqual([2, 2]);
  undoPicture(dest);
  expect(readFileSync(dest).equals(readFileSync(base))).toBe(true); expect(readDoc(dest)?.edits.length).toBe(2);
});

test("colours: a back pic drawn with its front pic's palette file is caught, and its own palette file clears it", () => {
  const game = mkdtempSync(join(tmpdir(), "kit-pixel-")), g = (f: string) => join(game, f);
  for (const d of ["graphics/trainers/front_pics", "graphics/trainers/back_pics", "graphics/trainers/palettes", "src/data/graphics"]) mkdirSync(g(d), { recursive: true });
  const pal = (c: number[]) => "JASC-PAL\r\n0100\r\n16\r\n" + [0, 1, 2].map((i) => `${c[i * 3]} ${c[i * 3 + 1]} ${c[i * 3 + 2]}\r\n`).join("") + "0 0 0\r\n".repeat(13);
  const front = [0, 0, 0, 255, 255, 255, 200, 40, 40], back = [0, 0, 0, 248, 216, 192, 64, 48, 80]; // a new photo's colours; the throw's own
  writeFileSync(g("graphics/trainers/front_pics/kass.png"), png(picture(), front)); writeFileSync(g("graphics/trainers/back_pics/kass.png"), png(picture(), back));
  writeFileSync(g("graphics/trainers/palettes/kass.pal"), pal(front)); writeFileSync(g("graphics/trainers/palettes/kass_back.pal"), pal(back));
  const table = (backPal: string) => writeFileSync(g("src/data/graphics/trainers.h"), [
    'const u32 gTrainerFrontPic_Kass[] = INCGFX_U32("graphics/trainers/front_pics/kass.png", ".4bpp.smol");',
    'const u32 gTrainerBackPic_Kass[] = INCGFX_U32("graphics/trainers/back_pics/kass.png", ".4bpp");',
    'const u16 gTrainerPalette_Kass[] = INCGFX_U16("graphics/trainers/palettes/kass.pal", ".gbapal");',
    'const u16 gTrainerPalette_KassBack[] = INCGFX_U16("graphics/trainers/palettes/kass_back.pal", ".gbapal");',
    "#define TRAINER_BACK_PIC(yOffset, sprite, pal, anim) {sprite, pal}",
    "    .frontPic = TRAINER_FRONT_PIC(gTrainerFrontPic_Kass, gTrainerPalette_Kass),",
    `    .backPic = TRAINER_BACK_PIC(4, gTrainerBackPic_Kass, ${backPal}, sBackAnims_Hoenn),`].join("\n"));
  table("gTrainerPalette_Kass");
  let r = colourCheck(game);
  expect(r.problems).toBe(1);
  expect(r.lines[0]).toContain("graphics/trainers/back_pics/kass.png: drawn with graphics/trainers/palettes/kass.pal");
  expect(r.lines[0]).toContain("fits graphics/trainers/front_pics/kass.png instead");
  r = colourCheck(game, [g("graphics/trainers/front_pics/kass.png")]);
  expect(r.problems).toBe(0); expect(r.lines[0]).toContain("its own colours");
  table("gTrainerPalette_KassBack");
  expect(colourCheck(game).problems).toBe(0);
  expect(colourCheck(game, [g("graphics/trainers/back_pics/kass.png")]).lines[0]).toContain("kass_back.pal");
});

test("draw puts a typed drawing in place: colour numbers where written, the picture left where a dot is", () => {
  const dir = mkdtempSync(join(tmpdir(), "kit-pixel-")), file = join(dir, "a.png"); writeFileSync(file, png(picture()));
  writeFileSync(editsFile(file), JSON.stringify({ picture: "a.png", edits: [{ draw: [4, 6], rows: [".2.", "212", ".2"], why: "a small cross" }] }));
  editPicture(file);
  const q = openPic(file), at = (x: number, y: number) => q.px[y * 16 + x];
  expect([at(4, 6), at(5, 6), at(6, 6), at(4, 7), at(5, 7), at(6, 7), at(4, 8), at(5, 8), at(6, 8)]).toEqual([0, 2, 0, 2, 1, 2, 1, 2, 1]);
  for (const bad of [{ draw: [4, 6], rows: ["2x"] }, { draw: [4, 6] }, { draw: [15, 0], rows: ["22"] }, { draw: [0, 0], rows: ["5"] }]) {
    writeFileSync(editsFile(file), JSON.stringify({ picture: "a.png", edits: [bad] }));
    expect(() => editPicture(file)).toThrow();
  }
});

test("draw with onto paints only pixels of those colours: [0] puts the drawing behind the figure", () => {
  const dir = mkdtempSync(join(tmpdir(), "kit-pixel-")), file = join(dir, "a.png"); writeFileSync(file, png(picture()));
  const before = openPic(file), was = (x: number, y: number) => before.px[y * 16 + x];
  writeFileSync(editsFile(file), JSON.stringify({ picture: "a.png", edits: [{ draw: [4, 6], rows: ["222", "222", "222"], onto: [0], why: "a wing behind her" }] }));
  editPicture(file);
  const q = openPic(file), at = (x: number, y: number) => q.px[y * 16 + x];
  for (let y = 6; y < 9; y++) for (let x = 4; x < 7; x++) expect(at(x, y)).toBe(was(x, y) === 0 ? 2 : was(x, y)); // the figure stays in front
  expect([...Array(9)].some((_, k) => was(4 + (k % 3), 6 + ((k / 3) | 0)) === 0)).toBe(true); // and the drawing did land somewhere
  for (const bad of [{ draw: [4, 6], rows: ["2"], onto: [] }, { draw: [4, 6], rows: ["2"], onto: [99] }, { draw: [4, 6], rows: ["2"], onto: "0" }]) {
    writeFileSync(editsFile(file), JSON.stringify({ picture: "a.png", edits: [bad] }));
    expect(() => editPicture(file)).toThrow();
  }
});

test("find on a variant lists only what is new since its base", () => {
  const game = mkdtempSync(join(tmpdir(), "kit-pixel-")), base = join(game, "base.png"), dest = join(game, "out/v.png");
  writeFileSync(base, png(picture())); makeVariant(base, dest); // the base has its own speck at (5,3)
  writeFileSync(editsFile(dest), JSON.stringify({ picture: "v.png", base: "../base.png", edits: [{ set: [10, 12, 2], why: "a new speck" }] }));
  editPicture(dest);
  const said: string[] = [], log = console.log, err = console.error; console.log = console.error = (s: string) => said.push(s);
  try { expect(pixelCommand(game, ["find", dest, "--json", "--out", join(game, "out/pixels")])).toBe(0); } finally { console.log = log; console.error = err; }
  const found = JSON.parse(said.join("\n"))[0].found as { kind: string; pts: number[][] }[], specks = found.filter((f) => f.kind === "speck");
  expect(specks.some((f) => f.pts.some(([x, y]) => x === 10 && y === 12))).toBe(true);
  expect(specks.some((f) => f.pts.some(([x, y]) => x === 5 && y === 3))).toBe(false); // the base's own speck is the base's drawing
  expect(existsSync(editsFile(base))).toBe(false); // nothing is written beside the base
});
