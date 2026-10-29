/**
 * Node helpers for the course index, used by the MCP server and the smoke script.
 * The Obsidian plugin does not import this file; it reads files through the vault API instead.
 */

import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { CourseFile, CourseIndexData, IndexStore } from "./index";

/** Save the index as one JSON file. A missing or broken file loads as an empty index. */
export function jsonFileStore(path: string): IndexStore {
  return {
    async load() {
      try {
        return JSON.parse(await readFile(path, "utf8")) as CourseIndexData;
      } catch {
        return null;
      }
    },
    async save(data) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(data));
    },
  };
}

/** Every markdown file under `dir`, skipping hidden folders such as .obsidian. */
export async function readCourseFolder(dir: string): Promise<CourseFile[]> {
  const out: CourseFile[] = [];
  const walk = async (folder: string) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join(folder, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.toLowerCase().endsWith(".md")) {
        const { mtimeMs } = await stat(full);
        out.push({ path: relative(dir, full).split(sep).join("/"), mtime: Math.floor(mtimeMs), read: () => readFile(full, "utf8") });
      }
    }
  };
  await walk(dir);
  return out;
}
