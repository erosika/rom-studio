// pane/music.js: the Music tab. Every song, effect, sample and cry in the game, a button to hear each, and a place to
// put your own file in its place. Sound starts only when a button is pressed. Uses h, button and $ from pane.js.
(() => {
  const KINDS = [["song", "Songs"], ["effect", "Effects"], ["sample", "Samples"], ["cry", "Cries"]], SHOW = 200;
  const M = { sounds: null, built: null, error: null, kind: "song", q: "", yours: false, loop: true, playing: null, said: {}, where: {}, busy: null };
  const box = $("tab-music"), audio = h("audio", { controls: true, preload: "none" });
  const len = (s) => s.seconds == null ? "" : s.seconds >= 60 ? `${Math.floor(s.seconds / 60)}:${String(Math.floor(s.seconds % 60)).padStart(2, "0")}` : `${s.seconds} s`;
  const facts = (s) => (s.options ? [s.options.voicegroup && `instruments: ${s.options.voicegroup}`, s.options.volume != null && `volume ${s.options.volume}`] : [s.rate && `${s.rate} Hz`, `${s.bytes} bytes`])
    .concat(len(s) && `${len(s)}${s.loops ? ", repeats" : ""}`, s.number != null && `number ${s.number}`).filter(Boolean).join(" · ");

  async function load() {
    try { const r = await fetch("music/list", { cache: "no-store" }); if (!r.ok) throw new Error(await r.text()); Object.assign(M, await r.json(), { error: null }); }
    catch (e) { M.error = e.message || "Cannot reach the studio."; }
    draw();
  }
  function play(s) {
    M.playing = s.name; audio.src = `music/play/${encodeURI(s.name)}?${Math.round(M.built ?? 0)}`; audio.play().catch(() => {});
    $("music-now").textContent = s.kind === "song" || s.kind === "effect" ? `${s.name}: recorded from your built game, with the game's own instruments. The first time takes a few seconds.` : `${s.name}: the sample file itself.`;
  }
  async function send(s, file) {
    if (!file) return;
    M.busy = s.name; M.said[s.name] = [`Checking ${file.name}...`]; draw();
    try {
      const r = await fetch(`music/replace/${encodeURI(s.name)}?file=${encodeURIComponent(file.name)}${M.loop ? "&keep-loop=1" : ""}`, { method: "PUT", body: file });
      M.said[s.name] = r.ok ? [...(await r.json()).lines.filter((l) => !/^To take it back|^Rebuild/.test(l)), "Ask your agent to rebuild, then press play to hear it in the game. Your agent can take it back."] : [(await r.text()) || "Not replaced."];
    } catch { M.said[s.name] = ["Not replaced: cannot reach the studio."]; }
    M.busy = null; await load();
  }
  async function where(s) {
    try { M.where[s.name] = await (await fetch(`music/where/${encodeURI(s.name)}`)).json(); } catch { M.where[s.name] = ["Cannot reach the studio."]; }
    draw();
  }
  function row(s) {
    const pick = h("input", { type: "file", accept: s.kind === "song" || s.kind === "effect" ? ".mid,.midi,audio/midi" : "audio/*,.wav", class: "sr", id: `music-file-${s.name}`, "aria-label": `A file to replace ${s.name}` });
    pick.onchange = () => { send(s, pick.files[0]); pick.value = ""; };
    const el = h("div", { class: `card music-row${M.playing === s.name ? " on" : ""}` },
      button("Play", () => { play(s); for (const r of box.querySelectorAll(".music-row.on")) r.classList.remove("on"); el.classList.add("on"); }, { "aria-label": `Play ${s.name}`, class: "music-play" }),
      h("div", {}, h("h3", {}, s.name, s.yours && h("span", { class: "music-yours" }, "yours")), h("p", { class: "quiet" }, facts(s) || (s.file ? "" : "no file of its own")),
        s.heard?.length ? h("p", { class: "quiet" }, `Map music in ${s.heard.slice(0, 4).join(", ")}${s.heard.length > 4 ? ` and ${s.heard.length - 4} more` : ""}`) : null,
        M.where[s.name] && h("ul", {}, M.where[s.name].map((l) => h("li", {}, l))),
        M.said[s.name] && h("div", { class: "music-said", role: "status" }, M.said[s.name].map((l) => h("p", {}, l)))),
      h("div", { class: "music-do" }, button("Where", () => where(s), { "aria-label": `Where ${s.name} is heard` }),
        s.file ? h("label", { class: "music-drop", for: pick.id }, M.busy === s.name ? "Checking..." : `Replace: choose or drop a ${s.kind === "song" || s.kind === "effect" ? ".mid" : ".wav"}`, pick) : null));
    el.ondragover = (ev) => { if (s.file) ev.preventDefault(); };
    el.ondrop = (ev) => { if (!s.file) return; ev.preventDefault(); send(s, ev.dataTransfer.files[0]); };
    return el;
  }
  function draw() {
    if ($("music-rows") == null) { // the frame is built once, so the player and the search box keep their state
      const search = h("input", { type: "search", id: "music-q", placeholder: "Search names", "aria-label": "Search names" });
      search.oninput = () => { M.q = search.value.trim().toLowerCase(); draw(); };
      const loop = h("input", { type: "checkbox", id: "music-loop", checked: true }); loop.onchange = () => { M.loop = loop.checked; };
      box.replaceChildren(h("div", { class: "card music-player" }, h("h2", {}, "Listening"), audio, h("p", { class: "quiet", id: "music-now" }, "Press Play on a row. Nothing plays by itself."), h("p", { class: "quiet" }, h("a", { href: "listen/", target: "_blank", rel: "noopener" }, "Previews and candidates the agents left (opens a listening page)"))),
        h("div", { class: "music-tools" }, search, h("div", { class: "chips", id: "music-kinds" }), h("label", { class: "quiet" }, loop, " When my file has no loop, repeat the whole of it")),
        h("p", { class: "quiet", id: "music-count" }), h("div", { class: "stack", id: "music-rows" }));
    }
    if (M.error || !M.sounds) { $("music-count").textContent = M.error ?? "Reading the game's music..."; return; }
    const n = (k) => M.sounds.filter((s) => s.kind === k).length, mine = M.sounds.filter((s) => s.yours).length;
    $("music-kinds").replaceChildren(...KINDS.map(([k, label]) => button(`${label} · ${n(k)}`, () => { M.kind = k; draw(); }, { "aria-pressed": String(M.kind === k && !M.yours) })),
      button(`Yours · ${mine}`, () => { M.yours = !M.yours; draw(); }, { "aria-pressed": String(M.yours) }));
    const hit = M.sounds.filter((s) => (M.yours ? s.yours : s.kind === M.kind) && (!M.q || s.name.toLowerCase().includes(M.q) || (s.heard ?? []).some((m) => m.toLowerCase().includes(M.q)) || (s.options?.voicegroup ?? "").includes(M.q)));
    $("music-count").textContent = `${hit.length} shown${hit.length > SHOW ? `: the first ${SHOW}; search to narrow` : ""}. Songs and effects are recorded from the game as it was last built${M.built ? "" : " (it has not been built yet, so only samples and cries play)"}. This page makes no music: it plays what is there and takes your files.`;
    $("music-rows").replaceChildren(...hit.slice(0, SHOW).map(row));
  }
  const show = () => { if (location.hash === "#music") load(); };
  addEventListener("hashchange", show); show();
})();
