// kit/agent-play/agents.ts: the two ways to be the player. Both take a step and give back the agent's reply as text
// (checked afterwards by parseAction) and the tokens it cost, when known.
import { HOW, without, type Step } from "./shapes";

export type Reply = { text: string; tokens: number };
export type Agent = { name: string; ask(step: Step, png: Uint8Array): Promise<Reply> };

const PASS = /^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LANGUAGE|LC_[A-Z_]+|TZ|TERM|TMPDIR|XDG_RUNTIME_DIR)$/;
/** The environment for a program this command starts: a short list by name, never the whole of ours (it may hold keys).
 *  The kit's own list is kit/env.ts; this one is smaller on purpose and takes extra names only when the user gives them. */
export function quietEnv(names: string[] = [], from: Record<string, string | undefined> = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(from)) if (v !== undefined && (PASS.test(k) || names.includes(k))) out[k] = v;
  return out;
}

/** Way (a): a command. Started once per step with the step as one line of JSON on its standard input; what it writes
 *  to standard output is its answer. It keeps nothing between steps but the notes it hands back. */
export function commandAgent(argv: string[], o: { timeoutMs: number; env: Record<string, string>; cwd?: string }): Agent {
  return {
    name: `the command ${argv.slice(0, 2).map((w) => w.split("/").pop()).join(" ")}`,
    async ask(step) {
      let p;
      try { p = Bun.spawn(argv, { cwd: o.cwd, env: o.env, stdin: "pipe", stdout: "pipe", stderr: "pipe" }); }
      catch (e) { throw new Error(`the agent command could not be started: ${(e as Error).message}`); }
      const timer = setTimeout(() => p.kill("SIGKILL"), o.timeoutMs);
      try {
        try { p.stdin.write(JSON.stringify(step) + "\n"); await p.stdin.end(); } catch {} // a command that does not read its input still gets to answer
        const [out, err, code] = await Promise.all([upTo(p.stdout, 1_000_000), upTo(p.stderr, 4000), p.exited]);
        if (p.signalCode) throw new Error(`the agent command did not answer within ${Math.round(o.timeoutMs / 1000)} s and was stopped`);
        if (code !== 0) throw new Error(`the agent command ended with code ${code}${err.trim() ? `: ${err.trim().split("\n").pop()!.slice(0, 200)}` : ""}`);
        return { text: out, tokens: 0 };
      } finally { clearTimeout(timer); }
    },
  };
}
async function upTo(stream: ReadableStream<Uint8Array>, max: number): Promise<string> { // reads to the end, keeps the first `max` bytes
  const parts: Uint8Array[] = []; let n = 0;
  for await (const chunk of stream) { if (n < max) parts.push(chunk.subarray(0, max - n)); n += chunk.byteLength; }
  return Buffer.concat(parts).toString("utf8");
}

export const PROVIDERS: Record<string, { url: string; keyEnv: string; says: string }> = {
  anthropic: { url: "https://api.anthropic.com", keyEnv: "ANTHROPIC_API_KEY", says: "the Messages API" },
  openai: { url: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY", says: "the chat completions API, as many services and local servers also speak it" },
};
const SYSTEM = `You are playing a handheld role-playing game by pressing its buttons. Each turn you get a picture of the screen and a JSON object: the text in the message box, where the player is (map, square, facing, whether the player can move), your last few moves with what came of them, and your own notes. Explore, talk to people, read what is said and move the story forward. A message box is advanced with A; B closes menus. When a walk is blocked, try another way. Keep in your notes what you will want to know later: you remember nothing else between turns.
${HOW}`;

/** Way (b): a model behind an HTTP chat API that takes pictures. The key is held only in this closure: it goes into the
 *  request's header and nowhere else, and anything a service says back is quoted only with the key taken out. */
export function modelAgent(o: { provider: string; model: string; key: string; baseUrl?: string; replyTokens: number; timeoutMs: number; fetch?: typeof fetch }): Agent {
  const p = PROVIDERS[o.provider];
  if (!p) throw new Error(`unknown provider "${o.provider}". Providers: ${Object.keys(PROVIDERS).join(", ")}`);
  const base = (o.baseUrl ?? p.url).replace(/\/+$/, ""), u = new URL(base);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(u.hostname))) throw new Error("--base-url must be https (plain http only for this computer): the key travels in the request");
  const send = o.fetch ?? fetch;
  return {
    name: `${o.model} (${o.provider})`,
    async ask(step, png) {
      const { picture, how, ...rest } = step, data = Buffer.from(png).toString("base64"), words = JSON.stringify({ ...rest, picture: { width: picture.width, height: picture.height } });
      const [url, headers, body] = o.provider === "anthropic"
        ? [`${base}/v1/messages`, { "x-api-key": o.key, "anthropic-version": "2023-06-01" },
            { model: o.model, max_tokens: o.replyTokens, system: SYSTEM, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data } }, { type: "text", text: words }] }] }]
        : [`${base}/chat/completions`, { authorization: `Bearer ${o.key}` },
            { model: o.model, [o.baseUrl ? "max_tokens" : "max_completion_tokens"]: o.replyTokens, // the service itself wants the newer name; servers that only speak its shape know the older one
              messages: [{ role: "system", content: SYSTEM }, { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${data}` } }, { type: "text", text: words }] }] }];
      let r: Response, j: any;
      try { r = await send(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(o.timeoutMs), redirect: "error" }); }
      catch (e) { throw new Error(without(`the model could not be reached: ${(e as Error).message}`, o.key)); }
      try { j = await r.json(); } catch { j = null; }
      if (!r.ok) throw new Error(without(`the model answered ${r.status}${j?.error?.message ? `: ${String(j.error.message).slice(0, 300)}` : ""}`, o.key));
      const use = j?.usage ?? {};
      if (o.provider === "anthropic") {
        const tokens = (use.input_tokens ?? 0) + (use.output_tokens ?? 0) + (use.cache_creation_input_tokens ?? 0) + (use.cache_read_input_tokens ?? 0);
        if (j?.stop_reason === "refusal") throw Object.assign(new Error("the model declined this step"), { tokens });
        return { text: (j?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n"), tokens };
      }
      const said = j?.choices?.[0]?.message?.content;
      return { text: typeof said === "string" ? said : Array.isArray(said) ? said.map((b: any) => b?.text ?? "").join("\n") : "", tokens: use.total_tokens ?? (use.prompt_tokens ?? 0) + (use.completion_tokens ?? 0) };
    },
  };
}
