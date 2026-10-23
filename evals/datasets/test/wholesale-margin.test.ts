import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  WM_EVENTS,
  WM_HEADERS,
  WM_MONTHS,
  WM_PRODUCTS,
  wholesaleMarginCsv,
  wholesaleMarginExpectations,
  wholesaleMarginFiles,
  wholesaleMarginLines,
} from "../src/index.ts";

const dir = join(import.meta.dirname, "..", "wholesale-margin-v1");
const csvText = readFileSync(join(dir, "files", "invoice-lines.csv"), "utf8");
type Expectations = ReturnType<typeof wholesaleMarginExpectations>;
const expected = parse(readFileSync(join(dir, "expectations.yaml"), "utf8")) as Expectations;

/** A deliberately separate reader: parses the committed CSV text (quoted fields included) into pence, no shared code. */
function readRows() {
  const [head, ...rest] = csvText.trimEnd().split("\n");
  expect(head).toBe(WM_HEADERS.join(","));
  const pence = (s: string) => Math.round(Number(s) * 100);
  return rest.map((line) => {
    const f = [...line.matchAll(/("([^"]|"")*"|[^,]*)(,|$)/g)].map((m) => m[1] as string).slice(0, 12);
    return {
      month: (f[0] as string).slice(0, 7),
      sku: f[4] as string,
      q: Number(f[7]),
      price: pence(f[8] as string),
      cost: pence(f[9] as string),
      disc: pence(f[10] as string),
      net: pence(f[11] as string),
    };
  });
}
const rows = readRows();

function agg(month: string, sku?: string) {
  let revenue = 0;
  let cost = 0;
  let q = 0;
  for (const r of rows)
    if (r.month === month && (sku === undefined || r.sku === sku)) {
      revenue += r.net;
      cost += r.q * r.cost;
      q += r.q;
    }
  return { revenue, cost, q };
}

describe("wholesale-margin-v1", () => {
  it("committed files and expectations equal a fresh deterministic build", () => {
    for (const [name, data] of Object.entries(wholesaleMarginFiles()))
      expect(
        createHash("sha256")
          .update(readFileSync(join(dir, "files", name)))
          .digest("hex"),
        name,
      ).toBe(createHash("sha256").update(data).digest("hex"));
    expect(wholesaleMarginCsv()).toBe(csvText);
    expect(expected).toEqual(JSON.parse(JSON.stringify(wholesaleMarginExpectations())));
    expect(wholesaleMarginLines()).toEqual(wholesaleMarginLines());
  });

  it("every line obeys net = quantity x unit price - discount, to the penny", () => {
    expect(rows.length).toBe(expected.rows);
    for (const r of rows) expect(r.q * r.price - r.disc, `${r.month} ${r.sku}`).toBe(r.net);
  });

  it("monthly revenue, cost, margin and margin % re-derive from the committed file", () => {
    for (const m of expected.months) {
      const a = agg(m.month);
      expect(a.revenue / 100).toBeCloseTo(m.revenue, 6);
      expect(a.cost / 100).toBeCloseTo(m.cost, 6);
      expect((a.revenue - a.cost) / 100).toBeCloseTo(m.gross_margin, 6);
      expect(((a.revenue - a.cost) / a.revenue) * 100).toBeCloseTo(m.gross_margin_pct, 3);
    }
  });

  for (const [name, key] of [
    ["squeeze", "squeeze"],
    ["price event", "price_event"],
  ] as const) {
    it(`pvm_margin.v1 effects of the ${name} re-derive and sum to the margin change`, () => {
      const ev = expected[key];
      // Written out per item, straight from the spec's formulas (analysis-library.md section 10), in pounds.
      let q0 = 0;
      let q1 = 0;
      let m0 = 0;
      let m1 = 0;
      for (const p of WM_PRODUCTS) {
        const a = agg(ev.baseline, p.sku);
        const b = agg(ev.month, p.sku);
        q0 += a.q;
        q1 += b.q;
        m0 += (a.revenue - a.cost) / 100;
        m1 += (b.revenue - b.cost) / 100;
      }
      const ubar0 = m0 / q0;
      let sumQ1U0 = 0;
      let price = 0;
      let cost = 0;
      for (const p of WM_PRODUCTS) {
        const a = agg(ev.baseline, p.sku);
        const b = agg(ev.month, p.sku);
        const u0 = (a.revenue - a.cost) / 100 / a.q;
        sumQ1U0 += b.q * u0;
        price += b.q * (b.revenue / 100 / b.q - a.revenue / 100 / a.q);
        cost -= b.q * (b.cost / 100 / b.q - a.cost / 100 / a.q);
      }
      const volume = (q1 - q0) * ubar0;
      const mix = sumQ1U0 - q1 * ubar0;
      expect(volume).toBeCloseTo(ev.pvm_margin.volume, 3);
      expect(mix).toBeCloseTo(ev.pvm_margin.mix, 3);
      expect(price).toBeCloseTo(ev.pvm_margin.price, 3);
      expect(cost).toBeCloseTo(ev.pvm_margin.cost, 3);
      // The identity: volume + mix + price + cost = the change in gross margin.
      expect(volume + mix + price + cost).toBeCloseTo(m1 - m0, 6);
      expect(ev.gross_margin_change).toBeCloseTo(m1 - m0, 6);
      expect(ev.pvm_margin.sum).toBeCloseTo(ev.gross_margin_change, 3);
    });
  }

  it("the cost effects are the hand-computed ones (README)", () => {
    // Squeeze: SKU-100 sold 222 units and its cost went 27.00 -> 31.50; SKU-140 sold 258 and 30.00 -> 33.50.
    expect(-(222 * (31.5 - 27) + 258 * (33.5 - 30))).toBe(-1902);
    expect(expected.squeeze.pvm_margin.cost).toBe(-1902);
    // Price event: SKU-110 sold 280 units and its cost went 21.00 -> 21.63.
    expect(-280 * (21.63 - 21)).toBeCloseTo(-176.4, 10);
    expect(expected.price_event.pvm_margin.cost).toBe(-176.4);
    // SKU-110's own price effect: 280 x (8861.40 / 280 - 8788.20 / 299).
    expect(280 * (8861.4 / 280 - 8788.2 / 299)).toBeCloseTo(631.65, 2);
  });

  it("plants a margin squeeze at flat revenue, then a price rise that outruns its cost rise", () => {
    const sq = expected.squeeze;
    expect(Math.abs(sq.revenue_change_pct)).toBeLessThan(1);
    expect(sq.gross_margin_change / (sq.gross_margin["2026-02" as never] as number)).toBeLessThan(-0.1);
    expect((sq.gross_margin_pct["2026-02" as never] as number) - (sq.gross_margin_pct["2026-03" as never] as number)).toBeGreaterThan(3);
    expect(sq.pvm_margin.cost).toBeLessThan(-1000);
    const pe = expected.price_event;
    expect(pe.pvm_margin.price).toBeGreaterThan(1000);
    expect(pe.pvm_margin.cost).toBeLessThan(0);
    expect(pe.gross_margin_change).toBeGreaterThan(0);
    expect(WM_EVENTS.priceEvent.price / 3000).toBe(1.08);
    expect(WM_EVENTS.priceEvent.cost / 2100).toBe(1.03);
  });

  it("keeps every other month inside the noise band, and the distractor too", () => {
    const planted = new Set<string>([WM_EVENTS.squeeze.month, WM_EVENTS.priceEvent.month]);
    for (const [i, m] of expected.months.entries()) {
      if (i === 0 || planted.has(m.month)) continue;
      const p = expected.months[i - 1] as (typeof expected.months)[number];
      expect(Math.abs((m.revenue / p.revenue - 1) * 100), m.month).toBeLessThan(3.5);
      expect(Math.abs(m.gross_margin_pct - p.gross_margin_pct), m.month).toBeLessThan(0.8);
    }
    expect(expected.distractor.revenue_change_pct).toBeGreaterThan(0);
    expect(expected.distractor.revenue_change_pct).toBeLessThan(3.5);
    expect(WM_MONTHS).toHaveLength(12);
  });

  it("names a clear lowest-margin product in the latest month", () => {
    const pcts = expected.latest_month.products.map((p) => p.gross_margin_pct).sort((a, b) => a - b);
    expect(expected.latest_month.lowest_margin_pct_sku).toBe("SKU-100");
    expect((pcts[1] as number) - (pcts[0] as number)).toBeGreaterThan(3);
  });

  it("has a README that states the headline figures", () => {
    const readme = readFileSync(join(dir, "README.md"), "utf8");
    for (const s of ["-1902", "-176.40", "Std cost", String(expected.rows)]) expect(readme, s).toContain(s);
  });
});
