// The pipeline stages in run order (ARCHITECTURE §2). A plain array with no zod, so the browser viewer can import it
// (`@agentic-analytics/schema/stages`) without bundling the schema library. The `Stage` enum is built from it.
export const STAGES = [
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
] as const;
