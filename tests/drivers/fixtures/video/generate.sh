#!/usr/bin/env bash
# Regenerate the committed video fixtures for the §S6 register_asset tests.
#
# These are intentionally tiny (solid colours / synthetic patterns compress to
# a few KB) but carry the metadata each test asserts on:
#
#   small.mp4    320x240   h264  yuv420p   1s @ 30fps  — clean baseline
#   uhd-4k.mp4   3840x2160 h264  yuv420p   1s @ 24fps  — triggers the >=4K warning
#   long.mp4     128x72    h264  yuv420p  61s @ 10fps  — triggers the >60s warning
#   alpha.webm   160x120   vp9   yuv420p   1s @ 24fps  — alpha_mode=1 (hasAlpha)
#
# WebM VP8/VP9 alpha is stored out-of-band in the `alpha_mode` stream tag, NOT
# the pixel format (which stays yuv420p) — probeVideo checks both.
#
# Uses the bundled ffmpeg-static binary so it works without a system ffmpeg.
set -euo pipefail

FF="$(node -p "require('ffmpeg-static')")"
OUT="$(cd "$(dirname "$0")" && pwd)"

"$FF" -y -hide_banner -loglevel error -f lavfi \
  -i "testsrc2=size=320x240:rate=30:duration=1" \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p "$OUT/small.mp4"

"$FF" -y -hide_banner -loglevel error -f lavfi \
  -i "color=c=teal:size=3840x2160:rate=24:duration=1" \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p "$OUT/uhd-4k.mp4"

"$FF" -y -hide_banner -loglevel error -f lavfi \
  -i "color=c=navy:size=128x72:rate=10:duration=61" \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p -g 100 "$OUT/long.mp4"

"$FF" -y -hide_banner -loglevel error -f lavfi \
  -i "color=c=green:s=160x120:r=24:d=1,format=yuva420p,geq=a='if(gt(X,W/2),255,64)':r='r(X,Y)':g='g(X,Y)':b='b(X,Y)'" \
  -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 "$OUT/alpha.webm"

echo "Generated fixtures in $OUT"
