// The held-out generated set (docs/specs/accuracy.md §9, docs/plans/analyst-grade.md §4.6). It answers the M13a
// caveat that the offline baseline's heuristics were tuned on the same 30 businesses they are scored on. Two parts:
//   - the ten development archetypes again, each in one variant with a new seed (new noise, shares and order
//     splits; the same templates), ids `<archetype>-v<k>-heldout`;
//   - two archetypes no heuristic was written against, each in two variants: an equipment-hire business whose rows
//     are hire-contract lines across depots (tool_hire), and a car-wash chain whose rows are daily takings per site
//     and wash programme, already aggregated (car_wash). Different business shape, column names, row grain, date
//     formats, currencies, series lengths and end dates from the 30, with planted events of new kinds (a depot
//     closure, a lost account across depots, an improvement, a site's refund fault, a price-driven mix shift).
// Release runs read this set (`aa eval --suite heldout`); one dataset is in the smoke suite as the CI path. The
// engine never reads it: a test keeps packages/ and apps/ away from this module and its answer keys.
// Everything is integer cents and a seeded PRNG, so the files are byte-identical on every build
// (evals/generator/heldout-manifest.json pins their hashes).
import { allocate, docx, eml, rng, textPdf } from "@agentic-analytics/eval-datasets";
import * as XLSX from "xlsx";
import { ARCHETYPES } from "./archetypes.ts";
import type { AnswerKey, Dataset, Distractor, Planted, QualityKey } from "./generate.ts";
import { generateDataset } from "./generate.ts";

/** The generator version that introduced the held-out archetypes (the 30 keep version 1, unchanged). */
export const HELDOUT_GENERATOR_VERSION = 2;

/** The held-out set's dataset in the smoke suite: the CI path runs it offline with the baseline on every PR. */
export const HELDOUT_SMOKE = "tool_hire-v1";

const pad = (n: number) => String(n).padStart(2, "0");

/** `n` months ending at `end` ("2026-08"), oldest first. */
function monthsTo(end: string, n: number): string[] {
  const [y, m] = end.split("-").map(Number) as [number, number];
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  }
  return out;
}

const daysIn = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
const nextMonthFirst = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1)).toISOString().slice(0, 10);
const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const shortMonth = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "3 Mar 2026": the hire system's CSV export writes dates this way. */
const dMonY = (iso: string) => `${Number(iso.slice(8, 10))} ${shortMonth[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/**
 * An Excel date cell (serial days since 1899-12-30), so the workbook holds real dates, not text. Format 14 is Excel's
 * built-in short date: a custom format string would be added to SheetJS's global format table and change the bytes
 * of every workbook written after it, the 30 development datasets included.
 */
const excelDate = (iso: string) => ({ t: "n", v: (Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000, z: "m/d/yy" });
const money = (cents: number) => cents / 100;
const csvCell = (v: string | number) => (typeof v === "string" && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v));
const csv = (rows: readonly (readonly (string | number)[])[]) =>
  new TextEncoder().encode(`${rows.map((r) => r.map(csvCell).join(",")).join("\n")}\n`);
const text = (s: string) => new TextEncoder().encode(s);

function workbook(title: string, today: string, sheets: readonly [string, unknown[][]][]): Uint8Array {
  const wb = XLSX.utils.book_new();
  const at = new Date(`${today}T00:00:00Z`);
  wb.Props = { Title: title, Author: title, CreatedDate: at, ModifiedDate: at };
  for (const [name, data] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), name);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true }) as Uint8Array;
}

/** Normal-ish noise from a sum of uniforms (as the development generator does): deterministic for a seed. */
function noiseOf(rand: () => number) {
  return (sd: number) => {
    let x = 0;
    for (let i = 0; i < 6; i++) x += rand();
    return (x - 3) * sd * Math.SQRT2;
  };
}

const answersOf = (
  k: Omit<AnswerKey, "generator_version" | "period" | "files" | "split"> & { months: readonly string[]; files: Record<string, Uint8Array> },
): AnswerKey => {
  const { months, files, ...rest } = k;
  return {
    dataset: rest.dataset,
    archetype: rest.archetype,
    business: rest.business,
    generator_version: HELDOUT_GENERATOR_VERSION,
    seed: rest.seed,
    variant: rest.variant,
    period: { from: months[0] as string, to: months.at(-1) as string, grain: "month" },
    currency: rest.currency,
    today: rest.today,
    files: Object.keys(files).sort(),
    planted: rest.planted,
    distractors: rest.distractors,
    quality: rest.quality,
    split: "heldout",
  };
};

// ---------------------------------------------------------------------------------------------------------------
// tool_hire: Summit Tool & Plant Hire (GBP). One row per hire-contract line: depot, account, equipment group, item,
// quantity, hire days, list day rate, net amount after the account discount, and the off-hire date. Four depots, a
// cash counter and five trade accounts; every December is a Christmas shutdown (about 30% lower).

const TOOL_HIRE = {
  id: "tool_hire",
  business: "Summit Tool & Plant Hire",
  currency: "GBP",
  depots: [
    ["Northfield", 0.32],
    ["Riverside", 0.27],
    ["Eastgate", 0.23],
    ["Harbourside", 0.18],
  ] as const,
  accounts: [
    ["Cash sale", 0.4],
    ["Ashdown Civils", 0.22],
    ["Delph Scaffolding", 0.12],
    ["Cartwright Electrical", 0.1],
    ["Brookvale Homes", 0.08],
    ["Elmore Facilities", 0.08],
  ] as const,
  /** [group, item, list day rate in pence]. */
  items: [
    ["Access", "Scaffold tower", 3800],
    ["Access", "Scissor lift 8m", 9500],
    ["Access", "Cherry picker 12m", 16500],
    ["Power tools", "SDS breaker", 2600],
    ["Power tools", "Disc cutter", 2900],
    ["Power tools", "Core drill", 4200],
    ["Plant", "Mini digger 1.5t", 11500],
    ["Plant", "Dumper 1t", 7800],
    ["Plant", "Roller 80cm", 6200],
    ["Site lighting", "Tower light", 5400],
    ["Site lighting", "Festoon kit", 1600],
  ] as const,
  /** Monthly net hire revenue in pounds, and the average line. */
  monthly: 180_000,
  line: 420,
};

interface HireLine {
  readonly start: string;
  readonly depot: string;
  readonly account: string;
  readonly group: string;
  readonly item: string;
  readonly qty: number;
  readonly days: number;
  readonly rate: number;
  readonly net: number | undefined;
  readonly offHire: string;
}

function toolHire(variant: 0 | 1): Dataset {
  const a = TOOL_HIRE;
  const id = `${a.id}-v${variant + 1}`;
  const seed = 20271100 + variant;
  const rand = rng(seed);
  const noise = noiseOf(rand);
  const end = "2026-08";
  const ms = monthsTo(end, variant === 0 ? 22 : 16);
  const today = nextMonthFirst(end);
  // v1: Eastgate closes after a fire (P1, from month L); Brookvale Homes' framework agreement (P2, from month F).
  // v2: the Access fleet grows (P1, from F); Ashdown Civils moves its hire to another supplier (P2, from L).
  const L = variant === 0 ? ms.indexOf("2026-06") : ms.indexOf("2026-05");
  const F = variant === 0 ? ms.indexOf("2026-03") : ms.indexOf("2026-02");
  const N = ms.indexOf("2025-09"); // the noise blip (D1)
  const blipDepot = variant === 0 ? "Harbourside" : "Riverside";
  const lines: HireLine[] = [];
  for (const [i, m] of ms.entries()) {
    const trend = 1 + 0.003 * i;
    const christmas = m.endsWith("-12") ? 0.7 : 1;
    for (const [depot, depotShare] of a.depots) {
      if (variant === 0 && depot === "Eastgate" && i >= L) continue; // closed after the fire
      const blip = i === N && depot === blipDepot ? 1.03 : 1;
      const depotTotal = a.monthly * depotShare * trend * christmas * blip * (1 + noise(0.015));
      for (const [account, accountShare] of a.accounts) {
        if (variant === 1 && account === "Ashdown Civils" && i >= L) continue; // hire moved to another supplier
        const framework = variant === 0 && account === "Brookvale Homes" && i >= F ? 3.5 : 1;
        const cents = Math.round(depotTotal * accountShare * framework * (1 + noise(0.01)) * 100);
        // v2: from F, the bigger Access fleet adds Access hires on top of each account's usual mix.
        const accessExtra = variant === 1 && i >= F ? Math.round(cents * 0.18) : 0;
        for (const [extra, total] of [
          [false, cents],
          [true, accessExtra],
        ] as const) {
          if (total <= 0) continue;
          const count = Math.max(1, Math.round(total / 100 / a.line));
          const discount = account === "Cash sale" ? 0 : 0.12;
          for (const [k, net] of allocate(total, count, rand).entries()) {
            const pool = a.items.filter(([g, , rate]) => (extra ? g === "Access" : true) && rate <= net);
            const options = pool.length ? pool : a.items.filter(([g]) => (extra ? g === "Access" : true)).slice(0, 1);
            const [group, item, rate] = options[Math.floor(rand() * options.length)] as (typeof a.items)[number];
            const qty = group === "Power tools" && net >= 4 * rate && rand() < 0.4 ? 2 : 1;
            const days = Math.min(28, Math.max(1, Math.round(net / (qty * rate * (1 - discount)))));
            const day = 1 + Math.floor((k / count) * daysIn(m));
            const start = `${m}-${pad(day)}`;
            lines.push({ start, depot, account, group, item, qty, days, rate, net, offHire: addDays(start, days) });
          }
        }
      }
    }
  }
  lines.sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : 0));
  const prefix = variant === 0 ? "SH" : "ST";
  const contracts = lines.map((_, i) => `${prefix}-${104000 + i}`);

  // Data-quality plants, at fixed rows (row r of the data is spreadsheet row r + 2).
  const quality: QualityKey[] = [];
  const mutable = lines.map((l) => ({ ...l })) as { -readonly [K in keyof HireLine]: HireLine[K] }[];
  const file = variant === 0 ? "hire-ledger.xlsx" : "hires.csv";
  if (variant === 0) {
    const neg = Math.floor(lines.length * 0.41);
    (mutable[neg] as (typeof mutable)[number]).qty = -2;
    quality.push({
      id: "Q1",
      kind: "negative_quantity",
      file,
      location: `${file}#Hires!G${neg + 2}`,
      description: "an off-hire credit keyed as a negative quantity (Qty −2) on an ordinary hire line",
    });
    const fut = Math.floor(lines.length * 0.63);
    const row = mutable[fut] as (typeof mutable)[number];
    row.offHire = `2062${row.offHire.slice(4)}`;
    quality.push({
      id: "Q2",
      kind: "future_date",
      file,
      location: `${file}#Hires!K${fut + 2}`,
      description: "an off-hire date typed with the year 2062 instead of 2026",
    });
  } else {
    const first = Math.floor(lines.length * 0.52);
    for (let r = first; r < first + 7; r++) (mutable[r] as (typeof mutable)[number]).net = undefined;
    quality.push({
      id: "Q1",
      kind: "missing_value",
      file,
      location: `${file}#J${first + 2}:J${first + 8}`,
      description: "seven hire lines with no net amount (priced later), so their month's total is slightly understated",
    });
  }

  const header = [
    "Contract No",
    "Hire start",
    "Depot",
    "Account",
    "Equipment group",
    "Item",
    "Qty",
    "Hire days",
    "Day rate",
    "Net amount",
    "Off-hire",
  ];
  const files: Record<string, Uint8Array> = {};
  if (variant === 0) {
    const rows = mutable.map((l, i) => [
      contracts[i],
      excelDate(l.start),
      l.depot,
      l.account,
      l.group,
      l.item,
      l.qty,
      l.days,
      money(l.rate),
      l.net === undefined ? null : money(l.net),
      excelDate(l.offHire),
    ]);
    files[file] = workbook(a.business, today, [
      ["Hires", [header, ...rows]],
      [
        "Depots",
        [
          ["Depot", "Manager", "Opened", "Postcode"],
          ["Northfield", "R. Okafor", 2009, "NF4 2LT"],
          ["Riverside", "J. Mercer", 2012, "RV1 8QA"],
          ["Eastgate", "S. Doyle", 2016, "EG7 3HD"],
          ["Harbourside", "M. Kaur", 2019, "HB2 5WS"],
        ],
      ],
    ]);
  } else {
    const rows = mutable.map((l, i) => [
      contracts[i] as string,
      dMonY(l.start),
      l.depot,
      l.account,
      l.group,
      l.item,
      l.qty,
      l.days,
      money(l.rate),
      l.net === undefined ? "" : money(l.net),
      dMonY(l.offHire),
    ]);
    files[file] = csv([header, ...rows]);
  }

  const planted: Planted[] = [];
  const distractors: Distractor[] = [];
  if (variant === 0) {
    const fire = addDays(`${ms[L]}-01`, -3);
    files["email-eastgate-depot.eml"] = eml(
      {
        from: '"Sam Doyle" <eastgate@summit-hire.example>',
        to: "operations@summit-hire.example",
        subject: "Eastgate yard",
        date: new Date(`${fire}T16:20:00Z`).toUTCString().replace("GMT", "+0000"),
        id: `${seed}@summit-hire.example`,
      },
      `Hi all,\n\nAfter the fire in the workshop last night the Eastgate yard is closed from ${longDate(`${ms[L]}-01`)} until the building is made safe.\nNo hires go out from Eastgate until further notice; please book Eastgate customers through Northfield where you can.\n\nSam\n`,
    );
    files["framework-agreement.pdf"] = textPdf([
      [
        "Framework agreement: plant and tool hire",
        `Brookvale Homes appoints ${a.business} as its preferred hire supplier for all housing sites from ${longDate(`${ms[F]}-02`)}.`,
        "Rates: trade price list less 12%. Term: two years.",
      ],
    ]);
    planted.push(
      {
        id: "P1",
        type: "regression",
        metric: "revenue",
        period: ms[L] as string,
        driver: { dimension: "depot", member: "Eastgate" },
        persists: true,
        cause: { doc: "email-eastgate-depot.eml", grade_at_least: "document_supported" },
        good_actions: ["recover_share"],
        description: "the Eastgate depot closed after a workshop fire, and its hires stopped",
      },
      {
        id: "P2",
        type: "improvement",
        metric: "revenue",
        period: ms[F] as string,
        driver: { dimension: "account", member: "Brookvale Homes" },
        persists: true,
        cause: { doc: "framework-agreement.pdf", grade_at_least: "correlated" },
        good_actions: [],
        description: "Brookvale Homes' framework agreement more than tripled its hires (a concentration build-up)",
      },
    );
  } else {
    files["email-ashdown-civils.eml"] = eml(
      {
        from: '"Ashdown Civils procurement" <procurement@ashdown-civils.example>',
        to: "accounts@summit-hire.example",
        subject: "Hire contract award",
        date: new Date(`${addDays(`${ms[L]}-01`, -12)}T10:05:00Z`).toUTCString().replace("GMT", "+0000"),
        id: `${seed}@ashdown-civils.example`,
      },
      `Dear Summit team,\n\nFollowing our annual tender we have awarded our plant and tool hire to another supplier from ${longDate(`${ms[L]}-01`)}, because their framework rates were lower.\nPlease arrange collection of any equipment still on hire.\n\nKind regards\nAshdown Civils procurement\n`,
    );
    files["fleet-update.docx"] = docx([
      {
        heading: "Fleet update",
        paragraphs: [
          `On ${longDate(`${ms[F]}-09`)} we added twelve scissor lifts and four cherry pickers to the Access fleet across all depots.`,
          "Power tools and plant stock are unchanged.",
        ],
      },
    ]);
    planted.push(
      {
        id: "P1",
        type: "improvement",
        metric: "revenue",
        period: ms[F] as string,
        member: { dimension: "equipment_group", member: "Access" },
        persists: true,
        cause: { doc: "fleet-update.docx", grade_at_least: "correlated" },
        good_actions: [],
        description: "a bigger Access fleet raised Access hire revenue",
      },
      {
        id: "P2",
        type: "regression",
        metric: "revenue",
        period: ms[L] as string,
        driver: { dimension: "account", member: "Ashdown Civils" },
        persists: true,
        cause: { doc: "email-ashdown-civils.eml", grade_at_least: "document_supported" },
        good_actions: ["recover_share"],
        description: "Ashdown Civils moved its hire, across every depot, to another supplier after a tender",
      },
    );
  }
  files["yard-notes.txt"] = text(
    `Yard notes\n\nThe ${blipDepot} yard was resurfaced on ${longDate(`${ms[N]}-14`)}.\nThe forklift had its annual inspection the same week.\n`,
  );
  files["health-and-safety.md"] = text(
    "# Health and safety\n\nEvery item is inspected and tagged before it goes out. Customers sign the hire terms at the counter.\n",
  );
  distractors.push({
    id: "D1",
    description: `a 3% blip for the ${blipDepot} depot, inside the noise band`,
    metric: "revenue",
    period: ms[N] as string,
    member: { dimension: "depot", member: blipDepot },
    must_not_appear_as_finding: true,
  });
  for (const [k, dec] of ms.filter((m) => m.endsWith("-12")).entries())
    distractors.push({
      id: `D${2 + k}`,
      description: `the ${dec} dip is the Christmas shutdown (every December is about 30% lower)`,
      metric: "revenue",
      also: ["orders"],
      period: dec,
      must_not_appear_as_finding: true,
    });
  return {
    id,
    files,
    answers: answersOf({
      dataset: id,
      archetype: a.id,
      business: a.business,
      seed,
      variant: variant + 1,
      months: ms,
      currency: a.currency,
      today,
      files,
      planted,
      distractors,
      quality,
    }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// car_wash: Clearwater Car Wash (AUD). One row per site, wash programme and trading day, already summed by the
// till: wash count, net sales and re-wash refunds. Four sites; weekends are busier, rainy days quieter, and January
// (the southern summer holidays) is about 20% above the months around it.

const CAR_WASH = {
  id: "car_wash",
  business: "Clearwater Car Wash",
  currency: "AUD",
  /** Washes a day at each site. */
  sites: [
    ["Ringway", 140],
    ["Millbrook", 110],
    ["Harbour Rd", 90],
    ["Westfield", 75],
  ] as const,
  /** [programme, share of washes, price in cents]. */
  programmes: [
    ["Express", 0.45, 1500],
    ["Deluxe", 0.3, 2500],
    ["Ultimate", 0.15, 3500],
    ["Fleet", 0.1, 1200],
  ] as const,
};

interface Takings {
  readonly day: string;
  readonly site: string;
  readonly programme: string;
  washes: number | undefined;
  net: number;
  readonly refunds: number;
}

function carWash(variant: 0 | 1): Dataset {
  const a = CAR_WASH;
  const id = `${a.id}-v${variant + 1}`;
  const seed = 20271200 + variant;
  const rand = rng(seed);
  const noise = noiseOf(rand);
  const end = variant === 0 ? "2026-05" : "2026-04";
  const ms = monthsTo(end, variant === 0 ? 26 : 14);
  const today = nextMonthFirst(end);
  // v1: roadworks cut Ringway's traffic (P1, from 2 March 2026); a refurbished brush gantry at Millbrook raises
  // re-wash refunds (P2, from 8 October 2025). v2: the Ultimate price rise moves buyers down to Deluxe (P1, from
  // 1 October 2025); a competitor opens near Harbour Rd (P2, from 2 March 2026).
  const roadworks = "2026-03-02";
  const gantry = "2025-10-08";
  const priceRise = "2025-10-01";
  const competitor = "2026-03-02";
  const N = variant === 0 ? ms.indexOf("2025-06") : ms.indexOf("2025-07");
  const blipSite = variant === 0 ? "Westfield" : "Ringway";
  const rows: Takings[] = [];
  for (const [i, m] of ms.entries()) {
    const trend = 1 + 0.003 * i;
    const summer = m.endsWith("-01") ? 1.2 : 1;
    for (let d = 1; d <= daysIn(m); d++) {
      const day = `${m}-${pad(d)}`;
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
      const week = weekday === 0 || weekday === 6 ? 1.45 : weekday === 5 ? 1.1 : 1;
      // Rain is shared by every site that day.
      const weather = rand() < 0.22 ? 0.6 : 1;
      for (const [site, base] of a.sites) {
        const blip = i === N && site === blipSite ? 1.03 : 1;
        const traffic =
          (variant === 0 && site === "Ringway" && day >= roadworks ? 0.55 : 1) *
          (variant === 1 && site === "Harbour Rd" && day >= competitor ? 0.68 : 1);
        const siteDay = base * trend * summer * week * weather * blip * traffic;
        const refundRate = variant === 0 && site === "Millbrook" && day >= gantry ? 0.035 : 0.008;
        for (const [programme, share0, price0] of a.programmes) {
          // v2: from the price rise, Ultimate costs $42 and most of its buyers take Deluxe or Express instead.
          const after = variant === 1 && day >= priceRise;
          const share = after ? (({ Express: 0.47, Deluxe: 0.37, Ultimate: 0.06 } as Record<string, number>)[programme] ?? share0) : share0;
          const price = after && programme === "Ultimate" ? 4200 : price0;
          const washes = Math.max(0, Math.round(siteDay * share * (1 + noise(0.08))));
          let refunded = 0;
          for (let w = 0; w < washes; w++) if (rand() < refundRate) refunded++;
          rows.push({ day, site, programme, washes, net: washes * price, refunds: refunded * price });
        }
      }
    }
  }

  const quality: QualityKey[] = [];
  const file = variant === 0 ? "daily-takings.csv" : "takings.xlsx";
  if (variant === 0) {
    // The Harbour Rd tunnel counter was offline for five days: the till kept sales, the count is empty.
    const from = rows.findIndex((r) => r.day === "2025-08-11" && r.site === "Harbour Rd");
    const hit = rows
      .map((r, i) => [r, i] as const)
      .filter(([r]) => r.site === "Harbour Rd" && r.day >= "2025-08-11" && r.day <= "2025-08-15");
    for (const [r] of hit) r.washes = undefined;
    quality.push({
      id: "Q1",
      kind: "missing_value",
      file,
      location: `${file}#D${from + 2}`,
      description: `Wash count is empty for Harbour Rd from 11 to 15 August 2025 (${hit.length} rows; the tunnel counter was offline)`,
    });
  } else {
    // A duplicated Fleet entry reversed as a negative row on the same day.
    const at = rows.findIndex((r) => r.day === "2025-11-19" && r.site === "Millbrook" && r.programme === "Fleet");
    const src = rows[at] as Takings;
    rows.splice(at + 1, 0, { day: src.day, site: src.site, programme: src.programme, washes: -3, net: -3 * 1200, refunds: 0 });
    quality.push({
      id: "Q1",
      kind: "negative_quantity",
      file,
      location: `${file}#Takings!D${at + 3}`,
      description: "a Fleet reversal keyed as a negative wash count (−3) at Millbrook on 19 November 2025",
    });
  }

  const header = ["Trading day", "Site", "Programme", "Wash count", "Net sales", "Refunds"];
  const files: Record<string, Uint8Array> = {};
  if (variant === 0)
    files[file] = csv([header, ...rows.map((r) => [r.day, r.site, r.programme, r.washes ?? "", money(r.net), money(r.refunds)])]);
  else
    files[file] = workbook(a.business, today, [
      ["Takings", [header, ...rows.map((r) => [excelDate(r.day), r.site, r.programme, r.washes ?? null, money(r.net), money(r.refunds)])]],
      [
        "Prices",
        [
          ["Programme", "Price", "From"],
          ["Express", 15, excelDate("2023-07-01")],
          ["Deluxe", 25, excelDate("2023-07-01")],
          ["Ultimate", 35, excelDate("2023-07-01")],
          ["Ultimate", 42, excelDate(priceRise)],
          ["Fleet", 12, excelDate("2024-01-01")],
        ],
      ],
    ]);

  const planted: Planted[] = [];
  if (variant === 0) {
    files["council-notice.pdf"] = textPdf([
      [
        "Ring Road resurfacing: traffic notice",
        `The eastbound carriageway between Station Street and Ringway Plaza will be closed from ${longDate(roadworks)} to 31 July 2026.`,
        "Access to Ringway Plaza is via Mill Lane only. Expect delays.",
      ],
    ]);
    files["maintenance-log.docx"] = docx([
      {
        heading: "Maintenance log",
        paragraphs: [
          "Water reclaim filters were changed at every site in the first week of each quarter.",
          `${longDate(gantry)}: the Millbrook brush gantry was replaced with a refurbished unit from WashTech Refurb.`,
          "Ringway's dryer fan was serviced in the same month.",
        ],
      },
    ]);
    planted.push(
      {
        id: "P1",
        type: "regression",
        metric: "refund_rate",
        period: "2025-10",
        driver: { dimension: "site", member: "Millbrook" },
        persists: true,
        cause: { doc: "maintenance-log.docx", grade_at_least: "correlated" },
        good_actions: ["remove_excess_rate"],
        description: "re-wash refunds at Millbrook rose after its brush gantry was replaced with a refurbished unit",
      },
      {
        id: "P2",
        type: "regression",
        metric: "revenue",
        period: "2026-03",
        driver: { dimension: "site", member: "Ringway" },
        persists: true,
        cause: { doc: "council-notice.pdf", grade_at_least: "correlated" },
        good_actions: ["recover_share"],
        description: "Ring Road roadworks cut Ringway's washes by almost half",
      },
    );
  } else {
    files["price-board.md"] = text(
      `# Price board\n\nFrom ${longDate(priceRise)} the Ultimate wash is $42 (was $35). Express, Deluxe and Fleet prices are unchanged.\n`,
    );
    files["local-news.txt"] = text(
      `Harbour Road gets a second car wash\n\nSpeedyShine opened an express car wash on Harbour Road on ${longDate(competitor)}, two blocks from the marina, with an opening offer of $10 washes.\n`,
    );
    planted.push(
      {
        id: "P1",
        type: "regression",
        metric: "revenue",
        period: "2025-10",
        member: { dimension: "programme", member: "Ultimate" },
        persists: true,
        cause: { doc: "price-board.md", grade_at_least: "correlated" },
        good_actions: [],
        description: "after the Ultimate price rise most Ultimate buyers took Deluxe or Express instead (total revenue nearly flat)",
      },
      {
        id: "P2",
        type: "regression",
        metric: "revenue",
        period: "2026-03",
        driver: { dimension: "site", member: "Harbour Rd" },
        persists: true,
        cause: { doc: "local-news.txt", grade_at_least: "correlated" },
        good_actions: ["recover_share"],
        description: "a competitor opened near Harbour Rd and took about a third of its washes",
      },
    );
  }
  files["site-notes.txt"] = text(
    `Site notes\n\nNew signage went up at ${blipSite} on ${longDate(`${ms[N]}-12`)}.\nThe vending machine contract was renewed.\n`,
  );
  files["uniform-policy.md"] = text("# Uniform policy\n\nStaff wear the blue Clearwater shirt and closed shoes on every shift.\n");
  const distractors: Distractor[] = [
    {
      id: "D1",
      description: `a 3% blip for ${blipSite}, inside the noise band`,
      metric: "revenue",
      period: ms[N] as string,
      member: { dimension: "site", member: blipSite },
      must_not_appear_as_finding: true,
    },
    ...ms
      .filter((m) => m.endsWith("-01"))
      .map(
        (jan, k): Distractor => ({
          id: `D${2 + k}`,
          description: `the ${jan} peak is the summer holidays (every January is about 20% higher)`,
          metric: "revenue",
          also: ["orders"],
          period: jan,
          must_not_appear_as_finding: true,
        }),
      ),
  ];
  return {
    id,
    files,
    answers: answersOf({
      dataset: id,
      archetype: a.id,
      business: a.business,
      seed,
      variant: variant + 1,
      months: ms,
      currency: a.currency,
      today,
      files,
      planted,
      distractors,
      quality,
    }),
  };
}

/** The held-out archetypes' ids: no development dataset uses them. */
export const HELDOUT_ARCHETYPES = [TOOL_HIRE.id, CAR_WASH.id] as const;

/**
 * The ten development archetypes again, one variant each (v1, v2, v3 in turn) with a new seed. Same templates and
 * planted months as the 30, different noise, account shares and order splits.
 */
function reseeded(): Dataset[] {
  return ARCHETYPES.map((a, i) => {
    const variant = (i % 3) as 0 | 1 | 2;
    const d = generateDataset(a, variant, 20270000 + (i + 1) * 100 + variant);
    const id = `${d.id}-heldout`;
    return { id, files: d.files, answers: { ...d.answers, dataset: id, split: "heldout" } };
  });
}

/** The held-out generated set: 10 reseeded development datasets and the two new archetypes in two variants each. */
export function heldoutDatasets(): Dataset[] {
  return [...reseeded(), toolHire(0), toolHire(1), carWash(0), carWash(1)];
}
