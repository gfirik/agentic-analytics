// The pipeline, stage by stage (DESIGN.md §6 "Pipeline stages"): one real run (docs/assets/readme/pipeline.json) told
// as a rail of seven stops and one ledger panel per stop. This module only picks what each panel shows; every figure is
// a fact the run already holds, with its id, and nothing is computed here.
import type { PipelineData, RailNode } from "../pipeline-scene.ts";
import { railOf } from "../pipeline-scene.ts";

export interface StageFact {
  readonly id: string;
  readonly text: string;
}
export interface StageRow {
  readonly label: string;
  readonly value?: string;
  readonly facts?: readonly StageFact[];
}
export interface StagePanel {
  readonly node: RailNode;
  /** The engine stages behind this stop, in the order the run's event log reported them. */
  readonly stages: readonly string[];
}

/** How the ingester reads each kind of file (packages/ingest), for the Files panel. */
export const READ_AS: Record<string, string> = {
  table: "sheets, split into table regions",
  document: "text, by section and page",
  email: "headers and body",
};

/** The rail as the run's event log ordered it. */
export const stops = (run: PipelineData): StagePanel[] => railOf(run.stages);

const fact = (f: { id: string; text: string }): StageFact => ({ id: f.id, text: f.text });

/** The SQL panel's rows: the two periods, the change, and the driver with its share. */
export function sqlRows(run: PipelineData): StageRow[] {
  const c = run.change;
  const d = run.driver;
  return [
    { label: `${c.metric}, ${c.fromPeriod}`, facts: [fact(c.from)] },
    { label: `${c.metric}, ${c.period}`, facts: [fact(c.to)] },
    { label: "Change", facts: [fact(c.delta)] },
    { label: "Change, percent", facts: [fact(c.pct)] },
    { label: `By ${d.dimension}: ${d.member}`, facts: [fact(d.delta)] },
    { label: `${d.member.charAt(0).toUpperCase()}${d.member.slice(1)}'s share of the change`, facts: [fact(d.share)] },
  ];
}

/** Every fact id the panels show, for the test that each one is the run's own value. */
export function shownFacts(run: PipelineData): StageFact[] {
  return [...sqlRows(run).flatMap((r) => r.facts ?? []), fact(run.action.low), fact(run.action.high)];
}
