// Prints the ffmpeg select expression that drops a demo recording's cuts (see demo/captions.ts).
// The cuts are in the demo's own clock; the video's clock starts a moment apart, so the opening
// title card (a white page going dark at `syncAt`) is found in the video to line them up.
//   node scripts/demo-cuts.mjs videos/demo-X.cuts.json videos/demo-X.webm
import fs from "node:fs";
import { videoOffset } from "./demo-offset.mjs";

const [cutsFile, video] = process.argv.slice(2);
const { cuts, syncAt } = JSON.parse(fs.readFileSync(cutsFile, "utf8"));
const offset = videoOffset(video, syncAt);
process.stderr.write(`Video clock offset ${offset.toFixed(2)}s\n`);
process.stdout.write(cuts.map((c) => `between(t,${Math.max(0, c.from + offset).toFixed(2)},${(c.to + offset).toFixed(2)})`).join("+"));
