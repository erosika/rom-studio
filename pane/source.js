// pane/source.js: the Source tab. What your decomp is, a way to bring one in when there is none yet, and a search through
// its source with the lines around each hit. Uses h, button and $ from pane.js; all text goes in as text, never as HTML.
(() => {
  const box = $("tab-source"), STEP = 30;
  const S = { info: null, error: null, setup: null, said: "", busy: false, found: null, searching: false, findError: null, view: null, seq: 0, timer: null, poll: null };
  const get = async (url) => { const r = await fetch(url, { cache: "no-store" }); if (!r.ok) throw new Error((await r.text()) || "The studio could not answer."); return r.json(); };

  async function load() {
    try { S.info = await get("source/info"); S.error = null; S.setup = await get("source/setup"); }
    catch (e) { S.error = e.message || "Cannot reach the studio."; }
    drawAbout(); watch();
  }
  // while a setup runs, its last lines are read every two seconds
  function watch() {
    clearTimeout(S.poll);
    if (S.setup?.running && location.hash === "#source") S.poll = setTimeout(async () => {
      try { S.setup = await get("source/setup"); } catch {}
      if (S.setup?.running) { drawAbout(); watch(); } else load();
    }, 2000);
  }
  async function begin(send) {
    if (S.busy) return;
    S.busy = true; S.said = "Starting..."; drawAbout();
    try { const r = await send(); S.said = r.ok ? "" : (await r.text()) || "Not started."; } catch { S.said = "Not started: cannot reach the studio."; }
    S.busy = false; await load();
  }
  const fromPlace = (from) => from && begin(() => fetch("source/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from }) }));
  function fromArchive(file) {
    if (!file) return;
    if (!/\.(zip|tar\.gz|tgz)$/i.test(file.name)) { S.said = `${file.name} is not a .zip or .tar.gz file.`; return drawAbout(); }
    begin(() => { S.said = `Sending and unpacking ${file.name} (${Math.round(file.size / 1e6)} MB)...`; drawAbout(); return fetch(`source/archive/${encodeURIComponent(file.name)}`, { method: "PUT", body: file }); });
  }
  function progress() {
    const s = S.setup; if (!s?.lines.length || (s.ok && S.info?.isGame && !S.started)) return null;
    return h("div", { class: "source-log", role: "status" }, h("h3", {}, s.running ? "Setting up: the first build takes several minutes" : s.ok ? "Setup finished" : "Setup stopped"),
      h("pre", {}, s.lines.join("\n")), !s.running && !s.ok && h("p", { class: "quiet" }, "The last lines say why. Nothing of yours was changed: your decomp is copied, never edited."));
  }
  function drawAbout() {
    const el = $("source-about"), i = S.info, kids = [h("h2", {}, "Your decomp")];
    if (S.error || !i) kids.push(h("p", { class: "quiet" }, S.error ?? "Reading the game folder..."));
    else if (i.isGame) {
      kids.push(h("p", {}, h("code", {}, i.game)), h("p", { class: "quiet" }, [i.says.decomp && `It is: ${i.says.decomp}.`, i.says.base && `Base: ${i.says.base.replace(/\.$/, "")}.`, i.says["last build"] && `Last build: ${i.says["last build"]}.`].filter(Boolean).join(" ") || "A source tree with a Makefile; setup has not finished on it."),
        h("p", { class: "quiet" }, `${i.folders.reduce((n, f) => n + f.files, i.files)} files kept in git. Press a folder to search inside it.`),
        h("div", { class: "chips" }, i.folders.map((f) => button(`${f.name} · ${f.files}`, () => { $("source-in").value = `${f.name}/**`; $("source-q").focus(); search(); }, { "aria-label": `Search inside ${f.name}, ${f.files} files` }))));
    } else {
      kids.push(h("p", {}, "No game yet in ", h("code", {}, i.game), "."),
        h("p", { class: "quiet" }, "A decomp is the source code of an original game, taken apart by its community so it can be changed and rebuilt. The studio does not include or fetch one: bring yours. It is copied into the game folder; your original stays as it is."));
      if (i.refusal && !S.setup?.running) kids.push(h("p", { class: "source-no" }, i.refusal));
      else if (!S.setup?.running) {
        const from = h("input", { type: "text", id: "source-from", placeholder: "~/your-decomp or https://...git", "aria-label": "Your decomp: a folder on this computer or a git address", autocomplete: "off", spellcheck: "false" });
        const go = () => { S.started = true; fromPlace(from.value.trim()); };
        from.onkeydown = (ev) => { if (ev.key === "Enter") go(); };
        const pick = h("input", { type: "file", id: "source-archive", class: "sr", accept: ".zip,.gz,.tgz,application/zip,application/gzip" });
        pick.onchange = () => { S.started = true; fromArchive(pick.files[0]); pick.value = ""; };
        const drop = h("label", { class: "music-drop source-drop", for: "source-archive" }, "Or choose or drop an archive of it here: a .zip or .tar.gz, 600 MB at most", pick);
        drop.ondragover = (ev) => ev.preventDefault(); drop.ondrop = (ev) => { ev.preventDefault(); S.started = true; fromArchive(ev.dataTransfer.files[0]); };
        kids.push(h("label", { class: "label", for: "source-from" }, "A folder on this computer, or a git address"), h("div", { class: "source-row" }, from, button(S.busy ? "Starting..." : "Set up", go, { disabled: S.busy })), drop);
      }
    }
    if (S.said) kids.push(h("p", { class: "source-no", role: "status" }, S.said));
    kids.push(progress());
    el.replaceChildren(...kids.filter(Boolean));
    const log = el.querySelector(".source-log pre"); if (log) log.scrollTop = log.scrollHeight; // the newest lines are the ones that matter
  }

  async function search() {
    clearTimeout(S.timer);
    const q = $("source-q").value, seq = ++S.seq;
    if (!q.trim()) { S.found = null; S.findError = null; return drawFound(); }
    S.searching = true; drawFound();
    try { const r = await get(`source/search?q=${encodeURIComponent(q)}&in=${encodeURIComponent($("source-in").value.trim())}${$("source-re").checked ? "&regex=1" : ""}`); if (seq !== S.seq) return; S.found = r; S.findError = null; }
    catch (e) { if (seq !== S.seq) return; S.found = null; S.findError = e.message; }
    S.searching = false; drawFound();
  }
  const later = () => { clearTimeout(S.timer); S.timer = setTimeout(search, 400); };
  const marked = (t) => (t.mark ? [t.text.slice(0, t.mark[0]), h("mark", {}, t.text.slice(t.mark[0], t.mark[1])), t.text.slice(t.mark[1])] : t.text);
  function drawFound() {
    const f = S.found, n = $("source-count"), out = $("source-found");
    if (S.findError) { n.textContent = S.findError; return out.replaceChildren(); }
    if (!f) { n.textContent = S.searching ? "Searching..." : "Type some text: a name from the game, a line someone says, a word from a script. Capitals do not matter."; return out.replaceChildren(); }
    n.textContent = !f.shown ? `Nothing holds "${f.query}"${f.in ? ` in ${f.in}` : ""}.${f.regex ? " A pattern is matched as written, capitals included." : ""}`
      : `${f.shown} line${f.shown === 1 ? "" : "s"} in ${f.files.length} file${f.files.length === 1 ? "" : "s"}.${f.more ? ` ${f.atLeast ? "More than " : ""}${f.more} more not shown: add letters, or fill "in" to look in one place.` : ""} Press a line to read around it.`;
    out.replaceChildren(...f.files.map((x) => h("div", { class: "source-file" }, h("h3", {}, x.file),
      x.hits.map((t) => button([h("span", { class: "source-n" }, String(t.line)), h("span", { class: "source-text" }, marked(t))], () => open(x.file, t.line), { class: "source-hit", "aria-label": `${x.file} line ${t.line}: ${t.text.trim()}` })))));
  }

  async function open(path, hit, at = hit) {
    try { S.view = { ...(await get(`source/file?path=${encodeURIComponent(path)}&at=${at}&span=20`)), hit, error: null }; }
    catch (e) { S.view = { file: path, hit, error: e.message, lines: [], from: 1, to: 0, total: 0 }; }
    drawView(at === hit);
  }
  function drawView(jump) {
    const v = S.view, el = $("source-view"); el.hidden = !v; if (!v) return;
    el.replaceChildren(h("h2", {}, "Reading"), h("p", {}, h("code", {}, v.file), v.error ? "" : `  lines ${v.from} to ${v.to} of ${v.total}`), h("p", { class: "source-no", hidden: !v.error }, v.error ?? ""),
      h("div", { class: "source-row" }, button("Earlier lines", () => open(v.file, v.hit, Math.max(1, v.at - STEP)), { disabled: v.from <= 1 }), button("Later lines", () => open(v.file, v.hit, Math.min(v.total, v.at + STEP)), { disabled: v.to >= v.total }),
        button("Back to the line", () => open(v.file, v.hit), { disabled: v.at === v.hit }), button("Close", () => { S.view = null; drawView(); })),
      h("div", { class: "source-lines", tabindex: "0", "aria-label": `${v.file}, lines ${v.from} to ${v.to}` }, v.lines.map((l) => h("div", { class: `source-line${l.n === v.hit ? " hit" : ""}` }, h("span", { class: "source-n" }, String(l.n)), h("span", { class: "source-text" }, l.text || " ")))));
    if (jump) el.scrollIntoView({ block: "nearest" });
  }

  function frame() {
    const q = h("input", { type: "search", id: "source-q", placeholder: "Search the source", "aria-label": "Search the source", autocomplete: "off", spellcheck: "false" });
    const within = h("input", { type: "text", id: "source-in", placeholder: "data/maps/**", "aria-label": "Only in files matching", autocomplete: "off", spellcheck: "false" });
    const re = h("input", { type: "checkbox", id: "source-re" });
    for (const el of [q, within]) { el.oninput = later; el.onkeydown = (ev) => { if (ev.key === "Enter") search(); }; }
    re.onchange = search;
    box.replaceChildren(h("div", { class: "card", id: "source-about" }),
      h("div", { class: "card source-search" }, h("h2", {}, "Search"), q, h("div", { class: "source-row" }, h("label", { class: "quiet source-in" }, "in ", within), h("label", { class: "quiet" }, re, " pattern")),
        h("p", { class: "quiet", id: "source-count", role: "status" }), h("div", { id: "source-found" })),
      h("div", { class: "card", id: "source-view", hidden: true }));
    drawFound();
  }
  const show = () => { if (location.hash !== "#source") return; if (!$("source-about")) frame(); load(); };
  addEventListener("hashchange", show); show();
})();
