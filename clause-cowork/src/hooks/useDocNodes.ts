import { useState, useEffect } from "react";
import { fetchClauses } from "../api";
import type { GraphNode } from "@word-graph/shared";

export function useDocNodes(docPath: string | null, workspacePath: string | null) {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!docPath || !workspacePath) { setNodes([]); return; }
    setLoading(true);
    setError(null);
    fetchClauses(docPath, workspacePath)
      .then((r) => setNodes(r.clauses))
      .catch((e: Error) => setError(e.message ?? "Failed to load clauses"))
      .finally(() => setLoading(false));
  }, [docPath, workspacePath]);

  return { nodes, loading, error };
}
