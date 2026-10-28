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

/** Whether any column of the job, in any table, holds one of `roles`; the roles are a parameter, filtered in SQL. */
export async function anyColumnWithRole(ws: Workspace, roles: readonly string[]): Promise<boolean> {
  const hit = await ws.one(sql`SELECT 1 AS hit FROM profile_roles WHERE list_contains(${JSON.stringify(roles)}::VARCHAR[], role) LIMIT 1`);
  return hit !== undefined;
}
