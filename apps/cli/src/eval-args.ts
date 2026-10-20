// The `aa eval` arguments that shape a nightly run (docs/EVALS.md §3–4), as a pure function so the wiring is tested
// without running a suite: --passes, and the row name and per-role models of `--model configured`.
import { configuredName, EvalRunError } from "@agentic-analytics/eval-runner";
import { canonicalModel } from "@agentic-analytics/models";

type Route = { readonly provider: string; readonly endpoint?: string | undefined; readonly model: string };
type Models = { readonly planner: Route; readonly extractor: Route; readonly judge: Route };

export interface NightlyArgs {
  readonly passes?: number;
  /** The row name of a configured run without --label: its routes (the file keeps the "configured" name). */
  readonly name?: string;
  /** Each role's configured model id, so --passes never carries on a result another model served. */
  readonly roleModels?: Readonly<Record<string, string>>;
}

/** Throws EvalRunError USAGE on a --passes that isn't a whole number ≥ 1. `models` is read only for `--model configured`. */
export function nightlyArgs(
  a: { readonly model: string; readonly label?: string; readonly passes?: string },
  models: () => Models,
): NightlyArgs {
  const passes = a.passes === undefined ? undefined : Number(a.passes);
  if (passes !== undefined && !(Number.isInteger(passes) && passes >= 1))
    throw new EvalRunError("USAGE", `--passes takes a whole number ≥ 1, not "${a.passes}"`);
  const m = a.model === "configured" ? models() : undefined;
  return {
    ...(passes !== undefined ? { passes } : {}),
    ...(m && !a.label ? { name: configuredName(m) } : {}),
    ...(m
      ? {
          roleModels: {
            planner: canonicalModel(m.planner.model),
            extractor: canonicalModel(m.extractor.model),
            judge: canonicalModel(m.judge.model),
          },
        }
      : {}),
  };
}
