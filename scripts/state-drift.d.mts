// Types for scripts/state-drift.mjs (plain JS so cron runs it with node and no build step).
export interface MovingRow {
  name: string;
  status: string;
  prs: number[];
}
export function movingRows(state: string): MovingRow[];
export function drifted(row: MovingRow, merged: ReadonlySet<number>): boolean;
