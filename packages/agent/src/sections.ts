// The report sections the analysis builds by code (report-schema §5b; analysis-library §11–§13): the scorecard, the
// concentration facts and "Analyses not run". No model makes or changes them. Here they become report parts (the
// dependence insight becomes its finding's id) and the planner's view of them (agent-and-verifier §2): the scorecard row
// and concentration facts a finding is about, so EXPLAIN can cite them, and the not-run entries, so the planner says
// "margin can't be computed: no cost column" instead of guessing.
import type { ConcentrationEntry, StoredInsight } from "@agentic-analytics/analysis";
import type { Fact, NotRun, Report, Scorecard } from "@agentic-analytics/schema";
import { type SheetFact, sheetFact } from "./factsheet.ts";
import { withheld } from "./withhold.ts";

/** What MEASURE stored of the analysis's sections. */
export interface AnalysisSections {
  readonly scorecard?: Scorecard;
  readonly concentration?: readonly ConcentrationEntry[];
  readonly notRun?: readonly NotRun[];
}

/** The report's sections; `insightOf` maps finding ids to the insight each explains. */
export function reportSections(
  s: AnalysisSections,
  insightOf: Readonly<Record<string, string>>,
): Pick<Report, "scorecard" | "concentration" | "analyses_not_run"> {
  const findingOf = new Map(Object.entries(insightOf).map(([finding, insight]) => [insight, finding]));
  const concentration = (s.concentration ?? []).map(({ dependence_insight, ...c }) => {
    const finding = dependence_insight ? findingOf.get(dependence_insight) : undefined;
    return finding ? { ...c, dependence: finding } : c;
  });
  return {
    ...(s.scorecard ? { scorecard: s.scorecard } : {}),
    ...(concentration.length ? { concentration } : {}),
    ...(s.notRun ? { analyses_not_run: [...s.notRun] } : {}),
  };
}

/** Every fact id the sections name (the report carries each, with the facts they are computed from). */
export function sectionFactIds(s: Pick<Report, "scorecard" | "concentration">): string[] {
  const ids: (string | undefined)[] = [];
  for (const r of s.scorecard?.rows ?? []) {
    ids.push(r.value, r.materiality_inputs?.band, r.materiality_inputs?.mean);
    for (const part of [r.vs_base, r.yoy]) if (!("na" in part)) ids.push(part.change, part.change_pct);
  }
  for (const c of s.concentration ?? []) {
    for (const w of c.pareto)
      ids.push(
        w.members,
        w.nonpositive_count,
        w.nonpositive_value,
        w.unkeyed_value,
        ...w.classes.flatMap((k) => [k.count, k.value, k.share]),
      );
    for (const sh of c.shares) ids.push(sh.top1, sh.top3, sh.top5, sh.top10, sh.hhi);
    ids.push(...Object.values(c.trend ?? {}));
  }
  return ids.filter((x): x is string => x !== undefined);
}

export interface SheetScorecardRow {
  readonly metric: string;
  readonly material: boolean | null;
  readonly facts: Record<string, SheetFact>;
}

export interface SheetConcentration {
  readonly metric: string;
  readonly dimension: string;
  /** The dimension's column, screened like any header. */
  readonly column: string;
  readonly facts: Record<string, SheetFact>;
}

export interface SheetNotRun {
  readonly analysis: string;
  readonly reason_code: string;
  readonly reason: string;
}

/** The planner's scorecard rows: each cell a sheet fact by name (value, vs_base, vs_base_pct, yoy, yoy_pct). */
export function sheetScorecard(scorecard: Scorecard | undefined, facts: ReadonlyMap<string, Fact>): SheetScorecardRow[] {
  const pick = (cells: Record<string, string | undefined>) =>
    Object.fromEntries(
      Object.entries(cells).flatMap(([name, id]) => {
        const f = id ? facts.get(id) : undefined;
        return f ? [[name, sheetFact(f)]] : [];
      }),
    );
  return (scorecard?.rows ?? []).map((r) => ({
    metric: r.metric_id,
    material: r.material,
    facts: pick({
      value: r.value,
      ...("na" in r.vs_base ? {} : { vs_base: r.vs_base.change, vs_base_pct: r.vs_base.change_pct }),
      ...("na" in r.yoy ? {} : { yoy: r.yoy.change, yoy_pct: r.yoy.change_pct }),
    }),
  }));
}

/**
 * The planner's concentration facts per dimension: the trailing year's classes, the top-N shares and HHI of the trailing
 * year and the latest period, and the trend. The per-period history behind the trend stays in the report only.
 */
export function sheetConcentration(
  entries: readonly ConcentrationEntry[],
  facts: ReadonlyMap<string, Fact>,
  latest: string,
): SheetConcentration[] {
  return entries.map((c) => {
    const out: Record<string, SheetFact> = {};
    const put = (name: string, id: string | undefined) => {
      const f = id ? facts.get(id) : undefined;
      if (f) out[name] = sheetFact(f);
    };
    for (const k of c.pareto.find((w) => w.window === "ttm")?.classes ?? []) {
      put(`class_${k.class}_count`, k.count);
      put(`class_${k.class}_share`, k.share);
    }
    for (const sh of c.shares.filter((x) => x.period === "ttm" || x.period === latest))
      for (const [k, id] of Object.entries({ top1: sh.top1, top3: sh.top3, top5: sh.top5, top10: sh.top10, hhi: sh.hhi }))
        put(`${k}_${sh.period}`, id);
    for (const [k, id] of Object.entries(c.trend ?? {})) put(k, id);
    return { metric: c.metric_id, dimension: withheld(c.dimension), column: withheld(c.column), facts: out };
  });
}

export const sheetNotRun = (list: readonly NotRun[] | undefined): SheetNotRun[] =>
  (list ?? []).map((n) => ({ analysis: n.analysis, reason_code: n.reason_code, reason: n.reason }));

/**
 * The part of the sections one finding's EXPLAIN sees: the scorecard row of its metric, and for a concentration or
 * dependence finding the facts of its dimension. Small, so the per-finding request stays small.
 */
export function findingSections(
  insight: Pick<StoredInsight, "metric" | "template" | "details">,
  sheet: { readonly scorecard?: readonly SheetScorecardRow[]; readonly concentration?: readonly SheetConcentration[] },
): { scorecard?: SheetScorecardRow[]; concentration?: SheetConcentration[] } {
  const row = (sheet.scorecard ?? []).filter((r) => r.metric === insight.metric);
  const concentrated = insight.template === "concentration.v1" || insight.template === "dependence.v1";
  const column = String(insight.details.dimension ?? "");
  const conc = concentrated ? (sheet.concentration ?? []).filter((c) => c.metric === insight.metric && c.column === column) : [];
  return { ...(row.length ? { scorecard: row } : {}), ...(conc.length ? { concentration: conc } : {}) };
}
