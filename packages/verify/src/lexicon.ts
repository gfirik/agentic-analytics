// V4's lexicon rule (agent-and-verifier §7): a claim that names metrics, none of which its facts are measured from, is a
// violation. Derived facts are followed back to the measured metric by the caller; a margin fact stays a margin.
import type { MetricDef } from "@agentic-analytics/schema";

/** The metrics (by label or id) a claim's text names. */
export function namedMetrics(text: string, defs: readonly MetricDef[]): MetricDef[] {
  return defs.filter((d) =>
    [d.label, d.id].some((n) =>
      new RegExp(`(?<![\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/_/g, "[ _]")}(?![\\p{L}])`, "iu").test(text),
    ),
  );
}

/** The reason when the text names metrics and none of them is one the facts are measured from (`from`, metric ids), else undefined. */
export function lexiconProblem(text: string, defs: readonly MetricDef[], from: ReadonlySet<string>): string | undefined {
  const named = namedMetrics(text, defs);
  const labelOf = (id: string) => defs.find((d) => d.id === id)?.label ?? id;
  const mislabelled =
    named.length > 0 &&
    from.size > 0 &&
    !named.some((n) => from.has(n.id) || [...from].some((m) => labelOf(m).toLowerCase().includes(n.label.toLowerCase())));
  return mislabelled
    ? `the claim names ${named.map((n) => n.label).join(", ")} but its facts measure ${[...from].map(labelOf).join(", ")}`
    : undefined;
}
