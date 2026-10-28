// Roles in the workspace next to the profile (docs/specs/semantics.md §2.5, migration 6): the proposal per column with
// its evidence, and every candidate with its score (kept for `aa explain` and the roles eval, not for report.json).
import { sql, type Workspace } from "@agentic-analytics/store";
import type { TableRoles } from "./detect.ts";
import type { KindResult } from "./kinds.ts";

/** Replaces the table's stored roles with the detector's proposals (status `proposed`). */
export async function saveRoles(ws: Workspace, roles: TableRoles): Promise<void> {
  await ws.run(sql`DELETE FROM profile_roles WHERE table_id = ${roles.table_id}`);
  await ws.run(sql`DELETE FROM profile_role_candidates WHERE table_id = ${roles.table_id}`);
  await ws.run(sql`DELETE FROM profile_period_parts WHERE table_id = ${roles.table_id}`);
  if (roles.period_parts)
    await ws.run(
      sql`INSERT INTO profile_period_parts VALUES (${roles.table_id}, ${roles.period_parts.year}, ${roles.period_parts.month ?? null})`,
    );
  for (const c of roles.columns) {
    await ws.run(
      sql`INSERT INTO profile_roles VALUES (${roles.table_id}, ${c.column}, ${c.role}, ${c.score}, 'proposed', ${c.source}, ${JSON.stringify(c.evidence)}::JSON)`,
    );
    for (const k of c.candidates)
      await ws.run(sql`INSERT INTO profile_role_candidates VALUES (${roles.table_id}, ${c.column}, ${k.role}, ${k.score})`);
  }
}

export type StoredRole = {
  readonly column_name: string;
  readonly role: string;
  readonly score: number;
  readonly status: string;
  readonly source: string;
};

export async function loadRoles(ws: Workspace, tableId: string): Promise<StoredRole[]> {
  return ws.all<StoredRole>(
    sql`SELECT column_name, role, score, status, source FROM profile_roles WHERE table_id = ${tableId} ORDER BY column_name`,
  );
}

/** Replaces the table's stored kind (`profile_table_kinds`, semantics §2.5). */
export async function saveTableKind(ws: Workspace, k: KindResult): Promise<void> {
  await ws.run(sql`DELETE FROM profile_table_kinds WHERE table_id = ${k.table_id}`);
  await ws.run(sql`INSERT INTO profile_table_kinds VALUES (${k.table_id}, ${k.kind}, ${JSON.stringify(k.evidence)}::JSON)`);
}

export async function loadTableKinds(ws: Workspace): Promise<KindResult[]> {
  const rows = await ws.all<{ table_id: string; kind: string; evidence: string | null }>(
    sql`SELECT table_id, kind, evidence_json::VARCHAR AS evidence FROM profile_table_kinds ORDER BY table_id`,
  );
  return rows.map((r) => ({
    table_id: r.table_id,
    kind: r.kind as KindResult["kind"],
    evidence: r.evidence ? (JSON.parse(r.evidence) as string[]) : [],
  }));
}
