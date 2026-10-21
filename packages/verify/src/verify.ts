// The verifier (agent-and-verifier §7): passes V1–V8 over the draft, then the failure policy.
// - V2/V3 mismatches are engine bugs: the job fails with a diagnostic, nothing ships.
// - A claim failing V1, V4, V5 or V8 is dropped; V6 rewrites causal wording to correlational.
// - Cascade: a finding with no claims left is dropped, a recommendation without a surviving finding is dropped.
// - Every check is a row in the `verification` table; drops and downgrades are listed in the report.

import { data, renderPrompt } from "@agentic-analytics/agent";
import { externalFacts, readFacts } from "@agentic-analytics/analysis";
import { type Catalog, compileMetric, compileMetricRows, type Grain, runMetric } from "@agentic-analytics/metrics";
import type { ModelClient } from "@agentic-analytics/models";
import {
  type Claim,
  checkReportIntegrity,
  type Fact,
  type Finding,
  findFreeNumerals,
  type MetricDef,
  periodYears,
  placeholders,
  type Recommendation,
  type Report,
  screen,
} from "@agentic-analytics/schema";
import { ident, sql, tableName, type Workspace } from "@agentic-analytics/store";
import { z } from "zod";
import { type Recomputed, recomputeFacts, same, VerifyError } from "./recompute.ts";

export interface VerifyContext {
  readonly ws: Workspace;
  readonly defs: readonly MetricDef[];
  readonly catalog: Catalog;
  readonly grain: Grain;
  /** Last day of the data: a recommendation's check date must come after it. */
  readonly periodEnd: string;
  /** The judge role (V5 entailment); without it the judge step is skipped and counted as such. */
  readonly judge?: ModelClient;
}

export interface CheckRow {
  readonly check: "V1" | "V2" | "V3" | "V4" | "V5" | "V6" | "V7" | "V8";
  readonly passed: boolean;
  readonly fact?: string;
  readonly claim?: string;
  /** Where the claim sits ("finding F1", "recommendation R2"); stored as the check's claim reference. */
  readonly where?: string;
  readonly detail: string;
}

export interface VerifyResult {
  readonly report: Report;
  readonly checks: CheckRow[];
}

// ── V6 lexicon (EN/RU/UZ) and its correlational rewrites ────────────────────────────────────────────────────

const CAUSAL: readonly [RegExp, string][] = [
  [/\bwas caused by\b/gi, "coincided with"],
  [/\bwere caused by\b/gi, "coincided with"],
  [/\bcaused by\b/gi, "coinciding with"],
  [/\bcaused\b/gi, "coincided with"],
  [/\bcauses\b/gi, "coincides with"],
  [/\bas a result of\b/gi, "alongside"],
  [/\bresulted in\b/gi, "was followed by"],
  [/\bdue to\b/gi, "alongside"],
  [/\bbecause of\b/gi, "around the time of"],
  [/\bled to\b/gi, "was followed by"],
  [/\bleads to\b/gi, "is followed by"],
  [/\bstemmed from\b/gi, "followed"],
  [/\bstems from\b/gi, "follows"],
  [/\b(?:was|were|is|are) driven by\b/gi, "moved with"],
  [/\bdriven by\b/gi, "alongside"],
  [/\bdrove\b/gi, "coincided with"],
  [/\bdrives\b/gi, "coincides with"],
  [/\btriggered\b/gi, "preceded"],
  [/\btriggers\b/gi, "precedes"],
  [/\bbecause\b/gi, "around the time"],
  [/из-за/gi, "одновременно с"],
  [/благодаря/gi, "одновременно с"],
  [/стал[оаи]? причиной/gi, "совпало с"],
  [/повлекл[оаи]?/gi, "совпало с"],
  [/привел[оаи]? к/gi, "совпало с"],
  [/вызван[оаы]?/gi, "совпало с"],
  [/по причине/gi, "одновременно с"],
  [/в результате/gi, "одновременно с"],
  [/\bsababli\b/gi, "bilan bir vaqtda"],
  [/\btufayli\b/gi, "bilan bir vaqtda"],
  [/\bolib keldi\b/gi, "bilan bir vaqtga to'g'ri keldi"],
  [/\bsabab bo'ldi\b/gi, "bilan bir vaqtda bo'ldi"],
  [/\bnatijasida\b/gi, "bilan bir vaqtda"],
];

export function isCausal(text: string): boolean {
  return CAUSAL.some(([re]) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}

export function rewriteCorrelational(text: string): string {
  let t = text;
  for (const [re, to] of CAUSAL) t = t.replace(re, to);
  return t;
}

const RANK: Record<string, number> = { observed: 0, correlated: 1, document_supported: 2, intervention_supported: 3 };
const UNIT: Record<string, string> = { currency: "currency", percent: "percent", count: "count", ratio: "ratio", days: "days" };

const Judgement = z.object({ supported: z.boolean() });

/** What a finding is called when its title breaks the claim rules (V1): plain words, no figure. */
export const NEUTRAL_TITLE = "A change worth a look";

export async function verifyReport(draft: Report, ctx: VerifyContext): Promise<VerifyResult> {
  const checks: CheckRow[] = [];
  const all = new Map((await readFacts(ctx.ws)).map((f) => [f.id, f]));
  for (const f of draft.facts) if (!all.has(f.id)) all.set(f.id, f);
  const factIds = new Set(draft.facts.map((f) => f.id));

  // ── V2 recompute: every fact in the report ─────────────────────────────────────────────────────────────
  const v2 = await recomputeFacts(ctx.ws, draft.facts, all);
  for (const r of v2)
    checks.push({
      check: "V2",
      passed: r.ok,
      fact: r.fact,
      detail: `${r.how}: stored ${r.stored}, computed ${JSON.stringify(r.computed)}`,
    });
  const mismatched = v2.filter((r) => !r.ok);
  if (mismatched.length)
    throw new VerifyError(
      "RECOMPUTE_MISMATCH",
      `${mismatched.length} fact(s) don't recompute: ${mismatched.map((m) => m.fact).join(", ")}`,
      { mismatched },
    );

  // V5 for facts: every cited input row exists in its table (a wrong row is an engine bug, like V2).
  const rows = await checkFactRows(ctx.ws, draft.facts, ctx.defs, ctx.catalog, ctx.grain);
  checks.push(...rows);
  const badRows = rows.filter((r) => !r.passed);
  if (badRows.length)
    throw new VerifyError("CITATION_MISMATCH", `${badRows.length} fact citation(s) point at rows that don't exist`, { badRows });

  // ── V3 re-derive: headline measures by an alternate path ──────────────────────────────────────────────
  const headline = new Set([...draft.findings.flatMap((f) => f.claims.flatMap((c) => c.facts)), ...placeholders(draft.summary.headline)]);
  const rederived: (Recomputed & { path: string })[] = [];
  for (const id of headline) {
    const f = all.get(id);
    if (f?.computation.kind !== "sql" || !f.metric_id) continue;
    const r = await rederive(ctx, f);
    if (r) rederived.push(r);
  }
  for (const r of rederived) checks.push({ check: "V3", passed: r.ok, fact: r.fact, detail: `${r.path}: ${r.stored} vs ${r.computed}` });
  const rederiveBad = rederived.filter((r) => !r.ok);
  if (rederiveBad.length)
    throw new VerifyError("REDERIVE_MISMATCH", `${rederiveBad.length} headline fact(s) differ on an alternate path`, { rederiveBad });

  // ── Claim passes ────────────────────────────────────────────────────────────────────────────────────────
  const sources = new Map(
    (
      await ctx.ws.all<{ id: string; kind: string; text: string | null; external: boolean }>(
        sql`SELECT id, kind, text, external FROM sources`,
      )
    ).map((s) => [s.id, s]),
  );
  const fileOf = new Map(draft.sources.map((x) => [x.id, x.file]));
  const external = externalFacts([...all.values()]);
  const labelOf = (metric: string) => ctx.defs.find((d) => d.id === metric)?.label ?? metric;
  const memo = new Map<string, Set<string>>();
  /** The metrics a fact is measured from: its own, or those of the facts it was computed from. */
  const metricsOf = (id: string, seen = new Set<string>()): Set<string> => {
    const known = memo.get(id);
    if (known) return known;
    const f = all.get(id);
    const out = new Set<string>();
    if (f && !seen.has(id)) {
      seen.add(id);
      if (f.metric_id) out.add(f.metric_id);
      else for (const x of f.computation.inputs ?? []) for (const m of metricsOf(x, seen)) out.add(m);
    }
    memo.set(id, out);
    return out;
  };
  /** The web sources behind an external number (its external_quote ancestors' citations). */
  const externalSourcesOf = (id: string, seen = new Set<string>()): string[] => {
    const f = all.get(id);
    if (!f || seen.has(id)) return [];
    seen.add(id);
    if (f.computation.fn === "external_quote") return f.citations.map((c) => c.source_id);
    return (f.computation.inputs ?? []).flatMap((x) => externalSourcesOf(x, seen));
  };
  /** V4: a measured fact's SQL must be its metric's definition for its period and member filter. */
  const definitionProblem = (f: Fact): string | undefined => {
    if (f.computation.kind !== "sql") return undefined;
    const m = parseMeasured(f.label);
    const def = m ? ctx.defs.find((d) => d.id === m.metric) : undefined;
    if (!m || !def || m.where === null) return undefined;
    const compiled = compileMetric(def.id, ctx.defs, ctx.catalog, {
      from: m.period,
      to: m.period,
      grain: ctx.grain,
      ...(m.where ? { where: m.where } : {}),
    });
    const stored = Object.entries(f.computation.params ?? {})
      .filter(([k]) => /^\$\d+$/.test(k))
      .sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)))
      .map(([, v]) => v);
    const same = compiled.text === f.computation.sql && JSON.stringify(compiled.params) === JSON.stringify(stored);
    return same ? undefined : `fact ${f.id}'s SQL is not the definition of ${def.id} for ${m.period}${m.where ? ` (${m.where})` : ""}`;
  };
  const dropped = [...draft.verification.claims_dropped];
  const downgraded = [...draft.verification.claims_downgraded];
  let definitionViolations = 0;
  let citationsChecked = 0;
  let citationsUnsupported = 0;

  /**
   * The claim rules of V1 (and V4's decline sign) on a text with its facts and citations: free numerals, unknown
   * placeholders, digits inside quotes, "fell {{N}}" with a signed value, and "more than the whole" without its
   * comparison. Claims, and every other text the report shows (the headline, titles, actions, not_advised), pass it.
   */
  // The job's own period years (from its facts' period labels and the data's end): a bare year in report text is a
  // date only if it is one of them (findFreeNumerals).
  const jobYears = periodYears([...[...all.values()].map((f) => f.label), ctx.periodEnd.slice(0, 7)]);
  const ruleBreak = (
    text: string,
    facts: readonly string[],
    citations: Claim["citations"],
  ): readonly [CheckRow["check"], string] | undefined => {
    // V1: numbers only as placeholders, each a known fact listed by the claim.
    const free = findFreeNumerals(text, jobYears);
    if (free.length) return ["V1", `free numeral(s) ${free.join(", ")}`];
    const unknown = placeholders(text).find((id) => !factIds.has(id) || !facts.includes(id));
    if (unknown) return ["V1", `placeholder {{${unknown}}} is not a listed fact`];
    // Quoted text may hold digits only when it really is quoted: from a cited source, or a name from the data.
    for (const span of quotedSpans(text).filter((q) => /\p{Nd}/u.test(q))) {
      // From a cited source: its text, the quote, or the source's own file name ("“email-0412.eml” says: …", which
      // code writes in small-model mode).
      const fromSource = citations.some(
        (x) => (x.quote ?? "").includes(span) || (sources.get(x.source_id)?.text ?? "").includes(span) || fileOf.get(x.source_id) === span,
      );
      // A name from the data: a whole member value or label, never a fragment like a period's "04".
      const fromData =
        /\p{L}/u.test(span) && [...all.values()].some((f) => dataNames(f.label).some((n) => n.toLowerCase() === span.toLowerCase()));
      if (!fromSource && !fromData) return ["V1", `quoted “${span}” is not from a cited source or the data`];
    }
    // A decline is stated as a magnitude (report-schema §5a): "fell {{N}}" with a negative N reads as a double
    // negative ("fell −7,900") or an increase, depending on the renderer.
    for (const m of text.matchAll(
      /(?<![\p{L}])(?:fell|dropped|declined|decreased|shrank|lost|fall|drop|decline|decrease|упал\p{L}*|снизил\p{L}*|сократил\p{L}*|kamaydi|tushdi)(?![\p{L}])(?:\s+\p{L}+){0,3}\s+(?:by\s+|на\s+)?\{\{(N\d+)\}\}/giu,
    )) {
      const v = all.get(m[1] ?? "")?.value ?? 0;
      if (v < 0) return ["V4", `a word of decline is followed by the signed value {{${m[1]}}} (state the magnitude)`];
    }
    // "More than the whole drop" is a comparison, so it is held to a fact like any number: the claim must cite an
    // `abs_exceeds` fact equal to 1 (recomputed by V2 from its inputs; analysis-library §4.1) whose first input is the
    // change of the member quoted just before the phrase, so one member's comparison can't speak for another. The
    // label ends in `:delta:<member>` because the decomposer names each member's change `delta:<member>` (decompose.ts).
    const phrase = text.search(/more than the whole/i);
    if (phrase >= 0) {
      const named = [...text.slice(0, phrase).matchAll(/“([^”]+)”/g)].map((m) => m[1]).slice(-1);
      const backed = facts.some((id) => {
        const f = all.get(id);
        const first = all.get(f?.computation.inputs?.[0] ?? "");
        return f?.computation.fn === "abs_exceeds" && f.value === 1 && named.some((n) => first?.label.endsWith(`:delta:${n}`));
      });
      if (!backed) return ["V1", "“more than the whole” is not backed by a comparison fact for the member it names"];
    }
    return undefined;
  };

  const checkClaim = async (c: Claim, where: string): Promise<Claim | undefined> => {
    const drop = (check: CheckRow["check"], reason: string) => {
      checks.push({ check, passed: false, claim: c.text, where, detail: `${where}: ${reason}` });
      dropped.push({ claim: c.text, reason: `${check}: ${reason}` });
      return undefined;
    };
    // V1 (and V4's decline sign): the shared text rules.
    const broken = ruleBreak(c.text, c.facts, c.citations);
    if (broken) return drop(broken[0], broken[1]);
    checks.push({ check: "V1", passed: true, claim: c.text, where, detail: where });

    // V4: each fact measures a defined metric with its unit/currency, period and filters; and the claim names no
    // other metric than the ones its facts come from (followed back through derived facts).
    const named = ctx.defs.filter((d) =>
      [d.label, d.id].some((n) =>
        new RegExp(`(?<![\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/_/g, "[ _]")}(?![\\p{L}])`, "iu").test(c.text),
      ),
    );
    // The metrics the claim may name are those of all its facts together (spec §7 V4), not of each fact alone: "revenue
    // fell {{N1}} as {{N2}} fewer bags sold" names revenue, which N1 measures, though N2 measures units.
    const from = new Set(c.facts.flatMap((id) => (all.has(id) ? [...metricsOf(id)] : [])));
    const lexicon =
      named.length > 0 &&
      from.size > 0 &&
      !named.some((n) => from.has(n.id) || [...from].some((m) => labelOf(m).toLowerCase().includes(n.label.toLowerCase())));
    for (const id of c.facts) {
      const f = all.get(id);
      if (!f) continue;
      const def = f.metric_id ? ctx.defs.find((d) => d.id === f.metric_id) : undefined;
      const problem =
        f.metric_id && !def
          ? `fact ${id} measures unknown metric ${f.metric_id}`
          : def && (UNIT[def.unit] ?? "other") !== f.unit && !(def.type === "ratio" && f.unit === "ratio")
            ? `fact ${id} is in ${f.unit}, ${def.id} is defined in ${def.unit}`
            : def && f.unit === "currency" && def.currency && f.currency && f.currency !== def.currency
              ? `fact ${id} is in ${f.currency}, ${def.id} is defined in ${def.currency}`
              : (definitionProblem(f) ??
                (lexicon
                  ? `the claim names ${named.map((n) => n.label).join(", ")} but its facts measure ${[...from].map(labelOf).join(", ")}`
                  : undefined));
      if (problem) {
        definitionViolations++;
        return drop("V4", problem);
      }
    }
    checks.push({ check: "V4", passed: true, claim: c.text, where, detail: where });

    // V8: a number derived from the web needs its web source cited.
    // The claim must cite the very web sources its external numbers were quoted from, each marked external.
    const needed = new Set(c.facts.filter((id) => external.has(id)).flatMap((id) => externalSourcesOf(id)));
    for (const src of needed) {
      const cited = c.citations.some((x) => x.source_id === src);
      if (!cited || !(sources.get(src)?.kind === "web" && sources.get(src)?.external))
        return drop("V8", "uses an external number without citing its web source");
    }
    checks.push({ check: "V8", passed: true, claim: c.text, detail: where });

    // V5: quotes exist in their sources; the judge confirms the sources support the claim.
    const quoted = c.citations.filter((x) => x.quote !== undefined);
    for (const x of quoted) {
      citationsChecked++;
      const text = sources.get(x.source_id)?.text ?? "";
      if (!text.includes(x.quote as string)) {
        citationsUnsupported++;
        return drop("V5", `the quote is not in source ${x.source_id}`);
      }
    }
    let judged = ctx.judge ? "" : ", judge not configured";
    if (quoted.length && ctx.judge) {
      // A quoted member name that reads as an instruction goes to the judge withheld, like at every planner door
      // (security §3): the judge still sees the claim's shape and the source excerpts.
      const claim = c.text.replace(/“[^”]*”|"[^"]*"/g, (q) => (screen(q) ? "“withheld”" : q));
      try {
        const { object } = await ctx.judge.generateObject({
          role: "judge",
          schema: Judgement,
          system: renderPrompt("judge", {
            claim: data(claim),
            sources: data(quoted.map((x) => ({ source: x.source_id, quote: x.quote }))),
          }),
          prompt: "Do these excerpts support the claim?",
        });
        if (!object.supported) {
          citationsUnsupported++;
          return drop("V5", "the judge found the cited sources don't support the claim");
        }
      } catch (err) {
        // The provider timed out, hit a limit or answered badly: the judge step is skipped for this claim and the
        // check row says so (spec §7 V5), as with no judge; the quotes were still found in their sources.
        judged = `, judge unavailable (${err instanceof Error ? err.message.slice(0, 120) : "error"})`;
      }
    }
    checks.push({
      check: "V5",
      passed: true,
      claim: c.text,
      detail: `${where}: ${quoted.length} quote(s)${quoted.length ? judged : ""}`,
    });

    // V6: causal wording needs a document; otherwise the claim is reworded to correlational.
    const docs = c.citations.some((x) => ["document", "email"].includes(sources.get(x.source_id)?.kind ?? ""));
    let grade = c.causal_grade;
    if ((RANK[grade ?? "correlated"] ?? 1) >= 2 && !docs) {
      downgraded.push({ claim: c.text, from: grade ?? "", to: "correlated", reason: "V6: no source document cited" });
      grade = "correlated";
    }
    let text = c.text;
    if (isCausal(text) && (RANK[grade ?? "correlated"] ?? 1) < 2) {
      text = rewriteCorrelational(text);
      downgraded.push({
        claim: c.text,
        from: grade ?? "correlated",
        to: "correlated",
        reason: `V6: causal wording without a supporting document; reworded to “${text}”`,
      });
      checks.push({ check: "V6", passed: false, claim: c.text, detail: `${where}: reworded` });
    } else checks.push({ check: "V6", passed: true, claim: c.text, detail: where });

    return { ...c, text, ...(grade ? { causal_grade: grade } : {}), verified: true };
  };

  const findings: Finding[] = [];
  for (const f of draft.findings) {
    const claims: Claim[] = [];
    for (const c of f.claims) {
      const ok = await checkClaim(c, `finding ${f.id}`);
      if (ok) claims.push(ok);
    }
    // V7 (cascade): a finding needs at least one verified claim.
    if (!claims.length) {
      dropped.push({ claim: f.title, reason: `V7: finding ${f.id} has no verified claim left` });
      checks.push({ check: "V7", passed: false, detail: `finding ${f.id} dropped` });
      continue;
    }
    findings.push({ ...f, claims });
  }
  // V6 for model-written plain text (titles, headline, actions): causal words need a document-supported claim
  // in the finding they speak for; otherwise they are reworded like claims.
  const documented = new Set(
    findings.filter((f) => f.claims.some((c) => (RANK[c.causal_grade ?? "correlated"] ?? 1) >= 2)).map((f) => f.id),
  );
  const plain = (text: string, ok: boolean, where: string): string => {
    if (ok || !isCausal(text)) return text;
    const reworded = rewriteCorrelational(text);
    downgraded.push({
      claim: text,
      from: "causal wording",
      to: "correlated",
      reason: `V6: ${where} without a supporting document; reworded to “${reworded}”`,
    });
    checks.push({ check: "V6", passed: false, where, detail: `${where}: reworded` });
    return reworded;
  };
  for (const [k, f] of findings.entries()) {
    // A title is text the reader sees like a claim: the same rules, over its own claims' facts and citations. One that
    // breaks them is replaced by a neutral title, not shipped (the finding's claims still stand).
    const broken = ruleBreak(
      f.title,
      f.claims.flatMap((c) => c.facts),
      f.claims.flatMap((c) => c.citations),
    );
    if (broken) {
      checks.push({ check: broken[0], passed: false, where: `the title of ${f.id}`, detail: `the title of ${f.id}: ${broken[1]}` });
      dropped.push({ claim: f.title, reason: `${broken[0]}: the title of ${f.id}: ${broken[1]}; replaced by a neutral title` });
    }
    const title = broken ? NEUTRAL_TITLE : f.title;
    findings[k] = { ...f, title: plain(title, documented.has(f.id), `the title of ${f.id}`) };
  }
  const kept = new Set(findings.map((f) => f.id));

  const recommendations: Recommendation[] = [];
  for (const r of draft.recommendations) {
    const because = r.because.filter((b) => kept.has(b));
    const problem = !because.length
      ? "no verified finding supports it"
      : !factIds.has(r.impact.low) || !factIds.has(r.impact.high)
        ? "its impact facts are missing"
        : !(r.check.by > ctx.periodEnd)
          ? `its check date ${r.check.by} is not after the data (${ctx.periodEnd})`
          : !factIds.has(r.check.threshold)
            ? "its check threshold is not a fact"
            : undefined;
    if (problem) {
      dropped.push({ claim: r.action, reason: `V7: ${problem}` });
      checks.push({ check: "V7", passed: false, detail: `recommendation ${r.id}: ${problem}` });
      continue;
    }
    const rationale: Claim[] = [];
    for (const c of r.rationale) {
      const ok = await checkClaim(c, `recommendation ${r.id}`);
      if (ok) rationale.push(ok);
    }
    if (r.rationale.length && !rationale.length) {
      dropped.push({ claim: r.action, reason: "V7: none of its rationale survived verification" });
      checks.push({ check: "V7", passed: false, detail: `recommendation ${r.id}: rationale dropped` });
      continue;
    }
    // The action and not_advised are text the reader sees: the same rules as claims (with the rationale's facts).
    const rationaleFacts = rationale.flatMap((c) => c.facts);
    const actionBroken = ruleBreak(r.action, rationaleFacts, []);
    if (actionBroken) {
      dropped.push({ claim: r.action, reason: `${actionBroken[0]}: the action of ${r.id}: ${actionBroken[1]}` });
      checks.push({ check: actionBroken[0], passed: false, detail: `recommendation ${r.id}: ${actionBroken[1]}` });
      continue;
    }
    const notAdvisedBroken = r.not_advised ? ruleBreak(r.not_advised, rationaleFacts, []) : undefined;
    if (notAdvisedBroken) {
      dropped.push({ claim: r.not_advised ?? "", reason: `${notAdvisedBroken[0]}: not_advised of ${r.id}: ${notAdvisedBroken[1]}` });
      checks.push({ check: notAdvisedBroken[0], passed: false, detail: `not_advised of ${r.id}: ${notAdvisedBroken[1]}` });
    }
    checks.push({ check: "V7", passed: true, detail: `recommendation ${r.id}` });
    const backed = because.some((b) => documented.has(b));
    // Built without the drafted not_advised, so a broken one is left out rather than spread back in.
    const { not_advised: _drafted, ...rest } = r;
    recommendations.push({
      ...rest,
      action: plain(r.action, backed, `the action of ${r.id}`),
      ...(r.not_advised && !notAdvisedBroken ? { not_advised: plain(r.not_advised, backed, `not_advised of ${r.id}`) } : {}),
      because,
      rationale,
    });
  }

  // Summary after the cascade: bullets from the surviving findings; a headline that no longer holds falls back.
  const bullets = findings.flatMap((f) => f.claims.slice(0, 1)).slice(0, 5);
  const surviving = new Set(findings.flatMap((f) => f.claims.flatMap((c) => c.facts)));
  // The headline passes the claim rules over the surviving findings' facts and citations (V1, V4's decline sign).
  const headlineBroken = ruleBreak(
    draft.summary.headline,
    [...surviving],
    findings.flatMap((f) => f.claims.flatMap((c) => c.citations)),
  );
  // A headline that breaks the rules falls back to the first title that kept its own wording (a neutral title only
  // when none did), and the replaced headline is listed like any dropped text.
  const fallback = findings.find((f) => f.title !== NEUTRAL_TITLE)?.title ?? findings[0]?.title ?? "No verified findings for this period.";
  if (headlineBroken)
    dropped.push({ claim: draft.summary.headline, reason: `${headlineBroken[0]}: the headline: ${headlineBroken[1]}; replaced` });
  // Causal words in the headline need a document behind the finding it speaks for: the findings whose facts its
  // placeholders use, the finding whose title it fell back to, or (with neither) the top finding.
  const headlineDraft = headlineBroken ? fallback : draft.summary.headline;
  const usedIds = new Set(placeholders(headlineDraft));
  const about = headlineBroken
    ? findings.filter((f) => f.title === fallback)
    : usedIds.size
      ? findings.filter((f) => f.claims.some((c) => c.facts.some((id) => usedIds.has(id))))
      : findings.slice(0, 1);
  const headlineText = plain(
    headlineDraft,
    about.some((f) => documented.has(f.id)),
    "the headline",
  );
  checks.push({
    check: headlineBroken ? headlineBroken[0] : "V1",
    passed: !headlineBroken,
    detail: headlineBroken ? `headline replaced by a finding's title: ${headlineBroken[1]}` : "headline",
  });

  const verifiedFacts = new Set(v2.filter((r) => r.ok).map((r) => r.fact));
  // References to dropped findings and recommendations go too (assumptions, open questions).
  const live = new Set([...findings.map((f) => f.id), ...recommendations.map((r) => r.id), ...draft.metrics.map((m) => m.id)]);
  const assumptions = draft.assumptions.map((a) => ({ ...a, affects: a.affects.filter((x) => live.has(x)) }));
  const openQuestions = draft.open_questions.map((q) => ({ ...q, would_change: q.would_change.filter((x) => live.has(x)) }));
  const report: Report = {
    ...draft,
    summary: { headline: headlineText, bullets },
    findings,
    recommendations,
    assumptions,
    open_questions: openQuestions,
    facts: draft.facts.map((f) => ({ ...f, verified: verifiedFacts.has(f.id) })),
    verification: {
      numbers_checked: v2.length,
      numbers_mismatched: 0,
      rederived_metrics: rederived.length,
      rederivation_mismatches: 0,
      definition_violations: definitionViolations,
      citations_checked: citationsChecked,
      citations_unsupported: citationsUnsupported,
      claims_dropped: dedupe(dropped),
      claims_downgraded: dedupe(downgraded),
    },
  };
  const integrity = checkReportIntegrity(report);
  if (integrity.length)
    throw new VerifyError("UNVERIFIABLE", `the verified report breaks integrity: ${integrity[0]?.path} ${integrity[0]?.message}`, {
      integrity,
    });
  return { report, checks };
}

/** V3: a total measure of a sum/count (or ratio) metric, recomputed grouped by a dimension and summed in code. */
async function rederive(ctx: VerifyContext, f: Fact): Promise<(Recomputed & { path: string }) | undefined> {
  const def = ctx.defs.find((d) => d.id === f.metric_id);
  const period = new RegExp(`^${f.metric_id}_(.+)$`).exec(f.label)?.[1];
  if (!def || !period) return undefined; // member facts carry a filter in their label: only totals are re-derived
  const q = { from: period, to: period, grain: ctx.grain };
  const grouped = async (d: MetricDef): Promise<number | undefined> => {
    const dim = d.dimensions?.[0];
    if (!dim || !(d.type === "sum" || d.type === "count")) return undefined;
    const rows = await runMetric(ctx.ws, d.id, ctx.defs, ctx.catalog, { ...q, groupBy: [dim] });
    return rows.reduce((a, r) => a + Number(r.value ?? 0), 0);
  };
  if (def.type === "sum" || def.type === "count") {
    const v = await grouped(def);
    if (v === undefined) return undefined;
    return { fact: f.id, stored: f.value, computed: v, ok: same(f.value, v), how: "V3", path: `Σ of ${def.id} by ${def.dimensions?.[0]}` };
  }
  if (def.type === "ratio") {
    const term = (t: unknown) =>
      t && typeof t === "object" && "metric" in t ? ctx.defs.find((d) => d.id === (t as { metric: string }).metric) : undefined;
    const num = term(def.numerator);
    const den = term(def.denominator);
    if (!num || !den) return undefined;
    const [n, d] = [await grouped(num), await grouped(den)];
    if (n === undefined || d === undefined || d === 0) return undefined;
    const v = (n / d) * (def.unit === "percent" ? 100 : 1);
    return { fact: f.id, stored: f.value, computed: v, ok: same(f.value, v), how: "V3", path: `Σ ${num.id} ÷ Σ ${den.id} by dimension` };
  }
  return undefined;
}

/**
 * V5 for facts: the cited rows are rows the fact's metric actually reads for its period (and member), found again
 * with the metric's own row query. Facts whose label can't be re-derived (helper metrics, "(other)") fall back to
 * checking that the rows exist in the cited table.
 */
export async function checkFactRows(
  ws: Workspace,
  facts: readonly Fact[],
  defs: readonly MetricDef[] = [],
  catalog?: Catalog,
  grain: Grain = "month",
): Promise<CheckRow[]> {
  const out: CheckRow[] = [];
  for (const f of facts) {
    const cited = f.citations.filter((c) => c.rows?.length);
    if (!cited.length) continue;
    const m = parseMeasured(f.label);
    const def = m ? defs.find((d) => d.id === m.metric) : undefined;
    if (m && def && catalog && m.where !== null) {
      const allowed = new Map<string, Set<number>>();
      for (const q of compileMetricRows(def.id, defs, catalog, {
        period: m.period,
        grain,
        ...(m.where ? { where: m.where } : {}),
        limit: 10_000_000,
      })) {
        const id = catalog.get(q.table)?.id ?? q.table;
        const rows = (await ws.all<{ _row: number }>(q.rows)).map((r) => r._row);
        allowed.set(id, new Set([...(allowed.get(id) ?? []), ...rows]));
      }
      for (const c of cited) {
        const set = allowed.get(c.source_id);
        const stray = (c.rows ?? []).filter((r) => !set?.has(r));
        out.push({
          check: "V5",
          passed: stray.length === 0,
          fact: f.id,
          detail: stray.length
            ? `rows ${stray.slice(0, 5).join(", ")} of ${c.source_id} are not read by ${def.id} for ${m.period}`
            : `${c.rows?.length} cited row(s) are inputs of ${def.id} for ${m.period}`,
        });
      }
      continue;
    }
    for (const c of cited) {
      if (!/^T\d+$/.test(c.source_id)) continue;
      const n = await ws.one<{ n: number }>(
        sql`SELECT count(*) AS n FROM ${ident(tableName(c.source_id))} WHERE list_contains(${JSON.stringify(c.rows)}::INTEGER[], _row)`,
      );
      const ok = (n?.n ?? 0) === c.rows?.length;
      out.push({
        check: "V5",
        passed: ok,
        fact: f.id,
        detail: ok ? `${c.rows?.length} cited row(s) exist in ${c.source_id}` : `cited rows missing from ${c.source_id}`,
      });
    }
  }
  return out;
}

function dedupe<T>(xs: readonly T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = JSON.stringify(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function persistChecks(ws: Workspace, checks: readonly CheckRow[]): Promise<void> {
  await ws.run(sql`DELETE FROM verification`);
  for (const [i, c] of checks.entries())
    await ws.run(
      // claim_id holds where the claim sits (e.g. "finding F1"); the claim text goes in the detail.
      sql`INSERT INTO verification VALUES (${`V${i + 1}`}, ${c.where ?? null}, ${c.fact ?? null}, ${c.check}, ${c.passed}, ${c.claim ? `${c.detail} — “${c.claim}”` : c.detail})`,
    );
}

/** `revenue_2026-04` or `revenue[customer=Hotel Group LLC]_2026-04` → metric, member filter, period. */
export function parseMeasured(label: string): { metric: string; where: string | undefined | null; period: string } | undefined {
  const m = /^([A-Za-z0-9_]+)(?:\[([^=\]]+)=(.*)\])?_(\d{4}(?:-\d{2}){0,2}|\d{4}-[QW]\d{1,2})$/.exec(label);
  if (!m) return undefined;
  const [, metric, dim, value, period] = m;
  // "(other)" is a NOT IN over the kept members, which the label doesn't carry: not re-derivable (null).
  const where =
    dim === undefined
      ? undefined
      : value === "(other)"
        ? null
        : value === "(none)"
          ? `${dim} IS NULL`
          : `${dim} = '${(value ?? "").replace(/'/g, "''")}'`;
  return { metric: metric as string, where, period: period as string };
}

/**
 * The names a fact label carries from the data (V1's quoted-digits rule): the whole label, member values of
 * `metric[dim=value]_period`, and the member of a decomposition fact `… by dim:kind:value`.
 */
export function dataNames(label: string): string[] {
  return [
    label,
    ...[...label.matchAll(/\[[^=\]]+=([^\]]+)\]/g)].map((m) => m[1] ?? ""),
    ...[...label.matchAll(/ by [^:]+:[a-z_]+:(.+)$/g)].map((m) => m[1] ?? ""),
  ];
}

/** Text inside quotation marks (“…” or "…"). */
export function quotedSpans(text: string): string[] {
  return [...text.matchAll(/“([^”]*)”|"([^"]*)"/g)].map((m) => m[1] ?? m[2] ?? "");
}
