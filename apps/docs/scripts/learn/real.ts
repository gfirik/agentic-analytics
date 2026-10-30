// The real-data tier (learn-data.ts): seasonality and noise on public data, from the committed baseline results.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RealSuiteResult } from "@agentic-analytics/eval-runner";
import { need, ROOT } from "./shared.ts";

export function realChecks() {
  const dir = join(ROOT, "evals", "results");
  const name = need(
    readdirSync(dir)
      .filter((f) => f.endsWith("-baseline-real.json"))
      .sort()
      .at(-1),
    "a baseline real-data results file",
  );
  const r = JSON.parse(readFileSync(join(dir, name), "utf8")) as RealSuiteResult;
  return {
    file: `evals/results/${name}`,
    checks: r.datasets.flatMap((d) =>
      d.checks
        .filter((c) => ["seasonal_peak", "seasonal_not_flagged", "no_finding_at", "quality_issue"].includes(c.kind))
        .map((c) => ({ dataset: d.dataset, title: d.title, check: c.id, about: c.about, pass: c.pass, detail: c.detail })),
    ),
  };
}
