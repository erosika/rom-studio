#!/usr/bin/env bun
// kit/mcp.ts: the kit's commands as tools, one to one, over MCP on stdio (one JSON message per line).
// No logic here: each tool runs `kit <command>` and returns what it printed, plus the picture when there is one.
// The game folder comes from ROM_STUDIO_GAME in this server's environment (else the kit's default).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { childEnv } from "./env";

const KIT = join(import.meta.dir, "kit.ts");
type Props = Record<string, { type: string; description: string }>;
const str = (description: string) => ({ type: "string", description }), bool = (description: string) => ({ type: "boolean", description });
const STEPS = "Driver steps on one line, run in order from a fresh new game: warp <group> <num> <x> <y>, walk UP:3,LEFT:2, press A,B, wait 60, flag set|clear <number>, givemon <species number> <level>, script <script name>, gender <0|1>, time [HH:MM] (print or set the game's clock; put it before warp)";

// name -> [what it does, its arguments, required ones, how the arguments become the command line]
const TOOLS: Record<string, [string, Props, string[], (a: Record<string, any>) => string[]]> = {
  status: ["Is the toolchain there, is there a game folder, which scene is next, when was the last build.", {}, [], () => []],
  setup: ["First-time setup: checks tools, copies the user's decomp into the game folder, adds the calm and helper base if it fits, first build. Takes several minutes. Safe to rerun.",
    { decomp: str("The user's decomp: a folder or a git address they gave. Never guess one; ask the user") }, [], (a) => (a.decomp ? ["--decomp", a.decomp] : [])],
  build: ["Build the game after a change. Prints OK and seconds, or the first error with file and line.", {}, [], () => []],
  play: ["Start or reuse the player and return the link that opens the game.", { phone: bool("Also give a link for a phone on the same network"), stop: bool("Stop the player instead") }, [],
    (a) => [...(a.phone ? ["--phone"] : []), ...(a.stop ? ["--stop"] : [])]],
  shot: ["A picture from the real game, optionally after placing the player and running steps.",
    { at: str("Where to place the player first: group.number,x,y (as `where` prints the map), e.g. 0.9,5,5"), steps: str(STEPS), name: str("File name inside shots/, e.g. stove-talk.png (default: the next number)"), scale: str("Enlarge by this whole number, e.g. 3"), time: str("The hour of the game's clock for the picture, HH:MM, e.g. 12:00 or 00:00") }, [],
    (a) => [...(a.at ? ["--at", a.at] : []), ...(a.time ? ["--time", a.time] : []), ...(a.name ? ["--name", a.name] : []), ...(a.scale ? ["--scale", String(a.scale)] : []), ...words(a.steps)]],
  press: ["Drive the game: press buttons or run steps, then report where the player is and take a picture.", { buttons: str(`Buttons such as A,A,UP:30 (name:frames holds). Or: ${STEPS}`) }, ["buttons"], (a) => words(a.buttons)],
  where: ["Map, square, facing, whether the player has control, and the text of the last message.", { steps: str(STEPS) }, [], (a) => words(a.steps)],
  maps: ["List the user's own maps (added since setup): size, group.number, joins, doors, counts of people, signs and triggers.", { all: bool("Every map, the original game's included"), json: bool("As JSON") }, [],
    (a) => [...(a.all ? ["--all"] : []), ...(a.json ? ["--json"] : [])]],
  map: ["Draw a whole map to a picture from the tree's own layout and tileset files, with optional overlays.",
    { name: str("The map's name as `maps` prints it"), overlay: str("Any of people, doors, joins, collision (comma-separated), or all"), png: str("Where to save (default shots/maps/<name>.png)"), scale: str("Enlarge by this whole number (default 2)") }, ["name"],
    (a) => [a.name, ...["overlay", "png", "scale"].flatMap((k) => (a[k] ? [`--${k}`, String(a[k])] : []))]],
  tileset: ["For restyling a place. roles: a first-guess role for every building block of a tileset (roles.json beside it, and a labelled contact sheet). maps: the maps that use it. before-after: three maps drawn from the last kept commit and from now, side by side. restyle: redraw the tileset in place by role in the colours of the user's profile, always from the original art. objects: candidate multi-block objects (houses, signs, trees) with footprint and where one stands.",
    { name: str("The tileset, e.g. general (maps --all shows each map's tilesets)"), what: str("roles, maps, before-after, restyle or objects"), maps: str("before-after only: map names, comma-separated"), force: bool("roles only: replace an existing roles.json"),
      profile: str("restyle only: the user's look, a JSON file in the game folder (ramps, plate colours, treatments)"), palette_only: bool("restyle only: repaint colours, leave the dots"), lore: str("restyle only: the lore id whose Lineage gets a line"), json: bool("maps and objects: as JSON") }, ["name", "what"],
    (a) => [a.name, a.what, ...(a.maps ? ["--maps", a.maps] : []), ...(a.force ? ["--force"] : []), ...(a.profile ? ["--profile", a.profile] : []), ...(a.palette_only ? ["--palette-only"] : []), ...(a.lore ? ["--lore", a.lore] : []), ...(a.json ? ["--json"] : [])]],
  redraw: ["Replace whole objects of existing tilesets by the user's own drawings of the same footprint, from their art module (a Python file in the game folder; kit/objects.py explains it). Without write it only makes previews. With dump: print the blocks and tiles at a place on a map.",
    { art: str("The art module, e.g. tools/my_art.py"), write: bool("Write the tiles, palettes and blocks (default: previews only)"), only: str("Only these groups, comma-separated (previews only)"), dump: str("Instead: a map and a rectangle, e.g. MyTown 2 4 5 6") }, [],
    (a) => (a.dump ? ["dump", ...words(a.dump)] : [a.art ?? "", ...(a.write ? ["--write"] : []), ...(a.only ? ["--only", a.only] : [])].filter(Boolean))],
  gates: ["Candidates, not certainties: places on the walk between two maps where a story switch may stop the player (trigger squares, scripts that walk the player, people who are only sometimes there, obstacles).",
    { from: str("The map the walk starts in"), to: str("The map it ends in"), json: bool("As JSON") }, [], (a) => [...(a.from ? ["--from", a.from] : []), ...(a.to ? ["--to", a.to] : []), ...(a.json ? ["--json"] : [])]],
  lore: ["The lore index: one small file per town, scene or notable object (lore/<id>.md). With no id: every id with its name and one-line mood. With an id: the file, everything that points at the id (script blocks, tool table entries, notes lines, pictures), and its lineage. what=check: ids referenced with no file, files nothing references, files missing headings. what=new: a new file with the fixed headings (never replaces one).",
    { id: str("A lore id, e.g. harbour-town"), what: str("check or new (leave out to list or show)"), name: str("new only: the name as the game shows it, e.g. HARBOUR TOWN"), json: bool("As JSON") }, [],
    (a) => [...(a.what === "check" ? ["check"] : a.what === "new" ? ["new", a.id ?? "", a.name ?? ""].filter(Boolean) : a.id ? [a.id] : []), ...(a.json ? ["--json"] : [])]],
  scenes: ["The scenes in game.md with their ticks and, for each, its feed entries and pictures.", { json: bool("As JSON") }, [], (a) => (a.json ? ["--json"] : [])],
  note: ["Append one entry to the feed the user watches. Use after each meaningful change, one or two plain sentences about the game, not about files.",
    { did: str("What changed in the game"), shot: str("A picture, e.g. shots/0042.png"), next: str("What is about to happen"), asked: str("The user's request in their words, on the first entry after a request"), scene: str("Scene name (default: the next unticked scene in game.md)"),
      by: str("Who wrote this, when several agents work at once: a short stream name such as art or script"), before: str("A second picture shown beside the first as before and after"),
      answers: str("The time of an entry the user marked needs work, when this entry is your answer to it (kit reviews prints it)"), lore: str("A lore id: the sentence also goes under Lineage in lore/<id>.md") }, ["did"],
    (a) => [a.did, ...["shot", "next", "asked", "scene", "by", "before", "answers", "lore"].flatMap((k) => (a[k] ? [`--${k}`, String(a[k])] : []))]],
  reviews: ["What the user answered to feed entries in the pane: looks right or needs work, with a note. Call it with open before starting and after each step: an open one is the user telling you what is wrong without typing in the chat.",
    { open: bool("Only needs-work answers that no later entry has answered"), scene: str("Only this scene or stream"), json: bool("As JSON") }, [], (a) => [...(a.open ? ["--open"] : []), ...(a.scene ? ["--scene", a.scene] : []), ...(a.json ? ["--json"] : [])]],
  decide: ["Ask the user to choose something that is theirs to choose (a name, a look, which of two ways). It waits in the pane's Decisions tab; carry on with what does not depend on it and read the answer later with decisions.",
    { question: str("The question, complete in itself"), options: str("The choices, separated by |"), recommend: str("The option you would pick (must be one of the options)"), scene: str("Scene name"), detail: str("One line of what hangs on it") }, ["question"],
    (a) => [a.question, ...["options", "recommend", "scene", "detail"].flatMap((k) => (a[k] ? [`--${k}`, String(a[k])] : []))]],
  decisions: ["The questions asked with decide and the user's answers.", { open: bool("Only those not answered yet"), json: bool("As JSON") }, [], (a) => [...(a.open ? ["--open"] : []), ...(a.json ? ["--json"] : [])]],
  settings: ["Read settings.json in the game folder, one key of it, or set a key. The user's choices live here: image_model (the picture model your own tool should use), workers and default_worker (the helpers you may hand work to).",
    { key: str("A key, e.g. image_model (leave out for the whole file)"), value: str("Set the key to this (JSON is stored as JSON)") }, [], (a) => [...(a.key ? [a.key] : []), ...(a.key && a.value !== undefined ? [String(a.value)] : [])]],
  workers: ["The helpers the user switched on in the pane's Settings tab (name, the command that starts one, model) and which is the default. Read it before handing work to another agent.", { json: bool("As JSON") }, [], (a) => (a.json ? ["--json"] : [])],
  music: ["The game's songs, sound effects, samples and cries. No what: list them (number, file, voice group, volume, length, which maps have it as their music, which are the user's own). play or render: a recording of one from the built game (the game's own instruments, as of the last build). where: the maps, scripts and code that play it. replace: the user's own file in place of one (.mid for a song or effect, .wav for a sample or cry), checked first and refused with the reason if it would not build. The kit makes no music.",
    { what: str("play, render, where or replace (leave out to list)"), name: str("The song's constant or the sample's name, as the list prints it"), file: str("replace only: the user's .mid or .wav file"), kind: str("list only: song, effect, sample or cry"), yours: bool("list only: just the ones changed since the game folder's first commit"),
      out: str("render only: where to write the .wav"), seconds: str("play and render: how long to record"), voicegroup: str("replace a song: the voice group (instrument set) to build it with"), volume: str("replace a song: master volume, 0 to 127"), keep_loop: bool("replace: if the user's file has no loop and the old one had, repeat the whole of it"), json: bool("list only: as JSON") }, [],
    (a) => [...(a.what ? [a.what, a.name ?? "", a.file ?? ""].filter(Boolean) : []), ...["kind", "out", "seconds", "voicegroup", "volume"].flatMap((k) => (a[k] ? [`--${k}`, String(a[k])] : [])), ...(a.yours ? ["--yours"] : []), ...(a.keep_loop ? ["--keep-loop"] : []), ...(a.json ? ["--json"] : [])]],
  find: ["Search the game folder's source for some text: file, line number and the line, grouped by file (build output and binaries are skipped). With file: the numbered lines of one file around a line. Use it before guessing where something lives in the tree.",
    { text: str("The text to look for; any capitals match"), in: str("Only in files matching this glob, e.g. data/maps/** or *.inc"), regex: bool("The text is a pattern (matched as written)"), max: str("Lines to return (default 200)"),
      file: str("Instead: a file in the game folder to read"), at: str("file only: the line to centre on"), span: str("file only: lines each side (default 20)"), json: bool("As JSON") }, [],
    (a) => [...(a.file ? ["--file", a.file] : a.text ? [a.text] : []), ...["in", "max", "at", "span"].flatMap((k) => (a[k] ? [`--${k}`, String(a[k])] : [])), ...(a.regex ? ["--regex"] : []), ...(a.json ? ["--json"] : [])]],
  dialogue: ["Every line a player can read, by the place it is said in: the text's name, then one line per text box. By default what was written since setup (texts in new scripts and texts changed in old ones). With notes: the notes the user wrote on single texts in the pane's Dialogue tab, each with the text as it reads now; read them before and after dialogue work. With done: mark a note dealt with once you changed its text.",
    { words: str("Only the texts that hold these words; any capitals match"), in: str("Only this place or folder, e.g. data/maps/HarbourTown"), only: str("new or changed"), all: bool("Also the original game's untouched texts"), story: bool("Places in the order a player reaches them"),
      notes: bool("Instead: the user's waiting notes"), done: str("Instead: the name of the text whose note is dealt with, or all"), page: str("Instead: write it all as one page to this .html file"), json: bool("As JSON") }, [],
    (a) => [...(a.done ? ["--done", a.done] : a.notes ? ["--notes"] : a.words ? [a.words] : []), ...["in", "only", "page"].flatMap((k) => (a[k] ? [`--${k}`, String(a[k])] : [])), ...(a.all ? ["--all"] : []), ...(a.story ? ["--story"] : []), ...(a.json ? ["--json"] : [])]],
  keep: ["Keep the scene: one commit in the game folder with this name, and its tick in game.md.", { scene: str('The scene name, e.g. "1 Restyle a place"') }, ["scene"], (a) => [a.scene]],
  undo: ["Go back to the last kept scene. If there are changes not kept yet it only lists them; ask the user, then call again with yes.", { yes: bool("The user agreed to set the unkept changes aside") }, [], (a) => (a.yes ? ["--yes"] : [])],
  patch: ["Make the shareable patch: the built game as one BPS file (out/game.bps) that someone else applies to their own copy of the original game; it re-applies itself to check. With check: apply a patch to a copy of an original and compare with the built game. Never share the built game itself.",
    { original: str("The user's own original game file (default: \"original_game\" in settings.json). Ask the user; never fetch one"), check: str("Instead: an original game file to apply the patch to and compare"), file: str("The patch file (default out/game.bps)") }, [],
    (a) => ["original", "check", "file"].flatMap((k) => (a[k] ? [`--${k}`, String(a[k])] : []))],
};
const words = (s: unknown) => (typeof s === "string" ? s.trim().split(/\s+/).filter(Boolean) : []);

async function call(name: string, a: Record<string, any>) {
  const t = TOOLS[name];
  if (!t) return { isError: true, content: [{ type: "text", text: `no tool "${name}". Tools: ${Object.keys(TOOLS).join(", ")}` }] };
  const missing = t[2].filter((k) => a[k] === undefined || a[k] === "");
  if (missing.length) return { isError: true, content: [{ type: "text", text: `${name} needs: ${missing.join(", ")}` }] };
  const p = Bun.spawn([process.execPath, KIT, name, ...t[3](a)], { env: childEnv(), stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  const content: any[] = [{ type: "text", text: (out + err).trim() || (code === 0 ? "done" : `failed with code ${code}`) }];
  const png = /^(?:shot|map picture): (\S+\.png)/m.exec(out)?.[1];
  if (png && existsSync(png)) content.push({ type: "image", data: readFileSync(png).toString("base64"), mimeType: "image/png" });
  return { isError: code !== 0 && code !== 2, content }; // 2: undo is waiting for the user's yes
}

async function handle(m: any): Promise<any> {
  if (m.method === "initialize") return { protocolVersion: m.params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "rom-studio-kit", version: "0.1.0" } };
  if (m.method === "ping") return {};
  if (m.method === "tools/list") return { tools: Object.entries(TOOLS).map(([name, [description, properties, required]]) => ({ name, description, inputSchema: { type: "object", properties, required } })) };
  if (m.method === "tools/call") return call(m.params?.name, m.params?.arguments ?? {});
  throw { code: -32601, message: `method not found: ${m.method}` };
}

const send = (o: unknown) => process.stdout.write(JSON.stringify(o) + "\n");
let buf = "", queue = Promise.resolve();
for await (const chunk of Bun.stdin.stream()) {
  buf += new TextDecoder().decode(chunk);
  for (let nl; (nl = buf.indexOf("\n")) >= 0; ) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
    if (!line) continue;
    queue = queue.then(async () => { // one at a time, in order: the kit is one user, one build at a time
      let m: any; try { m = JSON.parse(line); } catch { return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "not JSON" } }); }
      if (!m || typeof m !== "object" || m.id === undefined) return; // notifications need no answer, and a line that is not a message gets none
      try { send({ jsonrpc: "2.0", id: m.id, result: await handle(m) }); }
      catch (e: any) { send({ jsonrpc: "2.0", id: m.id, error: { code: e?.code ?? -32603, message: e?.message ?? String(e) } }); }
    });
  }
}
await queue;
