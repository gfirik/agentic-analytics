// The seeded dataset generator (docs/EVALS.md §1). One archetype and one variant give a synthetic business: monthly
// transactions with realistic noise, documents that mention what happened, and an answer key of what a correct
// report must find. Everything comes from integer cents and a seeded PRNG, so a dataset is byte-identical on every
// build; its hash is pinned in the manifest test.
//
// Variants (all end in 2026-06):
//   0 · 12 months, dd/mm/yyyy text dates, sales.xlsx: key client lost after a price rise (P1).
//   1 · 18 months, orders.csv + costs.xlsx: P1, plus a supplier switch that raises refunds (P2).
//   2 · 24 months with a December peak, sales.xlsx: P1, plus a new product cannibalizing an old one (P3).
// Every variant has a ×1000 cost typo (Q1), a noise blip inside the band (D1, never in a December peak month) and
// irrelevant or coincidental documents. Variant 2 adds the seasonal December peak as a distractor (D2).
import { createHash } from "node:crypto";
import { allocate, docx, eml, rng, textPdf } from "@agentic-analytics/eval-datasets";
import * as XLSX from "xlsx";
import { stringify } from "yaml";
import { ARCHETYPES, type Archetype } from "./archetypes.ts";

export const GENERATOR_VERSION = 1;
const END = { year: 2026, month: 6 };
const LENGTHS = [12, 18, 24] as const;
/** The jobs' "today": the first day after the series ends (END.month is 1-based, so it is next month's index). */
const TODAY = new Date(Date.UTC(END.year, END.month, 1));

export interface Member {
  readonly dimension: string;
  readonly member: string;
}

export interface Planted {
  readonly id: string;
  readonly type: "regression" | "improvement";
  readonly metric: string;
  readonly period: string;
  /** For a change of one member (a product, a customer) rather than the whole metric. */
  readonly member?: Member;
  /** The top driver a decomposition should name. */
  readonly driver?: Member;
  /** Other correct top drivers at a coarser level (the key client's channel). */
  readonly driver_alternatives?: readonly Member[];
  /** The change lasts: later periods (a year-on-year drop at the end) show the same event. */
  readonly persists?: boolean;
  readonly cause?: { readonly doc: string; readonly grade_at_least: "correlated" | "document_supported" };
  /** Scenario types a good recommendation would use (agent-and-verifier §6). */
  readonly good_actions: readonly string[];
  readonly description: string;
}

export interface Distractor {
  readonly id: string;
  readonly description: string;
  readonly metric: string;
  /** Other metrics the same non-event moves (orders rise with revenue in a seasonal peak). */
  readonly also?: readonly string[];
  readonly period: string;
  readonly member?: Member;
  readonly must_not_appear_as_finding: true;
}

export interface QualityKey {
  readonly id: string;
  readonly kind: string;
  readonly file: string;
  readonly location: string;
  readonly description: string;
}

export interface AnswerKey {
  readonly dataset: string;
  readonly archetype: string;
  readonly business: string;
  readonly generator_version: number;
  readonly seed: number;
  readonly variant: number;
  readonly period: { readonly from: string; readonly to: string; readonly grain: "month" };
  readonly currency: string;
  readonly today: string;
  readonly files: readonly string[];
  readonly planted: readonly Planted[];
  readonly distractors: readonly Distractor[];
  readonly quality: readonly QualityKey[];
  /** "heldout" for the held-out generated set (src/heldout.ts), read only by release runs; absent for the 30. */
  readonly split?: "heldout";
}

export interface Dataset {
  readonly id: string;
  readonly answers: AnswerKey;
  readonly files: Readonly<Record<string, Uint8Array>>;
}

const pad = (n: number) => String(n).padStart(2, "0");

function months(n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(END.year, END.month - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  }
  return out;
}

const daysIn = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
const longDate = (m: string, day: number) =>
  new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, day)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

interface Order {
  readonly date: string;
  readonly id: string;
  readonly customer: string;
  readonly channel: string;
  readonly product: string;
  readonly qty: number;
  readonly cents: number;
  readonly status: "paid" | "refunded";
}

/** A dataset for one archetype and variant; `seed` defaults to a stable value per (archetype, variant). */
export function generateDataset(a: Archetype, variant: 0 | 1 | 2, seed?: number): Dataset {
  const index = ARCHETYPES.indexOf(a);
  const s = seed ?? 20260000 + (index + 1) * 100 + variant;
  const rand = rng(s);
  const noise = (sd: number) => {
    // A sum of uniforms is close enough to normal for business noise, and stays deterministic.
    let x = 0;
    for (let i = 0; i < 6; i++) x += rand();
    return (x - 3) * sd * Math.SQRT2;
  };
  const n = LENGTHS[variant];
  const ms = months(n);
  const id = `${a.id}-v${variant + 1}`;
  const [counterCh, accountsCh] = a.channels;
  const key = a.accounts[0] as string;
  const L = n - 3; // the key client pauses from this month
  const S = n - 2; // supplier switch (variant 1)
  const C = n - 5; // product launch (variant 2)
  // The noise blip (distractor D1). n − 7 is 2025-12 in every variant, which in variant 2 is a planted December peak
  // (×1.25 on the blip customer's channel). There the blip moves to 2025-11, before the peak: a month after it
  // (2026-01) would sit on the post-peak drop, so a real January-vs-December finding would count as the false alarm.
  // Variants 0 and 1 keep n − 7, so their datasets and published results are unchanged.
  const N = variant === 2 ? n - 8 : n - 7;
  const blipCustomer = a.counter[1] as string;
  const oldProduct = a.products[0][0] as string;
  const accountShares = [0.45, ...allocate(55, a.accounts.length - 1, rand).map((x) => x / 100)];
  const orders: Order[] = [];
  let seq = 1000;

  for (const [i, m] of ms.entries()) {
    const trend = 1 + 0.004 * i;
    const december = variant === 2 && m.endsWith("-12") ? 1.25 : 1;
    // Counter channel: buckets of many small orders.
    const counterTotal = a.monthly.counter * trend * december * (1 + noise(0.015));
    const buckets = [0.6, 0.4].slice(0, a.counter.length);
    for (const [b, customer] of a.counter.entries()) {
      const blip = i === N && customer === blipCustomer ? 1.03 : 1;
      const cents = Math.round(counterTotal * (buckets[b] ?? 0.4) * blip * 100);
      const count = Math.max(4, Math.round(cents / 100 / a.order.counter));
      const parts = allocate(cents, count, rand);
      const refundRate = variant === 1 && i >= S ? 0.035 : 0.01;
      for (const [k, part] of parts.entries()) {
        // Product mix: the launch takes most of the old product's sales from month C (variant 2).
        const r = rand();
        const launched = variant === 2 && i >= C;
        const product = launched
          ? r < 0.12
            ? oldProduct
            : r < 0.5
              ? a.launch
              : (a.products[0][1] as string)
          : r < 0.5
            ? oldProduct
            : (a.products[0][1] as string);
        const day = 1 + Math.floor((k / parts.length) * daysIn(m));
        orders.push({
          date: `${m}-${pad(day)}`,
          id: `${slug(a.business).slice(0, 3).toUpperCase()}-${seq++}`,
          customer,
          channel: counterCh,
          product,
          qty: 1 + Math.floor(rand() * 3),
          cents: part,
          status: rand() < refundRate ? "refunded" : "paid",
        });
      }
    }
    // Accounts channel: a few clients with standing orders.
    const accountsTotal = a.monthly.accounts * trend * (1 + noise(0.015));
    for (const [c, client] of a.accounts.entries()) {
      if (client === key && i >= L) continue; // paused after the price rise
      const cents = Math.round(accountsTotal * (accountShares[c] ?? 0) * 100);
      const count = 2 + (c % 3);
      for (const [k, part] of allocate(cents, count, rand).entries()) {
        const day = 3 + Math.floor((k / count) * (daysIn(m) - 4));
        orders.push({
          date: `${m}-${pad(day)}`,
          id: `${slug(a.business).slice(0, 3).toUpperCase()}-${seq++}`,
          customer: client,
          channel: accountsCh,
          product: a.products[1][k % 2] as string,
          qty: 5 + Math.floor(rand() * 20),
          cents: part,
          status: "paid",
        });
      }
    }
  }
  orders.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.id < y.id ? -1 : 1));

  // Costs with a ×1000 typo (Q1).
  const typoRow = Math.max(0, n - 8);
  const costs = ms.map((m, i) => ({
    month: m,
    rent: Math.round(a.monthly.counter * 0.12),
    staff: Math.round((a.monthly.counter + a.monthly.accounts) * 0.3 * (1 + 0.002 * i)),
    supplies: Math.round((a.monthly.counter + a.monthly.accounts) * 0.08 * (1 + noise(0.02))) * (i === typoRow ? 1000 : 1),
  }));

  const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const header = ["Date", "Order ID", "Customer", "Channel", "Product", "Qty", "Amount", "Status"];
  const rows = orders.map((o) => [
    variant === 0 ? ddmmyyyy(o.date) : o.date,
    o.id,
    o.customer,
    o.channel,
    o.product,
    o.qty,
    o.cents / 100,
    o.status,
  ]);
  const costRows = [["Month", "Rent", "Staff", "Supplies"], ...costs.map((c) => [c.month, c.rent, c.staff, c.supplies])];
  const files: Record<string, Uint8Array> = {};
  const workbook = (sheets: [string, (string | number)[][]][]) => {
    const wb = XLSX.utils.book_new();
    wb.Props = { Title: a.business, Author: a.business, CreatedDate: TODAY, ModifiedDate: TODAY };
    for (const [name, data] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), name);
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true }) as Uint8Array;
  };
  let costFile: string;
  if (variant === 1) {
    const csv = (v: string | number) => (typeof v === "string" && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v));
    files["orders.csv"] = new TextEncoder().encode(`${[header, ...rows].map((r) => r.map(csv).join(",")).join("\n")}\n`);
    files["costs.xlsx"] = workbook([["Costs", costRows]]);
    costFile = "costs.xlsx";
  } else {
    files["sales.xlsx"] = workbook([
      ["Orders", [header, ...rows]],
      ["Costs", costRows],
    ]);
    costFile = "sales.xlsx";
  }

  // Documents: the cause of each planted event, plus distractors.
  const priceMonth = ms[L - 1] as string;
  const pauseMonth = ms[L] as string;
  const priceDate = longDate(priceMonth, 20);
  const emailFile = `email-${slug(key)}.eml`;
  files[emailFile] = eml(
    {
      from: `"${key} purchasing" <purchasing@${slug(key)}.example>`,
      to: `orders@${slug(a.business)}.example`,
      subject: "Our standing order",
      date: `${new Date(Date.UTC(Number(pauseMonth.slice(0, 4)), Number(pauseMonth.slice(5, 7)) - 1, 6, 9)).toUTCString().replace("GMT", "+0000")}`,
      id: `${s}@${slug(key)}.example`,
    },
    `Hello,\n\nAfter the price increase announced on ${priceDate} we are pausing our standing order while we compare suppliers.\nWe will let you know if anything changes.\n\nRegards\n${key}\n`,
  );
  const notice = `${accountsCh[0]?.toUpperCase()}${accountsCh.slice(1)} prices increase 10% from ${priceDate}.`;
  const noticeFile = variant === 1 ? "price-notice.md" : "price-notice.pdf";
  files[noticeFile] =
    variant === 1
      ? new TextEncoder().encode(`# Price notice\n\n${notice}\n\nCounter prices are unchanged.\n`)
      : textPdf([[`${a.business}: price notice`, notice, "Counter prices are unchanged.", "Questions: contact your account manager."]]);
  files["office-notes.txt"] = new TextEncoder().encode(
    `Office notes\n\nWe repainted the front office on ${longDate(ms[N] as string, 14)}.\nThe coffee machine was serviced in the same week.\n`,
  );
  files["staff-policy.md"] = new TextEncoder().encode(
    "# Staff policy\n\nHolidays are booked two weeks ahead. Sick days are reported to the manager before 9am.\n",
  );
  if (variant === 1)
    files["ops-notes.docx"] = docx([
      {
        heading: "Operations notes",
        paragraphs: [
          "Stock counts were done at the end of each month.",
          `On ${longDate(ms[S] as string, 5)} we switched our ${a.supply} supplier to ${a.newSupplier}.`,
          "The delivery schedule did not change.",
        ],
      },
    ]);
  if (variant === 2)
    files["launch-plan.md"] = new TextEncoder().encode(
      `# Launch plan\n\nWe launched ${a.launch} on ${longDate(ms[C] as string, 3)}. It replaces ${oldProduct} for most customers.\n`,
    );

  const planted: Planted[] = [
    {
      id: "P1",
      type: "regression",
      metric: "revenue",
      period: pauseMonth,
      driver: { dimension: "customer", member: key },
      driver_alternatives: [{ dimension: "channel", member: accountsCh }],
      persists: true,
      cause: { doc: emailFile, grade_at_least: "document_supported" },
      good_actions: ["recover_share"],
      description: `${key} paused its standing order after the ${accountsCh} price rise`,
    },
  ];
  if (variant === 1)
    planted.push({
      id: "P2",
      type: "regression",
      metric: "refund_rate",
      period: ms[S] as string,
      persists: true,
      cause: { doc: "ops-notes.docx", grade_at_least: "correlated" },
      good_actions: ["remove_excess_rate"],
      description: `refunds rose after the ${a.supply} supplier switch to ${a.newSupplier}`,
    });
  if (variant === 2)
    planted.push({
      id: "P3",
      type: "regression",
      metric: "revenue",
      period: ms[C] as string,
      member: { dimension: "product", member: oldProduct },
      persists: true,
      cause: { doc: "launch-plan.md", grade_at_least: "correlated" },
      good_actions: [],
      description: `${a.launch} took most of ${oldProduct}'s sales`,
    });
  const distractors: Distractor[] = [
    {
      id: "D1",
      description: `a 3% blip for ${blipCustomer}, inside the noise band`,
      metric: "revenue",
      period: ms[N] as string,
      member: { dimension: "customer", member: blipCustomer },
      must_not_appear_as_finding: true,
    },
  ];
  if (variant === 2)
    // Every December is inflated, so each is a distractor, for revenue and for orders (the peak moves both).
    for (const [k, dec] of ms.filter((m) => m.endsWith("-12")).entries())
      distractors.push({
        id: `D${2 + k}`,
        description: `the ${dec} peak is seasonal (every December is 25% higher)`,
        metric: "revenue",
        also: ["orders"],
        period: dec,
        must_not_appear_as_finding: true,
      });
  const quality: QualityKey[] = [
    {
      id: "Q1",
      kind: "unit_error",
      file: costFile,
      location: `${costFile}#Costs!D${typoRow + 2}`,
      description: `supplies for ${ms[typoRow]} are 1,000× the other months`,
    },
  ];
  if (variant === 0)
    quality.push({
      id: "Q2",
      kind: "date_format_ambiguity",
      file: "sales.xlsx",
      location: "sales.xlsx#Orders!A:A",
      description: "dates are dd/mm/yyyy text; days ≤ 12 are ambiguous",
    });
  const answers: AnswerKey = {
    dataset: id,
    archetype: a.id,
    business: a.business,
    generator_version: GENERATOR_VERSION,
    seed: s,
    variant: variant + 1,
    period: { from: ms[0] as string, to: ms.at(-1) as string, grain: "month" },
    currency: a.currency,
    today: TODAY.toISOString().slice(0, 10),
    files: Object.keys(files).sort(),
    planted,
    distractors,
    quality,
  };
  return { id, answers, files };
}

/** The 30 generated datasets: every archetype in every variant. */
export function generatedDatasets(): Dataset[] {
  return ARCHETYPES.flatMap((a) => ([0, 1, 2] as const).map((v) => generateDataset(a, v)));
}

export function answersYaml(k: AnswerKey): string {
  return `# ${k.dataset} answer key (generated by evals/generator v${k.generator_version}, seed ${k.seed}).\n# Changing an answer key requires a note in the PR (docs/EVALS.md §5).\n${stringify(k)}`;
}

/** Per dataset: the generator version, seed and a SHA-256 of every file, so any drift is caught in review. */
export function manifest(all: readonly Dataset[] = generatedDatasets()): Record<string, { seed: number; files: Record<string, string> }> {
  return Object.fromEntries(
    all.map((d) => [
      d.id,
      {
        seed: d.answers.seed,
        files: Object.fromEntries(Object.entries(d.files).map(([n, b]) => [n, createHash("sha256").update(b).digest("hex")])),
      },
    ]),
  );
}
