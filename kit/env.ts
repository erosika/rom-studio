// kit/env.ts: the environment handed to every program this toolkit starts. A short list by name, never the
// host's own environment: that one holds the agent's provider keys, and a game folder's Makefile is other people's code.
const KEEP = /^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LANGUAGE|LC_[A-Z_]+|TZ|TERM|TMPDIR|XDG_RUNTIME_DIR|HERMES_HOME|ARM_GCC|MGBA_PREFIX|SCRIPT_TOOL|JOBS|GAME_DIR|GAME|ROM|SYM|PORT|REDRAW_BASE|ROM_STUDIO_[A-Z0-9_]+)$/;

/** The variables a child may see: the kept names from `from`, then `extra` (an undefined value removes a name). */
export function childEnv(extra: Record<string, string | undefined> = {}, from: Record<string, string | undefined> = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(from)) if (v !== undefined && KEEP.test(k)) out[k] = v;
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete out[k]; else out[k] = v;
  return out;
}
