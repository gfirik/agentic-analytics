// Answer files of the real-data tier (evals/real/answers/*.yaml): what a correct report on a public dataset must
// show, as checks that read only report.json. Every expected number comes from a DuckDB query over the derived file,
// written next to it in `ground_truth` so anyone can run it again (evals/real/README.md).
import { parse } from "yaml";
import { z } from "zod";

const period = z.string().regex(/^\d{4}-\d{2}$/, "a month, YYYY-MM");

const Check = z.discriminatedUnion("kind", [
  /** The job ran to a report (no stage failed). */
  z.object({ id: z.string(), kind: z.literal("completes"), about: z.string() }),
  /** The verifier found no number mismatch, re-derivation mismatch or definition violation. */
  z.object({ id: z.string(), kind: z.literal("verified"), about: z.string() }),
  /**
   * A data-quality item of this kind about this column (the report names the column in its description); with
   * `count`, the item's row count (the fact behind its placeholder) equals the SQL result.
   */
  z.object({
    id: z.string(),
    kind: z.literal("quality_issue"),
    about: z.string(),
    issue: z.string(),
    column: z.string(),
    count: z.number().int().nonnegative().optional(),
  }),
  /**
   * In each listed year, the month with the highest value of the metric (read from the report's `<metric>_YYYY-MM`
   * facts) is one of `months`; and the facts for `values` equal the independent SQL results within `tolerance`.
   */
  z.object({
    id: z.string(),
    kind: z.literal("seasonal_peak"),
    about: z.string(),
    metric: z.string(),
    years: z.array(z.number().int()).min(1),
    months: z.array(z.number().int().min(1).max(12)).min(1),
    values: z.record(period, z.number()),
    tolerance: z.number().nonnegative(),
  }),
  /** A finding whose subject (code-written first claim) is this metric's change at this month, in this direction. */
  z.object({
    id: z.string(),
    kind: z.literal("finding_at"),
    about: z.string(),
    metric: z.string(),
    period,
    direction: z.enum(["up", "down"]),
  }),
  /** No finding is about this month (e.g. a partial month at the end of the data). */
  z.object({ id: z.string(), kind: z.literal("no_finding_at"), about: z.string(), period }),
  /**
   * A regular seasonal move is not reported as news: no finding on the metric compares a month in `months` with the
   * month just before it (e.g. January against December, when January is below December every year).
   */
  z.object({
    id: z.string(),
    kind: z.literal("seasonal_not_flagged"),
    about: z.string(),
    metric: z.string(),
    months: z.array(z.number().int().min(1).max(12)).min(1),
  }),
]);
export type RealCheck = z.infer<typeof Check>;

export const RealAnswers = z.object({
  dataset: z.string(),
  /** The derived file the engine reads (evals/real/data/<file>). */
  file: z.string(),
  options: z.object({
    today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
  }),
  /** A metrics YAML (next to the answer file) confirmed before the analysis, as a person would in the review. */
  confirmed_metrics: z.string().optional(),
  /** The independent queries behind every expected number (DuckDB over the derived file). */
  ground_truth: z.array(z.object({ id: z.string(), about: z.string(), sql: z.string(), result: z.string() })),
  checks: z.array(Check).min(1),
});
export type RealAnswers = z.infer<typeof RealAnswers>;

export function parseRealAnswers(text: string): RealAnswers {
  return RealAnswers.parse(parse(text));
}
