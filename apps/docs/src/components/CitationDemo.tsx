// <CitationDemo />: click a citation and see the cited rows or passage, as in report.html. Data: the verified report
// of a real run on examples/coffee-roaster.
import { useState } from "react";
import coffee from "../data/coffee.json";
import "./islands.css";
import { type FactLike, fill } from "./format.ts";

type Cite = { source_id: string; rows?: number[]; quote?: string };
type Claim = { text: string; facts: string[]; citations: Cite[]; causal_grade?: string };
type Ev =
  | {
      source_id: string;
      kind: "table";
      columns: { letter: string; name: string }[];
      rows: { row: number; cells: (string | number | null)[] }[];
    }
  | { source_id: string; kind: "text"; text: string };

const report = coffee.report as unknown as {
  facts: (FactLike & { citations: Cite[] })[];
  findings: { title: string; claims: Claim[] }[];
  sources: { id: string; file?: string }[];
  evidence?: Ev[];
};
const facts = new Map(report.facts.map((f) => [f.id, f]));

export default function CitationDemo() {
  const finding = report.findings[0];
  const [active, setActive] = useState<Cite | undefined>();
  // A claim's own citations, or its first fact's cited rows.
  const citesOf = (c: Claim): Cite[] =>
    c.citations.length ? c.citations : ((facts.get(c.facts[0] ?? "") as { citations?: Cite[] } | undefined)?.citations?.slice(0, 1) ?? []);
  const file = (id: string) => report.sources.find((s) => s.id === id)?.file ?? id;
  const ev = active ? report.evidence?.find((e) => e.source_id === active.source_id) : undefined;
  if (!finding) return null;
  return (
    <section className="aa-island" aria-label="Citation demo">
      <p className="aa-island-label">Click a citation · {finding.title}</p>
      {finding.claims.slice(0, 5).map((c) => (
        <div key={c.text} className="aa-claim">
          {fill(c.text, facts)}
          <span className="aa-grade">{c.causal_grade ?? "observed"}</span>{" "}
          {citesOf(c).map((x) => (
            <button
              key={`${x.source_id}:${x.quote ?? x.rows?.[0] ?? ""}`}
              type="button"
              className="aa-btn"
              aria-pressed={active === x}
              onClick={() => setActive(active === x ? undefined : x)}
            >
              {file(x.source_id)}
              {x.rows?.length ? ` · ${x.rows.length} rows` : ""}
            </button>
          ))}
        </div>
      ))}
      {ev ? (
        <div className="aa-ev" aria-live="polite">
          {ev.kind === "table" ? (
            <table>
              <thead>
                <tr>
                  <th>row</th>
                  {ev.columns.map((c) => (
                    <th key={c.letter}>{c.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ev.rows.slice(0, 12).map((r) => (
                  <tr key={r.row} className={active?.rows?.includes(r.row) ? "hl" : ""}>
                    <td>r{r.row}</td>
                    {r.cells.map((v, k) => (
                      <td key={ev.columns[k]?.letter ?? String(k)}>{v ?? ""}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <pre>
              {active?.quote && ev.text.includes(active.quote) ? (
                <>
                  {ev.text.slice(0, ev.text.indexOf(active.quote))}
                  <mark>{active.quote}</mark>
                  {ev.text.slice(ev.text.indexOf(active.quote) + active.quote.length)}
                </>
              ) : (
                ev.text
              )}
            </pre>
          )}
        </div>
      ) : (
        <p className="aa-small">Every number above is a fact computed by SQL; every citation opens what it points at.</p>
      )}
    </section>
  );
}
