// The verifier on the sections code builds (agent-and-verifier §7): V2's `noise_band` rule and the scorecard's material
// flag, and V1 on the not-run reasons. Hand-built facts with the arithmetic written out (analysis-library §12, §13).
import type { Fact, NotRun, Report } from "@agentic-analytics/schema";
import { describe, expect, it } from "vitest";
import { checkNotRun, recheckMaterial, recomputeFacts } from "../src/index.ts";

const fact = (id: string, value: number, fn?: string, inputs: string[] = []): Fact => ({
  id,
  label: id,
  value,
  unit: "currency",
  computation: fn ? { kind: "function", fn, inputs } : { kind: "sql", sql: "SELECT 1" },
  citations: [],
  verified: false,
});

// coffee-roaster-v1's monthly revenue, January to June 2026 (answers.yaml).
const months = [41200, 42900, 44100, 36200, 35800, 37000].map((v, i) => fact(`P${i + 1}`, v));
const pointIds = months.map((f) => f.id);
// Changes +1,700, +1,200, −7,900, −400 (+1,200 left out): median 400, MAD 1,050, band 2 × 1.4826 × 1,050 = 3,113.46.
const band = fact("B", 3113.46, "noise_band", pointIds);
const change = fact("D", 1200, "delta", ["P6", "P5"]);
const pct = fact("C", (37000 / 35800 - 1) * 100, "pct_change", ["P6", "P5"]);
const mean = fact("M", 237200 / 6, "mean", pointIds);
const all = new Map([...months, band, change, pct, mean].map((f) => [f.id, f]));

const scorecard = (material: boolean | null): Report["scorecard"] => ({
  period: "2026-06",
  rows: [
    {
      metric_id: "revenue",
      value: "P6",
      vs_base: { method: "previous_period", periods: ["2026-05"], change: "D", change_pct: "C" },
      yoy: { na: "too_few_periods" },
      material,
      materiality_inputs: { band: "B", mean: "M" },
    },
  ],
});

describe("V2 on the scorecard (§12)", () => {
  it("recomputes the noise band from its points, the last change left out", async () => {
    const [r] = await recomputeFacts(undefined as never, [band], all);
    expect(r?.ok).toBe(true);
    expect(r?.computed).toBeCloseTo(3113.46, 9);
    const [bad] = await recomputeFacts(undefined as never, [{ ...band, value: 3000 }], all);
    expect(bad?.ok).toBe(false);
  });

  it("recomputes a trailing-mean row's band from the same points the scorecard cites (the change into the period left out)", async () => {
    // The known points of Jan … Aug with July unknown: 10, 12, 11, 15, 13, 14, 20 (analysis scorecard.test.ts). Changes
    // +2, −1, +4, −2, +1 and +6 (left out): median 1, MAD 2, band 2 × 1.4826 × 2 = 5.9304, as planRow states it.
    const pts = [10, 12, 11, 15, 13, 14, 20].map((v, i) => fact(`T${i + 1}`, v));
    const b = fact(
      "TB",
      5.9304,
      "noise_band",
      pts.map((f) => f.id),
    );
    const [r] = await recomputeFacts(undefined as never, [b], new Map([...pts, b].map((f) => [f.id, f])));
    expect(r?.ok).toBe(true);
    expect(r?.computed).toBeCloseTo(5.9304, 12);
  });

  it("recomputes the material flag: |1,200| ≤ 3,113.46 and 3.35% < 5%, so not material", () => {
    expect(recheckMaterial(scorecard(false), all)).toEqual([
      expect.objectContaining({ metric: "revenue", stored: false, computed: false, ok: true }),
    ]);
  });

  it("fails a tampered flag", () => {
    expect(recheckMaterial(scorecard(true), all)[0]).toMatchObject({ stored: true, computed: false, ok: false });
    // A flag where the row has no band must be null.
    expect(recheckMaterial(scorecard(null), all)[0]?.ok).toBe(false);
  });
});

describe("V1 on Analyses not run (§13)", () => {
  const entry = (reason: string): NotRun => ({ analysis: "yoy", reason_code: "too_few_periods", reason, needs: [] });

  it("keeps a reason without numerals and drops one with a numeral or a placeholder", () => {
    const r = checkNotRun(
      [
        entry("There is not enough history for a year-on-year comparison."),
        entry("Needs 13 months of history."),
        entry("Needs {{N4}} months."),
      ],
      new Set(),
    );
    expect(r.kept.map((n) => n.reason)).toEqual(["There is not enough history for a year-on-year comparison."]);
    expect(r.dropped.map((d) => d.claim)).toEqual(["Needs 13 months of history.", "Needs {{N4}} months."]);
    expect(r.dropped[0]?.reason).toMatch(/^V1: the reason of not-run yoy carries a number \(13\)/);
  });
});
