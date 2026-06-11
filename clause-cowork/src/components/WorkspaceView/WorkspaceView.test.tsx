import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { WorkspaceView } from "./WorkspaceView";
import { ThemeProvider } from "../../ThemeContext";
import type { WorkspaceDocument } from "../../types";

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

const docs: WorkspaceDocument[] = [{
  doc_id: "docA",
  path: "/ws/contract.docx",
  name: "contract.docx",
  clause_count: 120,
  classified_count: 100,
  connection_count: 15,
  last_analysed_at: "2026-05-28T10:00:00",
  doc_type: null,
  doc_tags: [],
}];

describe("WorkspaceView", () => {
  it("renders doc cards when docs present", () => {
    wrap(<WorkspaceView docs={docs} onOpenDoc={vi.fn()} />);
    expect(screen.getByText("contract.docx")).toBeInTheDocument();
    expect(screen.getByText("120 clauses")).toBeInTheDocument();
  });

  it("calls onOpenDoc when Open button clicked", () => {
    const onOpen = vi.fn();
    wrap(<WorkspaceView docs={docs} onOpenDoc={onOpen} />);
    fireEvent.click(screen.getByText("Open"));
    expect(onOpen).toHaveBeenCalledWith("/ws/contract.docx", "docA");
  });

  it("shows empty state when no docs", () => {
    wrap(<WorkspaceView docs={[]} onOpenDoc={vi.fn()} />);
    expect(screen.getByText(/no documents found/i)).toBeInTheDocument();
  });
});
