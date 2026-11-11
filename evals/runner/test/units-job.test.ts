// Backtest pre-tag 2, end to end with the scripted baseline model: a scale word in a money column's header
// ("amount_mln_uzs") reaches the metric, the facts, the CLI summary and the HTML; `--currency` shows in the display;
// values stay as in the file (no multiplication).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJob } from "@agentic-analytics/core";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { afterAll, describe, expect, it } from "vitest";
import { reportSummaryText } from "../../../packages/report/src/index.ts";
import { baselineModel } from "../src/baseline.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** Twelve months of two products; the last month is far lower, so there is a change to report. */
function csv(header: string): Uint8Array {
  const rows = ["date,product,quantity," + header];
  for (let m = 1; m <= 12; m++) {
    const day = `2023-${String(m).padStart(2, "0")}-15`;
    for (const [p, base] of [
      ["tea", 1000],
      ["coffee", 500],
    ] as const)
      rows.push(`${day},${p},10,${m === 12 ? base / 2 : base + m}`);
  }
  return new TextEncoder().encode(`${rows.join("\n")}\n`);
}

async function run(header: string, currency?: string) {
  const dir = mkdtempSync(join(tmpdir(), "aa-units-"));
  dirs.push(dir);
  const { report } = await runJob(
    {
      dir,
      jobId: "units",
      files: [{ name: "sales.csv", bytes: csv(header) }],
      options: { today: "2024-01-01", ...(currency ? { currency } : {}) },
    },
    { model: baselineModel(), embedder: hashEmbedder() },
  );
  return { report };
}

describe("units from the header (backtest pre-tag 2)", () => {
  it("amount_mln_uzs: scale million and currency UZS from the header, shown as 'million UZS', values unmultiplied", async () => {
    const { report } = await run("amount_mln_uzs");
    const money = report.facts.filter((f) => f.unit === "currency");
    expect(money.length).toBeGreaterThan(0);
    for (const f of money) {
      expect(f.scale).toBe("million");
      expect(f.currency).toBe("UZS");
    }
    expect(report.metrics.find((m) => m.unit === "currency")?.scale).toBe("million");
    expect(report.metrics.find((m) => m.unit === "currency")?.plain).toContain("in million UZS");
    // The file's numbers are about 1,000 per line: a multiplied value would be a million times larger.
    expect(Math.max(...money.map((f) => Math.abs(f.value)))).toBeLessThan(100_000);
    expect(reportSummaryText(report)).toContain("million UZS");
  }, 180_000);

  it("--currency USD with a plain header: the display names USD and no scale", async () => {
    const { report } = await run("amount", "USD");
    const money = report.facts.filter((f) => f.unit === "currency");
    expect(money.length).toBeGreaterThan(0);
    for (const f of money) {
      expect(f.scale).toBeUndefined();
      expect(f.currency).toBe("USD");
    }
    const text = reportSummaryText(report);
    expect(text).toMatch(/\d USD/);
    expect(text).not.toMatch(/million|thousand|billion/);
  }, 180_000);

  it("amount_thousand with --currency UZS: 'thousand UZS'", async () => {
    const { report } = await run("amount_thousand", "UZS");
    expect(reportSummaryText(report)).toContain("thousand UZS");
  }, 180_000);
});
