#!/bin/bash
# The film's voices: edge-tts neural voices (online), converted to 22.05 kHz mono 16-bit wav.
# N narrator en-US-AvaNeural; F the fox en-GB-RyanNeural; B Bit en-US-AnaNeural through a small tinny speaker.
# Writes out/how-ai-learns-voice/<id>.wav (EDGE_TTS: the edge-tts binary; ONLY=id,id: just those lines), then
# hdf import out/how-ai-learns-voice/<id>.wav --name <id> and hdf align <id> put a line in the store.
set -e
cd "$(dirname "$0")"
V=../../out/how-ai-learns-voice
mkdir -p "$V"
while IFS=$'\t' read -r id who text; do
  [ -z "$id" ] && continue
  [ -n "$ONLY" ] && [[ ",$ONLY," != *",$id,"* ]] && continue
  case $who in
    N) v=en-US-AvaNeural; rate=-6%; pitch=+0Hz; fx="anull";;
    F) v=en-GB-RyanNeural; rate=-8%; pitch=-2Hz; fx="anull";;
    B) v=en-US-AnaNeural; rate=+0%; pitch=+10Hz; fx="highpass=f=220,lowpass=f=6500,aecho=0.8:0.6:7:0.32,volume=1.15";;
  esac
  "${EDGE_TTS:-edge-tts}" --voice "$v" --rate="$rate" --pitch="$pitch" --text "$text" --write-media "$V/$id.mp3" 2>/dev/null
  ffmpeg -y -loglevel error -i "$V/$id.mp3" -af "$fx,silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,adelay=60,apad=pad_dur=0.12" -ac 1 -ar 22050 -sample_fmt s16 "$V/$id.wav"
  printf '%-12s %s  %s\n' "$id" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$V/$id.wav")" "$text"
done < lines.tsv
