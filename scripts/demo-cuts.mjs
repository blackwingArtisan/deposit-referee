// Prints the ffmpeg select expression that drops a demo recording's cuts (see demo/captions.ts).
// The cuts are in the demo's own clock; the video's clock starts a moment apart, so the opening
// title card (a white page going dark at `syncAt`) is found in the video to line them up.
//   node scripts/demo-cuts.mjs videos/demo-X.cuts.json videos/demo-X.webm
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const [cutsFile, video] = process.argv.slice(2);
const { cuts, syncAt } = JSON.parse(fs.readFileSync(cutsFile, "utf8"));
let offset = 0;
if (typeof syncAt === "number") {
  const W = 16, H = 10, FPS = 30;
  const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-i", video, "-t", String(syncAt + 10), "-vf", `fps=${FPS},scale=${W}:${H}`, "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 1 << 26 });
  const frames = raw.length / (W * H);
  let lit = false;
  for (let i = 0; i < frames; i++) {
    const mean = raw.subarray(i * W * H, (i + 1) * W * H).reduce((a, b) => a + b, 0) / (W * H);
    if (mean > 150) lit = true;
    else if (lit && mean < 128) {
      offset = i / FPS - syncAt;
      break;
    }
  }
}
process.stderr.write(`Video clock offset ${offset.toFixed(2)}s\n`);
process.stdout.write(cuts.map((c) => `between(t,${Math.max(0, c.from + offset).toFixed(2)},${(c.to + offset).toFixed(2)})`).join("+"));
