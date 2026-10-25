// The confirm step (docs/specs/semantics.md §5, metric-layer §3, interfaces §1): one screen for the drafted metrics and
// the detected column roles, table kinds and business model, and one request that confirms or revises them. Every door
// (HTTP, MCP, CLI, viewer) goes through these two functions, so they all behave the same.
import { join } from "node:path";
import { quarantinedSources } from "@agentic-analytics/agent";
import {
  describeMetric,
  type Grain,
  loadCatalog,
  metricsYaml,
  parseConfirmYaml,
  redraftMetrics,
  validateMetrics,
} from "@agentic-analytics/metrics";
import {
  BUSINESS_MODELS,
  type ProfileSummary,
  ROLES,
  type RoleEdit,
  RoleError,
  reviseSemantics,
  type SemanticsSummary,
} from "@agentic-analytics/profile";
import { ConfirmView, type MetricDef, type RoleEntry, screen } from "@agentic-analytics/schema";
import { sql, Workspace } from "@agentic-analytics/store";
import { JobError } from "./job.ts";
import { CONFIRMED_KEY, currentSemantics, DB, type MetricsOutput, meta, REDRAFT_KEY, setMeta, stageOutput } from "./jobmeta.ts";

/** The definitions the screen shows: the ones drafted again from edited roles, else the first draft. */
async function shownDefs(ws: Workspace, drafted: MetricsOutput): Promise<MetricDef[]> {
  const confirmed = await stageOutput<{ defs?: MetricDef[] }>(ws, "AWAIT_CONFIRM");
  return confirmed?.defs ?? (await meta<MetricDef[]>(ws, REDRAFT_KEY)) ?? drafted.defs;
}

/** A percentage for the screen: the identity's SQL rate, shown to one decimal at most. */
const pct = (rate: number): string => `${Number(rate.toFixed(1))}%`;

const rolesOf = (s: SemanticsSummary) => s.roles;

/**
 * The screen's content. Tables quarantined for text addressed to a model, and columns whose header addresses one, are
 * left out, as they are from the report (security §3): the screen is also what an MCP client's model reads.
 */
export async function buildConfirmView(ws: Workspace): Promise<ConfirmView> {
  const drafted = await stageOutput<MetricsOutput>(ws, "METRICS_DRAFT");
  const profile = await stageOutput<ProfileSummary>(ws, "PROFILE");
  if (!drafted?.defs || !profile) throw new JobError("BAD_METRICS", "metrics are not drafted yet");
  const semantics = await currentSemantics(ws);
  const defs = await shownDefs(ws, drafted);
  const grain = (drafted.range?.grain ?? "month") as Grain;
  const quarantined = new Set(await quarantinedSources(ws));
  const names = new Map(profile.tables.map((t) => [t.table_id, t.name]));
  const stored = new Map(
    (
      await ws.all<{ table_id: string; column_name: string; status: string }>(sql`SELECT table_id, column_name, status FROM profile_roles`)
    ).map((r) => [`${r.table_id}/${r.column_name}`, r.status]),
  );
  const roles: ConfirmView["roles"] = [];
  const none: ConfirmView["columns_without_role"] = [];
  for (const t of semantics ? rolesOf(semantics) : []) {
    if (quarantined.has(t.table_id)) continue;
    const identity = new Map(t.identities.map((i) => [i.fact, i]));
    for (const c of t.columns) {
      if (screen(c.column) || screen(c.label)) continue;
      const table = names.get(t.table_id) ?? t.table_id;
      if (c.role === "none") {
        none.push({ table, column: c.column, label: c.label });
        continue;
      }
      roles.push({
        table,
        table_id: t.table_id,
        column: c.column,
        label: c.label,
        role: c.role,
        status: stored.get(`${t.table_id}/${c.column}`) === "confirmed" ? "confirmed" : "assumed",
        source: c.source,
        evidence: c.evidence.map((e) => {
          const i = e.fact ? identity.get(e.fact) : undefined;
          return i ? `${e.text} on ${pct(i.rate)} of rows` : e.text;
        }),
      });
    }
  }
  const kinds = (semantics?.table_kinds ?? [])
    .filter((k) => !quarantined.has(k.table_id))
    .map((k) => ({ table: names.get(k.table_id) ?? k.table_id, table_id: k.table_id, kind: k.kind, evidence: [...k.evidence] }));
  const model = semantics?.business_model;
  const business_model = {
    model: model?.model ?? "unknown",
    status: model?.status ?? "assumed",
    signals: (model?.signals ?? []).map((s) => {
      // A signal's measurement is an SQL fact, shown from its value (semantics §4).
      const v = s.fact?.value;
      return v === undefined ? s.text : s.text.replace(/\{\{[^}]+\}\}/g, pct(v));
    }),
  };
  const entries: RoleEntry[] = roles.map((r) => ({ table: r.table, column: r.column, role: r.role, status: r.status }));
  return ConfirmView.parse({
    yaml: metricsYaml(defs, {
      grain,
      roles: entries,
      business_model: { model: business_model.model, status: business_model.status },
    }),
    metrics_yaml: metricsYaml(defs, { grain }),
    metrics: defs.map((d) => ({ id: d.id, status: d.status, text: describeMetric(d, defs, grain) })),
    roles,
    columns_without_role: none,
    table_kinds: kinds,
    business_model,
    vocabulary: [...ROLES],
    business_models: [...BUSINESS_MODELS],
  });
}

export interface ConfirmOutcome {
  /** True when the metrics were confirmed and the job may resume; false when only roles were revised. */
  readonly resume: boolean;
  readonly confirmed: number;
  /** Roles whose value the person changed. */
  readonly roles_changed: number;
  /** True when the metrics were drafted again from the changed roles. */
  readonly redrafted: boolean;
}

/**
 * One request from the confirm screen (interfaces §1). Roles posted are confirmed; those not posted stay assumed.
 * With `metrics`, they are confirmed too and the job may resume. Without, only the roles are revised: changed roles
 * re-classify their table and the code's metric drafts are made again, and the job keeps waiting. Nothing is written
 * unless every part of the request is valid.
 */
export async function confirmJob(dir: string, yaml: string): Promise<ConfirmOutcome> {
  const ws = await Workspace.open(join(dir, DB));
  try {
    const st = await ws.one<{ status: string }>(sql`SELECT status FROM job_stages WHERE stage = 'AWAIT_CONFIRM'`);
    if (st?.status !== "running") throw new JobError("BAD_METRICS", "the job is not waiting for metric confirmation");
    let file: ReturnType<typeof parseConfirmYaml>;
    try {
      file = parseConfirmYaml(yaml);
    } catch (err) {
      throw new JobError("BAD_METRICS", `the metrics YAML does not parse: ${err instanceof Error ? err.message : String(err)}`);
    }
    const options = (await meta<{ currency?: string }>(ws, "options")) ?? {};
    const catalog = await loadCatalog(ws);
    const validateOptions = { ...(options.currency ? { defaultCurrency: options.currency } : {}), keepStatus: true };

    let accepted: MetricDef[] | undefined;
    if (file.metrics) {
      const v = validateMetrics(
        file.metrics.map((m) => ({ ...m, status: "confirmed" })),
        catalog,
        validateOptions,
      );
      if (v.rejected.length)
        throw new JobError(
          "BAD_METRICS",
          `rejected: ${v.rejected.map((r) => `${r.id ?? "(no id)"}: ${r.reasons.join("; ")}`).join(" | ")}`,
          v.rejected,
        );
      if (!v.accepted.length) throw new JobError("BAD_METRICS", "no metric definitions given");
      accepted = v.accepted;
    } else if (!file.roles?.length && !file.business_model) {
      throw new JobError("BAD_METRICS", "nothing to confirm: give metrics, roles or a business model");
    }

    const profile = (await stageOutput<ProfileSummary>(ws, "PROFILE")) as ProfileSummary;
    const current = (await currentSemantics(ws)) as SemanticsSummary;
    let rolesChanged = 0;
    let redrafted = false;
    let confirmedRoles = 0;
    if (file.roles?.length || file.business_model) {
      const edits: RoleEdit[] = (file.roles ?? []).map((r) => ({ table: r.table, column: r.column, role: r.role }));
      let revision: Awaited<ReturnType<typeof reviseSemantics>>;
      try {
        revision = await reviseSemantics(ws, profile.tables, current, edits, file.business_model);
      } catch (err) {
        if (err instanceof RoleError) throw new JobError(err.code, err.message);
        throw err;
      }
      await setMeta(ws, "semantics", revision.semantics);
      rolesChanged = revision.changed.length;
      confirmedRoles = revision.confirmed;
      if (!accepted && rolesChanged) {
        const drafted = (await stageOutput<MetricsOutput>(ws, "METRICS_DRAFT")) as MetricsOutput;
        const again = redraftMetrics(
          { ...profile, semantics: revision.semantics },
          catalog,
          {
            source: drafted.source === "model" ? "model" : "fallback",
            ...(drafted.modelProposals ? { proposals: drafted.modelProposals } : {}),
          },
          { ...(options.currency ? { defaultCurrency: options.currency } : {}) },
        );
        await setMeta(ws, REDRAFT_KEY, again.accepted);
        redrafted = true;
      }
    }
    if (accepted) {
      await setMeta(ws, CONFIRMED_KEY, accepted);
      return { resume: true, confirmed: accepted.length, roles_changed: rolesChanged, redrafted };
    }
    return { resume: false, confirmed: confirmedRoles, roles_changed: rolesChanged, redrafted };
  } finally {
    ws.close();
  }
}

/** The library entry point for a job paused at AWAIT_CONFIRM: confirms metrics (and any roles) so the next run continues. */
export async function confirmJobMetrics(dir: string, yaml: string): Promise<{ confirmed: number }> {
  const o = await confirmJob(dir, yaml);
  if (!o.resume) throw new JobError("BAD_METRICS", "no metric definitions given");
  return { confirmed: o.confirmed };
}
