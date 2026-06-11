import axios from "axios";
import type {
  WorkspaceResponse,
  FolderTreeResponse,
  ClausesResponse,
  WorkspaceConfig,
} from "./types";

const BACKEND_PORT = 8765;

export const api = axios.create({
  baseURL: `http://localhost:${BACKEND_PORT}`,
  timeout: 30_000,
});

export async function fetchWorkspace(workspacePath: string): Promise<WorkspaceResponse> {
  const { data } = await api.get<WorkspaceResponse>("/workspace", {
    params: { workspace_path: workspacePath },
  });
  return data;
}

export async function fetchFolderTree(workspacePath: string): Promise<FolderTreeResponse> {
  const { data } = await api.get<FolderTreeResponse>("/workspace/folder-tree", {
    params: { workspace_path: workspacePath },
  });
  return data;
}

export async function fetchClauses(docPath: string, workspacePath: string): Promise<ClausesResponse> {
  const { data } = await api.get<ClausesResponse>("/clauses", { params: { doc_path: docPath, workspace_path: workspacePath } });
  return data;
}

export async function fetchDocxBlob(docPath: string): Promise<Blob> {
  const { data } = await api.get<Blob>("/workspace/file", {
    params: { path: docPath },
    responseType: "blob",
  });
  return data;
}

export async function fetchFileText(docPath: string): Promise<string> {
  const { data } = await api.get<string>("/workspace/file", {
    params: { path: docPath },
    responseType: "text",
  });
  return data;
}

export function filePreviewUrl(docPath: string): string {
  return `http://localhost:${BACKEND_PORT}/workspace/file?path=${encodeURIComponent(docPath)}`;
}

export async function getWorkspaceConfig(workspacePath: string): Promise<WorkspaceConfig> {
  const { data } = await api.get<WorkspaceConfig>("/config", { params: { workspace_path: workspacePath } });
  return data;
}

export async function saveWorkspaceConfig(workspacePath: string, config: WorkspaceConfig): Promise<WorkspaceConfig> {
  const { data } = await api.put<WorkspaceConfig>("/config", config, { params: { workspace_path: workspacePath } });
  return data;
}


export interface FsEntry { name: string; path: string; }
export interface FsListing { path: string; parent: string | null; entries: FsEntry[]; home?: string; }

export async function listDirectory(path?: string): Promise<FsListing> {
  const { data } = await api.get<FsListing>("/fs/ls", { params: path ? { path } : {} });
  return data;
}

export async function parseDocument(docPath: string): Promise<void> {
  await api.post("/parse", { doc_path: docPath }, { timeout: 120_000 });
}

export async function getAgentConfig(): Promise<{ acp_bin: string }> {
  const { data } = await api.get<{ acp_bin: string }>("/chat/agent-config");
  return data;
}

export async function saveAgentConfig(acpBin: string, workspace?: string): Promise<void> {
  await api.put("/chat/agent-config", { acp_bin: acpBin, ...(workspace ? { workspace } : {}) });
}

export async function testAgentConfig(acpBin: string, workspace?: string): Promise<{ ok: boolean; agent: string; version: string }> {
  const { data } = await api.post<{ ok: boolean; agent: string; version: string }>("/chat/agent-config/test", {
    acp_bin: acpBin,
    ...(workspace ? { workspace } : {}),
  });
  return data;
}

export async function installSkills(acpBin: string, workspace: string): Promise<void> {
  await api.post("/chat/install-skills", { acp_bin: acpBin, workspace });
}

export async function setModel(workspace: string, modelId: string): Promise<{ current_model: string }> {
  const { data } = await api.post<{ current_model: string }>("/chat/set-model", { workspace, model_id: modelId });
  return data;
}

// --- Document metadata & links ---

export interface DocumentMeta {
  doc_id: string;
  path: string;
  filename: string;
  extension: string;
  file_size: number | null;
  file_mtime: number | null;
  last_analysed_at: string | null;
  doc_type: string | null;
  doc_tags: string[];
  notes: string;
  default_tag_vocabulary: string[];
  clause_tags: string[];
}

export interface DocumentLink {
  id: string;
  source_doc_id: string;
  target_doc_id: string;
  other_doc_id: string;
  other_filename: string;
  relationship: string;
  note: string | null;
  created_by: string;
  created_at: string;
  broken_at: string | null;
  direction: "outbound" | "inbound";
}

export async function getDocumentMeta(workspacePath: string, docId: string, docPath?: string): Promise<DocumentMeta> {
  const { data } = await api.get<DocumentMeta>("/document-meta", {
    params: { workspace_path: workspacePath, doc_id: docId, doc_path: docPath },
  });
  return data;
}

export async function patchDocumentMeta(
  workspacePath: string,
  docId: string,
  patch: { doc_type?: string | null; doc_tags?: string[]; notes?: string },
): Promise<void> {
  await api.patch("/document-meta", patch, {
    params: { workspace_path: workspacePath, doc_id: docId },
  });
}

export async function getDocumentLinks(workspacePath: string, docId: string): Promise<DocumentLink[]> {
  const { data } = await api.get<{ links: DocumentLink[] }>("/document-meta/links", {
    params: { workspace_path: workspacePath, doc_id: docId },
  });
  return data.links;
}

export async function createDocumentLink(
  workspacePath: string,
  body: { source_doc_id: string; target_doc_id: string; target_file_path?: string; relationship?: string; note?: string },
): Promise<{ id: string }> {
  const { data } = await api.post<{ id: string }>("/document-meta/links", body, {
    params: { workspace_path: workspacePath },
  });
  return data;
}

export async function deleteDocumentLink(workspacePath: string, linkId: string): Promise<void> {
  await api.delete(`/document-meta/links/${linkId}`, {
    params: { workspace_path: workspacePath },
  });
}

export interface WorkspaceDocumentLink {
  id: string;
  source_doc_id: string;
  target_doc_id: string;
  source_filename: string;
  target_filename: string;
  relationship: string;
  note: string | null;
  broken_at: string | null;
}

export async function fetchAllDocumentLinks(workspacePath: string): Promise<WorkspaceDocumentLink[]> {
  const { data } = await api.get<{ links: WorkspaceDocumentLink[] }>("/document-meta/links/all", {
    params: { workspace_path: workspacePath },
  });
  return data.links;
}
