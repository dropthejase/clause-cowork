import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DocTabs } from "./DocTabs";
import { ThemeProvider } from "../../ThemeContext";

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

const docs = [
  { path: "/ws/a.docx", docId: "docA" },
  { path: "/ws/b.docx", docId: "docB" },
];

const baseProps = { chatOpen: false, onToggleChat: vi.fn(), previewOpen: false, onTogglePreview: vi.fn() };

describe("DocTabs", () => {
  it("renders all tabs", () => {
    wrap(<DocTabs docs={docs} activeDocPath="/ws/a.docx" onSelect={vi.fn()} onClose={vi.fn()} {...baseProps} />);
    expect(screen.getByText("a.docx")).toBeInTheDocument();
    expect(screen.getByText("b.docx")).toBeInTheDocument();
  });

  it("calls onSelect when inactive tab clicked", () => {
    const onSelect = vi.fn();
    wrap(<DocTabs docs={docs} activeDocPath="/ws/a.docx" onSelect={onSelect} onClose={vi.fn()} {...baseProps} />);
    fireEvent.click(screen.getByText("b.docx"));
    expect(onSelect).toHaveBeenCalledWith("/ws/b.docx");
  });

  it("calls onClose when × clicked", () => {
    const onClose = vi.fn();
    wrap(<DocTabs docs={docs} activeDocPath="/ws/a.docx" onSelect={vi.fn()} onClose={onClose} {...baseProps} />);
    const closeButtons = screen.getAllByTitle("Close tab");
    fireEvent.click(closeButtons[0]);
    expect(onClose).toHaveBeenCalledWith("/ws/a.docx");
  });
});
