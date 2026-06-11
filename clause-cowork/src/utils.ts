import type { FolderTreeEntry, FolderTreeFile } from "./types";

export function flattenFiles(entries: FolderTreeEntry[]): FolderTreeFile[] {
  const out: FolderTreeFile[] = [];
  for (const e of entries) {
    if (e.type === "file") out.push(e);
    else out.push(...flattenFiles(e.children));
  }
  return out;
}
