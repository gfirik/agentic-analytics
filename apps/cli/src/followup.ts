// `aa ask`, `aa explain` and `aa jobs`: follow-ups on finished jobs through the job manager (interfaces §2).
// Numbers are printed from the report's facts, never recomputed.
import type { JobManager } from "@agentic-analytics/core";
import { fillPlaceholders, formatFact } from "@agentic-analytics/report";

export async function askCommand(manager: JobManager, id: string, question: string, print: (l: string) => void): Promise<number> {
  const a = await manager.ask(id, question);
  if (!a.claims.length) print(a.notCovered ?? "The report does not answer this question.");
  for (const c of a.claims) {
    print(`• ${fillPlaceholders(c.text, a.facts)}`);
    const sources = [...new Set(c.citations.map((x) => x.source_id))];
    if (sources.length) print(`  sources: ${sources.join(", ")}`);
  }
  if (a.dropped.length) print(`(${a.dropped.length} statement(s) failed verification and were left out)`);
  return 0;
}

export async function explainCommand(manager: JobManager, id: string, factId: string, print: (l: string) => void): Promise<number> {
  const x = await manager.explain(id, factId);
  print(`${x.fact.id} = ${formatFact(x.fact)}   (${x.fact.label})`);
  if (x.definition) print(`definition: ${x.definition.text}`);
  if (x.fact.computation.kind === "sql") {
    print("sql:");
    for (const l of (x.fact.computation.sql ?? "").split("\n")) print(`  ${l}`);
    print(`params: ${JSON.stringify(x.fact.computation.params ?? {})}`);
  } else {
    print(`function: ${x.fact.computation.fn}`);
    for (const i of x.inputs) print(`  ${i.id} = ${formatFact(i)}   (${i.label})`);
  }
  for (const t of x.rows) {
    print(`input rows from ${t.source_id} (${t.rows.length} shown):`);
    for (const r of t.rows.slice(0, 10)) print(`  ${JSON.stringify(r)}`);
  }
  return 0;
}

export async function jobsList(manager: JobManager, print: (l: string) => void): Promise<number> {
  const jobs = await manager.list();
  if (!jobs.length) print("no jobs");
  for (const j of jobs) print(`${j.job_id}  ${j.status.padEnd(22)} ${j.stage ?? ""}  ${j.updated_at}`);
  return 0;
}
