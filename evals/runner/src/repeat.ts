// Repeated-run consistency (docs/specs/accuracy.md §7, analyst-grade §4.3): `aa eval --repeat N` runs each job N times
// with the same model and the response cache off, and measures whether the runs agree on five things. Each measure
// is a deterministic function of the shipped reports; nothing here calls a model or does arithmetic on report numbers.
import type { Finding, Report } from "@agentic-analytics/schema";
import { subjectOf } from "./score.ts";

/** The five agreement measures, in the order analyst-grade §4.3 lists them. */
export const MEASURES = ["numbers", "findings", "driver", "grade", "action"] as const;
export type Measure = (typeof MEASURES)[number];

/** The §4.7 launch bars for consistency over 5 runs: the share of jobs where every run agrees. */
export const CONSISTENCY_BARS: Readonly<Record<Measure, number>> = { numbers: 1, findings: 0.95, driver: 0.95, grade: 0.9, action: 0.9 };

const MEASURE_NAMES: Readonly<Record<Measure, string>> = {
  numbers: "(a) numbers: every fact value identical",
  findings: "(b) findings: the same top-5 findings",
  driver: "(c) driver: the same top driver per finding",
  grade: "(d) cause grade: the same grade per finding",
  action: "(e) action: the same top recommendation scenario",
};

/** What one run of one job said, reduced to what the measures compare. */
export interface JobSnapshot {
  readonly dataset: string;
  /** False when the job failed (no report): it can't agree on anything. */
  readonly completed: boolean;
  /** Fact label → its values in the report, sorted (a label can repeat). Scenario facts are left out (§7). */
  readonly facts: Readonly<Record<string, readonly number[]>>;
  /** The top 5 findings in rank order. */
  readonly findings: readonly { readonly key: string; readonly driver: string; readonly grade: string }[];
  /** The top recommendation's scenario type, or "none". */
  readonly action: string;
}

const GRADES = ["observed", "correlated", "document_supported", "intervention_supported"] as const;
const DERIVED_TEMPLATE = /^I\d+ (\S+) /;

/**
 * A finding's identity across runs: (template, metric, period, member). The template is the one its first claim's
 * insight fact names (`I3 anomaly.v1 revenue 2026-04:…`), else the finding type; metric, period and member are the
 * scorer's subject (the metric by its concept, so `total_revenue` and `revenue` are one metric).
 */
export function findingKey(f: Finding, report: Report): string {
  const labels = new Map(report.facts.map((x) => [x.id, x.label]));
  const template =
    (f.claims[0]?.facts ?? []).map((id) => DERIVED_TEMPLATE.exec(labels.get(id) ?? "")?.[1]).find((t) => t !== undefined) ?? f.type;
  const s = subjectOf(f, report);
  const member = s?.member ? `${s.member.dimension}=${s.member.member}` : "(all)";
  return `${template} · ${s?.metric ?? "?"} · ${s?.period ?? "?"} · ${member}`;
}

/** The finding's cause grade: the highest grade among its claims ("observed" when none states one). */
export function findingGrade(f: Finding): string {
  return GRADES[Math.max(0, ...f.claims.map((c) => GRADES.indexOf(c.causal_grade ?? "observed")))] as string;
}

/** Facts whose value rests on a scenario parameter the model chose (within bounds): action (e) covers those. */
const scenarioFact = (fn: string | undefined) => fn === "scenario_param" || (fn?.startsWith("impact.v1:") ?? false);

/** One run of one job, from its report (undefined: the job failed). */
export function snapshotOf(dataset: string, report: Report | undefined): JobSnapshot {
  if (!report) return { dataset, completed: false, facts: {}, findings: [], action: "none" };
  const facts: Record<string, number[]> = {};
  for (const f of report.facts) {
    if (scenarioFact(f.computation.fn)) continue;
    const values = facts[f.label] ?? [];
    values.push(f.value);
    facts[f.label] = values;
  }
  for (const v of Object.values(facts)) v.sort((a, b) => a - b);
  return {
    dataset,
    completed: true,
    facts,
    findings: report.findings.slice(0, 5).map((f) => ({
      key: findingKey(f, report),
      driver: f.drivers?.[0]?.label.trim() ?? "none",
      grade: findingGrade(f),
    })),
    action: report.recommendations[0]?.impact.method.replace(/^impact\.v1:/, "") ?? "none",
  };
}

/** One disagreement, side by side: what each run said about one item. */
export interface Disagreement {
  readonly dataset: string;
  /** "job" when a run didn't finish the job. */
  readonly measure: Measure | "job";
  /** The fact label, the finding key, or what was compared. */
  readonly item: string;
  /** One cell per run, in run order ("—" where the run has no such item). */
  readonly runs: readonly string[];
}

export interface JobAgreement {
  readonly dataset: string;
  /** Per measure: true when every run agrees; null (n/a) for driver and grade when no finding is in every run's top 5. */
  readonly agree: Readonly<Record<Measure, boolean | null>>;
}

export interface MeasureShare {
  readonly measure: Measure;
  readonly agreeing: number;
  /** Jobs the measure applies to (n/a jobs left out). */
  readonly of: number;
  /** agreeing / of; undefined when no job applies. */
  readonly share?: number;
  readonly bar: number;
  /** undefined when the share is undefined. */
  readonly pass?: boolean;
}

export interface Consistency {
  readonly jobs: readonly JobAgreement[];
  readonly measures: readonly MeasureShare[];
  readonly disagreements: readonly Disagreement[];
}

const same = (xs: readonly string[]) => xs.every((x) => x === xs[0]);

/** Agreement of one job over its runs (snapshots in run order), with its disagreements. */
export function jobAgreement(runs: readonly JobSnapshot[]): { agreement: JobAgreement; disagreements: Disagreement[] } {
  const dataset = runs[0]?.dataset ?? "";
  const out: Disagreement[] = [];
  const row = (measure: Disagreement["measure"], item: string, cells: readonly string[]) =>
    out.push({ dataset, measure, item, runs: cells });
  if (runs.some((r) => !r.completed)) {
    row(
      "job",
      "job finished",
      runs.map((r) => (r.completed ? "yes" : "failed")),
    );
    const no = { numbers: false, findings: false, driver: false, grade: false, action: false };
    return { agreement: { dataset, agree: no }, disagreements: out };
  }
  // (a) A label's values must be the same in every run that has the label; a label only some runs have is a findings
  // difference (b), not a number that changed.
  const labels = [...new Set(runs.flatMap((r) => Object.keys(r.facts)))].sort();
  let numbers = true;
  for (const label of labels) {
    const cells = runs.map((r) => (r.facts[label] ? r.facts[label].join(", ") : "—"));
    const present = cells.filter((c) => c !== "—");
    if (!same(present)) {
      numbers = false;
      row("numbers", label, cells);
    }
  }
  // (b) The same top-5 findings as a multiset of keys (rank order may differ). Each key some run lacks, or has a
  // different number of times, is one row with its ranks per run.
  const keys = [...new Set(runs.flatMap((r) => r.findings.map((f) => f.key)))].sort();
  let findings = true;
  for (const key of keys) {
    const ranks = runs.map((r) => r.findings.flatMap((f, i) => (f.key === key ? [`#${i + 1}`] : [])));
    if (!same(ranks.map((x) => String(x.length)))) {
      findings = false;
      row(
        "findings",
        key,
        ranks.map((x) => x.join(", ") || "—"),
      );
    }
  }
  // (c, d) Per finding in every run's top 5: its top driver and grade, compared in rank order when a key repeats.
  // Keys missing from some run are counted under (b) only; with none in common the measure is n/a for this job.
  const common = keys.filter((k) => runs.every((r) => r.findings.some((f) => f.key === k)));
  const perKey = (k: string, pick: (f: JobSnapshot["findings"][number]) => string) =>
    runs.map((r) =>
      r.findings
        .filter((f) => f.key === k)
        .map(pick)
        .join(" | "),
    );
  let driver: boolean | null = common.length ? true : null;
  let grade: boolean | null = common.length ? true : null;
  for (const k of common) {
    const d = perKey(k, (f) => f.driver);
    if (!same(d)) {
      driver = false;
      row("driver", k, d);
    }
    const g = perKey(k, (f) => f.grade);
    if (!same(g)) {
      grade = false;
      row("grade", k, g);
    }
  }
  // (e) The top recommendation's scenario type.
  const actions = runs.map((r) => r.action);
  const action = same(actions);
  if (!action) row("action", "top recommendation", actions);
  return { agreement: { dataset, agree: { numbers, findings, driver, grade, action } }, disagreements: out };
}

/** The five measures over every job: per job its N snapshots, in run order. The share is of jobs where all runs agree. */
export function consistency(jobs: readonly (readonly JobSnapshot[])[]): Consistency {
  const each = jobs.map(jobAgreement);
  const agreements = each.map((e) => e.agreement);
  const measures = MEASURES.map((measure): MeasureShare => {
    const applies = agreements.filter((a) => a.agree[measure] !== null);
    const agreeing = applies.filter((a) => a.agree[measure] === true).length;
    const share = applies.length ? agreeing / applies.length : undefined;
    const bar = CONSISTENCY_BARS[measure];
    return { measure, agreeing, of: applies.length, ...(share !== undefined ? { share, pass: share >= bar } : {}), bar };
  });
  return { jobs: agreements, measures, disagreements: each.flatMap((e) => e.disagreements) };
}

/** One line per measure, e.g. "(a) numbers: every fact value identical: 3/3 jobs (100.0%, bar 100%)". */
export function measureLines(measures: readonly MeasureShare[]): string[] {
  return measures.map(
    (m) =>
      `${MEASURE_NAMES[m.measure]}: ${m.agreeing}/${m.of} jobs (${m.share === undefined ? "n/a" : `${(m.share * 100).toFixed(1)}%`}, bar ${Math.round(m.bar * 100)}%)`,
  );
}

export interface RepeatRun {
  readonly run: number;
  readonly finished: number;
  readonly of: number;
  /** Provider calls, and how many of them were served from the response cache (0 with the cache off). */
  readonly calls: number;
  readonly cached: number;
}

/** A `--repeat` result: written to `<results dir>/repeat/<date>-<model>[-small]-<suite>-repeat<N>.json`. */
export interface RepeatResult {
  readonly suite: string;
  readonly model: string;
  readonly note?: string;
  readonly date: string;
  readonly repeat: number;
  /** "off": every call live. "n/a": the scripted baseline, which makes no provider calls. */
  readonly cache: "off" | "n/a";
  readonly datasets: readonly string[];
  readonly runs: readonly RepeatRun[];
  readonly measures: readonly MeasureShare[];
  readonly jobs: readonly JobAgreement[];
  readonly disagreements: readonly Disagreement[];
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The disagreements file: the measures, then every disagreement with one column per run, side by side. */
export function repeatMarkdown(r: RepeatResult): string {
  const runCols = r.runs.map((x) => `Run ${x.run}`);
  return `${[
    `# Consistency: ${r.model} · ${r.suite} suite · ${r.repeat} runs · ${r.date}`,
    "",
    ...(r.note ? [r.note, ""] : []),
    `Response cache: ${r.cache === "off" ? "off (every call live)" : "n/a (scripted model, no provider calls)"}. Datasets: ${r.datasets.join(", ")}.`,
    "",
    ...r.runs.map((x) => `- Run ${x.run}: ${x.finished}/${x.of} jobs finished, ${x.calls} provider calls (${x.cached} cached)`),
    "",
    "| Measure | Jobs where every run agrees | Bar (§4.7, over 5 runs) | Pass |",
    "|---|---|---|---|",
    ...r.measures.map(
      (m) =>
        `| ${MEASURE_NAMES[m.measure]} | ${m.agreeing}/${m.of}${m.share === undefined ? " (n/a)" : ` (${(m.share * 100).toFixed(1)}%)`} | ${Math.round(m.bar * 100)}% | ${m.pass === undefined ? "n/a" : m.pass ? "yes" : "**no**"} |`,
    ),
    "",
    "## Disagreements",
    "",
    ...(r.disagreements.length
      ? [
          `| Dataset | Measure | Item | ${runCols.join(" | ")} |`,
          `|---|---|---|${runCols.map(() => "---").join("|")}|`,
          ...r.disagreements.map((d) => `| ${d.dataset} | ${d.measure} | ${cell(d.item)} | ${d.runs.map(cell).join(" | ")} |`),
        ]
      : ["None: every run agreed on every measure."]),
  ].join("\n")}\n`;
}
