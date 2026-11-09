// Where the video's clock starts against the demo's own clock (demo/captions.ts). The demo marks
// the opening title card (a white page going dark) at `syncAt`; finding it in the video gives the
// offset: video seconds = demo seconds + offset. Used by demo-cuts.mjs and the demo's voiceover.
import { execFileSync } from "node:child_process";

export function videoOffset(video, syncAt) {
  if (typeof syncAt !== "number") return 0;
  const W = 16, H = 10, FPS = 30;
  const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-i", video, "-t", String(syncAt + 10), "-vf", `fps=${FPS},scale=${W}:${H}`, "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 1 << 26 });
  const frames = raw.length / (W * H);
  let lit = false;
  for (let i = 0; i < frames; i++) {
    const mean = raw.subarray(i * W * H, (i + 1) * W * H).reduce((a, b) => a + b, 0) / (W * H);
    if (mean > 150) lit = true;
    else if (lit && mean < 128) return i / FPS - syncAt;
  }
  return 0;
}
