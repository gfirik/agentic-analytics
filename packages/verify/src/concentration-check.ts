// V2 for the Pareto and concentration facts (agent-and-verifier §7, analysis-library §11). Such a fact is SQL from a fixed
// template that returns a row per member with the statistic as `value`. V2 runs it again, and also recomputes the statistic
// in code from the members' totals (rules `pareto_class`, `top_n_share`, `hhi`), so a bug in the template's window logic
// is a mismatch and the class counts are recomputed from member values by a second path.
import { CONCENTRATION_PARTS, type Member, PARETO_PARTS, type StatPart, statValue } from "@agentic-analytics/analysis";
import type { Fact } from "@agentic-analytics/schema";
import type { Workspace } from "@agentic-analytics/store";

export interface Recheck {
  readonly computed: number;
  readonly ok: boolean;
  readonly how: string;
}

const PARTS: readonly string[] = [...PARETO_PARTS, ...CONCENTRATION_PARTS];
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** The rule a statistic is checked by: the Pareto classes and what the curve leaves out, the top-N shares, or the HHI. */
const ruleOf = (part: StatPart): string => (part === "hhi" ? "hhi" : part.startsWith("top") ? "top_n_share" : "pareto_class");

/** The stat description of a fact, when it is one of these facts (`params.stat`). */
export function statOf(f: Fact): { part: StatPart; a: number; b: number } | undefined {
  const s = f.computation.params?.stat;
  if (typeof s !== "object" || s === null) return undefined;
  const r = s as Record<string, unknown>;
  const [a, b] = [num(r.a_cut), num(r.b_cut)];
  return typeof r.part === "string" && PARTS.includes(r.part) && a !== undefined && b !== undefined
    ? { part: r.part as StatPart, a, b }
    : undefined;
}

export async function recheckStat(
  ws: Workspace,
  f: Fact,
  stat: { part: StatPart; a: number; b: number },
  same: (a: number, b: number) => boolean,
): Promise<Recheck> {
  const params = Object.entries(f.computation.params ?? {})
    .filter(([k]) => /^\$\d+$/.test(k))
    .sort((x, y) => Number(x[0].slice(1)) - Number(y[0].slice(1)))
    .map(([, v]) => v as string | number | boolean | null);
  const rows = await ws.all<{ key: string | null; total: number; value: number | null }>({ text: f.computation.sql ?? "", params });
  const members: Member[] = rows.map((r) => ({ key: r.key, total: Number(r.total) }));
  const rerun = Number(rows[0]?.value ?? 0);
  const computed = statValue(stat.part, members, { a: stat.a, b: stat.b });
  const how = ruleOf(stat.part);
  if (computed === undefined) return { computed: Number.NaN, ok: false, how: `${how}: the statistic is not stated over these members` };
  return { computed, ok: same(f.value, rerun) && same(f.value, computed), how: `${how} (SQL re-run ${rerun}, members recomputed)` };
}
