// The role detector (docs/specs/semantics.md §2): for each column of a profiled table, a ranked list of candidate roles
// with the evidence behind each, and a proposal. It is deterministic and calls no model; an injected tie-break (§2.4)
// is the only way a model can take part, and it can only choose among the code's own candidates.
import { type NormalizedTable, type Sql, tableName, type Workspace } from "@agentic-analytics/store";
import type { TableProfile } from "../stats.ts";
import { type PeriodParts, periodPartCandidate, periodParts } from "./period.ts";
import { dateOrder, lineIdentity, marginIdentity } from "./roles.sql.ts";
import {
  columnCandidates,
  type Evidence,
  isDateType,
  isNumeric,
  PROPOSE_AT,
  type RoleCandidate,
  type RoleColumn,
  rank,
  WEIGHTS,
  withEvidence,
} from "./score.ts";
import { maskSample, type RoleTieBreak, TIE_MARGIN } from "./tiebreak.ts";
import type { Role } from "./vocabulary.ts";

/** An identity holds when at least this share of the non-null rows match (§2.2), over at least `MIN_IDENTITY_ROWS`. */
export const IDENTITY_PERCENT = 95;
export const MIN_IDENTITY_ROWS = 5;
/** Candidates considered per role when pairing columns for an identity. */
const PER_ROLE = 2;

export type IdentityCheck = "gross_line" | "net_line" | "margin" | "dates";

/** One identity's measurement, stored as an SQL fact `role_identity.<check>.<table>` in percent (§2.2). */
export interface RoleIdentity {
  readonly check: IdentityCheck;
  readonly fact: string;
  /** Which column plays which part: `{ quantity, unit_price, amount }`, `{ issue, due }`... */
  readonly columns: Readonly<Record<string, string>>;
  readonly matched: number;
  readonly total: number;
  /** Percent of the non-null rows that match. */
  readonly rate: number;
  readonly holds: boolean;
}

export interface ColumnRoles {
  readonly column: string;
  readonly label: string;
  readonly position: number;
  readonly candidates: readonly RoleCandidate[];
  /** The proposal: the top candidate when its score reaches 0.4, else `none`. */
  readonly role: Role;
  readonly score: number;
  readonly evidence: readonly Evidence[];
  readonly source: "detector" | "model";
}

export interface TableRoles {
  readonly table_id: string;
  readonly columns: readonly ColumnRoles[];
  readonly identities: readonly RoleIdentity[];
  /** Year (and month) integer columns that together are the period of a table with no date column (§2.1). */
  readonly period_parts?: PeriodParts;
}

export interface DetectOptions {
  /** Optional model tie-break (§2.4); absent means the top score wins. */
  readonly tieBreak?: RoleTieBreak;
}

/** Half a minor unit: 0.005 for currencies with two decimals, 0.5 for those with none (§2.2). */
const ZERO_DECIMAL = new Set([
  "JPY",
  "KRW",
  "VND",
  "CLP",
  "ISK",
  "UGX",
  "PYG",
  "RWF",
  "XAF",
  "XOF",
  "XPF",
  "KMF",
  "GNF",
  "DJF",
  "BIF",
  "VUV",
]);
export const halfMinorUnit = (currency?: string): number => (currency && ZERO_DECIMAL.has(currency.toUpperCase()) ? 0.5 : 0.005);

/** Whether `matched` of `total` rows reach the identity share, in integers so 19 of 20 is exactly 95%. */
export const identityHolds = (matched: number, total: number): boolean =>
  total >= MIN_IDENTITY_ROWS && matched * 100 >= IDENTITY_PERCENT * total;

function roleColumns(table: Pick<NormalizedTable, "columns">, profile: TableProfile): RoleColumn[] {
  return profile.columns.map((p, i) => {
    const position = table.columns.findIndex((c) => c.name === p.name);
    return {
      name: p.name,
      label: p.label,
      type: p.type as RoleColumn["type"],
      ...(p.currency ? { currency: p.currency } : {}),
      position: position >= 0 ? position : i,
      rows: profile.detail_rows,
      non_null: p.non_null,
      distinct: p.distinct_count,
      min: p.min_value,
      max: p.max_value,
      top: p.top_values.map((v) => v.value),
    };
  });
}

interface Counts {
  total: number;
  matched: number;
  later?: number;
}

export async function detectRoles(
  ws: Workspace,
  table: Pick<NormalizedTable, "id" | "columns">,
  profile: TableProfile,
  options: DetectOptions = {},
): Promise<TableRoles> {
  const name = tableName(table.id);
  const cols = roleColumns(table, profile);
  const byName = new Map(cols.map((c) => [c.name, c]));
  const cands = new Map<string, RoleCandidate[]>();
  for (const c of cols) {
    let cs = columnCandidates(c);
    // The profile's own date column is the table's transaction date unless a name says otherwise (§2.1 value pattern).
    if (profile.date_column === c.name && isDateType(c.type))
      cs = withEvidence(cs, "transaction_date", { signal: "value", text: "the table's date column", weight: WEIGHTS.residual }, c);
    cands.set(c.name, cs);
  }
  const boosted = new Set<string>();
  const boost = (column: string, role: Role, text: string) => {
    const c = byName.get(column);
    // One identity point per (column, role): several holding pairings are still one piece of evidence.
    if (c && !boosted.has(`${column}/${role}`) && boosted.add(`${column}/${role}`))
      cands.set(column, withEvidence(cands.get(column) ?? [], role, { signal: "identity", text, weight: WEIGHTS.identity }, c));
  };
  const top = (role: Role, min = PROPOSE_AT, exclude: readonly string[] = []): string[] =>
    cols
      .filter((c) => !exclude.includes(c.name))
      .map((c) => ({ c, s: cands.get(c.name)?.find((x) => x.role === role)?.score ?? 0 }))
      .filter((x) => x.s >= min)
      .sort((a, b) => b.s - a.s || a.c.position - b.c.position)
      .slice(0, PER_ROLE)
      .map((x) => x.c.name);

  const parts = periodParts(cols);
  if (parts) {
    for (const [kind, column] of [
      ["year", parts.year],
      ["month", parts.month],
    ] as const) {
      const cand = column ? periodPartCandidate(kind) : undefined;
      if (column && cand) cands.set(column, rank([...(cands.get(column) ?? []), cand]));
    }
  }

  const identities: RoleIdentity[] = [];
  const record = (check: IdentityCheck, columns: Record<string, string>, n: Counts): RoleIdentity => {
    const id: RoleIdentity = {
      check,
      fact: `role_identity.${check}.${table.id}`,
      columns,
      matched: n.matched,
      total: n.total,
      rate: n.total ? (n.matched / n.total) * 100 : 0,
      holds: identityHolds(n.matched, n.total),
    };
    // One fact per check: the best-measured pairing (a holding one first, then the higher rate).
    const i = identities.findIndex((x) => x.check === check);
    if (i < 0) identities.push(id);
    else if (Number(id.holds) > Number(identities[i]?.holds) || (id.holds === identities[i]?.holds && id.rate > (identities[i]?.rate ?? 0)))
      identities[i] = id;
    return id;
  };
  const count = async (q: Sql): Promise<Counts> => {
    const r = await ws.one<{ total: number; matched: number; later?: number }>(q);
    return {
      total: Number(r?.total ?? 0),
      matched: Number(r?.matched ?? 0),
      ...(r?.later !== undefined ? { later: Number(r.later) } : {}),
    };
  };

  // Gross and net line identities: quantity × unit price (− discount) ≈ amount.
  const [qs, ps, as, ds, cs] = [top("quantity"), top("unit_price"), top("amount"), top("discount"), top("unit_cost")];
  for (const q of qs)
    for (const p of ps)
      for (const a of as) {
        if (new Set([q, p, a]).size < 3) continue;
        const half = halfMinorUnit(byName.get(a)?.currency);
        const gross = record("gross_line", { quantity: q, unit_price: p, amount: a }, await count(lineIdentity(name, q, p, a, half)));
        let net: RoleIdentity | undefined;
        for (const d of ds) {
          if ([q, p, a].includes(d)) continue;
          net = record(
            "net_line",
            { quantity: q, unit_price: p, amount: a, discount: d },
            await count(lineIdentity(name, q, p, a, half, d)),
          );
          if (net.holds)
            for (const [col, role] of [
              [q, "quantity"],
              [p, "unit_price"],
              [a, "amount"],
              [d, "discount"],
            ] as const)
              boost(col, role, `net line identity holds on ${net.rate.toFixed(1)}% of rows`);
        }
        if (gross.holds && !net?.holds)
          for (const [col, role] of [
            [q, "quantity"],
            [p, "unit_price"],
            [a, "amount"],
          ] as const)
            boost(col, role, `gross line identity holds on ${gross.rate.toFixed(1)}% of rows`);
        // Margin: a cost candidate plus the same quantity and amount; a column m with a − q × c = m is a margin.
        for (const c of cs) {
          if ([q, p, a].includes(c)) continue;
          const used = [q, p, a, c, ...ds];
          for (const m of cols.filter((x) => isNumeric(x.type) && !used.includes(x.name)).slice(0, 12)) {
            const r = record(
              "margin",
              { quantity: q, unit_cost: c, amount: a, margin: m.name },
              await count(marginIdentity(name, q, c, a, m.name, half)),
            );
            if (r.holds) {
              boost(m.name, "measure", `margin identity holds on ${r.rate.toFixed(1)}% of rows`);
              boost(c, "unit_cost", `margin identity holds on ${r.rate.toFixed(1)}% of rows`);
            }
          }
        }
      }

  // Dates: due on or after issue, on a column that is not a copy of the issue date.
  const dateCols = cols.filter((c) => isDateType(c.type));
  const issues = top("issue_date");
  const dues = top("due_date");
  for (const x of dateCols)
    for (const y of dateCols) {
      if (x.name === y.name) continue;
      if (!issues.includes(x.name) && !dues.includes(y.name)) continue;
      const n = await count(dateOrder(name, x.name, y.name));
      const r = record("dates", { issue: x.name, due: y.name }, n);
      // A column equal to the issue date on every row is a copy, not a due date.
      if (r.holds && (n.later ?? 0) > 0) {
        boost(x.name, "issue_date", `due date is on or after it on ${r.rate.toFixed(1)}% of rows`);
        boost(y.name, "due_date", `on or after "${x.label}" on ${r.rate.toFixed(1)}% of rows`);
      }
    }

  // One transaction date per table: a second date column with a weaker date name is a different date (§2.1).
  const dated = cols
    .map((c) => ({ c, s: cands.get(c.name)?.find((x) => x.role === "transaction_date") }))
    .filter((x): x is { c: RoleColumn; s: RoleCandidate } => x.s !== undefined && x.s.score >= PROPOSE_AT);
  dated.sort((a, b) => b.s.score - a.s.score || a.c.position - b.c.position);
  for (const x of dated.slice(1))
    cands.set(
      x.c.name,
      (cands.get(x.c.name) ?? []).filter((y) => y.role !== "transaction_date"),
    );

  const columns: ColumnRoles[] = [];
  for (const c of cols) {
    const ranked = rank(cands.get(c.name) ?? []);
    let pick = ranked[0];
    let source: ColumnRoles["source"] = "detector";
    const second = ranked[1];
    if (
      options.tieBreak &&
      pick &&
      second &&
      pick.score >= PROPOSE_AT &&
      second.score >= PROPOSE_AT &&
      pick.score - second.score <= TIE_MARGIN
    ) {
      const chosen = await options.tieBreak.choose({
        table_id: table.id,
        column: c.name,
        label: c.label,
        type: c.type,
        samples: c.top.slice(0, 5).map(maskSample),
        candidates: ranked
          .filter((x) => pick && pick.score - x.score <= TIE_MARGIN && x.score >= PROPOSE_AT)
          .map((x) => ({ role: x.role, score: x.score })),
      });
      const hit = ranked.find((x) => x.role === chosen && pick && pick.score - x.score <= TIE_MARGIN && x.score >= PROPOSE_AT);
      // A role the code did not offer is discarded; the top score wins (§2.4).
      if (hit) {
        pick = { ...hit, evidence: [...hit.evidence, { signal: "model", text: "tie broken by model", weight: 0 }] };
        source = "model";
      }
    }
    const proposed = pick && pick.score >= PROPOSE_AT;
    columns.push({
      column: c.name,
      label: c.label,
      position: c.position,
      candidates: ranked,
      role: proposed && pick ? pick.role : "none",
      score: proposed && pick ? pick.score : 0,
      evidence: proposed && pick ? pick.evidence : [],
      source,
    });
  }
  return { table_id: table.id, columns, identities, ...(parts ? { period_parts: parts } : {}) };
}

/** Sorted by position, the proposals as `column → role`. */
export const proposedRoles = (r: TableRoles): Record<string, Role> => Object.fromEntries(r.columns.map((c) => [c.column, c.role]));
