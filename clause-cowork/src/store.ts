import { create } from "zustand";

interface OpenDoc {
  path: string;
  docId: string;
}

type DocTab = "info" | "detail";

interface AppState {
  workspaces: string[];
  activeWorkspace: string | null;
  openDocs: OpenDoc[];
  activeDocPath: string | null;
  selectedNodeId: string | null;
  panelNodeId: string | null;
  filePanelOpen: boolean;
  settingsOpen: boolean;
  clauseDetailOpen: boolean;
  previewPanelOpen: boolean;
  chatPanelOpen: boolean;
  activeDocTab: DocTab;

  addWorkspace: (path: string) => void;
  removeWorkspace: (path: string) => void;
  openWorkspace: (path: string) => void;
  closeWorkspace: () => void;
  openDoc: (path: string, docId: string) => void;
  openUnparsedDoc: (path: string) => void;
  closeDoc: (path: string) => void;
  setActiveDoc: (path: string) => void;
  setSelectedNode: (id: string | null) => void;
  setPanelNode: (id: string | null) => void;
  toggleFilePanel: () => void;
  toggleSettings: () => void;
  toggleClauseDetail: (open?: boolean) => void;
  togglePreviewPanel: () => void;
  toggleChatPanel: () => void;
  setDocTab: (tab: DocTab) => void;
  tagPoolOpen: boolean;
  openTagPool: () => void;
  closeTagPool: () => void;
}

function persist(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

function load(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function loadWorkspaces(): string[] {
  try {
    const raw = localStorage.getItem("cc-workspaces");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveWorkspaces(workspaces: string[]) {
  try { localStorage.setItem("cc-workspaces", JSON.stringify(workspaces)); } catch { /* ignore */ }
}

function loadOpenDocs(): OpenDoc[] {
  try {
    const raw = localStorage.getItem("cc-open-docs");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveOpenDocs(docs: OpenDoc[]) {
  try { localStorage.setItem("cc-open-docs", JSON.stringify(docs)); } catch { /* ignore */ }
}

export const useAppStore = create<AppState>((set, get) => ({
  workspaces: loadWorkspaces(),
  activeWorkspace: load("cc-active-workspace", "") || null,
  openDocs: loadOpenDocs(),
  activeDocPath: load("cc-active-doc", "") || null,
  selectedNodeId: null,
  panelNodeId: null,
  filePanelOpen: load("cc-file-panel", "true") !== "false",
  settingsOpen: false,
  clauseDetailOpen: load("cc-clause-detail", "false") === "true",
  previewPanelOpen: load("cc-preview-panel", "false") === "true",
  chatPanelOpen: load("cc-chat-panel", "false") === "true",
  activeDocTab: "info" as DocTab,
  tagPoolOpen: false,

  addWorkspace: (path) => {
    const { workspaces } = get();
    if (workspaces.includes(path)) return;
    const next = [...workspaces, path];
    saveWorkspaces(next);
    set({ workspaces: next });
  },

  removeWorkspace: (path) => {
    const { workspaces, activeWorkspace } = get();
    const next = workspaces.filter((w) => w !== path);
    saveWorkspaces(next);
    if (activeWorkspace === path) {
      set({ workspaces: next, activeWorkspace: null, openDocs: [], activeDocPath: null, selectedNodeId: null });
    } else {
      set({ workspaces: next });
    }
  },

  openWorkspace: (path) => {
    const { workspaces } = get();
    persist("cc-active-workspace", path);
    persist("cc-preview-panel", "false");
    persist("cc-open-docs", "[]");
    persist("cc-active-doc", "");
    const next = workspaces.includes(path) ? workspaces : [...workspaces, path];
    if (!workspaces.includes(path)) saveWorkspaces(next);
    set({ workspaces: next, activeWorkspace: path, openDocs: [], activeDocPath: null, selectedNodeId: null, panelNodeId: null, previewPanelOpen: false });
  },

  closeWorkspace: () => {
    persist("cc-active-workspace", "");
    persist("cc-open-docs", "[]");
    persist("cc-active-doc", "");
    set({ activeWorkspace: null, openDocs: [], activeDocPath: null, selectedNodeId: null });
  },

  openDoc: (path, docId) => {
    const { openDocs } = get();
    const existing = openDocs.find((d) => d.path === path);
    if (existing) {
      // Update docId if it was previously unknown (opened as unparsed)
      if (!existing.docId && docId) {
        const next = openDocs.map((d) => d.path === path ? { ...d, docId } : d);
        saveOpenDocs(next);
        set({ openDocs: next, activeDocPath: path, activeDocTab: "info" });
      } else {
        persist("cc-active-doc", path);
        set({ activeDocPath: path, activeDocTab: "info" });
      }
      return;
    }
    const next = [...openDocs, { path, docId }];
    saveOpenDocs(next);
    persist("cc-active-doc", path);
    set({ openDocs: next, activeDocPath: path, activeDocTab: "info" });
  },

  openUnparsedDoc: (path) => {
    const { openDocs } = get();
    if (openDocs.some((d) => d.path === path)) {
      persist("cc-active-doc", path);
      set({ activeDocPath: path, activeDocTab: "info" });
      return;
    }
    const next = [...openDocs, { path, docId: "" }];
    saveOpenDocs(next);
    persist("cc-active-doc", path);
    set({ openDocs: next, activeDocPath: path, activeDocTab: "info" });
  },

  closeDoc: (path) => {
    const { openDocs, activeDocPath } = get();
    const remaining = openDocs.filter((d) => d.path !== path);
    const newActive = activeDocPath === path
      ? remaining[remaining.length - 1]?.path ?? null
      : activeDocPath;
    saveOpenDocs(remaining);
    persist("cc-active-doc", newActive ?? "");
    set({ openDocs: remaining, activeDocPath: newActive });
  },

  setActiveDoc: (path) => {
    persist("cc-active-doc", path);
    set({ activeDocPath: path });
  },

  setSelectedNode: (id) => {
    set({ selectedNodeId: id });
  },

  setPanelNode: (id) => set({ panelNodeId: id }),

  toggleFilePanel: () => {
    const next = !get().filePanelOpen;
    persist("cc-file-panel", String(next));
    set({ filePanelOpen: next });
  },

  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),

  toggleClauseDetail: (open) => {
    const next = open ?? !get().clauseDetailOpen;
    persist("cc-clause-detail", String(next));
    set({ clauseDetailOpen: next });
  },

  togglePreviewPanel: () => {
    const next = !get().previewPanelOpen;
    persist("cc-preview-panel", String(next));
    set({ previewPanelOpen: next });
  },

  toggleChatPanel: () => {
    const next = !get().chatPanelOpen;
    persist("cc-chat-panel", String(next));
    set({ chatPanelOpen: next });
  },

  setDocTab: (tab) => set({ activeDocTab: tab }),

  openTagPool: () => set({ tagPoolOpen: true }),
  closeTagPool: () => set({ tagPoolOpen: false }),
}));
