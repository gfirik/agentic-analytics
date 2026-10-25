// Re-drafting after a role change (semantics §5, metric-layer §3) and the columns a metric reads. Expectations are
// written by hand from the five-row table below.
import { ingest } from "@agentic-analytics/ingest";
import { profileJob } from "@agentic-analytics/profile";
import type { MetricDef } from "@agentic-analytics/schema";
import { Workspace } from "@agentic-analytics/store";
import { afterEach, describe, expect, it } from "vitest";
import { loadCatalog, metricColumns, parseConfirmYaml, redraftMetrics, rolesYaml } from "../src/index.ts";

const open: Workspace[] = [];
afterEach(() => {
  for (const w of open.splice(0)) w.close();
});

const CSV =
  "Date,Qty,Price,Amount\n2026-01-05,2,1.50,3.00\n2026-01-06,1,4.00,4.00\n2026-01-07,3,1.50,4.50\n2026-02-02,1,4.00,4.00\n2026-02-09,2,1.50,3.00\n";

async function setup() {
  const ws = await Workspace.open();
  open.push(ws);
  const summary = await profileJob(ws, await ingest([{ name: "s.csv", bytes: new TextEncoder().encode(CSV) }]), { today: "2026-07-01" });
  const catalog = await loadCatalog(ws);
  /** The summary as if the person had set `column` to `role`. */
  const withRole = (column: string, role: string) => {
    const first = summary.semantics.roles[0];
    if (!first) throw new Error("no roles");
    const columns = first.columns.map((c) => (c.column === column ? { ...c, role: role as typeof c.role } : c));
    return { ...summary, semantics: { ...summary.semantics, roles: [{ ...first, columns }] } };
  };
  return { summary, catalog, withRole };
}

describe("redraftMetrics", () => {
  it("rebuilds the deterministic drafts from the roles: without an amount role, revenue is quantity × unit price", async () => {
    const { summary, catalog, withRole } = await setup();
    const expression = (s: typeof summary) =>
      redraftMetrics(s, catalog, { source: "fallback" }, { defaultCurrency: "USD" }).accepted.find((d) => d.id === "revenue")?.expression;
    expect(expression(summary)).toBe("amount");
    expect(expression(withRole("amount", "measure"))).toBe("qty * price");
    // the same inputs always give the same drafts
    expect(redraftMetrics(withRole("amount", "measure"), catalog, { source: "fallback" }, { defaultCurrency: "USD" })).toEqual(
      redraftMetrics(withRole("amount", "measure"), catalog, { source: "fallback" }, { defaultCurrency: "USD" }),
    );
  });

  it("a model's draft is validated again as proposed, whatever the roles say; it is not asked again", async () => {
    const { catalog, withRole } = await setup();
    const proposals = [{ id: "sales", label: "Sales", type: "sum", table: "t_t1", expression: "amount", unit: "currency" }];
    const v = redraftMetrics(withRole("amount", "none"), catalog, { source: "model", proposals }, { defaultCurrency: "USD" });
    // The pack is rebuilt from the roles (no amount role: quantity × unit price, and units); the model's draft is kept
    // as proposed and merged after it.
    expect(v.accepted.map((d) => [d.id, d.expression])).toEqual([
      ["revenue", "qty * price"],
      ["units", "qty"],
      ["sales", "amount"],
    ]);
  });

  it("with no role to draft from, nothing is drafted", async () => {
    const { catalog, summary } = await setup();
    const none = { ...summary, semantics: { ...summary.semantics, roles: [] } };
    expect(redraftMetrics(none, catalog, { source: "fallback" }, { defaultCurrency: "USD" }).accepted).toEqual([]);
  });
});

describe("metricColumns", () => {
  const revenue: MetricDef = {
    id: "revenue",
    label: "Revenue",
    type: "sum",
    table: "t_t1",
    expression: "qty * price",
    filters: ["status <> 'refunded' AND region IN ('a', 'b')"],
    time_column: "order_date",
    unit: "currency",
    currency: "USD",
    dimensions: ["channel"],
    status: "assumed",
  };
  const rate: MetricDef = {
    id: "refund_rate",
    label: "Refund rate",
    type: "ratio",
    numerator: { table: "t_t1", expression: "refund", filters: ["status = 'refunded'"] },
    denominator: { metric: "revenue" },
    unit: "percent",
    status: "assumed",
  };

  it("lists every column an expression, filter, time column, dimension or ratio term reads, once", () => {
    expect(metricColumns(revenue).map((c) => c.column)).toEqual(["qty", "price", "status", "region", "order_date", "channel"]);
    expect(metricColumns(rate, [revenue, rate]).map((c) => `${c.table}.${c.column}`)).toEqual([
      "t_t1.refund",
      "t_t1.status",
      "t_t1.qty",
      "t_t1.price",
      "t_t1.region",
      "t_t1.order_date",
      "t_t1.channel",
    ]);
  });
});

describe("the confirmation body", () => {
  it("may leave out the metrics (and the grain) to revise roles only", () => {
    const body = rolesYaml([{ table: "t_t1", column: "qty", role: "quantity" }], { business_model: { model: "retail" } });
    expect(parseConfirmYaml(body)).toEqual({
      version: 1,
      grain: "month",
      roles: [{ table: "t_t1", column: "qty", role: "quantity" }],
      business_model: { model: "retail" },
    });
    expect(parseConfirmYaml("version: 1\nroles:\n  - { table: t_t1, column: qty, role: none }\n").metrics).toBeUndefined();
  });
});
