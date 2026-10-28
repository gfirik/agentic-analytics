/** @jsxRuntime automatic */
/** @jsxImportSource react */
// Pieces every report section shares: the render context and numbers as clickable facts (report-schema §6: clicking a
// number shows its computation). Formatting rounds for reading; the exact value stays in the fact.
import type { Fact, Finding, ReportMetric, Source } from "@agentic-analytics/schema";
import { formatFact } from "./format.ts";

export interface Ctx {
  readonly facts: Map<string, Fact>;
  readonly sources: Map<string, Source>;
  readonly metrics: Map<string, ReportMetric>;
  readonly findings: Map<string, Finding>;
  readonly assumptions: Map<string, string>;
  /** `${source_id}\u0000${quote}` → quote id used to highlight that passage in the evidence viewer. */
  readonly quoteIds: Map<string, string>;
}

/** One fact as a clickable, formatted number. */
export function Num({ id, ctx }: { id: string; ctx: Ctx }) {
  const f: Fact | undefined = ctx.facts.get(id);
  if (!f) return <span>[missing {id}]</span>;
  return (
    <button type="button" className="num" data-fact={f.id} aria-haspopup="dialog" title={`${f.label} — show how this was computed`}>
      {formatFact(f)}
    </button>
  );
}

/** Model text with `{{N…}}` placeholders → text with clickable, formatted numbers. */
export function Text({ text, ctx }: { text: string; ctx: Ctx }) {
  const parts = text.split(/(\{\{N\d+\}\})/);
  return (
    <>
      {parts.map((part, i) => {
        const m = /^\{\{(N\d+)\}\}$/.exec(part);
        return m ? <Num key={`${i}-${m[1]}`} id={m[1] ?? ""} ctx={ctx} /> : part;
      })}
    </>
  );
}
