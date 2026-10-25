// The confirm screen's edits (docs/specs/semantics.md §5): a person accepts, changes or drops roles and may set the
// business model. Everything is checked before anything is written (a refused request applies nothing); a changed role
// re-classifies its table's kind and re-infers the business model, so every reader of roles sees the confirmed ones.
import { sql, type Workspace } from "@agentic-analytics/store";
import { BUSINESS_MODELS, type BusinessModel, type BusinessModelName, inferBusinessModel, type ModelTable } from "./business.ts";
import type { ColumnRoles, TableRoles } from "./detect.ts";
import { RoleError } from "./errors.ts";
import { classifyTable, type KindResult } from "./kinds.ts";
import type { SemanticsSummary } from "./report.ts";
import { saveTableKind } from "./store.ts";
import { parseRole, type Role } from "./vocabulary.ts";

/** One role the person posted. `table` is the table's name (`t_t1`, as metrics use) or its id (`T1`). */
export interface RoleEdit {
  readonly table: string;
  readonly column: string;
  readonly role: string;
}

/** The tables of a profile that the revision needs (a subset of `ProfileSummary["tables"]`). */
export interface RevisableTable {
  readonly table_id: string;
  readonly name: string;
  readonly file: string;
  readonly sheet?: string | undefined;
  readonly detail_rows: number;
  readonly date_column?: string | undefined;
  readonly columns: readonly { readonly name: string; readonly min_value: string | null; readonly max_value: string | null }[];
}

export interface RoleChange {
  readonly table_id: string;
  readonly column: string;
  readonly from: Role;
  readonly to: Role;
}

export interface Revision {
  readonly semantics: SemanticsSummary;
  /** Roles whose value the person changed (accepting a role as proposed is not a change). */
  readonly changed: readonly RoleChange[];
  /** Roles the person confirmed, changed or not. */
  readonly confirmed: number;
  readonly business_model_changed: boolean;
}

interface Resolved {
  readonly table: RevisableTable;
  readonly column: string;
  readonly role: Role;
}

/** Resolves and validates every edit; throws the first problem as a typed error before anything is written. */
function resolve(tables: readonly RevisableTable[], edits: readonly RoleEdit[]): Resolved[] {
  const byColumn = new Map<string, Resolved>();
  for (const e of edits) {
    const role = parseRole(e.role);
    const table = tables.find((t) => t.name === e.table) ?? tables.find((t) => t.table_id === e.table);
    if (!table) throw new RoleError("UNKNOWN_COLUMN", `table "${e.table}" does not exist (column "${e.column}")`);
    if (!table.columns.some((c) => c.name === e.column))
      throw new RoleError("UNKNOWN_COLUMN", `table ${table.name} has no column "${e.column}"`);
    // The last entry for a column wins, as in any YAML override.
    byColumn.set(`${table.table_id}/${e.column}`, { table, column: e.column, role });
  }
  return [...byColumn.values()];
}

const modelTables = (tables: readonly RevisableTable[], roles: readonly TableRoles[], kinds: readonly KindResult[]): ModelTable[] =>
  kinds.map((kind) => {
    const t = tables.find((x) => x.table_id === kind.table_id);
    return {
      kind,
      roles: roles.find((r) => r.table_id === kind.table_id) as TableRoles,
      detail_rows: t?.detail_rows ?? 0,
      date_column: t?.date_column,
    };
  });

export { modelTables };

/**
 * Applies a person's role edits. `status` becomes `confirmed` and `source` `user` for every role posted; a role posted
 * with a different value than the proposal gets the user's own evidence in place of the detector's. Table kinds of the
 * touched tables are re-classified, and the business model is re-inferred unless the person set it.
 */
export async function reviseSemantics(
  ws: Workspace,
  tables: readonly RevisableTable[],
  current: SemanticsSummary,
  edits: readonly RoleEdit[],
  businessModel?: { readonly model: string },
): Promise<Revision> {
  const resolved = resolve(tables, edits);
  let model: BusinessModelName | undefined;
  if (businessModel) {
    if (!(BUSINESS_MODELS as readonly string[]).includes(businessModel.model))
      throw new RoleError("UNKNOWN_BUSINESS_MODEL", `"${businessModel.model}" is not a business model (${BUSINESS_MODELS.join(", ")})`);
    model = businessModel.model as BusinessModelName;
  }

  const changed: RoleChange[] = [];
  const touched = new Set<string>();
  const roles: TableRoles[] = [];
  for (const t of current.roles) {
    const mine = resolved.filter((r) => r.table.table_id === t.table_id);
    if (!mine.length) {
      roles.push(t);
      continue;
    }
    touched.add(t.table_id);
    const columns: ColumnRoles[] = t.columns.map((c) => {
      const edit = mine.find((r) => r.column === c.column);
      if (!edit || edit.role === c.role) return c;
      changed.push({ table_id: t.table_id, column: c.column, from: c.role, to: edit.role });
      return {
        ...c,
        role: edit.role,
        // The user's word outranks every candidate: readers that rank by score pick it first.
        score: 1,
        source: "user" as const,
        evidence: [
          {
            signal: "user" as const,
            text: edit.role === "none" ? `no role: dropped by the user (proposed ${c.role})` : `set by the user (proposed ${c.role})`,
            weight: 1,
          },
        ],
      };
    });
    // A year/month pair that is no longer a period is not the table's period (semantics §2.1).
    const parts = t.period_parts;
    const stale = parts && [parts.year, parts.month].some((p) => p !== undefined && columns.find((c) => c.column === p)?.role !== "period");
    const { period_parts: _dropped, ...rest } = t;
    roles.push({ ...rest, columns, ...(parts && !stale ? { period_parts: parts } : {}) });
  }

  // Writes, after every check. `status` confirmed for each role posted; the new value for the changed ones.
  for (const r of resolved) {
    const row = roles.find((t) => t.table_id === r.table.table_id)?.columns.find((c) => c.column === r.column);
    if (!row) continue;
    await ws.run(
      sql`UPDATE profile_roles SET role = ${row.role}, score = ${row.score}, status = 'confirmed', source = ${row.source}, evidence_json = ${JSON.stringify(row.evidence)}::JSON WHERE table_id = ${r.table.table_id} AND column_name = ${r.column}`,
    );
  }

  const kinds: KindResult[] = [];
  for (const k of current.table_kinds) {
    if (!touched.has(k.table_id) || !changed.some((c) => c.table_id === k.table_id)) {
      kinds.push(k);
      continue;
    }
    const t = tables.find((x) => x.table_id === k.table_id) as RevisableTable;
    const r = roles.find((x) => x.table_id === k.table_id) as TableRoles;
    const kind = await classifyTable(ws, r, t, [t.name, t.file, t.sheet ?? ""].filter(Boolean));
    await saveTableKind(ws, kind);
    kinds.push(kind);
  }

  // The business model follows the roles unless a person set it (now or on an earlier edit).
  const priorChoice = current.business_model.status === "confirmed";
  let business: BusinessModel;
  if (model !== undefined) {
    const inferred = await inferBusinessModel(ws, modelTables(tables, roles, kinds));
    business =
      inferred.model === model
        ? { ...inferred, status: "confirmed" }
        : { model, signals: [{ text: "set by the user", holds: true }], status: "confirmed" };
  } else if (priorChoice || !changed.length) {
    business = current.business_model;
  } else {
    business = await inferBusinessModel(ws, modelTables(tables, roles, kinds));
  }

  return {
    semantics: { roles, table_kinds: kinds, business_model: business },
    changed,
    confirmed: resolved.length,
    business_model_changed: business.model !== current.business_model.model || business.status !== current.business_model.status,
  };
}
