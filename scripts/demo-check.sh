#!/usr/bin/env bash
# Checks the edited demo: makes the MP4 from the newest recording and its edit list
# (npm run demo:mp4) if it isn't there yet, then checks that file: 1920x1080, under 2:00, and no
# grey bars (the frame's edges are the page, not padding). npm run demo:check [file.webm]
set -euo pipefail
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
LIMIT_SECONDS=120
RAW="${1:-$(ls -t videos/demo-*.webm 2>/dev/null | head -1)}"
[ -n "$RAW" ] && [ -f "$RAW" ] || { echo "No recording found." >&2; exit 1; }
IN="${RAW%.*}.mp4"
[ -f "$IN" ] && [ "$IN" -nt "$RAW" ] || bash "$(dirname "$0")/webm-to-mp4.sh" "$RAW" "$IN"
[ -f "${RAW%.*}.cuts.json" ] || { echo "No edit list beside $RAW: the check needs the edited cut." >&2; exit 1; }
SIZE="$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$IN")"
SECONDS_LONG="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")"
# The grey padding is a flat #808080-ish block on the right and bottom; sample the corner region.
CORNER="$(ffmpeg -hide_banner -loglevel error -ss 20 -i "$IN" -frames:v 1 -vf "crop=200:200:1720:700,format=gray,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" -f null - | grep -o 'YAVG=[0-9.]*' | head -1 | cut -d= -f2)"
SPREAD="$(ffmpeg -hide_banner -loglevel error -ss 20 -i "$IN" -frames:v 1 -vf "crop=200:200:1720:700,format=gray,signalstats,metadata=print:key=lavfi.signalstats.YDIF:file=-" -f null - | grep -o 'YDIF=[0-9.]*' | head -1 | cut -d= -f2)"
echo "$IN (edited): ${SIZE}, ${SECONDS_LONG}s, bottom-right corner luma ${CORNER} (page white is ~235+, recorder grey ~128)"
[ "$SIZE" = "1920x1080" ] || { echo "Not 1920x1080." >&2; exit 1; }
awk -v s="$SECONDS_LONG" -v max="$LIMIT_SECONDS" 'BEGIN { exit !(s < max) }' || { echo "Too long: limit is 2:00." >&2; exit 1; }
awk -v y="$CORNER" 'BEGIN { exit !(y < 110 || y > 150) }' || { echo "The corner looks like grey padding." >&2; exit 1; }
echo "ok (corner YDIF ${SPREAD:-n/a})"
