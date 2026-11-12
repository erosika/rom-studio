// bun test kit/agent-play: the shapes of a step and an answer, the caps, the key's handling, and the watch page's rules.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandAgent, modelAgent, quietEnv } from "./agents";
import { H, W } from "./game";
import { agentPlayCommand } from "./play";
import { HOW, KEY, LIMITS, findJson, parseAction, parseMoves, whyStop, without, words, type Step } from "./shapes";
import { guarded, serveWatch, type Showing } from "./watch";

const step: Step = { v: 1, step: 3, steps_left: 7, picture: { path: "/nowhere/000003.png", width: 240, height: 160 }, text: "Hello.", where: { map: "0.9", x: 5, y: 5, facing: "up", control: true },
  last: [{ step: 2, do: "walk UP:2", thought: "north", result: "walked UP:2" }], notes: "", played: { steps: 2, seconds: 9 }, how: HOW };
const tmp = mkdtempSync(join(tmpdir(), "agent-play-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test("moves: press, walk and wait of the driver's language", () => {
  expect(parseMoves("press A,B:30,A+B walk UP:3,left wait 60")).toEqual([
    { op: "press", mask: 1, hold: 4, text: "A" }, { op: "press", mask: 2, hold: 30, text: "B:30" }, { op: "press", mask: 3, hold: 4, text: "A+B" },
    { op: "walk", mask: KEY.UP!, name: "UP", squares: 3 }, { op: "walk", mask: KEY.LEFT!, name: "LEFT", squares: 1 }, { op: "wait", frames: 60 }]);
  expect(parseMoves("A,A,UP:30").map((m) => m.op)).toEqual(["press", "press", "press"]); // a bare button list is a press
});
test("moves: nothing else of the driver's language, and nothing past the limits", () => {
  for (const bad of ["warp 0 9 5 5", "press A flag set 3", "press A save x.ss", "press X", "walk A:2", "walk UP:0", "press A:999", "wait 100000", "walk UP:99", "press", "", "press A\nquit", "press A:1:2", "wait"])
    expect(() => parseMoves(bad)).toThrow();
  expect(() => parseMoves(`press ${Array(LIMITS.moves + 1).fill("A").join(",")}`)).toThrow(/at most/);
  expect(() => parseMoves("walk UP:20,DOWN:20")).toThrow(/at most/);
  expect(() => parseMoves("press " + "A,".repeat(120) + "A")).toThrow();
});
test("an answer: a JSON object, alone or wrapped in words", () => {
  const a = parseAction('Here you go:\n```json\n{"do": "press  A", "thought": "Read the\\nsign.", "notes": "sign at 5,5"}\n```');
  expect(a).toMatchObject({ do: "press A", thought: "Read the sign.", notes: "sign at 5,5", stop: false });
  expect(a.moves).toHaveLength(1);
  expect(parseAction({ stop: true })).toMatchObject({ stop: true, moves: [], do: "" });
  expect(parseAction('{"do":"wait 10","thought":"' + "x".repeat(500) + '","notes":"' + "n".repeat(5000) + '","tokens":12.4}')).toMatchObject({ tokens: 12 });
  expect(parseAction('{"do":"wait 10","thought":"' + "x".repeat(500) + '"}').thought).toHaveLength(LIMITS.thoughtChars);
  expect(parseAction('{"do":"wait 10","notes":"' + "n".repeat(5000) + '"}').notes).toHaveLength(LIMITS.notesChars);
  expect(findJson('{"a": {"b": 1}} trailing')).toEqual({ a: { b: 1 } });
});
test("an answer that is not one is refused with the reason", () => {
  for (const bad of ["", "press A", "[1]", '{"thought": "no moves"}', '{"do": 5}', '{"do": "warp 0 0 1 1"}', '{"do": ""}']) expect(() => parseAction(bad)).toThrow();
  expect(() => parseAction('{"do": "press A script Boss"}')).toThrow(/not a move an agent may make/);
});
test("the caps: steps of the run, steps and tokens of the save, failures in a row", () => {
  const caps = { steps: 10, capSteps: 100, capTokens: 1000 };
  expect(whyStop({ run: 0, steps: 0, tokens: 0, fails: 0 }, caps)).toBeNull();
  expect(whyStop({ run: 9, steps: 99, tokens: 999, fails: LIMITS.failsInARow - 1 }, caps)).toBeNull();
  expect(whyStop({ run: 10, steps: 10, tokens: 0, fails: 0 }, caps)).toMatch(/step budget/);
  expect(whyStop({ run: 0, steps: 100, tokens: 0, fails: 0 }, caps)).toMatch(/cap on steps/);
  expect(whyStop({ run: 0, steps: 5, tokens: 1000, fails: 0 }, caps)).toMatch(/cap on tokens/);
  expect(whyStop({ run: 1, steps: 5, tokens: 0, fails: LIMITS.failsInARow }, caps)).toMatch(/no usable answer/);
});
test("a command line is split into words without a shell", () => {
  expect(words(`bun 'my agent.ts' --mode "a b" ''`)).toEqual(["bun", "my agent.ts", "--mode", "a b", ""]);
  expect(words("a;b $(c) | d")).toEqual(["a;b", "$(c)", "|", "d"]);
  expect(() => words('bun "open')).toThrow();
});

test("a command agent: the step on standard input, the answer from standard output, and none of our environment", async () => {
  const env = quietEnv(["LET_THROUGH"], { PATH: process.env.PATH, HOME: "/h", SOME_API_KEY: "secret-1", LET_THROUGH: "yes", ROM_STUDIO_KEY: "secret-2" });
  expect(env).toEqual({ PATH: process.env.PATH!, HOME: "/h", LET_THROUGH: "yes" });
  const echo = `const s = JSON.parse(await new Response(Bun.stdin.stream()).text()); console.log(JSON.stringify({ do: "press A", thought: s.text + " " + s.step + " " + Object.keys(process.env).filter((k) => /KEY/.test(k)).length }))`;
  const a = commandAgent([process.execPath, "-e", echo], { timeoutMs: 20_000, env });
  expect(parseAction((await a.ask(step, new Uint8Array())).text)).toMatchObject({ do: "press A", thought: "Hello. 3 0" });
  await expect(commandAgent([process.execPath, "-e", "process.exit(3)"], { timeoutMs: 20_000, env }).ask(step, new Uint8Array())).rejects.toThrow(/code 3/);
  await expect(commandAgent([process.execPath, "-e", "await Bun.sleep(60000)"], { timeoutMs: 300, env }).ask(step, new Uint8Array())).rejects.toThrow(/did not answer/);
  await expect(commandAgent(["/no/such/program"], { timeoutMs: 300, env }).ask(step, new Uint8Array())).rejects.toThrow();
});

test("a model agent: the picture and the step go out, the key only in the header, tokens are counted", async () => {
  const KEYS = "sk-test-0123456789", seen: { url: string; headers: Record<string, string>; body: any }[] = [];
  const fake = (answer: any, status = 200) => (async (url: any, init: any) => { seen.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) }); return new Response(JSON.stringify(answer), { status }); }) as unknown as typeof fetch;
  const png = Uint8Array.from([137, 80, 78, 71]);
  const one = modelAgent({ provider: "anthropic", model: "some-model", key: KEYS, replyTokens: 900, timeoutMs: 5000,
    fetch: fake({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: '{"do":"press A","thought":"ok"}' }], usage: { input_tokens: 700, output_tokens: 40, cache_read_input_tokens: 10 } }) });
  expect(await one.ask(step, png)).toEqual({ text: '{"do":"press A","thought":"ok"}', tokens: 750 });
  expect(seen[0]!.url).toBe("https://api.anthropic.com/v1/messages");
  expect(seen[0]!.headers["x-api-key"]).toBe(KEYS);
  expect(seen[0]!.body).toMatchObject({ model: "some-model", max_tokens: 900 });
  expect(seen[0]!.body.messages[0].content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from(png).toString("base64") } });
  expect(JSON.stringify(seen[0]!.body)).not.toContain(KEYS);
  expect(JSON.parse(seen[0]!.body.messages[0].content[1].text)).toMatchObject({ step: 3, text: "Hello.", picture: { width: 240, height: 160 } }); // no file path: the model cannot open one
  expect(one.name).not.toContain(KEYS);

  const two = modelAgent({ provider: "openai", model: "m", key: KEYS, baseUrl: "http://127.0.0.1:9/v1/", replyTokens: 900, timeoutMs: 5000, fetch: fake({ choices: [{ message: { content: '{"do":"wait 5"}' } }], usage: { total_tokens: 321 } }) });
  expect(await two.ask(step, png)).toEqual({ text: '{"do":"wait 5"}', tokens: 321 });
  expect(seen[1]!.url).toBe("http://127.0.0.1:9/v1/chat/completions");
  expect(seen[1]!.headers.authorization).toBe(`Bearer ${KEYS}`);
  expect(seen[1]!.body.messages[1].content[0].image_url.url).toStartWith("data:image/png;base64,");

  const echoing = modelAgent({ provider: "anthropic", model: "m", key: KEYS, replyTokens: 9, timeoutMs: 5000, fetch: fake({ error: { message: `bad key ${KEYS} given` } }, 401) });
  const err = await echoing.ask(step, png).catch((e) => e as Error);
  expect(err.message).toContain("401"); expect(err.message).not.toContain(KEYS); expect(err.message).toContain("[key]");
  await expect(modelAgent({ provider: "anthropic", model: "m", key: KEYS, replyTokens: 9, timeoutMs: 5000, fetch: fake({ stop_reason: "refusal", content: [], usage: { input_tokens: 5, output_tokens: 1 } }) }).ask(step, png)).rejects.toThrow(/declined/);
  expect(() => modelAgent({ provider: "anthropic", model: "m", key: KEYS, baseUrl: "http://far.example/v1", replyTokens: 9, timeoutMs: 1 })).toThrow(/https/);
  expect(() => modelAgent({ provider: "nobody", model: "m", key: KEYS, replyTokens: 9, timeoutMs: 1 })).toThrow(/unknown provider/);
  expect(without(`a ${KEYS} b ${KEYS}`, KEYS)).toBe("a [key] b [key]");
});

test("the command says what is missing, and a missing key is named by its variable only", async () => {
  const lines: string[] = [], keepErr = console.error, keepLog = console.log;
  console.error = console.log = (...a: unknown[]) => { lines.push(a.join(" ")); };
  try {
    expect(await agentPlayCommand(tmp, [])).toBe(1);
    expect(await agentPlayCommand(tmp, ["--agent", "x", "--provider", "anthropic"])).toBe(1);
    expect(await agentPlayCommand(tmp, ["--provider", "anthropic", "--model", "m", "--key-env", "AGENT_PLAY_TEST_NO_SUCH_KEY"])).toBe(1);
    expect(await agentPlayCommand(tmp, ["--provider", "anthropic", "--model", "m", "--key-env", "sk-not-a-name"])).toBe(1);
    expect(await agentPlayCommand(tmp, ["--agent", "x", "--steps", "0"])).toBe(1);
    expect(await agentPlayCommand(tmp, ["--agent", "x", "--name", "../up"])).toBe(1);
    expect(await agentPlayCommand(tmp, ["help"])).toBe(0);
  } finally { console.error = keepErr; console.log = keepLog; }
  expect(lines[0]).toMatch(/Say who plays/); expect(lines[2]).toMatch(/AGENT_PLAY_TEST_NO_SUCH_KEY is not set/); expect(lines[3]).toMatch(/NAME of an environment variable/);
  expect(lines.at(-1)).toContain('"steps_left"');
  expect(readdirSync(tmp)).toEqual([]); // nothing was written before the checks passed
});

test("the watch page: every picture goes through the flash guard", () => {
  let ms = 0; const s = guarded(() => ms);
  const flat = (v: number) => { const p = new Uint8Array(W * H * 4).fill(v); for (let i = 3; i < p.length; i += 4) p[i] = 255; return p; };
  const mean = () => { const { rgba } = s.shown(); let t = 0; for (let i = 0; i < rgba.length; i += 4) t += rgba[i]!; return t / (W * H); };
  s.tick(); expect(s.shown().seq).toBe(0); // nothing fed: nothing to show
  s.feed(flat(40)); for (let i = 0; i < 50; i++) { ms += 40; s.tick(); }
  const calm = mean(), seqCalm = s.shown().seq; expect(Math.abs(calm - 40)).toBeLessThan(2);
  ms += 40; s.tick(); expect(s.shown().seq).toBe(seqCalm); // an unchanged picture is not a new one
  let low = 255, high = 0; // the game strobes black and white on every beat: what is shown must stay nearly still
  for (let i = 0; i < 100; i++) { s.feed(flat(i % 2 ? 255 : 0)); ms += 40; s.tick(); if (i > 5) { low = Math.min(low, mean()); high = Math.max(high, mean()); } }
  expect(high - low).toBeLessThan(40);
  expect(s.shown().png().subarray(1, 4).toString()).toBe("PNG");
});
test("the watch page: this computer only, read only, no page of another site", async () => {
  const showing: Showing = { playing: true, agent: "a", thought: "<b>t</b>", text: "", where: null, steps: 1, steps_left: 2, played_seconds: 3, last: [], ended: "" };
  const page = serveWatch(0, () => showing), get = (path: string, init: RequestInit = {}) => fetch(new URL(path, page.url), init);
  try {
    expect(page.url).toStartWith("http://127.0.0.1:");
    const home = await get("/"); expect(home.status).toBe(200); expect(home.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await home.text(); expect(html).not.toMatch(/<form|<button|<input|onclick/i);
    expect(readFileSync(join(import.meta.dir, "watch.js"), "utf8")).not.toMatch(/method|POST|innerHTML|WebSocket/); // the page only asks; what the agent wrote is set as text
    expect(await (await get("/state")).json()).toEqual(showing);
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) expect((await get("/state", { method })).status).toBe(405);
    expect((await get("/press")).status).toBe(404);
    expect((await get("/state", { headers: { Origin: "http://other.example" } })).status).toBe(403);
    expect((await get("/frame?after=0", { headers: { "Sec-Fetch-Site": "cross-site" } })).status).toBe(403);
    const frame = get("/frame?after=0"); // waits for the first picture
    const p = new Uint8Array(W * H * 4).fill(200); page.feed(p);
    const got = await frame; expect(got.status).toBe(200); expect(got.headers.get("content-type")).toBe("image/png"); expect(Number(got.headers.get("x-frame"))).toBeGreaterThan(0);
    expect(new Uint8Array(await got.arrayBuffer())[1]).toBe(80);
  } finally { page.stop(); }
  expect(existsSync(join(import.meta.dir, "../../player/guard.js"))).toBe(true);
});
