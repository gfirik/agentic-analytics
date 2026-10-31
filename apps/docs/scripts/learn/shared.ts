// What every Learn recorder shares (learn-data.ts): the repo root, the run's fixed date and clock, the typed error, and
// small readers for the workspace's rows.
import { join } from "node:path";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";

export const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
export const TODAY = "2026-07-01";
export const NOW = () => new Date("2026-07-01T09:00:00Z");

export class LearnDataError extends Error {
  readonly code = "LEARN_DATA";
  constructor(message: string) {
    super(`learn data: ${message}`);
    this.name = "LearnDataError";
  }
}

export const need = <T>(v: T | undefined | null, what: string): T => {
  if (v === undefined || v === null) throw new LearnDataError(`${what} not found in the run`);
  return v;
};

export const coffeeFiles = () => Object.entries(coffeeRoasterFiles()).map(([name, bytes]) => ({ name, bytes }));
export const short = (v: unknown, n = 360) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

export type Row = Record<string, unknown>;
export const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
export const num = (v: unknown) => Number(v);
