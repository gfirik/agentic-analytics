// The fact sheet (agent-and-verifier §2): the planner's only numeric input. A compact JSON of the objective,
// metric definitions (with assumption flags), the ranked material insights, their decompositions and the
// quality issues. Every number is a fact with its id, value, unit and label; raw tables never reach the model.
import type { StoredDecomposition, StoredInsight } from "@agentic-analytics/analysis";
import type { Fact, MetricDef } from "@agentic-analytics/schema";
import {
  type AnalysisSections,
  type SheetConcentration,
  type SheetNotRun,
  type SheetScorecardRow,
  sheetConcentration,
  sheetNotRun,
  sheetScorecard,
} from "./sections.ts";
import { withheld, withheldKeys, withheldMember } from "./withhold.ts";

export interface SheetFact {
  readonly id: string;
  readonly value: number;
  readonly unit: string;
  readonly label: string;
}

export interface FactSheet {
  readonly objective: string;
  readonly period: { readonly from: string; readonly to: string; readonly grain: string };
  readonly metrics: readonly { id: string; label: string; unit: string; currency?: string; assumed: boolean }[];
  readonly insights: readonly {
    id: string;
    template: string;
    metric: string;
    period: string;
    member?: { dimension: string; value: string | null };
    confidence: string;
    score: number;
    facts: Record<string, SheetFact>;
  }[];
  readonly decompositions: readonly { id: string; insight: string; method: string; dimension: string; facts: Record<string, SheetFact> }[];
  readonly quality: readonly { id: string; kind: string; severity: string }[];
  /** M15 (§2): the scorecard rows and concentration facts EXPLAIN can cite, and what could not be computed. */
  readonly scorecard?: readonly SheetScorecardRow[];
  readonly concentration?: readonly SheetConcentration[];
  readonly not_run?: readonly SheetNotRun[];
}

/** Fact values rounded for reading (the report renders the exact fact; the model only needs magnitudes). */
const round = (v: number) => (Math.abs(v) >= 100 ? Math.round(v * 100) / 100 : Number(v.toPrecision(6)));

export function sheetFact(f: Fact): SheetFact {
  // The label can carry a table cell (a member value): screened on its way to the planner (withhold.ts).
  return { id: f.id, value: round(f.value), unit: f.currency && f.unit === "currency" ? f.currency : f.unit, label: withheld(f.label) };
}

export function buildFactSheet(input: {
  objective: string;
  period: { from: string; to: string; grain: string };
  defs: readonly MetricDef[];
  insights: readonly StoredInsight[];
  decompositions: readonly StoredDecomposition[];
  facts: ReadonlyMap<string, Fact>;
  quality: readonly { id: string; kind: string; severity: string }[];
  /** Insight ids to include (the ranked top); default: every material insight. */
  only?: readonly string[];
  /** The sections built by code (M15); each one given is listed. */
  sections?: AnalysisSections;
}): FactSheet {
  const sec = input.sections;
  const pick = (ids: Record<string, string>): Record<string, SheetFact> =>
    Object.fromEntries(
      Object.entries(ids).flatMap(([role, id]) => {
        const f = input.facts.get(id);
        return f ? [[role, sheetFact(f)]] : [];
      }),
    );
  const insights = input.insights.filter((i) => !input.only || input.only.includes(i.id));
  const keep = new Set(insights.map((i) => i.id));
  return {
    objective: input.objective,
    period: input.period,
    metrics: input.defs.map((d) => ({
      id: d.id,
      // Labels are screened at validation (validate.ts); this is the last check before the planner reads it.
      label: withheld(d.label),
      unit: d.unit,
      ...(d.currency ? { currency: d.currency } : {}),
      assumed: d.status !== "confirmed",
    })),
    insights: insights.map((i) => ({
      id: i.id,
      template: i.template,
      metric: i.metric,
      period: i.period,
      ...(i.member ? { member: withheldMember(i.member) } : {}),
      confidence: i.confidence,
      score: Number(i.score.toFixed(4)),
      facts: pick(i.facts),
    })),
    decompositions: input.decompositions
      .filter((d) => keep.has(d.insight))
      .map((d) => ({
        id: d.id,
        insight: d.insight,
        method: d.method,
        dimension: withheld(d.dimension),
        facts: withheldKeys(pick(d.facts)),
      })),
    quality: input.quality.map((q) => ({ id: q.id, kind: q.kind, severity: q.severity })),
    ...(sec?.scorecard ? { scorecard: sheetScorecard(sec.scorecard, input.facts) } : {}),
    ...(sec?.concentration?.length
      ? { concentration: sheetConcentration(sec.concentration, input.facts, sec.scorecard?.period ?? input.period.to) }
      : {}),
    ...(sec?.notRun ? { not_run: sheetNotRun(sec.notRun) } : {}),
  };
}
