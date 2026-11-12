// pane/server.test.ts: the server against a copy of the sample game folder. Run: bun test pane
import { afterAll, beforeAll, expect, test } from "bun:test";
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";

let PORT = 0, URL_ = ""; // the server takes a free port and says which
const game = mkdtempSync(join(tmpdir(), "pane-test-")), data = mkdtempSync(join(tmpdir(), "pane-data-"));
let server: ReturnType<typeof Bun.spawn>;

beforeAll(async () => {
  cpSync(join(import.meta.dir, "sample"), game, { recursive: true });
  rmSync(join(game, "refs"), { recursive: true, force: true });
  writeFileSync(join(game, "Makefile"), ""); Bun.spawnSync(["git", "-C", game, "init", "-q"]); // enough of a game folder for the kit's own commands
  ({ server, port: PORT } = await start("127.0.0.1")); URL_ = `http://127.0.0.1:${PORT}`;
});
async function start(bind: string) {
  const server = Bun.spawn(["bun", join(import.meta.dir, "server.ts"), "--game", game, "--port", "0", "--bind", bind, "--data", data], { stdout: "pipe", stderr: "inherit" });
  let said = ""; for await (const chunk of server.stdout) { said += new TextDecoder().decode(chunk); if (/^open:.*\n/m.test(said)) break; }
  return { server, port: Number(/^open:\s+http:\/\/[^/]*:(\d+)\//m.exec(said)![1]), said };
}
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]); // enough of a picture for the server to take it as one
afterAll(() => { server.kill(); rmSync(game, { recursive: true, force: true }); rmSync(data, { recursive: true, force: true }); });

test("state carries the feed, the pictures and the scene list", async () => {
  const r = await fetch(`${URL_}/state`), s = await r.json();
  expect(s.feed.length).toBe(12);
  expect(s.feed[4]).toMatchObject({ asked: "put my grandmother by the stove", shot: "0004.png" });
  expect(s.shots.length).toBe(6);
  expect(s.scenes.filter((x: { done: boolean }) => x.done).length).toBe(2);
  expect(s.scenes[1]).toMatchObject({ n: 2, name: "Someone to talk to", idea: "grandmother by the stove" });
  expect((await fetch(`${URL_}/shots/0004.png`)).headers.get("content-type")).toBe("image/png");
  // unchanged: the next poll gets a 304
  expect((await fetch(`${URL_}/state`, { headers: { "If-None-Match": r.headers.get("etag")! } })).status).toBe(304);
});

test("a reference picture lands in refs/ with a cleaned name; other files and paths are refused", async () => {
  const ok = await fetch(`${URL_}/refs/${encodeURIComponent("my light (1).png")}`, { method: "PUT", body: PNG });
  expect(ok.status).toBe(200);
  expect(new Uint8Array(readFileSync(join(game, "refs", "mylight1.png")))).toEqual(PNG);
  expect((await fetch(`${URL_}/refs/notes.txt`, { method: "PUT", body: "x" })).status).toBe(400);
  expect((await fetch(`${URL_}/refs/page.png`, { method: "PUT", body: "<script>alert(1)</script>" })).status).toBe(400); // named a picture, is not one
  await fetch(`${URL_}/refs/${encodeURIComponent("../../escaped.png")}`, { method: "PUT", body: PNG });
  expect(existsSync(join(game, "..", "escaped.png"))).toBe(false);
  expect(existsSync(join(game, "refs", "escaped.png"))).toBe(true);
  expect((await fetch(`${URL_}/shots/${encodeURIComponent("../game.md")}`)).status).toBe(404);
});

test("a kept picture is remembered outside the game folder", async () => {
  await fetch(`${URL_}/kept/0002.png`, { method: "PUT" });
  expect((await (await fetch(`${URL_}/state`)).json()).kept).toEqual(["0002.png"]);
  await fetch(`${URL_}/kept/0002.png`, { method: "DELETE" });
  expect((await (await fetch(`${URL_}/state`)).json()).kept).toEqual([]);
  expect(existsSync(join(game, "pane-state.json"))).toBe(false);
});

test("entries from several agents: a new line is in the next answer, with a picture kept in another folder, or said to be lost", async () => {
  const before = await fetch(`${URL_}/state`), n = (await before.json()).feed.length;
  copyFileSync(join(game, "shots", "0002.png"), join(data, "pier.png")); // as if posted from another copy of the game
  const line = (o: object) => appendFileSync(join(game, "feed.jsonl"), JSON.stringify({ t: new Date().toISOString(), ...o }) + "\n");
  line({ scene: "HARBOUR TOWN", did: "A lamp now stands by the pier.", shot: join(data, "pier.png") });
  line({ scene: "HILL ROAD", did: "The gate is open.", shot: "shots/never-made.png" });
  const r = await fetch(`${URL_}/state`, { headers: { "If-None-Match": before.headers.get("etag")! } }), s = await r.json();
  expect(r.status).toBe(200);
  expect(s.feed.length).toBe(n + 2);
  expect(s.feed[n]).toMatchObject({ scene: "HARBOUR TOWN", shot: null, far: `far/${n}/pier.png` });
  expect((await fetch(`${URL_}/${s.feed[n].far}`)).headers.get("content-type")).toBe("image/png");
  expect(s.feed[n + 1]).toMatchObject({ scene: "HILL ROAD", shot: null, lost: "shots/never-made.png" });
  expect((await fetch(`${URL_}/far/${n + 1}/never-made.png`)).status).toBe(404);
});

test("the page has a tile for each stream and nothing in it animates on its own", () => {
  const file = (f: string) => readFileSync(join(import.meta.dir, f), "utf8");
  expect(file("pane.js")).toContain("function drawStreams()");
  expect(file("index.html")).toContain('id="streams"');
  expect(file("pane.css") + file("pane.js") + file("index.html")).not.toMatch(/transition\s*:|animation\s*:|@keyframes|requestAnimationFrame|<marquee|\.animate\(/);
});

// the kit against the same folder, as an agent would call it
const kit = (...args: string[]) => { const r = Bun.spawnSync(["bun", join(import.meta.dir, "../kit/kit.ts"), ...args, "--game", game]); return r.stdout.toString() + r.stderr.toString(); };
const kitAsync = (...args: string[]) => Bun.spawn(["bun", join(import.meta.dir, "../kit/kit.ts"), ...args, "--game", game], { stdout: "ignore", stderr: "ignore" }).exited;
const post = (path: string, body: object, method = "POST") => fetch(`${URL_}/${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const stateNow = async () => (await fetch(`${URL_}/state`)).json();

test("an answer given in the pane reaches the agent through kit reviews, and a later note that answers it closes it", async () => {
  const first = (await stateNow()).feed[0];
  expect(first.id).toBeString(); // an old line with none of the new fields still gets a name and renders
  expect(first.by).toBeUndefined();
  expect((await post("review", { id: first.id, entry: first.t, scene: first.scene, verdict: "work", note: "the lamp is too bright" })).status).toBe(200);
  expect((await post("review", { id: first.id, entry: first.t, verdict: "maybe" })).status).toBe(400);
  expect((await stateNow()).reviews[first.id]).toMatchObject({ verdict: "work", note: "the lamp is too bright", handled: null });
  const open = JSON.parse(kit("reviews", "--open", "--json"));
  expect(open).toHaveLength(1);
  expect(open[0]).toMatchObject({ entry: first.t, verdict: "work", note: "the lamp is too bright", did: first.did });
  expect(kit("reviews")).toContain("the user wrote: the lamp is too bright");
  kit("note", "The lamp is dimmer now.", "--scene", first.scene ?? "1", "--by", "art", "--answers", first.t);
  expect(JSON.parse(kit("reviews", "--open", "--json"))).toHaveLength(0);
  const s = await stateNow();
  expect(s.reviews[first.id].handled).toBeString();
  expect(s.feed.at(-1)).toMatchObject({ did: "The lamp is dimmer now.", by: "art", answers: first.t });
});

test("a note alone, neither right nor needs work, waits for the agent the same way", async () => {
  const second = (await stateNow()).feed[1];
  expect((await post("review", { id: second.id, entry: second.t, scene: second.scene, verdict: "note", note: "   " })).status).toBe(400);
  expect((await post("review", { id: second.id, entry: second.t, scene: second.scene, verdict: "note", note: "2 is best" })).status).toBe(200);
  expect((await stateNow()).reviews[second.id]).toMatchObject({ verdict: "note", note: "2 is best", handled: null });
  const open = JSON.parse(kit("reviews", "--open", "--json"));
  expect(open).toHaveLength(1);
  expect(open[0]).toMatchObject({ entry: second.t, verdict: "note", note: "2 is best" });
  expect(kit("reviews", "--open")).toContain("NOTE");
  kit("note", "Two is in.", "--scene", second.scene ?? "1", "--answers", second.t);
  expect(JSON.parse(kit("reviews", "--open", "--json"))).toHaveLength(0);
  expect(kit("reviews")).toContain("note (answered)");
  expect(readFileSync(join(import.meta.dir, "pane.js"), "utf8")).toContain('"Send note"');
});

test("a question asked with kit decide waits in the pane, and the answer given there comes back through kit decisions", async () => {
  expect(kit("decide", "Which name for the harbour town?", "--options", "SALT QUAY|GULL REACH", "--recommend", "SALT QUAY", "--scene", "HARBOUR TOWN")).toContain("asked:");
  const d = (await stateNow()).decisions.at(-1);
  expect(d).toMatchObject({ question: "Which name for the harbour town?", options: ["SALT QUAY", "GULL REACH"], recommend: "SALT QUAY", answer: null });
  expect(JSON.parse(kit("decisions", "--open", "--json"))).toHaveLength(1);
  expect((await post("decision", { id: "no-such", answer: "x" })).status).toBe(400);
  expect((await post("decision", { id: d.id, answer: "GULL REACH" })).status).toBe(200);
  expect((await stateNow()).decisions.at(-1)).toMatchObject({ id: d.id, answer: "GULL REACH" });
  expect(JSON.parse(kit("decisions", "--open", "--json"))).toHaveLength(0);
  expect(kit("decisions")).toContain("the user chose: GULL REACH");
});

test("settings: the page changes the picture model and the helpers and leaves every other key as it was", async () => {
  writeFileSync(join(game, "settings.json"), JSON.stringify({ player_name: "RIVER", something_else: { kept: [1, 2] }, image_models: [{ id: "m/one", label: "One" }, { id: "m/two" }] }));
  const helpers = [{ name: "second account", how: "agent -p <brief>", model: "big", enabled: true }, { name: "spare", how: "other <brief>", enabled: false }];
  expect((await post("settings", { image_model: "m/two", workers: helpers, default_worker: "second account" }, "PUT")).status).toBe(200);
  expect((await post("settings", { player_name: "X" }, "PUT")).status).toBe(400); // not the page's to change
  expect((await post("settings", { workers: [{ name: "" }] }, "PUT")).status).toBe(400);
  const onDisk = JSON.parse(readFileSync(join(game, "settings.json"), "utf8"));
  expect(onDisk).toMatchObject({ player_name: "RIVER", something_else: { kept: [1, 2] }, image_model: "m/two", default_worker: "second account" });
  expect(await (await fetch(`${URL_}/settings`)).json()).toEqual(onDisk);
  expect(kit("settings", "image_model").trim()).toBe("m/two");
  expect(JSON.parse(kit("workers", "--json"))).toMatchObject({ default: "second account", workers: [{ name: "second account", model: "big" }] }); // only the ones switched on
  kit("settings", "image_model", "m/one");
  expect((await (await fetch(`${URL_}/settings`)).json()).image_model).toBe("m/one");
});

test("a note can carry who wrote it, a before picture and a lore id; the last build's result is in the state", async () => {
  mkdirSync(join(game, "lore"), { recursive: true }); mkdirSync(join(game, "out"), { recursive: true });
  writeFileSync(join(game, "lore", "harbour-town.md"), "# HARBOUR TOWN\n\nA quiet port.\n");
  writeFileSync(join(game, "out", ".last-build"), "FAILED 40s\n");
  expect(kit("note", "The hall has a new roof.", "--shot", "shots/0004.png", "--before", "shots/0002.png", "--scene", "HARBOUR TOWN", "--by", "art", "--lore", "harbour-town")).toContain("lineage: noted in lore/harbour-town.md");
  expect(readFileSync(join(game, "lore", "harbour-town.md"), "utf8")).toMatch(/## Lineage\n\n- note \S+: The hall has a new roof\./);
  expect(kit("note", "No such place.", "--lore", "nowhere")).toContain("does not exist");
  const s = await stateNow();
  expect(s.feed.at(-2)).toMatchObject({ by: "art", shot: "0004.png", before: "0002.png" });
  expect(s.lastBuild).toMatchObject({ text: "FAILED 40s" });
});

test("the page has the answer buttons, the Decisions and Settings tabs and the stream switch", () => {
  const file = (f: string) => readFileSync(join(import.meta.dir, f), "utf8");
  for (const part of ['"Looks right"', '"Needs work"', "function drawDecisions()", "function drawSettings()", '"By stream"', '"before"']) expect(file("pane.js")).toContain(part);
  for (const id of ['id="tab-decisions"', 'id="tab-settings"', 'id="grouping"', 'id="waiting"']) expect(file("index.html")).toContain(id);
});

// ---- who may ask, and for what ----
const status = async (path: string, init?: RequestInit) => (await fetch(`${URL_}${path}`, init)).status;
test("a path that climbs out of its folder is refused on every kind of route, and so is a link that leads out", async () => {
  writeFileSync(join(data, "secret.md"), "not yours\n"); mkdirSync(join(game, "out/music"), { recursive: true }); mkdirSync(join(game, "lore"), { recursive: true });
  symlinkSync(join(data, "secret.md"), join(game, "shots", "link.png")); symlinkSync(join(data, "secret.md"), join(game, "out/music", "link.wav"));
  for (const path of ["/shots/..%2Fgame.md", "/shots/..%2F..%2Fsecret.png", "/shots/link.png", "/refs/..%2Fgame.md", "/refs/%2Fetc%2Fhostname", "/listen/..%2F..%2Fgame.md", "/listen/%252e%252e%2F%252e%252e%2Fgame.md", "/listen/link.wav",
    "/listen/%2Fetc%2Fhostname", "/lore/..%2Fgame", "/lore/%2e%2e%2f%2e%2e%2fsecret", "/map/..%2F..%2Fgame", "/far/-1/x.png", "/far/..%2F..%2Fx.png", "/music/play/..%2F..%2Fgame.md", "/pane.js/..%2Fserver.ts", "/..%2Fserver.ts"]) {
    const r = await fetch(`${URL_}${path}`), body = await r.text();
    expect(`${path} ${r.status >= 400}`).toBe(`${path} true`); expect(body).not.toContain("not yours"); expect(body).not.toContain("# "); expect(body).not.toContain(tmpdir()); // refused, and no folder of this computer named
  }
  for (const path of ["../data/secret.md", join(data, "secret.md"), "/etc/hostname", "shots/../../secret.md"]) { const r = await fetch(`${URL_}/source/file?path=${encodeURIComponent(path)}`); expect(r.status).toBe(400); expect(await r.text()).not.toContain("not yours"); }
  expect(await status("/%E0%A4%A")).toBe(400); // an address that cannot be read is refused, not a fault
  rmSync(join(game, "shots", "link.png")); rmSync(join(game, "out/music", "link.wav"));
});

test("a page on another site cannot write, read or start anything; a name pointed at this computer is not answered", async () => {
  const first = (await stateNow()).feed[0], said = JSON.stringify({ id: first.id, entry: first.t, verdict: "work", note: "from elsewhere" }), json = { "Content-Type": "application/json" };
  const before = readFileSync(join(game, "settings.json"), "utf8") + (existsSync(join(game, "reviews.jsonl")) ? readFileSync(join(game, "reviews.jsonl"), "utf8") : "");
  expect(await status("/review", { method: "POST", body: said })).toBe(415); // what a form or a plain cross-site request can send
  expect(await status("/review", { method: "POST", headers: { ...json, Origin: "http://elsewhere.example" }, body: said })).toBe(403);
  expect(await status("/review", { method: "POST", headers: { ...json, Origin: "null" }, body: said })).toBe(403);
  expect(await status("/review", { method: "POST", headers: { ...json, "Sec-Fetch-Site": "cross-site" }, body: said })).toBe(403);
  expect(await status("/review", { method: "POST", headers: { ...json, "Sec-Fetch-Site": "same-site" }, body: said })).toBe(403); // another program's page on this computer
  expect(await status("/settings", { method: "POST", headers: { ...json, Origin: "http://elsewhere.example" }, body: JSON.stringify({ workers: [{ name: "x", how: "run this" }] }) })).toBe(403);
  expect(await status("/source/setup", { method: "POST", headers: { ...json, Origin: "http://elsewhere.example" }, body: JSON.stringify({ from: "https://elsewhere.example/x.git" }) })).toBe(403);
  expect(await status("/source/setup", { method: "POST", body: JSON.stringify({ from: "https://elsewhere.example/x.git" }) })).toBe(415);
  expect(await status("/refs/x.png", { method: "PUT", headers: { Origin: "http://elsewhere.example" }, body: PNG })).toBe(403);
  expect(await status("/kept/0002.png", { method: "PUT", headers: { "Sec-Fetch-Site": "cross-site" } })).toBe(403);
  expect(await status("/music/replace/x?file=a.wav", { method: "PUT", headers: { Origin: "http://elsewhere.example" }, body: "x" })).toBe(403);
  for (const path of ["/state", "/settings", "/shots/0004.png", "/source/file?path=game.md", "/music/play/anything", "/map/anything"]) expect(await status(path, { headers: { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors" } })).toBe(403);
  expect(await status("/music/play/anything", { headers: { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate" } })).toBe(403); // a frame on another site cannot start a recording
  expect(await status("/", { headers: { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate" } })).toBe(200); // a link to the pane from elsewhere still opens it
  for (const path of ["/state", "/", "/review"]) expect(await status(path, { method: path === "/review" ? "POST" : "GET", headers: { ...json, Host: "elsewhere.example" }, body: path === "/review" ? said : undefined })).toBe(403);
  expect(readFileSync(join(game, "settings.json"), "utf8") + (existsSync(join(game, "reviews.jsonl")) ? readFileSync(join(game, "reviews.jsonl"), "utf8") : "")).toBe(before);
  expect(existsSync(join(game, "refs", "x.png"))).toBe(false);
  const r = await fetch(`${URL_}/review`, { method: "POST", headers: { ...json, Origin: URL_, "Sec-Fetch-Site": "same-origin" }, body: said }); // the pane's own page
  expect(r.status).toBe(200); expect(r.headers.get("access-control-allow-origin")).toBeNull(); expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  expect((await fetch(`${URL_}/`)).headers.get("content-security-policy")).toContain("script-src 'self' 'sha256-");
});

/** One request written by hand, so it can promise a body and never send it. */
const raw = (head: string) => new Promise<string>((done) => { let got = ""; const c = connect(PORT, "127.0.0.1", () => c.write(head)); c.on("data", (d) => { got += d; if (got.includes("\r\n\r\n")) c.end(); }); c.on("close", () => done(got)); setTimeout(() => c.destroy(), 3000); });
test("a file that is too big is refused before any of it is read, and a body with no stated length is cut off at the limit", async () => {
  for (const [path, size] of [["/refs/big.png", 20_000_001], ["/music/replace/x?file=a.wav", 20_000_001], ["/source/archive/big.zip", 600_000_001]] as const)
    expect(await raw(`PUT ${path} HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nContent-Length: ${size}\r\n\r\n`)).toMatch(/^HTTP\/1\.1 4(13|00) /); // answered with not one byte of the body sent
  expect(await raw(`POST /review HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nContent-Type: application/json\r\nContent-Length: 1000001\r\n\r\n`)).toMatch(/^HTTP\/1\.1 413 /);
  let sent = 0; const endless = new ReadableStream({ pull(c) { sent += 1 << 20; c.enqueue(new Uint8Array(1 << 20).fill(0x41)); if (sent > 64 << 20) c.close(); } });
  const r = await fetch(`${URL_}/refs/endless.png`, { method: "PUT", body: endless, keepalive: false }).catch(() => null); // the server may hang up mid-send
  expect(r?.status ?? 413).toBe(413); expect(existsSync(join(game, "refs", "endless.png"))).toBe(false);
});

const lan = Object.values(networkInterfaces()).flat().find((a) => a && a.family === "IPv4" && !a.internal)?.address;
test.skipIf(!lan)("opened to the network, the pane answers another device only at the link with its key", async () => {
  const far = await start("0.0.0.0"), at = `http://${lan}:${far.port}`, key = readFileSync(join(data, "pane-key.txt"), "utf8").trim();
  try {
    expect(far.said).toContain(`/k/${key}/`); expect(statSync(join(data, "pane-key.txt")).mode & 0o077).toBe(0);
    for (const path of ["/", "/state", "/settings", "/shots/0004.png", "/source/file?path=game.md"]) expect((await fetch(`${at}${path}`)).status).toBe(401);
    expect((await fetch(`${at}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await fetch(`${at}/k/${"0".repeat(32)}/state`)).status).toBe(401);
    expect((await (await fetch(`${at}/k/${key}/state`)).json()).feed.length).toBeGreaterThan(0);
    expect((await fetch(`${at}/k/${key}/shots/0004.png`)).headers.get("content-type")).toBe("image/png");
    expect((await fetch(`http://127.0.0.1:${far.port}/state`)).status).toBe(200); // this computer itself needs no key
  } finally { far.server.kill(); }
});

test("a feed line that is cut short or of the wrong shape is skipped or put right, and the state still comes", async () => {
  const n = (await stateNow()).feed.length;
  appendFileSync(join(game, "feed.jsonl"), '{"t":"2026-01-01T00:00:00Z","did":"half a li\nnull\n[1,2]\n"words"\n{"did":5}\n{"t":12,"scene":7,"did":"Scene given as a number.","by":{"x":1}}\n{"t":"2026-01-01T00:00:01Z","did":"A whole line af');
  const s = await stateNow();
  expect(s.feed.length).toBe(n + 1); expect(s.feed.at(-1)).toMatchObject({ t: "12", scene: "7", did: "Scene given as a number." }); expect(s.feed.at(-1).by).toBeUndefined();
  appendFileSync(join(game, "feed.jsonl"), 'ter it."}\n'); mkdirSync(join(game, "out"), { recursive: true }); writeFileSync(join(game, "out", ".player.json"), '{"pid":1,"lines":"not a list"}'); writeFileSync(join(game, "reviews.jsonl"), 'null\n{"id":\n', { flag: "a" });
  expect((await stateNow()).feed.at(-1)).toMatchObject({ did: "A whole line after it." }); // the line being written is left out until it is whole
  expect((await stateNow()).feed.length).toBe(n + 2);
});

test("two writers changing settings at once both keep their key", async () => {
  writeFileSync(join(game, "settings.json"), "{}\n");
  const jobs = Array.from({ length: 12 }, (_, i) => i % 2 ? Promise.resolve(kitAsync("settings", `key_${i}`, String(i))) : post("settings", { image_model: `m/${i}` }, "PUT"));
  await Promise.all(jobs);
  const s = JSON.parse(readFileSync(join(game, "settings.json"), "utf8"));
  for (let i = 1; i < 12; i += 2) expect(s[`key_${i}`]).toBe(i);
  expect(s.image_model).toMatch(/^m\/\d+$/); expect(existsSync(join(game, "settings.json.lock"))).toBe(false);
});
