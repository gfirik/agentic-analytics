// A3 (docs/plans/m15.md): the margin PVM identity, the spec's hand-computed cases (analysis-library §10) and 200 seeded
// random cases. Every expected value below is worked out by hand in the comments.
import { describe, expect, it } from "vitest";
import { type MarginItem, marginEffect, pvmMargin } from "../src/pvm-margin.ts";
import { type Calc, point } from "../src/types.ts";

type Nums = { r0: number; q0: number; cost0: number; r1: number; q1: number; cost1: number };
const KEYS = ["r0", "q0", "cost0", "r1", "q1", "cost1"] as const;

/** An item with a ref per number, so a test can read the inputs a calc lists back as numbers. */
function item(key: string, n: Partial<Nums>): MarginItem {
  const full = { r0: 0, q0: 0, cost0: 0, r1: 0, q1: 0, cost1: 0, ...n };
  return { key, ...full, refs: Object.fromEntries(KEYS.map((k) => [k, point(`${key}.${k}`, "p")])) };
}

const inputValues = (items: readonly MarginItem[], c: Calc): number[] =>
  c.inputs.map((r) => {
    if (r.kind !== "point") throw new Error("margin inputs are points");
    const [key, k] = r.series.split(".") as [string, (typeof KEYS)[number]];
    return (items.find((i) => i.key === key) as MarginItem)[k];
  });

const effects = (p: ReturnType<typeof pvmMargin>) =>
  Object.fromEntries(p.parts.map((c) => [c.name.replace("pvm_margin:", ""), c.value])) as Record<string, number>;

describe("pvm_margin.v1 hand-computed cases (spec §10)", () => {
  it("case 1: ΔM = −8 = 0 − 4 + 8 − 12", () => {
    // A: q 10 → 12, p 5, c 3 → 4 (u 2 → 1); B: q 10 → 8, p 10 → 11, c 6 (u 4 → 5).
    const items = [
      item("A", { r0: 50, q0: 10, cost0: 30, r1: 60, q1: 12, cost1: 48 }),
      item("B", { r0: 100, q0: 10, cost0: 60, r1: 88, q1: 8, cost1: 48 }),
    ];
    // M0 = 10·2 + 10·4 = 60, M1 = 12·1 + 8·5 = 52, ΔM = −8. Q0 = Q1 = 20, ū0 = 3.
    const e = effects(pvmMargin(items, "p1"));
    expect(e.volume).toBeCloseTo(0, 12); // (20 − 20)·3
    expect(e.mix).toBeCloseTo(-4, 12); // (12·2 + 8·4) − 20·3 = 56 − 60
    expect(e.price).toBeCloseTo(8, 12); // 12·0 + 8·1
    expect(e.cost).toBeCloseTo(-12, 12); // −(12·1 + 8·0)
    expect(pvmMargin(items, "p1").total.value).toBeCloseTo(-8, 12);
  });

  it("case 2: ΔM = −22 = 3 − 11 + 0 − 8 + 12 − 16 − 2 (volume, mix, price, cost, new, lost, unpriced)", () => {
    const items = [
      item("A", { r0: 50, q0: 10, cost0: 30, r1: 80, q1: 16, cost1: 56 }), // p 5, c 3 → 3.5
      item("B", { r0: 100, q0: 10, cost0: 60, r1: 50, q1: 5, cost1: 30 }),
      item("C", { r1: 32, q1: 4, cost1: 20 }), // new: margin 12
      item("D", { r0: 40, q0: 2, cost0: 24 }), // lost: margin 16
      item("E", { r0: 30, q0: 3, cost0: 18, r1: 10, q1: 0, cost1: 0 }), // unpriced: 10 − 12
    ];
    // M0 = 20 + 40 + 16 + 12 = 88, M1 = 24 + 20 + 12 + 10 = 66, ΔM = −22. Common A, B: Q0 = 20, Q1 = 21, ū0 = 3.
    const p = pvmMargin(items, "p1");
    const e = effects(p);
    expect(e.volume).toBeCloseTo(3, 12); // (21 − 20)·3
    expect(e.mix).toBeCloseTo(-11, 12); // (16·2 + 5·4) − 21·3 = 52 − 63
    expect(e.price).toBeCloseTo(0, 12);
    expect(e.cost).toBeCloseTo(-8, 12); // −(16·0.5 + 5·0)
    expect(e.new).toBeCloseTo(12, 12);
    expect(e.lost).toBeCloseTo(-16, 12);
    expect(e.unpriced).toBeCloseTo(-2, 12);
    expect(p.total.value).toBeCloseTo(-22, 12);
    expect(p.groups).toEqual({ common: ["A", "B"], new: ["C"], lost: ["D"], unpriced: ["E"] });
  });

  it("zero base: Q0 = 0 gives volume 0 and mix = Σq1·u0 − Σq0·u0, so 3 = 0 + 1 + 2 + 0", () => {
    // A: q 5 → 3, p 4, c 1 (u 3). B: q −5 → 2, p 4 → 5, c 3 (u 1 → 2). Q0 = 5 − 5 = 0.
    const items = [
      item("A", { r0: 20, q0: 5, cost0: 5, r1: 12, q1: 3, cost1: 3 }),
      item("B", { r0: -20, q0: -5, cost0: -15, r1: 10, q1: 2, cost1: 6 }),
    ];
    // M0 = 15 + (−5) = 10, M1 = 9 + 4 = 13, ΔM = 3.
    const e = effects(pvmMargin(items, "p1"));
    expect(e.volume).toBe(0);
    expect(e.mix).toBeCloseTo(1, 12); // (3·3 + 2·1) − (5·3 + (−5)·1) = 11 − 10
    expect(e.price).toBeCloseTo(2, 12); // 3·0 + 2·1
    expect(e.cost).toBeCloseTo(0, 12);
    expect(pvmMargin(items, "p1").total.value).toBeCloseTo(3, 12);
  });

  it("fixed fact labels end with the later period (spec §14) and effects of empty groups are left out", () => {
    const p = pvmMargin([item("A", { r0: 50, q0: 10, cost0: 30, r1: 60, q1: 12, cost1: 48 })], "2026-03");
    expect(p.parts.map((c) => c.factLabel)).toEqual([
      "pvm_margin.volume_2026-03",
      "pvm_margin.mix_2026-03",
      "pvm_margin.price_2026-03",
      "pvm_margin.cost_2026-03",
    ]);
  });
});

/** mulberry32: a small seeded generator, so the 200 cases are the same on every run. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("pvm_margin.v1 identity (A3)", () => {
  it("price + volume + mix + cost + new + lost + unpriced = ΔM over 200 seeded cases, and each effect recomputes from its inputs", () => {
    const rand = mulberry32(20261026);
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    const money = (x: number) => Math.round(x * 100) / 100;
    let kinds = { new: 0, lost: 0, unpriced: 0, uncosted: 0, returns: 0 };
    for (let k = 0; k < 200; k++) {
      const items = Array.from({ length: int(1, 12) }, (_, i) => {
        const present0 = rand() > 0.2;
        const present1 = rand() > 0.2 || !present0;
        // Returns: ~15% of quantities are negative. ~10% are 0 with money still booked (adjustments): the unpriced path.
        const qty = () => (rand() < 0.1 ? 0 : rand() < 0.15 ? -int(1, 30) : int(1, 100));
        const line = (present: boolean) => {
          if (!present) return { r: 0, q: 0, cost: 0 };
          const q = qty();
          const unit = 1 + rand() * 40;
          // ~10% of present lines have no cost at all (an uncosted item: revenue, cost 0).
          const uncosted = rand() < 0.1;
          return { r: money((q || 1) * unit), q, cost: uncosted ? 0 : money((q || 1) * unit * (0.4 + rand() * 0.5)) };
        };
        const a = line(present0);
        const b = line(present1);
        return item(`i${i}`, { r0: a.r, q0: a.q, cost0: a.cost, r1: b.r, q1: b.q, cost1: b.cost });
      });
      const p = pvmMargin(items, "p1");
      const delta = items.reduce((s, i) => s + (i.r1 - i.cost1) - (i.r0 - i.cost0), 0);
      const scale = Math.max(1, Math.abs(delta), ...p.parts.map((c) => Math.abs(c.value)));
      expect(Math.abs(p.total.value - delta)).toBeLessThanOrEqual(1e-9 * scale);
      // V2's formula over the inputs a calc lists gives the calc's value.
      for (const c of p.parts) {
        const effect = c.name.replace("pvm_margin:", "") as Parameters<typeof marginEffect>[0];
        expect(marginEffect(effect, inputValues(items, c))).toBeCloseTo(c.value, 9);
      }
      kinds = {
        new: kinds.new + (p.groups.new.length ? 1 : 0),
        lost: kinds.lost + (p.groups.lost.length ? 1 : 0),
        unpriced: kinds.unpriced + (p.groups.unpriced.length ? 1 : 0),
        uncosted: kinds.uncosted + (items.some((i) => (i.r0 !== 0 && i.cost0 === 0) || (i.r1 !== 0 && i.cost1 === 0)) ? 1 : 0),
        returns: kinds.returns + (items.some((i) => i.q0 < 0 || i.q1 < 0) ? 1 : 0),
      };
    }
    // The generator really reaches the awkward cases (otherwise the identity above proves less than it claims).
    expect(kinds.new).toBeGreaterThan(20);
    expect(kinds.lost).toBeGreaterThan(20);
    expect(kinds.unpriced).toBeGreaterThan(5);
    expect(kinds.uncosted).toBeGreaterThan(20);
    expect(kinds.returns).toBeGreaterThan(20);
  });

  it("holds when the common items' base quantity is exactly 0 (returns netting out), over 50 seeded cases", () => {
    const rand = mulberry32(7);
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    for (let k = 0; k < 50; k++) {
      // A sells a units, B returns the same number in the base period, so Q0 = 0 while the base margin is not.
      const a = int(1, 40);
      const mk = (key: string, q0: number) => {
        const p0 = int(2, 30);
        const c0 = int(1, p0 - 1);
        const q1 = int(1, 40);
        const p1 = p0 + int(-1, 2);
        const c1 = c0 + int(-1, 2);
        return item(key, { r0: q0 * p0, q0, cost0: q0 * c0, r1: q1 * p1, q1, cost1: q1 * c1 });
      };
      const items = [mk("A", a), mk("B", -a)];
      const p = pvmMargin(items, "p1");
      const delta = items.reduce((s, i) => s + (i.r1 - i.cost1) - (i.r0 - i.cost0), 0);
      expect(p.volume.value).toBe(0);
      expect(p.total.value).toBeCloseTo(delta, 9);
    }
  });

  it("reduces to pvm.v1 when there is no cost: cost effect 0, the others equal the revenue split", () => {
    const items = [item("A", { r0: 50, q0: 10, r1: 72, q1: 12 }), item("B", { r0: 100, q0: 10, r1: 80, q1: 8 })];
    const e = effects(pvmMargin(items, "p1"));
    expect(e.volume).toBeCloseTo(0, 12);
    expect(e.mix).toBeCloseTo(-10, 12); // the pvm.v1 hand case in decompose.test.ts
    expect(e.price).toBeCloseTo(12, 12);
    expect(e.cost).toBe(0);
  });
});
