// Implausibility rules (ingestion spec §5): each finding becomes a quality issue with cell provenance.
import type { NormalizedTable, Workspace } from "@agentic-analytics/store";
import { tableName } from "@agentic-analytics/store";
import { aboveOneRows, farFromMedian, futureDateRows, negativeRows, powerOfTenJumps } from "./profile.sql.ts";
import type { TableProfile } from "./stats.ts";

export interface RuleIssue {
  readonly kind: "unit_error" | "negative_quantity" | "rate_above_100" | "future_date";
  readonly severity: "high" | "medium" | "low";
  readonly message: string;
  readonly table_id: string;
  readonly column: string;
  readonly letter: string;
  readonly row: number;
  readonly details: Record<string, unknown>;
}

const COUNT_NAME = /qty|quantity|count|units|pcs|pieces|orders|кол|шт|количество|soni|dona/i;
const AMOUNT_TYPES = new Set(["integer", "decimal", "currency"]);
const FACTOR = { 1: "10", 2: "100", 3: "1,000" } as const;

export async function runRules(ws: Workspace, t: NormalizedTable, profile: TableProfile, today: string): Promise<RuleIssue[]> {
  const name = tableName(t.id);
  const issues: RuleIssue[] = [];

  for (const c of t.columns) {
    const p = profile.columns.find((x) => x.name === c.name);
    const base = { table_id: t.id, column: c.name, letter: c.letter };

    // Sudden ×10/×100/×1000 jumps suggest a unit or decimal error. A column with many values far from its
    // median is multi-modal (e.g. wholesale orders among retail ones): that is real data, so the rule only
    // runs when at most two values (or 0.5% of rows) sit half a decade or more away from the median.
    const isolated = Math.max(2, 0.005 * profile.detail_rows);
    const median = p?.median;
    if (AMOUNT_TYPES.has(c.type) && median && median > 0 && (p?.non_null ?? 0) >= 4) {
      const far = (await ws.one<{ n: number }>(farFromMedian(name, c.name, median)))?.n ?? 0;
      const hits =
        far <= isolated ? await ws.all<{ _row: number; value: number; k: 1 | 2 | 3 }>(powerOfTenJumps(name, c.name, median)) : [];
      const byK = new Map<number, typeof hits>();
      for (const h of hits) byK.set(h.k, [...(byK.get(h.k) ?? []), h]);
      for (const [k, rows] of byK) {
        if (rows.length > isolated) continue;
        for (const h of rows) {
          issues.push({
            ...base,
            kind: "unit_error",
            severity: "high",
            message: `"${c.label}" row ${h._row} is about ${FACTOR[h.k]}× the column median; likely a unit or decimal-point error`,
            row: h._row,
            details: { value: h.value, median, factor: 10 ** k },
          });
        }
      }
    }
    if (AMOUNT_TYPES.has(c.type) && COUNT_NAME.test(c.label)) {
      for (const r of await ws.all<{ _row: number }>(negativeRows(name, c.name))) {
        issues.push({
          ...base,
          kind: "negative_quantity",
          severity: "medium",
          message: `"${c.label}" is negative at row ${r._row}`,
          row: r._row,
          details: {},
        });
      }
    }
    if (c.type === "percent") {
      for (const r of await ws.all<{ _row: number }>(aboveOneRows(name, c.name))) {
        issues.push({
          ...base,
          kind: "rate_above_100",
          severity: "medium",
          message: `"${c.label}" is above 100% at row ${r._row}`,
          row: r._row,
          details: {},
        });
      }
    }
    if (c.type === "date" || c.type === "datetime") {
      for (const r of await ws.all<{ _row: number }>(futureDateRows(name, c.name, today))) {
        issues.push({
          ...base,
          kind: "future_date",
          severity: "medium",
          message: `"${c.label}" is after ${today} at row ${r._row}`,
          row: r._row,
          details: { today },
        });
      }
    }
  }
  return issues;
}
