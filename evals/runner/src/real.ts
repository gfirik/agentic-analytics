// The real-data tier (evals/real/README.md, docs/EVALS.md §3): runs the engine on public datasets downloaded by
// `bun run eval:real:fetch` and scores each report against its answer file. Checks read only report.json (facts,
// findings, data-quality items, the verification summary); the expected numbers come from SQL written in the
// answer file, never from the engine.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { confirmJobMetrics, type JobOptions, runJob } from "@agentic-analytics/core";
import { parseRealAnswers, REAL_DATASETS, type RealAnswers, type RealCheck, sha256 } from "@agentic-analytics/eval-real";
import type { ModelClient } from "@agentic-analytics/models";
import type { Embedder } from "@agentic-analytics/retrieval";
import { placeholders, type Report } from "@agentic-analytics/schema";
import { EvalRunError } from "./errors.ts";
import { canonicalMetrics, subjectOf } from "./score.ts";

export interface RealCheckResult {
  readonly id: string;
  readonly kind: RealCheck["kind"];
  readonly about: string;
  readonly pass: boolean;
  /** What the report showed, in a few words. */
  readonly detail: string;
}

export interface RealDatasetResult {
  readonly dataset: string;
  readonly title: string;
  readonly publisher: string;
  readonly licence: string;
  readonly citation: string;
  readonly page: string;
  readonly file: string;
  readonly sha256: string;
  /** Your own data (an answer file with a `title`), not one of the public datasets. */
  readonly own?: boolean;
  readonly completed: boolean;
  readonly error?: string;
  readonly seconds: number;
  readonly metrics: readonly string[];
  readonly findings: readonly string[];
  readonly quality: readonly string[];
  readonly checks: readonly RealCheckResult[];
}

export interface RealSuiteResult {
  readonly suite: "real";
  readonly model: string;
  readonly note?: string;
  readonly date: string;
  readonly datasets: readonly RealDatasetResult[];
  readonly seconds: number;
}

const MEASURED = /^([a-z][a-z0-9_]*)(?:\[([^=\]]+)=(.+)\])?_(\d{4}-\d{2})$/;

/** Monthly values of one metric (no member) from the report's measured facts: "2010-11" → value. */
export function monthlyFacts(report: Report, metric: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of report.facts) {
    const m = MEASURED.exec(f.label);
    if (m && m[1] === metric && !m[2]) out.set(m[4] as string, f.value);
  }
  return out;
}

/** Up or down: the change's own measured points in the finding's first claim (after vs before), if it has them. */
function directionOf(report: Report, f: Report["findings"][number], period: string, before: string | undefined): "up" | "down" | undefined {
  if (!before) return undefined;
  const labels = new Map(report.facts.map((x) => [x.id, x]));
  const points = (f.claims[0]?.facts ?? []).flatMap((id) => {
    const fact = labels.get(id);
    const m = fact ? MEASURED.exec(fact.label) : null;
    return fact && m ? [{ period: m[4] as string, value: fact.value }] : [];
  });
  const a = points.find((p) => p.period === period)?.value;
  const b = points.find((p) => p.period === before)?.value;
  if (a === undefined || b === undefined || a === b) return undefined;
  return a > b ? "up" : "down";
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));

/** One check against one report (undefined when the job failed). */
export function scoreCheck(c: RealCheck, report: Report | undefined, error?: string): RealCheckResult {
  const out = (pass: boolean, detail: string): RealCheckResult => ({ id: c.id, kind: c.kind, about: c.about, pass, detail });
  if (!report) return out(false, `no report: ${error ?? "the job failed"}`);
  switch (c.kind) {
    case "completes":
      return out(
        true,
        `report with ${plural(report.findings.length, "finding")}, ${plural(report.data_quality.length, "data-quality item")}`,
      );
    case "verified": {
      const v = report.verification;
      const bad = v.numbers_mismatched + v.rederivation_mismatches + v.definition_violations;
      return out(
        bad === 0,
        `${v.numbers_checked} numbers checked, ${v.numbers_mismatched} mismatched, ${v.rederivation_mismatches} re-derivation mismatches, ${v.definition_violations} definition violations`,
      );
    }
    case "quality_issue": {
      const hit = report.data_quality.find((q) => q.kind === c.issue && q.description.includes(`column “${c.column}”`));
      const kinds = [...new Set(report.data_quality.map((q) => q.kind))].join(", ") || "none";
      if (!hit) return out(false, `not reported (kinds reported: ${kinds})`);
      const rows = `cites rows ${(hit.citations[0]?.rows ?? []).slice(0, 3).join(", ")}…`;
      if (c.count === undefined) return out(true, `${hit.id} ${hit.kind} ${rows}`);
      // The count is the fact behind the item's placeholder, never a number parsed from prose.
      const counted = placeholders(hit.description)
        .map((id) => report.facts.find((f) => f.id === id))
        .find((f) => f?.unit === "count");
      if (!counted) return out(false, `${hit.id} ${hit.kind} states no count (SQL: ${c.count})`);
      return out(counted.value === c.count, `${hit.id} ${hit.kind}: ${counted.value} rows (${counted.id}), SQL ${c.count}; ${rows}`);
    }
    case "seasonal_peak": {
      // The metric by id, or the report metric whose definition means it (a model may call revenue `total_sales`).
      const canonical = canonicalMetrics(report);
      const id = (report.metrics ?? []).map((m) => m.id).find((x) => x === c.metric || canonical.get(x) === c.metric) ?? c.metric;
      const series = monthlyFacts(report, id);
      if (!series.size) return out(false, `no monthly ${c.metric} facts in the report`);
      const peaks: string[] = [];
      let ok = true;
      for (const y of c.years) {
        const year = [...series].filter(([p]) => p.startsWith(`${y}-`));
        if (!year.length) {
          ok = false;
          peaks.push(`${y}: no facts`);
          continue;
        }
        const [p] = year.reduce((a, b) => (b[1] > a[1] ? b : a));
        if (!c.months.includes(Number(p.slice(5, 7)))) ok = false;
        peaks.push(`${y} peak ${p}`);
      }
      const wrong: string[] = [];
      for (const [p, expected] of Object.entries(c.values)) {
        const got = series.get(p);
        if (got === undefined || Math.abs(got - expected) > c.tolerance)
          wrong.push(`${p}: report ${got === undefined ? "none" : fmt(got)} vs SQL ${fmt(expected)}`);
      }
      const matched = Object.keys(c.values).length - wrong.length;
      return out(
        ok && wrong.length === 0,
        `${peaks.join("; ")}; ${matched}/${Object.keys(c.values).length} values equal SQL${wrong.length ? ` (${wrong.join("; ")})` : ""}`,
      );
    }
    case "finding_at": {
      const canonical = canonicalMetrics(report).get(c.metric) ?? c.metric;
      const hit = report.findings.find((f) => {
        const s = subjectOf(f, report);
        return (
          s !== undefined &&
          (s.metric === c.metric || s.metric === canonical) &&
          s.period === c.period &&
          directionOf(report, f, s.period, s.before) === c.direction
        );
      });
      const subjects = report.findings
        .map((f) => subjectOf(f, report))
        .map((s) => (s ? `${s.metric}${s.member ? `[${s.member.member}]` : ""} ${s.before ? `${s.before}→` : ""}${s.period}` : "?"));
      return out(hit !== undefined, hit ? `${hit.id}: ${hit.title}` : `no such finding (findings: ${subjects.join("; ") || "none"})`);
    }
    case "seasonal_not_flagged": {
      const canonical = canonicalMetrics(report).get(c.metric) ?? c.metric;
      const prev = (p: string) => {
        const y = Number(p.slice(0, 4));
        const m = Number(p.slice(5, 7));
        return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
      };
      const hits = report.findings.flatMap((f) => {
        const s = subjectOf(f, report);
        return s &&
          (s.metric === c.metric || s.metric === canonical) &&
          s.before === prev(s.period) &&
          c.months.includes(Number(s.period.slice(5, 7)))
          ? [`${f.id} ${s.before}→${s.period} (${f.method})`]
          : [];
      });
      return out(hits.length === 0, hits.length ? `${hits.length} of ${report.findings.length} findings: ${hits.join(", ")}` : "none");
    }
    case "no_finding_at": {
      const hits = report.findings.filter((f) => subjectOf(f, report)?.period === c.period);
      return out(
        hits.length === 0,
        hits.length ? `${hits.map((f) => `${f.id} (${f.method})`).join(", ")} at ${c.period}` : `no finding at ${c.period}`,
      );
    }
  }
}

export function scoreRealReport(answers: RealAnswers, report: Report | undefined, error?: string): RealCheckResult[] {
  return answers.checks.map((c) => scoreCheck(c, report, error));
}

/** The answer files in `dir`, by dataset id. */
export function loadRealAnswers(dir: string): { answers: RealAnswers; dir: string }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") && !f.endsWith(".metrics.yaml"))
    .sort()
    .map((f) => ({ answers: parseRealAnswers(readFileSync(join(dir, f), "utf8")), dir }));
}

export interface RealRunOptions {
  /** A fresh model client per dataset (scripted models keep state). */
  readonly model: () => ModelClient;
  readonly modelName: string;
  readonly note?: string;
  readonly embedder: Embedder;
  /** Where the fetched files are (evals/real/data). */
  readonly dataDir: string;
  /** Where the answer files are (evals/real/answers). */
  readonly answersDir: string;
  readonly keepReports?: string;
  readonly now?: () => Date;
  readonly onDataset?: (r: RealDatasetResult, i: number, n: number) => void;
}

/** Datasets whose derived file is not in `dataDir` (the tier needs `bun run eval:real:fetch` first). */
export function missingRealData(answersDir: string, dataDir: string): string[] {
  return loadRealAnswers(answersDir)
    .filter(({ answers }) => !existsSync(join(dataDir, answers.file)))
    .map(({ answers }) => answers.dataset);
}

export async function runRealSuite(o: RealRunOptions): Promise<RealSuiteResult> {
  const all = loadRealAnswers(o.answersDir);
  const results: RealDatasetResult[] = [];
  const t0 = Date.now();
  for (const [i, { answers, dir: answersDir }] of all.entries()) {
    const meta = REAL_DATASETS.find((d) => d.id === answers.dataset);
    if (!meta && !answers.title)
      throw new EvalRunError(
        "UNKNOWN_DATASET",
        `answer file for unknown dataset ${answers.dataset} (for your own data, give the answer file a \`title\`)`,
      );
    const dir = mkdtempSync(join(tmpdir(), `aa-real-${answers.dataset}-`));
    const started = Date.now();
    const options: JobOptions = {
      today: answers.options.today,
      ...(answers.options.currency ? { currency: answers.options.currency } : {}),
      ...(answers.confirmed_metrics ? { autoConfirm: false } : {}),
    };
    const bytes = new Uint8Array(readFileSync(join(o.dataDir, answers.file)));
    // A public dataset is described by its manifest; your own data by its answer file, with the file's own checksum.
    const about = meta
      ? {
          title: meta.title,
          publisher: meta.publisher,
          licence: meta.licence.name,
          citation: meta.citation,
          page: meta.page,
          sha256: meta.derived.sha256,
        }
      : { title: answers.title ?? answers.dataset, publisher: "", licence: "", citation: "", page: "", sha256: sha256(bytes), own: true };
    let report: Report | undefined;
    let error: string | undefined;
    try {
      const input = { dir, jobId: answers.dataset, files: [{ name: answers.file, bytes }], options };
      const deps = { model: o.model(), embedder: o.embedder };
      if (answers.confirmed_metrics) {
        // The product's own review flow: the job pauses at AWAIT_CONFIRM, the definitions are confirmed, it resumes.
        await runJob(input, deps).catch((err: unknown) => {
          if (!(err instanceof Error && "code" in err && err.code === "AWAITING_CONFIRMATION")) throw err;
        });
        await confirmJobMetrics(dir, readFileSync(join(answersDir, answers.confirmed_metrics), "utf8"));
        report = (await runJob({ dir }, deps)).report;
      } else {
        report = (await runJob(input, deps)).report;
      }
      if (o.keepReports) {
        mkdirSync(o.keepReports, { recursive: true });
        writeFileSync(join(o.keepReports, `${answers.dataset}.json`), `${JSON.stringify(report, null, 2)}\n`);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const r: RealDatasetResult = {
      dataset: answers.dataset,
      ...about,
      file: answers.file,
      completed: report !== undefined,
      ...(error ? { error } : {}),
      seconds: (Date.now() - started) / 1000,
      metrics: (report?.metrics ?? []).map((m) => m.id),
      findings: (report?.findings ?? []).map((f) => {
        const s = subjectOf(f, report as Report);
        return `${f.type}: ${s ? `${s.metric}${s.member ? `[${s.member.dimension}=${s.member.member}]` : ""} ${s.before ? `${s.before} → ` : ""}${s.period}` : f.title} (${f.method})`;
      }),
      quality: [...new Set((report?.data_quality ?? []).map((q) => q.kind))],
      checks: scoreRealReport(answers, report, error),
    };
    results.push(r);
    o.onDataset?.(r, i, all.length);
  }
  return {
    suite: "real",
    model: o.modelName,
    ...(o.note ? { note: o.note } : {}),
    date: (o.now ?? (() => new Date()))().toISOString().slice(0, 10),
    datasets: results,
    seconds: (Date.now() - t0) / 1000,
  };
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The "Real public data" section of RESULTS.md for one run. */
export function realResultsMarkdown(r: RealSuiteResult): string {
  const own = r.datasets.length > 0 && r.datasets.every((d) => d.own);
  const lines = [`### ${r.model} · ${own ? "your data" : "real public data"} · ${r.date}`, "", ...(r.note ? [r.note, ""] : [])];
  for (const d of r.datasets) {
    const passed = d.checks.filter((c) => c.pass).length;
    lines.push(
      d.own ? `#### ${d.title} (your data)` : `#### ${d.title} (${d.publisher}, ${d.licence})`,
      "",
      `${d.citation ? `${d.citation} ` : ""}File read: \`${d.file}\` (SHA-256 \`${d.sha256.slice(0, 12)}…\`). ${d.completed ? `Completed in ${d.seconds.toFixed(1)} s` : `**Failed**: ${cell(d.error ?? "")}`} · ${passed}/${d.checks.length} checks pass.`,
      "",
      "| Check | Pass | What the report shows |",
      "|---|---|---|",
      ...d.checks.map((c) => `| ${c.id}: ${cell(c.about)} | ${c.pass ? "yes" : "**no**"} | ${cell(c.detail)} |`),
      "",
      `Metrics: ${d.metrics.join(", ") || "none"}. Data-quality kinds: ${d.quality.join(", ") || "none"}. Findings: ${d.findings.map(cell).join("; ") || "none"}.`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}
