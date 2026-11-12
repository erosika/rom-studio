// Play page. The emulator draws into a canvas that is never visible; every picture goes through the
// flash guard (guard.js, always on, no switch) and only the guarded picture is drawn on screen.
// Plain JS, unbundled: the emulator starts its workers from its own script URL.
import { createGuard } from "/guard.js";
import { captureMemory, gameMemory, startLink } from "/hermes-link.js";
import { probe } from "/ram.js";
import { encodeLabel, normalize } from "/game-text.js";
import { SLOW_RUN, advice, buildOfName, clock, fileName, lacks, lacksSaves, namingMax, pace, pointProblem, saveProblem } from "/checks.js";
captureMemory(); // before the emulator's script makes its memory

const W = 240, H = 160, POINT = 1, SLEEP = 9; // the save point's slot; the one made by itself when the tab is put away
const $ = (id) => document.getElementById(id);
const emuCanvas = $("emu"), screen = $("screen"), status = $("status");
const say = (t) => (status.textContent = t);
const params = new URLSearchParams(location.search);
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const stored = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const session = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch {} } }; // lasts as long as the tab, a reload included
const store = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch { return false; } };

// Phone link key: arrives once as #k=..., kept for this address.
const fragKey = new URLSearchParams(location.hash.slice(1)).get("k");
if (fragKey) { store("playKey", fragKey); history.replaceState(null, "", location.pathname + location.search); }
const key = () => stored("playKey") ?? "";
const api = (path, init = {}) => fetch(path, { ...init, headers: { "x-key": key(), ...(init.headers ?? {}) } });
const log = (text) => api("/log", { method: "POST", body: text }).catch(() => {});
window.addEventListener("error", (e) => log(`error: ${e.message}`));
window.addEventListener("unhandledrejection", (e) => log(`error: ${e.reason?.message ?? e.reason}`));

/** A line above the controls that stays until it is answered or taken back: `label` and `act` add one button. */
function notice(text, label, act) {
  $("notice").hidden = !text; $("noticeText").textContent = text ?? "";
  $("noticeDo").hidden = !label; $("noticeDo").textContent = label ?? ""; $("noticeDo").onclick = act ?? null;
}

// The guard copies the emulator's WebGL pictures, which needs the drawing buffer kept.
const realGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type, attrs) {
  if (this === emuCanvas && (type === "webgl2" || type === "webgl")) attrs = { ...(attrs ?? {}), preserveDrawingBuffer: true };
  return realGetContext.call(this, type, attrs);
};

// ---- the only path to the visible screen ----
const guard = createGuard(W, H);
const probeCanvas = document.createElement("canvas"); probeCanvas.width = W; probeCanvas.height = H;
const probeCtx = probeCanvas.getContext("2d", { willReadFrequently: true });
const out = screen.getContext("2d", { willReadFrequently: params.has("selftest") });
const shown = out.createImageData(W, H);
let source = null, afterPresent = null, lowPower = stored("lowPower") === "1";
const meter = { since: 0, frames: null, shows: 0, drawn: 0, cost: 0, gap: 0, held: 0, last: 0, lastDrawn: 0 }; // what pace() is told
function present(now) {
  requestAnimationFrame(present);
  if (meter.last) meter.gap = Math.max(meter.gap, now - meter.last);
  meter.last = now; meter.shows++;
  // the game makes 60 pictures a second: a faster display is not fed the same one twice, and low power shows every other one
  if (!source || now - meter.lastDrawn < (lowPower ? 25 : 10)) return;
  meter.lastDrawn = now;
  const t = performance.now();
  probeCtx.drawImage(source, 0, 0, W, H);
  const r = guard.step(probeCtx.getImageData(0, 0, W, H).data, now, shown.data);
  out.putImageData(shown, 0, 0);
  meter.drawn++; meter.held += r.damped; meter.cost += performance.now() - t;
  afterPresent?.(now);
}
requestAnimationFrame(present);

/** Asks the computer about the game until it answers and a built game is there; says plainly what it is waiting for. */
async function gameOnDisk() {
  for (let tries = 0; ; tries++) {
    let r = null; try { r = await api("/game"); } catch {}
    if (r?.status === 401) { say("This link is missing its key. Open the full phone link (the one ending in #k=…) once."); return null; }
    const info = r?.ok ? await r.json().catch(() => null) : null;
    if (info?.build) return info;
    say(info ? "No built game on the computer yet. Ask your agent to build it (or run `kit build` there). This page starts by itself when it is ready."
      : "The computer does not answer. Is the player still running there (`kit play`)? Trying again every few seconds.");
    if (!tries) log(info ? "waiting: no built game" : "waiting: no answer");
    await wait(3000);
  }
}

async function boot() {
  const gl = document.createElement("canvas"), env = { wasm: typeof WebAssembly === "object", secure: isSecureContext, isolated: crossOriginIsolated, shared: typeof SharedArrayBuffer === "function",
    webgl: !!(gl.getContext("webgl2") ?? gl.getContext("webgl")), storage: !!window.indexedDB && store("canKeep", "1") };
  const missing = lacks(env); if (missing) { log(`cannot run: ${missing}`); return say(missing); }
  const info = await gameOnDisk(); if (!info) return;
  say("starting the emulator");
  const { default: mGBA } = await import("/mgba/mgba.js");
  const emu = await mGBA({ canvas: emuCanvas });
  let keeps = env.storage; try { await emu.FSInit(); } catch { keeps = false; }
  if (!keeps) notice(lacksSaves({ storage: false }));
  // set once, before the game is loaded: changing the emulator's timing while it runs makes it run fast
  emu.setCoreSettings({ autoSaveStateEnable: false, restoreAutoSaveStateOnLoad: false, rewindEnable: false, ...(lowPower ? { frameSkip: 1, audioBufferSize: 2048 } : {}) });
  say("loading the game");
  let res = null; try { res = await api("/rom"); } catch {}
  if (!res?.ok) return say(res?.status === 401 ? "This link is missing its key. Open the full phone link (the one ending in #k=…) once." : "The game could not be fetched from the computer. Reload the page to try again.");
  const rom = new Uint8Array(await res.arrayBuffer()), FS = emu.FS, paths = emu.filePaths(), id = info.id, exists = (f) => FS.analyzePath(f).exists;
  let hash = rom.length; for (let i = 0; i < rom.length; i += 4099) hash = (hash * 31 + rom[i]) >>> 0; // which build this is: a save point only fits the build it was made on
  const build = hash.toString(16).padStart(8, "0");
  // saves are kept per game, under a name the computer gives that stays the same across builds; the game file itself is not kept (32 MB a build)
  const romPath = `/rom/${id}.gba`, savePath = `${paths.savePath}/${id}.sav`, statePath = (slot) => `${paths.saveStatePath}/${id}.ss${slot}`;
  try { FS.mkdir("/rom"); } catch {}
  FS.writeFile(romPath, rom);
  try { // before saves were kept per game they were all called "game": the first game opened here takes them over
    for (const [old, now] of [[`${paths.savePath}/game.sav`, savePath], [`${paths.saveStatePath}/game.ss${POINT}`, statePath(POINT)]]) if (exists(old) && !exists(now)) FS.rename(old, now);
    if (exists(`${paths.gamePath}/game.gba`)) FS.unlink(`${paths.gamePath}/game.gba`);
    const old = stored("pointBuild"); if (old && !stored(`point:${id}`)) store(`point:${id}`, JSON.stringify({ build: Number(old).toString(16).padStart(8, "0"), at: 0 }));
    store("pointBuild", null);
  } catch (err) { log(`older saves not carried over: ${err?.message ?? err}`); }
  if (!emu.loadGame(romPath, savePath)) return say("The emulator could not load the game. Rebuild it on the computer, then reload this page.");
  for (const [k, btn] of [["X", "A"], ["Z", "B"], ["Return", "Start"], ["Backspace", "Select"]]) emu.bindKey(k, btn);

  // ---- keeping things: one write to the browser's storage at a time ----
  let syncing = Promise.resolve(), asked = false;
  const sync = () => (syncing = syncing.then(() => emu.FSSync()).catch((err) => log(`could not keep in the browser: ${err?.message ?? err}`)));
  const persist = () => { if (!asked) { asked = true; navigator.storage?.persist?.().catch(() => {}); } }; // asks the browser not to clear this page's saves when it is short of room
  const meta = (name) => { try { return JSON.parse(stored(`${name}:${id}`) ?? "null"); } catch { return null; } };
  /** A save point in `slot`; its note (which build, when) is written only once the browser has really kept the file. */
  function makePoint(slot, name) {
    if (!emu.saveState(slot)) return null;
    const at = Date.now();
    return sync().then(() => { store(`${name}:${id}`, JSON.stringify({ build, at })); return at; });
  }
  const sound = $("sound"), setSound = () => { if (sound.checked) { emu.SDL2?.audioContext?.resume?.(); emu.resumeAudio(); } else emu.pauseAudio(); };
  let crashed = false, leaving = false;
  emu.addCoreCallbacks({ // never the per-frame ones: they make the emulator wait for this page on every frame
    saveDataUpdatedCallback: () => { persist(); sync().then(notes); },
    coreCrashedCallback: () => { crashed = true; session.set(`asleep:${id}`, null); log("the emulator reported a crash"); notice("The game stopped: the emulator reported a crash. What you saved is kept.", "restart the game", restart); },
  });
  emu.pauseAudio(); // sound starts off
  sound.addEventListener("change", setSound);
  const pad = bindPad(emu);

  // ---- away and back: the tab hidden, the phone locked, the page put to sleep or thrown away by the browser ----
  let lock = null, asleep = false;
  const stayAwake = async () => { try { if (!lock || lock.released) lock = await navigator.wakeLock?.request("screen"); } catch {} }; // the phone's screen does not dim while the game is up
  function away() {
    if (leaving) return;
    pad.releaseAll(); emu.pauseGame();
    if (crashed || !source) return;
    asleep = true; // if the browser throws the page away while it is hidden, the reloaded page carries on from here: marked only once the moment is really kept
    makePoint(SLEEP, "sleep")?.then(() => { if (asleep) session.set(`asleep:${id}`, build); });
  }
  function back() {
    if (document.hidden || leaving) return;
    emu.resumeGame(); setSound(); // resuming the game also resumes its sound, wanted or not
    asleep = false; session.set(`asleep:${id}`, null); stayAwake(); meter.since = 0;
  }
  document.addEventListener("visibilitychange", () => (document.hidden ? away() : back()));
  window.addEventListener("pagehide", away); window.addEventListener("pageshow", (e) => { if (e.persisted) back(); });
  document.addEventListener("resume", back); // a frozen tab let go again
  window.addEventListener("pointerdown", stayAwake, { once: true }); window.addEventListener("keydown", stayAwake, { once: true });
  const reload = (fresh) => { if (fresh) { leaving = true; session.set(`asleep:${id}`, null); location.reload(); } else { away(); leaving = true; syncing.then(() => { session.set(`asleep:${id}`, build); location.reload(); }); } };
  function restart() { reload(true); } // like switching the machine off and on: the game's own save is untouched
  emuCanvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); log("graphics context lost"); notice("The browser took the picture away from this page (its graphics were reset).", "bring it back", () => reload(false)); });

  // ---- save point and the game's own save ----
  const pick = () => new Promise((done) => { const f = $("file"); f.value = ""; f.onchange = async () => done(f.files[0] ? { name: f.files[0].name, bytes: new Uint8Array(await f.files[0].arrayBuffer()) } : null); f.click(); });
  function download(bytes, name) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" })); a.download = name;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  }
  const saved = () => { const b = exists(savePath) ? FS.readFile(savePath) : null; return b && !b.every((x) => x === 0xff) && !b.every((x) => x === 0) ? b : null; };
  function notes() {
    const p = meta("point"), s = saved();
    $("pointNote").textContent = !p ? "No save point yet." : p.build !== build ? "The save point here is from an older build of the game and cannot be loaded." : `Save point${p.at ? ` made at ${clock(p.at)}` : ""}, on this build.`;
    $("saveNote").textContent = s ? `In this browser now: a save of ${Math.round(s.length / 1024)} KB, last written at ${clock(FS.stat(savePath).mtime.getTime())}.` : "The game has not been saved yet.";
    $("pointExport").disabled = !p; $("saveExport").disabled = !s;
  }
  $("pointSave").onclick = () => {
    persist(); const made = makePoint(POINT, "point");
    if (!made) return say("Could not make a save point.");
    say("Save point made. It fits this build only; saving inside the game (START, then SAVE) is what lasts across builds.");
    made.then(notes);
  };
  $("pointLoad").onclick = () => {
    const p = meta("point");
    if (!p) return say("No save point yet: press save here first.");
    if (p.build !== build) return say("That save point is from an older build and cannot be loaded. The game's own save still works: choose CONTINUE on the title screen.");
    say(emu.loadState(POINT) ? `Back at the save point${p.at ? ` from ${clock(p.at)}` : ""}.` : "Could not load the save point.");
  };
  $("pointExport").onclick = () => { const p = meta("point"); if (p && exists(statePath(POINT))) { download(FS.readFile(statePath(POINT)), fileName("point", id, p.build, p.at || Date.now())); say("Save point exported as a file."); } };
  $("pointImport").onclick = async () => {
    const f = await pick(); if (!f) return;
    const problem = pointProblem(f.bytes), from = buildOfName(f.name); if (problem) return say(problem);
    if (from && from !== build) return say(`That save point was made on another build of the game (${from}; this one is ${build}) and cannot be loaded here.`);
    if (!from && !confirm("This file's name does not say which build it was made on. A save point from another build shows a broken game. Load it anyway?")) return;
    FS.writeFile(statePath(POINT), f.bytes); store(`point:${id}`, JSON.stringify({ build, at: Date.now() })); sync(); notes();
    say(emu.loadState(POINT) ? "Save point imported and loaded." : "The file was taken in, but the emulator could not load it: it is from another build or another emulator.");
  };
  $("saveExport").onclick = () => { const s = saved(); if (s) { download(s, fileName("save", id, build, Date.now())); say("The game's save exported as a file."); } };
  $("saveImport").onclick = async () => {
    const f = await pick(); if (!f) return;
    const now = saved(), problem = saveProblem(f.bytes, now?.length ?? 0); if (problem) return say(problem);
    if (now && !confirm("Replace this game's own save with the file? The save kept in this browser now is lost unless you exported it.")) return;
    leaving = true; emu.quitGame(); await wait(100); // the running game would write its own save back over the file
    FS.writeFile(savePath, f.bytes); session.set(`asleep:${id}`, null);
    say("Save imported. Starting the game again: choose CONTINUE."); sync().then(() => location.reload());
  };
  $("lowPower").checked = lowPower;
  $("lowPower").onchange = (e) => { store("lowPower", e.target.checked ? "1" : null); say(e.target.checked ? "Low power on. Coming straight back to where you are." : "Low power off. Coming straight back to where you are."); reload(false); };
  for (const b of ["pointSave", "pointLoad", "pointImport", "saveImport"]) $(b).disabled = false;
  notes();

  // carry on where the tab was put away, when the browser threw the page out and loaded it again
  const slept = meta("sleep");
  let carried = false;
  if (session.get(`asleep:${id}`) === build && slept?.build === build && exists(statePath(SLEEP))) for (let i = 0; i < 15 && !carried; i++) { await wait(200); carried = !!emu.loadState(SLEEP); } // the emulator takes no save point in the instant the game is loaded
  say(carried ? `Carried on from where this tab was left at ${clock(slept.at)}.` : "");
  if (carried) log("carried on after the page was reloaded");
  session.set(`asleep:${id}`, null);
  source = emuCanvas;
  log(`game running, build ${build}${lowPower ? ", low power" : ""} (${navigator.userAgent.slice(0, 80)})`);
  startLink(emu, { log, key }).catch((err) => log(`agent link error: ${err?.message ?? err}`));

  // ---- the game's memory, found once: the emulator's frame counter for the pace, the naming screen for typing ----
  let ram = null;
  (async () => { // a slow start has no save point to give yet: looked for again a few times, then left alone
    for (let i = 0; i < 5 && !(ram?.ok && ram.counts) && !leaving;) {
      await wait(i ? 4000 : 2500); if (document.hidden) continue; // a tab opened in the background is looked at once it is in front
      i++;
      const r = await probe(emu, gameMemory()).catch((err) => (log(`memory: ${err?.message ?? err}`), null));
      if (r && (r.ok || !ram?.ok)) ram = r;
      meter.since = 0; // the look holds the game still for a moment: not counted as slow
    }
    log(`memory: ${!ram ? "not found" : `${ram.ok ? "found" : "not found"}, frame counter ${ram.counts ? "found" : "not found"}`}`); if (params.has("debug")) window.ram = ram;
  })();

  // ---- pace: the emulator's speed against the display, said in the panel; a slow run is said once ----
  let slowRun = 0, told = false;
  setInterval(() => {
    const now = performance.now(), frames = ram?.counts ? ram.frames() : null;
    if (document.hidden || !meter.since) { Object.assign(meter, { since: now, frames, shows: 0, drawn: 0, cost: 0, gap: 0, held: 0 }); return; }
    const p = pace({ ms: now - meter.since, frames: frames !== null && meter.frames !== null ? frames - meter.frames : null, shows: meter.shows, drawn: meter.drawn, cost: meter.cost, gap: meter.gap, held: meter.held }, { lowPower, sound: sound.checked });
    Object.assign(meter, { since: now, frames, shows: 0, drawn: 0, cost: 0, gap: 0, held: 0 });
    if (!$("panel").hidden) $("pace").textContent = `Last 2 seconds: ${p.line}.`;
    slowRun = p.slow ? slowRun + 1 : 0;
    if (slowRun === SLOW_RUN && !told && $("notice").hidden) { told = true; log(`slow: ${p.line}`); notice(advice(p.why, lowPower), "ok", () => notice(null)); }
    if (params.has("debug")) window.pace = p;
  }, 2000);

  // ---- the link to the computer: lost, back, or a newer build waiting there ----
  let misses = 0, lost = false;
  setInterval(async () => {
    if (document.hidden || leaving) return;
    let now = null; try { const r = await api("/game"); now = r.ok ? await r.json() : null; } catch {}
    misses = now ? 0 : misses + 1;
    if (misses === 2) { lost = true; notice("Lost the connection to the computer. The game keeps running here and its saves stay in this browser; the agent and new builds need the connection back."); }
    if (now && lost) { lost = false; notice(null); }
    if (now?.build && now.build !== info.build && $("noticeDo").dataset.build !== now.build) { $("noticeDo").dataset.build = now.build; notice("A newer build of the game is ready on the computer. Save inside the game first if you want to keep your place.", "load the new build", () => reload(true)); }
  }, 5000);

  // ---- typing a name: the game's own naming screen takes the letters from the line under the picture ----
  const box = $("ask"), input = $("askText"), EOS = 0xff, table = { chars: info.chars ?? {}, widths: [] };
  const letterOf = {}; for (const [c, b] of Object.entries(table.chars)) letterOf[b] ??= c; // the first character the game's table gives each byte
  let naming = 0, max = 0;
  const hint = matchMedia("(pointer: coarse)").matches ? "Tap the line under the picture to type the name. The letters in the game work too." : "Type the name in the line under the picture. The letters in the game work too.";
  box.addEventListener("submit", (e) => e.preventDefault()); // never the browser's own sending of the form, which would load the page again
  const word = (addr) => { const b = ram.read(addr, 4); return b ? (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0 : 0; };
  const romAt = (addr, n) => { const o = addr - 0x08000000; return o >= 0 && o + n <= rom.length ? rom.subarray(o, o + n) : null; };
  const tap = async (btn) => { emu.buttonPress(btn); await wait(120); emu.buttonUnpress(btn); await wait(220); };
  function closeName() {
    if (box.dataset.mode !== "name") return;
    delete box.dataset.mode; box.hidden = true; box.onsubmit = $("askCancel").onclick = input.onkeydown = null; if (status.textContent === hint) say("");
    input.maxLength = 400; input.placeholder = "Type here, then press Enter"; $("askSend").textContent = "send"; input.blur(); emu.toggleInput(true);
  }
  function openName() {
    if (!box.hidden) return input.focus();
    box.dataset.mode = "name"; box.hidden = false; $("typeOpen").hidden = true; emu.toggleInput(false);
    const now = ram.read(naming + info.naming.text, max) ?? [], end = now.indexOf(EOS); // the name the game already proposes, if any
    input.value = [...now.slice(0, end < 0 ? max : end)].map((b) => letterOf[b] ?? "").join("");
    input.maxLength = max; input.placeholder = `Name, up to ${max} letters`; $("askSend").textContent = "use it";
    input.focus({ preventScroll: true });
    say(hint);
    box.onsubmit = (e) => { e.preventDefault(); const text = input.value; closeName(); typeName(text); };
    $("askCancel").onclick = () => { closeName(); $("typeOpen").hidden = false; };
    input.onkeydown = (e) => { if (e.key === "Escape") $("askCancel").onclick(); e.stopPropagation(); };
  }
  async function typeName(text) {
    const letters = [...normalize(text, table)].slice(0, max).join(""), bytes = new Uint8Array(16).fill(EOS);
    if (!letters) { $("typeOpen").hidden = false; return say("None of those letters are in this game's font. Try plain letters and digits."); }
    bytes.set(encodeLabel(letters, table, max + 1));
    const at = naming;
    if (!ram.write(at + info.naming.text, bytes)) return say("Could not hand the name to the game. Use the letters in the game.");
    await tap("Start"); await tap("A"); // START moves the game's cursor to OK; A takes the name
    for (let i = 0; i < 12 && word(info.naming.at) === at; i++) await wait(250);
    say(word(info.naming.at) === at ? `The name ${letters} is in. Press START, then A, in the game to accept it.` : `Name given: ${letters}.`);
  }
  $("typeOpen").onclick = () => { if (naming && max) openName(); };
  setInterval(() => {
    if (!ram?.ok || !info.naming) return;
    const p = word(info.naming.at), up = p >= 0x02000000 && p < 0x02040000 ? p : 0;
    if (up === naming) return;
    naming = up; closeName(); $("typeOpen").hidden = true;
    if (!up) return;
    max = namingMax((i) => word(up + info.naming.text + i * 4), romAt) ?? 0;
    log(`naming screen: ${max ? `up to ${max} letters` : "its rules were not found; the game's own letters only"}`);
    if (max) openName();
  }, 300);

  if (params.has("debug")) Object.assign(window, { emu, playerState: () => ({ id, build, naming, max, lowPower, point: meta("point"), sleep: meta("sleep"), saved: !!saved() }) }); // for scripts
  if (params.has("report")) setTimeout(() => { // for checking from a script: is the visible screen showing a picture?
    const px = out.getImageData(0, 0, W, H).data; let lit = 0; const seen = new Set();
    for (let i = 0; i < px.length; i += 4) { if (px[i] + px[i + 1] + px[i + 2] > 24) lit++; seen.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]); }
    log(`report: ${lit} of ${W * H} pixels lit, ${seen.size} colours on the visible screen`);
  }, Number(params.get("report")) || 8000);
}

// On-screen pad: pointer events, so a thumb can slide between buttons.
function bindPad(emu) {
  const held = new Map(), pad = $("pad");
  const press = (el) => { el.classList.add("held"); emu.buttonPress(el.dataset.btn); };
  const release = (el) => { el.classList.remove("held"); emu.buttonUnpress(el.dataset.btn); };
  const target = (e) => document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-btn]");
  pad.addEventListener("pointerdown", (e) => { const el = target(e); if (!el) return; e.preventDefault(); pad.setPointerCapture(e.pointerId); held.set(e.pointerId, el); press(el); });
  pad.addEventListener("pointermove", (e) => {
    const prev = held.get(e.pointerId); if (!prev) return;
    const el = target(e); if (el === prev) return;
    release(prev);
    if (el) { held.set(e.pointerId, el); press(el); } else held.delete(e.pointerId);
  });
  const end = (e) => { const el = held.get(e.pointerId); if (el) release(el); held.delete(e.pointerId); };
  pad.addEventListener("pointerup", end); pad.addEventListener("pointercancel", end);
  pad.addEventListener("contextmenu", (e) => e.preventDefault());
  return { releaseAll: () => { for (const el of held.values()) release(el); held.clear(); } }; // a button held when the tab is put away must not stay down
}

$("more").onclick = () => { const p = $("panel"); p.hidden = !p.hidden; $("more").setAttribute("aria-expanded", String(!p.hidden)); if (!p.hidden) p.scrollIntoView({ block: "nearest" }); };

// Guard self-check in the real page (?selftest): a made-up flashing source that is never shown goes
// through the same path as the game, and the VISIBLE canvas is measured. For scripts, not for people.
function selftest() {
  const fake = document.createElement("canvas"); fake.width = W; fake.height = H;
  const ctx = fake.getContext("2d", { willReadFrequently: true }), t0 = performance.now(), seen = [], fed = [];
  const lin = (b) => { const c = b / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = (px) => { let s = 0; for (let i = 0; i < px.length; i += 16) s += 0.2126 * lin(px[i]) + 0.7152 * lin(px[i + 1]) + 0.0722 * lin(px[i + 2]); return s / (px.length / 16); };
  const worst = (rows) => { // most opposite changes of 10% within one second
    const at = []; let dir = 0, ext = rows[0][1];
    for (const [t, v] of rows) { if (dir === 0) { if (Math.abs(v - ext) >= 0.1) { dir = Math.sign(v - ext); at.push(t); ext = v; } } else if ((v - ext) * dir > 0) ext = v; else if ((ext - v) * dir >= 0.1) { dir = -dir; at.push(t); ext = v; } }
    let w = 0; for (let i = 0; i < at.length; i++) { let j = i; while (j < at.length && at[j] - at[i] <= 1000) j++; w = Math.max(w, j - i); }
    return w;
  };
  const paint = () => { // 0-4 s: whole screen black/white at 10 Hz; 4-8 s: top-left quarter red/white at 8 Hz
    const t = performance.now() - t0;
    if (t < 4000) { ctx.fillStyle = Math.floor(t / 50) % 2 ? "#fff" : "#000"; ctx.fillRect(0, 0, W, H); }
    else { ctx.fillStyle = "#567"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = Math.floor(t / 62) % 2 ? "#fff" : "#f00"; ctx.fillRect(0, 0, 120, 80); }
    return t;
  };
  paint(); source = fake;
  afterPresent = () => {
    const t = performance.now() - t0, part = t < 4000 ? [0, 0, W, H] : [0, 0, 120, 80];
    seen.push([t, lum(out.getImageData(...part).data)]); fed.push([t, lum(ctx.getImageData(...part).data)]);
    if (paint() < 8000) return;
    afterPresent = null; source = null;
    const text = `selftest: ${seen.length} pictures in 8 s${lowPower ? " (low power)" : ""}; opposite changes in the worst second: fed ${worst(fed)}, visible ${worst(seen)} (${worst(seen) <= 2 ? "PASS" : "FAIL"})`;
    say(text); log(text);
  };
}

if (params.has("selftest")) selftest();
else boot().catch((err) => { say(`The player stopped: ${err.message ?? err}. Reload the page to try again.`); log(`error: ${err.message ?? err}`); });
