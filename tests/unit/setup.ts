/**
 * Each test file gets its own data dir. Files run one after another in one vitest run, and a shared
 * dir let the Guard's daily money total from earlier files push later ones past the daily cap.
 */
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

process.env.KIT_DATA_DIR = path.join(os.tmpdir(), `kit-test-data-${process.pid}-${randomUUID().slice(0, 8)}`);
