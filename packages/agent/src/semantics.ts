// Roles, table kinds and the business model as report parts (report-schema §5b, semantics §6). The PROFILE stage measured
// them (`reportSemantics` in packages/profile); here the measurements become facts with ids and computation records, the
// `{{key}}` placeholders in their texts become `{{N…}}`, and the business model becomes an assumption.
import { nextFactNumber, persistFacts } from "@agentic-analytics/analysis";
import { type Assumption, type BusinessModel, type ColumnRole, type Fact, screen, type TableKind } from "@agentic-analytics/schema";
import type { Workspace } from "@agentic-analytics/store";

/** The shape `reportSemantics` (packages/profile) returns; declared here so the agent needs no profile dependency. */
export interface SemanticsInput {
  readonly roles: readonly {
    readonly table_id: string;
    readonly column: string;
    readonly role: string;
    readonly status: "confirmed" | "assumed";
    readonly source: "detector" | "model" | "user";
    readonly evidence: readonly { readonly kind: ColumnRole["evidence"][number]["kind"]; readonly text: string; readonly fact?: string }[];
  }[];
  readonly table_kinds: readonly { readonly table_id: string; readonly kind: string; readonly evidence: readonly string[] }[];
  readonly business_model: {
    readonly model: BusinessModel["model"];
    /** The table the model was read from; when it is quarantined the model is not reported (security §3). */
    readonly table_id?: string;
    readonly status: "confirmed" | "assumed";
    readonly signals: readonly { readonly text: string; readonly fact?: string }[];
  };
  readonly facts: readonly {
    readonly key: string;
    readonly label: string;
    readonly value: number;
    readonly sql: { readonly text: string; readonly params: readonly (string | number | boolean | null | bigint)[] };
    readonly source_id: string;
  }[];
}

export interface SemanticsParts {
  readonly roles: ColumnRole[];
  readonly table_kinds: TableKind[];
  readonly business_model: BusinessModel;
  readonly facts: Fact[];
  readonly assumption: Assumption;
}

/** No numerals: the model's name and the reason it was chosen (semantics §4). */
const WORDING: Record<BusinessModel["model"], string> = {
  subscription: "steady recurring customers hold most of the revenue",
  wholesale: "a few customers or a wholesale channel hold most of the revenue",
  retail: "most revenue comes through retail or from sales with no customer record",
  services: "the sales rows carry neither a quantity nor a product",
  unknown: "no signal in the data decides it",
};

/**
 * `quarantined` are source ids: nothing about a quarantined table reaches the report, and a column whose name addresses
 * a model is left out too, as it is for metric dimensions (security §3).
 */
export async function semanticsParts(
  ws: Workspace,
  input: SemanticsInput,
  assumptionId: string,
  quarantined: readonly string[] = [],
): Promise<SemanticsParts> {
  const out = new Set(quarantined);
  const modelTable = input.business_model.table_id;
  const dropModel = modelTable !== undefined && out.has(modelTable);
  const s: SemanticsInput = {
    roles: input.roles.filter((r) => !out.has(r.table_id) && !screen(r.column)),
    table_kinds: input.table_kinds.filter((k) => !out.has(k.table_id)),
    business_model: dropModel ? { model: "unknown", status: input.business_model.status, signals: [] } : input.business_model,
    facts: input.facts.filter((f) => !out.has(f.source_id) && !(dropModel && f.source_id === modelTable)),
  };
  // Only the facts that a kept role's evidence or a kept signal names go into the report.
  const used = new Set([...s.roles.flatMap((r) => r.evidence.map((e) => e.fact)), ...s.business_model.signals.map((x) => x.fact)]);
  let next = await nextFactNumber(ws);
  const ids = new Map<string, string>();
  const facts: Fact[] = s.facts
    .filter((f) => used.has(f.key))
    .map((f) => {
      const id = `N${next++}`;
      ids.set(f.key, id);
      return {
        id,
        label: f.label,
        value: f.value,
        unit: "percent",
        computation: { kind: "sql", sql: f.sql.text, params: Object.fromEntries(f.sql.params.map((p, i) => [`$${i + 1}`, p])) },
        citations: f.source_id ? [{ source_id: f.source_id }] : [],
        verified: false,
      } satisfies Fact;
    });
  await persistFacts(ws, facts);
  const resolve = (text: string) => text.replace(/\{\{([^}]+)\}\}/g, (m, key: string) => (ids.has(key) ? `{{${ids.get(key)}}}` : m));
  const fact = (key?: string) => (key ? ids.get(key) : undefined);

  const roles = s.roles.map(
    (r) =>
      ({
        table_id: r.table_id,
        column: r.column,
        role: r.role,
        status: r.status,
        source: r.source,
        evidence: r.evidence.map((e) => ({
          kind: e.kind,
          text: resolve(e.text),
          ...(fact(e.fact) ? { fact: fact(e.fact) as string } : {}),
        })),
      }) as ColumnRole,
  );
  const model = s.business_model.model;
  return {
    roles,
    table_kinds: s.table_kinds.map((k) => ({ table_id: k.table_id, kind: k.kind as TableKind["kind"], evidence: [...k.evidence] })),
    business_model: {
      model,
      status: s.business_model.status,
      assumption: assumptionId,
      signals: s.business_model.signals.map((x) => ({ text: resolve(x.text), ...(fact(x.fact) ? { fact: fact(x.fact) as string } : {}) })),
    },
    facts,
    assumption: { id: assumptionId, text: `Business model assumed: ${model} (${WORDING[model]}).`, affects: [] },
  };
}
