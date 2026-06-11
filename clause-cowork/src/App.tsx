import { useCallback, useState } from "react";
import { ThemeProvider } from "./ThemeContext";
import { useAppStore } from "./store";
import { useWorkspace } from "./hooks/useWorkspace";
import { IconRail } from "./components/Layout/IconRail";
import { FilePanel } from "./components/Layout/FilePanel";
import { WorkspacesHome } from "./components/WorkspacesHome/WorkspacesHome";
import { DocView } from "./components/DocView/DocView";
import { SettingsScreen } from "./components/Settings/SettingsScreen";
import { TagPoolShell } from "./components/TagPool/TagPoolShell";
import { HelpModal } from "./components/HelpModal/HelpModal";
import { WorkspaceGraph } from "./components/WorkspaceGraph/WorkspaceGraph";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useTheme } from "./ThemeContext";
import { FONT } from "@word-graph/shared";

function basename(p: string): string {
  return p.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? p;
}

function AppInner() {
  const {
    activeWorkspace, closeWorkspace,
    openDocs, activeDocPath, openDoc, openUnparsedDoc,
    filePanelOpen, toggleFilePanel,
    settingsOpen, toggleSettings,
    tagPoolOpen, openTagPool, closeTagPool,
  } = useAppStore();
  const { theme } = useTheme();
  const { tree, loading: treeLoading, refresh: refreshTree } = useWorkspace(activeWorkspace);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);

  const handleRefresh = useCallback(async () => {
    if (!activeWorkspace) return;
    await refreshTree();
    setRefreshKey((k) => k + 1);
  }, [activeWorkspace, refreshTree]);

  if (settingsOpen) {
    return (
      <SettingsScreen
        workspacePath={activeWorkspace ?? ""}
        onBack={toggleSettings}
      />
    );
  }

  if (activeWorkspace === null) {
    return <WorkspacesHome onOpenSettings={toggleSettings} />;
  }

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <IconRail
        onToggleFilePanel={() => {
          if (graphOpen) { setGraphOpen(false); if (!filePanelOpen) toggleFilePanel(); }
          else if (tagPoolOpen) { closeTagPool(); if (!filePanelOpen) toggleFilePanel(); }
          else { toggleFilePanel(); }
        }}
        filePanelOpen={filePanelOpen && !tagPoolOpen && !graphOpen}
        onOpenSettings={toggleSettings}
        onOpenTagPool={tagPoolOpen ? closeTagPool : openTagPool}
        tagPoolOpen={tagPoolOpen}

        onHome={closeWorkspace}
        onRefresh={handleRefresh}
        onHelp={() => setShowHelp(true)}
        onToggleGraph={() => { closeTagPool(); setGraphOpen((v) => !v); }}
        graphOpen={graphOpen}
      />

      {filePanelOpen && !tagPoolOpen && !graphOpen && (
        <FilePanel tree={tree} onOpenDoc={openDoc} onOpenUnparsed={openUnparsedDoc} loading={treeLoading} />
      )}

      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, background: theme.graphBg }}>
        {/* Top bar */}
        <div style={{
          height: 36, display: "flex", alignItems: "center", padding: "0 12px",
          background: theme.base, borderBottom: `1px solid ${theme.edgeBorder}`,
          flexShrink: 0, gap: 12,
        }}>
          <span style={{ fontSize: FONT.sm, color: theme.black, fontWeight: 600 }}>
            {basename(activeWorkspace)}
          </span>
          <div style={{ flex: 1 }} />
        </div>

        {tagPoolOpen ? (
          <TagPoolShell onBack={closeTagPool} />
        ) : graphOpen ? (
          <ErrorBoundary label="WorkspaceGraph" fallback={<div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#b91c1c", fontSize: 13 }}>Graph failed to render. Try closing and reopening the graph view.</div>}>
            <WorkspaceGraph
              workspacePath={activeWorkspace}
              onOpenDoc={(path, docId) => { setGraphOpen(false); openDoc(path, docId); }}
            />
          </ErrorBoundary>
        ) : (
          <DocView refreshKey={refreshKey} tree={tree} />
        )}
      </div>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary label="App">
      <ThemeProvider>
        <AppInner />
      </ThemeProvider>
    </ErrorBoundary>
  );
}
