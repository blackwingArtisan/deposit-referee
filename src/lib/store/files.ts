/**
 * Tiny local persistence for hackathon demos: JSON snapshots and append-only JSONL logs
 * under the data dir (default `.data/`, gitignored). On Render the disk is ephemeral, so
 * treat this as a cache that survives restarts locally, not a database.
 */
import fs from "node:fs";
import path from "node:path";
import { getEnv } from "../env";

export function dataPath(...parts: string[]): string {
  return path.join(getEnv().dataDir, ...parts);
}

function ensureDir(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

export function readJsonFile<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Write via temp file + rename so a crash never leaves half a file behind. */
export function writeJsonFile(file: string, data: unknown) {
  ensureDir(file);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function appendJsonLine(file: string, record: unknown) {
  ensureDir(file);
  fs.appendFileSync(file, JSON.stringify(record) + "\n");
}

export function readJsonLines<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export function fileMtimeMs(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}
