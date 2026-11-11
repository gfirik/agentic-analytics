// Backtest pre-tag 4 (data-quality guards), end to end with the scripted baseline model: rows dated after --today
// never reach a measured period, and the data-quality section says so; a negative sales amount and a falling
// cumulative column reach the final report's data-quality list in plain words.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJob } from "@agentic-analytics/core";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { findFreeNumerals } from "@agentic-analytics/schema";
import { afterAll, describe, expect, it } from "vitest";
import { baselineModel } from "../src/baseline.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function run(csv: string, today = "2024-01-01") {
  const dir = mkdtempSync(join(tmpdir(), "aa-guards-"));
  dirs.push(dir);
  const { report } = await runJob(
    { dir, jobId: "guards", files: [{ name: "sales.csv", bytes: new TextEncoder().encode(csv) }], options: { today, currency: "USD" } },
    { model: baselineModel(), embedder: hashEmbedder() },
  );
  return report;
}

/** Twelve months of 2023, two products; each month's amount per product is `base + month`. */
const year2023 = (extra: string[] = [], amount = (m: number, base: number) => base + m) => {
  const rows = ["date,product,quantity,amount"];
  for (let m = 1; m <= 12; m++)
    for (const [p, base] of [
      ["tea", 1000],
      ["coffee", 500],
    ] as const)
      rows.push(`2023-${String(m).padStart(2, "0")}-15,${p},10,${amount(m, base)}`);
  return `${[...rows, ...extra].join("\n")}\n`;
};

describe("dates after today (backtest pre-tag 4a)", () => {
  // Two rows dated 2024-03 and 2024-09, after --today 2024-01-01, with a huge amount each.
  const future = ["2024-03-15,tea,10,900000", "2024-09-15,coffee,10,800000"];

  it("the report period ends at today's period and no fact carries the future rows", async () => {
    const withFuture = await run(year2023(future));
    const without = await run(year2023());
    expect(withFuture.period.to <= "2024-01").toBe(true);
    expect(withFuture.period).toEqual(without.period);
    // Every fact equals the run without the two future rows (1.7 million between them); none is that large.
    expect(withFuture.facts.map((f) => f.value)).toEqual(without.facts.map((f) => f.value));
    // Hand-computed: November revenue is (1000 + 11) + (500 + 11) = 1,522.
    expect(withFuture.facts.map((f) => f.value)).toContain(1522);
    expect(Math.max(...withFuture.facts.map((f) => Math.abs(f.value)))).toBeLessThan(900000);
    const q = withFuture.data_quality.find((i) => i.kind === "future_date");
    expect(q?.description).toContain("after today's date; those rows were left out of the analysis");
    expect(findFreeNumerals(q?.description ?? "")).toEqual([]);
  }, 180_000);
});

describe("negative amounts and falling cumulative columns (backtest pre-tag 4b)", () => {
  it("a negative sales amount reaches the report's data quality; the same rows with a refund status do not", async () => {
    const report = await run(year2023([], (m, base) => (m === 6 && base === 500 ? -200 : base + m)));
    const q = report.data_quality.find((i) => i.kind === "negative_amount");
    expect(q?.description).toContain("Some sales amounts are negative");
    expect(q?.citations[0]?.rows?.length).toBe(1);
    expect(findFreeNumerals(q?.description ?? "")).toEqual([]);

    const rows = year2023([], (m, base) => (m === 6 && base === 500 ? -200 : base + m))
      .trim()
      .split("\n");
    const marked = `${rows.map((r, i) => (i === 0 ? `${r},status` : `${r},${r.includes(",-200") ? "Refunded" : "Paid"}`)).join("\n")}\n`;
    expect((await run(marked)).data_quality.some((i) => i.kind === "negative_amount")).toBe(false);
  }, 180_000);

  it("a cumulative column that falls within the year reaches the report", async () => {
    const lines = ["date,region,cumulative_sales"];
    for (let m = 1; m <= 12; m++)
      for (const [r, step] of [
        ["north", 100],
        ["south", 50],
      ] as const)
        lines.push(`2023-${String(m).padStart(2, "0")}-28,${r},${step * m - (r === "north" && m === 9 ? 500 : 0)}`);
    const report = await run(`${lines.join("\n")}\n`);
    const q = report.data_quality.find((i) => i.kind === "non_monotone_cumulative");
    expect(q?.description).toContain("cumulative series falls");
    expect(q?.citations[0]?.rows).toEqual([18]);
    expect(findFreeNumerals(q?.description ?? "")).toEqual([]);
  }, 180_000);
});

describe("rows after today inside today's period (spec review)", () => {
  it("the period is left out whole: the range ends the month before, and the late row is nowhere", async () => {
    // Rows on the 28th of each month (so November is whole), then December rows on the 25th and the 30th: the
    // 30th is after --today 2023-12-28, in today's own month.
    const rows = ["date,product,quantity,amount"];
    for (let m = 1; m <= 11; m++)
      for (const [p, base] of [
        ["tea", 1000],
        ["coffee", 500],
      ] as const)
        rows.push(`2023-${String(m).padStart(2, "0")}-28,${p},10,${base + m}`);
    rows.push("2023-12-25,tea,10,50", "2023-12-30,tea,10,900000");
    const report = await run(`${rows.join("\n")}\n`, "2023-12-28");
    expect(report.period.to).toBe("2023-11");
    expect(Math.max(...report.facts.map((f) => Math.abs(f.value)))).toBeLessThan(900000);
    // Hand-computed: November revenue is (1000 + 11) + (500 + 11) = 1,522.
    expect(report.facts.map((f) => f.value)).toContain(1522);
    expect(report.facts.some((f) => f.value === 1524)).toBe(false);
    const q = report.data_quality.find((i) => i.kind === "future_date");
    expect(q?.description).toContain("those rows were left out of the analysis");
  }, 180_000);

  it("a year and month table: later months never reach a period, and the item is in the report", async () => {
    const rows = ["year,month,region,amount"];
    for (let m = 1; m <= 12; m++)
      for (const [r, base] of [
        ["north", 1000],
        ["south", 500],
      ] as const)
        rows.push(`2023,${m},${r},${base + m}`);
    rows.push("2026,9,north,999999");
    const report = await run(`${rows.join("\n")}\n`);
    expect(report.period.to <= "2023-12").toBe(true);
    expect(Math.max(...report.facts.map((f) => Math.abs(f.value)))).toBeLessThan(999999);
    expect(report.data_quality.find((i) => i.kind === "future_date")?.description).toContain(
      "after today's date; those rows were left out",
    );
  }, 180_000);

  it("every date after today: says so, not that the headers were not recognised", async () => {
    const rows = ["date,product,quantity,amount"];
    for (let m = 1; m <= 6; m++) rows.push(`2026-${String(m).padStart(2, "0")}-15,tea,10,${100 + m}`);
    const report = await run(`${rows.join("\n")}\n`);
    expect(report.summary.no_numbers).toBe("all_dates_future");
    expect(report.summary.headline).toBe(
      "No numbers could be read from these files: every date is after today's date (check the date the job ran as, or the dates).",
    );
    expect(findFreeNumerals(report.summary.headline)).toEqual([]);
  }, 180_000);
});
