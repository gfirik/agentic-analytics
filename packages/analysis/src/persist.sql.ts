// Writes an analysis to the job workspace: its facts, insights and decompositions (store migrations), and later the facts
// the agent's tools add.
import type { Fact } from "@agentic-analytics/schema";
import { sql, type Workspace } from "@agentic-analytics/store";
import type { AnalysisResult } from "./runner.ts";

export async function persist(ws: Workspace, r: AnalysisResult): Promise<void> {
  await persistFacts(ws, r.facts);
  for (const i of r.insights) {
    await ws.run(
      sql`INSERT INTO insights VALUES (${i.id}, ${i.template}, ${i.metric}, ${i.period}, ${JSON.stringify(i)}::JSON, ${JSON.stringify(Object.values(i.facts))}::VARCHAR[])`,
    );
  }
  for (const d of r.decompositions) {
    await ws.run(
      sql`INSERT INTO decompositions VALUES (${d.id}, ${d.method}, ${d.insight}, ${JSON.stringify(d)}::JSON, ${JSON.stringify(Object.values(d.facts))}::VARCHAR[])`,
    );
  }
}

/** Appends facts to the workspace `facts` table (the analysis, then any facts the agent's tools add). */
export async function persistFacts(ws: Workspace, facts: readonly Fact[]): Promise<void> {
  for (const f of facts) {
    const c = f.computation;
    await ws.run(sql`INSERT INTO facts (id, label, value, unit, currency, metric_id, kind, sql, params, fn, inputs, input_rows, definition_id)
      VALUES (${f.id}, ${f.label}, ${f.value}, ${f.unit}, ${f.currency ?? null}, ${f.metric_id ?? null}, ${c.kind}, ${c.sql ?? null},
        ${c.params ? JSON.stringify(c.params) : null}::JSON, ${c.fn ?? null}, ${JSON.stringify(c.inputs ?? [])}::VARCHAR[], ${JSON.stringify(f.citations)}::JSON, ${f.metric_id ?? null})`);
  }
}
