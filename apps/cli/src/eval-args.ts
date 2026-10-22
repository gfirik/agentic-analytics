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

export interface RepeatArgs {
  /** `--repeat N`: the run count, absent for a single run. */
  readonly repeat?: number;
  /** The response cache is off: `--no-cache`, or implied by `--repeat` (docs/specs/accuracy.md §7). */
  readonly cacheOff: boolean;
}

/**
 * `aa eval --repeat N` and `--no-cache` (docs/specs/accuracy.md §7). `--repeat` takes a whole number ≥ 2, goes with
 * --suite smoke|full|heldout (alone or with --models), never with --passes (N whole runs in one go, not one run carried over
 * nights), and turns the response cache off: a repeat measures the model, and a cached run 2 would only replay run 1.
 * Throws EvalRunError USAGE on a refused combination.
 */
export function repeatArgs(a: {
  readonly repeat?: string;
  readonly noCache?: boolean;
  readonly suite?: string;
  readonly passes?: string;
}): RepeatArgs {
  if (a.repeat === undefined) return { cacheOff: a.noCache === true };
  const n = Number(a.repeat);
  if (!/^\d+$/.test(a.repeat) || !(Number.isInteger(n) && n >= 2))
    throw new EvalRunError("USAGE", `--repeat takes a whole number ≥ 2, not "${a.repeat}"`);
  // The generated-data suites repeat; the real tier and the golden sets have their own runners (an unknown suite
  // name is refused where the command picks the suite).
  if (a.suite === "real" || a.suite === "golden")
    throw new EvalRunError("USAGE", `--repeat runs --suite smoke, full or heldout, not ${a.suite}`);
  if (a.passes !== undefined)
    throw new EvalRunError("USAGE", "--repeat runs N whole runs in one go: drop --passes (a run carried over nights can't be repeated)");
  return { repeat: n, cacheOff: true };
}
