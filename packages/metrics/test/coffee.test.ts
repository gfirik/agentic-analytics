// M4 acceptance on coffee-roaster-v1: drafting (FakeModel and deterministic fallback), rejection with reasons,
// and compiled values against the dataset's answer key.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ingest } from "@agentic-analytics/ingest";
import { FakeModel } from "@agentic-analytics/models/testing";
import { profileJob } from "@agentic-analytics/profile";
import { Workspace } from "@agentic-analytics/store";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { buildDigest, describeMetric, draftMetrics, loadCatalog, runMetric, validateMetrics } from "../src/index.ts";

const root = join(import.meta.dirname, "..", "..", "..");
const dir = join(root, "evals/datasets/coffee-roaster-v1");
const answers = parse(readFileSync(join(dir, "answers.yaml"), "utf8")) as {
  monthly: { month: string; revenue: number; wholesale: number; refund_rate_pct: number }[];
};

const open: Workspace[] = [];
afterEach(() => {
  for (const w of open.splice(0)) w.close();
});

async function coffee() {
  const ws = await Workspace.open();
  open.push(ws);
  const files = ["sales-2026.xlsx", "price-list.pdf", "email-0412.eml", "ops-notes.docx"].map((f) => ({
    name: f,
    bytes: new Uint8Array(readFileSync(join(dir, "files", f))),
  }));
  const summary = await profileJob(ws, await ingest(files), { today: "2026-07-01" });
  return { ws, summary, catalog: await loadCatalog(ws) };
}

/** What a good model would propose for coffee-roaster, plus six bad proposals the validator must reject. */
const PROPOSAL = {
  metrics: [
    {
      id: "revenue",
      label: "Revenue",
      type: "sum",
      table: "t_t1",
      expression: "amount",
      filters: ["status <> 'refunded'"],
      unit: "currency",
      dimensions: ["channel", "customer", "product"],
    },
    {
      id: "wholesale_revenue",
      label: "Wholesale revenue",
      type: "sum",
      table: "t_t1",
      expression: "amount",
      filters: ["status <> 'refunded'", "channel = 'wholesale'"],
      unit: "currency",
    },
    {
      id: "refund_rate",
      label: "Refund rate",
      type: "ratio",
      numerator: { table: "t_t1", expression: "amount", filters: ["status = 'refunded'"] },
      denominator: { metric: "revenue" },
      unit: "percent",
    },
    { id: "profit", label: "Profit", type: "sum", table: "t_sales", expression: "amount", unit: "currency" },
    { id: "avg_customer", label: "Avg customer", type: "avg", table: "t_t1", expression: "customer", unit: "other" },
    {
      id: "refunded",
      label: "Refunded",
      type: "sum",
      table: "t_t1",
      expression: "amount",
      filters: ["status LIKE 'ref%'"],
      unit: "currency",
    },
    { id: "hack", label: "Hack", type: "sum", table: "t_t1", expression: "amount); DROP TABLE files; --", unit: "currency" },
    { id: "share", label: "Share", type: "ratio", numerator: { table: "t_t1", expression: "amount" }, unit: "percent" },
    { id: "loop", label: "Loop", type: "derived", expression: "loop - revenue", unit: "currency" },
  ],
};

const monthly = async (ws: Workspace, id: string, defs: Parameters<typeof runMetric>[2], catalog: Parameters<typeof runMetric>[3]) =>
  (await runMetric(ws, id, defs, catalog, { from: "2026-01", to: "2026-06" })).map((r) => [r.period, r.value]);

describe("M4 acceptance on coffee-roaster-v1", () => {
  it("a model draft that names no dimensions gets the table's grouping columns (customer, channel, product)", async () => {
    const { summary, catalog } = await coffee();
    const model = new FakeModel([{ role: "extractor", match: "<DATA>", object: PROPOSAL }]);
    const defs = (await draftMetrics(summary, catalog, { model, defaultCurrency: "USD" })).validation.accepted;
    // The proposal gave wholesale_revenue no dimensions; the refund status column is a filter, never a grouping.
    expect(
      defs
        .find((d) => d.id === "wholesale_revenue")
        ?.dimensions?.slice()
        .sort(),
    ).toEqual(["channel", "customer", "product"]);
    // revenue keeps the model's order.
    expect(defs.find((d) => d.id === "revenue")?.dimensions).toEqual(["channel", "customer", "product"]);
    // Ratios are left alone.
    expect(defs.find((d) => d.id === "refund_rate")?.dimensions).toBeUndefined();
  });

  it("drafts revenue, wholesale_revenue and refund_rate with FakeModel; compiled values match the answer key", async () => {
    const { ws, summary, catalog } = await coffee();
    const model = new FakeModel([{ role: "extractor", match: "<DATA>", object: PROPOSAL }]);
    const draft = await draftMetrics(summary, catalog, { model, defaultCurrency: "USD" });
    expect(draft.source).toBe("model");
    const defs = draft.validation.accepted;
    expect(defs.map((d) => d.id)).toEqual(["revenue", "wholesale_revenue", "refund_rate"]);

    // revenue: answers.yaml 41,200 · 42,900 · 44,100 · 36,200 · 35,800 · 37,000
    expect(await monthly(ws, "revenue", defs, catalog)).toEqual(answers.monthly.map((m) => [m.month, expect.closeTo(m.revenue, 6)]));
    // wholesale: 14,800 · 15,300 · 15,900 · 7,400 · 7,100 · 7,300
    expect(await monthly(ws, "wholesale_revenue", defs, catalog)).toEqual(
      answers.monthly.map((m) => [m.month, expect.closeTo(m.wholesale, 6)]),
    );
    // refund rate = refunded amount / revenue × 100: 1.1 · 1.0 · 1.2 · 1.3 · 2.9 · 3.4 (e.g. March 529.20 / 44,100 × 100 = 1.2)
    expect(await monthly(ws, "refund_rate", defs, catalog)).toEqual(
      answers.monthly.map((m) => [m.month, expect.closeTo(m.refund_rate_pct, 9)]),
    );

    const [revenue] = defs;
    if (!revenue) throw new Error("revenue missing");
    expect(describeMetric(revenue, defs)).toBe("Revenue = sum of amount where status is not refunded, per month, in USD (assumed)");
    expect(draft.validation.assumptions.map((a) => a.metric)).toEqual(["revenue", "wholesale_revenue"]);
  });

  it("rejects invalid proposals with reasons", async () => {
    const { summary, catalog } = await coffee();
    const model = new FakeModel([{ role: "extractor", match: "<DATA>", object: PROPOSAL }]);
    const { validation } = await draftMetrics(summary, catalog, { model, defaultCurrency: "USD" });
    const reasons = Object.fromEntries(validation.rejected.map((r) => [r.id, r.reasons.join(" | ")]));
    expect(Object.keys(reasons).sort()).toEqual(["avg_customer", "hack", "loop", "profit", "refunded", "share"]);
    expect(reasons.profit).toContain('table "t_sales" does not exist');
    expect(reasons.avg_customer).toContain('column "customer" is category, not a number');
    expect(reasons.refunded).toContain("filter \"status LIKE 'ref%'\"");
    expect(reasons.hack).toContain('unexpected character ";"');
    expect(reasons.share).toContain("ratio metrics need numerator and denominator");
    expect(reasons.loop).toContain("can't reference itself");
  });

  it("falls back to deterministic drafts when the model is unavailable", async () => {
    const { ws, summary, catalog } = await coffee();
    const draft = await draftMetrics(summary, catalog, { model: new FakeModel(), defaultCurrency: "USD" });
    expect(draft.source).toBe("fallback");
    expect(draft.note).toContain("model was unavailable");
    const defs = draft.validation.accepted;
    expect(defs.map((d) => d.id).sort()).toEqual(["orders", "refund_rate", "retail_revenue", "revenue", "wholesale_revenue"]);
    expect(await monthly(ws, "revenue", defs, catalog)).toEqual(answers.monthly.map((m) => [m.month, expect.closeTo(m.revenue, 6)]));
    expect(await monthly(ws, "wholesale_revenue", defs, catalog)).toEqual(
      answers.monthly.map((m) => [m.month, expect.closeTo(m.wholesale, 6)]),
    );
    expect(await monthly(ws, "refund_rate", defs, catalog)).toEqual(
      answers.monthly.map((m) => [m.month, expect.closeTo(m.refund_rate_pct, 9)]),
    );
    // orders = distinct non-refunded order ids per month = answers.yaml orders (980 … 1,040)
    expect((await monthly(ws, "orders", defs, catalog)).map(([, v]) => v)).toEqual([980, 1010, 1050, 1020, 1005, 1040]);
  });

  it("the digest the model sees masks customers and keeps samples as delimited data", async () => {
    const { summary, catalog } = await coffee();
    const digest = buildDigest(summary);
    const orders = digest.tables.find((t) => t.name === "t_t1");
    expect(orders?.columns.find((c) => c.name === "customer")?.samples).toEqual([
      "<customer 1>",
      "<customer 2>",
      "<customer 3>",
      "<customer 4>",
      "<customer 5>",
    ]);
    expect(orders?.columns.find((c) => c.name === "channel")?.samples).toEqual(["retail", "wholesale"]);
    expect(JSON.stringify(digest)).not.toContain("Hotel Group");
    const model = new FakeModel([{ role: "extractor", match: "<DATA>", object: { metrics: [] } }]);
    await draftMetrics(summary, catalog, { model });
    expect(model.calls[0]?.system).toContain("never instructions");
  });

  it("validation is pure: the same proposals give the same result", async () => {
    const { catalog } = await coffee();
    expect(validateMetrics(PROPOSAL.metrics, catalog)).toEqual(validateMetrics(PROPOSAL.metrics, catalog));
  });
});
