// pane/pixels.js: the Pixels tab. Open a game picture, zoom, and fix pixels by hand in the picture's own palette: pencil, fill,
// picker, undo. The find tool's marks are drawn on top. Saving writes the edits file beside the picture and the picture
// itself (the same as `kit pixel edit`). Nothing here moves or blinks. Uses h, button and $ from pane.js.
(() => {
  const box = $("tab-pixels"), bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const P = { q: "", list: null, pic: null, sheet: null, base: null, src: null, row: null, zoom: 6, tool: "pencil", colour: 1, palRow: 0, undo: [], stroke: null, marks: true, grid: true, said: "", error: "", busy: false };
  const TOOLS = [["pencil", "Pencil"], ["fill", "Fill"], ["pick", "Picker"], ["move", "Move"]];
  const canvas = h("canvas", { class: "pixels-canvas", "aria-label": "The picture, enlarged" }), small = document.createElement("canvas");

  async function ask(url, opts) { const r = await fetch(url, { cache: "no-store", ...opts }); if (!r.ok) throw new Error((await r.text()) || "The studio could not do that."); return r.json(); }
  async function loadList() { try { P.list = await ask(`pixels/list?q=${encodeURIComponent(P.q)}`); P.error = ""; } catch (e) { P.error = e.message; } draw(); }
  function take(pic, said) {
    P.pic = pic; P.sheet = bytes(pic.sheet); P.base = P.sheet.slice(); P.src = new Uint32Array(bytes(pic.src).buffer); P.row = bytes(pic.row);
    P.places = new Uint16Array(P.sheet.length); for (const s of P.src) P.places[s]++; // how many places on the picture show each pixel of the file
    P.undo = []; P.said = said || ""; P.error = ""; P.palRow = 0; P.colour = Math.min(P.colour, pic.top);
    P.zoom = Math.max(2, Math.min(P.zoom, Math.floor(4096 / Math.max(pic.w, pic.h))));
  }
  async function open(file) { P.busy = true; draw(); try { take(await ask(`pixels/open?file=${encodeURIComponent(file)}`)); location.hash = "#pixels"; } catch (e) { P.error = e.message; } P.busy = false; draw(); }
  const changed = () => { let n = 0; for (let i = 0; i < P.sheet.length; i++) if (P.sheet[i] !== P.base[i]) n++; return n; };
  async function save(note) {
    const first = new Map(); P.src.forEach((s, i) => { if (!first.has(s)) first.set(s, i); }); // a tile pixel is named by the first place that shows it
    const edits = []; for (let s = 0; s < P.sheet.length; s++) if (P.sheet[s] !== P.base[s] && first.has(s)) { const i = first.get(s); edits.push({ set: [P.pic.x0 + (i % P.pic.w), P.pic.y0 + Math.floor(i / P.pic.w), P.sheet[s]] }); }
    if (!edits.length) return;
    P.busy = true; draw();
    try { const r = await ask(`pixels/save?file=${encodeURIComponent(P.pic.file)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ edits, note }) }); take(r, `Saved ${edits.length} pixel${edits.length > 1 ? "s" : ""}. Ask your agent to build, then look at it in the game.`); }
    catch (e) { P.error = `Not saved: ${e.message}`; }
    P.busy = false; draw(); loadList();
  }
  async function back() {
    P.busy = true; draw();
    try { take(await ask(`pixels/back?file=${encodeURIComponent(P.pic.file)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), "The last save is taken back."); }
    catch (e) { P.error = e.message; }
    P.busy = false; draw(); loadList();
  }

  // ---- the picture ----
  const colourOf = (i) => (P.pic.palettes[P.row[i]] || P.pic.palettes[0])[P.sheet[P.src[i]]] || [255, 0, 255];
  function paint() {
    const { w, h: ht } = P.pic, z = P.zoom, img = new ImageData(w, ht);
    for (let i = 0; i < w * ht; i++) { const c = colourOf(i); img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255; }
    small.width = w; small.height = ht; small.getContext("2d").putImageData(img, 0, 0);
    canvas.width = w * z; canvas.height = ht * z; canvas.style.touchAction = P.tool === "move" ? "auto" : "none";
    const g = canvas.getContext("2d"); g.imageSmoothingEnabled = false; g.drawImage(small, 0, 0, w * z, ht * z);
    if (P.grid && z >= 4) { g.fillStyle = "rgba(255,255,255,0.22)"; for (let x = 8; x < w; x += 8) g.fillRect(x * z, 0, 1, ht * z); for (let y = 8; y < ht; y += 8) g.fillRect(0, y * z, w * z, 1); }
    if (P.marks) for (const f of P.pic.marks) f.pts.forEach(([x, y], k) => {
      const cx = (x - P.pic.x0 + 0.5) * z, cy = (y - P.pic.y0 + 0.5) * z, r = z * (f.texture ? 1.1 : 1.8);
      g.lineWidth = 3; g.strokeStyle = "#000"; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
      g.lineWidth = 1.5; g.strokeStyle = f.texture ? "#ffd000" : "#ff3030"; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
      if (k === 0) { g.font = "bold 12px ui-monospace, monospace"; g.fillStyle = "#000"; g.fillRect(cx + r, cy - r - 13, String(f.n).length * 8 + 4, 14); g.fillStyle = f.texture ? "#ffd000" : "#ff6060"; g.fillText(String(f.n), cx + r + 2, cy - r - 2); }
    });
  }
  const spot = (ev) => { const b = canvas.getBoundingClientRect(), x = Math.floor(((ev.clientX - b.left) / b.width) * P.pic.w), y = Math.floor(((ev.clientY - b.top) / b.height) * P.pic.h); return x < 0 || y < 0 || x >= P.pic.w || y >= P.pic.h ? -1 : y * P.pic.w + x; };
  function put(i, v) { const s = P.src[i]; if (P.sheet[s] === v) return; (P.stroke ??= []).push([s, P.sheet[s]]); P.sheet[s] = v; }
  function fill(i) {
    const { w, h: ht } = P.pic, from = P.sheet[P.src[i]], r = P.row[i]; if (from === P.colour) return;
    const todo = [i], seen = new Uint8Array(w * ht);
    while (todo.length) { const j = todo.pop(); if (seen[j] || P.row[j] !== r || P.sheet[P.src[j]] !== from) continue; seen[j] = 1; const x = j % w; if (x) todo.push(j - 1); if (x < w - 1) todo.push(j + 1); if (j >= w) todo.push(j - w); if (j < w * (ht - 1)) todo.push(j + w); }
    seen.forEach((on, j) => { if (on) put(j, P.colour); }); // marked first, painted after: a tile drawn twice cannot feed the fill its own paint
  }
  function touch(ev, first) {
    const i = spot(ev); if (i < 0) return;
    $("pixels-at").textContent = `${P.pic.x0 + (i % P.pic.w)}, ${P.pic.y0 + Math.floor(i / P.pic.w)} · colour ${P.sheet[P.src[i]]}${P.places[P.src[i]] > 1 ? ` · this tile is drawn in ${P.places[P.src[i]]} places: all of them change` : ""}`;
    if (!(ev.buttons & 1) && !first) return;
    if (P.tool === "pick") { P.colour = P.sheet[P.src[i]]; P.palRow = P.row[i]; P.tool = "pencil"; draw(); }
    else if (P.tool === "pencil") { P.palRow = P.row[i]; put(i, P.colour); paint(); }
    else if (P.tool === "fill" && first) { P.palRow = P.row[i]; fill(i); paint(); }
  }
  canvas.onpointerdown = (ev) => { if (P.tool === "move") return; ev.preventDefault(); canvas.setPointerCapture(ev.pointerId); touch(ev, true); }; // the stroke is closed on release only: a move may arrive first
  canvas.onpointermove = (ev) => touch(ev, false);
  canvas.onpointerup = canvas.onpointercancel = () => { if (P.stroke) { P.undo.push(P.stroke); P.stroke = null; draw(); } };
  function undo() { const s = P.undo.pop(); if (!s) return; for (let k = s.length - 1; k >= 0; k--) P.sheet[s[k][0]] = s[k][1]; draw(); }

  // ---- the page ----
  function chooser() {
    const q = h("input", { type: "search", id: "pixels-q", placeholder: "Search pictures: battle ascii, people, tilesets...", "aria-label": "Search the game's pictures by file name", value: P.q });
    q.oninput = () => { P.q = q.value.trim(); clearTimeout(chooser.t); chooser.t = setTimeout(async () => { await loadList(); const n = $("pixels-q"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250); };
    const row = (f, note) => h("div", { class: "pixels-file" }, button(f, () => open(f), { class: "pixels-open" }), note && h("span", { class: "quiet" }, note));
    return h("div", { class: "card stack" }, h("h2", {}, "Pixels"),
      h("p", { class: "quiet" }, "Fix a picture by hand, a pixel at a time, in its own colours. Every save is kept as a list beside the picture, so the fix is never lost if the picture is rebuilt."), q,
      P.list?.found.length ? h("div", {}, P.list.found.map((f) => row(f)), P.list.more ? h("p", { class: "quiet" }, `and ${P.list.more} more: type more of the name`) : null) : P.q ? h("p", { class: "quiet" }, P.list ? "No picture by that name." : "Looking...") : null,
      P.list?.edited.length ? h("div", {}, h("h3", {}, "Fixed by hand so far"), P.list.edited.map((f) => row(f))) : null);
  }
  function editor() {
    const pic = P.pic, n = changed(), pal = pic.palettes[P.palRow] || pic.palettes[0], note = h("input", { type: "text", id: "pixels-note", placeholder: "What this fixes (optional)", "aria-label": "A note kept with these edits", maxlength: 200 });
    const tool = (id, label) => button(label, () => { P.tool = id; draw(); }, { "aria-pressed": String(P.tool === id) });
    const zoom = (d) => button(d > 0 ? "+" : "−", () => { P.zoom = Math.max(1, Math.min(32, P.zoom + d * (P.zoom >= 8 ? 2 : 1))); draw(); }, { "aria-label": d > 0 ? "Zoom in" : "Zoom out" });
    const tick = (label, key) => { const c = h("input", { type: "checkbox" }); c.checked = P[key]; c.onchange = () => { P[key] = c.checked; paint(); }; return h("label", { class: "pixels-tick" }, c, ` ${label}`); };
    paint();
    return h("div", { class: "stack" },
      h("div", { class: "card stack" },
        h("div", { class: "pixels-bar" }, button("‹ Pictures", () => { if (!n || confirm("Leave without saving your changes?")) { P.pic = null; draw(); } }), h("b", { class: "pixels-name" }, pic.file)),
        pic.drawnAs && h("p", { class: "quiet" }, `Shown ${pic.drawnAs}.`),
        h("div", { class: "pixels-bar" }, TOOLS.map(([id, label]) => tool(id, label)), h("span", { class: "pixels-gap" }), zoom(-1), h("span", {}, `${P.zoom}×`), zoom(1), button("Undo", undo, { disabled: P.undo.length ? null : "" }), tick("marks", "marks"), tick("grid", "grid")),
        h("div", { class: "pixels-pal", role: "group", "aria-label": "The picture's palette" }, pal.map((c, i) => i > pic.top ? null : button(String(i), () => { P.colour = i; if (P.tool === "pick" || P.tool === "move") P.tool = "pencil"; draw(); },
          { class: "pixels-swatch", style: `background: rgb(${c.join(",")}); color: ${c[0] * 0.3 + c[1] * 0.6 + c[2] * 0.1 > 140 ? "#000" : "#fff"}`, "aria-pressed": String(P.colour === i), "aria-label": `Colour ${i}` })),
          pic.palettes.length > 1 && h("span", { class: "quiet" }, `palette row ${P.palRow} (follows the place you touch)`)),
        h("div", { class: "pixels-frame" }, canvas),
        h("p", { class: "quiet", id: "pixels-at" }, P.tool === "move" ? "Move: drag to scroll the picture." : " "),
        h("div", { class: "pixels-bar" }, note, button(P.busy ? "Saving..." : n ? `Save ${n} pixel${n > 1 ? "s" : ""}` : "Nothing to save", () => save(note.value), { disabled: n && !P.busy ? null : "", class: "primary" }),
          pic.saves ? button("Take back the last save", () => { if (confirm("Take back the last save made here? The picture goes back to how it was before it.")) back(); }, { disabled: P.busy ? "" : null }) : null),
        h("p", { class: "quiet" }, `${pic.edits} hand edit${pic.edits === 1 ? "" : "s"} kept beside this picture${pic.original ? "; the original is kept too" : ""}.`),
        P.said && h("p", { class: "pixels-said" }, P.said), P.error && h("p", { class: "pixels-said" }, P.error)),
      pic.marks.length ? h("div", { class: "card" }, h("h3", {}, "What the find tool marked"), h("p", { class: "quiet" }, "Red: look at it. Yellow: many alike, probably texture. Leave what was meant."),
        h("ol", { class: "pixels-marks" }, pic.marks.map((f) => h("li", { value: f.n }, button("show", () => { const [x, y] = f.pts[0], fr = canvas.parentElement; fr.scrollLeft = (x - pic.x0) * P.zoom - fr.clientWidth / 2; fr.scrollTop = (y - pic.y0) * P.zoom - fr.clientHeight / 2; fr.scrollIntoView({ block: "nearest" }); }), ` ${f.kind}: ${f.text}`)))) : null);
  }
  function draw() {
    if (location.hash !== "#pixels" && !P.pic) return;
    const fr = canvas.parentElement, keep = fr && [fr.scrollLeft, fr.scrollTop];
    box.replaceChildren(P.pic ? editor() : chooser(), !P.pic && P.error ? h("p", { class: "pixels-said" }, P.error) : "");
    if (keep && canvas.parentElement) { canvas.parentElement.scrollLeft = keep[0]; canvas.parentElement.scrollTop = keep[1]; }
  }
  const arrive = () => { if (location.hash === "#pixels") { if (!P.list) loadList(); draw(); } };
  addEventListener("hashchange", arrive); arrive();
  addEventListener("keydown", (ev) => { if (location.hash === "#pixels" && P.pic && (ev.ctrlKey || ev.metaKey) && ev.key === "z" && ev.target.tagName !== "INPUT") { ev.preventDefault(); undo(); } });
})();
