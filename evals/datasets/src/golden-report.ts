// Builds the golden report fixture (packages/schema/test/fixtures/report.coffee-roaster.json) from the
// coffee-roaster ground truth. Every number is computed here, never typed: the values come from MONTHS
// and the formulas below, which mirror docs/specs/analysis-library.md (contribution.v1 §4.1, impact.v1 §5).
// The real engine produces these through SQL in M4/M5; this builder exists so the fixture is provably exact.
import { createHash } from "node:crypto";
import type { Citation, Claim, Evidence, Fact, Report, ReportMetric, Source } from "@agentic-analytics/schema";
import { COSTS, DatasetError, generateOrders, MONTHS, type MonthTruth } from "./coffee-roaster.ts";
import { EMAIL_BODY, OPS_NOTES, opsNotesText, pageText } from "./documents.ts";

const CURRENCY = "USD";
const WEB_URL = "https://industry-benchmark.example/2026/specialty-roaster-wholesale-prices";
const WEB_QUOTE = "Specialty roasters raised wholesale prices 5–8% on average in 2026.";
const PRICE_QUOTE = "Wholesale prices increase 12% from 15 March 2026.";
const EMAIL_QUOTE = "After the new price list we are pausing our standing order while we compare suppliers.";
const OPS_QUOTE = "Switched to the new packaging supplier on 28 April.";

/** Scenario parameters for R1/R2, picked from the allowed set in analysis-library §5. */
const RECOVER_LOW = 0.5;
const RECOVER_HIGH = 0.9;
const VOLUME_TIER_DISCOUNT = 0.06;
const EXCESS_REMOVED_LOW = 0.5;

const month = (m: string): MonthTruth => {
  const found = MONTHS.find((x) => x.month === m);
  if (!found) throw new DatasetError("UNKNOWN_MONTH", `no month ${m}`);
  return found;
};
/** Sheet row of a month in Monthly!A1:F7 (header on row 1, January on row 2). */
const row = (m: string) => MONTHS.findIndex((x) => x.month === m) + 2;
const cents = (n: number) => Math.round(n * 100) / 100;
const sha = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");

export interface GoldenInputs {
  /** sha256 of each file in coffee-roaster-v1/files, keyed by file name. */
  readonly fileHashes: Readonly<Record<string, string>>;
}

export function buildGoldenReport({ fileHashes }: GoldenInputs): Report {
  const hash = (f: string) => {
    const h = fileHashes[f];
    if (!h) throw new DatasetError("MISSING_HASH", `missing hash for ${f}`);
    return h;
  };
  const span = (text: string, quote: string) => {
    const start = text.indexOf(quote);
    if (start < 0) throw new DatasetError("QUOTE_NOT_FOUND", `quote not in source: ${quote}`);
    return { char_start: start, char_end: start + quote.length };
  };
  const opsSection3 = [OPS_NOTES[2]?.heading ?? "", ...(OPS_NOTES[2]?.paragraphs ?? [])].join("\n");

  const sources: Source[] = [
    {
      id: "S1",
      file: "sales-2026.xlsx",
      sha256: hash("sales-2026.xlsx"),
      kind: "table",
      external: false,
      locator: { sheet: "Monthly", range: "A1:F7", table_id: "t_monthly" },
    },
    {
      id: "S2",
      file: "price-list.pdf",
      sha256: hash("price-list.pdf"),
      kind: "document",
      external: false,
      locator: { page: 2, ...span(pageText(2), PRICE_QUOTE) },
    },
    {
      id: "S3",
      file: "email-0412.eml",
      sha256: hash("email-0412.eml"),
      kind: "email",
      external: false,
      locator: { section: "body", ...span(EMAIL_BODY, EMAIL_QUOTE) },
    },
    {
      id: "S4",
      file: "ops-notes.docx",
      sha256: hash("ops-notes.docx"),
      kind: "document",
      external: false,
      locator: { section: "3. Packaging", ...span(opsNotesText(), OPS_QUOTE) },
    },
    {
      id: "S5",
      file: WEB_URL,
      sha256: sha(WEB_QUOTE),
      kind: "web",
      external: true,
      locator: {
        url: WEB_URL,
        title: "Wholesale price moves among specialty roasters, 2026 (illustrative)",
        fetched_at: "2026-07-01T08:55:00+05:00",
      },
    },
    {
      id: "S6",
      file: "sales-2026.xlsx",
      sha256: hash("sales-2026.xlsx"),
      kind: "table",
      external: false,
      locator: { sheet: "Monthly", range: "H1:L7", table_id: "t_costs" },
    },
    {
      id: "S7",
      file: "sales-2026.xlsx",
      sha256: hash("sales-2026.xlsx"),
      kind: "table",
      external: false,
      locator: { sheet: "Orders", range: "A1:H6261", table_id: "t_orders" },
    },
  ];

  const cite = (cols: string, ...months: string[]): Citation => ({
    source_id: "S1",
    rows: months.map(row),
    cells: months.flatMap((m) => [...cols].map((c) => `${c}${row(m)}`)),
  });

  const metrics: ReportMetric[] = [
    metricDef(
      "revenue",
      "Revenue",
      "revenue",
      "currency",
      "confirmed",
      "Revenue = the monthly Revenue column of the owner's summary, per month, in USD",
    ),
    metricDef(
      "wholesale_revenue",
      "Wholesale revenue",
      "wholesale",
      "currency",
      "confirmed",
      "Wholesale revenue = the monthly Wholesale column, per month, in USD",
    ),
    metricDef(
      "retail_revenue",
      "Retail revenue",
      "retail",
      "currency",
      "confirmed",
      "Retail revenue = the monthly Retail column, per month, in USD",
    ),
    {
      id: "refund_rate",
      label: "Refund rate",
      type: "avg",
      table: "t_monthly",
      expression: "refund_rate * 100",
      time_column: "month",
      unit: "percent",
      status: "assumed",
      plain: "Refund rate = the monthly Refund rate column, in percent (assumed, not confirmed)",
      sql: "SELECT avg(refund_rate * 100) AS value FROM t_monthly WHERE month = $month",
    },
    {
      id: "refund_cost",
      label: "Refund cost",
      type: "derived",
      expression: "refund_rate / 100 * revenue",
      unit: "currency",
      currency: CURRENCY,
      status: "assumed",
      plain: "Refund cost = refund rate × revenue for the month, in USD (derived from two assumed/confirmed metrics)",
      sql: "SELECT sum(refund_rate * revenue) AS value FROM t_monthly WHERE month = $month",
    },
  ];

  const facts: Fact[] = [];
  const add = (f: Omit<Fact, "id" | "verified">): string => {
    const id = `N${facts.length + 1}`;
    facts.push({ id, ...f, verified: true });
    return id;
  };
  const measure = (metricId: string, col: string, m: string, value: number, unit: Fact["unit"]): string =>
    add({
      label: `${metricId}_${m}`,
      value,
      unit,
      ...(unit === "currency" ? { currency: CURRENCY } : {}),
      metric_id: metricId,
      computation: { kind: "sql", sql: metrics.find((x) => x.id === metricId)?.sql ?? "", params: { month: m } },
      citations: [cite(col, m)],
    });
  const fn = (label: string, fnId: string, value: number, unit: Fact["unit"], inputs: string[], extra: Partial<Fact> = {}): string =>
    add({
      label,
      value,
      unit,
      ...(unit === "currency" ? { currency: CURRENCY } : {}),
      computation: { kind: "function", fn: fnId, inputs },
      citations: [],
      ...extra,
    });
  const v = (id: string) => facts.find((f) => f.id === id)?.value ?? Number.NaN;

  // F1: April vs March (baseline = previous period, analysis-library §2)
  const revMar = measure("revenue", "B", "2026-03", month("2026-03").revenueCents / 100, "currency");
  const revApr = measure("revenue", "B", "2026-04", month("2026-04").revenueCents / 100, "currency");
  const revDelta = fn("revenue_change_2026-04_vs_2026-03", "delta", v(revApr) - v(revMar), "currency", [revApr, revMar], {
    metric_id: "revenue",
  });
  const revPct = fn("revenue_change_pct_2026-04_vs_2026-03", "pct_change", (v(revApr) / v(revMar) - 1) * 100, "percent", [revApr, revMar], {
    metric_id: "revenue",
  });
  const whMar = measure("wholesale_revenue", "D", "2026-03", month("2026-03").wholesaleCents / 100, "currency");
  const whApr = measure("wholesale_revenue", "D", "2026-04", month("2026-04").wholesaleCents / 100, "currency");
  const whDelta = fn("wholesale_revenue_change_2026-04_vs_2026-03", "delta", v(whApr) - v(whMar), "currency", [whApr, whMar], {
    metric_id: "wholesale_revenue",
  });
  const whPct = fn(
    "wholesale_revenue_change_pct_2026-04_vs_2026-03",
    "pct_change",
    (v(whApr) / v(whMar) - 1) * 100,
    "percent",
    [whApr, whMar],
    { metric_id: "wholesale_revenue" },
  );
  const rtMar = measure("retail_revenue", "E", "2026-03", month("2026-03").retailCents / 100, "currency");
  const rtApr = measure("retail_revenue", "E", "2026-04", month("2026-04").retailCents / 100, "currency");
  const rtDelta = fn("retail_revenue_change_2026-04_vs_2026-03", "delta", v(rtApr) - v(rtMar), "currency", [rtApr, rtMar], {
    metric_id: "retail_revenue",
  });
  const whShare = fn("wholesale_share_of_revenue_change_2026-04", "contribution.v1", (v(whDelta) / v(revDelta)) * 100, "percent", [
    whDelta,
    revDelta,
  ]);
  const rtShare = fn("retail_share_of_revenue_change_2026-04", "contribution.v1", (v(rtDelta) / v(revDelta)) * 100, "percent", [
    rtDelta,
    revDelta,
  ]);

  // Magnitudes for prose: "fell 17.9%" reads right, "fell −17.9%" would say it rose.
  const revDrop = fn("revenue_decline_pct_2026-04_vs_2026-03", "abs", Math.abs(v(revPct)), "percent", [revPct], { metric_id: "revenue" });
  const whDrop = fn("wholesale_revenue_decline_2026-04_vs_2026-03", "abs", Math.abs(v(whDelta)), "currency", [whDelta], {
    metric_id: "wholesale_revenue",
  });
  const whDropPct = fn("wholesale_revenue_decline_pct_2026-04_vs_2026-03", "abs", Math.abs(v(whPct)), "percent", [whPct], {
    metric_id: "wholesale_revenue",
  });

  // F2: refund rate
  const refMar = measure("refund_rate", "F", "2026-03", month("2026-03").refundPermille / 10, "percent");
  const refMay = measure("refund_rate", "F", "2026-05", month("2026-05").refundPermille / 10, "percent");
  const refJun = measure("refund_rate", "F", "2026-06", month("2026-06").refundPermille / 10, "percent");
  const revJun = measure("revenue", "B", "2026-06", month("2026-06").revenueCents / 100, "currency");
  const excess = fn(
    "excess_refund_cost_per_month_2026-06",
    "impact.v1:remove_excess_rate",
    cents(((v(refJun) - v(refMar)) / 100) * v(revJun)),
    "currency",
    [refJun, refMar, revJun],
    { metric_id: "refund_cost" },
  );

  // F3: retail trend
  const rtJan = measure("retail_revenue", "E", "2026-01", month("2026-01").retailCents / 100, "currency");
  const rtJun = measure("retail_revenue", "E", "2026-06", month("2026-06").retailCents / 100, "currency");
  const rtGrowth = fn(
    "retail_revenue_change_pct_2026-06_vs_2026-01",
    "pct_change",
    (v(rtJun) / v(rtJan) - 1) * 100,
    "percent",
    [rtJun, rtJan],
    { metric_id: "retail_revenue" },
  );

  // R1: impact.v1 recover share of a lost amount, net of the discount the action implies
  const pLow = fn("scenario_recover_share_low", "scenario_param", RECOVER_LOW * 100, "percent", []);
  const pHigh = fn("scenario_recover_share_high", "scenario_param", RECOVER_HIGH * 100, "percent", []);
  const pDisc = fn("scenario_volume_tier_discount", "scenario_param", VOLUME_TIER_DISCOUNT * 100, "percent", []);
  const lost = -v(whDelta);
  const r1Low = fn(
    "r1_impact_low_per_month",
    "impact.v1:recover_share",
    cents(lost * RECOVER_LOW * (1 - VOLUME_TIER_DISCOUNT)),
    "currency",
    [whDelta, pLow, pDisc],
    { metric_id: "wholesale_revenue" },
  );
  const r1High = fn(
    "r1_impact_high_per_month",
    "impact.v1:recover_share",
    cents(lost * RECOVER_HIGH * (1 - VOLUME_TIER_DISCOUNT)),
    "currency",
    [whDelta, pHigh, pDisc],
    { metric_id: "wholesale_revenue" },
  );
  const r1Check = fn("r1_check_wholesale_2026-07", "check_threshold", cents(v(whApr) + v(r1Low)), "currency", [whApr, r1Low], {
    metric_id: "wholesale_revenue",
  });

  // R2: impact.v1 remove an excess rate back to the baseline (half to all of it)
  const pExcessLow = fn("scenario_excess_removed_low", "scenario_param", EXCESS_REMOVED_LOW * 100, "percent", []);
  const r2Low = fn(
    "r2_impact_low_per_month",
    "impact.v1:remove_excess_rate",
    cents(v(excess) * EXCESS_REMOVED_LOW),
    "currency",
    [excess, pExcessLow],
    { metric_id: "refund_cost" },
  );

  // DQ1: the planted ×1000 packaging typo, measured against the other months (ingestion spec §5)
  const others = COSTS.map((c, i) => ({ month: c.month, row: i + 2 })).filter((c) => c.month !== "2026-02");
  const packFeb = add({
    label: "packaging_cost_2026-02",
    value: COSTS.find((c) => c.month === "2026-02")?.packaging ?? Number.NaN,
    unit: "currency",
    currency: CURRENCY,
    computation: { kind: "sql", sql: "SELECT packaging AS value FROM t_costs WHERE month = $month", params: { month: "2026-02" } },
    citations: [{ source_id: "S6", rows: [3], cells: ["J3"] }],
  });
  const packMedian = add({
    label: "packaging_cost_median_excluding_2026-02",
    value: median(COSTS.filter((c) => c.month !== "2026-02").map((c) => c.packaging)),
    unit: "currency",
    currency: CURRENCY,
    computation: { kind: "sql", sql: "SELECT median(packaging) AS value FROM t_costs WHERE month <> $month", params: { month: "2026-02" } },
    citations: [{ source_id: "S6", rows: others.map((c) => c.row), cells: others.map((c) => `J${c.row}`) }],
  });
  const packRatio = fn("packaging_cost_ratio_2026-02_to_median", "ratio", v(packFeb) / v(packMedian), "ratio", [packFeb, packMedian]);

  const claim = (text: string, factIds: string[], citations: Citation[], causal_grade?: Claim["causal_grade"]): Claim => ({
    text,
    facts: factIds,
    citations,
    ...(causal_grade ? { causal_grade } : {}),
    verified: true,
  });
  const q = (source_id: string, quote: string): Citation => ({ source_id, quote });

  const evidence: Evidence[] = [
    {
      source_id: "S1",
      kind: "table",
      columns: ["Month", "Revenue", "Orders", "Wholesale", "Retail", "Refund rate"].map((name, i) => ({
        letter: "ABCDEF"[i] ?? "A",
        name,
      })),
      rows: MONTHS.map((m, i) => ({
        row: i + 2,
        cells: [m.month, m.revenueCents / 100, m.orders, m.wholesaleCents / 100, m.retailCents / 100, m.refundPermille / 1000],
      })),
    },
    { source_id: "S2", kind: "text", page: 2, char_start: 0, text: pageText(2) },
    { source_id: "S3", kind: "text", section: "body", char_start: 0, text: EMAIL_BODY },
    { source_id: "S4", kind: "text", section: "3. Packaging", char_start: opsNotesText().indexOf(opsSection3), text: opsSection3 },
    { source_id: "S5", kind: "text", char_start: 0, text: WEB_QUOTE },
    {
      source_id: "S6",
      kind: "table",
      columns: ["Month", "Beans", "Packaging", "Rent", "Staff"].map((name, i) => ({ letter: "HIJKL"[i] ?? "H", name })),
      rows: COSTS.map((c, i) => ({ row: i + 2, cells: [c.month, c.beans, c.packaging, c.rent, c.staff] })),
    },
    {
      source_id: "S7",
      kind: "table",
      columns: ["Date", "Order ID", "Customer", "Channel", "Product", "Qty", "Amount", "Status"].map((name, i) => ({
        letter: "ABCDEFGH"[i] ?? "A",
        name,
      })),
      rows: generateOrders()
        .slice(0, 5)
        .map((o, i) => ({
          row: i + 2,
          cells: [o.date, o.orderId, o.customer, o.channel, o.product, o.qty, o.amountCents / 100, o.status],
        })),
    },
  ];

  const report: Report = {
    schema: "agentic-analytics.report/v1",
    job_id: "fixture-coffee-roaster-v1",
    generated_at: "2026-07-01T09:00:00+05:00",
    engine: {
      version: "0.1.0-fixture",
      models: [
        { role: "planner", provider: "ollama", model: "qwen3.5:9b" },
        { role: "extractor", provider: "ollama", model: "qwen3.5:9b" },
        { role: "judge", provider: "ollama", model: "qwen3.5:9b" },
        { role: "embedder", provider: "transformers", model: "Xenova/bge-m3" },
      ],
    },
    period: { from: "2026-01", to: "2026-06", grain: "month" },
    objective: { text: "Grow monthly gross profit without losing wholesale clients", source: "user" },
    sources,
    metrics,
    assumptions: [
      {
        id: "A1",
        text: "The refund rate is read from the owner's monthly Refund rate column; this definition was not confirmed.",
        affects: ["refund_rate", "refund_cost", "F2", "R2"],
      },
      {
        id: "A2",
        text: "“OOO Hotel Group” and “Hotel Group LLC” are the same client (entity match, not confirmed).",
        affects: ["F1", "R1"],
      },
    ],
    data_quality: [
      {
        id: "DQ1",
        kind: "unit_error",
        severity: "high",
        description: `February packaging cost ({{${packFeb}}}) is {{${packRatio}}} times the median of the other months ({{${packMedian}}}), which looks like a data-entry error. It is excluded from cost analysis until corrected.`,
        citations: [{ source_id: "S6", rows: [3], cells: ["J3"] }],
      },
      {
        id: "DQ2",
        kind: "date_format_ambiguity",
        severity: "low",
        description:
          "Order dates are day/month/year text. Dates whose day could also be a month are ambiguous; they were read day-first because other rows in the column only fit day-first.",
        citations: [{ source_id: "S7", cells: ["A2"] }],
      },
    ],
    summary: {
      headline: `Revenue fell {{${revDrop}}} in April because wholesale collapsed after the price rise, and refunds have nearly tripled since.`,
      bullets: [
        claim(
          `Revenue fell {{${revDrop}}} in April, from {{${revMar}}} to {{${revApr}}}, and wholesale accounts for {{${whShare}}} of the drop.`,
          [revDrop, revMar, revApr, whShare],
          [cite("BD", "2026-03", "2026-04")],
          "observed",
        ),
        claim(
          `The refund rate rose from {{${refMar}}} in March to {{${refJun}}} in June, costing about {{${excess}}} a month above the March level.`,
          [refMar, refJun, excess],
          [cite("BF", "2026-03", "2026-06")],
          "observed",
        ),
        claim(`Retail revenue grew {{${rtGrowth}}} from January to June.`, [rtGrowth], [cite("E", "2026-01", "2026-06")], "observed"),
      ],
    },
    findings: [
      {
        id: "F1",
        type: "regression",
        severity: "high",
        title: "Wholesale drove the April revenue drop",
        claims: [
          claim(
            `Revenue fell {{${revDrop}}} in April, from {{${revMar}}} to {{${revApr}}} ({{${revDelta}}}).`,
            [revDrop, revMar, revApr, revDelta],
            [cite("B", "2026-03", "2026-04")],
            "observed",
          ),
          claim(
            `Wholesale fell {{${whDrop}}} ({{${whDropPct}}}) while retail rose {{${rtDelta}}}, so wholesale accounts for {{${whShare}}} of the drop.`,
            [whDrop, whDropPct, rtDelta, whShare],
            [cite("DE", "2026-03", "2026-04")],
            "observed",
          ),
          claim(
            "The hotel group paused its standing order after the new wholesale price list.",
            [],
            [q("S3", EMAIL_QUOTE), q("S2", PRICE_QUOTE)],
            "document_supported",
          ),
          claim(
            "The wholesale price rise was larger than the average move among specialty roasters in 2026.",
            [],
            [q("S2", PRICE_QUOTE), q("S5", WEB_QUOTE)],
            "correlated",
          ),
        ],
        drivers: [
          { label: "Wholesale", fact: whDelta, share_of_change: whShare },
          { label: "Retail", fact: rtDelta, share_of_change: rtShare },
        ],
        method: "contribution.v1",
        confidence: "high",
        confidence_reasons: [
          "The decomposition is exact: wholesale and retail add up to the total change.",
          "The buyer's email links the paused order to the new price list.",
          "Rejected alternative: seasonality. Retail rose in the same month.",
        ],
        assumptions: ["A2"],
      },
      {
        id: "F2",
        type: "regression",
        severity: "medium",
        title: "The refund rate nearly tripled from May",
        claims: [
          claim(
            `The refund rate went from {{${refMar}}} in March to {{${refMay}}} in May and {{${refJun}}} in June.`,
            [refMar, refMay, refJun],
            [cite("F", "2026-03", "2026-05", "2026-06")],
            "observed",
          ),
          claim(
            "The rise starts in the first full month after the switch to a new packaging supplier.",
            [],
            [q("S4", OPS_QUOTE)],
            "correlated",
          ),
          claim(
            `At June revenue of {{${revJun}}}, the excess over the March rate costs about {{${excess}}} a month.`,
            [revJun, excess],
            [cite("BF", "2026-03", "2026-06")],
            "observed",
          ),
        ],
        method: "ratio_shift.v1",
        confidence: "medium",
        confidence_reasons: [
          "The timing matches the supplier switch, but no document links refunds to packaging.",
          "Refund counts aren't in the summary table, so no significance test was possible.",
        ],
        assumptions: ["A1"],
      },
      {
        id: "F3",
        type: "improvement",
        severity: "low",
        title: "Retail kept growing",
        claims: [
          claim(
            `Retail revenue rose from {{${rtJan}}} in January to {{${rtJun}}} in June ({{${rtGrowth}}}).`,
            [rtJan, rtJun, rtGrowth],
            [cite("E", "2026-01", "2026-06")],
            "observed",
          ),
        ],
        method: "trend.v1",
        confidence: "medium",
        confidence_reasons: ["Retail rose in every month but May."],
        assumptions: [],
      },
    ],
    recommendations: [
      {
        id: "R1",
        action: `Offer the hotel group a {{${pDisc}}} volume tier to bring back the standing order`,
        because: ["F1"],
        rationale: [
          claim(
            `Wholesale accounts for {{${whShare}}} of the April drop, and the buyer paused right after the price rise.`,
            [whShare],
            [q("S3", EMAIL_QUOTE)],
            "document_supported",
          ),
          claim(
            "The rise was above what the market moved, so a tier near the market rate is the cheapest fix.",
            [],
            [q("S2", PRICE_QUOTE), q("S5", WEB_QUOTE)],
            "correlated",
          ),
        ],
        impact: {
          metric_id: "wholesale_revenue",
          low: r1Low,
          high: r1High,
          horizon: "per month, once the order resumes",
          method: "impact.v1:recover_share",
          inputs: [whDelta, pLow, pHigh, pDisc],
        },
        confidence: "medium",
        effort: "low",
        risk: "Other wholesale clients may ask for the same tier.",
        check: { metric_id: "wholesale_revenue", comparator: ">=", threshold: r1Check, by: "2026-07-31" },
        not_advised: "Across-the-board price cuts: retail is growing and doesn't need them.",
      },
      {
        id: "R2",
        action: "Ask the new packaging supplier about bag failures and inspect returned bags",
        because: ["F2"],
        rationale: [
          claim(
            `Refunds rose in the first full month after the packaging switch, costing about {{${excess}}} a month.`,
            [excess],
            [q("S4", OPS_QUOTE)],
            "correlated",
          ),
        ],
        impact: {
          metric_id: "refund_cost",
          low: r2Low,
          high: excess,
          horizon: "per month",
          method: "impact.v1:remove_excess_rate",
          inputs: [excess, pExcessLow],
        },
        confidence: "low",
        effort: "low",
        risk: "If packaging isn't the cause, the excess refunds continue.",
        check: { metric_id: "refund_rate", comparator: "<=", threshold: refMar, by: "2026-08-31" },
      },
    ],
    open_questions: [
      {
        id: "OQ1",
        question: "Did any other wholesale clients cut volume after the price rise?",
        why_it_matters: "If they did, the price rise itself is the problem, not one client.",
        would_change: ["F1", "R1"],
      },
      {
        id: "OQ2",
        question: "Do the refund requests mention damaged or leaking bags?",
        why_it_matters: "That would turn the packaging link from timing into evidence.",
        would_change: ["F2", "R2"],
      },
    ],
    facts,
    verification: {
      numbers_checked: facts.length,
      numbers_mismatched: 0,
      rederived_metrics: metrics.length,
      rederivation_mismatches: 0,
      definition_violations: 0,
      citations_checked: 0,
      citations_unsupported: 0,
      claims_dropped: [
        { claim: "Sales are seasonal and will recover by summer.", reason: "No supporting fact or source (V5: ungrounded causal claim)." },
      ],
      claims_downgraded: [
        {
          claim: "The rise starts in the first full month after the switch to a new packaging supplier.",
          from: "document_supported",
          to: "correlated",
          reason: "The ops note dates the switch but doesn't link it to refunds.",
        },
      ],
    },
    evidence,
  };
  report.verification.citations_checked = countCitations(report);
  return report;
}

function metricDef(
  id: string,
  label: string,
  column: string,
  unit: "currency",
  status: "confirmed" | "assumed",
  plain: string,
): ReportMetric {
  return {
    id,
    label,
    type: "sum",
    table: "t_monthly",
    expression: column,
    time_column: "month",
    unit,
    currency: CURRENCY,
    dimensions: [],
    status,
    plain,
    sql: `SELECT sum(${column}) AS value FROM t_monthly WHERE month = $month`,
  };
}

function countCitations(r: Report): number {
  const claims = [...r.summary.bullets, ...r.findings.flatMap((f) => f.claims), ...r.recommendations.flatMap((x) => x.rationale)];
  return claims.reduce((n, c) => n + c.citations.length, 0) + r.facts.reduce((n, f) => n + f.citations.length, 0);
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? Number.NaN) : ((s[mid - 1] ?? Number.NaN) + (s[mid] ?? Number.NaN)) / 2;
}
