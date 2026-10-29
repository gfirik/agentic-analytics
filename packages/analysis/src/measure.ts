// MEASURE (analysis-library §1): every metric per period, and per dimension member (the top N and "(other)"), read through
// the metric compiler. The series are registered in `series` for the fact book; the member values per period, uncapped,
// are what the concentration statistics read (§11).
import { type Catalog, type Grain, MARGIN_METRIC, marginDimensions, marginTerms, runMetric } from "@agentic-analytics/metrics";
import type { MetricDef } from "@agentic-analytics/schema";
import type { Workspace } from "@agentic-analytics/store";
import { membersByPeriod } from "./concentration-pack.ts";
import type { SeriesInfo } from "./factbook.ts";
import { memberFilter, otherFilter, unitOf } from "./members.ts";
import type { Member } from "./pareto.ts";
import { fillPeriods } from "./periods.ts";
import { OTHER, type Point, type Series } from "./types.ts";

export interface Measured {
  /** Each metric's total series, in the order of `defs`. */
  readonly totals: Series[];
  /** Per metric, its member series per dimension (top N, then "(other)"). */
  readonly members: Map<string, { dimension: string; series: Series[] }[]>;
  /** `metric|dimension` → period → every member's value, uncapped (analysis-library §11). */
  readonly perPeriod: Map<string, Map<string, Member[]>>;
  /** The periods where some metric has data, sorted. */
  readonly jobPeriods: string[];
}

/** The pack's `gross_margin`: split by member and by margin PVM like an additive metric. */
export const isGrossMargin = (def: MetricDef | undefined, defs: readonly MetricDef[]): boolean =>
  def !== undefined && def.id === MARGIN_METRIC && marginTerms(def, defs)?.fn === MARGIN_METRIC;

const sumAbs = (pts: readonly { value: number }[]) => pts.reduce((a, p) => a + Math.abs(p.value), 0);

export async function measureMetrics(
  ws: Workspace,
  defs: readonly MetricDef[],
  catalog: Catalog,
  range: { readonly from: string; readonly to: string; readonly grain: Grain },
  maxMembers: number,
  series: Map<string, SeriesInfo>,
  openQuestions: string[],
): Promise<Measured> {
  const totals: Series[] = [];
  const members = new Map<string, { dimension: string; series: Series[] }[]>();
  const measured = new Map<string, { period: string; value: number }[]>();
  // Every member's value per period, uncapped: the concentration statistics need all members (analysis-library §11).
  const perPeriod = new Map<string, Map<string, Member[]>>();
  for (const def of defs) {
    const rows = await runMetric(ws, def.id, defs, catalog, range);
    measured.set(
      def.id,
      rows.filter((r) => r.value !== null).map((r) => ({ period: r.period, value: Number(r.value) })),
    );
  }
  // Inside a metric's own first..last period, every series has every job period (a period where some metric has
  // data), so the time-series tests, which work by position, never compare March with January across a missing
  // February. Outside that span nothing is added: a table that starts later has no zeros before its first row, and
  // a period with no data at all stays a gap (profile's missing_periods). An additive metric is 0 where it has no
  // rows (FactBook.point makes the same 0 a fact); an average or ratio is unknown there (NaN, which the baselines and
  // templates skip). Spec analysis-library §1.
  const jobPeriods = [...new Set([...measured.values()].flatMap((ps) => ps.map((p) => p.period)))].sort();
  const fill = (points: readonly Point[], additive: boolean, span: readonly { period: string }[]) =>
    fillPeriods(points, jobPeriods, additive, span);
  for (const def of defs) {
    const unit = unitOf(def);
    const additive = def.type === "sum" || def.type === "count";
    // Margin is additive across members (revenue − cost per member), so it is split like a sum even though it is derived.
    const splittable = additive || isGrossMargin(def, defs);
    const own = measured.get(def.id) ?? [];
    const total: Series = { id: def.id, metric: def.id, unit, points: fill(own, additive || def.type === "count_distinct", own) };
    series.set(total.id, { series: total, def });
    totals.push(total);
    for (const dimension of splittable ? (isGrossMargin(def, defs) ? marginDimensions(def, defs) : (def.dimensions ?? [])) : []) {
      const grouped = await runMetric(ws, def.id, defs, catalog, { ...range, groupBy: [dimension] });
      const byMember = new Map<string | null, { period: string; value: number }[]>();
      for (const r of grouped) {
        const key = (r[dimension] as string | null) ?? null;
        byMember.set(key, [...(byMember.get(key) ?? []), { period: r.period, value: Number(r.value ?? 0) }]);
      }
      perPeriod.set(`${def.id}|${dimension}`, membersByPeriod(byMember));
      const ranked = [...byMember.entries()].sort((a, b) => sumAbs(b[1]) - sumAbs(a[1]) || String(a[0]).localeCompare(String(b[0])));
      const kept = ranked.slice(0, maxMembers);
      const list: Series[] = kept.map(([value, points]) => {
        const s: Series = {
          id: `${def.id}|${dimension}=${value ?? "(none)"}`,
          metric: def.id,
          unit,
          member: { dimension, value },
          points: fill(points, true, total.points),
        };
        series.set(s.id, { series: s, def, where: memberFilter(dimension, value) });
        return s;
      });
      if (ranked.length > maxMembers) {
        // The rest become one "(other)" member, so member changes still add up to the total. Its values come from
        // the same NOT IN query its facts cite, so a fact's value is exactly what its SQL returns.
        const rest = ranked.slice(maxMembers);
        const where = otherFilter(
          dimension,
          kept.map(([v]) => v),
        );
        const otherRows = await runMetric(ws, def.id, defs, catalog, { ...range, where });
        const s: Series = {
          id: `${def.id}|${dimension}=${OTHER}`,
          metric: def.id,
          unit,
          member: { dimension, value: OTHER },
          points: fill(
            otherRows.map((r) => ({ period: r.period, value: Number(r.value ?? 0) })),
            true,
            total.points,
          ),
        };
        series.set(s.id, { series: s, def, where });
        list.push(s);
        openQuestions.push(
          `${def.id} has ${ranked.length} ${dimension} members; the top ${maxMembers} are analysed and the other ${rest.length} are grouped as "${OTHER}".`,
        );
      }
      members.set(def.id, [...(members.get(def.id) ?? []), { dimension, series: list }]);
    }
  }
  return { totals, members, perPeriod, jobPeriods };
}
