// The runner with margin-shaped metrics on a small hand-built workspace: a ratio of two derived metrics whose terms live in
// two tables (as a model's draft can have since validation orders a metric after the metrics it references) must not be
// split by rate vs mix (it has no table to group by), and the job must still complete.
import { ingest } from "@agentic-analytics/ingest";
import { loadCatalog, salesKpiPack, validateMetrics } from "@agentic-analytics/metrics";
import { profileJob } from "@agentic-analytics/profile";
import { Workspace } from "@agentic-analytics/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AnalysisResult, analyzeJob } from "../src/index.ts";

const months = ["01", "02", "03", "04", "05", "06", "07", "08"];
// Revenue 100 per store per month; costs 80 a month, then 140 in August: net = revenue − costs goes 120 → 60.
const orders = ["date,store,amount", ...months.flatMap((m) => [`2026-${m}-10,A,100`, `2026-${m}-12,B,100`])].join("\n");
const costs = ["date,cost", ...months.map((m) => `2026-${m}-01,${m === "08" ? 140 : 80}`)].join("\n");

let ws: Workspace;
let result: AnalysisResult;
beforeAll(async () => {
  ws = await Workspace.open();
  const enc = new TextEncoder();
  const summary = await profileJob(
    ws,
    await ingest([
      { name: "orders.csv", bytes: enc.encode(orders) },
      { name: "costs.csv", bytes: enc.encode(costs) },
    ]),
    { today: "2026-10-01" },
  );
  const table = (file: string) => summary.tables.find((t) => t.file === file)?.name as string;
  const catalog = await loadCatalog(ws);
  const v = validateMetrics(
    [
      {
        id: "revenue",
        label: "Revenue",
        type: "sum",
        table: table("orders.csv"),
        expression: "amount",
        unit: "currency",
        currency: "GBP",
        dimensions: ["store"],
      },
      { id: "costs", label: "Costs", type: "sum", table: table("costs.csv"), expression: "cost", unit: "currency", currency: "GBP" },
      { id: "net", label: "Net", type: "derived", expression: "revenue - costs", unit: "currency", currency: "GBP", dimensions: ["store"] },
      {
        id: "outlay",
        label: "Outlay",
        type: "derived",
        expression: "revenue + costs",
        unit: "currency",
        currency: "GBP",
        dimensions: ["store"],
      },
      { id: "net_pct", label: "Net %", type: "ratio", numerator: { metric: "net" }, denominator: { metric: "outlay" }, unit: "percent" },
    ],
    catalog,
  );
  // The ratio over the derived metrics is accepted, whichever order the draft lists them in.
  expect(v.rejected).toEqual([]);
  result = await analyzeJob(ws, v.accepted, catalog, { from: "2026-01", to: "2026-08" });
}, 120_000);
afterAll(() => ws.close());

describe("ratio over a derived metric", () => {
  it("is measured and found, and is not split by rate vs mix", () => {
    const shift = result.insights.find((i) => i.metric === "net_pct" && !i.member && i.material);
    expect(shift).toBeDefined();
    expect(result.decompositions.filter((d) => d.method === "ratemix.v1")).toEqual([]);
    expect(result.facts.every((f) => Number.isFinite(f.value))).toBe(true);
  });
});

// ── Two splits of one later period against different baselines ─────────────────────────────────────────────────

describe("margin PVM against two baselines of one period", () => {
  // 14 months (2025-02 … 2026-03), three products, five lines a month. In the last month product A's unit cost steps from
  // 6 to 9: the latest point is an anomaly against February (previous period) and a material change against March 2025 (the
  // year-ago baseline), so the margin is split twice for 2026-03 with different `before` periods.
  const month = (i: number) => `${2025 + Math.floor((1 + i) / 12)}-${String(((1 + i) % 12) + 1).padStart(2, "0")}`;
  const products = [
    ["A", 10, 6],
    ["B", 12, 7],
    ["C", 15, 9],
  ] as const;
  const rows = [
    "Date,Product,Qty,Unit Price,Std cost,Net Amount",
    ...Array.from({ length: 14 }, (_, i) =>
      products.flatMap(([name, price, cost]) =>
        Array.from({ length: 5 }, (_, l) => {
          const qty = 10 + ((l * 3 + name.charCodeAt(0)) % 5) + (name === "C" ? i % 2 : 0);
          const c = i === 13 && name === "A" ? 12 : cost;
          return `${month(i)}-${String(l + 2).padStart(2, "0")},${name},${qty},${price}.00,${c}.00,${(qty * price).toFixed(2)}`;
        }),
      ),
    ).flat(),
  ];

  it("completes; the previous-period split carries the fixed labels and the year-ago split does not", async () => {
    const w = await Workspace.open();
    try {
      const summary = await profileJob(w, await ingest([{ name: "lines.csv", bytes: new TextEncoder().encode(rows.join("\n")) }]), {
        today: "2026-04-03",
      });
      const catalog = await loadCatalog(w);
      const defs = validateMetrics(salesKpiPack(summary).defs, catalog, { defaultCurrency: "GBP" }).accepted;
      expect(defs.map((d) => d.id)).toContain("gross_margin");
      const r = await analyzeJob(w, defs, catalog, { from: "2025-02", to: "2026-03" });
      const latest = r.decompositions.filter(
        (d) => d.method === "pvm_margin.v1" && r.insights.find((i) => i.id === d.insight)?.period === "2026-03",
      );
      // Two or more baselines of 2026-03 were split (the previous period and a year ago) ...
      expect(new Set(latest.map((d) => r.insights.find((i) => i.id === d.insight)?.facts.before)).size).toBeGreaterThanOrEqual(2);
      // ... and the fixed label names exactly one fact, with the previous-period value (A's 2026-03 units × (12 − 6)).
      const fixed = r.facts.filter((f) => f.label === "pvm_margin.cost_2026-03");
      expect(fixed).toHaveLength(1);
      expect(fixed[0]?.value).toBeCloseTo(
        -rows.filter((l) => l.startsWith("2026-03") && l.split(",")[1] === "A").reduce((sum, l) => sum + Number(l.split(",")[2]) * 6, 0),
        9,
      );
      // The year-ago split is kept under a label that names its baseline.
      expect(r.facts.some((f) => /^pvm_margin\.v1 gross_margin 2026-03 from 2025-03 by product:pvm_margin:cost$/.test(f.label))).toBe(true);
    } finally {
      w.close();
    }
  }, 120_000);
});
