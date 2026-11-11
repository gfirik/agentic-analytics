// The report headline (report-schema §1): one sentence on the most important finding. The planner writes it with
// placeholders from the findings only; small-model mode, or no findings, uses the first finding's title.
import type { ModelClient } from "@agentic-analytics/models";
import { FILE_NOT_READ_KINDS, type Finding, findFreeNumerals, placeholders, type Report } from "@agentic-analytics/schema";
import { sql, type Workspace } from "@agentic-analytics/store";
import { z } from "zod";
import { data, renderPrompt } from "./prompts.ts";
import { withheld } from "./withhold.ts";

const noNumerals = (s: string) => findFreeNumerals(s).length === 0;

/** Why a job read no numbers, or undefined when it read some (agent-and-verifier §6, report-schema §1). */
export type NoNumbersReason = NonNullable<Report["summary"]["no_numbers"]>;

export interface NoNumbersInput {
  /** Facts that came from a metric (they carry a metric id). */
  readonly metricFacts: number;
  readonly tables: number;
  /** Sources registered for the report (tables, documents, emails). */
  readonly sources: number;
  /** Data-quality issues that mean a whole file was not read. */
  readonly filesNotRead: number;
  /** Some table has no date on or before today: every date it holds is in the future (a `future_date` issue says `all_future`). */
  readonly allDatesFuture?: boolean;
}

/** Deterministic: from what the job knows, never from the model. */
export function noNumbersReason(i: NoNumbersInput): NoNumbersReason | undefined {
  if (i.metricFacts > 0) return undefined;
  if (i.tables > 0) return i.allDatesFuture ? "all_dates_future" : "headers_not_recognised";
  return i.sources === 0 && i.filesNotRead > 0 ? "files_rejected" : "no_table";
}

/** The counts `noNumbersReason` needs, read from the job's workspace. */
export async function noNumbersInput(ws: Workspace, facts: Iterable<{ readonly metric_id?: string | undefined }>): Promise<NoNumbersInput> {
  const row = await ws.one<{ tables: number; sources: number; not_read: number; all_future: number }>(
    sql`SELECT (SELECT count(*)::INTEGER FROM sources WHERE kind = 'table') AS tables,
               (SELECT count(*)::INTEGER FROM sources) AS sources,
               (SELECT count(*)::INTEGER FROM quality_issues WHERE list_contains(${JSON.stringify([...FILE_NOT_READ_KINDS])}::VARCHAR[], kind)) AS not_read,
               (SELECT count(*)::INTEGER FROM quality_issues WHERE kind = 'future_date' AND (details->>'all_future') = 'true') AS all_future`,
  );
  return {
    metricFacts: [...facts].filter((f) => f.metric_id).length,
    tables: row?.tables ?? 0,
    sources: row?.sources ?? 0,
    filesNotRead: row?.not_read ?? 0,
    allDatesFuture: (row?.all_future ?? 0) > 0,
  };
}

const NO_NUMBERS_TEXT: Record<NoNumbersReason, string> = {
  files_rejected: "every file was rejected (see Files not read)",
  no_table: "no table was found (add a spreadsheet or CSV with one header row)",
  headers_not_recognised: "no column was recognised as a date and an amount (name them, for example, date and amount)",
  all_dates_future: "no date falls in a whole period before today's date (check the date the job ran as, or the dates)",
};

/** The headline of a job that read no numbers: never "No material changes", which would be a false all-clear. */
export const noNumbersHeadline = (reason: NoNumbersReason, filesNotRead = false): string =>
  `No numbers could be read from these files: ${NO_NUMBERS_TEXT[reason]}${filesNotRead && reason !== "files_rejected" ? "; some files were not read" : ""}.`;

export async function writeHeadline(model: ModelClient, findings: readonly Finding[], small: boolean): Promise<string> {
  const first = findings[0];
  if (!first) return "No material changes were found in this period.";
  if (small) return first.title;
  const allowed = new Set(findings.flatMap((f) => f.claims.flatMap((c) => c.facts)));
  const Headline = z.object({
    headline: z
      .string()
      .min(10)
      .max(240)
      .refine(
        noNumerals,
        "numbers only as {{N…}} placeholders; no other digits except dates (2026-04, March 2026, 2025-Q4; never a bare year)",
      )
      .refine((h) => placeholders(h).every((id) => allowed.has(id)), "use only fact placeholders that appear in the findings"),
  });
  const { object } = await model.generateObject({
    role: "planner",
    schema: Headline,
    system: renderPrompt("summary", {
      // Titles and claims quote members from the data: screened on their way to the planner (withhold.ts).
      findings: data(findings.map((f) => ({ id: f.id, title: withheld(f.title), claims: f.claims.map((c) => withheld(c.text)) }))),
    }),
    prompt: "Write the headline.",
  });
  return object.headline;
}
