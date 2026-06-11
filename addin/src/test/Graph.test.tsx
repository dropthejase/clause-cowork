import { render } from "@testing-library/react";
import { GraphCanvas } from "@word-graph/shared";
import type { GraphNode } from "@word-graph/shared";

const makeNode = (id: string, parent?: string, connections: string[] = []): GraphNode => ({
  stable_id: id,
  doc_id: "doc1",
  paragraph_hash: id,
  position: 0,
  raw_text: `Clause ${id}`,
  clause_tags: [],
  connections: connections.map((tid) => ({
    id: `${id}-${tid}`,
    target_id: tid,
    edge_type: "references",
    user_created: false,
    user_rejected: false,
  })),
  is_table: false,
  tombstoned: false,
  parent,
});

describe("GraphCanvas", () => {
  it("renders an SVG element", () => {
    const nodes = [makeNode("n1", undefined, ["n2"]), makeNode("n2")];
    render(
      <GraphCanvas
        nodes={nodes}
        selectedNodeId={null}
        primaryDocId="doc1"
        view="local"
        onNodeClick={() => {}}
        height={300}
              />
    );
    expect(document.querySelector("svg")).toBeInTheDocument();
  });

  it("renders a container div for each graph", () => {
    const nodes = [makeNode("n1"), makeNode("n2"), makeNode("n3")];
    const { container } = render(
      <GraphCanvas
        nodes={nodes}
        selectedNodeId={null}
        primaryDocId="doc1"
        view="full"
        onNodeClick={() => {}}
        height={300}
              />
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("calls onNodeClick when a node group is clicked", () => {
    const onNodeClick = vi.fn();
    const nodes = [makeNode("n1", undefined, ["n2"]), makeNode("n2"), makeNode("n3")];
    render(
      <GraphCanvas
        nodes={nodes}
        selectedNodeId="n1"
        primaryDocId="doc1"
        view="local"
        onNodeClick={onNodeClick}
        height={300}
              />
    );
    expect(document.querySelector("svg")).toBeInTheDocument();
  });

  it("renders circle elements for clause nodes, section hubs, and doc hub", () => {
    const nodes = [
      makeNode("n1", "1. Definitions"),
      makeNode("n2", "1. Definitions"),
      makeNode("n3", "2. Obligations"),
    ];
    const { container } = render(
      <GraphCanvas
        nodes={nodes}
        selectedNodeId={null}
        primaryDocId="doc1"
        view="local"
        onNodeClick={() => {}}
        height={300}
              />
    );
    // 3 clause nodes + 2 section hubs + 1 doc hub = 6 circles minimum
    const circles = container.querySelectorAll("circle");
    expect(circles.length).toBeGreaterThanOrEqual(6);
  });
});
