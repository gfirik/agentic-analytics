// The landing page's report data (src/pages/index.astro, <LedgerReport />), from the same web-enabled run the hero
// animation plays (pipeline-data.ts recordRun(), docs/assets/readme/pipeline.json), so the whole page shows ONE run:
// the first finding, every fact its claims and its top recommendation use, the facts those are computed from (so each
// chip opens a fact whose inputs open too), and the verification counts. Values are the facts' stored values.
import type { Report } from "@agentic-analytics/schema";
import type { PipelineData } from "../src/components/pipeline-scene.ts";

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
