import { useState, useEffect, useCallback, useRef } from "react";
import { PoolTag, listTags } from "@word-graph/shared";

const REFRESH_INTERVAL_MS = 30_000;

export function useTagPool(docPath: string) {
  const [tags, setTags] = useState<PoolTag[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [syncing, setSyncing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sync = useCallback(async () => {
    if (!docPath) return;
    setSyncing(true);
    try {
      const result = await listTags(docPath);
      setTags(result);
      setLastSyncedAt(new Date());
    } catch {
      // silent — stale pool is better than crashing
    } finally {
      setSyncing(false);
    }
  }, [docPath]);

  // Load on mount and when docPath changes
  useEffect(() => {
    sync();
  }, [sync]);

  // Periodic background refresh
  useEffect(() => {
    if (!docPath) return;
    intervalRef.current = setInterval(sync, REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [docPath, sync]);

  return { tags, lastSyncedAt, syncing, sync };
}
