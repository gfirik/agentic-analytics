// What the analysis asks of the stored column roles (semantics §1, `profile_roles`): the roles are the detector's
// proposals or the user's confirmation, stored next to the profile. A role the user dropped is stored as `none`.
import { sql, type Workspace } from "@agentic-analytics/store";

/** One stored role of a column. */
export type RoleRow = {
  readonly column_name: string;
  readonly role: string;
};

/** The roles of a table's columns, best score first. */
export function tableRoles(ws: Workspace, tableId: string): Promise<RoleRow[]> {
  return ws.all<RoleRow>(sql`SELECT column_name, role FROM profile_roles WHERE table_id = ${tableId} ORDER BY score DESC, column_name`);
}

/** The columns of a table that have one of `roles`, best score first. */
export async function columnsWithRole(ws: Workspace, tableId: string, roles: readonly string[]): Promise<string[]> {
  return (await tableRoles(ws, tableId)).filter((r) => roles.includes(r.role)).map((r) => r.column_name);
}

/** Whether any column of the job, in any table, holds one of `roles`. */
export async function anyColumnWithRole(ws: Workspace, roles: readonly string[]): Promise<boolean> {
  const rows = await ws.all<{ role: string }>(sql`SELECT DISTINCT role FROM profile_roles`);
  return rows.some((r) => roles.includes(r.role));
}
