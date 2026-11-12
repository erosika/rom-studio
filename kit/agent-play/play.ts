// kit/agent-play/play.ts: `kit agent-play`. The built game runs in the headless emulator and an agent plays it, one
// step at a time: it is shown the screen and told what the game says, it answers with button presses and a thought.
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { encodePng } from "../png";
import { PROVIDERS, commandAgent, modelAgent, quietEnv, type Agent } from "./agents";
import { H, W, openGame } from "./game";
import { HOW, LIMITS, parseAction, whyStop, without, words, type Past, type Step, type Where } from "./shapes";
import { serveWatch, type Showing } from "./watch";

const USAGE = `kit agent-play: an agent plays your built game in the headless emulator. Each step it is given a picture of the screen, the
text in the message box, where the player is, its last few steps and its own notes; it answers with button presses and one line of thought.

Who plays (one of):
  --agent "<command>"        your own agent as a command. It is started once per step, reads the step (one line of JSON) on its standard
                             input and writes its answer (a JSON object) to standard output. No shell reads the command line.
        --agent-env A,B      names of environment variables the command may see (it gets a short plain list otherwise, no keys)
  --provider <${Object.keys(PROVIDERS).join("|")}> --model <id>   a model behind an HTTP chat API that takes pictures
        --key-env NAME       the environment variable that holds the key (default ${Object.entries(PROVIDERS).map(([k, v]) => `${v.keyEnv} for ${k}`).join(", ")}). The key is read
                             from there only: never written to a file, never printed, never given to another program
        --base-url <url>     another server that speaks the provider's shape (https, or http on this computer)
        --reply-tokens 4000  the most one answer may cost in output

How long:
  --steps 100                steps in this run
  --cap-steps 10000          steps over every run of this save; play stops there
  --cap-tokens 200000        tokens over every run of this save (what the model's service reports; a command may report "tokens" in
                             its answer). Checked before each step, so the last answer may pass it by one step's worth
  --timeout 120              seconds an answer may take

The save: --name play        out/agent-play/<name>/ in the game folder: state.ss (the moment play stopped; the next run carries on from it),
                             run.json (totals, notes), steps.jsonl (every step: what the agent saw, did and thought), pictures/<step>.png,
                             and its own copy of the build it began with (a later kit build does not change the game under a save)
  --fresh                    start over from switching the game on; the old save is moved aside, not deleted
  --picture-scale 2          enlarge the agent's picture by this whole number      --inline-picture   also put it in the step as base64

Watching: --watch [8790]     a page on this computer only (127.0.0.1) with the live picture, the agent's latest thought, where it is, how
                             long it has played and the last twenty steps. It only shows; it cannot press. The picture goes through the
                             player's flash guard, always. While watched the game runs at its own speed instead of as fast as it can.

The step (standard input of --agent, one line):
  {"v":1, "step":12, "steps_left":88, "picture":{"path":"<png file>","width":480,"height":320}, "text":"<message box, or empty>",
   "where":{"map":"0.9","x":5,"y":5,"facing":"up","control":true} or null, "last":[{"step":11,"do":"walk UP:2","thought":"...","result":"..."}],
   "notes":"<your own notes>", "played":{"steps":11,"seconds":40}, "how":"<the rules below>"}
The answer:
  ${HOW.split("\n").join("\n  ")}
A sample agent that follows these shapes without any model: ${join(import.meta.dir, "sample-agent.ts")}  (--agent "bun <that file>")`;

type Run = { v: 1; rom: string; steps: number; tokens: number; played_ms: number; notes: string; last: Past[]; agent: string; updated: string };

export async function agentPlayCommand(gameDir: string, argv: string[]): Promise<number> {
  const args = [...argv], fail = (msg: string): never => { throw new Error(msg); };
  const opt = (name: string) => { const i = args.indexOf(`--${name}`); if (i < 0) return undefined; if (args[i + 1] === undefined) fail(`--${name} needs a value. See: kit agent-play help`); return args.splice(i, 2)[1]; };
  const flag = (name: string) => { const i = args.indexOf(`--${name}`); if (i >= 0) args.splice(i, 1); return i >= 0; };
  const count = (name: string, def: number, max = 1e9) => { const v = opt(name); if (v === undefined) return def; const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > max) fail(`--${name} must be a whole number from 1${max < 1e9 ? ` to ${max}` : ""}, got "${v}"`); return n; };
  if (args[0] === "help" || flag("help")) { console.log(USAGE); return 0; }
  let game: Awaited<ReturnType<typeof openGame>> | null = null, page: ReturnType<typeof serveWatch> | null = null, key: string | undefined;
  try {
    // ---- who plays ----
    const command = opt("agent"), provider = opt("provider"), model = opt("model"), keyEnv = opt("key-env"), baseUrl = opt("base-url"), passed = (opt("agent-env") ?? "").split(",").filter(Boolean);
    const timeoutMs = count("timeout", 120, 3600) * 1000, replyTokens = count("reply-tokens", 4000, 200_000);
    const caps = { steps: count("steps", 100), capSteps: count("cap-steps", 10_000), capTokens: count("cap-tokens", 200_000) };
    const name = opt("name") ?? "play", fresh = flag("fresh"), scale = count("picture-scale", 2, 8), inline = flag("inline-picture");
    let port: number | null = null;
    { const i = args.indexOf("--watch"); if (i >= 0) { const p = /^\d+$/.test(args[i + 1] ?? "") ? Number(args.splice(i + 1, 1)[0]) : 8790; args.splice(i, 1); if (p < 1024 || p > 65535) fail("--watch takes a port from 1024 to 65535"); port = p; } }
    if (args.length) fail(`agent-play does not know "${args[0]}". See: kit agent-play help`);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/.test(name)) fail("--name is letters, digits, - and _ (it names a folder)");
    if (!!command === !!provider) fail(`Say who plays: --agent "<command>", or --provider <${Object.keys(PROVIDERS).join("|")}> --model <id>. See: kit agent-play help`);
    let agent: Agent;
    if (command) {
      if (model || keyEnv || baseUrl) fail("--model, --key-env and --base-url go with --provider, not with --agent");
      const argvAgent = words(command); if (!argvAgent.length) fail("--agent is empty");
      agent = commandAgent(argvAgent, { timeoutMs, env: quietEnv(passed) });
    } else {
      if (passed.length) fail("--agent-env goes with --agent: a model is asked over HTTP and no program is started for it");
      const p = PROVIDERS[provider!] ?? fail(`unknown provider "${provider}". Providers: ${Object.keys(PROVIDERS).join(", ")}`), from = keyEnv ?? p.keyEnv;
      if (!model) fail("--provider needs --model <id>: the model is your choice, and your cost");
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(from)) fail("--key-env is the NAME of an environment variable, not the key itself");
      key = process.env[from]; delete process.env[from]; // from here on the key lives in the model agent only
      if (!key) fail(`No key: the environment variable ${from} is not set. Set it in your shell, or name another with --key-env`);
      agent = modelAgent({ provider: provider!, model: model!, key: key!, baseUrl, replyTokens, timeoutMs });
    }

    // ---- the game and the save ----
    const kit = resolve(import.meta.dir, ".."), bin = join(kit, "emu/bin/studio-emu"), built = join(gameDir, "out/game.gba"), builtSym = join(gameDir, "out/game.sym");
    if (!existsSync(bin)) fail(`The headless emulator is not built. Run: bash ${join(kit, "emu/build.sh")}`);
    if (!existsSync(built) || !existsSync(builtSym)) fail("The game has not been built yet. Run: kit build");
    const dir = join(gameDir, "out/agent-play", name);
    if (fresh && existsSync(dir)) { const aside = `${dir}.${new Date().toISOString().replace(/[:.]/g, "-")}`; renameSync(dir, aside); console.log(`agent-play: the old save is kept at ${aside}`); }
    mkdirSync(join(dir, "pictures"), { recursive: true });
    // the save keeps its own copy of the build it began with: a saved moment only fits that build, and a build made while an agent plays must not change the game under it
    const rom = join(dir, "game.gba"), sym = join(dir, "game.sym"), runFile = join(dir, "run.json"), stateFile = join(dir, "state.ss"), logFile = join(dir, "steps.jsonl");
    const hashOf = (file: string) => createHash("sha1").update(readFileSync(file)).digest("hex").slice(0, 12);
    const resumed = existsSync(runFile) && existsSync(stateFile) && existsSync(rom) && existsSync(sym);
    if (!resumed) { copyFileSync(built, `${rom}.tmp`); copyFileSync(builtSym, sym); renameSync(`${rom}.tmp`, rom); }
    let run: Run = { v: 1, rom: hashOf(rom), steps: 0, tokens: 0, played_ms: 0, notes: "", last: [], agent: agent.name, updated: "" };
    if (resumed) {
      run = { ...run, ...JSON.parse(readFileSync(runFile, "utf8")) };
      if (run.rom !== hashOf(rom)) fail(`The save "${name}" does not fit the copy of the game beside it (${rom}). Start over with --fresh (the old save is moved aside, not deleted).`);
      if (hashOf(built) !== run.rom) console.log(`agent-play: the game has been built again since this save began. Play carries on in the build the save began with; --fresh starts the new build from the beginning.`);
    }
    const first = whyStop({ run: 0, steps: run.steps, tokens: run.tokens, fails: 0 }, caps);
    if (first) { console.log(`agent-play: nothing played: ${first}. Raise the cap, or start over with --fresh.`); return 0; }

    game = await openGame(bin, rom, sym, quietEnv());
    if (resumed) await game.load(stateFile); else { await game.reset(); await game.frames(30); }
    const began = Date.now(), seconds = () => Math.round((run.played_ms + Date.now() - began) / 1000);
    let now: { where: Where | null; text: string; thought: string } = { where: null, text: "", thought: run.last.at(-1)?.thought ?? "" }, ended = "", ran = 0;
    if (port !== null) {
      const showing = (): Showing => ({ playing: !ended, agent: agent.name, thought: now.thought, text: now.text, where: now.where, steps: run.steps, steps_left: Math.max(0, caps.steps - ran), played_seconds: seconds(), last: run.last, ended });
      try { page = serveWatch(port, showing); } catch (e) { fail(`The watch page could not start on port ${port} (${(e as Error).message}). Give another: --watch <port>`); }
      game.watched(page!.feed); page!.feed(await game.picture());
      console.log(`agent-play: watch at ${page!.url}  (this computer only; the page cannot press buttons)`);
    }
    console.log(`agent-play: ${agent.name} plays ${resumed ? `on from step ${run.steps}` : "from switching the game on"}; ${caps.steps} steps this run; save ${dir}${game.hasHook ? "" : "\n  this build has no test hook: the message text may be old and is given only while the player cannot move"}`);

    // ---- the loop ----
    let stopping = false, fails = 0, bad = false;
    const onSignal = () => { if (stopping) process.exit(130); stopping = true; console.log("\nagent-play: stopping after this step (again to stop now; the save is from the last finished step)"); };
    process.on("SIGINT", onSignal); process.on("SIGTERM", onSignal);
    for (;;) {
      const why = stopping ? "stopped by hand" : whyStop({ run: ran, steps: run.steps, tokens: run.tokens, fails }, caps);
      if (why) { ended = why; bad = fails >= LIMITS.failsInARow; break; }
      const where = await game.where(), text = await game.text(where?.control ?? false), rgba = await game.picture(), n = run.steps + 1;
      const png = encodePng(rgba, W, H, scale), pic = join("pictures", `${String(n).padStart(6, "0")}.png`);
      writeFileSync(join(dir, pic), png);
      now = { ...now, where, text };
      const step: Step = { v: 1, step: n, steps_left: caps.steps - ran, picture: { path: join(dir, pic), width: W * scale, height: H * scale, ...(inline ? { png_base64: Buffer.from(png).toString("base64") } : {}) },
        text, where, last: run.last.slice(-LIMITS.recent), notes: run.notes, played: { steps: run.steps, seconds: seconds() }, how: HOW };
      const asked = Date.now(); let did = "", thought = "", result = "", error = "", tokens = 0, stop = false;
      try {
        const reply = await agent.ask(step, png); tokens = reply.tokens;
        const action = parseAction(reply.text);
        if (command && action.tokens) tokens = action.tokens;
        did = action.do; thought = action.thought; stop = action.stop; fails = 0;
        if (action.notes !== undefined) run.notes = action.notes;
        now = { ...now, thought };
        result = action.moves.length ? await game.make(action.moves) : "no move";
      } catch (e) {
        error = without((e as Error).message, key).slice(0, 400); tokens ||= (e as { tokens?: number }).tokens ?? 0;
        if (/^emulator:/.test(error)) throw e; // the game itself is gone: nothing more can be played
        fails++; result = `no move: ${error}`;
      }
      ran++; run.steps = n; run.tokens += tokens; run.agent = agent.name; run.updated = new Date().toISOString();
      run.last = [...run.last, { step: n, do: did, thought, result }].slice(-LIMITS.shown);
      appendFileSync(logFile, JSON.stringify({ step: n, at: run.updated, picture: pic, text, where, do: did, thought, result, ...(error ? { error } : {}), tokens, agent_ms: Date.now() - asked, notes: run.notes }) + "\n");
      await game.save(`${stateFile}.tmp`); renameSync(`${stateFile}.tmp`, stateFile);
      writeFileSync(`${runFile}.tmp`, JSON.stringify({ ...run, played_ms: run.played_ms + Date.now() - began }, null, 1)); renameSync(`${runFile}.tmp`, runFile);
      console.log(`#${n}  ${did || "-"}  |  ${thought || "-"}  |  ${result}`);
      if (stop) { ended = "the agent ended the run"; break; }
    }
    process.off("SIGINT", onSignal); process.off("SIGTERM", onSignal);
    const at = await game.where();
    console.log(`agent-play: stopped: ${ended}.\n  ${ran} steps this run, ${run.steps} in all, ${run.tokens} tokens in all, ${seconds()} s played${at ? `, at map ${at.map} (${at.x},${at.y})` : ""}\n  log ${logFile}\n  the next run carries on from here (same --name)`);
    return bad ? 1 : 0;
  } catch (e) {
    console.error(`agent-play: ${without((e as Error).message, key)}`);
    return 1;
  } finally {
    page?.stop(); await game?.close();
  }
}
