export interface WorkspaceDocument {
  doc_id: string;
  path: string;
  name: string;
  clause_count: number;
  classified_count: number;
  connection_count: number;
  last_analysed_at: string | null;
  doc_type: string | null;
  doc_tags: string[];
}

export interface WorkspaceResponse {
  workspace_path: string;
  documents: WorkspaceDocument[];
}

export interface FolderTreeFile {
  name: string;
  type: "file";
  path: string;
  status: "analysed" | "pending" | "viewable";
  doc_id: string | null;
  doc_type?: string | null;
  doc_tags?: string[];
  file_size?: number | null;
  file_mtime?: number | null;
  last_analysed_at?: number | null;
  needs_reclassification_count?: number;
}

export interface FolderTreeFolder {
  name: string;
  type: "folder";
  path: string;
  children: FolderTreeEntry[];
}

export type FolderTreeEntry = FolderTreeFile | FolderTreeFolder;

export interface FolderTreeResponse {
  tree: FolderTreeEntry[];
}

export interface ClausesResponse {
  doc_id: string;
  clauses: import("@word-graph/shared").GraphNode[];
}

export type { WorkspaceConfig } from "@word-graph/shared";
