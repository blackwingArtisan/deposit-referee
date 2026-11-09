#!/usr/bin/env bash
# Turn a demo recording into an MP4 ready for YouTube. The captions are already in the
# picture, so this applies the recording's edit list (<name>.cuts.json, written by the demo:
# waits, spinners, skeletons and page loads), re-encodes, adds a silent audio track and checks
# the length.
#
#   npm run demo:mp4                          # newest videos/demo-*.webm -> same name .mp4
#   npm run demo:mp4 -- in.webm out.mp4
#
# Fails if the edited result is 2:00 or longer. Needs ffmpeg + ffprobe
# (brew install ffmpeg); set FFMPEG_DIR if they aren't on PATH or in Homebrew's folder.
set -euo pipefail

export PATH="${FFMPEG_DIR:+$FFMPEG_DIR:}$PATH:/opt/homebrew/bin:/usr/local/bin"
LIMIT_SECONDS=120

command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null || {
  echo "ffmpeg not found. Install it (brew install ffmpeg) or set FFMPEG_DIR." >&2
  exit 1
}

IN="${1:-$(ls -t videos/demo-*.webm 2>/dev/null | head -1)}"
[ -n "$IN" ] && [ -f "$IN" ] || { echo "No recording found. Run npm run demo:record first, or pass a file." >&2; exit 1; }
OUT="${2:-${IN%.*}.mp4}"
CUTS="${CUTS:-${IN%.*}.cuts.json}"

# Each cut is a raw-seconds span; keep every frame outside them. Frames are made constant 30 fps
# first, so the kept frames can be re-timed back to back.
KEEP=""
if [ -f "$CUTS" ]; then
  EXPR="$(node "$(dirname "$0")/demo-cuts.mjs" "$CUTS" "$IN")"
  [ -n "$EXPR" ] && KEEP="select='not(${EXPR})',setpts=N/30/TB,"
  echo "Applying $(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).cuts.length))' "$CUTS") cuts from $CUTS"
else
  echo "No edit list ($CUTS): converting the raw recording uncut." >&2
fi

# H.264 + yuv420p + AAC + faststart is what YouTube recommends. Constant 30 fps because the
# recorder's frame timing varies. -map_metadata -1 drops local file details from the output.
ffmpeg -y -hide_banner -loglevel error \
  -i "$IN" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 \
  -map 0:v:0 -map 1:a:0 -shortest -map_metadata -1 \
  -vf "fps=30,${KEEP}scale=trunc(iw/2)*2:trunc(ih/2)*2" \
  -c:v libx264 -preset slow -crf 18 -profile:v high -pix_fmt yuv420p \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  "$OUT"

SECONDS_LONG="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")"
SIZE="$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$OUT")"
echo "$OUT: ${SECONDS_LONG}s, $SIZE, $(du -h "$OUT" | cut -f1)"
if ! awk -v s="$SECONDS_LONG" -v max="$LIMIT_SECONDS" 'BEGIN { exit !(s < max) }'; then
  echo "Too long: limit is ${LIMIT_SECONDS}s. Cut scenes or shorten captions in demo/demo.spec.ts." >&2
  exit 1
fi
