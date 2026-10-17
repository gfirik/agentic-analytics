// Confirmation (docs/specs/metric-layer.md §3): each drafted metric is shown in plain words and accepted,
// edited or dropped. `--yes` (or no interactive IO) keeps every definition as `assumed`. Edits are validated
// like any proposal, and a final pass re-validates the set so a dropped metric takes its dependents with it.
import type { MetricDef } from "@agentic-analytics/schema";
import { parse, stringify } from "yaml";
import type { Catalog } from "./catalog.ts";
import { describeMetric } from "./describe.ts";
import { type ValidateOptions, validateMetrics } from "./validate.ts";

export type ReviewChoice = "accept" | "edit" | "drop";

export interface ReviewIO {
  show(line: string): void;
  choose(question: string, choices: readonly ReviewChoice[]): Promise<ReviewChoice>;
  /** Returns the edited YAML for one metric. */
  edit(yaml: string): Promise<string>;
}

export interface ReviewResult {
  readonly metrics: MetricDef[];
  readonly dropped: { readonly id: string; readonly reason: string }[];
}

export interface ReviewOptions extends ValidateOptions {
  readonly yes?: boolean;
  readonly grain?: string;
  readonly maxEditAttempts?: number;
}

const forEdit = (def: MetricDef) => {
  const { status: _status, ...rest } = def;
  return stringify(rest);
};

export async function reviewMetrics(
  drafts: readonly MetricDef[],
  catalog: Catalog,
  io: ReviewIO | undefined,
  options: ReviewOptions = {},
): Promise<ReviewResult> {
  const dropped: ReviewResult["dropped"] = [];
  if (options.yes || !io) {
    // `--yes` accepts new drafts as assumptions; definitions the user already confirmed (a saved file) stay confirmed.
    return { metrics: drafts.map((d) => ({ ...d, status: d.status === "confirmed" ? "confirmed" : "assumed" })), dropped };
  }
  const kept: MetricDef[] = [];
  for (const draft of drafts) {
    io.show(describeMetric(draft, drafts, options.grain));
    let current: MetricDef | undefined = draft;
    for (let attempt = 0; current; attempt++) {
      const choice = await io.choose(`${current.id}: accept, edit or drop?`, ["accept", "edit", "drop"]);
      if (choice === "accept") {
        kept.push({ ...current, status: "confirmed" });
        break;
      }
      if (choice === "drop") {
        dropped.push({ id: current.id, reason: "dropped by the user" });
        break;
      }
      if (attempt >= (options.maxEditAttempts ?? 3)) {
        io.show(`Keeping ${current.id} as drafted (assumed) after ${attempt} edits.`);
        kept.push({ ...current, status: "assumed" });
        break;
      }
      // Read outside the try: only a parse error is "not valid YAML". An input failure (the terminal's input ended)
      // propagates to the caller instead of being reported as a bad edit.
      const text = await io.edit(forEdit(current));
      let edited: unknown;
      try {
        edited = parse(text);
      } catch (err) {
        io.show(`That isn't valid YAML: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
        continue;
      }
      const v = validateMetrics([...kept, edited], catalog, options);
      const editedId = (edited as { id?: unknown })?.id;
      const ok = v.accepted.find((m) => m.id === editedId);
      if (!ok) {
        io.show(`Not accepted: ${(v.rejected.find((r) => r.id === editedId)?.reasons ?? ["invalid metric"]).join("; ")}`);
        continue;
      }
      current = ok;
      io.show(describeMetric(current, [...kept, current], options.grain));
    }
  }
  // Re-validate the final set: a ratio or derived metric whose input was dropped can't stand.
  const final = validateMetrics(kept, catalog, options);
  for (const r of final.rejected) dropped.push({ id: r.id ?? "?", reason: r.reasons.join("; ") });
  const status = new Map(kept.map((m) => [m.id, m.status]));
  return { metrics: final.accepted.map((m) => ({ ...m, status: status.get(m.id) ?? "assumed" })), dropped };
}
