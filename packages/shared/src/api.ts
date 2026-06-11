import axios from "axios";
import { GraphNode, EdgeType } from "./components/WordGraphPanel/types";

const BACKEND_PORT = 8765;
const BACKEND_BASE = `http://localhost:${BACKEND_PORT}`;

export const api = axios.create({
  baseURL: BACKEND_BASE,
  timeout: 600_000,  // 10 min — enrichment on large contracts can take several minutes
});

export interface ParseResponse {
  doc_id: string;
  clauses: GraphNode[];
  new_paragraph_count: number;
  tombstoned_count: number;
}

export interface WorkspaceConfig {
  connection_threshold_prompt?: string;
  re_enrich_threshold: number;
  strict_clause_types: boolean;
  strict_clause_tags: boolean;
  strict_doc_types: boolean;
  strict_doc_tags: boolean;
}

export async function getClauses(docPath: string, workspacePath: string): Promise<ParseResponse> {
  const resp = await api.get<ParseResponse>("/clauses", { params: { doc_path: docPath, workspace_path: workspacePath } });
  return resp.data;
}

export async function patchClause(
  clauseId: string,
  docPath: string,
  workspacePath: string,
  patch: { clause_type?: string; add_tags?: Array<{ value: string; user_defined: boolean }>; remove_tags?: string[] }
): Promise<GraphNode> {
  const resp = await api.patch<GraphNode>(`/clauses/${clauseId}`, { ...patch, doc_path: docPath, workspace_path: workspacePath });
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
  workspacePath: string,
  clauseIds: string[],
  action: "reclassify" | "set_type" | "clear_type" | "add_tag" | "remove_tag" | "clear_tags",
  options?: { clause_type?: string; tag?: string }
): Promise<{ updated: number }> {
  const resp = await api.post<{ updated: number }>("/clauses/bulk", {
    doc_path: docPath, workspace_path: workspacePath, clause_ids: clauseIds, action, ...options,
  });
  return resp.data;
}

export async function hideClause(clauseId: string, docPath: string, workspacePath: string): Promise<void> {
  await api.post(`/clauses/${clauseId}/hide`, { doc_path: docPath, workspace_path: workspacePath });
}


export async function healthCheck(): Promise<boolean> {
  try {
    await api.get("/health", { timeout: 2_000 });
    return true;
  } catch {
    return false;
  }
}

export async function cancelEnrichment(docPath: string): Promise<void> {
  await api.delete(`/parse/stream/${encodeURIComponent(docPath)}`, { timeout: 3000 });
}

export async function getEnrichmentStatus(docPath: string): Promise<{ enriching: boolean }> {
  const resp = await api.get<{ enriching: boolean }>(`/parse/status/${encodeURIComponent(docPath)}`);
  return resp.data;
}

export type EnrichmentEvent =
  | { event: "clause_classified"; stable_id: string; clause_type: string | null; clause_tags: string[] }
  | { event: "connection_found"; source_id: string; target_id: string; edge_type: string; note: string | null }
  | { event: "section_assigned"; stable_id: string; section: string }
  | { event: "status"; message: string }
  | { event: "done" }
  | { event: "error"; message: string };

export async function streamEnrichment(
  docPath: string,
  onEvent: (event: EnrichmentEvent) => void,
): Promise<void> {
  const resp = await fetch(`${BACKEND_BASE}/parse/stream/${encodeURIComponent(docPath)}`);
  if (!resp.ok || !resp.body) throw new Error(`Stream request failed: ${resp.status}`);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const event = JSON.parse(line.slice(6)) as EnrichmentEvent;
        onEvent(event);
        if (event.event === "done") return;
        if (event.event === "error") throw new Error(event.message);
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
}

export type TagKind = "clause_type" | "clause_tag" | "doc_type" | "doc_tag";

export interface PoolTag {
  tag: string;
  description: string;
  source: "import" | "agent" | "manual" | "default";
  created_at: string;
  kind: TagKind;
}

export interface ImportResult {
  imported: number;
  errors: string[];
}

export async function listTags(docPath: string, kind: TagKind = "clause_tag"): Promise<PoolTag[]> {
  const resp = await api.get<PoolTag[]>(`/tags/${encodeURIComponent(docPath)}?kind=${kind}`);
  return resp.data;
}

export async function addTag(docPath: string, tag: string, description: string, source: "manual" | "agent" = "manual", kind: TagKind = "clause_tag"): Promise<PoolTag> {
  const resp = await api.post<PoolTag>(`/tags/${encodeURIComponent(docPath)}`, { tag, description, source, kind });
  return resp.data;
}

export async function updateTag(docPath: string, tag: string, description: string): Promise<void> {
  await api.patch(`/tags/${encodeURIComponent(docPath)}`, { tag, description });
}

export async function deleteTag(docPath: string, tag: string): Promise<void> {
  await api.delete(`/tags/${encodeURIComponent(docPath)}`, { data: { tag } });
}

export async function importTags(docPath: string, csvContent: string, kind: TagKind = "clause_tag"): Promise<ImportResult> {
  const resp = await api.post<ImportResult>(`/tags/${encodeURIComponent(docPath)}/import`, { csv_content: csvContent, kind });
  return resp.data;
}

export async function exportTags(docPath: string, kind: TagKind = "clause_tag"): Promise<{ path: string }> {
  const resp = await api.get<{ path: string }>(`/tags/${encodeURIComponent(docPath)}/export?kind=${kind}`);
  return resp.data;
}
