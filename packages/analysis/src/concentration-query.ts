// The facts behind the `concentration` planner tool (agent-and-verifier §3): the fixed Pareto and concentration templates
// for one additive metric and one of its dimensions over a period range. Nothing from the model reaches SQL as text: the
// metric and dimension must be ones the job defines, the periods are validated against the grain, and the metric compiler
// passes them on as parameters.
import type { Catalog, Grain } from "@agentic-analytics/metrics";
import type { Fact, MetricDef } from "@agentic-analytics/schema";
import type { Workspace } from "@agentic-analytics/store";
import { ConcentrationFacts, concentrationColumns, dimensionLabels } from "./concentration-facts.ts";
import { packMetric } from "./concentration-pack.ts";
import { FactBook } from "./factbook.ts";
import { CONCENTRATION_PARTS, PARETO_PARTS, type StatPart } from "./pareto.ts";
import { persistFacts } from "./persist.sql.ts";
import { nextFactNumber, readFacts } from "./slice.ts";
import { calendarYear } from "./windows.ts";

export type ConcentrationErrorCode = "UNKNOWN_METRIC" | "NOT_ADDITIVE" | "UNKNOWN_DIMENSION" | "BAD_PERIOD";

export class ConcentrationError extends Error {
  constructor(
    readonly code: ConcentrationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConcentrationError";
  }
}

/** The shape of a period label at each grain (analysis-library §14); the date itself is checked below. */
const SHAPE: Record<Grain, RegExp> = {
  year: /^\d{4}$/,
  quarter: /^\d{4}-Q[1-4]$/,
  month: /^\d{4}-(0[1-9]|1[0-2])$/,
  week: /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/,
  day: /^\d{4}-\d{2}-\d{2}$/,
};

function checkPeriod(name: string, p: string, range: { from: string; to: string; grain: Grain }): void {
  const bad = (why: string) => new ConcentrationError("BAD_PERIOD", `${name} "${p.slice(0, 20)}" ${why}`);
  if (!SHAPE[range.grain].test(p)) throw bad(`is not a ${range.grain} period like ${range.from}`);
  if (range.grain === "day" && new Date(`${p}T00:00:00Z`).toISOString().slice(0, 10) !== p) throw bad("is not a calendar day");
  if (p < range.from || p > range.to) throw bad(`is outside the job's periods ${range.from} to ${range.to}`);
}

export interface ConcentrationQuery {
  readonly metric: string;
  readonly dimension: string;
  readonly from: string;
  readonly to: string;
  readonly range: { readonly from: string; readonly to: string; readonly grain: Grain };
}

export interface ConcentrationResult {
  readonly metric: string;
  readonly dimension: string;
  readonly from: string;
  readonly to: string;
  /** Every statistic stated over the range, in order, with its fact (new, or stored earlier under the same label). */
  readonly facts: readonly { readonly part: StatPart; readonly fact: Fact }[];
}

/** The label's window part: one period, a whole calendar year, or `<from>_<to>` (analysis-library §14). */
function suffixOf(q: ConcentrationQuery): string {
  if (q.from === q.to) return q.from;
  const year = q.from.slice(0, 4);
  const w = /^\d{4}$/.test(year) ? calendarYear(Number(year), q.range.grain) : undefined;
  return w && w.from === q.from && w.to === q.to ? year : `${q.from}_${q.to}`;
}

export async function concentrationFacts(
  ws: Workspace,
  defs: readonly MetricDef[],
  catalog: Catalog,
  q: ConcentrationQuery,
): Promise<ConcentrationResult> {
  const def = defs.find((d) => d.id === q.metric);
  if (!def) throw new ConcentrationError("UNKNOWN_METRIC", `unknown metric ${q.metric}`);
  if (def.type !== "sum" && def.type !== "count")
    throw new ConcentrationError("NOT_ADDITIVE", `${q.metric} is not additive; member shares of it would not add up`);
  if (!(def.dimensions ?? []).includes(q.dimension))
    throw new ConcentrationError(
      "UNKNOWN_DIMENSION",
      `${q.dimension} is not a dimension of ${q.metric} (${(def.dimensions ?? []).join(", ") || "none"})`,
    );
  checkPeriod("from", q.from, q.range);
  checkPeriod("to", q.to, q.range);
  if (q.from > q.to) throw new ConcentrationError("BAD_PERIOD", `from ${q.from} is after to ${q.to}`);
  const table = catalog.get(def.table ?? "");
  const { labels } = await dimensionLabels(ws, table?.id ?? "", await concentrationColumns(ws, table?.id ?? "", def.dimensions ?? []));
  const label = labels.get(q.dimension) ?? q.dimension;
  // Labels without the metric belong to the pack's metric; another metric names itself (analysis-library §14).
  const dim = packMetric(defs)?.id === def.id ? label : `${label}[${def.id}]`;
  const existing = await readFacts(ws);
  const book = new FactBook(ws, defs, catalog, q.range.grain, new Map(), new Set(defs.map((d) => d.id)), await nextFactNumber(ws));
  book.known(existing);
  const stats = new ConcentrationFacts(ws, book, defs, catalog, q.range.grain, () => dim);
  const byId = new Map([...existing, ...book.facts].map((f) => [f.id, f]));
  const suffix = suffixOf(q);
  const out: { part: StatPart; id: string }[] = [];
  for (const part of [...CONCENTRATION_PARTS, ...PARETO_PARTS]) {
    const ref = { kind: "stat", metric: def.id, dimension: q.dimension, part, from: q.from, to: q.to, suffix } as const;
    if (await stats.has(ref)) out.push({ part, id: await stats.resolve(ref) });
  }
  await persistFacts(ws, book.facts);
  for (const f of book.facts) byId.set(f.id, f);
  return {
    metric: def.id,
    dimension: q.dimension,
    from: q.from,
    to: q.to,
    facts: out.flatMap((o) => {
      const fact = byId.get(o.id);
      return fact ? [{ part: o.part, fact }] : [];
    }),
  };
}
