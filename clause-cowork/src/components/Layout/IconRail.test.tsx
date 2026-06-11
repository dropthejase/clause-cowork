import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { IconRail } from "./IconRail";
import { ThemeProvider } from "../../ThemeContext";

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

const defaultProps = {
  onToggleFilePanel: vi.fn(),
  filePanelOpen: false,
  onOpenSettings: vi.fn(),
  onOpenTagPool: vi.fn(),
  tagPoolOpen: false,
};

describe("IconRail", () => {
  it("renders file browser toggle button", () => {
    wrap(<IconRail {...defaultProps} />);
    expect(screen.getByTitle("File Browser")).toBeInTheDocument();
  });

  it("calls onToggleFilePanel when file button clicked", () => {
    const onToggle = vi.fn();
    wrap(<IconRail {...defaultProps} onToggleFilePanel={onToggle} />);
    fireEvent.click(screen.getByTitle("File Browser"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders settings button", () => {
    wrap(<IconRail {...defaultProps} />);
    expect(screen.getByTitle("Settings")).toBeInTheDocument();
  });

  it("opens menu when settings button clicked", () => {
    wrap(<IconRail {...defaultProps} />);
    fireEvent.click(screen.getByTitle("Settings"));
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });
});
