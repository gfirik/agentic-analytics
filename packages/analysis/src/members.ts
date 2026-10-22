// Member slices shared by MEASURE (runner.ts) and `drill_down` (slice.ts): a metric's series unit, the SQL filter
// for one member or for "every other member", and the decomposition facts a contribution stores. Filters are built
// from a checked dimension name and quoted member values, never from model text (agent-and-verifier §3).
import type { MetricDef } from "@agentic-analytics/schema";
import type { Contribution } from "./decompose.ts";
import { beyondKeys } from "./decompose.ts";
import { factOf } from "./factbook.ts";
import type { Unit } from "./types.ts";

const UNITS: Record<string, Unit> = { currency: "currency", percent: "percent", count: "count", ratio: "ratio", days: "days" };

/** The series unit of a metric ("other" for a unit the analysis has no rules for). */
export const unitOf = (def: MetricDef): Unit => UNITS[def.unit] ?? "other";

const quote = (v: string) => `'${v.replace(/'/g, "''")}'`;

export const memberFilter = (dimension: string, value: string | null): string =>
  value === null ? `${dimension} IS NULL` : `${dimension} = ${quote(value)}`;

export const otherFilter = (dimension: string, kept: readonly (string | null)[]): string => {
  const values = kept.filter((v): v is string => v !== null);
  const notIn = values.length ? `${dimension} NOT IN (${values.map(quote).join(", ")})` : undefined;
  // SQL NOT IN never matches NULL: NULL belongs to "other" only when it isn't one of the kept members.
  if (kept.includes(null)) return notIn ? `${dimension} IS NOT NULL AND ${notIn}` : `${dimension} IS NOT NULL`;
  return notIn ? `(${dimension} IS NULL OR ${notIn})` : `${dimension} IS NULL`;
};

/** A contribution's fact keys: `change:<member>`, `share:<member>`, then the beyond-100% keys (spec §4.1). */
export function contributionFacts(c: Contribution | undefined, scope: ReadonlyMap<string, string>): Record<string, string> {
  const facts: Record<string, string> = {};
  for (const m of c?.contributors ?? []) {
    facts[`change:${m.key}`] = factOf(scope, m.delta.name);
    facts[`share:${m.key}`] = factOf(scope, m.share.name);
  }
  for (const [key, name] of c ? beyondKeys(c) : []) facts[key] = factOf(scope, name);
  return facts;
}
