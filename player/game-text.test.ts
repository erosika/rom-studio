// The game's own characters for a name typed on the page (the naming screen's box).
import { expect, test } from "bun:test";
import { EOS, encodeLabel, normalize, tableFrom } from "./game-text.js";

const CHARMAP = ["' ' = 00", ...[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((c, i) => `'${c}' = ${(0xbb + i).toString(16).toUpperCase()}`),
  ...[..."abcdefghijklmnopqrstuvwxyz"].map((c, i) => `'${c}' = ${(0xd5 + i).toString(16).toUpperCase()}`),
  "'.' = AD", "',' = B8", "'…' = B0", "'’' = B4", "'“' = B1", "'”' = B2", "'\\n' = FE", "'\\p' = FB", "'-' = AE", "':' = F0"].join("\n");
const table = tableFrom(CHARMAP, "const u8 gFontNormalLatinGlyphWidths[] = {\n" + Array(256).fill(6).join(", ") + "\n};");

test("only characters the game can draw, layout marks are not characters; a name is cut to fit with its end mark", () => {
  expect(table.chars["n"]).toBe(0xd5 + 13);
  expect("\n" in table.chars).toBe(false);
  expect(normalize("Héllo *there* — it's “fine”.", table)).toBe("Hllo there - it’s “fine”.");
  const m = encodeLabel("Héllo *there*", table);
  expect(m.at(-1)).toBe(EOS);
  expect([...m].every((b) => b === EOS || Object.values(table.chars).includes(b))).toBe(true);
  expect([...encodeLabel("A very long label indeed", table)].length).toBe(16);
  expect([...encodeLabel("ERIKA", table, 8)].length).toBe(6);
});
