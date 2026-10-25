// The confirm screen as plain text (semantics §5): the same lines for the CLI and for an MCP client. Roles come first,
// because a changed role changes which metrics code drafts; the metrics follow.
import type { ConfirmView } from "@agentic-analytics/schema";

const roleLine = (r: ConfirmView["roles"][number]): string =>
  `${r.table}.${r.label} → ${r.role} [${r.status}] (${r.evidence.length ? r.evidence.join("; ") : "no evidence"})`;

/** Lines for the roles, the table kinds and the business model. */
export function rolesScreenLines(v: ConfirmView): string[] {
  const out: string[] = ["Column roles (what each column means; they decide which analyses run):"];
  if (!v.roles.length) out.push("  (no column has a role)");
  for (const r of v.roles) out.push(`  ${roleLine(r)}`);
  if (v.columns_without_role.length) out.push(`  Without a role: ${v.columns_without_role.map((c) => `${c.table}.${c.label}`).join(", ")}`);
  out.push("", "Table kinds:");
  for (const k of v.table_kinds) out.push(`  ${k.table}: ${k.kind}${k.evidence.length ? ` (from ${k.evidence.join(", ")})` : ""}`);
  const b = v.business_model;
  out.push("", `Business model: ${b.model} [${b.status}]${b.signals.length ? ` (${b.signals.join("; ")})` : ""}`);
  return out;
}

/** The whole screen: roles, kinds and business model, then the drafted metrics in plain words. */
export function confirmScreenLines(v: ConfirmView): string[] {
  return [...rolesScreenLines(v), "", "Metrics:", ...v.metrics.map((m) => `  - ${m.text}`)];
}
