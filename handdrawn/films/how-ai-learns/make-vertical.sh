#!/bin/bash
# The vertical cut (1080x1920, for phones and social feeds): the 16:9 master laid into the window of the
# vertical page (vertical.js), with the master's sound. Render both first:
#   hdf render films/how-ai-learns/vertical.js --no-sound     # out/how-ai-learns-vertical.mp4, the page
#   out/how-ai-learns-master.mp4                              # the finished 16:9 film (-16 LUFS)
# Writes out/how-ai-learns-9x16.mp4.
set -e
cd "$(dirname "$0")/../.."
read -r X Y W H < <(node -e "import('./films/how-ai-learns/vertical.js').then(({ WINDOW: w }) => console.log(w.x, w.y, w.w, w.h))")
ffmpeg -y -loglevel error -i out/how-ai-learns-vertical.mp4 -i out/how-ai-learns-master.mp4 \
  -filter_complex "[1:v]scale=$W:$H:flags=lanczos,fps=24[m];[0:v]fps=24[p];[p][m]overlay=$X:$Y:shortest=1,format=yuv420p[v]" \
  -map '[v]' -map 1:a -c:v libx264 -preset slow -crf 19 -c:a copy -movflags +faststart out/how-ai-learns-9x16.mp4
ffprobe -v error -show_entries stream=codec_type,width,height:format=duration -of compact out/how-ai-learns-9x16.mp4
