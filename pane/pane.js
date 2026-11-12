// pane/pane.js: asks the server for the game's state every three seconds and redraws what changed, so entries arrive without a reload.
// Nothing here moves on its own: no timers that animate, no transitions. New entries just appear.
const $ = (id) => document.getElementById(id);
const POLL_MS = 3000;
let S = null, etag = null, drawn = {}, page;
const stored = (k, d) => { try { return localStorage[k] || d; } catch { return d; } };
const ui = { group: stored("paneGroup", "stream"), scene: null, more: 0, chip: "All", q: "", list: [], i: 0, pinned: null, map: null, layers: { people: true, doors: true, blocked: false }, lore: null, allStreams: false };
let L = { list: null, one: null, error: null }; // the lore index and the id being read
let ST = { data: null, error: null, said: "" }; // settings.json as the Settings tab shows it
// "new" means newer than the last time this browser looked away from the page
const lastLook = () => { try { return Number(localStorage.paneSeen) || Date.now(); } catch { return Date.now(); } };
let seen = lastLook();

// h("p", { class: "x" }, "text", node): a small element builder, so text is never parsed as HTML
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) if (v != null && v !== false) el.setAttribute(k, v === true ? "" : v);
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false && kid !== 0) el.append(kid);
  return el;
}
const button = (label, onclick, attrs) => Object.assign(h("button", { type: "button", ...attrs }, label), { onclick });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function when(t) {
  const d = new Date(t);
  if (isNaN(d)) return "";
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { day: "numeric", month: "short" })}, ${time}`;
}

// redraw one part of the page only when its data changed, keeping opened details open
function draw(id, data, build) {
  const sig = JSON.stringify(data);
  if (drawn[id] === sig) return;
  drawn[id] = sig;
  const box = $(id), open = new Set([...box.querySelectorAll("details[open]")].map((d) => d.dataset.key));
  box.replaceChildren(...[build(data)].flat(Infinity).filter(Boolean));
  for (const d of box.querySelectorAll("details")) if (open.has(d.dataset.key)) d.open = true;
}

// "people5-walk-left.png" -> group "people5", caption "walk left"
const prefix = (name) => (name.match(/^[A-Za-z]+\d*/) ?? ["other"])[0];
const caption = (name) => name.replace(/\.\w+$/, "").replace(/^[A-Za-z]+\d*[-_]?/, "").replace(/[-_]+/g, " ").trim() || name;
const item = (dir, shot) => (p) => ({ name: p.name, t: p.t, shot, url: `${dir}/${encodeURIComponent(p.name)}?${Math.round(p.t ?? 0)}`, path: `${S.dir}/${dir}/${p.name}` });
const shots = () => S.shots.map(item("shots", true));
const sceneOf = (name) => S.feed.find((e) => e.shot === name && e.scene)?.scene;
const groupOf = (name) => sceneOf(name) ?? prefix(name);

// a picture: pressing it opens the large view, where Previous and Next walk through `list`
function picture(it, list, eager) {
  return button(h("img", { src: it.url, alt: caption(it.name), loading: eager ? null : "lazy" }),
    () => { ui.list = list ?? (it.shot ? shots() : [it]); ui.i = Math.max(0, ui.list.findIndex((x) => x.name === it.name && x.shot === it.shot)); drawViewer(); $("viewer").showModal(); fit(); }, { class: "shot", title: it.name });
}
function star(name) {
  const on = S.kept.includes(name);
  return button(on ? "★" : "☆", async () => {
    await fetch(`kept/${encodeURIComponent(name)}`, { method: on ? "DELETE" : "PUT" });
    await refresh();
    if ($("viewer").open) drawViewer();
  }, { class: "star", "aria-pressed": String(on), title: on ? "Kept. Press to let it go" : "Keep this picture" });
}
function tile(it, list) {
  const fresh = it.t > seen;
  return h("figure", {}, picture(it, list), it.shot && star(it.name),
    h("figcaption", {}, fresh && h("b", { class: "fresh" }, "New "), `${it.name.replace(/\.\w+$/, "")} · ${when(it.t)}`));
}
const byPrefix = (list) => { const by = new Map(); for (const p of list) by.set(prefix(p.name), [...(by.get(prefix(p.name)) ?? []), p]); return [...by]; };
const prefixGroups = (list) => byPrefix(list).map(([name, ps]) => h("details", { class: "card", "data-key": `g${name}` },
  h("summary", {}, h("strong", {}, name), ` · ${count(ps.length, "picture")} · ${when(ps[0].t)}`), h("div", { class: "grid" }, ps.map((p) => tile(p, ps)))));

// ---- first screen: Streams, Play, Feed, Your game
const QUIET_MIN = 20, ACTIVE_MIN = 90, SHOW = 40; // a stream with nothing for this long is marked quiet; the feed lists this many at a time
const sceneName = (e) => e.scene || "No scene";
// tiles are per stream (who is working: the entry's `by`, else its scene) or per scene; the user switches
const groupName = (e) => (ui.group === "stream" && e.by) || sceneName(e);
const waiting = (e) => { const r = S.reviews?.[e.id]; return (r?.verdict === "work" || r?.verdict === "note") && !r.handled; };
const sendJson = (path, body) => fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const isNew = (e) => Date.parse(e.t) > seen;
// the picture of a feed entry: one in shots/, or one the feed names elsewhere (another copy of the game)
const picOf = (e) => e.shot ? item("shots", true)({ name: e.shot, t: e.shotT })
  : e.far ? { name: decodeURIComponent(e.far.split("/").pop()), t: e.shotT, shot: false, url: `${e.far}?${Math.round(e.shotT ?? 0)}`, path: e.farPath } : null;
const beforeOf = (e) => e.before ? item("shots", true)({ name: e.before, t: e.beforeT })
  : e.beforeFar ? { name: decodeURIComponent(e.beforeFar.split("/").pop()), t: e.beforeT, shot: false, url: `${e.beforeFar}?${Math.round(e.beforeT ?? 0)}` } : null;
function streams(nameOf = groupName) { // one per name, in the order they first spoke, so each keeps its place on the screen
  const by = new Map();
  for (const e of S.feed) {
    const s = by.get(nameOf(e)) ?? { name: nameOf(e), n: 0, fresh: 0, work: 0, pic: null };
    s.n++; s.last = e; s.fresh += isNew(e) ? 1 : 0; s.work += waiting(e) ? 1 : 0; s.pic = picOf(e) ?? s.pic;
    by.set(s.name, s);
  }
  return [...by.values()];
}
// keep the elements already on the page when the list is drawn again, so pictures are not loaded twice and nothing jumps
const made = {};
function reuse(box, key, make) {
  const next = (made[`${box} next`] ??= new Map()), el = made[box]?.get(key) ?? make();
  next.set(key, el);
  return el;
}
const settle = (box) => { made[box] = made[`${box} next`]; delete made[`${box} next`]; };
const details = (e, key) => e.detail && h("details", { "data-key": key }, h("summary", {}, "Details"), h("pre", {}, String(e.detail)));
// one feed entry; `top` is the newest on the screen (larger), `last` the newest of its scene (shows what is next)
// the user's answer to one entry: two buttons and a note, or the note alone, kept in reviews.jsonl for the agent to read
function review(e) {
  const r = S.reviews?.[e.id], note = h("input", { type: "text", placeholder: "A note for the agent (optional)", "aria-label": "A note for the agent", maxlength: 500, value: r?.note || null });
  const say = (verdict) => async () => { const res = await sendJson("review", { id: e.id, entry: e.t, scene: e.scene, verdict, note: note.value }).catch(() => null); if (!res?.ok) $("status").textContent = "Your answer was not saved. Is the studio running?"; await refresh(); };
  return h("div", { class: "review" },
    h("h3", {}, "Review this scene"), h("p", { class: "quiet" }, "Tell your agent what to keep or change."),
    r && h("p", { class: r.verdict !== "right" && !r.handled ? "said work" : "said" }, r.verdict === "right" ? "You said: looks right." : `${r.verdict === "note" ? "You left a note." : "You said: needs work."} ${r.handled ? `A later entry answers it (${when(r.handled)}).` : "The agent has not answered yet."}`, r.note && ` “${r.note}”`),
    h("div", { class: "pair" }, button([h("span", { class: "console-key", "aria-hidden": "true" }, "A"), "Looks right"], say("right"), { "aria-pressed": String(r?.verdict === "right") }), button([h("span", { class: "console-key", "aria-hidden": "true" }, "B"), "Needs work"], say("work"), { "aria-pressed": String(r?.verdict === "work") })), note,
    // a note alone: saved without saying right or needs work; with the box empty, a tap puts you in the box
    button("Send note", () => (note.value.trim() ? say("note")() : note.focus()), { class: "send-note", "aria-pressed": String(r?.verdict === "note") }));
}
function entry(e, { top, last, pics, card } = {}) {
  const pic = picOf(e), was = beforeOf(e);
  const body = [h("p", { class: "quiet" }, isNew(e) && h("b", { class: "fresh" }, "New "), h("strong", {}, sceneName(e)), e.by && ` · ${e.by}`, ` · ${when(e.t)}`),
    e.asked && h("p", { class: "asked" }, h("span", { class: "label" }, "You asked"), " ", e.asked),
    h("p", { class: "did" }, e.did),
    was && pic ? h("div", { class: "beforeafter" }, h("figure", {}, picture(was, [was, pic]), h("figcaption", {}, "before")), h("figure", {}, picture(pic, [was, pic], top), h("figcaption", {}, "after"))) : pic && picture(pic, pics, top),
    top && !pic && !e.lost && h("div", { class: "empty-preview" }, h("strong", {}, "No picture yet"), h("span", {}, "The next scene picture will appear here.")),
    e.lost && h("p", { class: "quiet" }, `The picture was not found: ${e.lost}`),
    last && e.next && h("p", { class: "next" }, h("span", { class: "label" }, "Next"), " ", e.next), details(e, `d${e.t}${e.did.length}`)];
  // the newest entry is two surfaces side by side: the preview stage and the review
  return h("article", { class: `entry${card ? " card" : ""}${top ? " first" : ""}` }, top ? h("div", { class: "stage" }, body) : body, card && e.id && review(e));
}
const tick = (done) => h("span", { class: done ? "tick done" : "tick", "aria-hidden": "true" }, done ? "✓" : "");

function drawStreams() {
  const list = streams(), now = Date.now(), pick = (name) => () => { ui.scene = ui.scene === name ? null : name; ui.more = 0; render(); };
  if (ui.scene && !list.some((s) => s.name === ui.scene)) ui.scene = null;
  const newest = S.feed[S.feed.length - 1];
  $("streams-h").textContent = newest ? `Streams · ${list.length} · ${count(S.feed.length, "entry", "entries")} · newest ${when(newest.t)}` : "Streams";
  const age = (s) => now - Date.parse(s.last.t), recent = list.filter((s) => age(s) < ACTIVE_MIN * 60000 || s.work > 0 || s.name === ui.scene);
  const shown = ui.allStreams ? list : recent.length ? recent : [...list].sort((a, b) => age(a) - age(b)).slice(0, 6), hidden = list.length - shown.length;
  const tiles = shown.map((s) => {
    const mins = Math.floor((now - Date.parse(s.last.t)) / 60000), still = mins >= QUIET_MIN, on = s.name === ui.scene;
    const quiet = still ? `quiet ${mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h`}` : "";
    return reuse("streams", JSON.stringify([s.name, s.n, s.fresh, s.work, s.pic?.url, quiet, on]), () => button([
      s.pic ? h("img", { src: s.pic.url, alt: "" }) : h("span", { class: "nopic" }, "no picture yet"),
      h("strong", {}, s.name), h("span", {}, `${s.n} · ${when(s.last.t)}`), quiet && h("span", {}, quiet), s.fresh > 0 && h("b", { class: "fresh" }, `${s.fresh} new`),
      s.work > 0 && h("b", { class: "work" }, `${s.work} waiting for the agent`),
    ], pick(s.name), { class: still ? "stream still" : "stream", "aria-pressed": String(on), title: `${s.name}: ${s.last.did}` }));
  });
  settle("streams");
  // the switch shows once some entry says who wrote it; until then stream and scene are the same thing
  const group = (g, label) => button(label, () => { ui.group = g; ui.scene = null; try { localStorage.paneGroup = g; } catch {} render(); }, { class: "chip", "aria-pressed": String(ui.group === g) });
  draw("grouping", [S.feed.some((e) => e.by), ui.group], ([any]) => any && [h("span", { class: "quiet" }, "Tiles: "), group("stream", "By stream"), group("scene", "By scene")]);
  const more = (hidden > 0 || ui.allStreams) && list.length > 6 && button(ui.allStreams ? "Only the active ones" : `${hidden} quiet · show all`, () => { ui.allStreams = !ui.allStreams; render(); }, { class: "stream all more" });
  return list.length ? [button(`All · ${S.feed.length}`, pick(null), { class: "stream all", "aria-pressed": String(!ui.scene) }), tiles, more] : null;
}
function drawFeed() {
  const list = S.feed.map((e, i) => ({ e, i })).filter(({ e }) => !ui.scene || groupName(e) === ui.scene).reverse(), newest = shots()[0];
  if (!list.length) return newest ? h("div", { class: "card" }, picture(newest, null, true), h("p", { class: "quiet" }, `Newest picture: ${caption(newest.name)} · ${when(newest.t)}. The agent has not written any reports yet. Every picture is under Gallery.`))
    : h("p", { class: "card quiet" }, "Nothing yet. Ask your agent for the first scene. Each thing it does will be listed here, with a picture.");
  const pics = list.map(({ e }) => picOf(e)).filter(Boolean), lasts = new Set(streams().map((s) => s.last)), shown = list.slice(0, SHOW + ui.more);
  const out = shown.map(({ e, i }, at) => reuse("feed", JSON.stringify([i, e, at === 0, lasts.has(e), isNew(e), ui.scene, S.reviews?.[e.id]]), () => entry(e, { top: at === 0, last: lasts.has(e), pics, card: true })));
  settle("feed");
  return [out[0], out.length > 1 && h("details", { class: "history", "data-key": "earlier-feed" }, h("summary", {}, `Earlier updates · ${list.length - 1}`), h("div", { class: "stack" }, out.slice(1), list.length > shown.length && button(`Show ${Math.min(SHOW, list.length - shown.length)} earlier`, () => { ui.more += SHOW; render(); })))];
}
function drawLadder() {
  if (!S.scenes.length) return h("p", { class: "quiet" }, "The list of scenes will appear here once it is written in game.md.");
  return [h("p", { class: "quiet" }, S.scenesFrom === "headings" ? "Found in the headings of game.md, which has no ticked list yet." : `${S.scenes.filter((x) => x.done).length} of ${S.scenes.length} scenes done`),
    h("ol", { class: "steps" }, S.scenes.map((x) => h("li", { class: x.done ? "done" : null }, tick(x.done), h("span", {}, x.label, x.idea && `: ${x.idea}`, x.done && h("span", { class: "sr" }, " (done)")))))];
}

// ---- Gallery: shelves, filter chips, search, grid
function drawGallery() {
  const all = shots(), refs = S.refs.map(item("refs", false)), keptOnes = all.filter((p) => S.kept.includes(p.name));
  const shelf = (title, list, empty) => h("section", { class: "card" }, h("h2", {}, `${title} · ${list.length}`),
    list.length ? h("div", { class: "row" }, list.map((p) => tile(p, list))) : h("p", { class: "quiet" }, empty));
  draw("shelves", [S.kept, S.refs, seen], () => [keptOnes.length && shelf("Kept", keptOnes), shelf("Reference pictures", refs, "None sent yet.")]);
  const names = ["All", all.some((p) => p.t > seen) && "New", ...new Set(all.map((p) => groupOf(p.name)))].filter(Boolean);
  if (!names.includes(ui.chip)) ui.chip = "All";
  const shown = all.filter((p) => (ui.chip === "All" || (ui.chip === "New" ? p.t > seen : groupOf(p.name) === ui.chip)) && p.name.toLowerCase().includes(ui.q));
  draw("chips", [names, ui.chip], () => names.map((n) => button(n, () => { ui.chip = n; render(); }, { class: "chip", "aria-pressed": String(n === ui.chip) })));
  draw("comparing", ui.pinned?.name, () => ui.pinned && h("p", { class: "card" }, `Comparing with ${ui.pinned.name}. Open another picture to see the two side by side. `, button("Stop comparing", () => { ui.pinned = null; render(); })));
  draw("grid", [shown.map((p) => p.url), S.kept, seen], () => shown.length ? shown.map((p) => tile(p, shown)) : h("p", { class: "quiet" }, "No pictures match."));
  $("pictures-count").textContent = `${count(all.length, "picture")} from the game, newest first` + (shown.length < all.length ? ` · showing ${shown.length}` : "");
}

// ---- the large view: one picture, or two at the same scale
function drawViewer() {
  const cur = ui.list[ui.i], pin = ui.pinned && ui.pinned.url !== cur.url ? ui.pinned : null;
  const step = (d) => () => { ui.i = (ui.i + d + ui.list.length) % ui.list.length; drawViewer(); };
  const fig = (it) => h("figure", {}, Object.assign(h("img", { src: it.url, alt: caption(it.name) }), { onload: fit }), h("figcaption", {}, `${it.name} · ${when(it.t)}`));
  const copy = async (ev) => {
    try { await navigator.clipboard.writeText(cur.path); }
    catch { const t = h("textarea", {}, cur.path); $("viewer").append(t); t.select(); document.execCommand("copy"); t.remove(); } // plain http: the older way
    ev.target.textContent = "Copied";
  };
  $("viewer").replaceChildren(
    h("div", { class: "bar" }, button("‹ Previous", step(-1), { id: "prev" }), button("Next ›", step(1), { id: "next" }), cur.shot && star(cur.name), button("Copy path", copy),
      button(ui.pinned ? "Stop comparing" : "Compare", () => { ui.pinned = ui.pinned ? null : cur; render(); drawViewer(); }), button("Close", () => $("viewer").close())),
    h("p", { class: "quiet" }, pin ? "Two pictures at the same scale. Previous and Next change the second one." : ui.pinned ? "Now go to the picture to compare with: Previous, Next, or close and open one." : `${ui.i + 1} of ${ui.list.length}`),
    h("div", { class: "stage" }, pin && fig(pin), fig(cur)));
  fit();
}
// size the pictures to the space: whole-number scale when there is room, one scale for both
function fit() {
  const stage = $("viewer").querySelector(".stage"), imgs = [...(stage?.querySelectorAll("img") ?? [])];
  if (!imgs.length || imgs.some((im) => !im.naturalWidth)) return;
  const W = stage.clientWidth, side = imgs.length > 1 && W > stage.clientHeight, H = stage.clientHeight - 30 * (side ? 1 : imgs.length), gap = 12 * (imgs.length - 1);
  const w = imgs.map((im) => im.naturalWidth), tall = imgs.map((im) => im.naturalHeight), sum = (a) => a.reduce((x, y) => x + y, 0);
  const kW = side ? (W - gap) / sum(w) : W / Math.max(...w), kH = side ? H / Math.max(...tall) : (H - gap) / sum(tall);
  let k = Math.min(kW, kH);
  const dpr = Math.round(devicePixelRatio) || 1; // whole screen pixels per game pixel
  k = k >= 1 ? Math.floor(k * dpr) / dpr : Math.min(1, kW); // too big for the screen: fit the width and let it scroll
  stage.classList.toggle("side", side);
  imgs.forEach((im, i) => { im.style.width = `${w[i] * k}px`; });
}

// ---- Scenes: each scene with its tick, idea, pictures and feed entries
function drawScenes() {
  const all = shots(), used = new Set(), onLadder = new Set();
  const card = (head, idea, entries, key) => {
    const pics = entries.map(picOf).filter(Boolean).reverse();
    pics.forEach((p) => p.shot && used.add(p.name));
    return h("section", { class: "card" }, head, idea,
      pics.length ? h("div", { class: "grid" }, pics.map((p) => tile(p, pics))) : h("p", { class: "quiet" }, "No pictures tied to this scene yet."),
      entries.length && h("details", { "data-key": key }, h("summary", {}, count(entries.length, "step")), [...entries].reverse().map((e) => entry(e))));
  };
  const cards = S.scenes.map((s) => {
    const entries = S.feed.filter((e) => e.scene && (parseInt(e.scene) === s.n || e.scene.includes(s.name)));
    entries.forEach((e) => onLadder.add(e));
    if (S.scenesFrom === "headings" && !entries.length) return null;
    return card(h("h3", { class: "scene" }, tick(s.done), s.label), s.idea && h("p", {}, s.idea), entries, `s${s.n}`);
  });
  // scene names in the feed that the list in game.md does not have (several agents, each under its own name)
  const named = streams(sceneName).filter((s) => !S.feed.some((e) => sceneName(e) === s.name && onLadder.has(e)))
    .map((s) => card(h("h3", {}, s.name), null, S.feed.filter((e) => sceneName(e) === s.name), `n${s.name}`));
  const rest = all.filter((p) => !used.has(p.name));
  return [S.scenesFrom === "headings" && h("p", { class: "quiet" }, "These scenes were found in the headings of game.md, which has no ticked scene list yet."),
    cards, named, rest.length && h("h2", {}, S.scenes.length ? "Not tied to a scene: grouped by the start of the file name" : "game.md has no scene list yet: pictures grouped by the start of their file name"),
    prefixGroups(rest)];
}

// ---- Maps: a card per map, a large view with layers, and which map leads to which
function mapBox(m, layers) {
  m = { ...m, width: +m.width || 1, height: +m.height || 1 }; // numbers only: these go into markup below
  const cells = [...(m.blocked ?? "")].map((c, i) => c === "1" ? `M${i % m.width} ${Math.floor(i / m.width)}h1v1h-1z` : "").join("");
  const box = h("div", { class: `mapbox ${Object.keys(layers).filter((k) => layers[k]).join(" ")}`, style: `aspect-ratio:${m.width}/${m.height}` });
  const view = `viewBox="0 0 ${m.width} ${m.height}" preserveAspectRatio="none"`;
  box.innerHTML = `<svg class="plan" ${view}><path d="${cells}"/></svg><img src="map/${encodeURIComponent(m.name)}?${Math.round(m.t ?? 0)}" alt="">
    <svg ${view}><path class="l-blocked" d="${cells}"/>${m.doors.map((d) => `<rect class="l-doors" x="${+d.x}" y="${+d.y}" width="1" height="1"><title>Door to ${esc(d.to)}</title></rect>`).join("")}
    ${(Array.isArray(m.people) ? m.people : []).map((p) => `<circle class="l-people" cx="${+p.x + 0.5}" cy="${+p.y + 0.5}" r="0.38"/>`).join("")}</svg>`;
  box.querySelector("img").onerror = (ev) => ev.target.remove(); // no picture of this map yet: the plan underneath shows
  return box;
}
function graph(maps) {
  const norm = (n) => n.toLowerCase().replace(/[^a-z0-9]/g, ""), own = (n) => maps.find((m) => norm(m.name) === norm(n))?.name ?? n; // doors name maps in plain words
  maps = maps.map((m) => ({ ...m, doors: m.doors.map((d) => ({ ...d, to: own(d.to) })), joins: m.joins.map((j) => ({ ...j, to: own(j.to) })) }));
  const names = [...new Set(maps.flatMap((m) => [m.name, ...m.doors.map((d) => d.to), ...m.joins.map((j) => j.to)]))];
  const at = (n) => { const i = names.indexOf(n); return [80 + (i % 2) * 160, 27 + Math.floor(i / 2) * 64]; };
  const lines = new Map();
  for (const m of maps) for (const [list, kind] of [[m.doors, "door"], [m.joins, "join"]]) for (const x of list) if (x.to !== m.name) lines.set([m.name, x.to].sort().join("|") + kind, [m.name, x.to, kind]);
  const box = h("div", { class: "graph" });
  box.innerHTML = `<svg viewBox="0 0 320 ${Math.ceil(names.length / 2) * 64}" role="img" aria-label="Which map leads to which">
    ${[...lines.values()].map(([a, b, kind]) => `<line class="${kind}" x1="${at(a)[0]}" y1="${at(a)[1]}" x2="${at(b)[0]}" y2="${at(b)[1]}"/>`).join("")}
    ${names.map((n) => `<rect class="${maps.some((m) => m.name === n) ? "mine" : ""}" x="${at(n)[0] - 72}" y="${at(n)[1] - 17}" width="144" height="34" rx="6"/><text x="${at(n)[0]}" y="${at(n)[1] + 4}">${esc(n)}</text>`).join("")}</svg>`;
  return box;
}
function drawMaps() {
  if (!S.maps.length) return h("p", { class: "card quiet" }, "The maps you make will appear here, each with its size, people and doors.");
  const big = S.maps.find((m) => m.name === ui.map), go = (name) => () => { ui.map = name; render(); };
  const facts = (m) => `${m.width} by ${m.height} squares · ${count(m.people.length ?? m.people, "person", "people")} · ${count(m.doors.length, "door")}`;
  const leads = (m) => h("ul", {}, m.doors.map((d) => h("li", {}, `Door at ${d.x}, ${d.y} leads to ${d.to}`)), m.joins.map((j) => h("li", {}, `Joined on the ${j.dir ?? j.direction} to ${j.to}`)));
  const layer = (key, label) => h("label", {}, Object.assign(h("input", { type: "checkbox", checked: ui.layers[key] }), { onchange: (ev) => { ui.layers[key] = ev.target.checked; render(); } }), ` ${label}`);
  if (big) return h("section", { class: "card" }, button("‹ All maps", go(null)), h("h3", {}, big.name), h("p", { class: "quiet" }, facts(big)),
    h("p", { class: "layers" }, layer("people", "People"), layer("doors", "Doors"), layer("blocked", "Where you cannot walk")), mapBox(big, ui.layers), leads(big));
  return [h("div", { class: "cards" }, S.maps.map((m) => h("section", { class: "card" }, h("h3", {}, m.name),
    button(mapBox(m, { people: true, doors: true }), go(m.name), { class: "shot", title: `Open ${m.name}` }), h("p", { class: "quiet" }, facts(m)), leads(m)))),
    h("section", { class: "card" }, h("h2", {}, "How the maps connect"), graph(S.maps), h("p", { class: "quiet" }, "A solid line is a door. A dashed line is two maps joined at an edge. Filled boxes are maps you made."))];
}

// ---- Lore: ids on the left; for one id its file, its pictures in time order, what points at it, its lineage
function prose(text) { // the lore file as headings, lists and paragraphs; `code` kept as code; nothing parsed as HTML
  const inline = (s) => s.split(/(`[^`]+`)/).map((part) => part.startsWith("`") && part.length > 2 ? h("code", {}, part.slice(1, -1)) : part);
  const out = []; let list = null;
  for (const line of text.split("\n")) {
    const head = line.match(/^(#+)\s+(.*)$/), li = line.match(/^\s*[-*]\s+(.*)$/);
    if (!li) list = null;
    if (head) out.push(h(head[1].length === 1 ? "h3" : "h2", {}, head[2]));
    else if (li) { if (!list) out.push(list = h("ul", {})); list.append(h("li", {}, inline(li[1]))); }
    else if (line.trim()) out.push(h("p", {}, inline(line)));
  }
  return out;
}
async function loadLore(id) {
  try {
    const r = await fetch("lore", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status === 404 ? "This pane was started before the Lore tab existed. Start it again to see the lore." : `The studio answered ${r.status}.`);
    L.list = await r.json(); L.error = null;
    ui.lore = id ?? ui.lore ?? L.list[0]?.id ?? null;
    if (ui.lore && L.one?.id !== ui.lore) L.one = null;
    if (ui.lore) { const one = await fetch(`lore/${encodeURIComponent(ui.lore)}`, { cache: "no-store" }); L.one = one.ok ? await one.json() : null; }
  } catch (e) { L.error = e.message.includes("fetch") ? "Cannot reach the studio." : e.message; }
  render();
}
function drawLore() {
  if (L.error) return h("p", { class: "card quiet" }, L.error);
  if (!L.list) return h("p", { class: "card quiet" }, "Reading the lore.");
  if (!L.list.length) return h("p", { class: "card quiet" }, "No lore yet. Each town, scene or notable object gets one small file in the game's lore folder; the agent makes the first in scene 1.");
  const ids = h("nav", { class: "ids", "aria-label": "Lore ids" }, L.list.map((l) => button([h("strong", {}, l.name), h("span", { class: "quiet" }, l.id), h("span", { class: "mood" }, l.mood)], () => loadLore(l.id), { "aria-pressed": String(l.id === ui.lore) })));
  const one = L.one;
  if (!one) return [ids, h("p", { class: "card quiet" }, "Choose one on the left.")];
  const pics = one.pictures.map(item("shots", true)), kinds = [["script", "Scripts"], ["tool", "Tools"], ["source", "Source"], ["notes", "Notes"], ["lore", "Other lore"]];
  const refs = kinds.map(([k, title]) => [title, one.references.filter((r) => r.kind === k)]).filter(([, rs]) => rs.length);
  const commits = (title, cs) => cs.length ? [h("h3", {}, title), h("ul", {}, cs.map((c) => h("li", {}, `${c.date} · ${c.subject} `, h("code", {}, c.hash))))] : null;
  return [ids, h("div", { class: "stack" },
    h("section", { class: "card prose" }, prose(one.text), one.missing_headings.length ? h("p", { class: "next" }, `Missing headings: ${one.missing_headings.join(", ")}`) : null),
    h("section", { class: "card" }, h("h2", {}, `Pictures · ${pics.length} · oldest first`), pics.length ? h("div", { class: "grid" }, pics.map((p) => tile(p, pics))) : h("p", { class: "quiet" }, "No picture is named after this id, its name or its map yet.")),
    h("section", { class: "card" }, h("h2", {}, `What points at it · ${one.references.length}`), refs.length ? refs.map(([title, rs]) => [h("h3", {}, title), h("ul", {}, rs.map((r) => h("li", {}, h("code", {}, `${r.file}:${r.line}`), ` ${r.context}`)))]) : h("p", { class: "quiet" }, "Nothing points at this id yet.")),
    h("section", { class: "card" }, h("h2", {}, "Lineage"), one.lineage.text ? h("div", { class: "prose" }, prose(one.lineage.text)) : h("p", { class: "quiet" }, "Nothing written under Lineage yet."),
      commits("Kept versions that changed this file", one.lineage.commits_file), commits("Kept versions that changed what points at it", one.lineage.commits_references)))];
}

// ---- Decisions: the agent's questions (kit decide), newest first; an answer goes to decisions.jsonl
function drawDecisions() {
  const all = [...(S.decisions ?? [])].reverse();
  if (!all.length) return h("p", { class: "card quiet" }, "No questions yet. When the agent needs you to choose something (a name, a look, which of two ways), it asks here and carries on with the rest.");
  const card = (d) => {
    const own = h("input", { type: "text", placeholder: Array.isArray(d.options) ? "Or say something else" : "Your answer", "aria-label": "Your answer", maxlength: 1000 });
    const say = (text) => async () => { if (!String(text ?? own.value).trim()) return; const res = await sendJson("decision", { id: d.id, answer: text ?? own.value }).catch(() => null); if (!res?.ok) $("status").textContent = "Your answer was not saved. Is the studio running?"; await refresh(); };
    const choose = [Array.isArray(d.options) && h("div", { class: "pair" }, d.options.map((o) => button(o === d.recommend ? [o, h("span", { class: "quiet" }, " · recommended")] : o, say(o), { "aria-pressed": String(d.answer === o) }))),
      h("div", { class: "pair" }, own, button("Send", say()))];
    return h("section", { class: "card decision" }, h("p", { class: "quiet" }, h("strong", {}, d.scene || "No scene"), ` · asked ${when(d.t)}`), h("p", { class: "did" }, d.question), d.detail && h("p", { class: "quiet" }, d.detail),
      d.answer === null ? choose : [h("p", { class: "said" }, `You chose: ${d.answer}`, h("span", { class: "quiet" }, ` · ${when(d.answered)}`)), h("details", { "data-key": `c${d.id}` }, h("summary", {}, "Change the answer"), choose)]);
  };
  const open = all.filter((d) => d.answer === null), done = all.filter((d) => d.answer !== null);
  return [h("h2", {}, `Waiting for you · ${open.length}`), open.length ? open.map(card) : h("p", { class: "card quiet" }, "Nothing is waiting."), done.length ? [h("h2", {}, `Answered · ${done.length}`), done.map(card)] : null];
}

// ---- Settings: the picture model and the helpers, kept in settings.json (other keys there are left alone)
async function loadSettings() {
  try { const r = await fetch("settings", { cache: "no-store" }); if (!r.ok) throw new Error(await r.text()); ST = { data: await r.json(), error: null, said: ST.said }; }
  catch (e) { ST = { data: null, error: e.message.includes("fetch") ? "Cannot reach the studio." : e.message, said: "" }; }
  render();
}
async function saveSettings(change, said) {
  const r = await fetch("settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) }).catch(() => null);
  ST.said = r?.ok ? said : `Not saved: ${r ? await r.text() : "cannot reach the studio"}.`;
  await loadSettings();
}
function drawSettings() {
  if (ST.error) return h("p", { class: "card quiet" }, ST.error);
  if (!ST.data) return h("p", { class: "card quiet" }, "Reading the settings.");
  const d = ST.data, models = Array.isArray(d.image_models) ? d.image_models.filter((m) => m?.id) : [], list = Array.isArray(d.workers) ? d.workers : [];
  const field = (label, value, on, attrs) => h("label", { class: "field" }, h("span", { class: "label" }, label), Object.assign(h("input", { type: "text", value: value || null, ...attrs }), { onchange: (ev) => on(ev.target.value.trim()) }));
  const pickModel = (id) => saveSettings({ image_model: id }, `Picture model: ${id}.`);
  const model = h("section", { class: "card" }, h("h2", {}, "Picture model"),
    h("p", { class: "quiet" }, "When the agent asks a picture model for a concept or a figure, it uses this one. ROM Studio makes no pictures itself; it only keeps your choice where the agent's tools read it."),
    models.length ? h("div", { class: "choices" }, models.map((m) => h("label", { class: "choice" }, Object.assign(h("input", { type: "radio", name: "image-model", checked: m.id === d.image_model }), { onchange: () => pickModel(m.id) }),
      h("span", {}, h("strong", {}, m.label || m.id), m.label && h("code", {}, m.id), m.note && h("span", { class: "quiet" }, m.note)))),
      !models.some((m) => m.id === d.image_model) && d.image_model && h("p", { class: "quiet" }, `Now: ${d.image_model} (not in the list)`))
      : field("Model id", d.image_model, pickModel, { placeholder: "the id your picture tool takes" }));
  const setList = (next, said, more) => saveSettings({ workers: next, ...more }, said);
  const edit = (i, change, said) => setList(list.map((w, at) => (at === i ? { ...w, ...change } : w)), said);
  const row = (w, i) => h("div", { class: "helper" },
    h("div", { class: "pair" }, h("label", { class: "choice" }, Object.assign(h("input", { type: "checkbox", checked: w.enabled !== false }), { onchange: (ev) => edit(i, { enabled: ev.target.checked }, `${w.name}: ${ev.target.checked ? "on" : "off"}.`) }), h("strong", {}, w.name)),
      h("label", { class: "choice" }, Object.assign(h("input", { type: "radio", name: "default-helper", checked: w.name === d.default_worker }), { onchange: () => saveSettings({ default_worker: w.name }, `${w.name} is the one the agent uses unless told otherwise.`) }), "Use by default"),
      button("Remove", () => setList(list.filter((_, at) => at !== i), `${w.name} removed.`, w.name === d.default_worker ? { default_worker: null } : {}))),
    field("Model", w.model, (v) => edit(i, { model: v }, `${w.name}: model ${v || "not set"}.`)),
    field("Command", w.how, (v) => edit(i, { how: v }, `${w.name}: command changed.`)),
    field("Note", w.note, (v) => edit(i, { note: v }, `${w.name}: note changed.`)));
  const fresh = { name: h("input", { type: "text", placeholder: "Name", "aria-label": "Helper name" }), how: h("input", { type: "text", placeholder: "Command that starts one, with <brief> where the task goes", "aria-label": "Command" }), model: h("input", { type: "text", placeholder: "Model (optional)", "aria-label": "Model" }) };
  const addOne = () => { const name = fresh.name.value.trim(); if (!name || list.some((w) => w.name === name)) { ST.said = name ? `There is already a helper called ${name}.` : "A helper needs a name."; drawn["tab-settings"] = null; return render(); }
    setList([...list, { name, how: fresh.how.value.trim(), model: fresh.model.value.trim() || undefined, enabled: true }], `${name} added.`); };
  const helpers = h("section", { class: "card" }, h("h2", {}, `Helpers · ${list.filter((w) => w.enabled !== false).length} on`),
    h("p", { class: "quiet" }, "Other agents the lead agent may hand a piece of work to. Switch on the ones it may use and choose the default; the agent reads this list before it delegates."),
    list.length ? list.map(row) : h("p", { class: "quiet" }, "None yet."),
    h("div", { class: "helper add" }, h("span", { class: "label" }, "Add a helper"), fresh.name, fresh.model, fresh.how, button("Add", addOne)));
  return [ST.said && h("p", { class: "card said", role: "status" }, ST.said), model, helpers];
}

function render() {
  if (!S) return;
  draw("tab-lore", [L, ui.lore, S.kept, seen], drawLore);
  draw("streams", [S.feed, S.reviews, ui.scene, ui.group, ui.allStreams, seen, Math.floor(Date.now() / 60000)], drawStreams);
  draw("feed-body", [S.feed, S.reviews, ui.scene, ui.group, ui.more, seen], drawFeed);
  draw("tab-decisions", S.decisions, drawDecisions);
  draw("tab-settings", ST, drawSettings);
  const open = (S.decisions ?? []).filter((d) => d.answer === null).length, work = S.feed.filter(waiting).length;
  $("tab-link-decisions").textContent = open ? `Decisions · ${open}` : "Decisions";
  draw("waiting", [open, work], () => [open > 0 && h("a", { href: "#decisions", class: "wait" }, `${count(open, "question")} from the agent ${open === 1 ? "is" : "are"} waiting for you`),
    work > 0 && h("p", { class: "quiet" }, `${count(work, "entry", "entries")} you marked “needs work” or left a note on ${work === 1 ? "has" : "have"} no answer from the agent yet.`)]);
  draw("ladder-body", [S.scenes, S.scenesFrom], drawLadder);
  drawGallery();
  draw("tab-scenes", [S.scenes, S.feed, S.shots, S.kept, seen], drawScenes);
  draw("tab-maps", [S.maps, ui.map, ui.layers], drawMaps);
  const here = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname), far = (S.playLinks ?? []).find((l) => { try { return new URL(l).hostname === location.hostname; } catch { return false; } }) ?? S.playFar, link = (here ? S.play : far ?? (S.play && !/\/\/(127\.0\.0\.1|localhost)/.test(S.play) ? S.play : null)) ?? null;
  $("play-link").toggleAttribute("href", false); if (link) $("play-link").href = link;
  $("play-link").textContent = link ? "Play your game" : S.play ? "The player only answers on the computer it runs on" : "The player is not running";
  $("play-link").classList.toggle("off", !link);
  $("play-how").textContent = link ? (S.playFar && !here ? "Opens over your own network. Accept the certificate warning once." : "") : S.play ? "For this device, ask your agent to run: kit play --phone" : "Ask your agent to run: kit play";
  const lb = S.lastBuild; // "OK 12s" or "FAILED 40s", written by kit build
  $("built").textContent = lb ? `Last build: ${/^FAILED/.test(lb.text) ? "failed" : "worked"} (${lb.text.replace(/^(OK|FAILED)\s*/, "") || "no time given"}) · ${when(lb.t)}` : S.built ? `Latest build: ${when(S.built)}` : "No build yet.";
  $("built").className = lb && /^FAILED/.test(lb.text) ? "built failed" : "built quiet";
}
async function refresh() {
  try {
    const r = await fetch("state", { headers: etag ? { "If-None-Match": etag } : {}, cache: "no-store" });
    if (r.status === 200) { etag = r.headers.get("ETag"); S = await r.json(); page ??= S.page; render(); }
    else render(); // nothing new: only the minute may have turned (quiet marks)
    $("status").textContent = S && S.page !== page ? "The studio was updated. Reload this page to get the new version." : "";
  } catch { $("status").textContent = "Cannot reach the studio. Trying again."; }
}
function showTab() {
  const tab = ["gallery", "scenes", "maps", "music", "dialogue", "source", "lore", "decisions", "settings"].find((t) => location.hash === `#${t}`) ?? "now";
  if (tab === "lore") loadLore();
  if (tab === "settings") loadSettings();
  for (const el of document.querySelectorAll(".tab")) el.hidden = el.id !== `tab-${tab}`;
  for (const a of $("tabs").children) a.setAttribute("aria-current", String(a.hash === `#${tab}`));
}
async function sendRefs(files) {
  for (const f of files) {
    let line;
    try {
      const r = await fetch(`refs/${encodeURIComponent(f.name.replace(/\s+/g, "-"))}`, { method: "PUT", body: f });
      line = r.ok ? `Sent ${f.name}.` : `Not sent: ${f.name} (${await r.text()}).`;
    } catch { line = `Not sent: ${f.name} (cannot reach the studio).`; }
    $("ref-sent").append(h("span", {}, line, " "));
  }
  refresh();
}

$("ref-file").onchange = (ev) => { sendRefs([...ev.target.files]); ev.target.value = ""; };
$("drop").ondragover = (ev) => ev.preventDefault();
$("drop").ondrop = (ev) => { ev.preventDefault(); sendRefs([...ev.dataTransfer.files]); };
$("search").oninput = (ev) => { ui.q = ev.target.value.trim().toLowerCase(); render(); };
let touchX = null; // swipe left or right in the large view
$("viewer").addEventListener("touchstart", (ev) => { touchX = ev.touches[0].clientX; }, { passive: true });
$("viewer").addEventListener("touchend", (ev) => { const dx = ev.changedTouches[0].clientX - touchX; if (Math.abs(dx) > 50) $(dx > 0 ? "prev" : "next").click(); });
addEventListener("keydown", (ev) => { if ($("viewer").open && (ev.key === "ArrowLeft" || ev.key === "ArrowRight")) $(ev.key === "ArrowLeft" ? "prev" : "next").click(); });
addEventListener("resize", fit);
addEventListener("hashchange", showTab);
// a host that embeds this page can post "feed" to make it look right away instead of at the next poll
addEventListener("message", (ev) => { if (ev.data === "feed") refresh(); });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { try { localStorage.paneSeen = Date.now(); } catch {} } else { seen = lastLook(); render(); refresh(); }
});
setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
setInterval(() => { if (!document.hidden && location.hash === "#lore") loadLore(); }, POLL_MS * 5);
showTab();
refresh();

// Appearance lives in theme.js: an embedded pane follows Desktop, a standalone page keeps its own choice.
