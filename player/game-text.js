// Words -> the game's own text bytes, wrapped to its message box by its own glyph widths. Used by the page
// (hermes-link.js), the server (which builds the table from the game folder) and the tests. No DOM here.
// A box holds two lines: line 1, 0xFE, line 2, then 0xFB for the next box; 0xFF ends the text.
export const NEWLINE = 0xfe, PARAGRAPH = 0xfb, EOS = 0xff;
export const BOX_WIDTH = 208; // pixels of text per line of the message box
export const TEXT_MAX = 1000, CHOICES_MAX = 6, CHOICE_LEN = 16; // the mailbox's sizes (the base's link source)

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

function wrap(paragraph, table) { // lines that fit the box; a word wider than a line is cut
  const width = (c) => table.widths[table.chars[c]] ?? 6, of = (s) => [...s].reduce((a, c) => a + width(c), 0);
  const lines = []; let line = "", lineW = 0;
  for (let word of paragraph.split(" ").filter(Boolean)) {
    while (of(word) > BOX_WIDTH) {
      let cut = 0, acc = 0;
      for (const c of word) { if (acc + width(c) > BOX_WIDTH) break; acc += width(c); cut += c.length; }
      if (line) lines.push(line);
      lines.push(word.slice(0, cut)); line = ""; lineW = 0; word = word.slice(cut);
    }
    if (!word) continue;
    const next = line ? lineW + width(" ") + of(word) : of(word);
    if (next <= BOX_WIDTH) { line = line ? `${line} ${word}` : word; lineW = next; }
    else { lines.push(line); line = word; lineW = of(word); }
  }
  if (line) lines.push(line);
  return lines;
}

/** One or more messages, each at most maxBytes with its end mark, cut only between boxes. maxLines cuts with a "…". */
export function encodeMessages(text, table, maxBytes = TEXT_MAX, maxLines = Infinity) {
  let lines = text.split(/\r?\n/).map((p) => normalize(p, table)).filter(Boolean).flatMap((p) => wrap(p, table));
  if (!lines.length) lines = ["…"].filter((c) => c in table.chars);
  if (lines.length > maxLines) { lines = lines.slice(0, maxLines); if ("…" in table.chars) lines[lines.length - 1] += "…"; }
  const messages = []; let cur = [];
  for (let i = 0; i < lines.length; i += 2) { // one box at a time
    const box = [...[...lines[i]].map((c) => table.chars[c]), ...(lines[i + 1] !== undefined ? [NEWLINE, ...[...lines[i + 1]].map((c) => table.chars[c])] : [])];
    if (cur.length && cur.length + 1 + box.length + 1 > maxBytes) { messages.push(Uint8Array.from([...cur, EOS])); cur = []; }
    cur.push(...(cur.length ? [PARAGRAPH] : []), ...box.slice(0, maxBytes - 1));
  }
  messages.push(Uint8Array.from([...cur, EOS]));
  return messages;
}

/** One short menu label: no wrapping, cut to fit, with its end mark. */
export function encodeLabel(text, table, maxBytes = CHOICE_LEN) {
  return Uint8Array.from([...[...normalize(text, table)].slice(0, maxBytes - 1).map((c) => table.chars[c]), EOS]);
}

/** A run of lines "1. …", "2. …" (two to four) in a reply becomes a menu in the game; the rest is the message. */
export function splitReply(reply) {
  const options = [], rest = [];
  for (const line of reply.split(/\r?\n/)) {
    const m = /^\s*(\d)[.)]\s+(.+?)\s*$/.exec(line);
    if (m && Number(m[1]) === options.length + 1 && options.length < 4) options.push(m[2]); else rest.push(line);
  }
  return options.length < 2 ? { text: reply, options: [] } : { text: rest.join("\n").trim() || "…", options };
}
