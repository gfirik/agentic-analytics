// "Analyses not run" (analysis-library §13): built from the packs' required roles, deterministic and with no number. Part 1
// runs the real pipeline on a sales table without a cost column (coffee-roaster-v1) and on one with a cost column
// (wholesale-margin-v1); part 2 is the pure list on hand-made inputs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ingest } from "@agentic-analytics/ingest";
import { loadCatalog, salesKpiPack, validateMetrics } from "@agentic-analytics/metrics";
import { periodOf, profileJob } from "@agentic-analytics/profile";
import { findFreeNumerals, type NotRun } from "@agentic-analytics/schema";
import { Workspace } from "@agentic-analytics/store";
import { describe, expect, it } from "vitest";
import { analysesNotRun, analyzeJob } from "../src/index.ts";

const root = join(import.meta.dirname, "..", "..", "..", "evals/datasets");

/** Profile, the code-drafted KPI pack (with its not-drafted list) and the analysis, as the job runs them. */
async function notRunOf(file: string, today: string, currency: string, withPackGaps = true): Promise<NotRun[]> {
  const ws = await Workspace.open();
  try {
    const name = file.split("/").at(-1) as string;
    const summary = await profileJob(ws, await ingest([{ name, bytes: new Uint8Array(readFileSync(join(root, file))) }]), { today });
    const catalog = await loadCatalog(ws);
    const pack = salesKpiPack(summary);
    const defs = validateMetrics(pack.defs, catalog, { defaultCurrency: currency }).accepted;
    const periods = summary.tables
      .flatMap((t) => (t.date_first && t.date_last ? [periodOf(t.date_first, summary.grain), periodOf(t.date_last, summary.grain)] : []))
      .sort();
    const r = await analyzeJob(ws, defs, catalog, {
      from: periods[0] ?? "",
      to: periods.at(-1) ?? "",
      grain: summary.grain,
      notDrafted: withPackGaps ? pack.notDrafted : [],
    });
    return r.notRun;
  } finally {
    ws.close();
  }
}

const ids = (list: readonly NotRun[]) => list.map((n) => `${n.analysis}/${n.reason_code}`);

describe("the not-run list from real tables (§13)", () => {
  it("a sales table with no cost column: margin and margin PVM are not run (no_cost_role), nor contribution margin", async () => {
    const list = await notRunOf("coffee-roaster-v1/files/sales-2026.xlsx", "2026-07-01", "USD");
    expect(ids(list)).toEqual(
      expect.arrayContaining(["gross_margin/no_cost_role", "pvm_margin.v1/no_cost_role", "contribution_margin/no_variable_cost"]),
    );
    // Six months: no year-on-year, and no year before the trailing year for the Pareto classes.
    expect(ids(list)).toEqual(expect.arrayContaining(["yoy/too_few_periods", "pareto.v1/too_few_periods"]));
    // It has quantities and a product column, so price–volume–mix runs; it has a customer column and an order number.
    expect(ids(list).some((x) => x.startsWith("pvm.v1/"))).toBe(false);
    expect(ids(list).some((x) => x.startsWith("pareto.v1/no_dimension"))).toBe(false);
    expect(list.find((n) => n.analysis === "gross_margin")).toEqual({
      analysis: "gross_margin",
      reason_code: "no_cost_role",
      reason: "There is no cost column (unit cost or cost amount), so margin can't be computed.",
      needs: ["unit_cost", "cost_amount"],
    });
    for (const n of list) expect(findFreeNumerals(n.reason), n.reason).toEqual([]);
  }, 120_000);

  it("no cost column and no not-drafted margin (a table with no sales pack yet): margin is still listed from the stored roles", async () => {
    const list = await notRunOf("coffee-roaster-v1/files/sales-2026.xlsx", "2026-07-01", "USD", false);
    expect(ids(list)).toEqual(expect.arrayContaining(["gross_margin/no_cost_role", "pvm_margin.v1/no_cost_role"]));
  }, 120_000);

  it("a sales table with a cost column: margin runs, so neither margin analysis is listed", async () => {
    const list = await notRunOf("wholesale-margin-v1/files/invoice-lines.csv", "2026-07-03", "GBP");
    expect(ids(list).some((x) => x.startsWith("gross_margin/") || x.startsWith("pvm_margin.v1/"))).toBe(false);
    expect(ids(list)).toContain("contribution_margin/no_variable_cost");
    for (const n of list) expect(findFreeNumerals(n.reason), n.reason).toEqual([]);
  }, 120_000);
});

describe("analysesNotRun (§13)", () => {
  const base = { notDrafted: [], metrics: new Set<string>(), concentration: [], grain: "month" as const, periods: 24 };

  it("lists each missing KPI role as kpi.<id>, unless the person defined that metric", () => {
    const list = analysesNotRun({
      ...base,
      notDrafted: [
        { kpi: "aov", reason: "no_order_id" },
        { kpi: "discount_rate", reason: "no_discount_role" },
      ],
      metrics: new Set(["discount_rate"]),
    });
    expect(list).toEqual([
      {
        analysis: "kpi.aov",
        reason_code: "no_order_id",
        reason: "Average order value: there is no order or invoice number column.",
        needs: ["order_id", "invoice_id"],
      },
    ]);
  });

  it("lists PVM without a quantity or an item, and margin PVM with it when margin exists", () => {
    const list = analysesNotRun({ ...base, metrics: new Set(["gross_margin"]), sales: { sum: true, quantity: false, item: false } });
    expect(ids(list)).toEqual([
      "pvm_margin.v1/no_quantity_role",
      "pvm.v1/no_quantity_role",
      "pvm_margin.v1/no_item_dimension",
      "pvm.v1/no_item_dimension",
      "contribution_margin/no_variable_cost",
    ]);
  });

  it("says margin needs a quantity when the cost is a unit cost and there is none", () => {
    const list = analysesNotRun({ ...base, notDrafted: [{ kpi: "gross_margin", reason: "no_quantity_role" }] });
    expect(ids(list)).toEqual(["gross_margin/no_quantity_role", "pvm_margin.v1/no_quantity_role"]);
  });

  it("lists Pareto and concentration with no dimension, year-on-year by grain, and new customers in a first period", () => {
    const list = analysesNotRun({
      ...base,
      metrics: new Set(["new_customers"]),
      concentration: [
        { analysis: "pareto.v1", reason_code: "no_dimension" },
        { analysis: "concentration", reason_code: "no_dimension" },
      ],
      grain: "week",
      periods: 1,
    });
    expect(ids(list)).toEqual([
      "pareto.v1/no_dimension",
      "concentration/no_dimension",
      "yoy/grain_not_comparable",
      "kpi.new_customers/no_history",
    ]);
    for (const n of list) expect(findFreeNumerals(n.reason)).toEqual([]);
  });

  it("lists margin with no cost column anywhere, even when no sales pack was drafted (a year-and-month table)", () => {
    expect(ids(analysesNotRun({ ...base, costRole: false }))).toEqual(["gross_margin/no_cost_role", "pvm_margin.v1/no_cost_role"]);
    expect(analysesNotRun({ ...base, costRole: true })).toEqual([]);
    expect(analysesNotRun({ ...base, costRole: false, metrics: new Set(["gross_margin"]) })).toEqual([]);
  });

  it("is empty when everything ran", () => {
    expect(analysesNotRun(base)).toEqual([]);
  });
});
