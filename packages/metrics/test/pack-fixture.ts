// A profiled table with chosen column roles, for the code-drafted packs (KPI pack, margin): the CSV is profiled for real
// (types, null shares, grouping columns) and then given the roles the test names, as a confirmed screen would.
import { ingest } from "@agentic-analytics/ingest";
import { profileJob } from "@agentic-analytics/profile";
import { Workspace } from "@agentic-analytics/store";
import { afterEach } from "vitest";
import { loadCatalog } from "../src/index.ts";

const open: Workspace[] = [];
afterEach(() => {
  for (const w of open.splice(0)) w.close();
});

export async function profiledTable(head: string, rows: readonly string[], roles: Record<string, string>, kind = "sales_lines") {
  const ws = await Workspace.open();
  open.push(ws);
  const text = `${head}\n${rows.join("\n")}\n`;
  const summary = await profileJob(ws, await ingest([{ name: "s.csv", bytes: new TextEncoder().encode(text) }]), { today: "2026-07-01" });
  const first = summary.semantics.roles[0];
  if (!first) throw new Error("no roles");
  const columns = first.columns.map((c) => ({ ...c, role: (roles[c.column] ?? "none") as typeof c.role, score: 1 }));
  const table_kinds = summary.semantics.table_kinds.map((k) => ({ ...k, kind: kind as typeof k.kind }));
  const withRoles = { ...summary, semantics: { ...summary.semantics, roles: [{ ...first, columns }], table_kinds } };
  return { ws, summary: withRoles, catalog: await loadCatalog(ws) };
}
