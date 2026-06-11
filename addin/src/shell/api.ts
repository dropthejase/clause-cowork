import axios from "axios";
import { GraphNode, EdgeType } from "@word-graph/shared";

const BACKEND_PORT = 8766;

export const api = axios.create({
  baseURL: `https://localhost:${BACKEND_PORT}`,
  timeout: 60_000,
});

export interface ParseResponse {
  doc_id: string;
  clauses: GraphNode[];
  new_paragraph_count: number;
  tombstoned_count: number;
}

export async function getClauses(docPath: string): Promise<ParseResponse> {
  const resp = await api.get<ParseResponse>("/clauses", { params: { doc_path: docPath } });
  return resp.data;
}

export async function patchClause(
  clauseId: string,
  docPath: string,
  patch: { clause_type?: string; add_tags?: Array<{ value: string; user_defined: boolean }>; remove_tags?: string[] }
): Promise<GraphNode> {
  const resp = await api.patch<GraphNode>(`/clauses/${clauseId}`, { ...patch, doc_path: docPath });
  return resp.data;
}

export async function addConnection(
  sourceId: string,
  targetId: string,
  edgeType: EdgeType,
  note: string | undefined,
  docPath: string
): Promise<{ connection_id: string }> {
  const resp = await api.post("/connections", {
    source_id: sourceId,
    target_id: targetId,
    edge_type: edgeType,
    note,
    doc_path: docPath,
  });
  return resp.data;
}

export async function rejectConnection(
  sourceId: string,
  connectionId: string,
  docPath: string
): Promise<void> {
  await api.delete("/connections", {
    data: { source_id: sourceId, connection_id: connectionId, doc_path: docPath },
  });
}

export async function bulkAction(
  docPath: string,
  clauseIds: string[],
  action: "reclassify" | "set_type" | "clear_type" | "add_tag" | "remove_tag" | "clear_tags",
  options?: { clause_type?: string; tag?: string }
): Promise<{ updated: number }> {
  const resp = await api.post<{ updated: number }>("/clauses/bulk", {
    doc_path: docPath, clause_ids: clauseIds, action, ...options,
  });
  return resp.data;
}

export async function hideClause(clauseId: string, docPath: string): Promise<void> {
  await api.post(`/clauses/${clauseId}/hide`, null, { params: { doc_path: docPath } });
}

export async function healthCheck(): Promise<boolean> {
  try {
    await api.get("/health", { timeout: 2_000 });
    return true;
  } catch {
    return false;
  }
}

export async function listClauseTypes(docPath: string): Promise<string[]> {
  const resp = await api.get<Array<{ tag: string }>>(`/tags/${encodeURIComponent(docPath)}`, {
    params: { kind: "clause_type" },
  });
  return resp.data.map((t) => t.tag);
}
