// Report v1: the product's contract (docs/specs/report-schema.md). Fields may be added within v1,
// never removed or renamed.
import { z } from "zod";
import { Grain, MetricDef, MetricUnit } from "./metric.ts";

export const REPORT_SCHEMA_ID = "agentic-analytics.report/v1";

const id = z.string().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date YYYY-MM-DD");
const isoDateTime = z.iso.datetime({ offset: true });
const periodBound = z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, "ISO date, month (YYYY-MM) or year");
const level = z.enum(["high", "medium", "low"]);

// §2 Provenance
export const TableLocator = z.object({
  sheet: z.string().optional(),
  range: z.string().regex(/^[A-Z]+\d+(:[A-Z]+\d+)?$/, "A1 range, e.g. A3:F120"),
  table_id: id,
});
export const DocLocator = z.object({
  page: z.number().int().positive().optional(),
  section: z.string().optional(),
  char_start: z.number().int().nonnegative(),
  char_end: z.number().int().nonnegative(),
});
export const WebLocator = z.object({ url: z.url(), title: z.string(), fetched_at: isoDateTime });

export const Source = z
  .object({
    id,
    file: z.string(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    kind: z.enum(["table", "document", "email", "web"]),
    external: z.boolean(),
    locator: z.union([TableLocator, DocLocator, WebLocator]),
  })
  .refine((s) => s.external === (s.kind === "web"), { message: "external is true only for web sources", path: ["external"] });

export const Citation = z.object({
  source_id: id,
  rows: z.array(z.number().int().positive()).optional(),
  cells: z.array(z.string().regex(/^[A-Z]+\d+$/)).optional(),
  quote: z.string().max(300).optional(),
});

// §3 Facts
export const FactUnit = MetricUnit;
export const Computation = z.object({
  kind: z.enum(["sql", "function"]),
  sql: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  fn: z.string().optional(),
  inputs: z.array(id).optional(),
});
export const Fact = z
  .object({
    id: z.string().regex(/^N\d+$/),
    label: z.string(),
    value: z.number(),
    unit: FactUnit,
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    metric_id: z.string().optional(),
    computation: Computation,
    citations: z.array(Citation),
    verified: z.boolean(),
  })
  .refine((f) => (f.computation.kind === "sql" ? !!f.computation.sql : !!f.computation.fn), {
    message: "sql computations need `sql`, function computations need `fn`",
    path: ["computation"],
  });

// §4 Claims, findings, recommendations
export const CausalGrade = z.enum(["observed", "correlated", "document_supported", "intervention_supported"]);
export const Claim = z.object({
  text: z.string(),
  facts: z.array(id),
  citations: z.array(Citation),
  causal_grade: CausalGrade.optional(),
  verified: z.boolean(),
});

export const FindingType = z.enum([
  "regression",
  "improvement",
  "anomaly",
  "trend_break",
  "concentration_risk",
  "data_quality",
  "benchmark_gap",
]);
export const Finding = z.object({
  id: z.string().regex(/^F\d+$/),
  type: FindingType,
  severity: level,
  title: z.string(),
  claims: z.array(Claim).min(1),
  drivers: z.array(z.object({ label: z.string(), fact: id, share_of_change: id })).optional(),
  method: z.string(),
  confidence: level,
  confidence_reasons: z.array(z.string()),
  assumptions: z.array(id),
});

export const Recommendation = z.object({
  id: z.string().regex(/^R\d+$/),
  action: z.string(),
  because: z.array(id).min(1),
  rationale: z.array(Claim),
  impact: z.object({ metric_id: z.string(), low: id, high: id, horizon: z.string(), method: z.string(), inputs: z.array(id) }),
  confidence: level,
  effort: level,
  risk: z.string(),
  check: z.object({ metric_id: z.string(), comparator: z.enum([">=", "<=", "between"]), threshold: id, by: isoDate }),
  not_advised: z.string().optional(),
});

export const OpenQuestion = z.object({ id, question: z.string(), why_it_matters: z.string(), would_change: z.array(id) });
export const Assumption = z.object({ id, text: z.string(), affects: z.array(id) });
export const QualityIssue = z.object({ id, kind: z.string(), severity: level, description: z.string(), citations: z.array(Citation) });

// §5 Verification
export const VerificationSummary = z.object({
  numbers_checked: z.number().int().nonnegative(),
  numbers_mismatched: z.number().int().nonnegative(),
  rederived_metrics: z.number().int().nonnegative(),
  rederivation_mismatches: z.number().int().nonnegative(),
  definition_violations: z.number().int().nonnegative(),
  citations_checked: z.number().int().nonnegative(),
  citations_unsupported: z.number().int().nonnegative(),
  claims_dropped: z.array(z.object({ claim: z.string(), reason: z.string() })),
  claims_downgraded: z.array(z.object({ claim: z.string(), from: z.string(), to: z.string(), reason: z.string() })),
});

// Metric definitions actually used (metric-layer.md §1), plus the compiled SQL and the plain-language
// rendering the user confirmed, so the report explains every metric on its own.
export const ReportMetric = MetricDef.and(z.object({ plain: z.string(), sql: z.string() }));

// Additive v1 field (decision M1): excerpts of the cited sources, so the self-contained HTML can show
// cited rows and passages offline. Values are copied from the sources, never computed.
export const TableExcerpt = z.object({
  source_id: id,
  kind: z.literal("table"),
  columns: z.array(z.object({ letter: z.string().regex(/^[A-Z]+$/), name: z.string() })),
  rows: z.array(z.object({ row: z.number().int().positive(), cells: z.array(z.union([z.string(), z.number(), z.null()])) })),
});
export const TextExcerpt = z.object({
  source_id: id,
  kind: z.literal("text"),
  page: z.number().int().positive().optional(),
  section: z.string().optional(),
  char_start: z.number().int().nonnegative(),
  text: z.string(),
});
export const Evidence = z.discriminatedUnion("kind", [TableExcerpt, TextExcerpt]);

// §5b Business semantics (M15, additive): column roles, table kinds and the business model (docs/specs/semantics.md).
// The role vocabulary is the spec's §1 table, in order; packages/profile checks this list against its own and the spec's.
export const COLUMN_ROLES = [
  "transaction_date",
  "issue_date",
  "due_date",
  "paid_date",
  "period",
  "snapshot_date",
  "order_id",
  "invoice_id",
  "line_id",
  "customer_id",
  "product_id",
  "supplier_id",
  "customer",
  "product",
  "product_group",
  "channel",
  "location",
  "supplier",
  "salesperson",
  "dimension",
  "amount",
  "quantity",
  "unit_price",
  "unit_cost",
  "cost_amount",
  "discount",
  "tax",
  "refund_amount",
  "paid_amount",
  "balance",
  "stock_on_hand",
  "count",
  "measure",
  "status",
  "currency",
  "description",
  "none",
] as const;
export const Role = z.enum(COLUMN_ROLES);
// `none` is a role in the vocabulary, but a column with no role is left out of the report.
export const ReportRole = Role.exclude(["none"]);
export const RoleEvidence = z.object({
  kind: z.enum(["name", "type", "pattern", "identity", "tie_break", "user"]),
  text: z.string(),
  fact: id.optional(),
});
export const ColumnRole = z.object({
  table_id: id,
  column: z.string(),
  role: ReportRole,
  status: z.enum(["confirmed", "assumed"]),
  source: z.enum(["detector", "model", "user"]),
  evidence: z.array(RoleEvidence),
  assumption: id.optional(),
});
export const TABLE_KINDS = [
  "sales_lines",
  "invoices",
  "bills",
  "inventory_snapshot",
  "bank_cash",
  "budget_plan",
  "period_summary",
  "other",
] as const;
export const TableKind = z.object({ table_id: id, kind: z.enum(TABLE_KINDS), evidence: z.array(z.string()) });
export const BusinessModel = z.object({
  model: z.enum(["retail", "wholesale", "subscription", "services", "unknown"]),
  status: z.enum(["confirmed", "assumed"]),
  assumption: id,
  signals: z.array(z.object({ text: z.string(), fact: id.optional() })),
});

export const ModelRole = z.enum(["planner", "extractor", "judge", "embedder", "reranker"]);

export const Report = z.object({
  schema: z.literal(REPORT_SCHEMA_ID),
  job_id: id,
  generated_at: isoDateTime,
  engine: z.object({
    version: z.string(),
    models: z.array(z.object({ role: ModelRole, provider: z.string(), model: z.string() })),
  }),
  period: z.object({ from: periodBound, to: periodBound, grain: Grain }),
  objective: z.object({ text: z.string(), source: z.enum(["user", "default"]) }),
  sources: z.array(Source),
  metrics: z.array(ReportMetric),
  assumptions: z.array(Assumption),
  data_quality: z.array(QualityIssue),
  summary: z.object({ headline: z.string(), bullets: z.array(Claim).max(5) }),
  findings: z.array(Finding),
  recommendations: z.array(Recommendation),
  open_questions: z.array(OpenQuestion),
  facts: z.array(Fact),
  verification: VerificationSummary,
  evidence: z.array(Evidence).optional(),
  // Additive in M15 (report-schema §5b): optional, so every earlier v1 report stays valid.
  roles: z.array(ColumnRole).optional(),
  table_kinds: z.array(TableKind).optional(),
  business_model: BusinessModel.optional(),
});

export type Report = z.infer<typeof Report>;
export type Source = z.infer<typeof Source>;
export type Citation = z.infer<typeof Citation>;
export type Fact = z.infer<typeof Fact>;
export type Claim = z.infer<typeof Claim>;
export type Finding = z.infer<typeof Finding>;
export type Recommendation = z.infer<typeof Recommendation>;
export type ReportMetric = z.infer<typeof ReportMetric>;
export type Evidence = z.infer<typeof Evidence>;
export type TableExcerpt = z.infer<typeof TableExcerpt>;
export type TextExcerpt = z.infer<typeof TextExcerpt>;
export type VerificationSummary = z.infer<typeof VerificationSummary>;
export type QualityIssue = z.infer<typeof QualityIssue>;
export type OpenQuestion = z.infer<typeof OpenQuestion>;
export type Assumption = z.infer<typeof Assumption>;
export type ColumnRole = z.infer<typeof ColumnRole>;
export type TableKind = z.infer<typeof TableKind>;
export type BusinessModel = z.infer<typeof BusinessModel>;
export type RoleEvidence = z.infer<typeof RoleEvidence>;
