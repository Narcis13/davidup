#!/usr/bin/env bash
# Renders the v1.1 showcase. The closing "screen" plays this very film, so it
# is rendered in passes: pass 1 fills the screen with the Mandelbrot clip, and
# every later pass feeds the previous pass's ending back in (a --from/--to
# range render), one recursion level deeper each time.
#
#   examples/showcase-v1.1/render.sh [passes=6]
set -euo pipefail
cd "$(dirname "$0")"
PASSES="${1:-6}"
DAVIDUP=(bun run ../../src/cli/bin.ts)
mkdir -p output/droste

node build.mjs >/dev/null
export SHOWCASE_STATS="$(bun run stats.ts composition.json)"

prev="assets/mandelbrot.mp4"
for ((k = 1; k <= PASSES; k++)); do
  node build.mjs "$prev" droste-pass.json >/dev/null
  out="output/droste/self-$k.mp4"
  echo "── Droste pass $k/$PASSES → $out"
  "${DAVIDUP[@]}" render droste-pass.json -o "$out" --from 25.5 --to 30
  prev="$out"
done
rm -f droste-pass.json

node build.mjs "$prev" composition.json
echo "── final render"
"${DAVIDUP[@]}" render composition.json -o output/davidup-v1.1-showcase.mp4
