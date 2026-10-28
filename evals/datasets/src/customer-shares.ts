// customer-shares-v1: five months of order lines for four customers, built so that every Pareto, top-N and HHI figure is a
// short hand computation (docs/specs/analysis-library.md §11; docs/plans/m15.md PR 9). Customer A's share of each month's
// 120 rises from 20% to 90% (the other three split the rest evenly), so the HHI rises every month. A refund line (E, −5) and
// a line with no customer (7) are there to be left out of the curve.

export const SHARES_MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"] as const;

/** Customer A's monthly amount; B, C and D each get (120 − A) ÷ 3. */
export const SHARES_A = [24, 42, 60, 84, 108] as const;
export const SHARES_OTHERS = [32, 26, 20, 12, 4] as const;
/** The Theil–Sen slope of the monthly HHI (a hand computation: the ten pairwise slopes sorted, the middle two averaged). */
export const SHARES_HHI = [3648 / 14400, 3792 / 14400, 4800 / 14400, 7488 / 14400, 11712 / 14400] as const;

export const SHARES_TODAY = "2026-06-03";

/** CSV text of the order lines: Date, Customer, Channel, Amount. Customer A orders on the web, the others in the shop. */
export function customerSharesCsv(): string {
  const rows = ["Date,Customer,Channel,Amount"];
  SHARES_MONTHS.forEach((m, i) => {
    rows.push(`${m}-10,A,web,${SHARES_A[i]}`);
    for (const c of ["B", "C", "D"]) rows.push(`${m}-12,${c},shop,${SHARES_OTHERS[i]}`);
  });
  rows.push("2026-01-20,E,shop,-5", "2026-01-21,,shop,7");
  return `${rows.join("\n")}\n`;
}
