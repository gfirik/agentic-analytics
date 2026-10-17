// <LedgerReport />: the landing page's report. It shows the first finding of a real run on examples/coffee-roaster
// (scripted planner, no LLM), with each number followed by the ID of the fact it came from. Each fact-ID chip is a
// link into the fact ledger below (it works without JS). With JS it opens the fact in place: its SQL and
// parameters, or its function and input facts (which open in turn), the rows it cites, and its verification.
// Data: src/data/landing.json, written by scripts/generate.ts from that run; this file only lays it out.
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import landing from "../data/landing.json";
import { formatWithCurrency } from "./format.ts";
import "./islands.css";

interface LFact {
  id: string;
  label: string;
  value: number;
  unit: string;
  currency: string | null;
  verified: boolean;
  computation: { kind: string; sql?: string; params?: Record<string, unknown>; fn?: string; inputs?: string[] };
  citations: { source_id: string; file: string; rows: number[]; count: number }[];
}
interface LClaim {
  text: string;
  facts: string[];
  grade: string;
  verified: boolean;
  citations: { source_id: string; file: string; quote: string | null }[];
}

const data = landing as unknown as {
  run: { example: string; model: string; today: string };
  finding: { id: string; type: string; severity: string; title: string; method: string | null; confidence: string; claims: LClaim[] };
  recommendation: { id: string; action: string; low: string | null; high: string | null; horizon: string | null; confidence: string };
  direct: string[];
  facts: Record<string, LFact>;
  verification: { numbers_checked: number; numbers_mismatched: number; citations_checked: number };
};
const facts = data.facts;
const PANEL = "aa-fact-panel";
const GRADE: Record<string, string> = {
  observed: "observed",
  correlated: "correlated",
  document_supported: "document-supported",
  experiment_supported: "experiment-supported",
};

export function Check({ label }: { label?: string }) {
  return (
    <svg
      className="aa-check"
      viewBox="0 0 16 16"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const value = (f: LFact) => formatWithCurrency(f);

export default function LedgerReport() {
  const [open, setOpen] = useState<string | undefined>();
  const [trail, setTrail] = useState<string[]>([]);
  const [live, setLive] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => setLive(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(undefined);
      setTrail([]);
      opener.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const show = (id: string, from: HTMLElement | null, nested = false) => {
    if (!nested) {
      opener.current = from;
      if (open === id) {
        setOpen(undefined);
        setTrail([]);
        return;
      }
      setTrail([id]);
    } else setTrail((t) => [...t, id]);
    setOpen(id);
    // Bring the panel into view on narrow screens, where it sits under the report.
    requestAnimationFrame(() => {
      const el = panel.current;
      if (el && el.getBoundingClientRect().top > window.innerHeight) el.scrollIntoView({ block: "nearest" });
    });
  };

  const chip = (id: string, nested = false): ReactNode => {
    const f = facts[id];
    if (!f) return <code>{id}</code>;
    return (
      <a
        className="aa-chip"
        href={`#fact-${id}`}
        aria-label={`${id}${f.verified ? ", verified" : ""}: how this number was computed`}
        {...(live ? { "aria-expanded": open === id, "aria-controls": PANEL } : {})}
        onClick={(e) => {
          if (!live) return;
          e.preventDefault();
          show(id, e.currentTarget, nested);
        }}
      >
        {f.verified ? <Check /> : null}
        {id}
      </a>
    );
  };

  const sentence = (text: string): ReactNode[] =>
    text.split(/\{\{(N\d+)\}\}/).map((part, i) => {
      if (i % 2 === 0) return <Fragment key={`t${i}`}>{part}</Fragment>;
      const f = facts[part];
      return (
        <span key={`f${part}`} className="aa-num">
          <span className="aa-fig">{f ? value(f) : part}</span>
          {chip(part)}
        </span>
      );
    });

  const f = open ? facts[open] : undefined;
  const { finding, recommendation: rec, verification: v } = data;
  return (
    <div className="aa-ledger-report">
      <div className="aa-report-grid">
        <article className="aa-report-card" aria-labelledby="aa-finding-title">
          <p className="aa-label">
            Finding {finding.id} · {finding.type.replace(/_/g, " ")} · {finding.severity} severity
            {finding.method ? ` · ${finding.method}` : ""}
          </p>
          <h3 id="aa-finding-title" className="aa-report-title">
            {finding.title}
          </h3>
          <ol className="aa-claims">
            {finding.claims.map((c) => (
              <li key={c.text}>
                <p className="aa-claim-text">{sentence(c.text)}</p>
                <p className="aa-claim-meta">
                  <span className="aa-grade">{GRADE[c.grade] ?? c.grade}</span>
                  {c.citations.map((x) => (
                    <span key={x.source_id} className="aa-cite">
                      <span className="aa-cite-id">{x.source_id}</span> {x.file}
                      {x.quote ? <q>{x.quote}</q> : null}
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ol>
          <div className="aa-rec">
            <p className="aa-label">Top recommendation {rec.id}</p>
            <p className="aa-rec-action">{rec.action}</p>
            {rec.low && rec.high && facts[rec.low] && facts[rec.high] ? (
              <p className="aa-claim-text">
                Impact range{" "}
                <span className="aa-num">
                  <span className="aa-fig">{value(facts[rec.low] as LFact)}</span>
                  {chip(rec.low)}
                </span>{" "}
                to{" "}
                <span className="aa-num">
                  <span className="aa-fig">{value(facts[rec.high] as LFact)}</span>
                  {chip(rec.high)}
                </span>
                {rec.horizon ? `, ${rec.horizon}` : ""} · {rec.confidence} confidence
              </p>
            ) : null}
          </div>
          <p className="aa-report-foot">
            <Check label="verified" /> {v.numbers_checked} numbers recomputed, {v.numbers_mismatched} mismatched · {v.citations_checked}{" "}
            citations checked
          </p>
        </article>

        <div className="aa-fact-panel" id={PANEL} ref={panel} aria-live="polite" tabIndex={-1}>
          {f ? (
            <FactView f={f} trail={trail} chip={(id) => chip(id, true)} />
          ) : (
            <div className="aa-fact-empty">
              <p className="aa-label">Fact panel</p>
              <p>
                Every number above is followed by the ID of the fact it came from. Choose one to see how it was computed: the SQL that ran
                in DuckDB, or the function and the facts it was computed from, and the rows it cites.
              </p>
            </div>
          )}
        </div>
      </div>

      <FactLedger />
    </div>
  );
}

function FactView({ f, trail, chip }: { f: LFact; trail: string[]; chip: (id: string) => ReactNode }) {
  const c = f.computation;
  const params = Object.entries(c.params ?? {}).filter(([k]) => k !== "input_rows");
  return (
    <div className="aa-fact">
      {trail.length > 1 ? (
        <p className="aa-trail aa-label">
          {trail.map((id, i) => (
            <Fragment key={`${id}-${i}`}>
              {i ? " → " : ""}
              {id}
            </Fragment>
          ))}
        </p>
      ) : null}
      <div className="aa-fact-head">
        <span className="aa-fact-id">{f.id}</span>
        {f.verified ? (
          <span className="aa-badge-verified">
            <Check /> verified
          </span>
        ) : null}
      </div>
      <p className="aa-fact-value aa-fig">{value(f)}</p>
      <p className="aa-fact-label">{f.label}</p>
      {c.kind === "sql" ? (
        <>
          <p className="aa-label">SQL, run in DuckDB</p>
          <pre className="aa-sql">
            <code>{c.sql}</code>
          </pre>
          {params.length ? (
            <p className="aa-params">
              {params.map(([k, val]) => (
                <span key={k}>
                  <code>{k}</code> = <code>{JSON.stringify(val)}</code>
                </span>
              ))}
            </p>
          ) : null}
          {typeof c.params?.input_rows === "number" ? <p className="aa-small">{String(c.params.input_rows)} input rows</p> : null}
        </>
      ) : (
        <>
          <p className="aa-label">Function, computed in code</p>
          <p className="aa-fn">
            <code>{c.fn}</code>(
            {(c.inputs ?? []).map((id, i) => (
              <Fragment key={`${id}-${i}`}>
                {i ? ", " : ""}
                {chip(id)}
              </Fragment>
            ))}
            )
          </p>
        </>
      )}
      {f.citations.length ? (
        <>
          <p className="aa-label">Cites</p>
          {f.citations.map((x) => (
            <p key={x.source_id} className="aa-small">
              <span className="aa-cite-id">{x.source_id}</span> {x.file} · {x.count} rows:{" "}
              <span className="aa-fig">
                {x.rows.map((r) => `r${r}`).join(", ")}
                {x.count > x.rows.length ? ", …" : ""}
              </span>
            </p>
          ))}
        </>
      ) : null}
      <p className="aa-small aa-fact-note">
        {f.verified
          ? "Recomputed by the verifier (V2) from its stored computation before the report shipped."
          : "Not verified: a report never ships this number."}{" "}
        Press Escape to close.
      </p>
    </div>
  );
}

function FactLedger() {
  const order = [...data.direct, ...Object.keys(facts).filter((id) => !data.direct.includes(id))];
  return (
    // biome-ignore lint/a11y/useSemanticElements lint/a11y/noNoninteractiveTabindex: a scrolling table region must be reachable by keyboard (WCAG 2.1.1)
    <div className="aa-ledger-wrap aa-fact-ledger" role="region" aria-label="Fact ledger: every fact behind this finding" tabIndex={0}>
      <table className="aa-ledger">
        <caption className="aa-label">Fact ledger · {order.length} facts behind this finding and its recommendation</caption>
        <thead>
          <tr>
            <th scope="col">Fact</th>
            <th scope="col" className="num">
              Value
            </th>
            <th scope="col">Computed by</th>
            <th scope="col">Verified</th>
          </tr>
        </thead>
        <tbody>
          {order.map((id) => {
            const f = facts[id] as LFact;
            return (
              <tr key={id} id={`fact-${id}`}>
                <td className="id">{id}</td>
                <td className="num">{value(f)}</td>
                <td className="muted">
                  {f.computation.kind === "sql" ? (
                    <>
                      SQL
                      {typeof f.computation.params?.input_rows === "number"
                        ? ` · ${String(f.computation.params.input_rows)} rows of ${f.citations[0]?.file ?? "the table"}`
                        : ""}
                    </>
                  ) : (
                    <>
                      <code>{f.computation.fn}</code>(
                      {(f.computation.inputs ?? []).slice(0, 4).map((x, i) => (
                        <Fragment key={`${x}-${i}`}>
                          {i ? ", " : ""}
                          <a href={`#fact-${x}`}>{x}</a>
                        </Fragment>
                      ))}
                      {(f.computation.inputs ?? []).length > 4 ? `, … ${(f.computation.inputs ?? []).length - 4} more` : ""})
                    </>
                  )}
                </td>
                <td>{f.verified ? <Check label="verified" /> : <span className="aa-fail">no</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
