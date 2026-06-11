import { useState, useEffect, useCallback } from "react";
import { fetchFolderTree } from "../api";
import type { FolderTreeEntry } from "../types";

export function useWorkspace(workspacePath: string | null) {
  const [tree, setTree] = useState<FolderTreeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspacePath) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetchFolderTree(workspacePath);
      setTree(r.tree);
    } catch (e: unknown) {
      setError((e as Error).message ?? "Failed to load workspace");
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => { load(); }, [load]);

  // Poll every 15s to pick up file changes (moves, new files, deletions)
  useEffect(() => {
    if (!workspacePath) return;
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [workspacePath, load]);

  return { tree, loading, error, refresh: load };
}
