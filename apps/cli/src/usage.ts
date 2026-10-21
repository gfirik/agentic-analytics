// `aa usage`: tokens and calls per UTC day, per role and per route, from data/logs/model-calls.jsonl, against each
// route's free-tier daily limit when the route config knows one (docs/specs/models.md §5, "Token usage"). Read-only on the log.
import { readFileSync } from "node:fs";
import {
  type CallRecord,
  type DayUsage,
  dailyUsage,
  parseCallLog,
  type UsageTotals,
  type WindowUsage,
  windowUsage,
} from "@agentic-analytics/models";

export class UsageError extends Error {
  constructor(
    readonly code: "NO_LOG",
    message: string,
  ) {
    super(message);
    this.name = "UsageError";
  }
}

export interface UsageOptions {
  /** UTC date YYYY-MM-DD; all days when absent. */
  readonly day?: string;
  readonly json?: boolean;
  readonly limitOf?: (route: Pick<CallRecord, "provider" | "endpoint" | "model">) => number | undefined;
  /** The end of the rolling window (default: now). */
  readonly now?: Date;
}

const n = (v: number) => v.toLocaleString("en-US");
const plural = (k: number, one: string, many = `${one}s`) => `${n(k)} ${k === 1 ? one : many}`;

/** "1 cached, 1 failed, 1 without a token count", or "" when none apply. */
function extras(t: UsageTotals): string {
  return [
    t.cached ? `${n(t.cached)} cached` : "",
    t.failed ? `${n(t.failed)} failed` : "",
    t.unknownTokens ? `${n(t.unknownTokens)} without a token count` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

/** Left-aligned columns, two spaces apart; the last column is not padded. */
function columns(rows: readonly (readonly string[])[], indent: string): string[] {
  const widths = rows.reduce<number[]>((w, r) => r.map((c, i) => Math.max(w[i] ?? 0, c.length)), []);
  return rows.map((r) => `${indent}${r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i] ?? 0))).join("  ")}`.trimEnd());
}

/** Share of a limit as a percentage with one decimal: formatting of two logged counts, not an analysis number. */
const share = (used: number, limit: number) => `${((used / limit) * 100).toFixed(1)}%`;

export function formatDay(d: DayUsage): string[] {
  const t = d.totals;
  const more = extras(t);
  return [
    `${d.day} (UTC): ${plural(t.calls, "call")}${more ? ` (${more})` : ""}; ${n(t.inputTokens)} tokens in, ${n(t.outputTokens)} out`,
    "  Per role:",
    ...columns(
      d.roles.map((r) => {
        const x = extras(r.totals);
        return [
          r.role,
          plural(r.totals.calls, "call"),
          `${n(r.totals.inputTokens)} in`,
          `${n(r.totals.outputTokens)} out`,
          x ? `(${x})` : "",
        ];
      }),
      "    ",
    ),
    "  Per route (a daily limit counts input + output tokens):",
    ...columns(
      d.routes.map((r) => {
        const used = r.totals.inputTokens + r.totals.outputTokens;
        return [
          r.route,
          plural(r.totals.calls, "call"),
          `${n(used)} tokens`,
          r.dailyLimit === undefined ? "no known limit" : `of ${n(r.dailyLimit)} a day (${share(used, r.dailyLimit)})`,
        ];
      }),
      "    ",
    ),
  ];
}

/** The last 24 hours per route, and the provider's own count when a rate-limit error reported one. */
export function formatWindow(w: WindowUsage): string[] {
  const to = w.until.slice(0, 16).replace("T", " ");
  if (!w.routes.length) return [`Logged in the last ${w.hours} hours (to ${to} UTC): no model calls.`];
  return [
    `Logged in the last ${w.hours} hours (to ${to} UTC):`,
    ...columns(
      w.routes.map((r) => {
        const used = r.totals.inputTokens + r.totals.outputTokens;
        const said = r.reported
          ? `; the provider said ${n(r.reported.used)} of ${n(r.reported.limit)} used at ${r.reported.at.slice(11, 16)} UTC`
          : "";
        return [
          r.route,
          plural(r.totals.calls, "call"),
          `${n(used)} tokens`,
          `${r.dailyLimit === undefined ? "no known limit" : `limit ${n(r.dailyLimit)} a day`}${said}`,
        ];
      }),
      "  ",
    ),
  ];
}

/** The report for a call log's text. */
export function usageReport(text: string, o: UsageOptions = {}): string {
  const log = parseCallLog(text);
  const days = dailyUsage(log.calls, { ...(o.day !== undefined ? { day: o.day } : {}), ...(o.limitOf ? { limitOf: o.limitOf } : {}) });
  // The rolling window answers "what can I still spend now"; with --day the question is about that day only.
  const window =
    o.day === undefined ? windowUsage(log.calls, { now: o.now ?? new Date(), ...(o.limitOf ? { limitOf: o.limitOf } : {}) }) : undefined;
  if (o.json) return `${JSON.stringify({ ...(window ? { window } : {}), days, skippedLines: log.skipped }, null, 2)}\n`;
  const lines = [
    ...(window && days.length ? [...formatWindow(window), ""] : []),
    ...(days.length
      ? days.flatMap((d, i) => [...(i ? [""] : []), ...formatDay(d)])
      : [o.day ? `No model calls on ${o.day} (UTC).` : "No model calls in the log."]),
  ];
  if (log.skipped)
    lines.push(
      "",
      `${plural(log.skipped, "line")} of the log ${log.skipped === 1 ? "is" : "are"} not a call record and ${log.skipped === 1 ? "was" : "were"} skipped.`,
    );
  lines.push(
    "",
    "Cached calls count 0 tokens (they spend no quota). Days are UTC dates. A provider counts its daily limit its own way (Groq's count matched neither a UTC day nor a plain 24-hour sum), so its own figure, from a rate-limit error, is shown when the log has one.",
  );
  return `${lines.join("\n")}\n`;
}

/** Reads the log at `path` (never writes it) and returns the report. */
export function usageCommand(path: string, o: UsageOptions = {}): string {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new UsageError("NO_LOG", `can't read the call log ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return usageReport(text, o);
}
