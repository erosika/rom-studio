// kit/find.test.ts: kit find and the pane's Source routes end to end against a small made-up tree. Run: bun test kit
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findText } from "./find";
import { sourceRoute, treeRoot, unpack } from "../pane/source";

const game = mkdtempSync(join(tmpdir(), "find-test-")), work = mkdtempSync(join(tmpdir(), "find-work-")), data = join(work, "data"), none = join(work, "no-game-yet");
const kit = (...a: string[]) => { const r = Bun.spawnSync(["bun", join(import.meta.dir, "kit.ts"), "find", ...a, "--game", game]); return { ok: r.exitCode === 0, out: r.stdout.toString() + r.stderr.toString() }; };
const put = (rel: string, body: string | Uint8Array) => { mkdirSync(join(game, rel, ".."), { recursive: true }); writeFileSync(join(game, rel), body); };
const ask = (method: string, path: string, body?: BodyInit, at = game) => sourceRoute(new Request(`http://pane${path}`, { method, body, headers: method === "POST" ? { "Content-Type": "application/json" } : undefined }), decodeURIComponent(path.split("?")[0]!), at, data) as Promise<Response>;
/** An archive made by a short script, so its entries can be named anything. */
const archive = (name: string, py: string) => { const to = join(work, name); const r = Bun.spawnSync(["python3", "-I", "-c", `import io, sys, tarfile, zipfile\nto = sys.argv[1]\n${py}`, to]); if (r.exitCode) throw new Error(r.stderr.toString()); return to; };
const TAR = (entries: string) => `t = tarfile.open(to, "w:gz")\nfor name, body in ${entries}:\n    i = tarfile.TarInfo(name); i.size = len(body); t.addfile(i, io.BytesIO(body))\nt.close()`;

beforeAll(() => {
  put("Makefile", "all:\n"); put("game.md", "# My game\n");
  put("data/maps/HarbourTown/scripts.inc", "HarbourTown_EventScript_Sailor::\n\tmsgbox HarbourTown_Text_Sailor, MSGBOX_NPC\n\tend\n");
  put("data/maps/HillRoad/scripts.inc", "HillRoad_EventScript_Sign::\n\tmsgbox HillRoad_Text_Sign, MSGBOX_SIGN\n\tend\n");
  put("src/harbour.c", Array.from({ length: 60 }, (_, i) => (i === 29 ? "static void GreetSailor(void) { /* the harbour sailor */ }" : `// line ${i + 1}`)).join("\n") + "\n");
  put("graphics/sailor.bin", new Uint8Array([0, 1, 2, 0x73, 0x61, 0x69, 0x6c, 0x6f, 0x72, 0]));
  put("build/harbour.o.txt", "sailor in build output\n");
  for (const a of [["init", "-q"], ["add", "-A", ":!build"], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first"]]) Bun.spawnSync(["git", "-C", game, ...a]);
  writeFileSync(join(game, ".git/info/exclude"), "build/\n");
  put("data/maps/NewCove/scripts.inc", "NewCove_EventScript_Sailor::\n\tend\n"); // written since the last commit
});
afterAll(() => { rmSync(game, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); });

test("search finds lines in source, new files included; skips binaries and build output; caps and counts the rest", async () => {
  const all = JSON.parse(kit("sailor", "--json").out);
  expect(all.files.map((f: any) => f.file)).toEqual(["data/maps/HarbourTown/scripts.inc", "data/maps/NewCove/scripts.inc", "src/harbour.c"]);
  expect(all.files[0].hits[0]).toEqual({ line: 1, text: "HarbourTown_EventScript_Sailor::", mark: [24, 30] });
  expect(all).toMatchObject({ shown: 4, more: 0 });
  expect(kit("SAILOR", "--in", "data/maps/**", "--max", "1").out).toMatch(/HarbourTown\/scripts\.inc\n  1: HarbourTown_EventScript_Sailor::\n1 line in 1 file\. 2 more not shown/);
  expect(kit("sailor", "--in", "*.c").out).toMatch(/^src\/harbour\.c\n  30: /);
  expect(kit("^\\w+_EventScript_\\w+::$", "--regex").out).toContain("3 lines in 3 files.");
  expect(kit("msgbox(", "--regex")).toMatchObject({ ok: false });
  expect(kit("no such words").out).toContain('Nothing holds "no such words"');
  rmSync(join(game, ".git"), { recursive: true }); // a folder that is not kept in git is walked instead
  try { expect((await findText(game, "sailor", { in: "data/**" })).files.map((f) => f.file)).toEqual(["data/maps/HarbourTown/scripts.inc", "data/maps/NewCove/scripts.inc"]); expect((await findText(game, "sailor")).shown).toBe(4); }
  finally { for (const a of [["init", "-q"], ["add", "-A", ":!build"], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "again"]]) Bun.spawnSync(["git", "-C", game, ...a]); }
});

test("the lines around a hit are numbered; a path outside the game folder is refused, a link out of it too", async () => {
  const out = kit("--file", "src/harbour.c", "--at", "30", "--span", "2").out;
  expect(out).toContain("src/harbour.c  (lines 28 to 32 of 60)"); expect(out).toContain(">30  static void GreetSailor");
  writeFileSync(join(work, "secret.txt"), "not yours\n"); symlinkSync(join(work, "secret.txt"), join(game, "link.txt"));
  for (const path of ["../secret.txt", join(work, "secret.txt"), "link.txt", "data/../../secret.txt"]) { const r = kit("--file", path); expect(r.ok).toBe(false); expect(r.out).toContain("outside the game folder"); expect(r.out).not.toContain("not yours"); }
  rmSync(join(game, "link.txt"));
  const page = await (await ask("GET", "/source/file?path=src/harbour.c&at=30&span=1")).json();
  expect(page).toMatchObject({ file: "src/harbour.c", at: 30, from: 29, to: 31, total: 60 }); expect(page.lines[1].text).toContain("GreetSailor");
  const no = await ask("GET", `/source/file?path=${encodeURIComponent("../../etc/hostname")}`); expect(no.status).toBe(400); expect(await no.text()).toContain("outside the game folder");
  expect((await (await ask("GET", "/source/search?q=sailor&in=src")).json()).files[0].hits[0].line).toBe(30);
  const info = await (await ask("GET", "/source/info")).json();
  expect(info).toMatchObject({ isGame: true, files: 2 }); expect(info.folders).toEqual([{ name: "data", files: 3 }, { name: "graphics", files: 1 }, { name: "src", files: 1 }]);
});

test("an archive with a path that climbs out is refused and nothing is written; a good one unpacks without its links", async () => {
  const climbs = archive("climbs.tar.gz", TAR('[("tree/Makefile", b"all:\\n"), ("tree/../../escaped.txt", b"out")]'));
  const zipClimbs = archive("climbs.zip", 'z = zipfile.ZipFile(to, "w"); z.writestr("Makefile", "all:\\n"); z.writestr("../escaped.txt", "out"); z.close()');
  for (const [file, name] of [[climbs, "mine.tar.gz"], [zipClimbs, "mine.zip"]]) {
    const r = await ask("PUT", `/source/archive/${name}`, readFileSync(file!), none);
    expect(r.status).toBe(400); expect(await r.text()).toContain("would unpack outside its folder");
  }
  expect(existsSync(join(work, "escaped.txt"))).toBe(false); expect(existsSync(join(data, "..", "escaped.txt"))).toBe(false); expect(existsSync(none)).toBe(false);
  expect(readdirSync(data).filter((f) => f !== "source-setup.log")).toEqual([]); // no half-unpacked folder, no archive left, no setup started
  expect((await ask("PUT", "/source/archive/notes.txt", "x", none)).status).toBe(400);
  const good = archive("good.tar.gz", `${TAR('[("my-tree/Makefile", b"all:\\n"), ("my-tree/src/a.c", b"int a;\\n")]').replace("t.close()", "")}l = tarfile.TarInfo("my-tree/out-link"); l.type = tarfile.SYMTYPE; l.linkname = "/etc"; t.addfile(l)\nt.close()`);
  const dest = join(work, "unpacked");
  expect(await unpack(good, dest)).toBe(2);
  expect(treeRoot(dest)).toBe(join(dest, "my-tree")); expect(readdirSync(join(dest, "my-tree")).sort()).toEqual(["Makefile", "src"]);
  const swells = archive("swells.tar.gz", 't = tarfile.open(to, "w:gz"); i = tarfile.TarInfo("tree/Makefile"); i.size = 5 * 10**9; t.addfile(i); t.close()'); // says it holds 5 GB
  await expect(unpack(swells, join(work, "too-much"))).rejects.toThrow(/unpacks to more than 4 GB/); expect(existsSync(join(work, "too-much"))).toBe(false);
  const noTree = archive("no-tree.zip", 'z = zipfile.ZipFile(to, "w"); z.writestr("notes/readme.txt", "hello"); z.close()');
  const r = await ask("PUT", "/source/archive/no-tree.zip", readFileSync(noTree), none); expect(r.status).toBe(400); expect(await r.text()).toContain("does not look like a decomp");
});

test("setup refuses when the game folder holds a game, and when it holds other files; the game is not touched", async () => {
  const before = Bun.spawnSync(["git", "-C", game, "status", "--porcelain"]).stdout.toString() + readdirSync(game).join();
  const r = await ask("POST", "/source/setup", JSON.stringify({ from: work }));
  expect(r.status).toBe(400); expect(await r.text()).toMatch(/already a game in .* never overwrites a game.*--game <new folder>/);
  const up = await ask("PUT", "/source/archive/mine.zip", "anything"); expect(up.status).toBe(400); expect(await up.text()).toContain("never overwrites a game");
  expect(Bun.spawnSync(["git", "-C", game, "status", "--porcelain"]).stdout.toString() + readdirSync(game).join()).toBe(before);
  const other = join(work, "holds-files"); mkdirSync(other); writeFileSync(join(other, "notes.txt"), "mine\n");
  const o = await ask("POST", "/source/setup", JSON.stringify({ from: work }), other); expect(o.status).toBe(400); expect(await o.text()).toContain("holds files that are not a game");
  expect((await ask("POST", "/source/setup", JSON.stringify({ from: "" }), none)).status).toBe(400);
  expect(await (await ask("GET", "/source/setup")).json()).toEqual({ running: false, ok: null, lines: [] });
});
