// `aa eval --suite roles` (docs/specs/accuracy.md §11, docs/specs/semantics.md §7): profiles each labelled dataset, runs the
// role detector with no model, and scores each column's proposal (before any confirmation) against the hand labels in
// evals/roles/labels.yaml. A proposal is right when it is the label's role or in its `accept` list; a column labelled
// `none` is right when the detector proposes no role. The pooled per-column rate is the A1 figure; the real-only and
// distinct-layout rates print beside it so the 30 generated businesses (two header layouts) can't hide a weak real score.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generatedDatasets } from "@agentic-analytics/eval-generator";
import { type InputFile, ingest } from "@agentic-analytics/ingest";
import { detectRoles, normalizeTable, profileTable, type Role, type TableRoles } from "@agentic-analytics/profile";
import { loadTable, Workspace } from "@agentic-analytics/store";
import { EvalRunError } from "./errors.ts";
import { engineCommit } from "./golden-run.ts";
import { type DatasetTableLabels, expandRoleLabels, loadRoleLabels, type RoleLabels } from "./role-labels.ts";

/** Acceptance A1 (docs/plans/m15.md): the pooled per-column rate. */
export const ROLES_BAR = 95;

export type RolesGroup = "real" | "generated" | "synthetic";

export interface ColumnScore {
  readonly dataset: string;
  readonly entry: string;
  readonly group: RolesGroup;
  readonly table: string;
  readonly header: string;
  readonly label: Role;
  readonly accept: readonly Role[];
  readonly proposed: Role;
  readonly score: number;
  readonly correct: boolean;
  readonly evidence: readonly string[];
}

export interface Rate {
  readonly correct: number;
  readonly total: number;
  /** Percent, or null with nothing to score. */
  readonly rate: number | null;
}

export interface DistinctMiss {
  readonly entry: string;
  readonly header: string;
  readonly label: Role;
  readonly accept: readonly Role[];
  /** Proposals seen, with how many datasets each came from. */
  readonly proposed: Readonly<Record<string, number>>;
  readonly datasets: number;
  readonly wrong: number;
  readonly evidence: readonly string[];
}

export interface RolesResult {
  readonly suite: "roles";
  readonly date: string;
  readonly engine_commit: string;
  /** What was run: everything with labels and data, or the `--only` selection. */
  readonly only?: string;
  readonly model: "none (deterministic detector)";
  readonly pooled: Rate;
  readonly byGroup: Readonly<Record<string, Rate>>;
  /** The real datasets alone (the acceptance's second figure). */
  readonly real: Rate;
  /** Distinct (layout, column) pairs; a pair is right only if right in every dataset that uses it. */
  readonly distinct: Rate;
  readonly bar: number;
  readonly pass: boolean;
  readonly datasets: readonly { readonly dataset: string; readonly group: RolesGroup; readonly correct: number; readonly total: number }[];
  readonly misses: readonly DistinctMiss[];
  /** Labelled datasets whose data is not here (a real file not fetched), each with the command that gets it. */
  readonly skipped: readonly { readonly dataset: string; readonly reason: string }[];
  readonly note: string;
}

export interface RolesArgs {
  readonly resultsDir: string;
  /** A group (`generated`, `real`, `synthetic`) or dataset ids; absent runs every labelled dataset that has data. */
  readonly only?: readonly string[];
  /** evals/real/data in a checkout. */
  readonly dataDir: string;
  /** evals/datasets in a checkout (committed synthetic datasets). */
  readonly datasetsDir?: string;
  readonly labels?: RoleLabels;
  readonly now?: () => Date;
}

const rate = (correct: number, total: number): Rate => ({ correct, total, rate: total ? (correct / total) * 100 : null });
const GROUPS: readonly string[] = ["generated", "real", "synthetic"];

/** Files of a dataset that hold tables (the documents of a generated business are not read here). */
const tabular = (name: string) => /\.(xlsx|xls|csv|tsv)$/i.test(name);

/** The tables of a labelled dataset, keyed the way the labels name them; undefined when its data isn't here. */
async function profiledTables(
  t: DatasetTableLabels,
  a: RolesArgs,
  cache: Map<string, Promise<ProfiledSource | undefined>>,
): Promise<TableRoles | undefined> {
  const key = `${t.group}/${t.dataset}`;
  if (!cache.has(key)) cache.set(key, profileDataset(t, a));
  const src = await cache.get(key);
  return src?.tables.get(t.table);
}

interface ProfiledSource {
  readonly tables: Map<string, TableRoles>;
}

function inputsFor(t: DatasetTableLabels, a: RolesArgs): InputFile[] | undefined {
  if (t.group === "generated") {
    const ds = generatedDatasets().find((d) => d.id === t.dataset);
    if (!ds) throw new EvalRunError("UNKNOWN_DATASET", `labels name the generated dataset ${t.dataset}, which the generator doesn't make`);
    return Object.entries(ds.files)
      .filter(([name]) => tabular(name))
      .map(([name, bytes]) => ({ name, bytes }));
  }
  if (t.group === "real") {
    const file = join(a.dataDir, t.table);
    return existsSync(file) ? [{ name: t.table, bytes: new Uint8Array(readFileSync(file)) }] : undefined;
  }
  const dir = join(a.datasetsDir ?? "", t.dataset, "files");
  if (!a.datasetsDir || !existsSync(dir)) return undefined;
  return readdirSync(dir)
    .filter(tabular)
    .map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(dir, name))) }));
}

async function profileDataset(t: DatasetTableLabels, a: RolesArgs): Promise<ProfiledSource | undefined> {
  const files = inputsFor(t, a);
  if (!files) return undefined;
  const ws = await Workspace.open();
  try {
    const ingested = await ingest(files);
    const files_ = new Map(ingested.files.map((f) => [f.id, f.name]));
    const tables = new Map<string, TableRoles>();
    // The same normalize and profile steps as PROFILE (profileJob), without the implausibility rules and entity
    // matching, which the detector doesn't read: it keeps a 30-dataset run to a few minutes.
    for (const region of ingested.tables) {
      const n = normalizeTable(region, "month");
      await loadTable(ws, n.table);
      const profile = await profileTable(ws, n.table, n.periodColumn);
      const file = files_.get(region.file_id) ?? region.file_id;
      // The labels name a workbook table by its sheet and a CSV by its file ("Orders" for the generator's orders.csv).
      const key = region.sheet ?? (/^orders\.csv$/i.test(file) ? "Orders" : file);
      tables.set(key, await detectRoles(ws, n.table, profile));
    }
    return { tables };
  } finally {
    ws.close();
  }
}

export function scoreTable(t: DatasetTableLabels, roles: TableRoles): ColumnScore[] {
  const byLabel = new Map(roles.columns.map((c) => [c.label, c]));
  return t.columns.map((l) => {
    const got = byLabel.get(l.header);
    if (!got) throw new EvalRunError("BAD_RESULTS", `${t.dataset}/${t.table}: labelled column "${l.header}" was not profiled`);
    const proposed = got.role;
    return {
      dataset: t.dataset,
      entry: t.entry,
      group: t.group,
      table: t.table,
      header: l.header,
      label: l.role,
      accept: l.accept,
      proposed,
      score: got.score,
      correct: proposed === l.role || l.accept.includes(proposed),
      evidence: got.evidence.map((e) => `${e.signal}: ${e.text}`),
    };
  });
}

/** Rates, the distinct-layout pooling and the misses from scored columns (pure, so a fixture can check the arithmetic). */
export function summarizeRoles(
  scores: readonly ColumnScore[],
  skipped: RolesResult["skipped"],
  meta: { readonly date: string; readonly engine_commit: string; readonly only?: string },
): RolesResult {
  const count = (xs: readonly ColumnScore[]) => rate(xs.filter((s) => s.correct).length, xs.length);
  const groups = [...new Set(scores.map((s) => s.group))];
  const byDataset = new Map<string, ColumnScore[]>();
  for (const s of scores) byDataset.set(`${s.group}/${s.dataset}`, [...(byDataset.get(`${s.group}/${s.dataset}`) ?? []), s]);
  const pairs = new Map<string, ColumnScore[]>();
  for (const s of scores) pairs.set(`${s.entry}\u0000${s.header}`, [...(pairs.get(`${s.entry}\u0000${s.header}`) ?? []), s]);
  const misses: DistinctMiss[] = [];
  let distinctOk = 0;
  for (const rows of pairs.values()) {
    const first = rows[0] as ColumnScore;
    const wrong = rows.filter((r) => !r.correct);
    if (!wrong.length) {
      distinctOk++;
      continue;
    }
    const proposed: Record<string, number> = {};
    for (const r of wrong) proposed[r.proposed] = (proposed[r.proposed] ?? 0) + 1;
    misses.push({
      entry: first.entry,
      header: first.header,
      label: first.label,
      accept: first.accept,
      proposed,
      datasets: rows.length,
      wrong: wrong.length,
      evidence: (wrong[0] as ColumnScore).evidence,
    });
  }
  const pooled = count(scores);
  return {
    suite: "roles",
    date: meta.date,
    engine_commit: meta.engine_commit,
    ...(meta.only ? { only: meta.only } : {}),
    model: "none (deterministic detector)",
    pooled,
    byGroup: Object.fromEntries(groups.map((g) => [g, count(scores.filter((s) => s.group === g))])),
    real: count(scores.filter((s) => s.group === "real")),
    distinct: rate(distinctOk, pairs.size),
    bar: ROLES_BAR,
    pass: pooled.rate !== null && pooled.rate >= ROLES_BAR,
    datasets: [...byDataset.entries()].map(([k, rows]) => ({
      dataset: k.split("/")[1] as string,
      group: (rows[0] as ColumnScore).group,
      correct: rows.filter((r) => r.correct).length,
      total: rows.length,
    })),
    misses,
    skipped,
    note: "Labels are agent-reviewed, not maintainer-reviewed (evals/roles/README.md). The detector's proposal before confirmation, with no model.",
  };
}

const pct = (r: Rate) => (r.rate === null ? "n/a" : `${r.rate.toFixed(1)}%`);
const fraction = (r: Rate) => `${r.correct}/${r.total}`;

export function rolesLines(r: RolesResult): string[] {
  const lines = [
    `roles eval${r.only ? ` (only ${r.only})` : ""}: engine ${r.engine_commit.slice(0, 12)}, no model`,
    `  pooled per-column (A1, bar ${r.bar}%): ${pct(r.pooled)} (${fraction(r.pooled)}) ${r.pass ? "PASS" : "FAIL"}`,
    ...Object.entries(r.byGroup).map(([g, x]) => `    ${g}: ${pct(x)} (${fraction(x)})`),
    `  real datasets alone: ${r.real.total ? `${pct(r.real)} (${fraction(r.real)})` : "n/a (no real data fetched: bun run eval:real:fetch)"}${r.real.rate !== null && r.real.rate < ROLES_BAR ? "  BELOW BAR (a known gap)" : ""}`,
    `  distinct (layout, column) pairs: ${pct(r.distinct)} (${fraction(r.distinct)})`,
  ];
  for (const s of r.skipped) lines.push(`  skipped ${s.dataset}: ${s.reason}`);
  if (r.misses.length) {
    lines.push(`  misses (${r.misses.length} distinct column${r.misses.length === 1 ? "" : "s"}):`);
    for (const m of r.misses)
      lines.push(
        `    ${m.entry} / ${m.header}: labelled ${m.label}${m.accept.length ? ` (also ${m.accept.join(", ")})` : ""}, proposed ${Object.entries(
          m.proposed,
        )
          .map(([p, n]) => `${p}${m.datasets > 1 ? ` x${n}/${m.datasets}` : ""}`)
          .join(", ")}`,
      );
  }
  return lines;
}

export async function runRolesSuite(a: RolesArgs, print: (line: string) => void = () => {}): Promise<RolesResult> {
  const labels = a.labels ?? loadRoleLabels();
  const only = a.only?.length ? a.only : undefined;
  if (only) {
    const known = new Set([...GROUPS, ...expandRoleLabels(labels).map((t) => t.dataset)]);
    const unknown = only.filter((o) => !known.has(o));
    if (unknown.length)
      throw new EvalRunError(
        "UNKNOWN_DATASET",
        `--only names ${unknown.join(", ")}: not a group (generated, real, synthetic) or a labelled dataset`,
      );
  }
  const wanted = expandRoleLabels(labels).filter((t) => !only || only.includes(t.group) || only.includes(t.dataset));
  const cache = new Map<string, Promise<ProfiledSource | undefined>>();
  const scores: ColumnScore[] = [];
  const skipped = new Map<string, string>();
  for (const [i, t] of wanted.entries()) {
    const roles = await profiledTables(t, a, cache);
    if (!roles) {
      const known = (await cache.get(`${t.group}/${t.dataset}`)) !== undefined;
      if (known) throw new EvalRunError("BAD_RESULTS", `${t.dataset}: no table "${t.table}" among the profiled tables`);
      skipped.set(
        t.dataset,
        t.group === "real" ? `${t.table} is not in ${a.dataDir} (run bun run eval:real:fetch)` : "its files are not here",
      );
      continue;
    }
    scores.push(...scoreTable(t, roles));
    if ((i + 1) % 10 === 0) print(`  ... ${i + 1}/${wanted.length} tables`);
  }
  const date = (a.now ?? (() => new Date()))().toISOString().slice(0, 10);
  const result = summarizeRoles(
    scores,
    [...skipped.entries()].map(([dataset, reason]) => ({ dataset, reason })),
    { date, engine_commit: engineCommit(), ...(only ? { only: only.join(",") } : {}) },
  );
  for (const l of rolesLines(result)) print(l);
  const dir = join(a.resultsDir, "roles");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${date}-roles${only ? `-${only.join("_").replace(/[^\w.-]+/g, "_")}` : ""}.json`);
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  print(`results: ${file}`);
  return result;
}
