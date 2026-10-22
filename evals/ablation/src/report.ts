// The ablation's printed lines and markdown page (docs/specs/accuracy.md §8.5): the measures per arm side by side,
// arm A's cut beside its numbers, and each paired difference with its 95% interval. "The engine adds accuracy" is
// written only where the interval excludes 0; a scripted run is labelled a harness check.
import { type Rate, shareOf } from "./measures.ts";
import type { AblationResult, ArmMeasures } from "./run.ts";

const pct = (r: Rate | undefined) => {
  if (!r) return "—";
  const s = shareOf(r);
  return s === undefined ? `n/a (0 of 0)` : `${(s * 100).toFixed(0)}% (${r.n}/${r.of})`;
};

const unsupported = (m: ArmMeasures, withCells: boolean) => {
  const u = m.unsupported;
  if (!u) return "—";
  const n = withCells ? u.unsupported : u.unsupportedWithoutCells;
  return pct({ n, of: u.numbers });
};

/** The measure rows of the suite: label and value per arm. */
function rows(r: AblationResult): [string, (m: ArmMeasures) => string][] {
  const common: [string, (m: ArmMeasures) => string][] = [
    ["Tokens in / out", (m) => (m.ran ? `${m.inputTokens} / ${m.outputTokens}` : "—")],
    ["Time (s)", (m) => (m.ran ? m.seconds.toFixed(1) : "—")],
  ];
  if (r.suite === "golden")
    return [
      ["Numeric accuracy", (m) => pct(m.numeric)],
      ["Categorical accuracy", (m) => pct(m.categorical)],
      ["Trap pass rate", (m) => pct(m.traps)],
      ["Unsupported-number rate", (m) => unsupported(m, true)],
      ["… without source cells", (m) => unsupported(m, false)],
      ["Citation validity (SQL re-run)", (m) => pct(m.citations)],
      ...common,
    ];
  return [
    ["Planted recall@5 (with driver)", (m) => pct(m.recall5)],
    ["Driver accuracy", (m) => pct(m.driver)],
    ["Distractor FP rate", (m) => pct(m.distractorFp)],
    ...common,
  ];
}

const ARM_NAMES = { A: "A (model alone)", B: "B (model + SQL)", C: "C (the engine)" } as const;

export function ablationMarkdown(r: AblationResult): string {
  const arms = r.measures;
  const out = [
    `# Ablation: ${r.suite}, ${r.model} (${r.date})`,
    "",
    r.scripted
      ? "**Harness check, not an engine-vs-model comparison.** Arms A and B gave canned FakeModel answers built from the answer keys, and arm C ran the scripted planner; the numbers show the harness works, not what a model does."
      : `Arms A, B and C used the same model (${r.model}), the same tasks and the same scoring (docs/specs/accuracy.md §8).`,
    "",
    `Jobs: ${r.jobs.join(", ")}. Context window for arm A: ${r.contextTokens} tokens.`,
    "",
    `| Measure | ${arms.map((m) => ARM_NAMES[m.arm]).join(" | ")} |`,
    `|---|${arms.map(() => "---").join("|")}|`,
    ...rows(r).map(([label, f]) => `| ${label} | ${arms.map(f).join(" | ")} |`),
    "",
  ];
  for (const m of arms) if (m.skipped) out.push(`Arm ${m.arm} did not run: ${m.skipped}.`, "");
  const cuts = arms.flatMap((m) => m.cuts ?? []);
  out.push(
    cuts.length
      ? `**Arm A saw a sample.** ${cuts.join(" ")}`
      : arms.some((m) => m.arm === "A" && m.ran)
        ? "Arm A's input was complete: every row and document fit its context window."
        : "",
    "",
  );
  if (r.suite === "golden" && arms.some((m) => m.unsupported))
    out.push(
      `The unsupported-number support set is the golden answers${r.supportHasFacts ? ", arm C's facts for the same job" : " (arm C did not run, so its facts are not in it)"} and the source cells of the columns each item names; the second row leaves the cells out. It is wider than "the data or the golden set", which favours arms A and B.`,
      "",
    );
  if (r.comparisons.length) {
    out.push("| Paired difference | Tasks | Mean | 95% interval | Adds accuracy? |", "|---|---|---|---|---|");
    for (const c of r.comparisons)
      out.push(
        `| ${c.pair} | ${c.tasks} | ${c.difference.mean.toFixed(3)} | [${c.difference.low.toFixed(3)}, ${c.difference.high.toFixed(3)}] | ${c.adds ? (r.scripted ? "interval above 0, but canned answers: no claim" : "yes (interval above 0)") : "not shown (interval includes 0 or is below)"} |`,
      );
    out.push("", "Bootstrap: 10,000 paired resamples, fixed seed (accuracy.md §5).", "");
  }
  out.push("## Per task", "", "| Arm | Job | Task | Score | Got |", "|---|---|---|---|---|");
  for (const res of r.results)
    for (const t of res.tasks)
      out.push(`| ${res.arm} | ${res.job} | ${t.task} | ${t.score} | ${t.got.replaceAll("|", "\\|").slice(0, 120)} |`);
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

/** The lines printed after a run. */
export function ablationLines(r: AblationResult): string[] {
  const head = `ablation ${r.suite} · ${r.model}${r.scripted ? " (scripted: a harness check, not a model comparison)" : ""} · ${r.jobs.join(", ")}`;
  const arms = r.measures;
  const width = Math.max(...rows(r).map(([l]) => l.length));
  return [
    head,
    `  ${"".padEnd(width)}  ${arms.map((m) => `arm ${m.arm}`.padEnd(18)).join("")}`,
    ...rows(r).map(([label, f]) => `  ${label.padEnd(width)}  ${arms.map((m) => f(m).padEnd(18)).join("")}`),
    ...arms.flatMap((m) => (m.skipped ? [`  arm ${m.arm} skipped: ${m.skipped}`] : [])),
    ...arms.flatMap((m) => (m.cuts ?? []).map((c) => `  arm A cut: ${c}`)),
    ...r.comparisons.map(
      (c) =>
        `  ${c.pair}: mean ${c.difference.mean.toFixed(3)} over ${c.tasks} tasks, 95% [${c.difference.low.toFixed(3)}, ${c.difference.high.toFixed(3)}]${c.adds ? (r.scripted ? " — interval above 0 (canned answers: no claim)" : " — adds accuracy") : ""}`,
    ),
  ];
}
