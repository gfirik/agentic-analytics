import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReviewChoice, ReviewIO } from "@agentic-analytics/metrics";
import { FakeModel } from "@agentic-analytics/models/testing";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { runMetricsCommand } from "../src/metrics.ts";
import { ReviewEndedError } from "../src/prompt.ts";

const dir = join(import.meta.dirname, "..", "..", "..", "evals/datasets/coffee-roaster-v1/files");
const files = ["sales-2026.xlsx", "price-list.pdf", "email-0412.eml", "ops-notes.docx"].map((f) => ({
  name: f,
  bytes: new Uint8Array(readFileSync(join(dir, f))),
}));

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
    { id: "bogus", label: "Bogus", type: "sum", table: "t_t1", expression: "customer", unit: "currency" },
  ],
};

describe("aa metrics", () => {
  it("--yes with a model: drafts, reports rejections, prints plain words, SQL and values", async () => {
    const lines: string[] = [];
    const outcome = await runMetricsCommand(
      { files, yes: true, today: "2026-07-01", currency: "USD" },
      { out: (l) => lines.push(l), model: new FakeModel([{ role: "extractor", match: "<DATA>", object: PROPOSAL }]) },
    );
    expect(outcome).toMatchObject({ accepted: 9, rejected: 3, source: "model" });
    const text = lines.join("\n");
    expect(text).toContain('rejected bogus: column "customer" is category, not a number');
    expect(text).toContain(
      "Wholesale revenue = sum of amount where status is not refunded and channel is wholesale, per month, in USD (assumed)",
    );
    expect(text).toContain("2026-03 15900 · 2026-04 7400");
    expect(text).toContain("2026-05 2.9 · 2026-06 3.4");
    expect(parse(outcome.yaml).metrics.map((m: { id: string }) => m.id)).toEqual([
      "revenue",
      "orders",
      "units",
      "customers",
      "new_customers",
      "returning_customers",
      "aov",
      "refund_rate",
      "wholesale_revenue",
    ]);
  });

  it("interactive review confirms metrics, and a saved file reloads with its statuses", async () => {
    const choices: ReviewChoice[] = ["accept", "drop", "accept", "accept", "accept"];
    const io: ReviewIO = { show: () => {}, choose: async () => choices.shift() ?? "accept", edit: async () => "" };
    const first = await runMetricsCommand({ files, yes: false, today: "2026-07-01", currency: "USD" }, { out: () => {}, io });
    // fallback drafts the pack (revenue, orders, units, customers, new and returning, aov, refund_rate) and the channel slices;
    // orders was dropped, and aov, which divides by it, is refused when the file is read back.
    // Validation orders table metrics before ratios.
    const saved = parse(first.yaml).metrics as { id: string; status: string }[];
    expect(saved.map((m) => [m.id, m.status])).toEqual([
      ["revenue", "confirmed"],
      ["units", "confirmed"],
      ["customers", "confirmed"],
      ["new_customers", "confirmed"],
      ["returning_customers", "confirmed"],
      ["retail_revenue", "confirmed"],
      ["wholesale_revenue", "confirmed"],
      ["refund_rate", "confirmed"],
    ]);
    const lines: string[] = [];
    const again = await runMetricsCommand(
      { files, yes: true, today: "2026-07-01", metricsFile: first.yaml },
      { out: (l) => lines.push(l) },
    );
    expect(again).toMatchObject({ source: "file", accepted: 8 });
    expect(lines.join("\n")).not.toContain("(assumed)");
  });

  it("when the review's input ends (also mid-edit), it stops with a message and saves nothing", async () => {
    for (const during of ["choose", "edit"] as const) {
      const lines: string[] = [];
      const io: ReviewIO = {
        show: (l) => lines.push(l),
        async choose(): Promise<ReviewChoice> {
          if (during === "choose") throw new ReviewEndedError();
          return "edit";
        },
        async edit(): Promise<string> {
          throw new ReviewEndedError();
        },
      };
      const out = await runMetricsCommand({ files, yes: false, today: "2026-07-01", currency: "USD" }, { out: (l) => lines.push(l), io });
      expect(out).toMatchObject({ ended: true, accepted: 0, yaml: "" });
      expect(lines).toContain("The review ended before every metric was answered; nothing was saved.");
      expect(lines.some((l) => /isn't valid YAML/.test(l))).toBe(false);
    }
  }, 60_000);
});
