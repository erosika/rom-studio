// The in-game link's text: the game's own characters, wrapped to its box, long answers split between boxes.
import { expect, test } from "bun:test";
import { EOS, NEWLINE, PARAGRAPH, TEXT_MAX, encodeLabel, encodeMessages, splitReply, tableFrom } from "./game-text.js";

const CHARMAP = ["' ' = 00", ...[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((c, i) => `'${c}' = ${(0xbb + i).toString(16).toUpperCase()}`),
  ...[..."abcdefghijklmnopqrstuvwxyz"].map((c, i) => `'${c}' = ${(0xd5 + i).toString(16).toUpperCase()}`),
  "'.' = AD", "',' = B8", "'…' = B0", "'’' = B4", "'“' = B1", "'”' = B2", "'\\n' = FE", "'\\p' = FB", "'-' = AE", "':' = F0"].join("\n");
const table = tableFrom(CHARMAP, "const u8 gFontNormalLatinGlyphWidths[] = {\n" + Array(256).fill(6).join(", ") + "\n};");

test("only characters the game can draw, layout marks are not characters", () => {
  expect(table.chars["n"]).toBe(0xd5 + 13);
  const [m] = encodeMessages("Héllo *there* — it's “fine”.", table);
  expect([...m!].includes(EOS)).toBe(true);
  expect(m!.at(-1)).toBe(EOS);
  expect([...m!].every((b) => b === EOS || b === NEWLINE || b === PARAGRAPH || Object.values(table.chars).includes(b))).toBe(true);
});

test("two lines to a box, wrapped by width", () => {
  const [m] = encodeMessages("word ".repeat(40), table); // 34 characters of width 6 fit a 208-pixel line
  const lines = String.fromCharCode(...m!.slice(0, -1)).split(/[\xfe\xfb]/);
  expect(lines.every((l) => l.length <= 34)).toBe(true);
  expect([...m!].filter((b) => b === NEWLINE).length).toBeGreaterThan(1);
  expect([...m!].indexOf(NEWLINE)).toBeLessThan([...m!].indexOf(PARAGRAPH)); // line, line, next box
});

test("a long answer becomes several messages, cut between boxes, each within the mailbox", () => {
  const parts = encodeMessages("word ".repeat(900), table);
  expect(parts.length).toBeGreaterThan(1);
  for (const p of parts) { expect(p.length).toBeLessThanOrEqual(TEXT_MAX); expect(p.at(-1)).toBe(EOS); expect(p[0]).not.toBe(PARAGRAPH); }
  const words = parts.flatMap((p) => String.fromCharCode(...p.slice(0, -1)).split(/[\xfe\xfb\x00]/)).filter(Boolean).length;
  expect(words).toBe(900); // nothing lost at the cuts
});

test("the player's own words are cut to one box", () => {
  const [m, ...rest] = encodeMessages("word ".repeat(100), table, TEXT_MAX, 2);
  expect(rest.length).toBe(0);
  expect([...m!].includes(PARAGRAPH)).toBe(false);
  expect(m!.at(-2)).toBe(table.chars["…"]);
});

test("numbered lines become a menu and leave the message", () => {
  expect(splitReply("Sure.\n1. Read mail\n2. Check build\nSay which.")).toEqual({ text: "Sure.\nSay which.", options: ["Read mail", "Check build"] });
  expect(splitReply("1. only one").options).toEqual([]);
  expect([...encodeLabel("A very long label indeed", table)].length).toBe(16);
});
