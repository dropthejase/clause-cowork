import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkspacesHome } from "./WorkspacesHome";
import { ThemeProvider } from "../../ThemeContext";
import { useAppStore } from "../../store";

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe("WorkspacesHome", () => {
  beforeEach(() => {
    useAppStore.setState({ workspaces: [], activeWorkspace: null });
  });

  it("shows empty state when no workspaces", () => {
    wrap(<WorkspacesHome onOpenSettings={vi.fn()} />);
    expect(screen.getByText(/no workspaces yet/i)).toBeInTheDocument();
  });

  it("shows workspace cards when workspaces present", () => {
    useAppStore.setState({ workspaces: ["/Users/me/test-data"] });
    wrap(<WorkspacesHome onOpenSettings={vi.fn()} />);
    expect(screen.getByText("test-data")).toBeInTheDocument();
  });

  it("opens folder picker when Add workspace clicked", () => {
    wrap(<WorkspacesHome onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText(/add workspace/i));
    expect(screen.getByText(/choose workspace folder/i)).toBeInTheDocument();
  });
});
