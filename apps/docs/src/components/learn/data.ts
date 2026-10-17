// The Learn pages' data (docs/assets/learn/learn.json, recorded by scripts/learn-data.ts and drift-checked) and the
// small helpers the pages use to show it. Formatting is presentation only (AGENTS.md §2.1).
import json from "../../../../../docs/assets/learn/learn.json";
import { formatWithCurrency } from "../format.ts";
import type { Flow, LearnData, LearnFact } from "./types.ts";

export const learn = json as unknown as LearnData;

export const REPO = "https://github.com/gfirik/agentic-analytics/blob/main/";

export function fact(id: string): LearnFact {
  const f = learn.facts[id];
  if (!f) throw new Error(`learn: no fact ${id} in learn.json`);
  return f;
}

/** A fact's stored value for reading, with its currency symbol when it has one. */
export const factText = (id: string): string => formatWithCurrency(fact(id));

/** The facts a flow shows, for the StageFlow island's props (only what the island needs reaches the browser). */
export function flowProps(key: string): { flow: Flow; facts: Record<string, { text: string; verified: boolean }> } {
  const flow = learn.flows[key];
  if (!flow) throw new Error(`learn: no flow ${key}`);
  const ids = [...flow.inputs, ...flow.outputs].flatMap((i) => (i.fact ? [i.fact] : []));
  return { flow, facts: Object.fromEntries(ids.map((id) => [id, { text: factText(id), verified: fact(id).verified }])) };
}

/** Every fact id a flow shows (the page's fact ledger must list them). */
export const flowFacts = (key: string): string[] =>
  [...(learn.flows[key]?.inputs ?? []), ...(learn.flows[key]?.outputs ?? [])].flatMap((i) => (i.fact ? [i.fact] : []));

/** Placeholders `{{N12}}` in a claim, filled with the facts' values (presentation only). */
export const fillText = (text: string): string => text.replace(/\{\{(N\d+)\}\}/g, (m, id: string) => (learn.facts[id] ? factText(id) : m));

export const count = (n: number): string => n.toLocaleString("en-US");
