#!/usr/bin/env bash
# Build the headless emulator against a static libmgba 0.10.5 (prefix: MGBA_PREFIX, default ~/.local/opt/mgba).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; MGBA="${MGBA_PREFIX:-$HOME/.local/opt/mgba}"
mkdir -p "$HERE/bin"
cc -O2 -std=gnu11 -Wall -I"$MGBA/include" "$HERE/studio-emu.c" "$MGBA/lib/libmgba.a" -lz -lm -lpthread -o "$HERE/bin/.studio-emu.new"
mv -f "$HERE/bin/.studio-emu.new" "$HERE/bin/studio-emu"; echo "built $HERE/bin/studio-emu"
