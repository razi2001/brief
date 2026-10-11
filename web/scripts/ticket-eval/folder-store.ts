import { readFile, readdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import type { BriefStore } from "../../lib/agent/brief-store";

/** A BriefStore over a folder: "<root>/<prefix>/brief.json". A "<file>.gz" stands in for "<file>". */
export function folderStore(root: string): BriefStore {
  return {
    async download(p) {
      const file = path.join(root, p);
      try {
        return await readFile(file);
      } catch {
        /* try the gzipped copy */
      }
      try {
        return gunzipSync(await readFile(file + ".gz"));
      } catch {
        return null;
      }
    },
    async list(dir) {
      try {
        return (await readdir(path.join(root, dir))).map((n) => n.replace(/\.gz$/, ""));
      } catch {
        return [];
      }
    },
  };
}
