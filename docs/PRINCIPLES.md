# Principles

The rules ROM Studio keeps. Each exists because breaking it once cost more than keeping it.
They outrank any contributor's sense of thoroughness.

1. **Scene-pull.** Nothing is built until a scene on the skill's ladder needs it. No feature,
   helper or check arrives early "because it will be needed".
2. **Direct edits.** The agent changes the decomp's source. No second format, no apply step, no
   generated copy of the truth. The game folder is a git repo: one commit per kept scene, revert
   is undo.
3. **Every step ends in a picture.** Done means: it built, the agent walked to it in the running
   game, and the picture shows it. Anything less is reported as not done or not tested.
4. **The user signs off, not the builder.** A scene is finished when the user has tried it and
   said keep.
5. **Checks cost less than the work.** A check that takes longer than the change it checks is
   removed. No provenance records, release directories, rollbacks, ledgers or multi-user handling.
   Never build a checker that judges the user's art or layout.
6. **Two minutes.** A small change reaches the user's screen in about two minutes. Slower is a
   defect in the kit.
7. **Small.** The kit, the pane and the player stay small enough to read in a sitting. A command
   that needs a lot of code is a command to question. Going well over what a part is today
   (kit about 2,300 lines of TypeScript and 1,700 of Python, pane about 1,500, player about 650) needs a reason in
   the commit message.
8. **The pane shows; it does not edit.** No map, people or scene editors. The user changes the
   game by saying so, or by marking an entry "needs work" with a note.
9. **Art is the user's direction.** Ask; do not propose a style. A rejected picture changes the
   approach, never adds a checker.
10. **Calm, in two places.** The base's calm changes are in the game, and the flash guard runs in
    every surface that shows the game, always on, with no switch. Nothing in the pane animates on
    its own. The guard is tested before anything else in the player.
11. **The save survives.** A build never breaks or deletes the user's save without saying so
    first. Saves store maps by number, so new maps are appended in a new group, and maps, people
    and doors are never reordered or deleted once a save exists.
12. **Built games are personal.** A built game contains the original game's art and music: never
    committed, never uploaded, never distributed. Sharing is a patch.
13. **Plain reporting.** Say what was done, what was not, and what was not tested. "Proven",
    "landed" and "passed" are not used for anything nobody has seen run. If a step failed, say so
    with the error.
14. **Neutral.** The product is ROM Studio. Nothing it ships (its name, skills, kit output, pane,
    player, README, examples, tests, commit messages) names a franchise, a game, an engine, a
    creature, a character or a place from one, or a person. Say "the engine", "the original
    game", "creatures". Identifiers inside the engine's own source are left as they are in the
    user's game folder: they are not ours to rename, and they never appear in what a user reads.
    The optional base, which is patches against one engine's source, is not shipped here. A tool
    is named only where it is fetched or run.
15. **Bring your own decomp.** The kit names no engine and fetches none. The user supplies the
    decomp and their own copy of the original game file.
16. **Ask before going wide.** Pushing, publishing, deploying, or touching anything outside the
    game folder and this repository needs the owner's explicit yes each time.
17. **Docs stay small.** `README.md` for a user, `AGENTS.md` for a contributor, `docs/STUDIO.md`
    for the contracts, this page for the rules. New knowledge goes into a skill reference if the
    skill needs it. No plan, status or evidence documents.
