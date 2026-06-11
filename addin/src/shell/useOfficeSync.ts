/// <reference path="../../node_modules/@microsoft/office-js/dist/office.d.ts" />
import { useEffect, useRef } from "react";
import { GraphNode } from "@word-graph/shared";

interface Options {
  nodes: GraphNode[];
  followEnabled: boolean;
  onNodeFocus: (nodeId: string) => void;
}

function findNodeForText(paraText: string, nodes: GraphNode[]): GraphNode | undefined {
  if (!paraText.trim()) return undefined;
  const needle = paraText.trim().toLowerCase();

  // 1. Exact match
  const exact = nodes.find((n) => n.raw_text.trim().toLowerCase() === needle);
  if (exact) return exact;

  // 2. Node whose raw_text starts with the paragraph text (paragraph may be truncated in raw_text)
  const prefixMatch = nodes.find((n) =>
    n.raw_text.toLowerCase().startsWith(needle.slice(0, 40))
  );
  if (prefixMatch) return prefixMatch;

  // 3. Paragraph text starts with node text (raw_text is truncated at 500 chars)
  const nodePrefix = nodes.find((n) =>
    needle.startsWith(n.raw_text.trim().toLowerCase().slice(0, 40))
  );
  if (nodePrefix) return nodePrefix;

  // 4. Substantial overlap — node text contains a long chunk of the paragraph
  const chunk = needle.slice(0, 60);
  return nodes.find((n) => n.raw_text.toLowerCase().includes(chunk));
}

async function getCursorParagraphText(): Promise<string> {
  if (typeof Office === "undefined" || !Office.context) return "";
  try {
    return await Word.run(async (context) => {
      const sel = context.document.getSelection();
      const paras = sel.paragraphs;
      paras.load("items/text");
      await context.sync();
      // Use the first paragraph the cursor is in
      return paras.items[0]?.text ?? "";
    });
  } catch {
    return "";
  }
}

export function useOfficeSync({ nodes, followEnabled, onNodeFocus }: Options): void {
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  useEffect(() => {
    if (typeof Office === "undefined" || !Office.context) return;

    function handleSelectionChange() {
      if (!followEnabled) return;
      getCursorParagraphText().then((text) => {
        const match = findNodeForText(text, nodesRef.current);
        if (match) onNodeFocus(match.stable_id);
      });
    }

    Office.context.document.addHandlerAsync(
      Office.EventType.DocumentSelectionChanged,
      handleSelectionChange
    );

    return () => {
      Office.context.document.removeHandlerAsync(
        Office.EventType.DocumentSelectionChanged,
        { handler: handleSelectionChange }
      );
    };
  }, [followEnabled, onNodeFocus]);
}

export async function scrollWordToNode(node: GraphNode): Promise<void> {
  if (typeof Office === "undefined" || !Office.context) return;
  await Word.run(async (context) => {
    // Search with enough text to uniquely identify the paragraph
    const searchText = node.raw_text.slice(0, 80).replace(/\n/g, " ");
    const results = context.document.body.search(searchText, {
      matchCase: false,
      matchWholeWord: false,
    });
    results.load("items");
    await context.sync();
    if (results.items.length === 0) return;
    // Expand the found range to its containing paragraph, then select it
    const para = results.items[0].paragraphs.getFirst();
    para.load("text");
    await context.sync();
    para.select("Select");
    await context.sync();
  });
}
