// V2's registry, rule by rule, on hand-built facts with the arithmetic written out. A rule that drifts from its
// analysis function fails here, before it can fail a real job.
import type { Fact } from "@agentic-analytics/schema";
import { Workspace } from "@agentic-analytics/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recomputeFacts } from "../src/index.ts";

let ws: Workspace;
beforeAll(async () => {
  ws = await Workspace.open();
});
afterAll(() => ws.close());

const all = new Map<string, Fact>();
let n = 0;
/** An input fact (a measured point; its value is taken as given here). */
const point = (label: string, value: number): string => {
  const id = `P${++n}`;
  all.set(id, { id, label, value, unit: "other", computation: { kind: "sql", sql: "SELECT 1" }, citations: [], verified: false });
  return id;
};
const calc = (label: string, value: number, fn: string, inputs: string[], extra: Partial<Fact> = {}): Fact => {
  const id = `C${++n}`;
  const f: Fact = {
    id,
    label,
    value,
    unit: "other",
    computation: { kind: "function", fn, inputs },
    citations: [],
    verified: false,
    ...extra,
  };
  all.set(id, f);
  return f;
};
const check = async (f: Fact) => (await recomputeFacts(ws, [f], all))[0];

describe("V2 rules", () => {
  it("delta, sum, mean, trailing_mean_3, pct_change", async () => {
    const a = point("x_2026-04", 36200);
    const b = point("x_2026-03", 44100);
    expect((await check(calc("c:change", -7900, "delta", [a, b])))?.ok).toBe(true); // 36,200 − 44,100
    expect((await check(calc("c:change", -7000, "delta", [a, b])))?.ok).toBe(false);
    expect((await check(calc("c:sum", 80300, "sum", [a, b])))?.ok).toBe(true);
    expect((await check(calc("c:mean", 40150, "mean", [a, b])))?.ok).toBe(true);
    expect((await check(calc("c:baseline", 40150, "trailing_mean_3", [a, b])))?.ok).toBe(true);
    // 36,200 ÷ 44,100 − 1 = −0.179138… × 100
    expect((await check(calc("c:change_pct", -17.913832199546484, "pct_change", [a, b])))?.ok).toBe(true);
  });

  it("contribution.v1 and share (the largest named member, never “(other)”)", async () => {
    const d = calc("c:delta:wholesale", -8500, "delta", [point("w_2026-04", 7400), point("w_2026-03", 15900)]);
    const t = calc("c:delta:total", -7900, "sum", [d.id]);
    // −8,500 ÷ −7,900 × 100 = 107.594936…
    expect((await check(calc("c:share:wholesale", 107.59493670886076, "contribution.v1", [d.id, t.id])))?.ok).toBe(true);
    const other = point("revenue[customer=(other)]_2026-06", 500);
    const hotel = point("revenue[customer=Hotel]_2026-06", 300);
    const cafe = point("revenue[customer=Cafe]_2026-06", 200);
    // Σ = 1,000; the largest *named* member is Hotel: 300 ÷ 1,000 = 30% (not the "(other)" bucket's 50%)
    expect((await check(calc("c:top_share", 30, "share", [other, hotel, cafe])))?.ok).toBe(true);
    expect((await check(calc("c:top_share", 50, "share", [other, hotel, cafe])))?.ok).toBe(false);
    // HHI: 0.5² + 0.3² + 0.2² = 0.38
    expect((await check(calc("c:hhi", 0.38, "hhi", [other, hotel, cafe])))?.ok).toBe(true);
  });

  it("theil_sen, mann_kendall, robust_z (at the fact's own period), share_shift", async () => {
    const ys = [10, 11, 13, 14, 16, 30].map((v, i) => point(`s_2026-0${i + 1}`, v));
    // 15 pairwise slopes sorted: 1 1 1.33 1.5 1.5 1.5 1.5 [1.67] 2 2 4 4.75 5.67 8 14 → median (8th) = 5/3
    expect((await check(calc("c:slope", 5 / 3, "theil_sen", ys)))?.ok).toBe(true);
    // strictly increasing, n = 6: S = 15, var = 6·5·17/18 = 28.333, z = (15 − 1)/5.3229 = 2.6301, p = 0.008536
    expect((await check(calc("c:p_value", 0.008535, "mann_kendall", ys)))?.computed).toBeCloseTo(0.008535, 5);
    // changes 1, 2, 1, 2, 14; for June: others [1, 2, 1, 2] → median 1.5, MAD 0.5 → z = 12.5 ÷ (1.4826 × 0.5) = 16.862
    const z = await check(calc("I9 anomaly.v1 s 2026-06:robust_z", 16.862, "robust_z", ys));
    expect(z?.computed).toBeCloseTo(16.8623, 3);
    // the z of another period's change is not accepted for June
    expect((await check(calc("I9 anomaly.v1 s 2026-06:robust_z", -0.6745, "robust_z", ys)))?.ok).toBe(false);
    // shares: A 40/100 → 30/100, B 60/100 → 70/100 → shifts −10 and +10 pp
    const pairs = [point("a_0", 40), point("a_1", 30), point("b_0", 60), point("b_1", 70)];
    expect((await check(calc("c:share_shift_pp", -10, "share_shift", pairs)))?.ok).toBe(true);
    expect((await check(calc("c:share_shift_pp", 5, "share_shift", pairs)))?.ok).toBe(false);
  });

  it("pvm.v1 effects", async () => {
    // A: r 100/q 10 → 132/12; B: 120/6 → 80/4. P̄₀ = 13.75; mix P₀ = 12.5 → volume 0, mix −20, price 12
    const items = [
      point("ra0", 100),
      point("qa0", 10),
      point("ra1", 132),
      point("qa1", 12),
      point("rb0", 120),
      point("qb0", 6),
      point("rb1", 80),
      point("qb1", 4),
    ];
    expect((await check(calc("x:pvm:volume", 0, "pvm.v1", items)))?.ok).toBe(true);
    expect((await check(calc("x:pvm:mix", -20, "pvm.v1", items)))?.ok).toBe(true);
    expect((await check(calc("x:pvm:price", 12, "pvm.v1", items)))?.ok).toBe(true);
    expect((await check(calc("x:pvm:new", 40, "pvm.v1", [point("rn", 40)])))?.ok).toBe(true);
    expect((await check(calc("x:pvm:lost", -30, "pvm.v1", [point("rl", 30)])))?.ok).toBe(true);
    // unpriced: r 20 → 35 with q 4 → 0: +15
    expect(
      (await check(calc("x:pvm:unpriced", 15, "pvm.v1", [point("ru0", 20), point("qu0", 4), point("ru1", 35), point("qu1", 0)])))?.ok,
    ).toBe(true);
  });

  it("ratemix.v1 effects", async () => {
    // S1: 10/100 → 12/100; S2 exits (20/100 → 0/0); S3 enters (0/0 → 6/50); ratio units.
    // d0 = 200, d1 = 150: mix = (2/3 − 1/2)·0.1 = 1/60; rate = (2/3)·0.02; entering = 6/150; exiting = −20/200
    const segs = [10, 100, 12, 100, 20, 100, 0, 0, 0, 0, 6, 50].map((v, i) => point(`seg${i}`, v));
    expect((await check(calc("x:ratemix:mix", 1 / 60, "ratemix.v1", segs, { unit: "ratio" })))?.ok).toBe(true);
    expect((await check(calc("x:ratemix:rate", 2 / 150, "ratemix.v1", segs, { unit: "ratio" })))?.ok).toBe(true);
    expect((await check(calc("x:ratemix:entering", 0.04, "ratemix.v1", segs, { unit: "ratio" })))?.ok).toBe(true);
    expect((await check(calc("x:ratemix:exiting", -0.1, "ratemix.v1", segs, { unit: "ratio" })))?.ok).toBe(true);
    // unattributed: 5 refunds with no sales in period 0 → −5/100 (percent units ×100 → −5)
    const orphan = [10, 100, 12, 100, 5, 0, 0, 0].map((v, i) => point(`o${i}`, v));
    expect((await check(calc("x:ratemix:unattributed", -5, "ratemix.v1", orphan, { unit: "percent" })))?.ok).toBe(true);
  });

  it("impact ranges, scenario parameters, external quotes and the benchmark gap", async () => {
    const param = (label: string, v: number) => calc(label, v, "scenario_param", []).id;
    const lost = point("wholesale_change", -8500);
    // recover_share: |−8,500| × 0.5 × (1 − 0.06) = 3,995
    const rs = [lost, param("scenario impact.v1:recover_share:param_cost", 6), param("scenario impact.v1:recover_share:param_low", 50)];
    expect((await check(calc("scenario impact.v1:recover_share:impact_low", 3995, "impact.v1:recover_share", rs)))?.ok).toBe(true);
    // price_change: 37,000 × 0.1 = 3,700
    const rev = point("revenue_2026-06", 37000);
    expect(
      (
        await check(
          calc("scenario impact.v1:price_change:impact_high", 3700, "impact.v1:price_change", [
            rev,
            param("scenario impact.v1:price_change:param_high", 10),
          ]),
        )
      )?.ok,
    ).toBe(true);
    // remove_excess_rate: (3.4 − 1.2) ÷ 100 × 37,000 × 0.5 = 407
    const rr = [point("rate_now", 3.4), point("rate_base", 1.2), rev, param("scenario impact.v1:remove_excess_rate:param_low", 50)];
    expect((await check(calc("scenario impact.v1:remove_excess_rate:impact_low", 407, "impact.v1:remove_excess_rate", rr)))?.ok).toBe(true);
    // retain_at_risk: 1,000 × 0.9 × (1 − 0.2) = 720
    const ra = [
      point("at_risk", 1000),
      param("scenario impact.v1:retain_at_risk:param_cost", 20),
      param("scenario impact.v1:retain_at_risk:param_high", 90),
    ];
    expect((await check(calc("scenario impact.v1:retain_at_risk:impact_high", 720, "impact.v1:retain_at_risk", ra)))?.ok).toBe(true);
    // parameters within bounds (recover_share 30–90%; cost ≤ 50%)
    expect((await check(all.get(rs[2] as string) as Fact))?.ok).toBe(true);
    expect((await check(calc("scenario impact.v1:recover_share:param_low", 95, "scenario_param", [])))?.ok).toBe(false);
    // An unknown scenario type fails closed as a mismatch, not a TypeError.
    expect((await check(calc("scenario impact.v1:teleport_stock:param_low", 50, "scenario_param", [])))?.ok).toBe(false);
    // external_quote re-parses its stored text
    const low = calc("external benchmark (low)", 1, "external_quote", [], {
      computation: { kind: "function", fn: "external_quote", params: { text: "1–2%", side: "low" } },
    });
    expect((await check(low))?.ok).toBe(true);
    const high = calc("external benchmark (high)", 3, "external_quote", [], {
      computation: { kind: "function", fn: "external_quote", params: { text: "1–2%", side: "high" } },
    });
    expect((await check(high))?.ok).toBe(false);
    // benchmark_gap: own 3.4 vs 1–2 → 1.4
    expect((await check(calc("b:gap", 1.4, "benchmark_gap.v1", [point("own", 3.4), low.id, point("hi", 2)])))?.ok).toBe(true);
  });

  it("abs and abs_exceeds (a member beyond the whole change, M14a)", async () => {
    const w = point("delta:wholesale", -8500);
    const total = point("delta:total", -7900);
    const small = point("delta:a", -5000);
    // |−8,500| = 8,500
    expect(await check(calc("magnitude:wholesale", 8500, "abs", [w]))).toMatchObject({ ok: true, computed: 8500 });
    // |−8,500| > |−7,900| → 1; |−5,000| > |−7,900| is false → 0
    expect(await check(calc("exceeds:wholesale", 1, "abs_exceeds", [w, total]))).toMatchObject({ ok: true, computed: 1 });
    expect(await check(calc("exceeds:a", 0, "abs_exceeds", [small, total]))).toMatchObject({ ok: true, computed: 0 });
    // A stored 1 that recomputes to 0 is a mismatch.
    expect(await check(calc("exceeds:a", 1, "abs_exceeds", [small, total]))).toMatchObject({ ok: false, computed: 0 });
  });

  it("a function without a rule can't be verified", async () => {
    const r = await check(calc("c:mystery", 1, "mystery_fn", []));
    expect(r?.ok).toBe(false);
    expect(r?.how).toBe("no recompute rule for mystery_fn");
  });
});
