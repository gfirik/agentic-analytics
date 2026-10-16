// Stores the metric definitions a job uses in `metric_defs` (ARCHITECTURE §3): YAML, compiled SQL with its
// parameters (so the SQL can be re-run or audited on its own), and status.
import type { MetricDef } from "@agentic-analytics/schema";
import { sql, type Workspace } from "@agentic-analytics/store";
import { stringify } from "yaml";
import type { Catalog } from "./catalog.ts";
import { compileMetric, type MetricQuery } from "./compile.ts";

export async function saveMetricDefs(ws: Workspace, metrics: readonly MetricDef[], catalog: Catalog, query: MetricQuery): Promise<void> {
  for (const m of metrics) {
    const compiled = compileMetric(m.id, metrics, catalog, query);
    await ws.run(sql`DELETE FROM metric_defs WHERE id = ${m.id}`);
    await ws.run(
      sql`INSERT INTO metric_defs (id, yaml, sql, status, params) VALUES (${m.id}, ${stringify(m)}, ${compiled.text}, ${m.status}, ${JSON.stringify(compiled.params)}::JSON)`,
    );
  }
}
