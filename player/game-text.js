// Words -> the game's own text bytes. Used by the page (a name typed for the game's naming screen), the server
// (which builds the table from the game folder) and the tests. No DOM here. 0xFF ends a text.
// (Wrapping words into the message box and reading menus out of an agent's reply went with the Hermes link,
// taken out in 0.3.0.)
export const EOS = 0xff, LABEL_MAX = 16;

/** The table from the game's own files: charmap.txt (which characters it can draw) and src/fonts.c (how wide). */
export function tableFrom(charmap, fonts = "") {
  const chars = {};
  for (const m of charmap.matchAll(/^'(\\?.)'\s*=\s*([0-9A-Fa-f]{2})\s*(?:@.*)?$/gmu)) {
    if (m[1].length === 2 && m[1] !== "\\'" && m[1] !== "\\\\") continue; // '\n', '\p', '\l' are layout marks, not characters
    const ch = m[1].length === 2 ? m[1][1] : m[1];
    if (!(ch in chars) && parseInt(m[2], 16) < 0xf7) chars[ch] = parseInt(m[2], 16);
  }
  const w = /gFontNormalLatinGlyphWidths\[\]\s*=\s*\{([^}]*)\}/.exec(fonts);
  const widths = w ? w[1].split(",").map((n) => parseInt(n, 10)).filter((n) => !Number.isNaN(n)) : [];
  return { chars, widths };
}

export function normalize(text, table) {
  let s = text.normalize("NFC").replace(/\.\.\./g, "…").replace(/[–—]/g, "-").replace(/[*_#>|~^`]/g, "");
  if (!("'" in table.chars)) s = s.replace(/['‘]/g, "’");
  if (!('"' in table.chars)) s = s.replace(/"([^"]*)"/g, "“$1”").replace(/"/g, "");
  return [...s.replace(/\s+/g, " ").trim()].filter((c) => c in table.chars).join("");
}

/** One short text (a name): no wrapping, cut to fit, with its end mark. */
export function encodeLabel(text, table, maxBytes = LABEL_MAX) {
  return Uint8Array.from([...[...normalize(text, table)].slice(0, maxBytes - 1).map((c) => table.chars[c]), EOS]);
}
