#!/usr/bin/env bash
# kit/build.sh [game-dir]: incremental build, one at a time. Regenerates every map script whose source is
# newer than its generated file, runs make, prints OK + seconds or the first real error with file and line.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
SRC="${1:-${ROM_STUDIO_GAME:-${GAME_DIR:-$ROOT/../rom-studio-game}}}"; OUT="$SRC/out"; LOG="$OUT/build.log"
GCC="${ARM_GCC:-$HOME/.local/opt/arm-gnu-14.2}"
export PATH="$GCC/bin:$HOME/.local/opt/pkgconfig-shim/bin:$PATH"
unset DEVKITARM DEVKITPRO TOOLCHAIN || true
command -v arm-none-eabi-gcc >/dev/null || { echo "no arm-none-eabi-gcc: set ARM_GCC to the compiler's folder (kit status says how to get it)"; exit 1; }
[ -f "$SRC/Makefile" ] || { echo "no game folder at $SRC. Run: kit setup"; exit 1; }
mkdir -p "$OUT"; exec 9>"$OUT/.build.lock"
if ! flock -n 9; then # a caller that wrapped us in `flock <game>/out/.build.lock kit build` already holds it: waiting would never end
  p=$PPID; own=0
  while [ "${p:-1}" -gt 1 ]; do
    if tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -q '^flock .*\.build\.lock'; then own=1; break; fi
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
  done
  [ "$own" = 1 ] || flock -w 1200 9 || { echo "another build held the lock for 20 minutes"; exit 1; }
fi
start=$(date +%s)
fail() { echo "FAILED $(( $(date +%s) - start ))s" > "$OUT/.last-build"; exit 1; }
# map scripts: <name>.pory is the source, <name>.inc beside it is generated
P="${SCRIPT_TOOL:-}"; for d in "$HOME"/.local/opt/poryscript-* "$ROOT/kit/.cache/poryscript"; do [ -z "$P" ] && [ -x "$d/poryscript" ] && P="$d"; done
while IFS= read -r s; do
  o="${s%.pory}.inc"; [ "$s" -nt "$o" ] || continue
  [ -n "$P" ] || { echo "BUILD FAILED: ${s#"$SRC"/} changed but the script compiler is not installed. Run: kit setup"; fail; }
  if ! err=$("$P/poryscript" -i "$s" -o "$o" -fc "$P/font_config.json" -cc "$P/command_config.json" -lm=false 2>&1); then
    echo "BUILD FAILED in ${s#"$SRC"/}:"; echo "$err" | sed "s/^[A-Z]* ERROR/script error/" | head -6; fail
  fi
  echo "script regenerated: ${o#"$SRC"/}"
done < <(find "$SRC/data" -name '*.pory')
if ! make -C "$SRC" -j"${JOBS:-$(nproc)}" >"$LOG" 2>&1; then
  echo "BUILD FAILED (full log: $LOG)"
  grep -m1 -A4 -E '^[^ :]+:[0-9]+(:[0-9]+)?: (fatal error|error|Error)' "$LOG" \
    || grep -E 'undefined reference|multiple definition|No rule to make|rror' "$LOG" | grep -v -m5 '^make' || tail -20 "$LOG"
  fail
fi
ROM="$(ls -t "$SRC"/*.gba 2>/dev/null | head -1)"; [ -n "$ROM" ] || { echo "BUILD FAILED: make finished but left no .gba in $SRC"; fail; }
cp "$ROM" "$OUT/.game.gba.tmp" && mv "$OUT/.game.gba.tmp" "$OUT/game.gba"
arm-none-eabi-nm -n -S "${ROM%.gba}.elf" > "$OUT/.game.sym.tmp" && mv "$OUT/.game.sym.tmp" "$OUT/game.sym"
echo "OK $(( $(date +%s) - start ))s" > "$OUT/.last-build"
echo "OK $(( $(date +%s) - start ))s  $OUT/game.gba"
