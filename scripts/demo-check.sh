#!/usr/bin/env bash
# Checks a demo recording: 1920x1080, under 2:30, and no grey bars (the frame's edges are the
# page, not padding). npm run demo:check [file.webm]
set -euo pipefail
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
IN="${1:-$(ls -t videos/demo-*.webm 2>/dev/null | head -1)}"
[ -n "$IN" ] && [ -f "$IN" ] || { echo "No recording found." >&2; exit 1; }
SIZE="$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$IN")"
# webm from the recorder has no duration header, so count it by decoding.
SECONDS_LONG="$(ffmpeg -hide_banner -i "$IN" -f null - 2>&1 | grep -o 'time=[0-9:.]*' | tail -1 | cut -d= -f2 | awk -F: '{ print $1 * 3600 + $2 * 60 + $3 }')"
# The grey padding is a flat #808080-ish block on the right and bottom; sample the corner region.
CORNER="$(ffmpeg -hide_banner -loglevel error -ss 20 -i "$IN" -frames:v 1 -vf "crop=200:200:1720:700,format=gray,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" -f null - | grep -o 'YAVG=[0-9.]*' | head -1 | cut -d= -f2)"
SPREAD="$(ffmpeg -hide_banner -loglevel error -ss 20 -i "$IN" -frames:v 1 -vf "crop=200:200:1720:700,format=gray,signalstats,metadata=print:key=lavfi.signalstats.YDIF:file=-" -f null - | grep -o 'YDIF=[0-9.]*' | head -1 | cut -d= -f2)"
echo "$IN: ${SIZE}, ${SECONDS_LONG}s, bottom-right corner luma ${CORNER} (page white is ~235+, recorder grey ~128)"
[ "$SIZE" = "1920x1080" ] || { echo "Not 1920x1080." >&2; exit 1; }
awk -v s="$SECONDS_LONG" 'BEGIN { exit !(s < 150) }' || { echo "Too long: limit is 2:30." >&2; exit 1; }
awk -v y="$CORNER" 'BEGIN { exit !(y < 110 || y > 150) }' || { echo "The corner looks like grey padding." >&2; exit 1; }
echo "ok (corner YDIF ${SPREAD:-n/a})"
