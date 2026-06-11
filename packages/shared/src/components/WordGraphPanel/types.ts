export type EdgeType = "references" | "subject_to" | "contradicts";

export const EDGE_TYPE_LABELS: Record<EdgeType, string> = {
  references:  "References",
  subject_to:  "Subject to",
  contradicts: "Contradicts",
};

export const EDGE_TYPE_PASSIVE_LABELS: Record<EdgeType, string> = {
  references:  "Referenced by",
  subject_to:  "Relied on by",
  contradicts: "Contradicted by",
};

export interface Tag {
  value: string;
  user_defined: boolean;
}

export interface Connection {
  id: string;
  target_id: string;
  edge_type: EdgeType;
  note?: string;
  user_created: boolean;
  user_rejected: boolean;
}

export interface GraphNode {
  stable_id: string;
  doc_id: string;
  paragraph_hash: string;
  position: number;
  raw_text: string;
  clause_type?: string;
  clause_tags: Tag[];
  connections: Connection[];
  is_table: boolean;
  tombstoned: boolean;
  parent?: string;
  needs_reclassification?: boolean;
}

export interface FilterState {
  types: string[];
  connectionTypes: EdgeType[];
  tags: string[];
  docIds: string[];
}

export interface WordGraphPanelProps {
  nodes: GraphNode[];
  primaryDocId: string;
  nodeTypes: string[];
  externalSelectedId?: string | null;
  onNodeSelect?: (nodeId: string) => void;
  onSectionFocus?: (sectionLabel: string) => void;
  onFollowToggle?: (enabled: boolean) => void;
  onNodeTypeChange?: (nodeId: string, newType: string) => void;
  onAddTag?: (nodeId: string, tagValue: string) => void;
  onRemoveTag?: (nodeId: string, tagValue: string) => void;
  onAddConnection?: (sourceId: string, targetId: string, edgeType: EdgeType, note?: string) => void;
  onRejectConnection?: (sourceId: string, connectionId: string) => void;
  onHideNode?: (nodeId: string) => void;
  modelName?: string;
  lastParsedAt?: string;
}
