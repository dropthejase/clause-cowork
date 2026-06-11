import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { FilePanel } from "./FilePanel";
import { ThemeProvider } from "../../ThemeContext";
import type { FolderTreeFolder } from "../../types";

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

const mockTree: FolderTreeFolder[] = [{
  name: "Cisco Deal",
  type: "folder",
  path: "/ws/Cisco Deal",
  children: [
    { name: "merger.docx", type: "file", path: "/ws/Cisco Deal/merger.docx", status: "analysed", doc_id: "docA" },
    { name: "schedule.docx", type: "file", path: "/ws/Cisco Deal/schedule.docx", status: "pending", doc_id: null },
  ],
}];

describe("FilePanel", () => {
  it("renders folder and files", () => {
    wrap(<FilePanel tree={mockTree} onOpenDoc={vi.fn()} onOpenUnparsed={vi.fn()} loading={false} />);
    expect(screen.getByText("Cisco Deal")).toBeInTheDocument();
    expect(screen.getByText("merger.docx")).toBeInTheDocument();
    expect(screen.getByText("schedule.docx")).toBeInTheDocument();
  });

  it("calls onOpenDoc for parsed files and onOpenUnparsed for pending files", () => {
    const onOpen = vi.fn();
    const onOpenUnparsed = vi.fn();
    wrap(<FilePanel tree={mockTree} onOpenDoc={onOpen} onOpenUnparsed={onOpenUnparsed} loading={false} />);
    fireEvent.click(screen.getByText("merger.docx"));
    expect(onOpen).toHaveBeenCalledWith("/ws/Cisco Deal/merger.docx", "docA");
    fireEvent.click(screen.getByText("schedule.docx"));
    expect(onOpenUnparsed).toHaveBeenCalledWith("/ws/Cisco Deal/schedule.docx");
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("shows loading state", () => {
    wrap(<FilePanel tree={[]} onOpenDoc={vi.fn()} onOpenUnparsed={vi.fn()} loading={true} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});
