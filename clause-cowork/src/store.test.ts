import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "./store";

describe("useAppStore", () => {
  beforeEach(() => {
    useAppStore.setState({
      workspaces: [],
      activeWorkspace: null,
      openDocs: [],
      activeDocPath: null,
      selectedNodeId: null,
      filePanelOpen: true,
      clauseDetailOpen: false,
      previewPanelOpen: false,
      chatPanelOpen: false,
    });
  });

  it("opens a doc tab", () => {
    useAppStore.getState().openDoc("/ws/contract.docx", "docA");
    const state = useAppStore.getState();
    expect(state.openDocs).toHaveLength(1);
    expect(state.openDocs[0]).toEqual({ path: "/ws/contract.docx", docId: "docA" });
    expect(state.activeDocPath).toBe("/ws/contract.docx");
  });

  it("does not duplicate open docs", () => {
    useAppStore.getState().openDoc("/ws/contract.docx", "docA");
    useAppStore.getState().openDoc("/ws/contract.docx", "docA");
    expect(useAppStore.getState().openDocs).toHaveLength(1);
  });

  it("closes a doc and activates the previous tab", () => {
    useAppStore.getState().openDoc("/ws/a.docx", "docA");
    useAppStore.getState().openDoc("/ws/b.docx", "docB");
    useAppStore.getState().closeDoc("/ws/a.docx");
    const state = useAppStore.getState();
    expect(state.openDocs).toHaveLength(1);
    expect(state.activeDocPath).toBe("/ws/b.docx");
  });

  it("addWorkspace adds a path and persists", () => {
    useAppStore.getState().addWorkspace("/Users/me/project");
    expect(useAppStore.getState().workspaces).toContain("/Users/me/project");
  });

  it("addWorkspace is idempotent", () => {
    useAppStore.getState().addWorkspace("/Users/me/project");
    useAppStore.getState().addWorkspace("/Users/me/project");
    expect(useAppStore.getState().workspaces).toHaveLength(1);
  });

  it("openWorkspace sets activeWorkspace and adds if new", () => {
    useAppStore.getState().openWorkspace("/Users/me/project");
    const state = useAppStore.getState();
    expect(state.activeWorkspace).toBe("/Users/me/project");
    expect(state.workspaces).toContain("/Users/me/project");
  });

  it("closeWorkspace clears activeWorkspace and openDocs", () => {
    useAppStore.setState({ activeWorkspace: "/Users/me/project", openDocs: [{ path: "/a.docx", docId: "a" }], activeDocPath: "/a.docx" });
    useAppStore.getState().closeWorkspace();
    const state = useAppStore.getState();
    expect(state.activeWorkspace).toBeNull();
    expect(state.openDocs).toHaveLength(0);
    expect(state.activeDocPath).toBeNull();
  });

  it("removeWorkspace clears active state if it was the active workspace", () => {
    useAppStore.setState({ workspaces: ["/Users/me/project"], activeWorkspace: "/Users/me/project" });
    useAppStore.getState().removeWorkspace("/Users/me/project");
    const state = useAppStore.getState();
    expect(state.workspaces).toHaveLength(0);
    expect(state.activeWorkspace).toBeNull();
  });
});
