// The arm A and arm B prompts and answer shapes (docs/specs/accuracy.md §8.3), published with the harness so anyone
// can rerun the ablation (analyst-grade §6.4). Both arms get a strong system prompt: the task, the fixed JSON answer
// shape, "use only the data given, refuse when it can't answer". Scoring reads only the structured fields and the
// numbers in `answer`, never the wording.
import { z } from "zod";
import type { TableInfo } from "./sandbox.ts";

/** The answer to one question (golden items). */
export const QuestionAnswer = z.object({
  /** One or two sentences answering the question, with the number(s) written out. */
  answer: z.string(),
  /** For a "which …" question: the one member (customer, channel, product …) that answers it; null otherwise. */
  member: z.string().nullable().optional(),
  /** True when the data given can't answer the question. */
  refused: z.boolean(),
  /** A limit of the answer (a partial month, a sample), or why it was refused. */
  caveat: z.string().nullable().optional(),
  /** Arm B: the SQL statements, exactly as run, that the answer's numbers come from. */
  sql: z.array(z.string()).optional(),
});
export type QuestionAnswer = z.infer<typeof QuestionAnswer>;

const Change = z.object({
  /** A short snake_case name of the measure: revenue, orders, refund_rate, … */
  metric: z.string(),
  /** The one member the change is about (its column and value), or null for the whole business. */
  member: z.object({ dimension: z.string(), member: z.string() }).nullable().optional(),
  /** The months compared, as YYYY-MM: the earlier one and the one the change is at. */
  before: z.string(),
  period: z.string(),
  direction: z.enum(["up", "down"]),
  /** What drove the change, the biggest first: member values (a customer, a channel, a product). */
  drivers: z.array(z.string()),
  summary: z.string(),
});

/** The answer to "what changed" (the synthetic suite's planted events). */
export const ChangesAnswer = z.object({
  /** The most important real changes, most important first; at most 10. */
  findings: z.array(Change).max(10),
  refused: z.boolean(),
  caveat: z.string().nullable().optional(),
});
export type ChangesAnswer = z.infer<typeof ChangesAnswer>;

const RULES = `Rules:
- Use only the data given. Never use outside knowledge, and never guess a number the data doesn't give.
- When the data can't answer (a column it needs is missing, a period it doesn't cover, a forecast), set "refused" to true and say why in "caveat".
- Write every number you state in digits (36200, -7.5%), not words.
- Reply with the JSON object only, in exactly the shape below. No prose before or after it.`;

const QUESTION_SHAPE = `{"answer": "<one or two sentences with the number(s)>", "member": "<for a 'which' question, the one member that answers it, else null>", "refused": false, "caveat": null}`;
const CHANGES_SHAPE = `{"findings": [{"metric": "revenue", "member": {"dimension": "<column>", "member": "<value>"} or null, "before": "YYYY-MM", "period": "YYYY-MM", "direction": "up" | "down", "drivers": ["<the member that drove it most>", "..."], "summary": "<one sentence>"}], "refused": false, "caveat": null}`;

const CHANGES_TASK = `Task: find the most important real changes in this business's monthly figures (a drop or rise in revenue, orders or a rate, overall or for one customer, channel or product), most important first, at most 5. Leave out normal noise and seasonal swings. For each change give the metric, the member if it is about one, the two months compared, the direction, and the members that drove it.`;

export const ARM_A_SYSTEM = `You are a careful business analyst. You are given a small business's files as text: each spreadsheet table as CSV rows and each document's text. Some tables may be cut to fit; the input says so. Answer the task from these files alone.

${RULES}`;

export const ARM_B_SYSTEM = `You are a careful business analyst with read-only SQL access to a DuckDB database holding a small business's spreadsheet tables. Use the run_sql tool to compute every number you report; never compute in your head. Each call runs one statement and returns at most a few hundred rows, so aggregate in SQL. A statement that fails returns an error; you may fix it and try again, but only twice in the whole task.

Every table has three helper columns: _row (the source row number), _is_total (true on a totals row: leave those out when you add up), and _period (the row's month, YYYY-MM).

${RULES}
- List in "sql" every statement, exactly as you ran it, that your numbers come from.`;

/** The question prompt for arm A: the data text, the cut, then the question and its shape. */
export function armAQuestion(data: string, cut: string, question: string): string {
  return `${data}\n\n${cut}\n\nQuestion: ${question}\n\nAnswer as JSON: ${QUESTION_SHAPE}`;
}

export function armAChanges(data: string, cut: string, period: { from: string; to: string }): string {
  return `${data}\n\n${cut}\n\nThe data covers ${period.from} to ${period.to}.\n${CHANGES_TASK}\n\nAnswer as JSON: ${CHANGES_SHAPE}`;
}

/** The tables arm B can query: names, source, row counts and columns. */
export function schemaText(tables: readonly TableInfo[]): string {
  return tables
    .map(
      (t) =>
        `${t.name} (${t.file}${t.sheet !== undefined ? `#${t.sheet}` : ""}, ${t.rows} rows): ${t.columns
          .map((c) => `${c.name} ${c.type}${c.label !== c.name && !c.name.startsWith("_") ? ` ("${c.label}")` : ""}`)
          .join(", ")}`,
    )
    .join("\n");
}

const B_QUESTION_SHAPE = QUESTION_SHAPE.replace(
  ', "caveat": null}',
  ', "caveat": null, "sql": ["<each statement your numbers come from>"]}',
);

export function armBQuestion(schema: string, documents: readonly string[], question: string): string {
  return `Tables:\n${schema}\n${documentsLine(documents)}\nQuestion: ${question}\n\nAnswer as JSON: ${B_QUESTION_SHAPE}`;
}

export function armBChanges(schema: string, documents: readonly string[], period: { from: string; to: string }): string {
  return `Tables:\n${schema}\n${documentsLine(documents)}\nThe data covers ${period.from} to ${period.to}.\n${CHANGES_TASK}\n\nAnswer as JSON: ${CHANGES_SHAPE}`;
}

/** Arm B is "a typical text-to-SQL analyst": it gets the tables, not the documents' text (analyst-grade §4.5). */
const documentsLine = (documents: readonly string[]) =>
  documents.length ? `(The job also has documents you can't read: ${documents.join(", ")}.)\n` : "";

/** The feedback after a reply that wasn't the JSON answer (one retry of the budget of 2). */
export const fixJson = (error: string) =>
  `That reply was not the JSON answer (${error.slice(0, 300)}). Reply with the JSON object only, in the shape asked for.`;
