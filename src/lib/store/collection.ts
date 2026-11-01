/**
 * A JSON-file backed collection for app data (customers, products, jobs...).
 *
 *   const customers = collection<Customer>("customers");
 *   customers.upsert({ id: "c_1", name: "Ada" });
 *   customers.list();
 *
 * Reads re-load from disk when the file changed (e.g. after `npm run seed`).
 */
import { dataPath, fileMtimeMs, readJsonFile, writeJsonFile } from "./files";
import { singleton } from "../singleton";

export interface Collection<T extends { id: string }> {
  list(): T[];
  get(id: string): T | undefined;
  upsert(item: T): T;
  remove(id: string): boolean;
  replaceAll(items: T[]): void;
  clear(): void;
}

export function collection<T extends { id: string }>(name: string): Collection<T> {
  if (!/^[a-z0-9-_]+$/i.test(name)) throw new Error(`Invalid collection name: ${name}`);
  return singleton(`collection:${name}`, () => {
    const file = dataPath("collections", `${name}.json`);
    let items = new Map<string, T>();
    let mtime = -1;

    const sync = () => {
      const current = fileMtimeMs(file);
      if (current !== mtime) {
        items = new Map(readJsonFile<T[]>(file, []).map((i) => [i.id, i]));
        mtime = current;
      }
    };
    const save = () => {
      writeJsonFile(file, [...items.values()]);
      mtime = fileMtimeMs(file);
    };

    return {
      list() {
        sync();
        return [...items.values()];
      },
      get(id) {
        sync();
        return items.get(id);
      },
      upsert(item) {
        sync();
        items.set(item.id, item);
        save();
        return item;
      },
      remove(id) {
        sync();
        const had = items.delete(id);
        if (had) save();
        return had;
      },
      replaceAll(next) {
        items = new Map(next.map((i) => [i.id, i]));
        save();
      },
      clear() {
        items = new Map();
        save();
      },
    };
  });
}
