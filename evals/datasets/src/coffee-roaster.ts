// coffee-roaster-v1: the hand-built golden dataset that mirrors docs/assets/blueprint.html §02.
// The monthly table below is the ground truth (typed from the blueprint). Transactions are generated
// deterministically so that they aggregate *exactly* to it; all money is integer cents.

export interface MonthTruth {
  readonly month: string; // YYYY-MM
  readonly revenueCents: number; // excludes refunded orders
  readonly orders: number; // count of non-refunded orders
  readonly wholesaleCents: number;
  readonly retailCents: number;
  readonly refundPermille: number; // refund rate = refunds / revenue, in tenths of a percent (11 = 1.1%)
  readonly hotelGroupCents: number; // the key wholesale client (planted P1: pauses from April)
}

export const MONTHS: readonly MonthTruth[] = [
  {
    month: "2026-01",
    revenueCents: 4_120_000,
    orders: 980,
    wholesaleCents: 1_480_000,
    retailCents: 2_640_000,
    refundPermille: 11,
    hotelGroupCents: 800_000,
  },
  {
    month: "2026-02",
    revenueCents: 4_290_000,
    orders: 1010,
    wholesaleCents: 1_530_000,
    retailCents: 2_760_000,
    refundPermille: 10,
    hotelGroupCents: 820_000,
  },
  {
    month: "2026-03",
    revenueCents: 4_410_000,
    orders: 1050,
    wholesaleCents: 1_590_000,
    retailCents: 2_820_000,
    refundPermille: 12,
    hotelGroupCents: 850_000,
  },
  {
    month: "2026-04",
    revenueCents: 3_620_000,
    orders: 1020,
    wholesaleCents: 740_000,
    retailCents: 2_880_000,
    refundPermille: 13,
    hotelGroupCents: 0,
  },
  {
    month: "2026-05",
    revenueCents: 3_580_000,
    orders: 1005,
    wholesaleCents: 710_000,
    retailCents: 2_870_000,
    refundPermille: 29,
    hotelGroupCents: 0,
  },
  {
    month: "2026-06",
    revenueCents: 3_700_000,
    orders: 1040,
    wholesaleCents: 730_000,
    retailCents: 2_970_000,
    refundPermille: 34,
    hotelGroupCents: 0,
  },
];

/** Refunded amount for a month: revenue × rate. Exact in cents because revenue is a multiple of 1,000 cents. */
export function refundCents(m: MonthTruth): number {
  return (m.revenueCents * m.refundPermille) / 1000;
}

/** Planted cost table, with a ×1000 data-entry typo in February packaging (planted Q1). */
export const COSTS = [
  { month: "2026-01", beans: 12_400, packaging: 1_210, rent: 3_000, staff: 9_000 },
  { month: "2026-02", beans: 12_900, packaging: 1_240_000, rent: 3_000, staff: 9_000 }, // typo: 1,240 typed as 1,240,000
  { month: "2026-03", beans: 13_300, packaging: 1_260, rent: 3_000, staff: 9_200 },
  { month: "2026-04", beans: 11_900, packaging: 1_180, rent: 3_000, staff: 9_200 },
  { month: "2026-05", beans: 11_800, packaging: 1_350, rent: 3_000, staff: 9_200 },
  { month: "2026-06", beans: 12_100, packaging: 1_390, rent: 3_000, staff: 9_400 },
] as const;

export interface OrderRow {
  readonly date: string; // dd/mm/yyyy text (planted date-format ambiguity, Q2)
  readonly orderId: string;
  readonly customer: string;
  readonly channel: "wholesale" | "retail";
  readonly product: string;
  readonly qty: number;
  readonly amountCents: number;
  readonly status: "paid" | "refunded";
}

const OTHER_WHOLESALE = ["Cafe Bodrum", "Green Leaf Bakery", "Office Brew Co"] as const;
const WHOLESALE_PRODUCTS = ["Espresso blend 1kg", "Filter blend 1kg"] as const;
const RETAIL_PRODUCTS = ["Espresso blend 250g", "Filter blend 250g", "Drip bags x10"] as const;
const RETAIL_CUSTOMERS = ["Shop counter", "Online store"] as const;
const ORDERS_PER_WHOLESALE_CLIENT = 4;

/** Mulberry32: small seeded PRNG so the dataset is byte-for-byte reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Splits `total` cents into `n` positive parts with random weights; the parts sum to `total` exactly. */
export function allocate(total: number, n: number, rand: () => number): number[] {
  if (n <= 0) return [];
  const weights = Array.from({ length: n }, () => 0.6 + rand() * 0.8);
  const sum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w) => Math.floor((total * w) / sum));
  let rest = total - parts.reduce((a, b) => a + b, 0);
  for (let i = 0; rest > 0; i = (i + 1) % n, rest--) parts[i] = (parts[i] ?? 0) + 1;
  return parts;
}

function daysIn(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function ddmmyyyy(month: string, day: number): string {
  const [y, m] = month.split("-");
  return `${String(day).padStart(2, "0")}/${m}/${y}`;
}

/** Hotel Group appears under two spellings (planted entity-matching case E1). */
export function hotelGroupName(month: string): string {
  return month < "2026-03" ? "OOO Hotel Group" : "Hotel Group LLC";
}

export function generateOrders(seed = 20260412): OrderRow[] {
  const rand = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const rows: Omit<OrderRow, "orderId">[] = [];

  for (const m of MONTHS) {
    const days = daysIn(m.month);
    const day = () => 1 + Math.floor(rand() * days);
    const wholesaleClients: [string, number][] = [];
    if (m.hotelGroupCents > 0) wholesaleClients.push([hotelGroupName(m.month), m.hotelGroupCents]);
    const others = allocate(m.wholesaleCents - m.hotelGroupCents, OTHER_WHOLESALE.length, rand);
    for (const [i, c] of OTHER_WHOLESALE.entries()) wholesaleClients.push([c, others[i] ?? 0]);

    let wholesaleRows = 0;
    for (const [customer, cents] of wholesaleClients) {
      for (const amount of allocate(cents, ORDERS_PER_WHOLESALE_CLIENT, rand)) {
        const qty = Math.max(1, Math.round(amount / 22_000)); // about 220 per kg
        rows.push({
          date: ddmmyyyy(m.month, day()),
          customer,
          channel: "wholesale",
          product: pick(WHOLESALE_PRODUCTS),
          qty,
          amountCents: amount,
          status: "paid",
        });
        wholesaleRows++;
      }
    }
    for (const amount of allocate(m.retailCents, m.orders - wholesaleRows, rand)) {
      rows.push({
        date: ddmmyyyy(m.month, day()),
        customer: pick(RETAIL_CUSTOMERS),
        channel: "retail",
        product: pick(RETAIL_PRODUCTS),
        qty: 1 + Math.floor(rand() * 3),
        amountCents: amount,
        status: "paid",
      });
    }
    const refunds = refundCents(m);
    for (const amount of allocate(refunds, Math.max(1, Math.round(refunds / 2_700)), rand)) {
      rows.push({
        date: ddmmyyyy(m.month, day()),
        customer: pick(RETAIL_CUSTOMERS),
        channel: "retail",
        product: pick(RETAIL_PRODUCTS),
        qty: 1,
        amountCents: amount,
        status: "refunded",
      });
    }
  }

  const key = (r: { date: string }) => r.date.split("/").reverse().join("");
  const sorted = rows.map((r, i) => ({ r, i })).sort((a, b) => key(a.r).localeCompare(key(b.r)) || a.i - b.i);
  return sorted.map(({ r }, i) => ({ ...r, orderId: `CR-${String(i + 1).padStart(5, "0")}` }));
}

/** Aggregates order rows back to the monthly table (used by tests to prove the dataset is exact). */
export function aggregateOrders(
  rows: readonly OrderRow[],
): Map<string, { revenue: number; orders: number; wholesale: number; retail: number; refunds: number }> {
  const out = new Map<string, { revenue: number; orders: number; wholesale: number; retail: number; refunds: number }>();
  for (const r of rows) {
    const [, mo, y] = r.date.split("/");
    const month = `${y}-${mo}`;
    const acc = out.get(month) ?? { revenue: 0, orders: 0, wholesale: 0, retail: 0, refunds: 0 };
    if (r.status === "refunded") acc.refunds += r.amountCents;
    else {
      acc.revenue += r.amountCents;
      acc.orders += 1;
      if (r.channel === "wholesale") acc.wholesale += r.amountCents;
      else acc.retail += r.amountCents;
    }
    out.set(month, acc);
  }
  return out;
}
