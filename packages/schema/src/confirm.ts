// What the confirm screen shows (interfaces §1 `GET /v1/jobs/{id}/metrics`, semantics §5): the drafted metrics in plain
// words, and the column roles with their evidence, the table kinds and the business model, on one screen. The same
// shape serves the HTTP API, the CLI, MCP and the viewer, so no door builds its own view.
import { z } from "zod";

export const RoleView = z.object({
  /** The table's name as metrics use it (`t_t1`). */
  table: z.string(),
  table_id: z.string(),
  column: z.string(),
  /** The header as written in the file. Untrusted text: shown to the person, never to the planner. */
  label: z.string(),
  role: z.string(),
  status: z.enum(["confirmed", "assumed"]),
  source: z.enum(["detector", "model", "user"]),
  /** Readable evidence lines; an identity's rate is filled in from its SQL fact. */
  evidence: z.array(z.string()),
});
export type RoleView = z.infer<typeof RoleView>;

export const ConfirmView = z.object({
  /** Metrics and roles as an editable YAML file (metric-layer §1): what an API client edits and posts back. */
  yaml: z.string(),
  /** The same metrics without the `roles:` and `business_model:` blocks, for a screen that edits roles in its own controls. */
  metrics_yaml: z.string(),
  metrics: z.array(z.object({ id: z.string(), status: z.string(), text: z.string() })),
  roles: z.array(RoleView),
  /** Columns the detector gave no role: any vocabulary role may be set on them. */
  columns_without_role: z.array(z.object({ table: z.string(), column: z.string(), label: z.string() })),
  table_kinds: z.array(z.object({ table: z.string(), table_id: z.string(), kind: z.string(), evidence: z.array(z.string()) })),
  business_model: z.object({ model: z.string(), status: z.enum(["confirmed", "assumed"]), signals: z.array(z.string()) }),
  /** The role vocabulary and the business models a person may choose (semantics §1, §4). */
  vocabulary: z.array(z.string()),
  business_models: z.array(z.string()),
});
export type ConfirmView = z.infer<typeof ConfirmView>;
