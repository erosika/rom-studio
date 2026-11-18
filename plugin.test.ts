// plugin.test.ts: the agent half and the backend route, run with Python outside Hermes (a small stand-in for
// its plugin context), against real pane pages on spare ports. Each case says what the person would read.
//   bun test plugin.test.ts
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
setDefaultTimeout(60_000);
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PLUGIN = import.meta.dir, REPO = PLUGIN;
const PY = Bun.which("python3") ?? "/usr/bin/python3";
const BUN = process.execPath;
const scratch = mkdtempSync(join(tmpdir(), "rs-plugin-"));
const gameA = join(scratch, "game-a"), gameB = join(scratch, "game-b");
cpSync(join(REPO, "pane/sample"), gameA, { recursive: true });
cpSync(join(REPO, "pane/sample"), gameB, { recursive: true });
const SECRET = "sk-test-0123456789-never-shown";
const spawned: { kill: () => void }[] = [];
afterAll(() => { for (const p of spawned) try { p.kill(); } catch {} rmSync(scratch, { recursive: true, force: true }); });
let nextPort = 19_500 + Math.floor(Math.random() * 400);
const port = () => nextPort++;

// Loads the plugin the way Hermes does (a package from its folder), registers it with a stand-in context, waits for a
// state, optionally unloads it, and prints what happened as JSON.
const DRIVER = `
import importlib.util, json, os, pathlib, sys, time
d = sys.argv[1]
spec = importlib.util.spec_from_file_location("rs_plugin", d + "/__init__.py", submodule_search_locations=[d])
m = importlib.util.module_from_spec(spec); m.__package__ = "rs_plugin"; m.__path__ = [d]; sys.modules["rs_plugin"] = m
spec.loader.exec_module(m)
C = m.C
C.PROBE_TIMEOUT = 1.5
m.START_DELAY, m.CHECK_EVERY, m.FEED_EVERY, m.RETRY_AFTER = 0.0, 0.3, 0.1, 60
if os.environ.get("T_SERVER"): m.SERVER = pathlib.Path(os.environ["T_SERVER"])
class Ctx:
    def __init__(s, cfg): s.cfg, s.unload, s.skills = cfg, [], []
    def get_config(s, key, default=None): return s.cfg.get(key, default)
    def on_unload(s, f): s.unload.append(f)
    def register_skill(s, name, path): s.skills.append(name)
ctx = Ctx(json.loads(os.environ.get("T_CFG", "{}")))
m.register(ctx)
want, end, seen = os.environ.get("T_UNTIL"), time.time() + float(os.environ.get("T_WAIT", "0")), []
while True:
    st = (C.read_status() or {}).get("state")
    if not seen or seen[-1] != st: seen.append(st)
    if (want and st == want) or time.time() > end: break
    time.sleep(0.1)
if os.environ.get("T_THEN"):  # the settings change while Hermes runs (the desktop app's form)
    ctx.cfg, want, end = json.loads(os.environ["T_THEN"]), os.environ.get("T_UNTIL2"), time.time() + 20
    while True:
        st = (C.read_status() or {}).get("state")
        if seen[-1] != st: seen.append(st)
        moved = "pane_port" not in ctx.cfg or (C.read_status() or {}).get("port") == ctx.cfg["pane_port"]
        if (st == want and moved) or time.time() > end: break
        time.sleep(0.1)
out = {"status": C.read_status(), "seen": seen, "skills": ctx.skills, "pid": m._page.pid if m._page else None}
if out["pid"]:
    out["child_env"] = open(f"/proc/{out['pid']}/environ", "rb").read().decode("utf-8", "replace").split("\\0")
if os.environ.get("T_UNLOAD"):
    for f in ctx.unload: f()
    out["after"] = C.read_status()
    out["alive_after"] = bool(out["pid"]) and os.path.exists(f"/proc/{out['pid']}") and open(f"/proc/{out['pid']}/stat").read().split()[2] != "Z"
    out["port_free_after"] = C.port_free(int(ctx.cfg.get("pane_port", 0) or 8778))
open(os.environ["T_OUT"], "w").write(json.dumps(out))  # not stdout: importing Hermes, when this Python has it, moves stdout
if os.environ.get("T_CRASH"):
    os._exit(0)  # Hermes gone without an unload or its exit handlers, as when it is killed
`;
writeFileSync(join(scratch, "driver.py"), DRIVER);

function run(cfg: Record<string, unknown>, o: { until?: string; wait?: number; unload?: boolean; server?: string; env?: Record<string, string>; then?: Record<string, unknown>; until2?: string } = {}) {
  const home = mkdtempSync(join(scratch, "home-"));
  const env: Record<string, string> = { PATH: `${join(BUN, "..")}:/usr/bin:/bin`, HOME: process.env.HOME!, HERMES_HOME: home, LANG: "C.UTF-8", FAKE_PROVIDER_API_KEY: SECRET,
    T_CFG: JSON.stringify(cfg), T_WAIT: String(o.wait ?? 0), ...(o.until ? { T_UNTIL: o.until } : {}), ...(o.unload ? { T_UNLOAD: "1" } : {}), ...(o.server ? { T_SERVER: o.server } : {}), ...(o.then ? { T_THEN: JSON.stringify(o.then), T_UNTIL2: o.until2 ?? "" } : {}), ...o.env };
  const result = join(home, "out.json");
  const r = Bun.spawnSync([PY, "-I", join(scratch, "driver.py"), PLUGIN], { env: { ...env, T_OUT: result }, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0 || !existsSync(result)) throw new Error(`driver failed: ${r.stderr.toString()}`);
  const out = JSON.parse(readFileSync(result, "utf8"));
  const files = ["status.json", "pane.log"].map((f) => join(home, "plugin-data/rom-studio", f)).filter(existsSync).map((f) => readFileSync(f, "utf8")).join("\n");
  return { ...out, files, home };
}
async function pane(game: string, p: number) { // a real pane page, as a user would start one
  const proc = Bun.spawn([BUN, join(REPO, "pane/server.ts"), "--game", game, "--port", String(p), "--data", mkdtempSync(join(scratch, "data-"))], { stdout: "ignore", stderr: "ignore" });
  spawned.push(proc);
  for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${p}/`); break; } catch { await Bun.sleep(50); } }
  return proc;
}

test("no game folder: nothing is started, and the pane says where to choose one", () => {
  const r = run({}, { env: { ROM_STUDIO_GAME: "" } });
  expect(r.status.state).toBe("no-game");
  expect(r.status.message).toContain("Settings, Plugins, rom-studio");
  expect(r.pid).toBeNull();
  expect(r.skills).toContain("make-your-game"); // loadable as rom-studio:make-your-game
});

test("a game folder that is not there: said plainly, with the folder named, and nothing started", () => {
  const r = run({ game_folder: join(scratch, "no-such-game"), pane_port: port() }, { until: "no-folder", wait: 5 });
  expect(r.status.state).toBe("no-folder");
  expect(r.status.message).toContain("no-such-game");
  expect(r.pid).toBeNull();
});

test("bun missing: said plainly with where to get it", () => {
  const r = run({ game_folder: gameA, pane_port: port() }, { until: "no-bun", wait: 5, env: { PATH: "/usr/bin:/bin", HOME: scratch, BUN_INSTALL: "" } });
  expect(r.status.state).toBe("no-bun");
  expect(r.status.message).toContain("https://bun.sh");
});

test("the port used by another web program: said plainly, nothing started over it", async () => {
  const p = port(), other = Bun.serve({ hostname: "127.0.0.1", port: p, fetch: () => new Response("someone else", { status: 404 }) });
  try {
    const r = run({ game_folder: gameA, pane_port: p }, { until: "port-taken", wait: 8 });
    expect(r.status.state).toBe("port-taken");
    expect(r.status.message).toContain(`Port ${p}`);
    expect(r.pid).toBeNull();
  } finally { other.stop(true); }
});

test("the port held by a program that accepts and says nothing: also 'used by another program'", () => {
  const p = port(), silent = Bun.listen({ hostname: "127.0.0.1", port: p, socket: { data() {} } });
  try {
    const r = run({ game_folder: gameA, pane_port: p }, { until: "port-taken", wait: 10 });
    expect(r.status.state).toBe("port-taken");
    expect(r.pid).toBeNull();
  } finally { silent.stop(true); }
});

test("a page for another game on that port: named, and left alone", async () => {
  const p = port(); await pane(gameB, p);
  const r = run({ game_folder: gameA, pane_port: p }, { until: "other-game", wait: 8 });
  expect(r.status.state).toBe("other-game");
  expect(r.status.message).toContain("game-b");
  expect(r.pid).toBeNull();
});

test("the page already running for this game: used as it is, none started, and not stopped on unload", async () => {
  const p = port(), mine = await pane(gameA, p);
  const r = run({ game_folder: gameA, pane_port: p }, { until: "running", wait: 8, unload: true });
  expect(r.status.state).toBe("running");
  expect(r.status.ours).toBe(false);
  expect(r.pid).toBeNull();
  expect((await fetch(`http://127.0.0.1:${p}/state`)).status).toBe(200); // the user's page still answers
  mine.kill();
});

test("starts its own page on 127.0.0.1, which sees no provider key; unload stops it and frees the port", () => {
  const p = port();
  const r = run({ game_folder: gameA, pane_port: p }, { until: "running", wait: 20, unload: true });
  expect(r.seen).toContain("starting");
  expect(r.status.state).toBe("running");
  expect(r.status.ours).toBe(true);
  expect(r.pid).toBeNumber();
  expect(r.child_env.some((l: string) => l.startsWith("ROM_STUDIO") || l.startsWith("PATH="))).toBe(true);
  expect(r.child_env.join("\n")).not.toContain(SECRET); // the agent's keys stay with the agent
  expect(r.after.state).toBe("unloaded");
  expect(r.alive_after).toBe(false);
  expect(r.port_free_after).toBe(true);
  expect(r.files).not.toContain(SECRET);
  expect(r.files).not.toMatch(/\/k\/[0-9a-f]{16,}/); // no pane key in the status or the page's output
});

test("Hermes killed outright (no unload, no exit handlers): the page it started stops too and frees the port", async () => {
  const p = port();
  const r = run({ game_folder: gameA, pane_port: p }, { until: "running", wait: 20, env: { T_CRASH: "1" } });
  expect(r.status.state).toBe("running");
  expect(r.pid).toBeGreaterThan(0);
  const gone = () => { try { return !existsSync(`/proc/${r.pid}`) || readFileSync(`/proc/${r.pid}/stat`, "utf8").split(" ")[2] === "Z"; } catch { return true; } };
  for (let i = 0; i < 50 && !gone(); i++) await Bun.sleep(100);
  expect(gone(), "the page outlived the Hermes that started it").toBe(true);
  let answered = true;
  try { await fetch(`http://127.0.0.1:${p}/`, { signal: AbortSignal.timeout(1000) }); } catch { answered = false; }
  expect(answered).toBe(false);
});

test("a game folder chosen while Hermes runs: the page opens without a restart, and a port change moves it", () => {
  const p = port(), q = port();
  const r = run({}, { until: "no-game", wait: 5, then: { game_folder: gameA, pane_port: p }, until2: "running", unload: true, env: { ROM_STUDIO_GAME: "" } });
  expect(r.seen).toEqual([null, "no-game", "starting", "running"].filter((s, i) => i > 0 || r.seen[0] === null));
  expect(r.status.state).toBe("running");
  expect(r.alive_after).toBe(false);
  const moved = run({ game_folder: gameA, pane_port: p }, { until: "running", wait: 20, then: { game_folder: gameA, pane_port: q }, until2: "running", unload: true });
  expect(moved.status.port).toBe(q);
  expect(moved.port_free_after).toBe(true);
});

test("the game folder from the environment Hermes starts with, when the setting is empty", () => {
  const p = port();
  const r = run({ pane_port: p }, { until: "running", wait: 20, unload: true, env: { ROM_STUDIO_GAME: gameA } });
  expect(r.status.state).toBe("running");
  expect(r.alive_after).toBe(false);
});

test("a page that stops by itself: its own last line is shown, and a held port reads as a held port", () => {
  const boom = join(scratch, "boom.ts"), held = join(scratch, "held.ts");
  writeFileSync(boom, `console.error("the game folder could not be read"); process.exit(1);\n`);
  writeFileSync(held, `console.error("could not open 127.0.0.1:1 (EADDRINUSE). Is the pane already running? Try --port <other>."); process.exit(1);\n`);
  const a = run({ game_folder: gameA, pane_port: port() }, { until: "stopped", wait: 10, server: boom });
  expect(a.status.state).toBe("stopped");
  expect(a.status.message).toBe("The ROM Studio page stopped: the game folder could not be read. Hermes tries again in half a minute.");
  const b = run({ game_folder: gameA, pane_port: port() }, { until: "port-taken", wait: 10, server: held });
  expect(b.status.state).toBe("port-taken");
});

test("a page you started yourself (with its key): shown as it is; the key never lands in the status", () => {
  const r = run({ game_folder: gameA, pane_url: "http://192.168.1.20:8778/k/0123456789abcdef0123456789abcdef/" }, { wait: 1 });
  expect(r.status.state).toBe("external");
  expect(r.files).not.toContain("0123456789abcdef0123456789abcdef");
  expect(r.pid).toBeNull();
});

// ---- the backend route, with a stand-in for FastAPI (only its router decorator is used)
const ROUTE = `
import asyncio, json, os, sys, types
fake = types.ModuleType("fastapi")
class APIRouter:
    def get(self, path):
        return lambda f: f
fake.APIRouter = APIRouter
sys.modules["fastapi"] = fake
import importlib.util
spec = importlib.util.spec_from_file_location("rs_api", sys.argv[1] + "/dashboard/plugin_api.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
if os.environ.get("T_STATUS"): m.C.write_status(**json.loads(os.environ["T_STATUS"]))
open(os.environ["T_OUT"], "w").write(json.dumps(asyncio.run(m.where())))
`;
writeFileSync(join(scratch, "route.py"), ROUTE);
function where(env: Record<string, string>) {
  const home = mkdtempSync(join(scratch, "home-"));
  const result = join(home, "out.json");
  const r = Bun.spawnSync([PY, "-I", join(scratch, "route.py"), PLUGIN], { env: { PATH: "/usr/bin:/bin", HOME: scratch, HERMES_HOME: home, ROM_STUDIO_GAME: "", T_OUT: result, ...env }, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0 || !existsSync(result)) throw new Error(r.stderr.toString());
  return JSON.parse(readFileSync(result, "utf8"));
}

test("the route: no game, a missing folder, a page answering, and a page that is not, each with its sentence and an address only when there is a page", async () => {
  expect(where({})).toMatchObject({ url: null, state: "no-game" });
  expect(where({ ROM_STUDIO_GAME: join(scratch, "nope") })).toMatchObject({ url: null, state: "no-folder" });
  const p = port(); const page = await pane(gameA, p);
  const up = where({ ROM_STUDIO_GAME: gameA, ROM_STUDIO_PANE_PORT: String(p), T_STATUS: JSON.stringify({ state: "running", message: "open", port: p }) });
  expect(up).toMatchObject({ url: `http://127.0.0.1:${p}/`, state: "running", answering: true });
  page.kill(); await page.exited;
  const down = where({ ROM_STUDIO_GAME: gameA, ROM_STUDIO_PANE_PORT: String(p), T_STATUS: JSON.stringify({ state: "port-taken", message: `Port ${p} on this computer is used by another program.`, port: p }) });
  expect(down).toMatchObject({ url: null, state: "port-taken", answering: false });
  const nothing = where({ ROM_STUDIO_GAME: gameA, ROM_STUDIO_PANE_PORT: String(p) });
  expect(nothing).toMatchObject({ url: null, state: "waiting", answering: false });
  expect(nothing.message).toContain("a few seconds after the plugin is switched on");
  const theirs = where({ ROM_STUDIO_GAME: gameA, ROM_STUDIO_PANE_URL: "https://box.example.ts.net:8778/" });
  expect(theirs).toMatchObject({ url: "https://box.example.ts.net:8778/", state: "external", answering: null });
});
