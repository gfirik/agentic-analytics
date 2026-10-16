// The live job view's state, folded from job events (interfaces §1 SSE). Pure, so it is tested without a browser.
import type { JobEvent, Stage } from "@agentic-analytics/schema";

export const STAGES: readonly Stage[] = [
  "INGEST",
  "PROFILE",
  "METRICS_DRAFT",
  "AWAIT_CONFIRM",
  "MEASURE",
  "DETECT",
  "DECOMPOSE",
  "INDEX_DOCS",
  "WEB_CONTEXT",
  "EXPLAIN",
  "DECIDE",
  "VERIFY",
  "RENDER",
];

export type StageState = "pending" | "running" | "done" | "waiting" | "failed";

export interface JobView {
  readonly stages: Readonly<Record<Stage, StageState>>;
  readonly message?: string;
  readonly warnings: readonly string[];
  readonly phase: "running" | "awaiting_confirmation" | "done" | "failed";
  readonly error?: string;
}

export function initialView(): JobView {
  return { stages: Object.fromEntries(STAGES.map((s) => [s, "pending"])) as Record<Stage, StageState>, warnings: [], phase: "running" };
}

export function reduce(v: JobView, e: JobEvent): JobView {
  const set = (stage: Stage, state: StageState) => ({ ...v.stages, [stage]: state });
  switch (e.type) {
    case "stage_started":
      return { ...v, stages: set(e.stage, "running"), phase: "running" };
    case "stage_completed":
      return { ...v, stages: set(e.stage, "done") };
    case "progress":
      return e.message ? { ...v, message: e.message } : v;
    case "warning":
      return { ...v, warnings: [...v.warnings, e.message] };
    case "awaiting_confirmation":
      return { ...v, stages: set("AWAIT_CONFIRM", "waiting"), phase: "awaiting_confirmation" };
    case "done": {
      const { message: _, ...rest } = v;
      return { ...rest, phase: "done" };
    }
    case "failed":
      return {
        ...v,
        ...(e.stage ? { stages: set(e.stage, "failed") } : {}),
        phase: "failed",
        error: `${e.error.code}: ${e.error.message}`,
      };
    default:
      return v;
  }
}
