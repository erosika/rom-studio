// kit/codes.ts: the game's cheat codes as data. codes.json in the game folder becomes include/studio_codes_table.h,
// which the base's engine (src/zz_studio_codes.c) compiles in. `kit build` writes it before every build (only when it
// changed); `kit codes` lists the codes and checks them. A game without codes.json is left alone.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const FORMAT = 2; // include/studio_codes.h STUDIO_CODES_FORMAT: bump both together
export const CODE_MAX = 10; // letters on the code screen (STUDIO_CODE_LENGTH)
export const LINE_MAX = 33; // "CODE: line" on an ALL CODES page; the game adds " ON" to a switch that is on
export const WIDTH = 34; // letters on one line of the message box

export const CODES_HELP = `kit codes [--check] [--json]   the game's cheat codes from codes.json in the game folder: each code, how often it
                             works, play or test, what it does; problems and warnings. kit build writes them into the game every time`;

export type Code = {
  code: string; does: string; line?: string; scope?: "play" | "test"; use: "once" | "repeat" | "toggle";
  effect: Record<string, unknown>; reply: string; other?: string; question?: string; flag?: string;
};
export type Codes = { build?: "play" | "test"; in_pc?: boolean; flags?: Record<string, string>; codes: Code[] };
type Row = { code: Code; effect: string; flag: string | null; arg: (string | number)[]; list: string[] | null; script: string | null; amount: number };

/** codes.json effect -> the engine's STUDIO_EFFECT_* (include/studio_codes.h). */
export const EFFECTS: Record<string, string> = {
  say: "SAY", heal: "HEAL", giveItem: "GIVE_ITEM", giveItems: "GIVE_ITEMS", giveMon: "GIVE_MON", giveMons: "GIVE_MON_SET",
  addMoney: "ADD_MONEY", setMoney: "SET_MONEY", flag: "SET_FLAG", warp: "WARP", nextDay: "NEXT_DAY", walkThroughWalls: "WALK_THROUGH",
  allOff: "ALL_OFF", allCodes: "SCRIPT", script: "SCRIPT", maxIvs: "MAX_IVS", followers: "FOLLOWERS",
};
/** Save flags with a meaning of their own (codes.json "flags"), and the define the engine reads each by. */
export const ROLES: Record<string, string | null> = {
  used: "STUDIO_CODES_FLAG_USED", walk: "STUDIO_CODES_WALK_FLAG", select: "STUDIO_SELECT_VAR", follow: "STUDIO_CODES_FOLLOW_FLAG",
  more_wild: "STUDIO_CODES_MOREWILD_FLAG", double_exp: "STUDIO_CODES_EXP_FLAG", no_wild: "STUDIO_CODES_NOWILD_FLAG",
};
const PARAMS: Record<string, string[]> = { giveItem: ["count"], giveMon: ["level"], giveMons: ["level"], warp: ["x", "y"] };
const USE: Record<string, string> = { once: "ONCE", repeat: "REPEAT", toggle: "TOGGLE" };
const REPEAT_ONLY = new Set(["allOff", "allCodes", "giveItems", "giveMons", "maxIvs", "warp", "nextDay"]);
const TEST_ONLY = new Set(["walkThroughWalls", "nextDay"]); // the engine compiles these only into test builds
const ALL_CODES_SCRIPT = "StudioCodes_EventScript_AllCodes";

/** The code's row on the ALL CODES page: its line, else the start of "does" cut to fit. */
export function lineOf(c: Code): string {
  if (c.line !== undefined) return c.line; // given: checked as it is
  let l = c.does.split(/;| \(/)[0]!.trim();
  while (c.code.length + 2 + l.length > LINE_MAX && l.includes(" ")) l = l.slice(0, l.lastIndexOf(" "));
  return l;
}

/** Wrapped for the message box: line 1, \n, line 2, then \l (scroll on) for every later line; quotes made safe. */
export function box(s: string): string {
  const lines: string[] = [];
  // a placeholder is as wide as what the game puts there: the code (10 at most), a count, the player's name
  const shown = (l: string) => l.replace(/\{STR_VAR_1\}/g, "x".repeat(CODE_MAX)).replace(/\{STR_VAR_[23]\}/g, "xxxxx").replace(/\{PLAYER\}/g, "x".repeat(7)).length;
  for (const w of s.trim().split(/\s+/)) {
    if (lines.length && shown(lines.at(-1)! + " " + w) <= WIDTH) lines[lines.length - 1] += " " + w;
    else lines.push(w);
  }
  return lines.map((l, i) => (i === 0 ? "" : i === 1 ? "\\n" : "\\l") + l).join("").replace(/'/g, "’").replace(/"/g, '\\"');
}

const SAFE = /^[A-Za-z0-9 .,!?'’:;()\-/&+%“”é{}_]*$/;
const PLACEHOLDER = /\{([^}]*)\}/g;
function textProblems(where: string, s: unknown, need = true): string[] {
  if (s === undefined && !need) return [];
  if (typeof s !== "string" || !s.trim()) return [`${where}: missing (one plain sentence)`];
  const out: string[] = [];
  if (!SAFE.test(s)) out.push(`${where}: letters the game's text may not have (keep to letters, digits and plain punctuation): ${JSON.stringify(s)}`);
  for (const m of s.matchAll(PLACEHOLDER)) if (!/^(STR_VAR_[123]|PLAYER)$/.test(m[1]!)) out.push(`${where}: {${m[1]}} is not something the game fills in (STR_VAR_1 the code, STR_VAR_2/3 what the effect says, PLAYER)`);
  return out;
}

/** Everything wrong with the data, and with the data against the game's tree when one is given. Empty = fine. */
export function checkCodes(d: Codes, game?: string): { problems: string[]; warnings: string[]; rows: Row[] } {
  const problems: string[] = [], warnings: string[] = [], rows: Row[] = [];
  if (!d || !Array.isArray(d.codes)) return { problems: ["codes.json: needs a \"codes\" list"], warnings, rows };
  const flags = d.flags ?? {};
  if (d.build !== undefined && d.build !== "play" && d.build !== "test") problems.push(`build: "play" or "test", not ${JSON.stringify(d.build)}`);
  const roleOf = new Map<string, string>();
  for (const [role, name] of Object.entries(flags)) {
    if (!(role in ROLES)) problems.push(`flags.${role}: not a known switch (${Object.keys(ROLES).join(", ")})`);
    if (!new RegExp(role === "select" ? "^VAR_\\w+$" : "^FLAG_\\w+$").test(name)) problems.push(`flags.${role}: ${role === "select" ? "a VAR_ name" : "a FLAG_ name"}, not ${JSON.stringify(name)}`);
    if (roleOf.has(name)) problems.push(`flags.${role}: ${name} is also flags.${roleOf.get(name)}`);
    roleOf.set(name, role);
  }
  const flagName = (where: string, x: unknown): string | null => {
    if (typeof x !== "string") { problems.push(`${where}: names a flag (one of ${Object.keys(flags).filter((r) => r !== "select").join(", ") || "the \"flags\" names"}, or a FLAG_ name)`); return null; }
    if (/^FLAG_\w+$/.test(x)) return x;
    if (x !== "select" && flags[x]) return flags[x]!;
    problems.push(`${where}: "${x}" is neither a FLAG_ name nor one of "flags"`); return null;
  };
  const seen = new Set<string>(), stateFlags = new Map<string, string>();
  for (const [n, c] of d.codes.entries()) {
    const at = typeof c?.code === "string" ? c.code : `code ${n + 1}`;
    if (typeof c?.code !== "string" || !/^[A-Z0-9]+( [A-Z0-9]+)*$/.test(c.code)) { problems.push(`${at}: capitals and digits, single spaces between words`); continue; }
    if (c.code.length > CODE_MAX) problems.push(`${at}: ${c.code.length} letters; the code screen holds ${CODE_MAX}`);
    if (seen.has(c.code)) problems.push(`${at}: listed twice`);
    seen.add(c.code);
    if (!(c.use in USE)) problems.push(`${at}: use is once, repeat or toggle`);
    const scope = c.scope ?? "play";
    if (scope !== "play" && scope !== "test") problems.push(`${at}: scope is play or test`);
    problems.push(...textProblems(`${at}: does`, c.does), ...textProblems(`${at}: reply`, c.reply), ...textProblems(`${at}: other`, c.other, false), ...textProblems(`${at}: question`, c.question, false), ...textProblems(`${at}: line`, c.line, false));
    if (typeof c.does === "string" && c.code.length + 2 + lineOf(c).length > LINE_MAX) problems.push(`${at}: its ALL CODES line "${lineOf(c)}" is too long (code and line together ${LINE_MAX} letters at most)`);
    const keys = Object.keys(c.effect ?? {}), kinds = keys.filter((k) => k in EFFECTS);
    if (kinds.length !== 1) { problems.push(`${at}: effect is one of ${Object.keys(EFFECTS).join(", ")}, e.g. {"heal": true}`); continue; }
    const kind = kinds[0]!, e = c.effect as Record<string, any>, v = e[kind];
    for (const k of keys) if (k !== kind && !(PARAMS[kind] ?? []).includes(k)) problems.push(`${at}: "${k}" means nothing to ${kind}${PARAMS[kind] ? ` (it takes ${PARAMS[kind]!.join(", ")})` : ""}`);
    const row: Row = { code: c, effect: EFFECTS[kind]!, flag: null, arg: [], list: null, script: null, amount: 0 };
    if (REPEAT_ONLY.has(kind) && c.use !== "repeat") problems.push(`${at}: ${kind} codes work every time (use "repeat")`);
    if (TEST_ONLY.has(kind) && scope !== "test") problems.push(`${at}: ${kind} only exists in test builds: give it "scope": "test" (codes.json "build": "test" makes a test build)`);
    const int = (x: unknown, lo: number, hi: number, what: string) => { if (!Number.isInteger(x) || (x as number) < lo || (x as number) > hi) { problems.push(`${at}: ${what} is a whole number from ${lo} to ${hi}`); return 0; } return x as number; };
    const named = (x: unknown, pre: string, what: string) => { if (typeof x !== "string" || !new RegExp(`^${pre}\\w+$`).test(x)) { problems.push(`${at}: ${what} is a ${pre} name, not ${JSON.stringify(x)}`); return "0"; } return x; };
    switch (kind) {
      case "giveItem": row.arg = [named(v, "ITEM_", "giveItem"), int(e.count ?? 1, 1, 999, "count")]; break;
      case "giveItems":
        if (v === "ALL_TMS") break;
        if (!Array.isArray(v) || !v.length || v.length > 30) problems.push(`${at}: giveItems is "ALL_TMS" or a list of 1 to 30 ITEM_ names`);
        else row.list = v.map((x) => named(x, "ITEM_", "each item"));
        break;
      case "giveMon": row.arg = [named(v, "SPECIES_", "giveMon"), int(e.level, 1, 100, "level")]; break;
      case "giveMons":
        if (!Array.isArray(v) || !v.length || v.length > 6) problems.push(`${at}: giveMons is a list of 1 to 6 SPECIES_ names`);
        else row.list = v.map((x) => named(x, "SPECIES_", "each species"));
        row.arg = [0, int(e.level, 1, 100, "level")]; break;
      case "addMoney": case "setMoney": row.amount = int(v, 0, 999999, kind); break;
      case "warp": row.arg = [named(v, "MAP_", "warp"), int(e.x, 0, 32767, "x"), int(e.y, 0, 32767, "y")]; break;
      case "flag": row.flag = flagName(`${at}: flag`, v); row.arg = [row.flag ?? 0];
        if (c.use !== "toggle") problems.push(`${at}: a flag code is a switch (use "toggle"): its flag is what it switches`); break;
      case "walkThroughWalls": row.flag = flags.walk ?? null;
        if (!flags.walk) problems.push(`${at}: walking through walls keeps its state in flags.walk: name one`);
        if (c.use !== "toggle") problems.push(`${at}: walkThroughWalls is a switch (use "toggle")`); break;
      case "followers": row.flag = flags.follow ?? null; row.arg = [row.flag ?? 0];
        if (!flags.follow) problems.push(`${at}: the follower switch keeps its state in flags.follow: name one`);
        if (c.use !== "toggle") problems.push(`${at}: followers is a switch (use "toggle")`); break;
      case "allCodes": row.script = ALL_CODES_SCRIPT; break;
      case "script": case "allOff":
        if (kind === "script" || typeof v === "string") { if (typeof v !== "string" || !/^[A-Za-z_]\w*$/.test(v)) problems.push(`${at}: ${kind} names a script label${kind === "allOff" ? " (or is true)" : ""}`); else row.script = v; }
        break;
    }
    if (c.flag !== undefined) { const f = flagName(`${at}: flag`, c.flag); if (row.flag && f !== row.flag) problems.push(`${at}: give the flag in one place only`); row.flag = f; }
    if (c.use === "once" || c.use === "toggle") {
      if (!row.flag) problems.push(`${at}: ${c.use} codes need a save flag of their own ("flag")`);
      else if (stateFlags.has(row.flag)) problems.push(`${at}: its flag ${row.flag} is also ${stateFlags.get(row.flag)}'s`);
      else stateFlags.set(row.flag, c.code);
    }
    rows.push(row);
  }
  if (game) problems.push(...treeProblems(d, rows, game, warnings));
  return { problems, warnings, rows };
}

/** The data against the game's own files: names that exist, config switches that agree, the engine's format. */
function treeProblems(d: Codes, rows: Row[], game: string, warnings: string[]): string[] {
  const out: string[] = [], read = (f: string) => { try { return readFileSync(join(game, f), "utf8"); } catch { return null; } };
  const h = read("include/studio_codes.h");
  if (h === null) return ["this game has no codes engine (include/studio_codes.h): codes need the kit's base"];
  const fmt = /#define STUDIO_CODES_FORMAT (\d+)/.exec(h)?.[1];
  if (Number(fmt) !== FORMAT) out.push(`the game's codes engine is format ${fmt}, this kit writes format ${FORMAT}: the engine files come from a different kit (copy the base's src/zz_studio_codes.c, include/studio_codes.h and data/scripts/studio_codes.inc)`);
  for (const r of rows) if (!new RegExp(`#define STUDIO_EFFECT_${r.effect}\\b`).test(h)) out.push(`${r.code.code}: the game's engine has no ${r.effect} effect`);
  const flagsH = read("include/constants/flags.h") ?? "", varsH = read("include/constants/vars.h") ?? "";
  const names = new Set([...Object.values(d.flags ?? {}), ...rows.map((r) => r.flag).filter((f): f is string => !!f)]);
  for (const n of names) if (!new RegExp(`#define ${n}\\b`).test(n.startsWith("VAR_") ? varsH : flagsH)) out.push(`${n} is not in include/constants/${n.startsWith("VAR_") ? "vars" : "flags"}.h`);
  const config = (file: string, def: string) => new RegExp(`#define ${def}\\s+(\\S+)`).exec(read(file) ?? "")?.[1];
  const nowild = d.flags?.no_wild;
  if (nowild && rows.some((r) => r.flag === nowild)) {
    const we = config("include/config/wild_encounter.h", "WE_FLAG_NO_ENCOUNTER");
    if (we !== nowild) out.push(`flags.no_wild is ${nowild} but include/config/wild_encounter.h WE_FLAG_NO_ENCOUNTER is ${we ?? "missing"}: name the same flag in both, or the code switches nothing`);
  }
  if (rows.some((r) => r.effect === "FOLLOWERS") && config("include/config/overworld.h", "OW_FOLLOWERS_ENABLED") !== "TRUE") out.push(`the follower code needs OW_FOLLOWERS_ENABLED TRUE in include/config/overworld.h (the kit's base patch 0024 sets it)`);
  for (const r of rows) if (r.script && r.script !== ALL_CODES_SCRIPT && !Bun.spawnSync(["git", "-C", game, "grep", "-q", "-w", "-e", `${r.script}::`, "--", "data"]).success) out.push(`${r.code.code}: no script ${r.script}:: in data/ (a script a code runs is global: two colons)`);
  // a save flag the codes own that something else in the game also sets or reads would mean two things at once
  for (const n of names) {
    const g = Bun.spawnSync(["git", "-C", game, "grep", "-l", "-w", "-e", n, "--", "src", "data", "include", ":!include/constants/flags.h", ":!include/constants/vars.h", ":!include/config", ":!include/studio_codes_table.h"]);
    const files = g.stdout.toString().trim().split("\n").filter(Boolean);
    if (files.length) warnings.push(`${n} (a codes flag) is also named in ${files.slice(0, 3).join(", ")}${files.length > 3 ? " and more" : ""}: check nothing else uses it`);
  }
  return out;
}

/** The C table src/zz_studio_codes.c compiles in. */
export function tableFor(d: Codes, rows: Row[], testBuild: boolean): string {
  const flags = d.flags ?? {}, o = [
    "// Written by `kit build` (kit/codes.ts) from codes.json in the game folder. Change codes.json, not this file.",
    `#define STUDIO_CODES_TABLE_FORMAT ${FORMAT}`,
    `#define STUDIO_CODES_TEST_BUILD ${testBuild ? 1 : 0}`,
    `#define STUDIO_CODES_IN_PC ${d.in_pc === false || !rows.length ? 0 : 1}`,
  ];
  for (const [role, def] of Object.entries(ROLES)) if (def && flags[role]) o.push(`#define ${def} ${flags[role]}`);
  if (!flags.used) o.push("#define STUDIO_CODES_FLAG_USED 0");
  o.push("");
  const t: string[] = [];
  for (const s of new Set(rows.map((r) => r.script).filter(Boolean))) o.push(`extern const u8 ${s}[];`);
  rows.forEach((r, i) => {
    const c = r.code, p = `sCode${i}`;
    o.push(`static const u8 ${p}_Text[] = _("${c.code}");`, `static const u8 ${p}_Line[] = _("${lineOf(c).replace(/'/g, "’").replace(/"/g, '\\"')}");`, `static const u8 ${p}_Reply[] = _("${box(c.reply)}");`);
    if (c.other) o.push(`static const u8 ${p}_Other[] = _("${box(c.other)}");`);
    if (c.question) o.push(`static const u8 ${p}_Question[] = _("${box(c.question)}");`);
    if (r.list) o.push(`static const u16 ${p}_List[] = {${r.list.join(", ")}, 0};`);
    const a = [...r.arg, 0, 0, 0].slice(0, 3);
    t.push(`    {.text = ${p}_Text, .line = ${p}_Line, .list = ${r.list ? `${p}_List` : "NULL"}, .reply = ${p}_Reply, .other = ${c.other ? `${p}_Other` : "NULL"}, `
      + `.question = ${c.question ? `${p}_Question` : "NULL"}, .script = ${r.script ?? "NULL"}, .amount = ${r.amount}, .flag = ${r.flag ?? 0}, `
      + `.arg1 = ${a[0]}, .arg2 = ${a[1]}, .arg3 = ${a[2]}, .effect = STUDIO_EFFECT_${r.effect}, .use = STUDIO_CODE_${USE[c.use]}, .scope = STUDIO_CODE_${(c.scope ?? "play").toUpperCase()}},`);
  });
  o.push("", "static const struct StudioCode sStudioCodes[] =", "{", ...t, "    {NULL},", "};", "");
  return o.join("\n");
}

export function readCodes(game: string): Codes | null {
  const f = join(game, "codes.json");
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, "utf8")); } catch (e) { throw new Error(`codes.json is not valid JSON: ${(e as Error).message}`); }
}
/** Which kind of build: STUDIO_CODES_BUILD (play|test) wins over codes.json "build"; play when neither says. */
export const isTestBuild = (d: Codes, env = process.env.STUDIO_CODES_BUILD) => (env === "test" || env === "play" ? env : d.build ?? "play") === "test";

/** For `kit build`: codes.json -> include/studio_codes_table.h, written only when it changed. */
export function writeCodesTable(game: string, env = process.env.STUDIO_CODES_BUILD): { ok: boolean; written: boolean; count: number; message: string } {
  const d = readCodes(game);
  if (!d) return { ok: true, written: false, count: 0, message: "" };
  const { problems, rows } = checkCodes(d, game);
  if (problems.length) return { ok: false, written: false, count: rows.length, message: `codes.json has ${problems.length} problem${problems.length > 1 ? "s" : ""}; nothing was built:\n  ${problems.join("\n  ")}` };
  const h = tableFor(d, rows, isTestBuild(d, env)), out = join(game, "include/studio_codes_table.h");
  const same = existsSync(out) && readFileSync(out, "utf8") === h;
  if (!same) writeFileSync(out, h);
  return { ok: true, written: !same, count: rows.length, message: `${rows.length} codes (${isTestBuild(d, env) ? "test" : "play"} build)` };
}

/** `kit codes`: the list, then problems and warnings. Exit code 1 when there are problems. */
export function codesCommand(game: string, args: string[]): number {
  let d: Codes | null;
  try { d = readCodes(game); } catch (e) { console.error((e as Error).message); return 1; }
  if (!d) { console.log("This game has no codes.json, so it has no cheat codes. The kit's base brings one (kit setup); its engine reads the table kit build writes from it."); return 0; }
  const { problems, warnings, rows } = checkCodes(d, game), test = isTestBuild(d);
  if (args.includes("--json")) { console.log(JSON.stringify({ build: test ? "test" : "play", codes: rows.map((r) => ({ code: r.code.code, use: r.code.use, scope: r.code.scope ?? "play", does: r.code.does, line: lineOf(r.code), flag: r.flag })), problems, warnings }, null, 2)); return problems.length ? 1 : 0; }
  if (!args.includes("--check")) {
    console.log(`${rows.length} codes, a ${test ? "test" : "play"} build${test ? "" : " (codes marked test answer \"only in test builds\")"}:`);
    for (const r of rows) console.log(`  ${r.code.code.padEnd(CODE_MAX + 1)}${(r.code.use === "toggle" ? "on/off" : r.code.use === "once" ? "once" : "every time").padEnd(11)}${(r.code.scope ?? "play").padEnd(5)} ${r.code.does}`);
  }
  for (const w of warnings) console.log(`warning: ${w}`);
  if (problems.length) { console.error(`${problems.length} problem${problems.length > 1 ? "s" : ""}:\n  ${problems.join("\n  ")}`); return 1; }
  if (args.includes("--check")) console.log(`${rows.length} codes: fine`);
  return 0;
}
