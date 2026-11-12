// The watch page: asks for the newest picture and the words beside it, and shows them. It sends nothing else.
const $ = (id) => document.getElementById(id);
const screen = $("screen"), ctx = screen.getContext("2d"), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ctx.imageSmoothingEnabled = false;

function fit() { // the largest whole-number size that fits: every game pixel is the same number of screen pixels
  const side = matchMedia("(max-width: 44rem)").matches ? 0 : 300;
  const k = Math.max(1, Math.floor(Math.min((innerWidth - 40 - side) / 240, (innerHeight - 40) / 160)));
  screen.style.width = `${240 * k}px`; screen.style.height = `${160 * k}px`;
}
addEventListener("resize", fit); fit();

async function pictures() {
  for (let after = 0; ; ) {
    try {
      const r = await fetch(`/frame?after=${after}`);
      if (r.status === 200) { after = Number(r.headers.get("x-frame")) || after; const bmp = await createImageBitmap(await r.blob()); ctx.drawImage(bmp, 0, 0); bmp.close(); }
      else if (r.status !== 204) await sleep(1000);
    } catch { after = 0; await sleep(2000); }
  }
}
const time = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h ? `${h} h ` : ""}${h || m ? `${m} min ` : ""}${Math.floor(s % 60)} s`; };
function show(s) {
  $("status").textContent = s.playing ? `Playing: ${s.agent}` : `Not playing${s.ended ? `: ${s.ended}` : ""}`;
  $("thought").textContent = s.thought || "-";
  $("text").textContent = s.text || "-";
  $("where").textContent = s.where ? `map ${s.where.map}, square ${s.where.x},${s.where.y}, facing ${s.where.facing}${s.where.control ? "" : " (cannot move right now)"}` : "not on a map yet";
  $("played").textContent = `${time(s.played_seconds)}, ${s.steps} steps (${s.steps_left} left in this run)`;
  const rows = s.last.slice().reverse().map((p) => {
    const li = document.createElement("li");
    for (const [cls, text] of [["n", `#${p.step}`], ["do", p.do || "-"], ["thought", p.thought], ["result", p.result]]) { const e = document.createElement("span"); e.className = cls; e.textContent = text; li.append(e); }
    return li;
  });
  $("last").replaceChildren(...rows);
}
async function words() {
  for (;;) {
    try { const r = await fetch("/state"); if (r.ok) show(await r.json()); }
    catch { $("status").textContent = "Not playing: nothing answers at this address"; }
    await sleep(1000);
  }
}
pictures(); words();
