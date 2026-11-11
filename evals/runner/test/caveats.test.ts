// Backtest pre-tag 5, end to end with the scripted baseline model: the final report says its amounts are nominal
// (once, only when a money metric is compared across periods) and flags a December-vs-November change as probably
// seasonal (only that comparison). The caveats are report assumptions linked to the findings they qualify.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJob } from "@agentic-analytics/core";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { findFreeNumerals } from "@agentic-analytics/schema";
import { afterAll, describe, expect, it } from "vitest";
import { renderReportHtml, reportSummaryText } from "../../../packages/report/src/index.ts";
import { baselineModel } from "../src/baseline.ts";

const NOMINAL = "Amounts are nominal, as in the files; they are not adjusted for inflation.";
const DECEMBER = "December is often a seasonal peak; compare it with December of last year.";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/**
 * Monthly rows for 2020 to 2023 (two products): a deterministic wobble (never zero spread, which the anomaly test needs), a December peak every year, and
 * `value(year, month, base)` for the figure of one month.
 */
function csv(header: string, value: (y: number, m: number, base: number) => number, lastMonth = 12): Uint8Array {
  const rows = [`date,product,${header}`];
  for (const y of [2020, 2021, 2022, 2023])
    for (let m = 1; m <= (y === 2023 ? lastMonth : 12); m++)
      for (const [p, base] of [
        ["tea", 1000],
        ["coffee", 500],
      ] as const) {
        const wobble = (((y * 7919 + m * 104729) % 1009) * base) / 10_000; // up to 10%, no two months alike
        rows.push(`${y}-${String(m).padStart(2, "0")}-28,${p},${Math.round(value(y, m, base) + wobble)}`);
      }
  return new TextEncoder().encode(`${rows.join("\n")}\n`);
}

/** Growth, a December peak every year (bigger each year), and in the last year a dip in `dip` and a high December. */
const season = (dip: number, peaks: readonly number[]) => (y: number, m: number, base: number) => {
  const level = base * (1 + 0.1 * (y - 2020));
  if (y === 2023 && m === dip) return level * 0.55;
  return m === 12 ? level * (peaks[y - 2020] ?? 1) : level;
};

async function run(bytes: Uint8Array) {
  const dir = mkdtempSync(join(tmpdir(), "aa-caveats-"));
  dirs.push(dir);
  const { report } = await runJob(
    { dir, jobId: "caveats", files: [{ name: "sales.csv", bytes }], options: { today: "2024-01-01", currency: "USD" } },
    { model: baselineModel(), embedder: hashEmbedder() },
  );
  return report;
}

const count = (texts: string[], t: string) => texts.filter((x) => x === t).length;

describe("one-line caveats (backtest pre-tag 5)", () => {
  it("money metric, December jump: nominal once and the December caveat, both linked to the finding", async () => {
    const report = await run(csv("amount", season(11, [1.3, 1.35, 1.7, 2])));
    const texts = report.assumptions.map((a) => a.text);
    expect(count(texts, NOMINAL)).toBe(1);
    expect(count(texts, DECEMBER)).toBe(1);
    const december = report.assumptions.find((a) => a.text === DECEMBER);
    expect(december?.affects.length).toBeGreaterThan(0);
    for (const id of december?.affects ?? []) expect(report.findings.find((f) => f.id === id)?.assumptions).toContain(december?.id);
    // The caveats are typed, and the reader sees them: in the text summary and first in the HTML "Assumes".
    expect(report.assumptions.find((a) => a.text === NOMINAL)?.caveat).toBe("nominal");
    expect(december?.caveat).toBe("seasonal");
    const lines = reportSummaryText(report).split("\n");
    expect(lines.filter((l) => l === `  Note: ${DECEMBER}`).length).toBeGreaterThan(0);
    expect(lines.filter((l) => l === `Note: ${NOMINAL}`)).toHaveLength(1);
    const first = report.findings.find((f) => december?.affects.includes(f.id));
    const html = renderReportHtml(report);
    const assumes = html.slice(html.indexOf("Assumes", html.indexOf(first?.id ?? "")));
    expect(assumes.indexOf(DECEMBER)).toBeGreaterThan(-1);
    expect(assumes.indexOf(DECEMBER)).toBeLessThan(assumes.indexOf("drafted automatically"));
    expect(findFreeNumerals(NOMINAL)).toEqual([]);
    expect(findFreeNumerals(DECEMBER)).toEqual([]);
  }, 180_000);

  it("a money change in November, data ending there: nominal, but no December caveat", async () => {
    const report = await run(csv("amount", season(11, [1, 1, 1, 1]), 11));
    const texts = report.assumptions.map((a) => a.text);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(count(texts, NOMINAL)).toBe(1);
    expect(count(texts, DECEMBER)).toBe(0);
  }, 180_000);
});
