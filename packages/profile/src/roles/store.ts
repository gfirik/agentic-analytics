// Roles in the workspace next to the profile (docs/specs/semantics.md §2.5, migration 6): the proposal per column with
// its evidence, and every candidate with its score (kept for `aa explain` and the roles eval, not for report.json).
import { sql, type Workspace } from "@agentic-analytics/store";
import type { TableRoles } from "./detect.ts";

/** Replaces the table's stored roles with the detector's proposals (status `proposed`). */
export async function saveRoles(ws: Workspace, roles: TableRoles): Promise<void> {
  await ws.run(sql`DELETE FROM profile_roles WHERE table_id = ${roles.table_id}`);
  await ws.run(sql`DELETE FROM profile_role_candidates WHERE table_id = ${roles.table_id}`);
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
