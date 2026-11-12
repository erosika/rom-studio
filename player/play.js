// Play page. The emulator draws into a canvas that is never visible; every picture goes through the
// flash guard (guard.js, always on, no switch) and only the guarded picture is drawn on screen.
// Plain JS, unbundled: the emulator starts its workers from its own script URL.
import { createGuard } from "/guard.js";
import { captureMemory, startLink } from "/hermes-link.js";
captureMemory(); // before the emulator's script makes its memory

const W = 240, H = 160;
const $ = (id) => document.getElementById(id);
const emuCanvas = $("emu"), screen = $("screen"), status = $("status");
const say = (t) => (status.textContent = t);
const params = new URLSearchParams(location.search);

// Phone link key: arrives once as #k=..., kept for this address.
const fragKey = new URLSearchParams(location.hash.slice(1)).get("k");
if (fragKey) { try { localStorage.setItem("playKey", fragKey); } catch {} history.replaceState(null, "", location.pathname + location.search); }
const key = () => { try { return localStorage.getItem("playKey") ?? ""; } catch { return ""; } };
const log = (text) => fetch("/log", { method: "POST", headers: { "x-key": key() }, body: text }).catch(() => {});
window.addEventListener("error", (e) => log(`error: ${e.message}`));
window.addEventListener("unhandledrejection", (e) => log(`error: ${e.reason?.message ?? e.reason}`));

// The guard copies the emulator's WebGL pictures, which needs the drawing buffer kept.
const realGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type, attrs) {
  if (this === emuCanvas && (type === "webgl2" || type === "webgl")) attrs = { ...(attrs ?? {}), preserveDrawingBuffer: true };
  return realGetContext.call(this, type, attrs);
};

// ---- the only path to the visible screen ----
const guard = createGuard(W, H);
const probe = document.createElement("canvas"); probe.width = W; probe.height = H;
const probeCtx = probe.getContext("2d", { willReadFrequently: true });
const out = screen.getContext("2d", { willReadFrequently: params.has("selftest") });
const shown = out.createImageData(W, H);
let source = null, afterPresent = null;
function present(now) {
  if (source) {
    probeCtx.drawImage(source, 0, 0, W, H);
    guard.step(probeCtx.getImageData(0, 0, W, H).data, now, shown.data);
    out.putImageData(shown, 0, 0);
    afterPresent?.(now);
  }
  requestAnimationFrame(present);
}
requestAnimationFrame(present);

async function boot() {
  if (!crossOriginIsolated) return say("this address cannot run the emulator: use http://127.0.0.1 on the computer, or the https phone link from `server.ts --lan`");
  say("starting the emulator");
  const { default: mGBA } = await import("/mgba/mgba.js");
  const emu = await mGBA({ canvas: emuCanvas });
  await emu.FSInit();
  emu.setCoreSettings({ autoSaveStateEnable: false, restoreAutoSaveStateOnLoad: false, rewindEnable: false });
  say("loading the game");
  const res = await fetch("/rom", { headers: { "x-key": key() } });
  if (!res.ok) return say(res.status === 401 ? "open the full phone link (with its key) once" : "no game built yet: run kit/build.sh, then reload");
  const romPath = `${emu.filePaths().gamePath}/game.gba`, rom = new Uint8Array(await res.arrayBuffer());
  emu.FS.writeFile(romPath, rom);
  let build = rom.length; for (let i = 0; i < rom.length; i += 4099) build = (build * 31 + rom[i]) >>> 0; // which build this is: a save point only fits the build it was made on
  if (!emu.loadGame(romPath)) return say("the emulator could not load the game");
  for (const [k, btn] of [["X", "A"], ["Z", "B"], ["Return", "Start"], ["Backspace", "Select"]]) emu.bindKey(k, btn);
  emu.addCoreCallbacks({ saveDataUpdatedCallback: () => emu.FSSync() });
  emu.pauseAudio(); // sound starts off
  $("sound").addEventListener("change", (e) => (e.target.checked ? emu.resumeAudio() : emu.pauseAudio()));
  document.addEventListener("visibilitychange", () => (document.hidden ? emu.pauseGame() : emu.resumeGame()));
  bindPad(emu);
  const stored = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  $("pointSave").onclick = async () => {
    if (!emu.saveState(1)) return say("could not make a save point");
    await emu.FSSync(); try { localStorage.setItem("pointBuild", String(build)); } catch {}
    say("save point made (for this build; use the game's own SAVE to keep progress across builds)");
  };
  $("pointLoad").onclick = () => {
    const made = stored("pointBuild");
    if (!made) return say("no save point yet");
    if (made !== String(build)) return say("that save point is from an older build and cannot be loaded; the game's own SAVE still works: choose CONTINUE");
    say(emu.loadState(1) ? "back at the save point" : "could not load the save point");
  };
  source = emuCanvas;
  say("");
  log(`game running (${navigator.userAgent.slice(0, 80)})`);
  startLink(emu, { log, key }).catch((err) => log(`agent link error: ${err?.message ?? err}`));
  if (params.has("debug")) window.emu = emu; // for scripts
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
}

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
    const text = `selftest: ${seen.length} pictures in 8 s; opposite changes in the worst second: fed ${worst(fed)}, visible ${worst(seen)} (${worst(seen) <= 2 ? "PASS" : "FAIL"})`;
    say(text); log(text);
  };
}

if (params.has("selftest")) selftest();
else boot().catch((err) => { say(`error: ${err.message ?? err}`); log(`error: ${err.message ?? err}`); });
