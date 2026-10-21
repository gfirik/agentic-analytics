import { describe, expect, it } from "vitest";
import { contribution, diff, type PvmItem, pvm, rateMix } from "../src/decompose.ts";

describe("contribution.v1 (spec §4.1)", () => {
  it("coffee-roaster April: wholesale −8,500 and retail +600 → total −7,900, wholesale 108%", () => {
    const c = contribution(
      [
        {
          key: "wholesale",
          series: "revenue|channel=wholesale",
          before: { period: "2026-03", value: 15900 },
          after: { period: "2026-04", value: 7400 },
        },
        {
          key: "retail",
          series: "revenue|channel=retail",
          before: { period: "2026-03", value: 28200 },
          after: { period: "2026-04", value: 28800 },
        },
      ],
      "currency",
    );
    // 7,400 − 15,900 = −8,500; 28,800 − 28,200 = +600; total −7,900
    expect(c.totalDelta.value).toBe(-7900);
    const wholesale = c.contributors[0];
    expect(wholesale?.key).toBe("wholesale");
    expect(wholesale?.delta.value).toBe(-8500);
    // −8,500 / −7,900 × 100 = 107.5949…% → shown 108%
    expect(wholesale?.share.value).toBeCloseTo(107.594937, 5);
    expect(c.contributors[1]?.share.value).toBeCloseTo(-7.594937, 5); // 600 / −7,900 × 100
    expect(c.positive).toEqual(["wholesale"]); // moved with the total (both down)
    expect(c.negative).toEqual(["retail"]); // offset it
    expect(wholesale?.share.inputs).toEqual([
      { kind: "calc", name: "delta:wholesale" },
      { kind: "calc", name: "delta:total" },
    ]);
    // Wholesale moved more than the whole change (|−8,500| > |−7,900|): magnitudes and the comparison as facts (M14a).
    expect(c.beyond?.key).toBe("wholesale");
    expect(c.beyond?.magnitude).toMatchObject({
      value: 8500,
      unit: "currency",
      fn: "abs",
      inputs: [{ kind: "calc", name: "delta:wholesale" }],
    });
    expect(c.beyond?.exceeds).toMatchObject({
      value: 1,
      unit: "other",
      fn: "abs_exceeds",
      inputs: [
        { kind: "calc", name: "delta:wholesale" },
        { kind: "calc", name: "delta:total" },
      ],
    });
    // retail is the largest member against the total: +600 → 600.
    expect(c.beyond?.offset).toMatchObject({ key: "retail", magnitude: { value: 600, fn: "abs" } });
  });

  it("no 'beyond' facts when the top member stays within the change", () => {
    // −5,000 and −2,900 → total −7,900; |−5,000| ≤ 7,900.
    const c = contribution(
      [
        { key: "a", series: "s|k=a", before: { period: "p0", value: 10000 }, after: { period: "p1", value: 5000 } },
        { key: "b", series: "s|k=b", before: { period: "p0", value: 4000 }, after: { period: "p1", value: 1100 } },
      ],
      "currency",
    );
    expect(c.totalDelta.value).toBe(-7900);
    expect(c.beyond).toBeUndefined();
  });
});

describe("pvm.v1 (spec §4.2)", () => {
  it("hand-computed example", () => {
    // A: q 10 → 12, p 5 → 6 (r 50 → 72); B: q 10 → 8, p 10 → 10 (r 100 → 80); C lost (r0 30); D new (r1 40)
    const items: PvmItem[] = [
      { key: "A", r0: 50, q0: 10, r1: 72, q1: 12, refs: {} },
      { key: "B", r0: 100, q0: 10, r1: 80, q1: 8, refs: {} },
      { key: "C", r0: 30, q0: 3, refs: {} },
      { key: "D", r1: 40, q1: 4, refs: {} },
    ];
    const r = pvm(items);
    // common items: Q0 = 20, Q1 = 20; P̄0 = 0.5·5 + 0.5·10 = 7.5 → volume = (20 − 20)·7.5 = 0
    expect(r.volume.value).toBe(0);
    // shares1: A 12/20 = 0.6, B 0.4 → Σ s1 p0 = 0.6·5 + 0.4·10 = 7 → mix = 20·(7 − 7.5) = −10
    expect(r.mix.value).toBeCloseTo(-10, 12);
    // price = 12·(6 − 5) + 8·(10 − 10) = 12
    expect(r.price.value).toBeCloseTo(12, 12);
    expect(r.newItems.value).toBe(40);
    expect(r.lostItems.value).toBe(-30);
    // total = 0 − 10 + 12 + 40 − 30 = 12 = (72 + 80 + 40) − (50 + 100 + 30) = 192 − 180
    expect(r.total.value).toBeCloseTo(12, 12);
  });

  it("identity property: volume + mix + price + new + lost = ΔR over 25 seeded random cases", () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let k = 0; k < 25; k++) {
      const items: PvmItem[] = Array.from({ length: 2 + Math.floor(rand() * 8) }, (_, i) => {
        const present0 = rand() > 0.15;
        const present1 = rand() > 0.15 || !present0;
        // ~10% of quantities are 0 with revenue still booked (adjustments): the unpriced path.
        const q0 = rand() > 0.1 ? 1 + Math.floor(rand() * 100) : 0;
        const q1 = rand() > 0.1 ? 1 + Math.floor(rand() * 100) : 0;
        return {
          key: `i${i}`,
          ...(present0 ? { q0, r0: Math.round(Math.max(q0, 1) * (1 + rand() * 50) * 100) / 100 } : {}),
          ...(present1 ? { q1, r1: Math.round(Math.max(q1, 1) * (1 + rand() * 50) * 100) / 100 } : {}),
          refs: {},
        };
      });
      const r = pvm(items);
      const delta = items.reduce((s, i) => s + (i.r1 ?? 0) - (i.r0 ?? 0), 0);
      expect(r.parts.reduce((a, c) => a + c.value, 0)).toBeCloseTo(delta, 6);
      expect(r.total.value).toBeCloseTo(delta, 6);
    }
  });

  it("revenue with zero quantity is an unpriced effect, not a vanished item", () => {
    // A: q 10 → 10, r 50 → 60 (price +10). B: r 20 → 35 but q 0 in the after period (a credit/adjustment).
    const r = pvm([
      { key: "A", r0: 50, q0: 10, r1: 60, q1: 10, refs: {} },
      { key: "B", r0: 20, q0: 4, r1: 35, q1: 0, refs: {} },
    ]);
    expect(r.price.value).toBeCloseTo(10, 12);
    expect(r.unpriced.value).toBe(15); // 35 − 20
    expect(r.total.value).toBeCloseTo(25, 12); // (60 + 35) − (50 + 20)
    // no new or lost items → those effects aren't parts (no 0-valued facts citing nothing)
    expect(r.parts.map((c) => c.name)).toEqual(["pvm:volume", "pvm:mix", "pvm:price", "pvm:unpriced"]);
  });
});

describe("ratemix.v1 and the Simpson guard (spec §4.3)", () => {
  it("mix + rate = overall change, hand-computed", () => {
    // S1: 10/100 → 30/200 (0.10 → 0.15); S2: 20/100 → 10/100 (0.20 → 0.10)
    // w0 = 0.5, 0.5; w1 = 2/3, 1/3; overall 30/200 = 0.15 → 40/300 = 0.1333
    const r = rateMix([
      { key: "S1", num0: 10, den0: 100, num1: 30, den1: 200 },
      { key: "S2", num0: 20, den0: 100, num1: 10, den1: 100 },
    ]);
    // mix = (2/3 − 1/2)·0.10 + (1/3 − 1/2)·0.20 = 0.016667 − 0.033333 = −0.016667
    expect(r.mix.value).toBeCloseTo(-1 / 60, 12);
    // rate = (2/3)·0.05 + (1/3)·(−0.10) = 0.033333 − 0.033333 = 0
    expect(r.rate.value).toBeCloseTo(0, 12);
    expect(r.mix.value + r.rate.value).toBeCloseTo(r.overall1 - r.overall0, 12);
    expect(r.simpsonRisk).toBe(false); // one segment up, one down: no majority against the total
  });

  it("entering and exiting segments close the identity, hand-computed", () => {
    // S1 both: 10/100 → 12/100. S2 exits: 20/100 → 0/0. S3 enters: 0/0 → 6/50.
    // r0 = 30/200 = 0.15; r1 = 18/150 = 0.12; Δ = −0.03.
    // w0: S1 0.5, S2 0.5 · w1: S1 2/3, S3 1/3
    // mix = (2/3 − 1/2)·0.10 = 0.016667 · rate = (2/3)·0.02 = 0.013333
    // entering = (1/3)·0.12 = 0.04 · exiting = −0.5·0.20 = −0.10 → sum −0.03
    const r = rateMix([
      { key: "S1", num0: 10, den0: 100, num1: 12, den1: 100 },
      { key: "S2", num0: 20, den0: 100, num1: 0, den1: 0 },
      { key: "S3", num0: 0, den0: 0, num1: 6, den1: 50 },
    ]);
    expect(r.overall0).toBeCloseTo(0.15, 12);
    expect(r.overall1).toBeCloseTo(0.12, 12);
    expect(r.mix.value).toBeCloseTo(1 / 60, 12);
    expect(r.rate.value).toBeCloseTo(2 / 150, 12);
    expect(r.entering.value).toBeCloseTo(0.04, 12);
    expect(r.exiting.value).toBeCloseTo(-0.1, 12);
    expect(r.mix.value + r.rate.value + r.entering.value + r.exiting.value).toBeCloseTo(-0.03, 12);
    expect(r.enteringKeys).toEqual(["S3"]);
    expect(r.exitingKeys).toEqual(["S2"]);
  });

  it("a numerator with no denominator is an unattributed effect, hand-computed", () => {
    // S1: 10/100 → 12/100. S2: 5 refunds but no sales in period 0, nothing in period 1.
    // Measured rates divide all numerators: r0 = (10 + 5) / 100 = 0.15, r1 = 12 / 100 = 0.12 → Δ −0.03
    // mix = (1 − 1)·0.10 = 0 · rate = 1·0.02 = 0.02 · unattributed = 0 − 5/100 = −0.05 → −0.03
    const r = rateMix([
      { key: "S1", num0: 10, den0: 100, num1: 12, den1: 100 },
      { key: "S2", num0: 5, den0: 0, num1: 0, den1: 0 },
    ]);
    expect(r.overall0).toBeCloseTo(0.15, 12);
    expect(r.overall1).toBeCloseTo(0.12, 12);
    expect(r.rate.value).toBeCloseTo(0.02, 12);
    expect(r.unattributed.value).toBeCloseTo(-0.05, 12);
    expect(r.unattributedKeys).toEqual(["S2"]);
    const sum = r.mix.value + r.rate.value + r.entering.value + r.exiting.value + r.unattributed.value;
    expect(sum).toBeCloseTo(r.overall1 - r.overall0, 12);
  });

  it("scale 100 gives percentage points and no −0", () => {
    const r = rateMix([{ key: "S1", num0: 1, den0: 100, num1: 3, den1: 100 }], "percent", 100);
    expect(r.overall0).toBeCloseTo(1, 12);
    expect(r.rate.value).toBeCloseTo(2, 12);
    expect(Object.is(r.exiting.value, -0)).toBe(false);
    expect(r.mix.unit).toBe("percent");
  });

  it("classic Simpson fixture triggers the guard", () => {
    // A: 80/100 (0.80) → 9/10 (0.90); B: 2/10 (0.20) → 30/100 (0.30). Both segments rise,
    // but the mix flips toward B, so overall falls: 82/110 = 0.745 → 39/110 = 0.355.
    const r = rateMix([
      { key: "A", num0: 80, den0: 100, num1: 9, den1: 10 },
      { key: "B", num0: 2, den0: 10, num1: 30, den1: 100 },
    ]);
    expect(r.overall0).toBeCloseTo(82 / 110, 12);
    expect(r.overall1).toBeCloseTo(39 / 110, 12);
    expect(r.segments.every((s) => s.r1 > s.r0)).toBe(true);
    expect(r.simpsonRisk).toBe(true);
    expect(r.mix.value + r.rate.value).toBeCloseTo(r.overall1 - r.overall0, 12);
  });
});

describe("diff.v1 (spec §4.4)", () => {
  it("support, risk ratio, thresholds and ranking", () => {
    // A has 100 events, B has 100. X: a = 40, b = 10 → c = 60, d = 90
    // support = 40/100 = 0.4; RR = (40/50) / (60/150) = 0.8 / 0.4 = 2.0 → kept (≥ 5%, ≥ 2)
    const groups = [
      { attrs: { packaging: "new", channel: "retail" }, a: 40, b: 10 },
      { attrs: { packaging: "old", channel: "retail" }, a: 30, b: 50 },
      { attrs: { packaging: "old", channel: "wholesale" }, a: 30, b: 40 },
    ];
    const out = diff(groups);
    const top = out[0];
    expect(top?.attrs).toEqual({ packaging: "new" });
    expect(top?.support).toBeCloseTo(0.4, 12);
    expect(top?.riskRatio).toBeCloseTo(2, 12);
    expect(top?.score).toBeCloseTo(0.4 * Math.log(2), 12);
    // the 2-dimension combination {channel: retail, packaging: new} has the same counts → same score, listed too
    expect(out.map((c) => JSON.stringify(c.attrs))).toContain(JSON.stringify({ channel: "retail", packaging: "new" }));
    // channel = retail: a = 70, b = 60 → RR = (70/130)/(30/70) = 1.256 < 2 → dropped
    expect(out.some((c) => JSON.stringify(c.attrs) === JSON.stringify({ channel: "retail" }))).toBe(false);
  });
});
