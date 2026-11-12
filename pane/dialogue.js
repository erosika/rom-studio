// pane/dialogue.js: the Dialogue tab. The places down the left; what is said in the chosen place on the right; a search
// through all of it. Uses h, button and $ from pane.js; all text goes in as text, never as HTML.
(() => {
  const box = $("tab-dialogue"), MOST = 400;
  const S = { all: null, error: null, place: null, q: "", timer: null, which: null, notes: new Map(), editing: null, said: "", sort: (() => { try { return localStorage.paneDialogueSort || "story"; } catch { return "story"; } })() };
  const SORT = [["story", "Story order"], ["name", "A to Z"], ["written", "Order I wrote them"]];
  const WHICH = [["new", "New scripts"], ["changed", "Changed lines"], ["same", "Untouched original"], ["all", "Everything"], ["notes", "With my notes"]];
  const nk = (file, label) => `${file}\0${label}`;
  const holds = (t, low) => t.label.toLowerCase().includes(low) || t.boxes.some((b) => b.toLowerCase().includes(low));
  const key = (p) => p.file;

  async function load() {
    if (!S.all) draw(); // says it is reading
    try { const r = await fetch("dialogue/all", { cache: "no-store" }); if (!r.ok) throw new Error((await r.text()) || "The studio could not answer."); S.all = await r.json(); S.error = null;
      const n = await fetch("dialogue/notes", { cache: "no-store" }); if (n.ok) S.notes = new Map((await n.json()).map((x) => [nk(x.file, x.label), x])); }
    catch (e) { S.error = e.message || "Cannot reach the studio."; }
    draw();
  }
  // a speaker's name at the start of a box, and the names the game fills in, are set apart
  function said(b, low) {
    const parts = [], name = /^([A-Z][A-Z0-9 .'-]{1,24}):/.exec(b); let rest = b;
    if (name) { parts.push(h("b", {}, name[0])); rest = b.slice(name[0].length); }
    const i = low ? rest.toLowerCase().indexOf(low) : -1;
    if (i >= 0) parts.push(rest.slice(0, i), h("mark", {}, rest.slice(i, i + low.length)), rest.slice(i + low.length)); else parts.push(rest);
    return h("p", {}, parts);
  }
  async function save(p, t, note) {
    try {
      const r = await fetch("dialogue/note", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file: p.file, label: t.label, note, said: t.boxes.join("\n") }) });
      if (!r.ok) throw new Error((await r.text()) || "Not saved.");
      const row = await r.json(); if (row.note) S.notes.set(nk(p.file, t.label), row); else S.notes.delete(nk(p.file, t.label));
      S.editing = null; S.said = "";
    } catch (e) { S.said = e.message || "Not saved: cannot reach the studio."; }
    draw();
  }
  // the note on one text: shown when there is one, a box to write in when asked for
  function noteOf(p, t) {
    const k = nk(p.file, t.label), has = S.notes.get(k);
    if (S.editing !== k) return has ? h("div", { class: "dialogue-note" }, h("p", {}, h("b", {}, "Your note: "), has.note), button("Change", () => { S.editing = k; draw(); }), button("Remove", () => save(p, t, ""))) : null;
    const box = h("textarea", { rows: "3", "aria-label": `Your note on ${t.label}`, placeholder: "What should change here? Say it as you would to a person." }); box.value = has?.note ?? "";
    setTimeout(() => box.focus());
    return h("div", { class: "dialogue-note" }, box, h("div", { class: "source-row" }, button("Save note", () => save(p, t, box.value)), button("Cancel", () => { S.editing = null; S.said = ""; draw(); }), S.said && h("span", { class: "source-no", role: "status" }, S.said)));
  }
  function drawNotes() {
    const n = S.notes.size, el = $("dialogue-notes");
    el.replaceChildren(h("p", { class: "quiet" }, n ? `${n} note${n === 1 ? "" : "s"} waiting. They are kept in the game folder; tell your agent to read your dialogue notes.` : "Press Note on any text to say what should change. Notes are kept in the game folder for your agent."),
      n ? h("div", { class: "source-row" }, h("a", { href: "dialogue/notes.md", download: "dialogue-notes.md", class: "dialogue-export" }, "Export as a file"),
        button("Copy all", async (ev) => { try { await navigator.clipboard.writeText(await (await fetch("dialogue/notes.md", { cache: "no-store" })).text()); ev.target.textContent = "Copied"; } catch { ev.target.textContent = "Not copied: use Export"; } })) : null);
  }
  function draw() {
    const side = $("dialogue-places"), out = $("dialogue-said"), n = $("dialogue-count"); if (!side) return;
    if (S.error || !S.all) { n.textContent = S.error ?? "Reading the scripts..."; side.replaceChildren(); return out.replaceChildren(); }
    const low = S.q.toLowerCase().trim();
    drawNotes();
    const tally = { new: 0, changed: 0, same: 0, all: S.all.texts, notes: S.notes.size }; for (const p of S.all.places) for (const t of p.texts) tally[t.state]++;
    if (!S.which || !tally[S.which]) S.which = WHICH.find(([k]) => tally[k])?.[0] ?? "all"; // what was written new comes first
    $("dialogue-which").replaceChildren(...(tally.all === tally[S.which] && S.which !== "all" ? [] : WHICH.filter(([k]) => tally[k]).map(([k, name]) => button(`${name} · ${tally[k]}`, () => { S.which = k; S.place = null; draw(); }, { "aria-pressed": String(S.which === k) }))));
    const pool = S.which === "all" ? S.all.places : S.all.places.map((p) => ({ ...p, texts: p.texts.filter((t) => (S.which === "notes" ? S.notes.has(nk(p.file, t.label)) : t.state === S.which)) }));
    const ordered = S.all.places.some((p) => p.order != null), sorts = SORT.filter(([k]) => (k === "story" ? ordered : k === "written" ? S.which === "notes" : true));
    const sort = sorts.some(([k]) => k === S.sort) ? S.sort : sorts[0][0];
    $("dialogue-sort").replaceChildren(...(sorts.length > 1 ? sorts.map(([k, name]) => button(name, () => { S.sort = k; try { localStorage.paneDialogueSort = k; } catch {} draw(); }, { "aria-pressed": String(sort === k) })) : []));
    let places = pool.map((p) => ({ ...p, texts: low ? p.texts.filter((t) => holds(t, low)) : p.texts })).filter((p) => p.texts.length);
    const when = (p) => Math.min(...p.texts.map((t) => Date.parse(S.notes.get(nk(p.file, t.label))?.t) || Infinity));
    if (sort === "story") places.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.file.localeCompare(b.file));
    else if (sort === "written") places = places.map((p) => ({ ...p, texts: [...p.texts].sort((a, b) => (S.notes.get(nk(p.file, a.label))?.t ?? "").localeCompare(S.notes.get(nk(p.file, b.label))?.t ?? "")) })).sort((a, b) => when(a) - when(b));
    else places.sort((a, b) => a.place.localeCompare(b.place) || a.file.localeCompare(b.file));
    if (!S.all.texts) { n.textContent = "No text found yet. Texts are read from the scripts under data/maps, data/scripts and data/text."; side.replaceChildren(); return out.replaceChildren(); }
    if (!places.some((p) => key(p) === S.place)) S.place = low ? null : places[0] && key(places[0]);
    const total = places.reduce((a, p) => a + p.texts.length, 0);
    n.textContent = low ? (total ? `${total} text${total === 1 ? "" : "s"} in ${places.length} place${places.length === 1 ? "" : "s"} hold "${S.q.trim()}".` : `Nothing holds "${S.q.trim()}".`)
      : `${total} text${total === 1 ? "" : "s"} in ${places.length} place${places.length === 1 ? "" : "s"}.`;
    side.replaceChildren(...(low && places.length > 1 ? [button(["Every place", h("span", {}, String(total))], () => { S.place = null; draw(); }, { class: "dialogue-place", "aria-current": String(S.place === null) })] : []),
      ...places.map((p) => button([p.place, h("span", {}, String(p.texts.length))], () => { S.place = key(p); draw(); out.scrollTop = 0; out.scrollIntoView({ block: "nearest" }); }, { class: "dialogue-place", "aria-current": String(S.place === key(p)), title: p.file })));
    const shown = S.place === null ? places : places.filter((p) => key(p) === S.place); let room = MOST;
    const kids = [];
    for (const p of shown) {
      if (room <= 0) break;
      const texts = p.texts.slice(0, room); room -= texts.length;
      kids.push(h("h3", {}, p.place, " ", h("code", { class: "quiet" }, p.file)), texts.map((t) => h("div", { class: "dialogue-text" }, h("div", { class: "dialogue-label" }, t.label, !S.notes.has(nk(p.file, t.label)) && S.editing !== nk(p.file, t.label) && button("Note", () => { S.editing = nk(p.file, t.label); draw(); }, { class: "dialogue-add", "aria-label": `Write a note on ${t.label}` })), t.boxes.map((b) => said(b, low)), noteOf(p, t))));
    }
    if (room <= 0) kids.push(h("p", { class: "quiet" }, `Only the first ${MOST} texts are shown. Add letters to the search, or choose one place.`));
    out.replaceChildren(...kids.flat(Infinity));
  }
  function frame() {
    const q = h("input", { type: "search", id: "dialogue-q", placeholder: "Search what is said: a name, a word", "aria-label": "Search what is said", autocomplete: "off", spellcheck: "false" });
    q.oninput = () => { clearTimeout(S.timer); S.timer = setTimeout(() => { S.q = q.value; draw(); }, 200); };
    box.replaceChildren(h("div", { class: "dialogue" },
      h("div", { class: "card dialogue-side" }, h("h2", {}, "Dialogue"), q, h("div", { class: "chips", id: "dialogue-which", role: "group", "aria-label": "Which texts" }), h("div", { class: "chips", id: "dialogue-sort", role: "group", "aria-label": "Order of the places" }), h("p", { class: "quiet", id: "dialogue-count", role: "status" }), h("nav", { id: "dialogue-places", "aria-label": "Places" }), h("div", { id: "dialogue-notes" })),
      h("div", { class: "card dialogue-main" }, h("p", { class: "quiet" }, "Every line a player can read, from the game's scripts as they are now. Each paragraph is one text box. New scripts are files added since the game was set up; changed lines are texts in the original's scripts that read differently now. The small name above a text is its name in the scripts: search for it in the Source tab to find where it is used."),
        h("div", { id: "dialogue-said" }))));
  }
  const show = () => { if (location.hash !== "#dialogue") return; if (!$("dialogue-places")) frame(); load(); };
  addEventListener("hashchange", show); show();
})();
