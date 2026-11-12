#!/usr/bin/env bun
// kit/kit.ts: every kit command. Run through kit/kit; `kit help` lists them.
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { layouts, listMaps, mapNames, mapText, renderMap, tileset, type Overlay } from "./maps";
import { gateText, gatesIn, pathBetween } from "./gates";
import { beforeAfter, findObjects, findTileset, objectText, roleTable, tilesetMaps } from "./tilesets";
import { checkText, listText, loreCheck, loreFiles, loreReport, newLore, reportText, setLineage } from "./lore";
import { applyBps, makeBps } from "./patch";
import { answer, ask, decisions, reviews, setSettings, settings, workers } from "./inbox";
import { MUSIC_HELP, musicCommand } from "./music";
import { FIND_HELP, findCommand } from "./find";
import { DIALOGUE_HELP, dialogueCommand } from "./dialogue";
import { childEnv } from "./env";

const BASE_FOR = { file: "include/constants/expansion.h", blob: "7d775c0c920e2fc2c41019c8e5a4d7edd5eb80a1", says: "the expanded engine 1.17.2" }; // the one version kit/base was made for
const SCRIPT_TOOL_URL = "https://github.com/huderlem/poryscript/releases/download/3.6.1/poryscript-linux.zip";
const SCRIPT_TOOL_SHA256 = "249f9adeb3b6d7f2e33347c1d0bce5f3ff8fb06e914c75b81d08187f8404c4ff"; // of that file: a download that is anything else is not run
const MGBA_COMMIT = "26b7884bc25a5933960f3cdcd98bac1ae14d42e2"; // the emulator library's tag 0.10.5
const KIT = import.meta.dir, REPO = resolve(KIT, ".."), env = process.env, OPT = join(env.HOME ?? "", ".local/opt");
// the game folder when none is named: beside the checkout; but a checkout installed as a host's plugin sits in the host's plugin folder, and a game never goes there
const DEFAULT_GAME = basename(dirname(REPO)) === "plugins" ? join(env.HOME ?? "", "rom-studio-game") : join(REPO, "../rom-studio-game");
const EMU = join(KIT, "emu/bin/studio-emu"), MGBA = join(env.MGBA_PREFIX ?? join(OPT, "mgba"), "lib/libmgba.a");
const TOOL_PATH = [join(env.ARM_GCC ?? join(OPT, "arm-gnu-14.2"), "bin"), join(OPT, "pkgconfig-shim/bin"), env.PATH].join(":");

const HELP = `kit: build, play and look at your game. One game folder, one build at a time.

  kit status                 is everything here, which scene is next, when was the last build
  kit setup --decomp <folder|git url> [--no-base]   first time: checks tools, copies your decomp into the game folder, adds the
                             calm and helper base if it fits, first build (minutes). Safe to rerun (no --decomp needed then)
  kit build                  build after a change: OK and seconds, or the first error with file and line
  kit play [--phone|--stop]  start (or reuse) the player and print the link; --phone adds a link for a phone on the same network
  kit shot [--at G.N,X,Y] [--time HH:MM] [--name file.png] [--scale 3] [steps]   a picture from the real game, at a stated hour if asked
  kit press <buttons|steps>  drive the game (A,B,UP:30 or steps), then say where the player is and take a picture
  kit where [steps]          map, square, facing, open message
  kit maps [--all] [--json]  your own maps (added since setup; --all for every map): size, group.number, joins, doors, people, signs, triggers
  kit map <name> [--png file] [--overlay people,doors,joins,collision|all] [--scale 2]   draw a whole map from the tree's own files
  kit tileset <name> roles [--out dir] [--force]   a first-guess role for every building block: roles.json beside the tileset, and a labelled contact sheet
  kit tileset <name> maps [--json]                 the maps that use the tileset
  kit tileset <name> before-after [--png file] [--maps a,b,c]   three maps that use it, drawn from the last kept commit and from now, side by side
  kit tileset <name> restyle --profile <file.json> [--palette-only] [--strips pic.png:slot,...] [--lore <id>]   redraw the tileset in place by role,
                             from the original art every time, in the colours and treatments of your profile (kit/restyle.py explains the file)
  kit tileset <name> objects [--json]              candidate multi-block objects (houses, signs, trees) with footprint, where one stands, and a numbered sheet
  kit redraw <art module.py> [--write] [--only group,...]   replace whole objects by your own drawings of the same footprint (kit/objects.py explains
                             the module); without --write it only makes previews.      kit redraw dump <map> <x> <y> <w> <h>   the blocks and tiles at a place
  kit gates --from <map> --to <map> [--json]   places on the walk between two maps where a story switch may stop the player (candidates)
  kit lore [<id>] [--json]   the lore index: every id with its name and mood; with an id, its file, everything that points at it
                             (script blocks, tool tables, notes, pictures) and its lineage (the Lineage heading and the kept versions)
  kit lore new <id> "<NAME>" a new lore file with the fixed headings (never replaces one)      kit lore check   ids with no file, files nothing points at
  kit scenes [--json]        the scenes in game.md with their ticks, feed entries and pictures
  kit note "<sentence>" [--shot png] [--next "<sentence>"] [--asked "<words>"] [--scene "<name>"]   one line in the feed
           also: --by "<who or which stream>"  --before <png> (shown beside --shot)  --answers <entry time> (you dealt with a "needs work")
                 --lore <id> (the sentence also goes under Lineage in lore/<id>.md)
  kit reviews [--open] [--scene "<name>"] [--json]   what the user answered to feed entries in the pane ("looks right" / "needs work" and a
                             note); --open: only "needs work" that no later entry has answered. Look here before starting and after each step
  kit decide "<question>" [--options "a|b|c"] [--recommend "<option>"] [--scene "<name>"] [--detail "<one line>"]   ask the user to choose;
                             it waits in the pane's Decisions tab.      kit decisions [--open] [--json]   the questions and the answers given
  kit settings [key] [value] read settings.json, one key, or set a key (a value that is JSON is stored as JSON)
  kit workers [--json]       the helpers the user switched on in the pane's Settings tab, and which one is the default
  ${MUSIC_HELP}
  ${FIND_HELP}
  ${DIALOGUE_HELP}
  kit keep "<scene name>"    commit the game folder with that message and tick the scene in game.md
  kit undo [--yes]           back to the last kept scene; with nothing changed since, takes back the last kept scene
  kit patch [--original <file>] [--file <out.bps>]   your game as one patch file (default out/game.bps) for someone else to apply to
                             their own copy of the original game; it re-applies itself to check. The built game is never shared
  kit patch --check <original file> [--file <x.bps>]   apply the patch to a copy of that original and compare with the built game

Game folder: --game <dir>, else $ROM_STUDIO_GAME, else ${DEFAULT_GAME}
Steps (shot, press, where): every run starts from a fresh new game, so put the whole route on one line:
  warp <group> <num> <x> <y>   walk UP:3,LEFT:2   press A,B   wait 60   flag set|clear <number>
  givemon <species number> <level>   script <script name>   gender <0 boy|1 girl>      (to reach a battle: givemon, then walk up to the trainer and press A; script cannot start one)
  time [HH:MM|midday|midnight]   rtc host|<ms>      (the game's clock: print it, or set it and hold it; put it before warp)
  shot <png>   where   save <file>   load <file>     (a picture or the position mid-route; save a moment and carry on from it in a later run)
Settings: settings.json in the game folder holds the player's name (7 letters at most) and look (girl or boy).
  Talk to your agent from inside the game (the base's START menu entry, in the player): hermes_link (false switches it off), hermes_command
  (default "hermes"; another program only through ROM_STUDIO_HERMES_COMMAND, set by you), hermes_session (the conversation's name), hermes_preface (what the agent is told first), hermes_timeout (seconds, default 60).
  "original_game": the path of your own copy of the original game file, which kit patch makes the patch from (or --original once).
  "image_model": the picture model the user chose (the kit makes no pictures itself: your own tool reads this). "image_models": the choices.
  "workers": the helpers you may hand work to ({name, how, model, note, enabled}); "default_worker": the one to use unless told otherwise.

As tools for an agent host: the same commands are served over MCP (stdio) by kit/mcp.ts. Add to the host's config:
  JSON hosts (.mcp.json):  {"mcpServers": {"rom-studio": {"command": "bun", "args": ["${join(KIT, "mcp.ts")}"]}}}
  YAML hosts (Hermes config.yaml, not tried):  mcp_servers: {rom-studio: {command: bun, args: ["${join(KIT, "mcp.ts")}"]}}
  Set ROM_STUDIO_GAME in the server's env to point it at a game folder.`;

// ---- arguments ----
const args = process.argv.slice(2);
function opt(name: string): string | undefined { // removes --name <value> from args
  const i = args.indexOf(`--${name}`); if (i < 0) return undefined;
  if (args[i + 1] === undefined) die(`--${name} needs a value. See: kit help`);
  return args.splice(i, 2)[1];
}
function flag(name: string): boolean { const i = args.indexOf(`--${name}`); if (i >= 0) args.splice(i, 1); return i >= 0; }
function die(msg: string): never { console.error(msg); process.exit(1); }
const GAME = resolve(opt("game") ?? env.ROM_STUDIO_GAME ?? env.GAME_DIR ?? DEFAULT_GAME);
const OUT = join(GAME, "out"), ROM = join(OUT, "game.gba"), GAME_MD = join(GAME, "game.md");
const command = args.shift() ?? "help";

function run(cmd: string[], o: { cwd?: string; show?: boolean; env?: Record<string, string | undefined> } = {}) {
  const r = Bun.spawnSync(cmd, { cwd: o.cwd, env: childEnv(o.env), stdout: o.show ? "inherit" : "pipe", stderr: o.show ? "inherit" : "pipe" });
  return { ok: r.exitCode === 0, out: o.show ? "" : (r.stdout.toString() + r.stderr.toString()).trim() };
}
const git = (...a: string[]) => run(["git", "-C", GAME, ...a]);
const who = () => (git("config", "user.name").out && git("config", "user.email").out ? [] : ["-c", "user.name=ROM Studio", "-c", "user.email=kit@localhost"]); // commits work on a computer where git was never set up
const isGame = () => existsSync(join(GAME, "Makefile")) && existsSync(join(GAME, ".git"));
const isSetUp = () => isGame() && existsSync(GAME_MD);
const hasBase = () => existsSync(join(GAME, "src/zz_studio.c"));
const needGame = () => { if (!isSetUp()) die(`No game folder at ${GAME}. Run: kit setup --decomp <your decomp>   (or point at one with --game <dir>)`); };
/** The commit the user's own work starts after: setup's tag, else a hand-made base commit, else the first commit. */
const startCommit = () => (git("rev-parse", "-q", "--verify", "kit-start^{commit}").out || git("log", "--grep=^base:", "--format=%H").out.split("\n").pop() || git("rev-list", "--max-parents=0", "HEAD").out.split("\n")[0]!);
const NO_DECOMP = `kit setup needs your decomp: the source code of an original game, taken apart by its community so it can be changed and rebuilt.
ROM Studio does not include or fetch one. Get the one you want to build on, then run: kit setup --decomp <its folder or git address>`;
/** What the tree is, read from the tree itself. */
function describeTree(): string {
  if (!existsSync(join(GAME, "Makefile")) || !existsSync(join(GAME, "include/global.h"))) return "not a decomp this kit knows (no Makefile and include/global.h at the top)";
  const code = /^GAME_CODE\s*[?:]?=\s*(\w+)/m.exec(readFileSync(join(GAME, "Makefile"), "utf8"))?.[1], vh = join(GAME, BASE_FOR.file);
  const v = existsSync(vh) ? ["MAJOR", "MINOR", "PATCH"].map((k) => new RegExp(`VERSION_${k}\\s+(\\d+)`).exec(readFileSync(vh, "utf8"))?.[1] ?? "?").join(".") : null;
  return `${v ? `expanded engine ${v}` : "plain engine"}${code ? `, game code ${code}` : ""}`;
}
const WITHOUT_BASE = "Without the base: build, play, pictures, walking, placing the player, starting a script, note, keep, undo, maps and scenes all work.\n  Not available: setting flags, giving a creature, reading message text exactly, the quick start (each new ROM plays through the\n  original opening once, and pictures start where the original game first lets the player walk), the calm changes, settings.json.";
const needRom = () => { needGame(); if (!existsSync(ROM)) die(`The game has not been built yet. Run: kit build`); };

// ---- tools ----
function scriptTool(): string | null {
  const dirs = [env.SCRIPT_TOOL, ...(existsSync(OPT) ? readdirSync(OPT).filter((d) => d.startsWith("poryscript")).map((d) => join(OPT, d)) : []), join(KIT, ".cache/poryscript")];
  return dirs.find((d) => d && existsSync(join(d, "poryscript"))) ?? null;
}
function tools(): [string, string | null, string][] { // what, where found, how to get it
  const has = (c: string) => Bun.which(c, { PATH: TOOL_PATH });
  const pkg = "use your system's package manager, for example: sudo apt install";
  return [
    ["git", has("git"), `${pkg} git`], ["make", has("make"), `${pkg} make`], ["python3", has("python3"), `${pkg} python3`],
    ["C and C++ compilers for this computer", has("cc") && has("c++"), `${pkg} build-essential`],
    ["flock", has("flock"), `${pkg} util-linux`],
    ["picture library (libpng with pkg-config)", has("pkg-config") && run(["pkg-config", "--exists", "libpng"], { env: { PATH: TOOL_PATH } }).ok ? has("pkg-config") : null, `${pkg} libpng-dev pkg-config`],
    ["compiler for the game (arm-none-eabi-gcc 14.2)", has("arm-none-eabi-gcc"),
      `download "Arm GNU Toolchain 14.2.Rel1", the arm-none-eabi build for this computer, from developer.arm.com/downloads/-/arm-gnu-toolchain-downloads,\n      unpack it to ${join(OPT, "arm-gnu-14.2")} (so that bin/arm-none-eabi-gcc is inside), or set ARM_GCC to where you put it`],
    ["headless emulator", existsSync(EMU) ? EMU : existsSync(MGBA) ? `${MGBA} (setup builds the emulator from it)` : null,
      `it needs the emulator library, built once (needs cmake):\n      git clone --depth 1 -b 0.10.5 https://github.com/mgba-emu/mgba /tmp/mgba && test "$(git -C /tmp/mgba rev-parse HEAD)" = ${MGBA_COMMIT} \\\n        && cmake -S /tmp/mgba -B /tmp/mgba/build -DCMAKE_BUILD_TYPE=Release \\\n        -DBUILD_STATIC=ON -DBUILD_SHARED=OFF -DBUILD_QT=OFF -DBUILD_SDL=OFF -DBUILD_GL=OFF -DBUILD_GLES2=OFF -DBUILD_GLES3=OFF -DUSE_FFMPEG=OFF -DUSE_PNG=OFF \\\n        -DUSE_LIBZIP=OFF -DUSE_MINIZIP=OFF -DUSE_SQLITE3=OFF -DUSE_ELF=OFF -DUSE_LUA=OFF -DUSE_EDITLINE=OFF -DUSE_EPOXY=OFF -DUSE_DISCORD_RPC=OFF \\\n        -DUSE_GDB_STUB=OFF -DUSE_DEBUGGERS=OFF -DENABLE_SCRIPTING=OFF -DCMAKE_INSTALL_PREFIX=${join(OPT, "mgba")} \\\n        && cmake --build /tmp/mgba/build -j && cmake --install /tmp/mgba/build      (or set MGBA_PREFIX to an existing one)`],
    ["script compiler", scriptTool(), "kit setup downloads it"],
    ["player files", existsSync(join(REPO, "player/node_modules/@thenick775/mgba-wasm/dist/mgba.js")) ? join(REPO, "player") : null, "kit setup fetches them"],
  ];
}
function reportTools(): number { // prints; returns how many are missing that setup cannot fetch itself
  let blocking = 0;
  for (const [what, found, how] of tools()) {
    console.log(found ? `  ok       ${what}` : `  MISSING  ${what}: ${how}`);
    if (!found && !how.startsWith("kit setup")) blocking++;
  }
  return blocking;
}

// ---- game.md, settings, feed ----
const SCENES = ["Restyle a place", "Rename it", "Rewrite the people", "Your look", "The first leader", "The road between", "A new room", "Someone new to talk to", "A story beat", "A gift", "Your own interface", "Title and opening", "Share it"]; // the ladder in skills/make-your-game/SKILL.md, same names
const STARTER = `# My game

## Brief

Not written yet. The first conversation decides the place, who you are in it, and the first thing
that happens; then this paragraph is replaced with the answers.

## Scenes

${SCENES.map((s, i) => `- [ ] ${i + 1} ${s}`).join("\n")}

## Decisions

## Notes

- This folder is the game: a copy of your decomp, with one starting commit from setup. Each kept scene is one commit.
- The built game is out/game.gba; pictures are in shots/. With the base applied, settings.json holds the player's name and look.
`;
function scenes(): { done: boolean; name: string; number: number | null; about: string }[] {
  if (!existsSync(GAME_MD)) return [];
  return [...readFileSync(GAME_MD, "utf8").matchAll(/^- \[( |x|X)\] (.+)$/gm)].map((m) => { const [name, ...rest] = m[2]!.split(":"); return { done: m[1] !== " ", name: name!.trim(), number: /^\d+/.test(name!.trim()) ? parseInt(name!) : null, about: rest.join(":").trim() }; });
}
/** Scenes with the feed entries and pictures that belong to each: by the entry's scene, else by the picture's name (s2-..., 2-..., scene2-...). */
function scenesReport() {
  const feedFile = join(GAME, "feed.jsonl"), dir = join(GAME, "shots");
  const feed: any[] = existsSync(feedFile) ? readFileSync(feedFile, "utf8").split("\n").flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } }) : [];
  const loose = new Set(existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".png")).sort().map((f) => `shots/${f}`) : []);
  const num = (t: unknown) => (/^(?:s|scene)?0*(\d+)(?:\D|$)/i.exec(String(t ?? "").trim())?.[1] ?? null);
  const list = scenes().map((sc) => {
    const entries = feed.filter((e) => e.scene === sc.name || (sc.number !== null && num(e.scene) === String(sc.number)));
    const shots = [...new Set(entries.map((e) => e.shot).filter(Boolean) as string[])];
    for (const f of [...loose]) if (shots.includes(f) || (sc.number !== null && /^(?:s|scene)?0*\d+[-_]/i.test(f.slice(6)) && num(f.slice(6)) === String(sc.number))) { loose.delete(f); if (!shots.includes(f)) shots.push(f); }
    return { ...sc, entries, shots };
  });
  const claimed = new Set(list.flatMap((sc) => sc.entries));
  return { scenes: list, unsorted: { entries: feed.filter((e) => !claimed.has(e)), shots: [...loose] } };
}
const currentScene = () => scenes().find((s) => !s.done)?.name;
function writeSettingsHeader() { // settings.json -> include/studio_settings.h, only when it changes (so nothing rebuilds needlessly)
  const file = join(GAME, "settings.json"); if (!existsSync(file) || !existsSync(join(GAME, "include/studio_settings.h"))) return;
  let s: { player_name?: string; player_look?: string; private_scenes?: boolean };
  try { s = JSON.parse(readFileSync(file, "utf8")); } catch (e) { die(`settings.json is not valid JSON (${(e as Error).message}). It should look like: {"player_name": "PLAYER", "player_look": "girl"}`); }
  const name = s.player_name ?? "PLAYER", look = s.player_look ?? "girl";
  if (!/^[A-Za-z0-9 ]{1,7}$/.test(name)) die(`settings.json: player_name "${name}" will not fit. Use 1 to 7 letters, digits or spaces.`);
  if (look !== "girl" && look !== "boy") die(`settings.json: player_look must be "girl" or "boy", got "${look}".`);
  const h = `#ifndef GUARD_STUDIO_SETTINGS_H\n#define GUARD_STUDIO_SETTINGS_H\n// Written by \`kit build\` from settings.json in the game folder. Edit settings.json, not this file.\n#define STUDIO_PLAYER_NAME _("${name}")\n#define STUDIO_PLAYER_GENDER ${look === "boy" ? "MALE" : "FEMALE"}\n#define STUDIO_PRIVATE_SCENES ${s.private_scenes === true ? 1 : 0}\n#endif\n`;
  const out = join(GAME, "include/studio_settings.h");
  if (!existsSync(out) || readFileSync(out, "utf8") !== h) writeFileSync(out, h);
}

// ---- commands ----
async function build(): Promise<boolean> {
  needGame(); writeSettingsHeader();
  const start = Date.now(), log = join(OUT, "build.log");
  const p = Bun.spawn(["bash", join(KIT, "build.sh"), GAME], { env: childEnv({ SCRIPT_TOOL: scriptTool() ?? "" }), stdout: "inherit", stderr: "inherit" });
  const tick = setInterval(() => { // progress for long builds
    let n = 0; try { n = readFileSync(log, "utf8").split("\n").length; } catch {}
    console.log(`  building, ${Math.round((Date.now() - start) / 1000)} s so far (${n} steps done)`);
  }, 20000);
  const code = await p.exited; clearInterval(tick);
  return code === 0;
}

async function drive(steps: string[]): Promise<boolean> {
  needRom(); mkdirSync(join(GAME, "shots"), { recursive: true });
  return (await Bun.spawn([process.execPath, join(KIT, "drive.ts"), ...steps], { cwd: GAME, env: childEnv({ GAME_DIR: GAME, ROM }), stdout: "inherit", stderr: "inherit" }).exited) === 0;
}
function nextShot(): string {
  const name = opt("name"); if (name) return name.includes("/") ? name : `shots/${name}`;
  const dir = join(GAME, "shots"), nums = existsSync(dir) ? readdirSync(dir).map((f) => /^(?:s\d+-)?(\d{4})\.png$/.exec(f)?.[1]).filter(Boolean).map(Number) : [];
  const n = scenes().find((s) => !s.done)?.number; // the current scene's number leads the name, so pictures sort into scenes by themselves
  return `shots/${n ? `s${n}-` : ""}${String(Math.max(0, ...nums) + 1).padStart(4, "0")}.png`;
}
const shotStep = () => { const scale = opt("scale"), file = nextShot(); return ["shot", file, ...(scale ? ["--scale", scale] : [])]; };

async function play() {
  mkdirSync(OUT, { recursive: true });
  const rec = join(OUT, ".player.json"), log = join(OUT, "player.log"), phone = flag("phone");
  let r: { pid: number; phone: boolean; lines: string[] } | null = null;
  try { // the number may by now belong to another program: only a player counts
    r = JSON.parse(readFileSync(rec, "utf8")); process.kill(r!.pid, 0);
    if (!run(["ps", "-o", "args=", "-p", String(r!.pid)]).out.includes("player/server.ts")) r = null;
  } catch { r = null; }
  if (flag("stop")) { if (r) process.kill(r.pid); rmSync(rec, { force: true }); console.log(r ? "player stopped" : "the player was not running"); return; }
  needRom();
  if (r && (!phone || r.phone) && (await fetch(r.lines[0]!.split(/\s+/).pop()!).then((x) => x.ok, () => false))) { console.log(`${r.lines.join("\n")}\n(already running; reload the page to get the latest build)`); return; }
  if (r) process.kill(r.pid);
  if (!existsSync(join(REPO, "player/node_modules"))) die("The player's files are missing. Run: kit setup");
  writeFileSync(log, "", { mode: 0o600 }); chmodSync(log, 0o600); // it holds the phone link with its key
  const p = Bun.spawn(["setsid", process.execPath, join(REPO, "player/server.ts"), ...(phone ? ["--lan"] : [])], { env: childEnv({ ROM }), stdin: "ignore", stdout: Bun.file(log), stderr: Bun.file(log) });
  p.unref();
  let lines: string[] = [];
  for (let i = 0; i < 50 && !(lines.some((l) => l.startsWith("play on this")) && (!phone || lines.length > 1)); i++) { await Bun.sleep(100); lines = readFileSync(log, "utf8").split("\n").filter(Boolean); }
  if (!lines.some((l) => l.startsWith("play on this"))) die(`The player did not start. Its log: ${log}\n${lines.join("\n")}`);
  writeFileSync(rec, JSON.stringify({ pid: p.pid, phone, lines }), { mode: 0o600 }); chmodSync(rec, 0o600);
  console.log(`${lines.join("\n")}\nReload the page after each build. Stop it with: kit play --stop`);
}

function note() {
  needGame();
  const shot = opt("shot"), next = opt("next"), asked = opt("asked"), scene = opt("scene") ?? currentScene(), detail = opt("detail");
  const by = opt("by"), before = opt("before"), answers = opt("answers"), loreId = opt("lore"), did = args.join(" ").trim();
  if (!did) die(`kit note needs a sentence about what changed in the game: kit note "Added a woman by the stove."`);
  const inGame = (p?: string) => (p ? relative(GAME, isAbsolute(p) ? p : join(GAME, p)) : undefined);
  const rel = inGame(shot), relBefore = inGame(before);
  for (const r of [rel, relBefore]) if (r && !existsSync(join(GAME, r))) console.error(`note: the picture ${r} does not exist in the game folder (written anyway)`);
  const entry = { t: new Date().toISOString().replace(/\.\d+Z$/, "Z"), scene, asked, did, shot: rel, next, detail, by, before: relBefore, answers };
  const line = JSON.stringify(entry); // undefined fields are left out
  appendFileSync(join(GAME, "feed.jsonl"), line + "\n");
  console.log(line);
  if (loreId) console.log(setLineage(GAME, loreId, `note ${entry.t}`, did) ? `lineage: noted in lore/${loreId}.md` : `lineage: lore/${loreId}.md does not exist, so nothing was noted there (kit lore new ${loreId} "<NAME>")`);
}

function reviewsCmd() {
  needGame();
  const open = flag("open"), scene = opt("scene"), asJson = flag("json");
  const list = reviews(GAME).filter((r) => (!open || (r.verdict === "work" && !r.handled)) && (!scene || r.scene === scene || r.by === scene));
  if (asJson) { console.log(JSON.stringify(list, null, 1)); return; }
  if (!list.length) { console.log(open ? `Nothing is waiting: no entry is marked "needs work" without a later answer.` : "The user has not answered any feed entry yet (they do it in the pane)."); return; }
  for (const r of list) console.log(`${r.verdict === "work" ? (r.handled ? "needs work (answered)" : "NEEDS WORK") : "looks right"}  ${r.scene ?? "no scene"}  entry ${r.entry}\n    entry: ${r.did.slice(0, 140)}${r.shot ? `  [${r.shot}]` : ""}${r.note ? `\n    the user wrote: ${r.note}` : ""}${r.verdict === "work" && !r.handled ? `\n    when you have dealt with it: kit note "<what you changed>" --shot <png> --answers ${r.entry}` : ""}`);
}

function decideCmd() {
  needGame();
  const options = opt("options")?.split("|").map((o) => o.trim()).filter(Boolean), recommend = opt("recommend"), scene = opt("scene") ?? currentScene(), detail = opt("detail"), question = args.join(" ").trim();
  if (!question) die(`kit decide needs the question: kit decide "Which name for the harbour town?" --options "SALT QUAY|GULL REACH" --recommend "SALT QUAY"`);
  if (recommend && options && !options.includes(recommend)) die(`--recommend must be one of the options (${options.join(" | ")}); got "${recommend}"`);
  const d = ask(GAME, { question, options, recommend, scene, detail });
  console.log(`asked: ${d.id}  ${question}${options ? `\n  options: ${options.join(" | ")}${recommend ? `   (recommended: ${recommend})` : ""}` : ""}\nIt waits under Decisions in the pane. Carry on with what does not depend on it; read the answer with: kit decisions`);
}

function decisionsCmd() {
  needGame();
  const open = flag("open"), asJson = flag("json"), set = opt("answer"), list = decisions(GAME).filter((d) => !open || d.answer === null);
  if (set) { const id = args[0] ?? die('kit decisions --answer "<text>" needs the id: kit decisions <id> --answer "<text>"'); try { answer(GAME, id, set); console.log(`answered ${id}: ${set}`); } catch (e) { die(`kit decisions: ${(e as Error).message}`); } return; }
  if (asJson) { console.log(JSON.stringify(list, null, 1)); return; }
  if (!list.length) { console.log(open ? "No question is waiting for the user." : "No question has been asked yet (kit decide \"<question>\")."); return; }
  for (const d of list) console.log(`${d.answer === null ? "OPEN    " : "answered"}  ${d.id}  ${d.scene ?? "no scene"}  ${d.question}${d.options ? `\n    options: ${d.options.join(" | ")}${d.recommend ? `   (recommended: ${d.recommend})` : ""}` : ""}${d.answer !== null ? `\n    the user chose: ${d.answer}` : ""}`);
}

function settingsCmd() {
  needGame();
  const [key, ...rest] = args;
  try {
    if (!key) { console.log(JSON.stringify(settings(GAME), null, 1)); return; }
    if (!rest.length) { const v = settings(GAME)[key]; console.log(v === undefined ? `settings.json has no "${key}"` : typeof v === "string" ? v : JSON.stringify(v, null, 1)); return; }
    const raw = rest.join(" "); let value: unknown = raw; try { value = JSON.parse(raw); } catch {}
    setSettings(GAME, { [key]: value }); console.log(`settings.json: "${key}" is now ${JSON.stringify(value)}`);
  } catch (e) { die(`kit settings: ${(e as Error).message}`); }
}

function workersCmd() {
  needGame();
  let s: Record<string, any>; try { s = settings(GAME); } catch (e) { die(`kit workers: ${(e as Error).message}`); }
  const on = workers(s).filter((w) => w.enabled !== false), def = on.find((w) => w.name === s.default_worker)?.name ?? on[0]?.name ?? null;
  if (flag("json")) { console.log(JSON.stringify({ default: def, workers: on }, null, 1)); return; }
  if (!on.length) { console.log(`No helper is switched on. The user chooses them under Settings in the pane (settings.json: "workers").`); return; }
  for (const w of on) console.log(`${w.name === def ? "default" : "       "}  ${w.name}${w.model ? `  model ${w.model}` : ""}\n         start one with: ${w.how}${w.note ? `\n         ${w.note}` : ""}`);
}

function keep() {
  needGame();
  const name = args.join(" ").trim(); if (!name) die(`kit keep needs the scene's name: kit keep "1 Restyle a place"`);
  let ticked = "";
  if (existsSync(GAME_MD)) {
    const want = name.toLowerCase(), lines = readFileSync(GAME_MD, "utf8").split("\n");
    const i = lines.findIndex((l) => { const m = /^- \[ \] (.+)$/.exec(l), s = m?.[1]!.split(":")[0]!.trim().toLowerCase(); return !!s && (s === want || s.replace(/^\d+ /, "") === want || want.startsWith(s)); });
    if (i >= 0) { lines[i] = lines[i]!.replace("- [ ]", "- [x]"); writeFileSync(GAME_MD, lines.join("\n")); ticked = lines[i]!; }
  }
  git("add", "-A");
  if (git("diff", "--cached", "--quiet").ok) { console.log(`Nothing has changed since the last keep, so there is nothing to commit.`); return; }
  const c = git(...who(), "commit", "-q", "-m", name); if (!c.ok) die(`The commit failed:\n${c.out}`);
  console.log(`kept: ${git("log", "-1", "--format=%h %s").out}  (${git("show", "--stat", "--format=", "HEAD").out.split("\n").pop()!.trim()})`);
  console.log(ticked ? `ticked in game.md: ${ticked}` : `No unticked scene in game.md matches "${name}", so nothing was ticked. Tick it by hand if it should be.`);
}

function undo() {
  needGame();
  const dirty = git("status", "--porcelain").out, last = git("log", "-1", "--format=%s").out;
  if (dirty) {
    const n = dirty.split("\n").length;
    if (!flag("yes")) { console.log(`${n} file(s) changed since the last kept scene ("${last}"):\n${dirty.split("\n").slice(0, 15).join("\n")}${n > 15 ? "\n..." : ""}\nUndo would set these aside and go back to "${last}". Ask the user; if they say yes, run: kit undo --yes`); process.exitCode = 2; return; }
    const s = git("stash", "push", "--include-untracked", "-m", `kit undo ${new Date().toISOString()}`); if (!s.ok) die(`Could not set the changes aside:\n${s.out}`);
    console.log(`undone: ${n} changed file(s) set aside; the game folder is back at "${last}".\nTo bring them back: git -C ${GAME} stash pop\nRun kit build so the built game matches.`);
    return;
  }
  if (git("rev-parse", "HEAD").out === startCommit()) { console.log(`Nothing to undo: no scene has been kept yet and nothing has changed.`); return; }
  const r = git(...who(), "revert", "--no-edit", "HEAD"); if (!r.ok) { git("reset", "-q", "--hard"); die(`Could not take back "${last}":\n${r.out}`); }
  console.log(`undone: the kept scene "${last}" was taken back (its tick in game.md too). Now at: ${git("log", "-1", "--format=%h %s").out}\nTo bring it back: git -C ${GAME} revert --no-edit HEAD\nRun kit build so the built game matches.`);
}

function status() {
  console.log("toolchain:"); const missing = reportTools();
  if (!isSetUp()) { console.log(`game folder: none at ${GAME}\nnext: ${missing ? "get the missing tools above, then run" : "run"} kit setup --decomp <your decomp's folder or git address>  (the first build takes several minutes)`); return; }
  console.log(`decomp: ${describeTree()}\nbase: ${hasBase() ? "applied (calm changes, menu entry, test hook)" : `not applied. ${WITHOUT_BASE}`}`);
  const all = scenes(), kept = git("rev-list", "--count", "HEAD").out, cur = currentScene();
  console.log(`game folder: ${GAME}  (${git("log", "-1", "--format=last kept: %s, %cr").out}; ${kept} commits; ${git("status", "--porcelain").out ? "changes not kept yet" : "nothing unkept"})`);
  console.log(all.length ? `scene: ${cur ? `next is "${cur}"` : "every scene is ticked"}  (${all.filter((s) => s.done).length} of ${all.length} ticked in game.md)` : `scene: game.md has no scene list (lines like "- [ ] 1 Restyle a place")`);
  const lb = join(OUT, ".last-build");
  console.log(existsSync(lb) ? `last build: ${readFileSync(lb, "utf8").trim()}, at ${statSync(lb).mtime.toLocaleString()}` : existsSync(ROM) ? `last build: at ${statSync(ROM).mtime.toLocaleString()}` : "last build: none yet");
  try { const m = settings(GAME).image_model; if (m) console.log(`image model: ${m}  (the user's choice in settings.json; your picture tool should use it)`); } catch {}
  try { // the START menu's agent entry: the game's side is in the base, the other side is the player page
    const symf = ROM.replace(/\.gba$/, ".sym"), has = existsSync(symf) && /\bgHermesMailbox$/m.test(readFileSync(symf, "utf8")), st = settings(GAME);
    console.log(`in-game agent link: ${!existsSync(symf) ? "unknown until the game is built" : !has ? "this game has no mailbox for it (the base's menu entry is not in)" : st.hermes_link === false ? 'the game has the mailbox; switched off (settings.json "hermes_link": false)' : `the game has the mailbox; on. In the player, START and the agent entry open a box for your words; they go to \`${st.hermes_command ?? "hermes"}\`, conversation "${st.hermes_session ?? "rom-studio-game"}"`}`);
  } catch {}
  console.log(`next: ${missing ? "get the missing tools above" : !existsSync(ROM) ? "run kit build" : "kit play to open the game, kit shot for a picture"}`);
}

async function setup() {
  const t0 = Date.now(), secs = () => `${Math.round((Date.now() - t0) / 1000)} s`, src = opt("decomp"), noBase = flag("no-base");
  console.log("1/5 tools");
  if (reportTools()) die("Setup stopped: get the tools marked MISSING above, then run kit setup again. Nothing was changed.");
  console.log(`2/5 your decomp -> ${GAME}`);
  const remote = !!src && /^(https?:\/\/|ssh:\/\/|git:\/\/|git@)/.test(src);
  if (src && (src.startsWith("-") || /[\0-\x1f]/.test(src) || (remote && !/^(\w+:\/\/|git@)[\w.[][^\s]*$/.test(src)))) die(`"${src}" is not a folder or a git address this takes (https://, ssh://, git:// or git@host:path).`);
  if (src && !remote && resolve(src) === GAME) die(`The game folder must be a copy, so your decomp stays as it is. Give a different folder with --game <dir>.`);
  if (isGame()) console.log("  already there");
  else {
    if (!src) die(NO_DECOMP);
    if (existsSync(GAME) && readdirSync(GAME).length) die(`${GAME} exists and is not a game folder. Choose an empty or new folder with --game <dir>.`);
    if (remote) { if (!run(["git", "-c", "protocol.ext.allow=never", "-c", "protocol.file.allow=never", "clone", "--depth", "1", "--", src, GAME], { show: true }).ok) die("The download failed. Check the address and the network, then run kit setup again."); } // only the address asked for, over the network, and never read as an option
    else {
      const from = resolve(src);
      if (!existsSync(join(from, "Makefile"))) die(`${from} does not look like a decomp (no Makefile at its top). Give the folder that holds the source.`);
      if (existsSync(join(from, ".git"))) { if (!run(["git", "clone", "-q", "-c", "advice.detachedHead=false", "--", from, GAME], { show: true }).ok) die(`Could not copy ${from}.`); }
      else { cpSync(from, GAME, { recursive: true }); git("init", "-q"); git("add", "-A"); git(...who(), "commit", "-q", "-m", "the decomp as supplied"); }
    }
    git("switch", "-q", "-c", "my-game"); console.log(`  copied (${secs()}); your original is untouched`);
  }
  console.log(`  it is: ${describeTree()}`);
  console.log("3/5 calm and helper base, starter files");
  if (isSetUp()) console.log(`  already done (base ${hasBase() ? "applied" : "not applied"})`);
  else {
    if (git("status", "--porcelain").out) die(`${GAME} has changes that are not committed, and setup will not touch them. Commit them there, or let setup make its own copy: kit setup --decomp ${GAME} --game <new folder>`);
    const fits = existsSync(join(GAME, BASE_FOR.file)) && git("hash-object", BASE_FOR.file).out === BASE_FOR.blob;
    let why = hasBase() ? "" : noBase ? "you asked for none" : !existsSync(join(KIT, "base/patches")) ? "this copy of ROM Studio does not carry the optional base (kit/base)" : !fits ? `it was made for ${BASE_FOR.says} and this tree is something else` : "";
    if (!hasBase() && !why) {
      for (const p of readdirSync(join(KIT, "base/patches")).sort()) if (!git("apply", "--whitespace=nowarn", join(KIT, "base/patches", p)).ok) { why = `its change ${p} does not fit this tree (the tree has its own changes there)`; break; }
      if (why) { git("reset", "-q", "--hard"); git("clean", "-qfd"); }
      else { cpSync(join(KIT, "base/overlay"), GAME, { recursive: true }); writeFileSync(join(GAME, "settings.json"), `{"player_name": "PLAYER", "player_look": "girl"}\n`); }
    }
    console.log(why ? `  base SKIPPED: ${why}.\n  ${WITHOUT_BASE}` : "  base applied: calm changes, menu entry, quick start, test hook");
    appendFileSync(join(GAME, ".git/info/exclude"), "out/\nshots/\nrefs/\nfeed.jsonl\n");
    writeFileSync(GAME_MD, STARTER);
    git("add", "-A");
    const c = git(...who(), "commit", "-q", "-m", why ? "start: game notes" : "base: calm patches, menu entry, test hook"); if (!c.ok) die(`Could not commit the start:\n${c.out}`);
    git("tag", "-f", "kit-start"); console.log(`  committed: ${git("log", "-1", "--format=%h %s").out}`);
  }
  mkdirSync(join(GAME, "shots"), { recursive: true }); if (!existsSync(join(GAME, "feed.jsonl"))) writeFileSync(join(GAME, "feed.jsonl"), "");
  console.log("4/5 emulator, script compiler, player files");
  if (!existsSync(EMU) && !run(["bash", join(KIT, "emu/build.sh")], { show: true, env: { MGBA_PREFIX: env.MGBA_PREFIX ?? join(OPT, "mgba") } }).ok) die("The headless emulator did not build; the error is above.");
  if (!scriptTool()) {
    const dl = join(KIT, ".cache/poryscript-dl"), zip = join(KIT, ".cache/script-tool.zip"); rmSync(dl, { recursive: true, force: true }); mkdirSync(dl, { recursive: true });
    if (!run(["curl", "-fsSL", "--proto", "=https", "-o", zip, SCRIPT_TOOL_URL]).ok) die(`Could not download the script compiler from ${SCRIPT_TOOL_URL}. Check the network, or unpack it yourself and set SCRIPT_TOOL to its folder.`);
    const got = new Bun.CryptoHasher("sha256").update(readFileSync(zip)).digest("hex");
    if (got !== SCRIPT_TOOL_SHA256) { rmSync(zip, { force: true }); die(`The script compiler that came from ${SCRIPT_TOOL_URL} is not the file this kit was made with (sha256 ${got}), so it was not unpacked. Get it yourself and set SCRIPT_TOOL to its folder.`); }
    if (!run(["python3", "-I", "-m", "zipfile", "-e", zip, dl]).ok) die("The script compiler's archive could not be unpacked. Unpack it yourself and set SCRIPT_TOOL to its folder.");
    const inner = existsSync(join(dl, "poryscript")) ? dl : join(dl, readdirSync(dl)[0]!);
    chmodSync(join(inner, "poryscript"), 0o755); renameSync(inner, join(KIT, ".cache/poryscript")); rmSync(zip, { force: true }); rmSync(dl, { recursive: true, force: true }); console.log("  script compiler downloaded");
  }
  if (!existsSync(join(REPO, "player/node_modules/@thenick775/mgba-wasm/dist/mgba.js")) && !run([process.execPath, "install", "--frozen-lockfile"], { cwd: join(REPO, "player"), show: true }).ok) die("The player's files did not download. Check the network and run kit setup again.");
  console.log("  ready");
  console.log(`5/5 build${existsSync(ROM) ? "" : " (the first one compiles everything: about 5 to 10 minutes)"}`);
  if (!(await build())) die("The build failed; the first error is above. If it is about the compiler, this decomp may need a different one than the kit checks for: its own install notes say which. Then run kit setup again.");
  await drive(["wait", "60", "where", "shot", "shots/first.png"]);
  console.log(`Setup done in ${secs()}. Game folder: ${GAME}\nnext: kit play to open the game; talk to your agent to start scene 1.`);
}

/** kit patch: out/game.gba as a BPS patch against the user's own original game file, checked by applying it again. */
function patchCmd() {
  needGame();
  if (!opt("check")) { let priv = false; try { priv = JSON.parse(readFileSync(join(GAME, "settings.json"), "utf8")).private_scenes === true; } catch {} if (priv) die("this build has private scenes; set private_scenes to false and build again before making a patch"); }
  const check = opt("check"), given = opt("original"), file = resolve(GAME, opt("file") ?? "out/game.bps");
  const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`, sha1 = (b: Uint8Array) => new Bun.CryptoHasher("sha1").update(b).digest("hex");
  const read = (p: string, what: string) => { if (!existsSync(p) || !statSync(p).isFile()) die(`There is no ${what} at ${p}.`); return new Uint8Array(readFileSync(p)); };
  const same = (a: Uint8Array, b: Uint8Array) => { if (a.length !== b.length) return -2; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i; return -1; };
  if (check) {
    const orig = read(resolve(check), "original game file"); let got: Uint8Array;
    try { got = applyBps(read(file, "patch (make one with: kit patch)"), orig); } catch (e) { die(`check FAILED: the patch ${file} does not apply to ${resolve(check)}: ${(e as Error).message}.`); }
    if (!existsSync(ROM)) { console.log(`check: the patch applies to ${resolve(check)} and gives the game it was made from (${mb(got.length)}, sha1 ${sha1(got)}). There is no built game here to compare with.`); return; }
    const d = same(got, new Uint8Array(readFileSync(ROM)));
    if (d === -1) { console.log(`check: the patch ${file}, applied to a copy of ${resolve(check)}, gives ${ROM} byte for byte (${mb(got.length)}). Nothing was written.`); return; }
    die(`check: the patch applies, but gives a different game from the built one (${d === -2 ? "a different size" : `first difference at byte 0x${d.toString(16)}`}): it was made before the last build. Run: kit patch`);
  }
  needRom();
  let setting: string | undefined; try { setting = JSON.parse(readFileSync(join(GAME, "settings.json"), "utf8")).original_game; } catch {}
  const from = given ? resolve(given) : setting ? resolve(GAME, setting) : die(`kit patch needs your own copy of the original game file, the one your decomp rebuilds (when the decomp has a rom.sha1 at its top, that is the file's sha1).
Give it once with: kit patch --original <file>   or keep it in settings.json in the game folder as: "original_game": "<file>"`);
  const orig = read(from, "original game file"), built = new Uint8Array(readFileSync(ROM)), t0 = Date.now();
  const r = makeBps(orig, built); let back: Uint8Array | null = null; try { back = applyBps(r.patch, orig); } catch {}
  if (!back || same(back, built) !== -1) die("kit patch: the patch did not give the built game back when applied, so nothing was written. This is a fault in the kit, not in your game.");
  mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, r.patch);
  const want = existsSync(join(GAME, "rom.sha1")) ? readFileSync(join(GAME, "rom.sha1"), "utf8").trim().split(/\s+/)[0] : undefined, have = sha1(orig);
  const failed = existsSync(join(OUT, ".last-build")) && readFileSync(join(OUT, ".last-build"), "utf8").startsWith("FAILED");
  console.log(`patch: ${file} (${mb(r.patch.length)}, made and checked in ${((Date.now() - t0) / 1000).toFixed(0)} s)
  from: ${from} (${mb(orig.length)}, sha1 ${have})${want ? (want === have ? ", the file this decomp names in rom.sha1" : `\n        NOT the file this decomp names in rom.sha1 (${want}): whoever applies the patch needs exactly this file`) : ""}
  to:   ${ROM} (${mb(built.length)}, built ${statSync(ROM).mtime.toLocaleString()})${failed ? "\n        the last build FAILED, so this is the build before it" : ""}
  checked: applied again to the original, it gives the built game byte for byte
  ${mb(r.literal)} of the patch is bytes the original does not have; the rest of the game is copied from the receiver's own original
Share only the .bps file. The other person applies it to their own copy of the same original game file (sha1 above) with any program that
applies BPS patches. Never send the built game. To check a patch against an original: kit patch --check <original file>`);
}

switch (command) {
  case "help": case "--help": case "-h": console.log(HELP); break;
  case "status": status(); break;
  case "setup": await setup(); break;
  case "build": if (!(await build())) process.exit(1); break;
  case "play": await play(); break;
  case "shot": {
    const at = opt("at"), time = opt("time"), shot = shotStep(), m = at?.split(/[.,]/);
    if (at && m!.length !== 4) die(`--at takes a map and a square as group.number,x,y, for example --at 0.9,5,5 (kit where prints the map this way)`);
    if (!(await drive([...(time ? ["time", time] : []), ...(m ? ["warp", ...m] : args.length || time ? [] : ["wait", "60"]), ...args, ...shot]))) process.exit(1); break;
  }
  case "press": {
    if (!args.length) die(`kit press needs buttons or steps: kit press A,A,UP:30   or   kit press walk UP:3 press A wait 40`);
    const shot = shotStep(), raw = ["press", "walk", "warp", "wait", "flag", "load", "save", "where", "shot", "givemon", "script", "gender", "time", "rtc"].includes(args[0]!);
    if (!(await drive([...(raw ? [] : ["press"]), ...args, "where", ...shot]))) process.exit(1); break;
  }
  case "where": if (!(await drive([...args, "where"]))) process.exit(1); break;
  case "maps": {
    needGame(); const all = flag("all"), asJson = flag("json"), was = all ? null : git("show", `${startCommit()}:data/maps/map_groups.json`);
    let list: ReturnType<typeof listMaps>; try { list = listMaps(GAME, was?.ok ? mapNames(was.out) : new Set()); } catch (e) { die(`kit maps: ${(e as Error).message}`); }
    if (asJson) console.log(JSON.stringify(list, null, 1));
    else console.log(list.length ? list.map(mapText).join("\n") : "No maps of your own yet: none has been added since setup. kit maps --all lists the original game's.");
    break;
  }
  case "map": {
    needGame(); const png = opt("png"), ov = opt("overlay") ?? "", scale = Number(opt("scale") ?? 2), name = args[0] ?? die("kit map needs a map's name, as kit maps prints it: kit map MyRoom --overlay all");
    if (!Number.isInteger(scale) || scale < 1 || scale > 8) die("--scale is a whole number from 1 to 8");
    const kinds = ["people", "doors", "joins", "collision"], want = ov === "all" ? kinds : ov.split(",").filter(Boolean), bad = want.find((k) => !kinds.includes(k));
    if (bad) die(`--overlay takes any of ${kinds.join(", ")} (comma-separated) or all; got "${bad}"`);
    try {
      const r = renderMap(GAME, name, new Set(want as Overlay[]), scale), out = resolve(GAME, png ?? `shots/maps/${name}.png`);
      mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, r.png);
      console.log(`map picture: ${out} (${r.width}x${r.height})\n${r.legend.join("\n")}`);
    } catch (e) { die(`kit map: ${(e as Error).message}`); }
    break;
  }
  case "tileset": {
    needGame(); const where = opt("out"), pngTo = opt("png"), only = opt("maps"), force = flag("force"), asJson = flag("json"), [name, what] = args;
    const profile = opt("profile"), strips = opt("strips"), loreId = opt("lore"), paletteOnly = flag("palette-only");
    if (!name || !["roles", "maps", "before-after", "restyle", "objects"].includes(what ?? "")) die("kit tileset needs a tileset and what to do: kit tileset general roles | maps | before-after | restyle | objects   (kit maps --all shows each map's tilesets)");
    try {
      const { symbol, primary } = findTileset(GAME, name!), short = symbol.replace("gTileset_", ""), using = tilesetMaps(GAME, symbol);
      if (what === "objects") {
        const r = findObjects(GAME, name!), sheet = resolve(GAME, pngTo ?? `shots/tilesets/${short}-objects.png`);
        mkdirSync(dirname(sheet), { recursive: true }); writeFileSync(sheet, r.sheet);
        if (asJson) { console.log(JSON.stringify({ sheet, objects: r.objects }, null, 1)); break; }
        console.log(`${r.summary}\nmap picture: ${sheet} (each object numbered: number, size, times placed)\nCandidates, found by how maps place blocks. "whole": touching squares that are solid or drawn over the player, as one map has them (two things that touch come out as one).\n"part": blocks that maps always put side by side. Block ids are hex; · is a square that is not part of it.\n${r.objects.slice(0, 40).map(objectText).join("\n")}${r.objects.length > 40 ? `\n  (${r.objects.length - 40} more, placed less often; --json has all, the sheet shows the first 48)` : ""}\nTo see the tiles of one: kit redraw dump <map> <x> <y> <w> <h>`); break;
      }
      if (what === "restyle") {
        if (!profile) die(`kit tileset ${name} restyle needs your look: --profile <file.json>. The top of ${join(KIT, "restyle.py")} shows what the file holds.`);
        const prof = existsSync(resolve(profile)) ? resolve(profile) : resolve(GAME, profile); if (!existsSync(prof)) die(`There is no profile at ${profile} (looked here and in the game folder).`);
        const dir = relative(GAME, tileset(GAME, symbol).dir), rolesFile = join(GAME, dir, "roles.json");
        if (!existsSync(rolesFile)) { const r = roleTable(GAME, name!), sheet = resolve(GAME, `shots/tilesets/${short}-roles.png`); mkdirSync(dirname(sheet), { recursive: true }); r.table.sheet = relative(GAME, sheet); writeFileSync(rolesFile, JSON.stringify(r.table, null, 1) + "\n"); writeFileSync(sheet, r.sheet); console.log(`no role table yet, so a first guess was written: ${rolesFile}\nmap picture: ${sheet}`); }
        const count = new Map<string, number>(); for (const m of using) { const p = layouts(GAME).get(m.layout).primary_tileset as string; count.set(p, (count.get(p) ?? 0) + 1); }
        const partner = primary ? null : [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? die(`No map uses ${short}, so its partner tileset is unknown.`);
        const cmd = ["python3", join(KIT, "restyle.py"), "--game", GAME, "--base", startCommit(), "--profile", prof, dir, ...(partner ? ["--primary", relative(GAME, tileset(GAME, partner).dir)] : []), ...(paletteOnly ? ["--palette-only"] : []), ...(strips ? ["--strips", strips] : [])];
        const r = run(cmd); console.log(r.out); if (!r.ok) process.exit(1);
        let id = loreId; try { id ??= JSON.parse(readFileSync(prof, "utf8")).lore; } catch {}
        if (id) console.log(setLineage(GAME, id, `kit restyle ${short}`, `redrawn in place by role with the profile ${relative(GAME, prof)}${paletteOnly ? " (palettes only)" : ""}; ${using.length} maps use it. ${r.out.split("\n")[0]!.replace(/^[^:]+: /, "")}`) ? `lineage: noted in lore/${id}.md` : `lineage: lore/${id}.md does not exist, so nothing was noted (kit lore new ${id} "<NAME>")`);
        if (existsSync(join(GAME, dir, "appended.json"))) console.log("This tileset also carries drawings put on by kit redraw, and the restyle has just painted over their tiles: run kit redraw <your art module> --write again now.");
        console.log(`${using.length} maps changed at once. Next: kit tileset ${name} before-after   then kit build and a picture in the game.\nTo correct: edit "role" in ${relative(GAME, rolesFile)} or the profile, and run this again (it always starts from the original art).`); break;
      }
      if (what === "maps") { console.log(asJson ? JSON.stringify(using, null, 1) : `${using.length} maps use ${short}:\n${using.map((m) => `  ${m.name}  map ${m.group}.${m.number}  ${m.width}x${m.height}  ${m.type}  with ${m.tilesets.filter((t) => t !== short).join("") || short}`).join("\n")}`); break; }
      if (what === "roles") {
        const r = roleTable(GAME, name!), out = where ? join(resolve(where), `${short}-roles.json`) : join(r.dir, "roles.json");
        const sheet = resolve(GAME, pngTo ?? (where ? join(resolve(where), `${short}-roles.png`) : `shots/tilesets/${short}-roles.png`));
        if (existsSync(out) && !force) die(`${out} already exists (someone may have corrected it). Add --force to replace it, or --out <dir> to write elsewhere.`);
        mkdirSync(dirname(out), { recursive: true }); mkdirSync(dirname(sheet), { recursive: true });
        r.table.sheet = relative(GAME, sheet); writeFileSync(out, JSON.stringify(r.table, null, 1) + "\n"); writeFileSync(sheet, r.sheet);
        console.log(`${r.summary}\nrole table: ${out}\nmap picture: ${sheet}\nThese are first guesses. Look at the sheet, correct "role" in the table where a block is labelled wrongly, then restyle.`); break;
      }
      const pick = only?.split(",") ?? using.slice(0, 3).map((m) => m.name), tmp = join(OUT, ".before"), out = resolve(GAME, pngTo ?? `shots/tilesets/${short}-before-after.png`);
      if (!pick.length) die(`No map uses ${short}.`);
      rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
      const paths = ["data/tilesets", "data/layouts", "src/data/tilesets", "include/fieldmap.h", ...pick.map((m) => `data/maps/${m}/map.json`)].filter((p) => git("cat-file", "-e", `HEAD:${p}`).ok);
      if (!run(["bash", "-c", 'g="$1"; t="$2"; shift 2; git -C "$g" archive HEAD -- "$@" | tar -x -C "$t"', "sh", GAME, tmp, ...paths]).ok) die("Could not read the last kept version of the tileset from git.");
      const r = beforeAfter(tmp, GAME, pick); rmSync(tmp, { recursive: true, force: true });
      mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, r.png);
      console.log(`map picture: ${out} (${r.width}x${r.height})\nleft: the last kept scene ("${git("log", "-1", "--format=%s").out}"); right: now\n${r.lines.join("\n")}`);
    } catch (e) { die(`kit tileset: ${(e as Error).message}`); }
    break;
  }
  case "redraw": {
    needGame(); const write = flag("write"), only = opt("only"), py = ["python3", join(KIT, "objects.py"), "--game", GAME, "--base", startCommit()];
    if (args[0] === "dump") { const r = run([...py, ...args]); console.log(r.out); if (!r.ok) process.exit(1); break; }
    if (!args[0] || !existsSync(resolve(GAME, args[0]))) die(`kit redraw needs your art module, a file in the game folder: kit redraw tools/my_art.py [--write]. The top of ${join(KIT, "objects.py")} shows what it holds.`);
    const r = run([...py, resolve(GAME, args[0]), ...(write ? ["--write"] : []), ...(only ? ["--only", only] : [])]);
    const lines = r.out.split("\n"); console.log(lines.filter((l) => !l.startsWith("LINEAGE\t")).join("\n")); if (!r.ok) process.exit(1);
    for (const l of lines) { const [tag, id, group, what] = l.split("\t"); if (tag === "LINEAGE") console.log(setLineage(GAME, id!, `kit redraw ${group}`, `drawn new by ${relative(GAME, resolve(GAME, args[0]))} (${what})`) ? `lineage: noted in lore/${id}.md` : `lineage: lore/${id}.md does not exist, so nothing was noted for ${group}`); }
    console.log(write ? "Next: kit build and a picture in the game." : "Look at the previews; when they are right, run it again with --write.");
    break;
  }
  case "gates": {
    needGame(); const from = opt("from"), to = opt("to"), asJson = flag("json");
    try {
      const was = git("show", `${startCommit()}:data/maps/map_groups.json`);
      const { path, side } = from && to ? pathBetween(GAME, from, to) : { path: listMaps(GAME, was.ok ? mapNames(was.out) : new Set()), side: [] };
      if (!path.length) die("kit gates needs two maps: kit gates --from <map> --to <map>   (with neither it looks at your own maps, and you have none yet)");
      const found = [...path, ...side].map((m) => ({ map: m.name, gates: gatesIn(GAME, m) }));
      if (asJson) { console.log(JSON.stringify({ note: "candidates, not certainties", path: path.map((m) => m.name), side: side.map((m) => m.name), gates: found.flatMap((f) => f.gates) }, null, 1)); break; }
      console.log(`These are candidates, not certainties: found by reading the scripts, not by playing. Check each in the game before relying on it.\n${from && to ? `walk: ${path.map((m) => m.name).join(" > ")}${side.length ? `\noff the path, through doors: ${side.map((m) => m.name).join(", ")}` : ""}` : "your own maps:"}`);
      for (const f of found) console.log(`${f.map}: ${f.gates.length ? `${f.gates.length} candidates\n${f.gates.sort((a, b) => Number(b.moves_player) - Number(a.moves_player)).map(gateText).join("\n")}` : "nothing found"}`);
    } catch (e) { die(`kit gates: ${(e as Error).message}`); }
    break;
  }
  case "scenes": {
    needGame(); const r = scenesReport();
    if (flag("json")) { console.log(JSON.stringify(r, null, 1)); break; }
    if (!r.scenes.length) console.log(`game.md has no scene list (lines like "- [ ] 1 Restyle a place").`);
    for (const sc of r.scenes) console.log(`[${sc.done ? "x" : " "}] ${sc.name}${sc.about ? `: ${sc.about}` : ""}\n      ${sc.entries.length} feed entries, ${sc.shots.length} pictures${sc.shots.length ? ` (latest ${sc.shots.at(-1)})` : ""}${sc.entries.length ? `\n      last: ${sc.entries.at(-1).did}` : ""}`);
    console.log(`not sorted into a scene: ${r.unsorted.entries.length} feed entries, ${r.unsorted.shots.length} pictures`);
    break;
  }
  case "lore": {
    needGame(); const asJson = flag("json"), [a, b, ...rest] = args;
    try {
      if (a === "new") { if (!b || !rest.length) die('kit lore new needs an id and a name: kit lore new harbour-town "HARBOUR TOWN"'); console.log(`lore file: ${newLore(GAME, b, rest.join(" "))}\nFill in the line under the title and the Look heading; tag what belongs to it with a comment: lore: ${b}`); break; }
      if (a === "check") { const c = loreCheck(GAME); console.log(asJson ? JSON.stringify(c, null, 1) : checkText(c)); break; }
      if (!a) { console.log(asJson ? JSON.stringify(loreFiles(GAME).map(({ id, name, mood, file }) => ({ id, name, mood, file })), null, 1) : listText(GAME)); break; }
      const r = loreReport(GAME, a); console.log(asJson ? JSON.stringify(r, null, 1) : reportText(r));
    } catch (e) { die(`kit lore: ${(e as Error).message}`); }
    break;
  }
  case "music": needGame(); process.exit(musicCommand(GAME, args));
  case "find": needGame(); process.exit(await findCommand(GAME, args));
  case "dialogue": needGame(); process.exit(dialogueCommand(GAME, args));
  case "note": note(); break;
  case "reviews": reviewsCmd(); break;
  case "decide": decideCmd(); break;
  case "decisions": decisionsCmd(); break;
  case "settings": settingsCmd(); break;
  case "workers": workersCmd(); break;
  case "keep": keep(); break;
  case "undo": undo(); break;
  case "patch": patchCmd(); break;
  default: die(`kit: no command "${command}".\n\n${HELP}`);
}
