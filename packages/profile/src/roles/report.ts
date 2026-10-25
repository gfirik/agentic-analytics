// Roles, table kinds and the business model as the parts report.json carries (docs/specs/report-schema.md §5b,
// semantics §6). The measurements behind them (identity rates, revenue shares) are SQL facts; here they are plain
// records keyed by name, and the report builder gives them fact ids (`N…`) and replaces `{{key}}` in the texts.
import { sql, type Workspace } from "@agentic-analytics/store";
import type { BusinessModel } from "./business.ts";
import type { TableRoles } from "./detect.ts";
import type { KindResult } from "./kinds.ts";
import type { Evidence } from "./score.ts";

export interface SemanticsSummary {
  readonly roles: readonly TableRoles[];
  readonly table_kinds: readonly KindResult[];
  readonly business_model: BusinessModel;
}

export interface SemanticsFact {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly sql: { readonly text: string; readonly params: readonly (string | number | boolean | null | bigint)[] };
  /** The table the measurement is about (its citation). */
  readonly source_id: string;
}

export interface SemanticsRole {
  readonly table_id: string;
  readonly column: string;
  /** The column's header as written in the file: the confirm screen and role assumptions name it. */
  readonly label: string;
  readonly role: string;
  readonly status: "confirmed" | "assumed";
  readonly source: "detector" | "model" | "user";
  readonly evidence: readonly {
    readonly kind: "name" | "type" | "pattern" | "identity" | "tie_break" | "user";
    readonly text: string;
    readonly fact?: string;
  }[];
}

/** What `buildDraft` takes to fill `roles`, `table_kinds` and `business_model`. */
export interface SemanticsDraft {
  readonly roles: readonly SemanticsRole[];
  readonly table_kinds: readonly KindResult[];
  readonly business_model: {
    readonly model: BusinessModel["model"];
    readonly table_id?: string;
    readonly status: "confirmed" | "assumed";
    readonly signals: readonly { readonly text: string; readonly fact?: string }[];
  };
  readonly facts: readonly SemanticsFact[];
}

const KIND: Record<Evidence["signal"], SemanticsRole["evidence"][number]["kind"]> = {
  name: "name",
  type: "type",
  value: "pattern",
  identity: "identity",
  model: "tie_break",
  user: "user",
};

/**
 * The report's view of the PROFILE stage's semantics. A role is `assumed` until a person confirms it (`proposed` in the
 * workspace reads as `assumed` in the report: auto-confirm keeps every proposal, semantics §5). Columns with role `none`
 * are left out.
 */
export async function reportSemantics(ws: Workspace, s: SemanticsSummary): Promise<SemanticsDraft> {
  const roles: SemanticsRole[] = [];
  const facts = new Map<string, SemanticsFact>();
  for (const t of s.roles) {
    const stored = new Map(
      (
        await ws.all<{ column_name: string; status: string; source: string }>(
          sql`SELECT column_name, status, source FROM profile_roles WHERE table_id = ${t.table_id}`,
        )
      ).map((r) => [r.column_name, r]),
    );
    const identity = new Map(t.identities.map((i) => [i.fact, i]));
    for (const c of t.columns) {
      if (c.role === "none") continue;
      const row = stored.get(c.column);
      const evidence = c.evidence.map((e) => {
        const i = e.fact ? identity.get(e.fact) : undefined;
        if (i) facts.set(i.fact, { key: i.fact, label: i.fact, value: i.rate, sql: i.sql, source_id: t.table_id });
        return {
          kind: KIND[e.signal],
          text: i ? `${e.text} on {{${i.fact}}} of rows` : e.text,
          ...(i ? { fact: i.fact } : {}),
        };
      });
      roles.push({
        table_id: t.table_id,
        column: c.column,
        label: c.label,
        role: c.role,
        status: row?.status === "confirmed" ? "confirmed" : "assumed",
        source: (row?.source as SemanticsRole["source"] | undefined) ?? c.source,
        evidence,
      });
    }
  }
  for (const sig of s.business_model.signals) {
    if (!sig.fact) continue;
    facts.set(sig.fact.key, {
      key: sig.fact.key,
      label: sig.fact.key,
      value: sig.fact.value,
      sql: sig.fact.sql,
      source_id: s.business_model.table_id ?? "",
    });
  }
  return {
    roles,
    table_kinds: s.table_kinds,
    business_model: {
      model: s.business_model.model,
      ...(s.business_model.table_id ? { table_id: s.business_model.table_id } : {}),
      status: s.business_model.status ?? "assumed",
      signals: s.business_model.signals.map((x) => ({ text: x.text, ...(x.fact ? { fact: x.fact.key } : {}) })),
    },
    facts: [...facts.values()],
  };
}
