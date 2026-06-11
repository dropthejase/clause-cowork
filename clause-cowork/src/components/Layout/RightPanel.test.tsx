import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { RightPanel } from "./RightPanel";
import { ThemeProvider } from "../../ThemeContext";

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe("RightPanel", () => {
  it("renders children when open", () => {
    wrap(<RightPanel title="Test" open={true} onClose={vi.fn()} width={240}><div>content</div></RightPanel>);
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("hides children when closed", () => {
    wrap(<RightPanel title="Test" open={false} onClose={vi.fn()} width={240}><div>content</div></RightPanel>);
    expect(screen.queryByText("content")).not.toBeInTheDocument();
  });

  it("calls onClose when X clicked", () => {
    const onClose = vi.fn();
    wrap(<RightPanel title="Test" open={true} onClose={onClose} width={240}><div>content</div></RightPanel>);
    fireEvent.click(screen.getByTitle("Close panel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
