// Marks the copyable values in docs tables (DESIGN.md §6 "Copy", site v5 PR 3): inline `code` in a table cell that is
// a command (`aa serve`) or an environment variable's name (`GROQ_API_KEY`) gets `data-copy`, and the site's copy
// script (src/components/site/copy.ts) gives it a button. A plain walk over the HTML tree: no dependency.
import { isCopyValue } from "../src/components/site/copy.ts";

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function text(node: HastNode): string {
  return node.type === "text" ? (node.value ?? "") : (node.children ?? []).map(text).join("");
}

function walk(node: HastNode, inCell: boolean): void {
  const cell = inCell || (node.type === "element" && node.tagName === "td");
  if (node.type === "element" && node.tagName === "pre") return;
  if (cell && node.type === "element" && node.tagName === "code" && isCopyValue(text(node))) {
    node.properties = { ...node.properties, dataCopy: "" };
    return;
  }
  for (const child of node.children ?? []) walk(child, cell);
}

export default function rehypeCopyValues() {
  return (tree: HastNode) => walk(tree, false);
}
