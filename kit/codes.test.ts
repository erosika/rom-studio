// kit/codes.test.ts: the cheat codes as data (kit/codes.ts) and the base's codes engine they feed. Run: bun test kit
import { afterAll, beforeAll, expect, test as always } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync as readFile, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Codes, CODE_MAX, EFFECTS, FORMAT, LINE_MAX, ROLES, box, checkCodes, isTestBuild, lineOf, tableFor, writeCodesTable } from "./codes";

const BASE = join(import.meta.dir, "base"), OVERLAY = join(BASE, "overlay");
const HAS_BASE = existsSync(join(OVERLAY, "codes.json")), test = HAS_BASE ? always : always.skip; // a copy without the optional base has no codes engine to test
const readFileSync = (f: string, enc: "utf8") => (HAS_BASE || !f.startsWith(BASE) ? readFile(f, enc) : "");
const starter = (): Codes => JSON.parse(readFileSync(join(OVERLAY, "codes.json"), "utf8"));
const engineH = readFileSync(join(OVERLAY, "include/studio_codes.h"), "utf8");
const engineC = readFileSync(join(OVERLAY, "src/zz_studio_codes.c"), "utf8");
const scripts = readFileSync(join(OVERLAY, "data/scripts/studio_codes.inc"), "utf8");
const patches = ["0012-studio-codes.patch", "0013-select-shortcut.patch", "0024-codes-switches.patch"].map((p) => readFileSync(join(BASE, "patches", p), "utf8")).join("\n");
const game = mkdtempSync(join(tmpdir(), "codes-test-"));
const put = (rel: string, body: string) => { mkdirSync(join(game, rel, ".."), { recursive: true }); writeFileSync(join(game, rel), body); };
const one = (c: Partial<Codes["codes"][0]>, more: Partial<Codes> = {}): Codes => ({ flags: starter().flags, ...more, codes: [{ code: "HELLO", does: "says hello", use: "repeat", effect: { say: true }, reply: "Hello.", ...c } as Codes["codes"][0]] });
const problems = (d: Codes, tree?: string) => checkCodes(d, tree).problems.join("\n");

beforeAll(() => {
  if (!HAS_BASE) return;
  // a made-up tree with just what the check reads: the engine header, the flags and vars, the two config switches
  put("Makefile", "all:\n"); put("game.md", "# A test game\n"); put("include/studio_codes.h", engineH);
  put("include/constants/flags.h", Array.from({ length: 16 }, (_, i) => { const n = (0x264 + i).toString(16).toUpperCase(); return `#define FLAG_UNUSED_0x${n}  0x${n} // Unused Flag`; }).join("\n") + "\n");
  put("include/constants/vars.h", "#define VAR_UNUSED_0x40F7  0x40F7\n");
  put("include/config/wild_encounter.h", "#define WE_FLAG_NO_ENCOUNTER        FLAG_UNUSED_0x266 // studio\n");
  put("include/config/overworld.h", "#define OW_FOLLOWERS_ENABLED           TRUE\n");
  put("data/scripts/studio_codes.inc", scripts);
  put("src/other.c", "void Story(void) { FlagSet(FLAG_UNUSED_0x26F); }\n");
  put("codes.json", JSON.stringify(starter()));
  for (const a of [["init", "-q"], ["add", "-A"], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first"]]) Bun.spawnSync(["git", "-C", game, ...a]);
});
afterAll(() => rmSync(game, { recursive: true, force: true }));

test("the starter codes every new game gets are fine, in the data and against a tree", () => {
  const d = starter(), r = checkCodes(d, game);
  expect(r.problems).toEqual([]);
  expect(r.warnings).toEqual([]);
  const names = d.codes.map((c) => c.code);
  // the ones the base promises: the list, the all-off switch, the guarded give and money codes, and the new switches
  for (const n of ["ALL CODES", "KILLSWITCH", "RICH", "STARTERS", "TOOLS", "ALL TMS", "PERFECT", "DOUBLE EXP", "MORE WILD", "NO WILD", "FOLLOWER", "WALL WALK"]) expect(names).toContain(n);
  for (const c of d.codes) {
    expect(c.code.length).toBeLessThanOrEqual(CODE_MAX);
    expect(c.code.length + 2 + lineOf(c).length).toBeLessThanOrEqual(LINE_MAX);
    expect(JSON.stringify(c)).not.toMatch(/LATENT|HERMES|TEKNIUM|MODEL/); // the base's neutral wording
  }
  expect(isTestBuild(d, undefined)).toBe(false); // a release is a play build
  expect(isTestBuild(d, "test")).toBe(true);
});

test("the table: the engine's format, every flag the engine reads, every code in order, a 0-ended list, the end row", () => {
  const d = starter(), { rows } = checkCodes(d), h = tableFor(d, rows, false);
  expect(h).toContain(`#define STUDIO_CODES_TABLE_FORMAT ${FORMAT}`);
  expect(Number(/#define STUDIO_CODES_FORMAT (\d+)/.exec(engineH)![1])).toBe(FORMAT);
  expect(h).toContain("#define STUDIO_CODES_TEST_BUILD 0");
  expect(h).toContain("#define STUDIO_CODES_IN_PC 1");
  for (const [role, def] of Object.entries(ROLES)) if (def && d.flags![role]) expect(h).toContain(`#define ${def} ${d.flags![role]}`);
  expect(h).toContain("static const u16 sCode5_List[] = {SPECIES_TREECKO, SPECIES_TORCHIC, SPECIES_MUDKIP, 0};");
  expect(h).toContain(".script = StudioCodes_EventScript_AllCodes");
  expect(h).toContain("extern const u8 StudioCodes_EventScript_AllCodes[];");
  expect(h).toMatch(/\.text = sCode0_Text.*\.effect = STUDIO_EFFECT_SCRIPT, \.use = STUDIO_CODE_REPEAT, \.scope = STUDIO_CODE_PLAY\},/);
  expect(h).toMatch(/WALL WALK[\s\S]*\.scope = STUDIO_CODE_TEST/);
  expect(h.trimEnd().endsWith("    {NULL},\n};")).toBe(true);
  expect(tableFor(d, rows, true)).toContain("#define STUDIO_CODES_TEST_BUILD 1");
  // every effect the data can name is one the engine has, and every flag the engine reads is one the data can give
  for (const e of new Set(Object.values(EFFECTS))) expect(engineH).toMatch(new RegExp(`#define STUDIO_EFFECT_${e}\\b`));
  for (const def of ["STUDIO_CODES_FOLLOW_FLAG", "STUDIO_CODES_MOREWILD_FLAG", "STUDIO_CODES_EXP_FLAG", "STUDIO_CODES_WALK_FLAG", "STUDIO_SELECT_VAR"]) {
    expect(engineC).toContain(def);
    expect(Object.values(ROLES)).toContain(def);
  }
});

test("message box text: two lines, then scroll; quotes made safe", () => {
  expect(box("Every fight gives twice the EXP now. Type DOUBLE EXP again to stop.")).toBe("Every fight gives twice the EXP\\nnow. Type DOUBLE EXP again to\\lstop.");
  expect(box(`It's "on".`)).toBe(`It’s \\"on\\".`);
  expect(lineOf({ code: "LONGCODE", does: "a very long description of what it does; more", use: "repeat", effect: {}, reply: "x" })).toBe("a very long description");
});

test("problems are named in plain words, one per mistake", () => {
  expect(problems(one({ code: "hello" }))).toContain("capitals and digits");
  expect(problems(one({ code: "ELEVENLETTER" }))).toContain("the code screen holds 10");
  expect(problems({ ...one({}), codes: [...one({}).codes, ...one({}).codes] })).toContain("listed twice");
  expect(problems(one({ effect: { heal: true, say: true } }))).toContain("effect is one of");
  expect(problems(one({ effect: { teleport: true } }))).toContain("effect is one of");
  expect(problems(one({ effect: { giveItem: "ITEM_POKE_BALL", amount: 3 } }))).toContain(`"amount" means nothing to giveItem (it takes count)`);
  expect(problems(one({ use: "toggle", effect: { say: true } }))).toContain("toggle codes need a save flag");
  expect(problems(one({ use: "toggle", effect: { flag: "nonsense" } }))).toContain(`"nonsense" is neither a FLAG_ name nor one of "flags"`);
  expect(problems(one({ effect: { walkThroughWalls: true }, use: "toggle" }))).toContain("only exists in test builds");
  expect(problems(one({ effect: { followers: true }, use: "toggle" }, { flags: {} }))).toContain("flags.follow");
  expect(problems(one({ effect: { allOff: true }, use: "toggle", flag: "FLAG_UNUSED_0x270" }))).toContain(`allOff codes work every time`);
  expect(problems(one({ effect: { giveMons: ["SPECIES_A", "SPECIES_B", "SPECIES_C", "SPECIES_D", "SPECIES_E", "SPECIES_F", "SPECIES_G"], level: 5 } }))).toContain("1 to 6 SPECIES_");
  expect(problems(one({ effect: { addMoney: 2000000 } }))).toContain("from 0 to 999999");
  expect(problems(one({ line: "a line far too long to fit on the page" }))).toContain("is too long");
  expect(problems(one({ reply: "Hi {PLAYER_NAME}." }))).toContain("{PLAYER_NAME} is not something the game fills in");
  expect(problems(one({ reply: "Tab\there" }))).toContain("letters the game's text may not have");
  const shared = one({}); shared.codes = [{ ...shared.codes[0]!, code: "A", use: "toggle", effect: { flag: "more_wild" } }, { ...shared.codes[0]!, code: "B", use: "toggle", effect: { flag: "FLAG_UNUSED_0x267" } }];
  expect(problems(shared)).toContain("is also A's");
  expect(problems(one({}, { flags: { walk: "FLAG_UNUSED_0x264", used: "FLAG_UNUSED_0x264" } }))).toContain("is also flags.walk");
});

test("against the tree: flags that exist, config switches that agree, scripts that exist, flags something else uses", () => {
  expect(problems(one({ use: "toggle", effect: { flag: "FLAG_NOT_THERE" } }), game)).toContain("FLAG_NOT_THERE is not in include/constants/flags.h");
  expect(problems(one({ use: "toggle", effect: { flag: "no_wild" } }, { flags: { ...starter().flags, no_wild: "FLAG_UNUSED_0x26A" } }), game)).toContain("WE_FLAG_NO_ENCOUNTER is FLAG_UNUSED_0x266");
  expect(problems(one({ effect: { script: "Nowhere_EventScript" } }), game)).toContain("no script Nowhere_EventScript:: in data/");
  expect(problems(one({ effect: { script: "StudioCodes_EventScript_AllCodes" } }), game)).toBe("");
  expect(checkCodes(one({ use: "toggle", effect: { flag: "FLAG_UNUSED_0x26F" } }), game).warnings.join()).toContain("FLAG_UNUSED_0x26F (a codes flag) is also named in src/other.c");
  const old = join(game, "old"); mkdirSync(join(old, "include"), { recursive: true }); writeFileSync(join(old, "include/studio_codes.h"), "#define STUDIO_CODES_FORMAT 1\n#define STUDIO_EFFECT_SAY 1\n");
  expect(problems(one({}), old)).toContain("the game's codes engine is format 1");
  expect(problems(one({}), join(game, "nowhere"))).toContain("this game has no codes engine");
}, 30000);

test("kit build's step: writes the table only when it changed, refuses bad data, leaves a game without codes.json alone", () => {
  const out = join(game, "include/studio_codes_table.h");
  const first = writeCodesTable(game, "play");
  expect(first).toMatchObject({ ok: true, written: true, count: starter().codes.length });
  const t = statSync(out).mtimeMs, again = writeCodesTable(game, "play");
  expect(again.written).toBe(false);
  expect(statSync(out).mtimeMs).toBe(t); // no rebuild for nothing
  expect(writeCodesTable(game, "test").written).toBe(true);
  expect(readFileSync(out, "utf8")).toContain("#define STUDIO_CODES_TEST_BUILD 1");
  const d = starter(); d.codes.push({ ...d.codes[2]!, code: "rest" }); writeFileSync(join(game, "codes.json"), JSON.stringify(d));
  const bad = writeCodesTable(game, "play");
  expect(bad.ok).toBe(false);
  expect(bad.message).toContain("nothing was built");
  writeFileSync(join(game, "codes.json"), JSON.stringify(starter()));
  const none = mkdtempSync(join(tmpdir(), "codes-none-"));
  expect(writeCodesTable(none)).toEqual({ ok: true, written: false, count: 0, message: "" });
  rmSync(none, { recursive: true, force: true });
  const r = Bun.spawnSync(["bun", join(import.meta.dir, "kit.ts"), "codes", "--game", game]);
  expect(r.stderr.toString()).toBe("");
  expect(r.exitCode).toBe(0);
  expect(r.stdout.toString()).toMatch(/KILLSWITCH +every time play +every code that is switched on goes off/);
}, 30000);

test("the base's engine wiring: every special the scripts call is in the specials table, and every new one is in the C", () => {
  const declared = new Set([...patches.matchAll(/^\+\tdef_special (\w+)/gm)].map((m) => m[1]!));
  const called = new Set([...scripts.matchAll(/^\t(?:special|specialvar VAR_\w+,) (\w+)/gm)].map((m) => m[1]!).filter((s) => /^Studio(Codes|Select)_/.test(s)));
  for (const s of called) expect(declared).toContain(s);
  for (const s of declared) if (/^StudioCodes_/.test(s)) expect(engineC).toMatch(new RegExp(`^(u16|void|bool8) ${s}\\(`, "m"));
  // a special that waits by itself must not be followed by another waitstate (the script would wait for good)
  expect(scripts).not.toMatch(/special StudioCodes_WaitPage[^\n]*\n\twaitstate/);
  expect(patches).toContain("def_special StudioCodes_WaitPage, waitstate=1");
  // the menu rows and the script's positions agree: 0 type, 1 used, 2 all codes, 3 SELECT
  expect(engineC).toMatch(/sText_TypeACode[\s\S]*sText_CodesUsed[\s\S]*sText_AllCodes[\s\S]*sText_SelectButton[\s\S]*gText_Cancel/);
  expect(scripts).toMatch(/VAR_RESULT, 2, StudioCodes_EventScript_AllCodes\n\tgoto_if_eq VAR_RESULT, 3, StudioCodes_EventScript_SelectButton/);
  // the switches other parts of the game read, and the calm follower
  for (const s of ["StudioCodes_FollowersOn()", "StudioCodes_MoreWild()", "StudioCodes_DoubleExp()", "OW_FOLLOWERS_ENABLED           TRUE", "OW_FOLLOWERS_BOBBING           FALSE", "STUDIO_CALM_FOLLOWER_IDLE", "STUDIO_CALM_FOLLOWER_BALL", "WE_FLAG_NO_ENCOUNTER        FLAG_UNUSED_0x266"]) expect(patches).toContain(s);
  expect(starter().flags!.no_wild).toBe("FLAG_UNUSED_0x266");
});
