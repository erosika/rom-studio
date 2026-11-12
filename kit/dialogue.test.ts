// kit/dialogue.test.ts: kit dialogue and the pane's Dialogue route against a small made-up tree. Run: bun test kit
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asmTexts, boxesOf, dialoguePage, filterDialogue, inStoryOrder, readDialogue, readNotes, scriptTexts } from "./dialogue";
import { dialogueRoute } from "../pane/dialogue";

const game = mkdtempSync(join(tmpdir(), "dialogue-test-"));
const put = (rel: string, body: string) => { mkdirSync(join(game, rel, ".."), { recursive: true }); writeFileSync(join(game, rel), body); };
const kit = (...a: string[]) => { const r = Bun.spawnSync(["bun", join(import.meta.dir, "kit.ts"), "dialogue", ...a, "--game", game]); return { ok: r.exitCode === 0, out: r.stdout.toString() + r.stderr.toString() }; };

beforeAll(() => {
  put("Makefile", "all:\n");
  put("data/maps/HarbourTown/scripts.pory", `script HarbourTown_Sailor {\n    msgbox(HarbourTown_Text_Sailor, MSGBOX_NPC)\n    msgbox(format("Mind the {PLAYER} rope."))\n}\ntext HarbourTown_Text_Sailor {\n    format("SAILOR: The tide is \\"late\\" again.\\pIt owes me\\nan hour. {PLAYER}, wait here.")\n}\n`);
  put("data/maps/HarbourTown/scripts.inc", `HarbourTown_Text_Sailor::\n\t.string "made from the script above$"\n`);
  put("data/maps/HillRoad/scripts.inc", `HillRoad_EventScript_Sign::\n\tmsgbox HillRoad_Text_Sign, MSGBOX_SIGN\n\tend\n\nHillRoad_Text_Sign:\n\t.string "HILL ROAD\\n"\n\t.string "Mind the goats.\\p"\n\t.string "They mind you.$"\n`);
  put("data/scripts/shop_talk.inc", `Shop_Text_Hello::\n\t.string "Welcome <in> & buy!$"\n`);
  put("src/notes.c", `static const u8 sText[] = _("not a script");\n`); put("game.md", "# My game\n");
  Bun.spawnSync(["git", "-C", game, "init", "-q"]);
});
afterAll(() => rmSync(game, { recursive: true, force: true }));

test("a text is split into boxes at page breaks; line breaks become spaces", () => {
  expect(boxesOf("One\\ntwo\\lthree\\pFour$")).toEqual(["One two three", "Four"]);
  expect(scriptTexts(`text A { format("x {PLAYER} } y") }\ntext B { "one " "two" }`)).toEqual([{ label: "A", boxes: ["x {PLAYER} } y"] }, { label: "B", boxes: ["one two"] }]);
  expect(asmTexts(`A::\n\t.string "hi$"\nB::\n\tend\n`)).toEqual([{ label: "A", boxes: ["hi"] }]);
});

test("every text is read by place; a generated file is skipped when its script is there", () => {
  const d = readDialogue(game);
  expect(d.places.map((p) => p.file)).toEqual(["data/maps/HarbourTown/scripts.pory", "data/maps/HillRoad/scripts.inc", "data/scripts/shop_talk.inc"]);
  expect(d.places[0]).toMatchObject({ place: "Harbour Town" });
  expect(d.places[0]!.texts).toEqual([{ label: "HarbourTown_Sailor (line 1)", boxes: ["Mind the {PLAYER} rope."], state: "new" }, { label: "HarbourTown_Text_Sailor", boxes: ['SAILOR: The tide is "late" again.', "It owes me an hour. {PLAYER}, wait here."], state: "new" }]);
  expect(d.places[1]!.texts).toEqual([{ label: "HillRoad_Text_Sign", boxes: ["HILL ROAD Mind the goats.", "They mind you."], state: "new" }]);
  expect(d.places[2]!.place).toBe("Shared: shop talk");
  expect([d.texts, d.boxes]).toEqual([4, 6]);
  expect(filterDialogue(d, "GOATS").places.map((p) => p.place)).toEqual(["Hill Road"]);
  expect(filterDialogue(d, "", "data/scripts/**").texts).toBe(1);
  expect(filterDialogue(d, "", null, ["changed"]).texts).toBe(0);
});

test("the command prints, filters, and writes one page whose text cannot become markup", () => {
  expect(kit().out).toContain("4 texts, 6 text boxes, in 3 places.");
  expect(kit("tide").out).toContain("1 text, 2 text boxes, in 1 place.");
  expect(JSON.parse(kit("--json", "--in", "Hill").out).places.length).toBe(1);
  const to = join(game, "all.html"); expect(kit("--page", to).ok).toBe(true);
  const page = readFileSync(to, "utf8");
  expect(page).toContain("Welcome &#60;in&#62; &#38; buy!"); expect(page).not.toContain("<in>");
  expect(page).toContain("<b>SAILOR:</b>"); expect(dialoguePage(readDialogue(game))).toBe(page);
  expect(kit("--game", join(game, "nowhere")).ok).toBe(false);
});

test("the pane's route answers the same reading, and only to a GET", async () => {
  const r = (await dialogueRoute(new Request("http://pane/dialogue/all"), "/dialogue/all", game))!;
  expect((await r.json()).texts).toBe(4);
  expect((await dialogueRoute(new Request("http://pane/dialogue/all", { method: "POST" }), "/dialogue/all", game))!.status).toBe(405);
  expect(await dialogueRoute(new Request("http://pane/state"), "/state", game)).toBeNull();
});

test("with a setup to count from, a text is new, changed or the same as the original's", () => {
  for (const a of [["add", "-A"], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base: the original"]]) Bun.spawnSync(["git", "-C", game, ...a]);
  put("data/maps/HillRoad/scripts.inc", `HillRoad_Text_Sign:\n\t.string "NEW HILL ROAD$"\nHillRoad_Text_Goat:\n\t.string "Baa.$"\n`);
  put("data/maps/NewCove/scripts.pory", `text NewCove_Text_Hi { "Hello." }\n`);
  put("data/scripts/shop_talk.pory", `text Shop_Text_Hello { "Welcome <in> & buy!" }\ntext Shop_Text_Bye { "Goodbye." }\n`); // the old file rewritten in the short language
  const states = Object.fromEntries(readDialogue(game).places.flatMap((p) => p.texts.map((t) => [t.label, t.state])));
  expect(states).toMatchObject({ HillRoad_Text_Sign: "changed", HillRoad_Text_Goat: "changed", NewCove_Text_Hi: "new", Shop_Text_Hello: "same", Shop_Text_Bye: "changed", HarbourTown_Text_Sailor: "same" });
  expect(kit().out).toContain("4 texts, 4 text boxes, in 3 places.\nThe original game's untouched texts are left out");
  expect(kit("--only", "new").out).toContain("1 text, 1 text box, in 1 place.");
  expect(kit("--all").out).toContain("7 texts, 8 text boxes, in 4 places.");
  expect(kit("--only", "old").ok).toBe(false);
});

test("a note on one text is kept in the game folder, read back with the text as it is now, changed, and marked done", async () => {
  const send = (body: unknown, type = "application/json") => dialogueRoute(new Request("http://pane/dialogue/note", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": type } }), "/dialogue/note", game);
  const sign = { file: "data/maps/HillRoad/scripts.inc", label: "HillRoad_Text_Sign" };
  expect((await send({ ...sign, note: "Too shouty.", said: "HILL ROAD Mind the goats." }))!.status).toBe(200);
  expect((await send({ ...sign, note: "Too shouty. Lower case?", said: "HILL ROAD Mind the goats." }))!.status).toBe(200);
  expect((await send({ file: "data/maps/NewCove/scripts.pory", label: "NewCove_Text_Hi", note: "Warmer.", said: "Hello." }))!.status).toBe(200);
  for (const bad of [{ file: "../etc/passwd", label: "x", note: "n" }, { file: "src/notes.c", label: "x", note: "n" }, { file: sign.file, label: "", note: "n" }]) expect((await send(bad))!.status).toBe(400);
  expect((await send(sign, "text/plain"))!.status).toBe(415);
  expect(readNotes(game).map((n) => n.note)).toEqual(["Too shouty. Lower case?", "Warmer."]);
  const out = kit("--notes").out;
  expect(out).toContain("# Dialogue notes (2)"); expect(out).toContain("## Hill Road: HillRoad_Text_Sign"); expect(out).toContain("> NEW HILL ROAD");
  expect(out).toContain("the text has changed since this note was written"); expect(out).toContain("NOTE: Warmer.");
  const file = (await dialogueRoute(new Request("http://pane/dialogue/notes.md"), "/dialogue/notes.md", game))!;
  expect(file.headers.get("content-disposition")).toContain("dialogue-notes.md"); expect(await file.text()).toContain("NOTE: Too shouty. Lower case?");
  expect((await send({ file: "data/maps/NewCove/scripts.pory", label: "NewCove_Text_Hi", note: "" }))!.status).toBe(200); // taken back
  expect(kit("--done", "HillRoad_Text_Sign").out).toContain("Marked 1 note");
  expect(kit("--notes").out).toContain("No notes are waiting."); expect(kit("--done", "all").ok).toBe(false);
});

test("the places can be read in the order a player reaches them: from the start outward, a building after its door", () => {
  const map = (name: string, id: string, joins: string[], doors: string[]) => put(`data/maps/${name}/map.json`, JSON.stringify({ id, connections: joins.map((m) => ({ map: m })), warp_events: doors.map((d) => ({ dest_map: d })) }));
  map("HillRoad", "MAP_HILL_ROAD", ["MAP_HARBOUR_TOWN", "MAP_NEW_COVE"], []); map("HarbourTown", "MAP_HARBOUR_TOWN", ["MAP_HILL_ROAD"], ["MAP_ZED_HOUSE"]);
  map("NewCove", "MAP_NEW_COVE", ["MAP_HILL_ROAD"], []); map("ZedHouse", "MAP_ZED_HOUSE", [], ["MAP_HARBOUR_TOWN"]);
  put("data/maps/ZedHouse/scripts.inc", `ZedHouse_Text_Hi:\n\t.string "Come in.$"\n`);
  put("src/new_game.c", "static void Start(void)\n{\n    SetWarpDestination(MAP_GROUP(MAP_ZED_HOUSE), MAP_NUM(MAP_ZED_HOUSE), WARP_ID_NONE, 1, 1);\n}\n");
  expect(inStoryOrder(readDialogue(game).places).map((p) => p.place)).toEqual(["Zed House", "Harbour Town", "Hill Road", "New Cove", "Shared: shop talk"]);
  put("settings.json", JSON.stringify({ start_map: "NewCove" }));
  expect(kit("--all", "--story", "--json").ok).toBe(true);
  expect(JSON.parse(kit("--all", "--story", "--json").out).places.map((p: { place: string }) => p.place)).toEqual(["New Cove", "Hill Road", "Harbour Town", "Zed House", "Shared: shop talk"]);
});
