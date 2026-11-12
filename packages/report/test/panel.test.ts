import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Report, validateReport } from "@agentic-analytics/schema";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { formatExact, metricLine, renderReportHtml, rowLabel } from "../src/index.ts";
import { STYLES } from "../src/styles.ts";

const fixture = (): Report => {
  const res = validateReport(
    JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "schema", "test", "fixtures", "report.coffee-roaster.json"), "utf8")),
  );
  if (!res.ok) throw new Error(JSON.stringify(res.issues));
  return res.report;
};

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe("rowLabel", () => {
  it("collapses consecutive rows to a range", () => {
    expect(rowLabel(range(2025, 2039))).toBe("r2025–r2039");
    expect(rowLabel([4])).toBe("r4");
    expect(rowLabel([9, 7, 8])).toBe("r7–r9");
  });
  it("joins gapped ranges with commas", () => {
    expect(rowLabel([3, 4, 5, 9])).toBe("r3–r5, r9");
    expect(rowLabel([2, 4])).toBe("r2, r4");
  });
  it("shows two ranges and counts the rest", () => {
    expect(rowLabel([...range(40, 59), 71, 80, 81, 90])).toBe("r40–r59, r71 +3 more");
    expect(rowLabel([1, 3, 5, 7, 9])).toBe("r1, r3 +3 more");
  });
});

describe("formatExact", () => {
  const f = (value: number, extra: object = {}) => ({ value, unit: "count" as const, ...extra });
  it("drops binary float noise but nothing else", () => {
    expect(formatExact(f(44100.000000000065, { unit: "currency", currency: "USD" }))).toBe("44100 USD");
    expect(formatExact(f(17776691.7, { unit: "currency", currency: "UZS", scale: "million" }))).toBe("17776691.7 million UZS");
    expect(formatExact(f(12.5, { unit: "percent" }))).toBe("12.5 %");
  });
});

describe("metricLine", () => {
  it("shows (assumed) once", () => {
    expect(metricLine({ label: "Revenue", plain: "Revenue = sum(amount) (assumed)", status: "assumed" })).toBe(
      "Revenue: Revenue = sum(amount) (assumed)",
    );
    expect(metricLine({ label: "Revenue", plain: "Revenue = sum(amount)", status: "assumed" })).toBe(
      "Revenue: Revenue = sum(amount) (assumed)",
    );
    expect(metricLine({ label: "R", plain: "R = sum(a)", status: "confirmed" })).toBe("R: R = sum(a)");
  });
});

describe("number panel", () => {
  it("shows the exact value without noise and the assumed marker once; the pill cannot overflow", async () => {
    const r = fixture();
    const fact = r.facts.find((x) => x.unit === "currency") ?? r.facts[0];
    if (!fact) throw new Error("no fact");
    fact.value = 44100.000000000065;
    const metric = r.metrics.find((m) => m.id === fact.metric_id);
    if (metric) {
      metric.status = "assumed";
      metric.plain = `${metric.label} = sum(amount) (assumed)`;
    }
    const window = new Window({
      settings: { enableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
    });
    window.document.write(renderReportHtml(r));
    await window.happyDOM.waitUntilComplete();
    const doc = window.document;
    (doc.querySelector(`.num[data-fact="${fact.id}"]`) as unknown as HTMLElement).click();
    const text = doc.getElementById("aa-fact-panel")?.textContent ?? "";
    expect(text).toContain("44100");
    expect(text).not.toContain("44100.0000");
    if (metric) expect(text.match(/\(assumed\)/g)?.length).toBe(1);
    await window.happyDOM.close();
    expect(STYLES).toMatch(/\.cite\{[^}]*max-width:100%[^}]*text-overflow:ellipsis/);
  });
});
