// Job state that more than one file reads: the workspace file name, the key/value meta table, stage outputs, and the
// two things the confirm step can change after PROFILE and METRICS_DRAFT (roles, and the metrics drafted from them).
import type { Grain } from "@agentic-analytics/metrics";
import type { ProfileSummary, SemanticsSummary } from "@agentic-analytics/profile";
import type { MetricDef } from "@agentic-analytics/schema";
import { sql, type Workspace } from "@agentic-analytics/store";

export const DB = "job.duckdb";

export async function meta<T>(ws: Workspace, key: string): Promise<T | undefined> {
  const r = await ws.one<{ value: string }>(sql`SELECT value::VARCHAR AS value FROM job_meta WHERE key = ${key}`);
  return r ? (JSON.parse(r.value) as T) : undefined;
}

export async function setMeta(ws: Workspace, key: string, value: unknown): Promise<void> {
  await ws.run(sql`INSERT OR REPLACE INTO job_meta VALUES (${key}, ${JSON.stringify(value)}::JSON)`);
}

/** A stage's stored output, whatever its status. */
export async function stageOutput<T>(ws: Workspace, stage: string): Promise<T | undefined> {
  const r = await ws.one<{ o: string | null }>(sql`SELECT output::VARCHAR AS o FROM job_stages WHERE stage = ${stage}`);
  return r?.o ? (JSON.parse(r.o) as T) : undefined;
}

export interface MetricsOutput {
  readonly defs: MetricDef[];
  readonly range: { from: string; to: string; grain: Grain };
  readonly periodEnd: string;
  readonly source: string;
  /** The incomplete last month left out of the range, if any. */
  readonly partialPeriod?: string;
  /** The model's proposals when it drafted the metrics: a re-draft after a role change starts from them (no new model call). */
  readonly modelProposals?: readonly unknown[];
}

/** Meta key: the semantics after the person's edits (roles, table kinds, business model). Absent until they edit. */
export const SEMANTICS_KEY = "semantics";
/** Meta key: the metrics drafted again from the edited roles, shown until the person confirms. */
export const REDRAFT_KEY = "redrafted_metrics";
/** Meta key: the definitions the person confirmed. */
export const CONFIRMED_KEY = "confirmed_metrics";

/** Roles, table kinds and the business model as they stand now: the person's edits, else PROFILE's proposals. */
export async function currentSemantics(ws: Workspace): Promise<SemanticsSummary | undefined> {
  return (await meta<SemanticsSummary>(ws, SEMANTICS_KEY)) ?? (await stageOutput<ProfileSummary>(ws, "PROFILE"))?.semantics;
}
