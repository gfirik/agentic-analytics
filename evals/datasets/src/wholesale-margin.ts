// wholesale-margin-v1: a small food wholesaler's invoice lines, with a margin squeeze at flat revenue and a price-vs-cost
// event planted (docs/plans/m15.md PR 2, docs/specs/analysis-library.md §9-§10). Every amount is an integer number of
// pence, so the ground truth is exact and the same bytes come out of every build (fixed seed, no clock, no Math.random).
//
// The figures in `expectations()` are the answers a correct margin pack must reproduce. They are computed here from
// the lines with the spec's formulas, and re-derived independently (SQL and by hand) in the dataset's README and test.

/** Seed of the generator. Chosen once so the planted properties hold (a test asserts each one); never change it
 * without rebuilding the files and the expectations. */
export const WHOLESALE_MARGIN_SEED = 1;

export const WM_MONTHS = [
  "2025-07",
  "2025-08",
  "2025-09",
  "2025-10",
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
] as const;
export type WmMonth = (typeof WM_MONTHS)[number];

/** The "today" a report on this dataset is run with: the first days of the month after the last. */
export const WM_TODAY = "2026-07-03";
export const WM_CURRENCY = "GBP";

export interface WmProduct {
  readonly sku: string;
  readonly name: string;
  readonly category: string;
  /** Units sold in an ordinary month. */
  readonly baseUnits: number;
  /** Pence. */
  readonly price: number;
  readonly cost: number;
}

export const WM_PRODUCTS: readonly WmProduct[] = [
  { sku: "SKU-100", name: "Olive Oil 5L", category: "Oils", baseUnits: 220, price: 3800, cost: 2700 },
  { sku: "SKU-110", name: "Basmati Rice 10kg", category: "Grains", baseUnits: 300, price: 3000, cost: 2100 },
  { sku: "SKU-120", name: "Chopped Tomatoes, case of 6", category: "Pantry", baseUnits: 400, price: 1500, cost: 950 },
  { sku: "SKU-130", name: "Penne Pasta 5kg", category: "Grains", baseUnits: 350, price: 1800, cost: 1150 },
  { sku: "SKU-140", name: "Sunflower Oil 20L", category: "Oils", baseUnits: 260, price: 4200, cost: 3000 },
  { sku: "SKU-150", name: "Plain Flour 16kg", category: "Grains", baseUnits: 280, price: 1400, cost: 900 },
  { sku: "SKU-160", name: "Tea Bags, 1000", category: "Beverages", baseUnits: 500, price: 2000, cost: 1600 },
  { sku: "SKU-170", name: "Coffee Beans 1kg", category: "Beverages", baseUnits: 180, price: 2600, cost: 1700 },
];

export interface WmCustomer {
  readonly name: string;
  readonly channel: "Direct" | "Distributor" | "Online";
  /** Whole-percent discount on every line (0 for none). */
  readonly discountPct: number;
}

export const WM_CUSTOMERS: readonly WmCustomer[] = [
  { name: "Harbour Bistro", channel: "Direct", discountPct: 0 },
  { name: "Greenfield Canteen", channel: "Direct", discountPct: 3 },
  { name: "Ashford Hotel Group", channel: "Direct", discountPct: 5 },
  { name: "Northgate Deli", channel: "Direct", discountPct: 0 },
  { name: "Millbrook Catering", channel: "Distributor", discountPct: 4 },
  { name: "Eastside Provisions", channel: "Distributor", discountPct: 4 },
  { name: "Castle Wholesale Co", channel: "Distributor", discountPct: 6 },
  { name: "Riverside Cafe", channel: "Direct", discountPct: 0 },
  { name: "PantryBox Online", channel: "Online", discountPct: 0 },
  { name: "Foodcrate Ltd", channel: "Online", discountPct: 2 },
  { name: "Quayside Kitchens", channel: "Direct", discountPct: 3 },
  { name: "Oakfield School Meals", channel: "Direct", discountPct: 5 },
];

/** The planted events, as data the generator and the expectations share. */
export const WM_EVENTS = {
  /** From this month the unit cost of two products steps up and stays up; prices and volumes do not react. */
  squeeze: {
    month: "2026-03" as WmMonth,
    costs: { "SKU-100": 3150, "SKU-140": 3350 } as Record<string, number>,
  },
  /** In this month one product's price rises 8% and its cost 3%; units fall about 4%. They stay at the new level. */
  priceEvent: {
    month: "2026-05" as WmMonth,
    sku: "SKU-110",
    price: 3240,
    cost: 2163,
    unitsFactorPermille: 960,
  },
  /** A 2% rise in one product's revenue, inside the month-to-month noise: not an event. */
  distractor: { month: "2026-04" as WmMonth, sku: "SKU-170", unitsFactorPermille: 1020 },
} as const;

export interface WmLine {
  readonly date: string;
  readonly invoice: string;
  readonly customer: string;
  readonly channel: string;
  readonly sku: string;
  readonly product: string;
  readonly category: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly unitCost: number;
  readonly discount: number;
  readonly net: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The unit price and cost (pence) of a product in a month, after the planted events. */
export function wmUnit(p: WmProduct, month: WmMonth): { price: number; cost: number } {
  let { price, cost } = p;
  const squeezed = WM_EVENTS.squeeze.costs[p.sku];
  if (squeezed !== undefined && month >= WM_EVENTS.squeeze.month) cost = squeezed;
  if (p.sku === WM_EVENTS.priceEvent.sku && month >= WM_EVENTS.priceEvent.month) {
    price = WM_EVENTS.priceEvent.price;
    cost = WM_EVENTS.priceEvent.cost;
  }
  return { price, cost };
}

/** Every invoice line, in invoice order. Integer pence throughout; the only randomness is the seeded generator. */
export function wholesaleMarginLines(seed = WHOLESALE_MARGIN_SEED): WmLine[] {
  const rnd = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pending: Omit<WmLine, "invoice">[] = [];
  for (const month of WM_MONTHS) {
    for (const p of WM_PRODUCTS) {
      // Month-to-month noise of about +-3% on units, then the planted volume moves.
      let units = Math.round((p.baseUnits * int(970, 1030)) / 1000);
      if (p.sku === WM_EVENTS.priceEvent.sku && month >= WM_EVENTS.priceEvent.month)
        units = Math.round((units * WM_EVENTS.priceEvent.unitsFactorPermille) / 1000);
      if (p.sku === WM_EVENTS.distractor.sku && month === WM_EVENTS.distractor.month)
        units = Math.round((units * WM_EVENTS.distractor.unitsFactorPermille) / 1000);
      const { price, cost } = wmUnit(p, month);
      // Split the month's units into 4-7 lines for random customers on random days.
      const n = int(4, 7);
      let left = units;
      for (let i = 0; i < n; i++) {
        const q = i === n - 1 ? left : Math.min(left, Math.max(1, Math.round((left / (n - i)) * (0.6 + rnd() * 0.8))));
        left -= q;
        if (q <= 0) continue;
        const c = WM_CUSTOMERS[int(0, WM_CUSTOMERS.length - 1)] as WmCustomer;
        const day = String(int(1, 28)).padStart(2, "0");
        // Whole-percent discount, rounded half up to the penny.
        const discount = Math.floor((q * price * c.discountPct + 50) / 100);
        pending.push({
          date: `${month}-${day}`,
          customer: c.name,
          channel: c.channel,
          sku: p.sku,
          product: p.name,
          category: p.category,
          quantity: q,
          unitPrice: price,
          unitCost: cost,
          discount,
          net: q * price - discount,
        });
      }
    }
  }
  // One invoice per customer and day; lines of an invoice are adjacent.
  pending.sort((a, b) => (a.date + a.customer + a.sku < b.date + b.customer + b.sku ? -1 : 1));
  const numbers = new Map<string, string>();
  return pending.map((l) => {
    const key = `${l.date}|${l.customer}`;
    if (!numbers.has(key)) numbers.set(key, `INV-${String(10001 + numbers.size)}`);
    return { ...l, invoice: numbers.get(key) as string };
  });
}

export const WM_HEADERS = [
  "Invoice Date",
  "Invoice No",
  "Customer",
  "Channel",
  "SKU",
  "Product",
  "Category",
  "Qty",
  "Unit Price",
  "Std cost",
  "Discount",
  "Net Amount",
] as const;

/** Pence → "1234.50" without floats. */
export function pounds(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  const a = Math.abs(pence);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

const csvField = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The one file the dataset ships: invoice lines as CSV (LF line ends, UTF-8, no BOM). */
export function wholesaleMarginCsv(lines: readonly WmLine[] = wholesaleMarginLines()): string {
  const rows = lines.map((l) =>
    [
      l.date,
      l.invoice,
      l.customer,
      l.channel,
      l.sku,
      l.product,
      l.category,
      String(l.quantity),
      pounds(l.unitPrice),
      pounds(l.unitCost),
      pounds(l.discount),
      pounds(l.net),
    ]
      .map(csvField)
      .join(","),
  );
  return `${[WM_HEADERS.join(","), ...rows].join("\n")}\n`;
}

export function wholesaleMarginFiles(): Record<string, Uint8Array> {
  return { "invoice-lines.csv": new TextEncoder().encode(wholesaleMarginCsv()) };
}

// ── Ground truth ────────────────────────────────────────────────────────────────────────────────────────────

export interface WmItem {
  /** Pence. */
  readonly revenue: number;
  readonly cost: number;
  readonly quantity: number;
}

/** Per month and SKU: revenue = sum of net amounts, cost = sum of quantity x unit cost, quantity = sum of units. */
export function wmByMonthSku(lines: readonly WmLine[]): Map<string, WmItem> {
  const m = new Map<string, { revenue: number; cost: number; quantity: number }>();
  for (const l of lines) {
    const k = `${l.date.slice(0, 7)}|${l.sku}`;
    const a = m.get(k) ?? { revenue: 0, cost: 0, quantity: 0 };
    a.revenue += l.net;
    a.cost += l.quantity * l.unitCost;
    a.quantity += l.quantity;
    m.set(k, a);
  }
  return m;
}

export interface PvmMarginEffects {
  readonly deltaMargin: number;
  readonly volume: number;
  readonly mix: number;
  readonly price: number;
  readonly cost: number;
}

/**
 * pvm_margin.v1 for items present in both periods with non-zero quantity (docs/specs/analysis-library.md §10), in
 * pence. This dataset has no new, lost or unpriced items, so those effects are not needed here. Reference formulas
 * for the eval data only; the engine's own implementation lives in packages/analysis.
 */
export function referencePvmMargin(prev: ReadonlyMap<string, WmItem>, cur: ReadonlyMap<string, WmItem>): PvmMarginEffects {
  const skus = [...cur.keys()].filter((k) => prev.has(k));
  let q0 = 0;
  let q1 = 0;
  let m0 = 0;
  let m1 = 0;
  let sumQ1U0 = 0;
  let price = 0;
  let cost = 0;
  for (const k of skus) {
    const a = prev.get(k) as WmItem;
    const b = cur.get(k) as WmItem;
    q0 += a.quantity;
    q1 += b.quantity;
    m0 += a.revenue - a.cost;
    m1 += b.revenue - b.cost;
    const u0 = (a.revenue - a.cost) / a.quantity;
    sumQ1U0 += b.quantity * u0;
    price += b.quantity * (b.revenue / b.quantity - a.revenue / a.quantity);
    cost -= b.quantity * (b.cost / b.quantity - a.cost / a.quantity);
  }
  const ubar0 = m0 / q0;
  return { deltaMargin: m1 - m0, volume: (q1 - q0) * ubar0, mix: sumQ1U0 - q1 * ubar0, price, cost };
}

// ── Expectations ────────────────────────────────────────────────────────────────────────────────────────────

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const gbp = (pence: number) => pence / 100;

function monthTotals(by: ReadonlyMap<string, WmItem>, month: string) {
  let revenue = 0;
  let cost = 0;
  for (const p of WM_PRODUCTS) {
    const a = by.get(`${month}|${p.sku}`) as WmItem;
    revenue += a.revenue;
    cost += a.cost;
  }
  return { revenue, cost, margin: revenue - cost };
}

function slice(by: ReadonlyMap<string, WmItem>, month: string): Map<string, WmItem> {
  return new Map(WM_PRODUCTS.map((p) => [p.sku, by.get(`${month}|${p.sku}`) as WmItem]));
}

function eventBlock(by: ReadonlyMap<string, WmItem>, month: WmMonth) {
  const prev = WM_MONTHS[WM_MONTHS.indexOf(month) - 1] as WmMonth;
  const a = monthTotals(by, prev);
  const b = monthTotals(by, month);
  const e = referencePvmMargin(slice(by, prev), slice(by, month));
  return {
    month,
    baseline: prev,
    revenue: { [prev]: gbp(a.revenue), [month]: gbp(b.revenue) },
    revenue_change_pct: r4(((b.revenue - a.revenue) / a.revenue) * 100),
    gross_margin: { [prev]: gbp(a.margin), [month]: gbp(b.margin) },
    gross_margin_change: gbp(b.margin - a.margin),
    gross_margin_pct: { [prev]: r4((a.margin / a.revenue) * 100), [month]: r4((b.margin / b.revenue) * 100) },
    pvm_margin: {
      volume: r4(gbp(e.volume)),
      mix: r4(gbp(e.mix)),
      price: r4(gbp(e.price)),
      cost: r4(gbp(e.cost)),
      sum: r4(gbp(e.volume + e.mix + e.price + e.cost)),
    },
    products: WM_PRODUCTS.map((p) => {
      const x = by.get(`${prev}|${p.sku}`) as WmItem;
      const y = by.get(`${month}|${p.sku}`) as WmItem;
      return {
        sku: p.sku,
        [`units_${prev}`]: x.quantity,
        [`revenue_${prev}`]: gbp(x.revenue),
        [`cost_${prev}`]: gbp(x.cost),
        [`units_${month}`]: y.quantity,
        [`revenue_${month}`]: gbp(y.revenue),
        [`cost_${month}`]: gbp(y.cost),
      };
    }),
  };
}

/** Everything a margin pack must reproduce on this dataset, from the lines (the committed expectations.yaml). */
export function wholesaleMarginExpectations(lines: readonly WmLine[] = wholesaleMarginLines()) {
  const by = wmByMonthSku(lines);
  const last = WM_MONTHS[WM_MONTHS.length - 1] as WmMonth;
  const latest = WM_PRODUCTS.map((p) => {
    const a = by.get(`${last}|${p.sku}`) as WmItem;
    return {
      sku: p.sku,
      revenue: gbp(a.revenue),
      cost: gbp(a.cost),
      gross_margin: gbp(a.revenue - a.cost),
      gross_margin_pct: r4(((a.revenue - a.cost) / a.revenue) * 100),
    };
  });
  const lowest = [...latest].sort((x, y) => x.gross_margin_pct - y.gross_margin_pct)[0];
  const dPrev = WM_MONTHS[WM_MONTHS.indexOf(WM_EVENTS.distractor.month) - 1] as WmMonth;
  const d0 = by.get(`${dPrev}|${WM_EVENTS.distractor.sku}`) as WmItem;
  const d1 = by.get(`${WM_EVENTS.distractor.month}|${WM_EVENTS.distractor.sku}`) as WmItem;
  return {
    dataset: "wholesale-margin-v1",
    seed: WHOLESALE_MARGIN_SEED,
    currency: WM_CURRENCY,
    today: WM_TODAY,
    rows: lines.length,
    // Money in pounds (pence / 100); percentages rounded to 4 decimals; effects to 4 decimals.
    months: WM_MONTHS.map((m) => {
      const t = monthTotals(by, m);
      return {
        month: m,
        revenue: gbp(t.revenue),
        cost: gbp(t.cost),
        gross_margin: gbp(t.margin),
        gross_margin_pct: r4((t.margin / t.revenue) * 100),
      };
    }),
    squeeze: eventBlock(by, WM_EVENTS.squeeze.month),
    price_event: eventBlock(by, WM_EVENTS.priceEvent.month),
    distractor: {
      month: WM_EVENTS.distractor.month,
      sku: WM_EVENTS.distractor.sku,
      units_change_pct: r4(((d1.quantity - d0.quantity) / d0.quantity) * 100),
      revenue_change_pct: r4(((d1.revenue - d0.revenue) / d0.revenue) * 100),
    },
    latest_month: { month: last, lowest_margin_pct_sku: lowest?.sku, products: latest },
  };
}
