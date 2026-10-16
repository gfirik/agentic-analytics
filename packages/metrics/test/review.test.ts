import { profileTable } from "@agentic-analytics/profile";
import type { MetricDef } from "@agentic-analytics/schema";
import { loadTable, type NormalizedTable, sql, Workspace } from "@agentic-analytics/store";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadCatalog,
  metricsYaml,
  parseMetricsYaml,
  type ReviewChoice,
  type ReviewIO,
  reviewMetrics,
  saveMetricDefs,
} from "../src/index.ts";

const open: Workspace[] = [];
afterEach(() => {
  for (const w of open.splice(0)) w.close();
});

const TABLE: NormalizedTable = {
  id: "T1",
  file_id: "F1",
  range: "A1:C4",
  hidden_sheet: false,
  header_rows: [1],
  notes: [],
  transposed: false,
  columns: [
    { name: "day", label: "Date", letter: "A", type: "date" },
    { name: "amount", label: "Amount", letter: "B", type: "currency", currency: "USD" },
    { name: "status", label: "Status", letter: "C", type: "category" },
  ],
  rows: [
    { row: 2, is_total: false, period: "2026-01", values: ["2026-01-05", 10, "paid"] },
    { row: 3, is_total: false, period: "2026-01", values: ["2026-01-09", 5, "refunded"] },
    { row: 4, is_total: false, period: "2026-02", values: ["2026-02-02", 20, "paid"] },
  ],
};

const base = { table: "t_t1", unit: "currency", currency: "USD", status: "assumed" } as const;
const DRAFTS: MetricDef[] = [
  { id: "revenue", label: "Revenue", type: "sum", expression: "amount", filters: ["status <> 'refunded'"], ...base },
  { id: "gross", label: "Gross", type: "sum", expression: "amount", ...base },
  {
    id: "refund_rate",
    label: "Refund rate",
    type: "ratio",
    numerator: { table: "t_t1", expression: "amount", filters: ["status = 'refunded'"] },
    denominator: { metric: "gross" },
    unit: "percent",
    status: "assumed",
  },
];

async function catalog() {
  const ws = await Workspace.open();
  open.push(ws);
  await loadTable(ws, TABLE);
  await profileTable(ws, TABLE, "day");
  return { ws, catalog: await loadCatalog(ws) };
}

/** Scripted IO: answers choices and edits in order, records everything shown. */
function scripted(choices: ReviewChoice[], edits: string[]): ReviewIO & { shown: string[] } {
  const shown: string[] = [];
  return {
    shown,
    show: (l) => shown.push(l),
    choose: async () => choices.shift() ?? "accept",
    edit: async () => edits.shift() ?? "",
  };
}

describe("metric review (confirm flow)", () => {
  it("--yes keeps every draft as an assumption without asking", async () => {
    const { catalog: c } = await catalog();
    const res = await reviewMetrics(DRAFTS, c, scripted([], []), { yes: true });
    expect(res.metrics.map((m) => [m.id, m.status])).toEqual([
      ["revenue", "assumed"],
      ["gross", "assumed"],
      ["refund_rate", "assumed"],
    ]);
  });

  it("accept confirms; an invalid edit is refused with its reason, a valid edit replaces the draft", async () => {
    const { catalog: c } = await catalog();
    const io = scripted(
      ["edit", "edit", "accept", "accept", "accept"],
      [
        "id: revenue\nlabel: Revenue\ntype: sum\ntable: t_t1\nexpression: amont\nunit: currency\ncurrency: USD\n",
        "id: revenue\nlabel: Net revenue\ntype: sum\ntable: t_t1\nexpression: amount\nfilters: [\"status = 'paid'\"]\nunit: currency\ncurrency: USD\n",
      ],
    );
    const res = await reviewMetrics(DRAFTS, c, io);
    expect(res.metrics.map((m) => [m.id, m.label, m.status])).toEqual([
      ["revenue", "Net revenue", "confirmed"],
      ["gross", "Gross", "confirmed"],
      ["refund_rate", "Refund rate", "confirmed"],
    ]);
    expect(io.shown).toContain('Not accepted: column "amont" does not exist in t_t1');
    expect(io.shown[0]).toBe("Revenue = sum of amount where status is not refunded, per month, in USD (assumed)");
  });

  it("dropping a metric drops the ratio that depends on it, with the reason", async () => {
    const { catalog: c } = await catalog();
    const res = await reviewMetrics(DRAFTS, c, scripted(["accept", "drop", "accept"], []));
    expect(res.metrics.map((m) => m.id)).toEqual(["revenue"]);
    expect(res.dropped.map((d) => d.id)).toEqual(["gross", "refund_rate"]);
    expect(res.dropped[1]?.reason).toContain('denominator metric "gross"');
  });

  it("saves definitions to metric_defs and round-trips the metrics YAML file", async () => {
    const { ws, catalog: c } = await catalog();
    const { metrics } = await reviewMetrics(DRAFTS, c, undefined);
    await saveMetricDefs(ws, metrics, c, { from: "2026-01", to: "2026-12" });
    const rows = await ws.all<{ id: string; status: string; sql: string }>(sql`SELECT id, status, sql FROM metric_defs ORDER BY id`);
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      ["gross", "assumed"],
      ["refund_rate", "assumed"],
      ["revenue", "assumed"],
    ]);
    expect(rows[2]?.sql).toContain('FROM "t_t1"');
    const file = parseMetricsYaml(metricsYaml(metrics, { objective: "Grow profit" }));
    expect(file.metrics).toEqual(metrics);
    expect(file.objective).toBe("Grow profit");
  });
});
