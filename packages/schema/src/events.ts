// Job events: the SSE stream (docs/specs/interfaces.md §1) and the `events` table (ARCHITECTURE §3).
import { z } from "zod";
import { ModelRole } from "./report.ts";
import { STAGES } from "./stages.ts";

export const Stage = z.enum(STAGES);

// seq −1 marks the one event that isn't from the job's log: the server's `failed` when a stream's job vanished
// mid-request (interfaces §1).
const base = { job_id: z.string(), seq: z.number().int().min(-1), at: z.iso.datetime({ offset: true }) };

export const JobEvent = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("stage_started"), stage: Stage }),
  z.object({ ...base, type: z.literal("stage_completed"), stage: Stage, duration_ms: z.number().nonnegative() }),
  z.object({ ...base, type: z.literal("progress"), stage: Stage, pct: z.number().min(0).max(100), message: z.string().optional() }),
  z.object({ ...base, type: z.literal("awaiting_confirmation"), stage: z.literal("AWAIT_CONFIRM") }),
  z.object({ ...base, type: z.literal("warning"), stage: Stage.optional(), code: z.string(), message: z.string() }),
  z.object({
    ...base,
    type: z.literal("model_usage"),
    stage: Stage,
    role: ModelRole,
    provider: z.string(),
    model: z.string(),
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    latency_ms: z.number().nonnegative(),
  }),
  z.object({ ...base, type: z.literal("done"), report_path: z.string().optional() }),
  z.object({ ...base, type: z.literal("failed"), stage: Stage.optional(), error: z.object({ code: z.string(), message: z.string() }) }),
]);

export type Stage = z.infer<typeof Stage>;
export type JobEvent = z.infer<typeof JobEvent>;
