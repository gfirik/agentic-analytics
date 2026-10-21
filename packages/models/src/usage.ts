// Token usage from the call log (docs/specs/models.md §5, "Token usage"): what each day's calls spent, per role and per route,
// against the free tier's daily limit where the route config knows one. Pure functions: the CLI reads the file.
//
// A cached call spends no quota, so it counts 0 tokens whatever its line says (lines written before M14a carry the
// cached answer's original usage). A live call with no token count (most failed calls, lines from before tokens
// were logged) is unknown: it is counted apart, never as 0. Days are UTC dates, as in the log's `at` and in the
// eval result files; Groq's daily quota also resets at 00:00 UTC.
import type { Config } from "@agentic-analytics/schema";
import { ModelError } from "./errors.ts";
import type { CallRecord } from "./fetch.ts";

/** One line of data/logs/model-calls.jsonl. */
export interface LoggedCall extends CallRecord {
  /** ISO timestamp of the call. */
  readonly at: string;
}

export interface CallLog {
  readonly calls: LoggedCall[];
  /** Lines that are not a call record (blank lines aside): a torn last line, a hand edit. */
  readonly skipped: number;
}

export interface Spend {
  readonly input: number;
  readonly output: number;
}

/** The tokens a call spent: 0 when cached, the provider's count when logged, otherwise unknown. */
export function spendOf(c: Pick<CallRecord, "cached" | "inputTokens" | "outputTokens">): Spend | undefined {
  if (c.cached) return { input: 0, output: 0 };
  if (c.inputTokens === undefined && c.outputTokens === undefined) return undefined;
  return { input: c.inputTokens ?? 0, output: c.outputTokens ?? 0 };
}

/** `provider[:endpoint]:model`, the model id as sent (as the eval results name a route). */
export const routeOf = (c: Pick<CallRecord, "provider" | "endpoint" | "model">): string =>
  `${c.provider}${c.endpoint ? `:${c.endpoint}` : ""}:${c.model}`;

export interface UsageTotals {
  readonly calls: number;
  readonly cached: number;
  /** HTTP status ≥ 400, or no response at all (status 0). */
  readonly failed: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Live calls whose line has no token count: their spend is unknown and not in the token sums. */
  readonly unknownTokens: number;
}

export const EMPTY_TOTALS: UsageTotals = { calls: 0, cached: 0, failed: 0, inputTokens: 0, outputTokens: 0, unknownTokens: 0 };

/** A failed call: HTTP status ≥ 400, or no response at all (status 0). One rule for `aa usage` and eval results. */
export const failedCall = (c: Pick<CallRecord, "status">): boolean => c.status >= 400 || c.status === 0;

export function addCall(t: UsageTotals, c: CallRecord): UsageTotals {
  const s = spendOf(c);
  return {
    calls: t.calls + 1,
    cached: t.cached + (c.cached ? 1 : 0),
    failed: t.failed + (failedCall(c) ? 1 : 0),
    inputTokens: t.inputTokens + (s?.input ?? 0),
    outputTokens: t.outputTokens + (s?.output ?? 0),
    unknownTokens: t.unknownTokens + (s ? 0 : 1),
  };
}

export const sumCalls = (calls: readonly CallRecord[]): UsageTotals => calls.reduce(addCall, EMPTY_TOTALS);

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const str = (v: unknown): v is string => typeof v === "string";

/** One call record from a parsed line, or undefined when the line is not one. Unknown extra fields are dropped. */
function callOf(v: unknown): LoggedCall | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const r = v as Record<string, unknown>;
  const { at, provider, model, status, cached, ms } = r;
  if (
    !str(at) ||
    Number.isNaN(Date.parse(at)) ||
    !str(provider) ||
    !str(model) ||
    typeof status !== "number" ||
    typeof cached !== "boolean"
  )
    return undefined;
  return {
    at,
    ...(str(r.role) ? { role: r.role } : {}),
    provider,
    ...(str(r.endpoint) ? { endpoint: r.endpoint } : {}),
    model,
    status,
    cached,
    ms: typeof ms === "number" ? ms : 0,
    ...(isCount(r.inputTokens) ? { inputTokens: r.inputTokens } : {}),
    ...(isCount(r.outputTokens) ? { outputTokens: r.outputTokens } : {}),
    ...(str(r.error) ? { error: r.error } : {}),
  };
}

/** Parses the JSONL call log. Lines that aren't call records are counted, not fatal: logging is append-only. */
export function parseCallLog(text: string): CallLog {
  const calls: LoggedCall[] = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    const c = callOf(parsed);
    if (c) calls.push(c);
    else skipped++;
  }
  return { calls, skipped };
}

/** The UTC date (YYYY-MM-DD) of a call. */
export const dayOf = (at: string): string => new Date(at).toISOString().slice(0, 10);

/**
 * The free tier's daily token limit of a route, from the route config (`daily_token_limits` of an openai-compatible
 * endpoint, models §4). Undefined when none is known: a local Ollama has none.
 */
export function dailyTokenLimit(
  config: Pick<Config, "providers">,
  route: Pick<CallRecord, "provider" | "endpoint" | "model">,
): number | undefined {
  if (route.provider !== "openai-compatible" || !route.endpoint) return undefined;
  return config.providers["openai-compatible"]?.[route.endpoint]?.daily_token_limits?.[route.model];
}

export interface RoleUsage {
  readonly role: string;
  readonly totals: UsageTotals;
}

export interface RouteUsage {
  readonly route: string;
  readonly totals: UsageTotals;
  /** Tokens a day (input + output) the free tier allows on this route; absent when not known. */
  readonly dailyLimit?: number;
}

export interface DayUsage {
  /** UTC date. */
  readonly day: string;
  readonly totals: UsageTotals;
  readonly roles: RoleUsage[];
  readonly routes: RouteUsage[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Usage per UTC day, newest first, each with its roles and routes (sorted by name). `day` keeps that one day (an
 * empty list when it has no calls). The limit of a route is the provider's quota on that model: it counts every
 * role the route served, so it is shown per route, not per role.
 */
/** A real calendar date: `Date.parse` rolls "2026-02-30" over to March 2 instead of refusing it. */
const realDay = (d: string) => {
  const t = Date.parse(d);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
};

export function dailyUsage(
  calls: readonly LoggedCall[],
  o: { readonly day?: string; readonly limitOf?: (route: Pick<CallRecord, "provider" | "endpoint" | "model">) => number | undefined } = {},
): DayUsage[] {
  if (o.day !== undefined && (!DAY.test(o.day) || !realDay(o.day)))
    throw new ModelError("INVALID_ARGUMENT", `invalid day "${o.day}"; expected YYYY-MM-DD`);
  const days = new Map<string, LoggedCall[]>();
  for (const c of calls) {
    const d = dayOf(c.at);
    if (o.day !== undefined && d !== o.day) continue;
    days.set(d, [...(days.get(d) ?? []), c]);
  }
  return [...days.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, cs]) => {
      const roles = new Map<string, UsageTotals>();
      const routes = new Map<string, { totals: UsageTotals; limit: number | undefined }>();
      for (const c of cs) {
        const role = c.role ?? "?";
        roles.set(role, addCall(roles.get(role) ?? EMPTY_TOTALS, c));
        const key = routeOf(c);
        const prev = routes.get(key);
        routes.set(key, { totals: addCall(prev?.totals ?? EMPTY_TOTALS, c), limit: prev ? prev.limit : o.limitOf?.(c) });
      }
      return {
        day,
        totals: sumCalls(cs),
        roles: [...roles.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([role, totals]) => ({ role, totals })),
        routes: [...routes.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([route, u]) => ({ route, totals: u.totals, ...(u.limit !== undefined ? { dailyLimit: u.limit } : {}) })),
      };
    });
}

/** What the provider itself said it had counted, from a rate-limit error's text ("Limit 200000, Used 198464"). */
export interface ReportedUse {
  readonly at: string;
  readonly limit: number;
  readonly used: number;
}

const REPORTED = /Limit (\d+), Used (\d+)/;

export interface WindowUsage {
  /** The window's end (ISO time) and length. */
  readonly until: string;
  readonly hours: number;
  readonly routes: (RouteUsage & { readonly reported?: ReportedUse })[];
}

/**
 * Usage per route logged in the `hours` before `now`, with the provider's own latest count in that window when a
 * rate-limit error reported one. Neither a UTC day nor a plain 24-hour sum is the provider's count: on 2026-10-21 at
 * 10:46 UTC Groq reported 198,464 of 200,000 used, while that UTC day held 101,361 and the 24 hours before held 286,219
 * (it had let them all through); on 2026-10-17 its count matched the 24-hour sum. So the reported figure is shown as
 * it was said, and no remainder is estimated.
 */
export function windowUsage(
  calls: readonly LoggedCall[],
  o: {
    readonly now: Date;
    readonly hours?: number;
    readonly limitOf?: (route: Pick<CallRecord, "provider" | "endpoint" | "model">) => number | undefined;
  },
): WindowUsage {
  const hours = o.hours ?? 24;
  const end = o.now.getTime();
  const start = end - hours * 3_600_000;
  const routes = new Map<string, { totals: UsageTotals; limit: number | undefined; reported?: ReportedUse }>();
  for (const c of calls) {
    const t = Date.parse(c.at);
    if (t <= start || t > end) continue;
    const key = routeOf(c);
    const prev = routes.get(key);
    const m = c.error ? REPORTED.exec(c.error) : null;
    const said = m ? { at: c.at, limit: Number(m[1]), used: Number(m[2]) } : undefined;
    const reported = said && (!prev?.reported || said.at >= prev.reported.at) ? said : prev?.reported;
    routes.set(key, {
      totals: addCall(prev?.totals ?? EMPTY_TOTALS, c),
      limit: prev ? prev.limit : o.limitOf?.(c),
      ...(reported ? { reported } : {}),
    });
  }
  return {
    until: o.now.toISOString(),
    hours,
    routes: [...routes.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([route, u]) => ({
        route,
        totals: u.totals,
        ...(u.limit !== undefined ? { dailyLimit: u.limit } : {}),
        ...(u.reported ? { reported: u.reported } : {}),
      })),
  };
}
