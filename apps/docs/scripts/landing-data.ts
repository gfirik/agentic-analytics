// The landing page's report data (src/pages/index.astro: the hero exhibit, Exhibit.astro, and its fact ledger), from the
// same web-enabled run the pipeline scene plays (pipeline-data.ts recordRun(), docs/assets/readme/pipeline.json), so the whole page shows ONE run:
// the first finding, every fact its claims and its top recommendation use, the facts those are computed from (so each
// chip opens a fact whose inputs open too), and the verification counts. Values are the facts' stored values.
import type { Report } from "@agentic-analytics/schema";
import { ident, idents, sql, type Workspace } from "@agentic-analytics/store";
import { type FactLike, formatWithCurrency } from "../src/components/format.ts";
import type { PipelineData } from "../src/components/pipeline-scene.ts";
import { monthName, sqlLines } from "../src/components/site/exhibit.ts";

export class LandingDataError extends Error {
  readonly code = "LANDING_DATA";
  constructor(message: string) {
    super(`landing data: ${message}`);
    this.name = "LandingDataError";
  }
}

export function landingData(report: Report) {
  const byId = new Map(report.facts.map((f) => [f.id, f]));
  const file = (id: string) => report.sources.find((s) => s.id === id)?.file ?? id;
  const finding = report.findings[0];
  const rec = report.recommendations[0];
  if (!finding || !rec) throw new LandingDataError("the report has no finding or recommendation");
  const direct = [
    ...finding.claims.flatMap((c) => c.facts),
    ...[rec.impact?.low, rec.impact?.high].filter((x): x is string => typeof x === "string"),
  ].filter((id, i, a) => a.indexOf(id) === i);
  const closure = new Set<string>();
  const visit = (id: string) => {
    if (closure.has(id)) return;
    const f = byId.get(id);
    if (!f) throw new LandingDataError(`unknown fact ${id} in the landing finding`);
    closure.add(id);
    if (f.computation.kind === "function") for (const input of f.computation.inputs ?? []) visit(input);
  };
  for (const id of direct) visit(id);
  const facts = Object.fromEntries(
    [...closure].map((id) => {
      const f = byId.get(id) as (typeof report.facts)[number];
      return [
        id,
        {
          id,
          label: f.label,
          value: f.value,
          unit: f.unit,
          currency: f.currency ?? null,
          verified: f.verified ?? false,
          computation: f.computation,
          citations: f.citations.map((c) => ({
            source_id: c.source_id,
            file: file(c.source_id),
            rows: (c.rows ?? []).slice(0, 12),
            count: c.rows?.length ?? 0,
          })),
        },
      ];
    }),
  );
  const v = report.verification;
  return {
    run: { example: "examples/coffee-roaster", model: "scripted planner, no LLM", web: "offline web fixture", today: "2026-07-01" },
    finding: {
      id: finding.id,
      type: finding.type,
      severity: finding.severity,
      title: finding.title,
      method: finding.method ?? null,
      confidence: finding.confidence,
      claims: finding.claims.map((c) => ({
        text: c.text,
        facts: c.facts,
        grade: c.causal_grade,
        verified: c.verified ?? false,
        citations: c.citations.map((x) => ({ source_id: x.source_id, file: file(x.source_id), quote: x.quote ?? null })),
      })),
    },
    recommendation: {
      id: rec.id,
      action: rec.action,
      low: rec.impact?.low ?? null,
      high: rec.impact?.high ?? null,
      horizon: rec.impact?.horizon ?? null,
      confidence: rec.confidence,
      not_advised: rec.not_advised ?? null,
    },
    direct,
    facts,
    verification: {
      numbers_checked: v.numbers_checked,
      numbers_mismatched: v.numbers_mismatched,
      rederived_metrics: v.rederived_metrics,
      rederivation_mismatches: v.rederivation_mismatches,
      citations_checked: v.citations_checked,
      citations_unsupported: v.citations_unsupported,
      claims_dropped: v.claims_dropped.length,
      claims_downgraded: v.claims_downgraded.length,
    },
  };
}

export type LandingData = ReturnType<typeof landingData>;

/**
 * Where the landing page and the hero (pipeline.json) must agree, as one run: the verification counts and the top
 * recommendation's impact fact ids. Returns the disagreements (empty when they agree).
 */
export function disagreements(landing: LandingData, hero: PipelineData): string[] {
  const out: string[] = [];
  const v = landing.verification;
  if (v.numbers_checked !== hero.verification.numbers_checked)
    out.push(`numbers checked: report ${v.numbers_checked}, hero ${hero.verification.numbers_checked}`);
  if (v.numbers_mismatched !== hero.verification.numbers_mismatched)
    out.push(`numbers mismatched: report ${v.numbers_mismatched}, hero ${hero.verification.numbers_mismatched}`);
  if (v.citations_checked !== hero.verification.citations_checked)
    out.push(`citations checked: report ${v.citations_checked}, hero ${hero.verification.citations_checked}`);
  if (v.claims_dropped !== hero.verification.claims_dropped)
    out.push(`claims dropped: report ${v.claims_dropped}, hero ${hero.verification.claims_dropped}`);
  if (v.claims_downgraded !== hero.verification.claims_downgraded)
    out.push(`claims downgraded: report ${v.claims_downgraded}, hero ${hero.verification.claims_downgraded}`);
  if (landing.recommendation.low !== hero.action.low.id || landing.recommendation.high !== hero.action.high.id)
    out.push(
      `impact facts: report ${landing.recommendation.low}/${landing.recommendation.high}, hero ${hero.action.low.id}/${hero.action.high.id}`,
    );
  if (landing.recommendation.id !== hero.action.id) out.push(`recommendation: report ${landing.recommendation.id}, hero ${hero.action.id}`);
  if (!landing.direct.includes(hero.change.pct.id)) out.push(`the headline change ${hero.change.pct.id} is not in the report card`);
  return out;
}

// ── The hero exhibit (DESIGN.md §5) ──────────────────────────────────────────────────────────────────────────────
// The landing page's one live exhibit: the same run's headline claims, the document-supported cause and the top
// recommendation, each figure with its margin note (the fact's SQL or function, and the sheet rows it cites, read back
// from the run's own DuckDB). Text is the report's own; figures are the facts' stored values, formatted for reading.

/** A cited sheet row and the rows around it, with the columns the fact's SQL reads. */
export interface ExhibitRows {
  readonly file: string;
  readonly columns: readonly string[];
  readonly rows: readonly { readonly row: number; readonly cells: readonly string[]; readonly cited: boolean }[];
  /** How many rows the fact cites in all. */
  readonly count: number;
}

const tableOf = (q: string) => /\bFROM\s+"(t_[a-z0-9_]+)"/.exec(q)?.[1];
const columnsOf = (q: string, table: string) =>
  [...q.matchAll(/"([a-z_][a-z0-9_]*)"/g)].map((m) => m[1] as string).filter((c, i, a) => c !== table && a.indexOf(c) === i);

/**
 * For each SQL fact in `ids`: its first cited row with the row before and after it (those in the table), and the
 * columns its SQL reads. Identifiers come from the recorded SQL and go through ident(), never into SQL as text.
 */
export async function exhibitRows(ws: Workspace, report: Report, ids: readonly string[]): Promise<Record<string, ExhibitRows>> {
  const out: Record<string, ExhibitRows> = {};
  for (const id of ids) {
    const f = report.facts.find((x) => x.id === id);
    const c = f?.citations[0];
    const q = f?.computation.kind === "sql" ? f.computation.sql : undefined;
    const first = c?.rows?.[0];
    const table = q ? tableOf(q) : undefined;
    if (!f || !c || !q || !table || first === undefined) continue;
    const columns = columnsOf(q, table);
    const cited = new Set(c.rows ?? []);
    const found = await ws.all<Record<string, unknown>>(
      sql`SELECT _row, ${idents(columns.map((col) => col))} FROM ${ident(table)} WHERE _row BETWEEN ${first - 1} AND ${first + 1} ORDER BY _row`,
    );
    out[id] = {
      file: report.sources.find((s) => s.id === c.source_id)?.file ?? c.source_id,
      columns,
      rows: found.map((r) => ({
        row: Number(r._row),
        cells: columns.map((col) => cell(r[col])),
        cited: cited.has(Number(r._row)),
      })),
      count: c.rows?.length ?? 0,
    };
  }
  return out;
}

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const text = v instanceof Date ? v.toISOString() : String(v);
  // A date-only value read back as midnight UTC is shown as the date the sheet holds.
  return /^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/.test(text) ? text.slice(0, 10) : text;
};

/** A vitest include glob (`packages/*\/test/**\/*.test.ts`) as a RegExp over repo-relative paths. */
export function globToRegExp(glob: string): RegExp {
  const re = glob
    .split(/(\*\*\/|\*)/)
    .map((part) => (part === "**/" ? "(?:.*/)?" : part === "*" ? "[^/]*" : part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${re}$`);
}

export type ExhibitPart = { readonly text: string } | { readonly fact: string } | { readonly source: string };

export interface ExhibitNote {
  readonly id: string;
  readonly kind: "sql" | "function" | "source";
  readonly label: string;
  /** The value for reading (presentation only), or the source file for a document citation. */
  readonly value: string;
  readonly verified: boolean;
  readonly sql?: readonly string[];
  readonly params?: readonly (readonly [string, string])[];
  readonly fn?: string;
  readonly inputs?: readonly { readonly id: string; readonly label: string; readonly value: string }[];
  readonly rows?: ExhibitRows;
  readonly quote?: string;
  readonly section?: string;
}

/** Facts and sources the exhibit shows, in reading order: the verification sequence follows this order. */
export function exhibitIds(report: Report): { claims: Report["findings"][number]["claims"]; facts: string[]; sources: string[] } {
  const finding = report.findings[0];
  const rec = report.recommendations[0];
  if (!finding || !rec) throw new LandingDataError("the report has no finding or recommendation");
  const withFacts = finding.claims.filter((c) => c.facts.length > 0).slice(0, 2);
  const cause = finding.claims.find((c) => c.causal_grade === "document_supported" && c.citations.some((x) => x.quote));
  const claims = cause ? [...withFacts, cause] : withFacts;
  const facts = [
    ...claims.flatMap((c) => c.facts),
    ...[rec.impact?.low, rec.impact?.high].filter((x): x is string => typeof x === "string"),
  ];
  const sources = cause ? cause.citations.filter((x) => x.quote).map((x) => x.source_id) : [];
  return { claims, facts, sources };
}

const order = (ids: readonly string[]) => ids.filter((id, i) => ids.indexOf(id) === i);

export function exhibitData(report: Report, rows: Record<string, ExhibitRows>) {
  const byId = new Map(report.facts.map((f) => [f.id, f]));
  const rec = report.recommendations[0];
  if (!rec) throw new LandingDataError("the report has no recommendation");
  const { claims, facts: ids, sources } = exhibitIds(report);
  const fact = (id: string) => {
    const f = byId.get(id);
    if (!f) throw new LandingDataError(`unknown fact ${id} in the exhibit`);
    return f;
  };
  const shownValue = (id: string) => formatWithCurrency(fact(id) as FactLike & { currency?: string | null });
  const parts = (text: string): ExhibitPart[] =>
    text
      .split(/\{\{(N\d+)\}\}/)
      .map((p, i) => (i % 2 ? { fact: p } : { text: p }))
      .filter((p) => !("text" in p) || p.text !== "");
  const lines: ExhibitPart[][] = claims.map((c) => [
    ...parts(c.text),
    ...c.citations.filter((x) => x.quote).map((x) => ({ source: x.source_id })),
  ]);
  if (rec.impact?.low && rec.impact?.high)
    lines.push([
      { text: `Recommended: ${rec.action.replace(/^./, (ch) => ch.toLowerCase())}, ` },
      { fact: rec.impact.low },
      { text: " to " },
      { fact: rec.impact.high },
      { text: rec.impact.horizon ? ` over the ${rec.impact.horizon}.` : "." },
    ]);

  const notes: Record<string, ExhibitNote> = {};
  for (const id of ids) {
    const f = fact(id);
    const base = { id, label: f.label, value: shownValue(id), verified: f.verified ?? false };
    if (f.computation.kind === "sql" && f.computation.sql) {
      const params = Object.entries(f.computation.params ?? {})
        .filter(([k]) => k.startsWith("$"))
        .map(([k, v]) => [k, typeof v === "string" ? `'${v}'` : String(v)] as const);
      notes[id] = { ...base, kind: "sql", sql: sqlLines(f.computation.sql), params, ...(rows[id] ? { rows: rows[id] } : {}) };
    } else {
      notes[id] = {
        ...base,
        kind: "function",
        fn: f.computation.fn ?? "function",
        inputs: (f.computation.inputs ?? []).map((i) => ({ id: i, label: fact(i).label, value: shownValue(i) })),
      };
    }
  }
  for (const sid of sources) {
    const src = report.sources.find((s) => s.id === sid);
    const claim = claims.find((c) => c.citations.some((x) => x.source_id === sid));
    const quote = claim?.citations.find((x) => x.source_id === sid)?.quote;
    if (!src || !quote) continue;
    const section = (src.locator as { section?: string } | undefined)?.section;
    notes[sid] = {
      id: sid,
      kind: "source",
      label: `${src.kind} · ${src.file}`,
      value: src.file,
      verified: claim?.verified ?? false,
      quote,
      ...(section ? { section } : {}),
    };
  }
  // The metric's compiled SQL as two lines, for the landing page's "Definitions you confirm" cell: the SELECT and
  // FROM lines of the first SQL fact's recorded query (the metric's own query, as the engine ran it).
  const firstSql = order(ids)
    .map((id) => notes[id])
    .find((n) => n?.kind === "sql");
  const compiled = (firstSql?.sql ?? [])
    .map((l) => l.trim())
    .filter((l) => /^(SELECT|FROM) /.test(l))
    .slice(0, 2);
  if (compiled.length !== 2 || !compiled[0]?.startsWith("SELECT ") || !compiled[1]?.startsWith("FROM "))
    throw new LandingDataError(`no SELECT/FROM pair in the first SQL fact's query (${firstSql?.id ?? "none"})`);
  const headline = fact(claims[0]?.facts.find((id) => fact(id).unit === "percent") ?? ids[0] ?? "");
  const period = /(\d{4}-\d{2})/.exec(headline.label)?.[1] ?? "";
  const walk = walkthrough({ headline: headline.id, metric: headline.metric_id ?? metricOf(headline.label), lines, notes });
  return {
    title: `Report · coffee-roaster · ${monthName(period)}`,
    lines,
    // Reading order, top to bottom: the verification replay follows it.
    order: lines
      .flat()
      .flatMap((p) => ("fact" in p ? [p.fact] : "source" in p ? [p.source] : []))
      .filter((id, i, a) => a.indexOf(id) === i && id in notes),
    notes,
    compiled: { fact: firstSql?.id ?? "", label: firstSql?.label ?? "", lines: compiled },
    walk,
  };
}

/** One step of the hero's guided walkthrough: the figure whose margin note opens, and what the step says. */
export interface WalkStep {
  /** The fact or source id whose chip is highlighted and whose note opens. */
  readonly id: string;
  /** What the step points at, e.g. "Revenue fell" + the figure's stored value. */
  readonly title: string;
  /** Facts whose stored values follow the title, in order (never typed); a figure with a note reads "(value note)". */
  readonly figures: readonly { readonly id: string; readonly note?: string }[];
  /** Where the note takes the reader, e.g. "how it was computed". */
  readonly how: string;
}

const metricOf = (label: string) => /(?:^|\s)([a-z_]+)(?:_\d{4}-\d{2}|\s\d{4}-\d{2})/.exec(label)?.[1] ?? "metric";
const titleCase = (id: string) => id.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/**
 * The hero's guided walkthrough (DESIGN.md §6): the exhibit's story in four figures, each opening its margin note.
 *   1. the headline change → how it was computed (the function and its input facts);
 *   2. the headline's current-period SQL input → the SQL and the sheet rows it read;
 *   3. the driver's share of the change → the split by dimension, in code;
 *   4. the cited document → the quote, checked against the file.
 * Every step is chosen from the run's data by its role, never by a typed id; a missing role drops its step.
 */
export function walkthrough(x: {
  headline: string;
  metric: string;
  lines: readonly ExhibitPart[][];
  notes: Record<string, ExhibitNote>;
}): WalkStep[] {
  const { notes } = x;
  const head = notes[x.headline];
  if (!head) throw new LandingDataError(`the headline fact ${x.headline} has no note`);
  const steps: WalkStep[] = [];
  const falling = head.value.startsWith("−") || head.value.startsWith("-");
  steps.push({
    id: head.id,
    title: `${titleCase(x.metric)} ${falling ? "fell" : "rose"}`,
    figures: [{ id: head.id }],
    how: "how it was computed",
  });
  // The current period's SQL input of the headline (the newest period among its SQL inputs that cite sheet rows).
  const sqlInput = (head.inputs ?? [])
    .map((i) => notes[i.id])
    .filter((n): n is ExhibitNote => n?.kind === "sql" && n.rows !== undefined)
    .sort((a, b) => (periodOf(b.label) ?? "").localeCompare(periodOf(a.label) ?? ""))[0];
  if (sqlInput)
    steps.push({
      id: sqlInput.id,
      title: `${monthName(periodOf(sqlInput.label) ?? "")} ${x.metric.replace(/_/g, " ")},`,
      figures: [{ id: sqlInput.id }],
      how: "the SQL and the sheet rows it read",
    });
  // The driver: the line's first contribution delta, with its share of the change when the line has one.
  const shown = x.lines.flat().flatMap((p) => ("fact" in p ? [p.fact] : []));
  const delta = shown.map((id) => notes[id]).find((n) => n?.fn === "delta" && /contribution\.v1 .* by (\w+):delta:/.test(n.label));
  if (delta) {
    const m = /by (\w+):delta:(.+)$/.exec(delta.label);
    const share = shown.map((id) => notes[id]).find((n) => n?.fn === "contribution.v1" && n.inputs?.some((i) => i.id === delta.id));
    steps.push({
      id: delta.id,
      title: `${titleCase(m?.[2] ?? "the driver")}:`,
      figures: share ? [{ id: delta.id }, { id: share.id, note: "of the change" }] : [{ id: delta.id }],
      how: `the change split by ${m?.[1] ?? "dimension"}`,
    });
  }
  const source = Object.values(notes).find((n) => n.kind === "source");
  if (source)
    steps.push({
      id: source.id,
      title: "The cause",
      figures: [],
      how: `quoted from ${source.value}${source.verified ? ", checked against the file" : ""}`,
    });
  return steps;
}

const periodOf = (label: string) => /(\d{4}-\d{2})/.exec(label)?.[1];

export type ExhibitData = ReturnType<typeof exhibitData>;

// ── The status strip (DESIGN.md §4) ──────────────────────────────────────────────────────────────────────────────

export interface StatusInputs {
  /** CHANGELOG.md's first release heading, e.g. "## v0.1.0 (unreleased)". */
  readonly changelog: string;
  /** The test files vitest runs (its include globs). */
  readonly testFiles: number;
  readonly real: { readonly datasets: readonly { readonly checks: readonly { readonly pass: boolean }[] }[] };
  /** The latest real-model smoke run: jobs finished, and numbers the verifier found wrong. */
  readonly smoke: { readonly completed: number; readonly datasets: number; readonly mismatches: number | null };
  /** The latest pass of the generated-business suite: the nightly regression check, linked, not headlined. */
  readonly full: { readonly datasets: number };
}

export interface StripItem {
  readonly text: string;
  readonly href?: string;
  /** Said after the text to screen readers: where a link leads. */
  readonly more?: string;
}

/**
 * The strip's items, proven results first: the release, the real public data, the real-model smoke run, the test
 * files, the verifier, then the generated-business suite as the nightly regression check (its numbers are a link to
 * §3, never the headline: a partial pass reads as failure next to results that are proven).
 */
export function statusStrip(s: StatusInputs): StripItem[] {
  const m = /^##\s+(v\d+\.\d+\.\d+)\s*(\(unreleased\))?/m.exec(s.changelog);
  if (!m) throw new LandingDataError("CHANGELOG.md has no release heading");
  const checks = s.real.datasets.flatMap((d) => d.checks);
  const passed = checks.filter((c) => c.pass).length;
  const wrong = s.smoke.mismatches === null ? "" : `, ${s.smoke.mismatches} wrong number${s.smoke.mismatches === 1 ? "" : "s"}`;
  return [
    { text: `${m[1]} ${m[2] ? "pre-release" : "release"}` },
    { text: `real public data: ${passed}/${checks.length} checks` },
    { text: `real-model smoke: ${s.smoke.completed}/${s.smoke.datasets} jobs${wrong}` },
    { text: `${s.testFiles} test files` },
    { text: "verifier on every report" },
    { text: `nightly regression: ${s.full.datasets} generated businesses`, href: "#results", more: "latest results in section 3" },
  ];
}
