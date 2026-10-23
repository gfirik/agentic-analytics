/** @jsxRuntime automatic */
/** @jsxImportSource react */
// report.json → one self-contained report.html (docs/specs/report-schema.md §6).
// Server-side React only: no hydration, no external requests, inline CSS and a small inline script.
// The pragmas above select the automatic JSX runtime wherever this file is compiled: the CLI runs it through tsx
// from the repo root, where no tsconfig sets `jsx` (without them RENDER failed with "React is not defined").
import type { Citation, Claim, Evidence, Fact, Finding, Recommendation, Report, ReportMetric, Source } from "@agentic-analytics/schema";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CLIENT_SCRIPT } from "./client-script.ts";
import { formatCell, formatFact, formatPeriod } from "./format.ts";
import { STYLES } from "./styles.ts";

interface Ctx {
  readonly facts: Map<string, Fact>;
  readonly sources: Map<string, Source>;
  readonly metrics: Map<string, ReportMetric>;
  readonly findings: Map<string, Finding>;
  readonly assumptions: Map<string, string>;
  /** `${source_id}\u0000${quote}` → quote id used to highlight that passage in the evidence viewer. */
  readonly quoteIds: Map<string, string>;
}

const quoteKey = (sourceId: string, quote: string) => `${sourceId}\u0000${quote}`;

function allCitations(r: Report): Citation[] {
  const claims: Claim[] = [...r.summary.bullets, ...r.findings.flatMap((f) => f.claims), ...r.recommendations.flatMap((x) => x.rationale)];
  return [...claims.flatMap((c) => c.citations), ...r.facts.flatMap((f) => f.citations), ...r.data_quality.flatMap((q) => q.citations)];
}

function buildCtx(r: Report): Ctx {
  const quoteIds = new Map<string, string>();
  for (const c of allCitations(r)) {
    if (c.quote && !quoteIds.has(quoteKey(c.source_id, c.quote))) quoteIds.set(quoteKey(c.source_id, c.quote), `q${quoteIds.size + 1}`);
  }
  return {
    facts: new Map(r.facts.map((f) => [f.id, f])),
    sources: new Map(r.sources.map((s) => [s.id, s])),
    metrics: new Map(r.metrics.map((m) => [m.id, m])),
    findings: new Map(r.findings.map((f) => [f.id, f])),
    assumptions: new Map(r.assumptions.map((a) => [a.id, a.text])),
    quoteIds,
  };
}

function rowSpan(rows: readonly number[]): string {
  if (!rows.length) return "";
  const sorted = [...rows].sort((a, b) => a - b);
  const contiguous = sorted.every((v, i) => i === 0 || v === (sorted[i - 1] ?? 0) + 1);
  return contiguous && sorted.length > 1 ? `r${sorted[0]}–r${sorted.at(-1)}` : sorted.map((x) => `r${x}`).join(",");
}

export function citationLabel(c: Citation, ctx: Ctx): string {
  const s = ctx.sources.get(c.source_id);
  if (!s) return c.source_id;
  const loc = s.locator;
  if (s.kind === "web" && "url" in loc) return `web · ${new URL(loc.url).hostname}`;
  if ("table_id" in loc) {
    const where = c.rows?.length ? rowSpan(c.rows) : (c.cells?.join(",") ?? loc.range);
    return `${s.file} · ${loc.sheet ? `${loc.sheet} ` : ""}${where}`;
  }
  if ("char_start" in loc) return `${s.file}${loc.page ? ` p.${loc.page}` : loc.section && s.kind !== "email" ? ` § ${loc.section}` : ""}`;
  return s.file;
}

function citeData(c: Citation, ctx: Ctx) {
  return {
    label: citationLabel(c, ctx),
    source: c.source_id,
    ...(c.rows?.length ? { rows: c.rows.join(",") } : {}),
    ...(c.cells?.length ? { cells: c.cells.join(",") } : {}),
    ...(c.quote ? { q: ctx.quoteIds.get(quoteKey(c.source_id, c.quote)) } : {}),
  };
}

function Cite({ c, ctx }: { c: Citation; ctx: Ctx }) {
  const d = citeData(c, ctx);
  const external = ctx.sources.get(c.source_id)?.external ?? false;
  return (
    <button type="button" className="cite" aria-pressed="false" data-source={d.source} data-rows={d.rows} data-cells={d.cells} data-q={d.q}>
      {d.label}
      {external ? <span className="ext">External</span> : null}
    </button>
  );
}

function Chips({ citations, ctx }: { citations: readonly Citation[]; ctx: Ctx }) {
  if (!citations.length) return null;
  return (
    <div className="chips">
      {citations.map((c, i) => (
        <Cite key={`${c.source_id}-${i}`} c={c} ctx={ctx} />
      ))}
    </div>
  );
}

/** Model text with `{{N…}}` placeholders → text with clickable, formatted numbers. */
function Text({ text, ctx }: { text: string; ctx: Ctx }) {
  const parts = text.split(/(\{\{N\d+\}\})/);
  return (
    <>
      {parts.map((part, i) => {
        const m = /^\{\{(N\d+)\}\}$/.exec(part);
        if (!m) return part;
        const f = ctx.facts.get(m[1] ?? "");
        if (!f) return <span key={`${i}-missing`}>[missing {m[1]}]</span>;
        return (
          <button
            key={`${i}-${f.id}`}
            type="button"
            className="num"
            data-fact={f.id}
            aria-haspopup="dialog"
            title={`${f.label} — show how this was computed`}
          >
            {formatFact(f)}
          </button>
        );
      })}
    </>
  );
}

const GRADE_LABEL: Record<string, string> = {
  observed: "observed",
  correlated: "correlated",
  document_supported: "document-supported",
  intervention_supported: "intervention-supported",
};

function ClaimView({ claim, ctx }: { claim: Claim; ctx: Ctx }) {
  return (
    <div className="claim">
      <p>
        <Text text={claim.text} ctx={ctx} />
        {claim.causal_grade ? <span className="grade">{GRADE_LABEL[claim.causal_grade]}</span> : null}
      </p>
      <Chips citations={claim.citations} ctx={ctx} />
    </div>
  );
}

function FindingView({ f, ctx }: { f: Finding; ctx: Ctx }) {
  return (
    <article id={f.id} className={`panel finding sev-${f.severity} ${f.type}`}>
      <span className="kind">
        Finding {f.id} · {f.type.replace(/_/g, " ")} · {f.severity} severity
      </span>
      <h3>
        <Text text={f.title} ctx={ctx} />
      </h3>
      {f.claims.map((c, i) => (
        <ClaimView key={i} claim={c} ctx={ctx} />
      ))}
      {f.drivers?.length ? (
        <table className="drivers">
          <thead>
            <tr>
              <th>Driver</th>
              <th>Change</th>
              <th>Share of change</th>
            </tr>
          </thead>
          <tbody>
            {f.drivers.map((d) => (
              <tr key={d.label}>
                <td>
                  <Text text={d.label} ctx={ctx} />
                </td>
                <td>
                  <Text text={`{{${d.fact}}}`} ctx={ctx} />
                </td>
                <td>
                  <Text text={`{{${d.share_of_change}}}`} ctx={ctx} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <dl className="kv">
        <dt>Method</dt>
        <dd className="mono">{f.method}</dd>
        <dt>Confidence</dt>
        <dd>
          {f.confidence}
          <ul className="reasons">
            {f.confidence_reasons.map((r) => (
              <li key={r}>
                <Text text={r} ctx={ctx} />
              </li>
            ))}
          </ul>
        </dd>
        {f.assumptions.length ? (
          <>
            <dt>Assumes</dt>
            <dd>
              <Text text={f.assumptions.map((a) => ctx.assumptions.get(a) ?? a).join(" ")} ctx={ctx} />
            </dd>
          </>
        ) : null}
      </dl>
    </article>
  );
}

function RecommendationView({ r, ctx }: { r: Recommendation; ctx: Ctx }) {
  const low = ctx.facts.get(r.impact.low);
  const high = ctx.facts.get(r.impact.high);
  // Bar geometry is presentation only; the numbers shown are the facts themselves.
  // The axis runs from min(0, low) to max(0, high), so a range below zero (a scenario that loses money) is drawn
  // where it lies instead of collapsing to a sliver at 0.
  const lo = Math.min(0, low?.value ?? 0);
  const span = (Math.max(0, high?.value ?? 0) - lo) * 1.25 || 1;
  const left = (((low?.value ?? 0) - lo) / span) * 100;
  const width = Math.max(1, (((high?.value ?? 0) - (low?.value ?? 0)) / span) * 100);
  const metric = (id: string) => ctx.metrics.get(id)?.label ?? id;
  return (
    <article id={r.id} className="panel rec">
      <span className="kind">
        Recommendation {r.id} · because{" "}
        {r.because.map((b, i) => (
          <span key={b}>
            {i ? ", " : ""}
            <a href={`#${b}`}>{b}</a>
          </span>
        ))}
      </span>
      <h3>
        <Text text={r.action} ctx={ctx} />
      </h3>
      {r.rationale.map((c, i) => (
        <ClaimView key={i} claim={c} ctx={ctx} />
      ))}
      <div>
        <p>
          Expected impact on {metric(r.impact.metric_id).toLowerCase()}: <Text text={`{{${r.impact.low}}}`} ctx={ctx} /> to{" "}
          <Text text={`{{${r.impact.high}}}`} ctx={ctx} /> <Text text={r.impact.horizon} ctx={ctx} />
        </p>
        <div className="range" role="img" aria-label="Scenario estimate range">
          <div className="band" style={{ left: `${left.toFixed(1)}%`, width: `${width.toFixed(1)}%` }} />
        </div>
        <p className="hint">
          Scenario estimate ({r.impact.method}), not a forecast. Inputs:{" "}
          {r.impact.inputs.map((id, i) => (
            <span key={id}>
              {i ? ", " : ""}
              {ctx.facts.get(id)?.label.replace(/_/g, " ") ?? id} <Text text={`{{${id}}}`} ctx={ctx} />
            </span>
          ))}
        </p>
      </div>
      <dl className="kv">
        <dt>Confidence</dt>
        <dd>{r.confidence}</dd>
        <dt>Effort</dt>
        <dd>{r.effort}</dd>
        <dt>Risk</dt>
        <dd>
          <Text text={r.risk} ctx={ctx} />
        </dd>
        <dt>Check</dt>
        <dd>
          {metric(r.check.metric_id)} {r.check.comparator === "between" ? "between" : r.check.comparator}{" "}
          <Text text={`{{${r.check.threshold}}}`} ctx={ctx} /> by {r.check.by}
        </dd>
        {r.not_advised ? (
          <>
            <dt>Not advised</dt>
            <dd>
              <Text text={r.not_advised} ctx={ctx} />
            </dd>
          </>
        ) : null}
      </dl>
    </article>
  );
}

function sourceLocation(s: Source): string {
  const l = s.locator;
  if ("url" in l) return `${l.title} — ${l.url} (fetched ${l.fetched_at})`;
  if ("table_id" in l) return `${l.sheet ? `sheet ${l.sheet}, ` : ""}range ${l.range} (${l.table_id})`;
  return `${l.page ? `page ${l.page}, ` : ""}${l.section ? `${l.section}, ` : ""}chars ${l.char_start}–${l.char_end}`;
}

function EvidenceView({ e, ctx }: { e: Evidence; ctx: Ctx }) {
  const s = ctx.sources.get(e.source_id);
  const title = s ? `${s.id} · ${s.file}` : e.source_id;
  if (e.kind === "table") {
    return (
      <div className="ev panel" data-source={e.source_id} hidden>
        <h3>{title}</h3>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                {e.columns.map((c) => (
                  <th key={c.letter} scope="col">
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {e.rows.map((r) => (
                <tr key={r.row} data-row={r.row}>
                  {r.cells.map((v, i) => {
                    const col = e.columns[i];
                    return (
                      <td key={col?.letter ?? i} data-cell={`${col?.letter ?? ""}${r.row}`}>
                        {i === 0 ? <span className="rowid">r{r.row}</span> : null}
                        {formatCell(v, col?.name ?? "")}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  // Wrap every cited quote of this source in a <mark> the script can light up.
  const marks = [...ctx.quoteIds.entries()]
    .filter(([k]) => k.startsWith(`${e.source_id}\u0000`))
    .map(([k, id]) => {
      const quote = k.slice(e.source_id.length + 1);
      return { id, start: e.text.indexOf(quote), length: quote.length };
    })
    .filter((m) => m.start >= 0)
    .sort((a, b) => a.start - b.start);
  const parts: ReactNode[] = [];
  let at = 0;
  for (const m of marks) {
    if (m.start < at) continue; // overlapping quotes: keep the first
    parts.push(e.text.slice(at, m.start));
    parts.push(
      <mark key={m.id} data-q={m.id}>
        {e.text.slice(m.start, m.start + m.length)}
      </mark>,
    );
    at = m.start + m.length;
  }
  parts.push(e.text.slice(at));
  return (
    <div className="ev panel" data-source={e.source_id} hidden>
      <h3>
        {title}
        {s?.external ? <span className="ext">External</span> : null}
      </h3>
      <p className="hint">
        {e.page ? `Page ${e.page}` : (e.section ?? "")}
        {s && "url" in s.locator ? ` ${s.locator.title} · ${s.locator.url} · fetched ${s.locator.fetched_at}` : ""}
      </p>
      <pre className="doc">{parts}</pre>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  sales_lines: "sales lines",
  invoices: "invoices",
  bills: "bills",
  inventory_snapshot: "inventory snapshot",
  bank_cash: "bank and cash",
  budget_plan: "budget or plan",
  period_summary: "period summary",
  other: "other",
};

/** Table kinds, the business model and each table's column roles with their evidence (report-schema §5b, §6). */
function SemanticsView({ report, ctx }: { report: Report; ctx: Ctx }) {
  const tables = [...new Set([...(report.table_kinds ?? []).map((k) => k.table_id), ...(report.roles ?? []).map((r) => r.table_id)])];
  const file = (id: string) => report.sources.find((s) => s.id === id)?.file ?? id;
  return (
    <section aria-labelledby="semantics">
      <h2 id="semantics">Column roles and table kinds</h2>
      {report.business_model ? (
        <p>
          Business model: <b>{report.business_model.model}</b>{" "}
          <span className={`tag ${report.business_model.status === "confirmed" ? "ok" : "warn"}`}>{report.business_model.status}</span>
        </p>
      ) : null}
      <div className="list">
        {tables.map((t) => {
          const kind = report.table_kinds?.find((k) => k.table_id === t);
          const roles = (report.roles ?? []).filter((r) => r.table_id === t);
          return (
            <div key={t} className="panel">
              <p>
                <span className="mono">{t}</span> {file(t)}
                {kind ? (
                  <>
                    {" "}
                    <span className="tag ok">{KIND_LABEL[kind.kind] ?? kind.kind}</span>
                  </>
                ) : null}
              </p>
              {roles.length ? (
                <details>
                  <summary className="hint">Column roles</summary>
                  <ul>
                    {roles.map((r) => (
                      <li key={r.column}>
                        <span className="mono">{r.column}</span> is <b>{r.role.replace(/_/g, " ")}</b>{" "}
                        <span className={`tag ${r.status === "confirmed" ? "ok" : "warn"}`}>{r.status}</span>{" "}
                        <span className="muted">
                          {r.evidence
                            .filter((e) => e.kind !== "type")
                            .map((e, i) => (
                              <span key={`${i}-${e.kind}`}>
                                {i ? "; " : ""}
                                <Text text={e.text} ctx={ctx} />
                              </span>
                            ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ReportPage({ report, ctx }: { report: Report; ctx: Ctx }) {
  const v = report.verification;
  const verifiedOk = v.numbers_mismatched === 0 && v.rederivation_mismatches === 0;
  const highIssues = report.data_quality.filter((q) => q.severity === "high");
  const period = formatPeriod(report.period.from, report.period.to);
  return (
    <div className="wrap">
      <main>
        <header className="head">
          <span className="eyebrow">agentic-analytics report · {report.period.grain}ly</span>
          <h1>Business diagnosis · {period}</h1>
          <div className="meta">
            <span className={`tag ${verifiedOk ? "ok" : "warn"}`}>
              {verifiedOk ? "✓" : "✗"} {v.numbers_checked - v.numbers_mismatched}/{v.numbers_checked} numbers verified
            </span>
            <span className="tag">objective: {report.objective.text}</span>
            <span className="tag">generated {report.generated_at}</span>
          </div>
          <p className="headline">
            <Text text={report.summary.headline} ctx={ctx} />
          </p>
          <div className="bullets">
            {report.summary.bullets.map((c, i) => (
              <ClaimView key={i} claim={c} ctx={ctx} />
            ))}
          </div>
          <p className="hint hint-click">Click a number to see how it was computed. Click a citation to see its source.</p>
        </header>

        {report.data_quality.length ? (
          <section aria-labelledby="dq" className={highIssues.length ? "banner" : "panel"}>
            <h2 id="dq">{highIssues.length ? "Data-quality warning" : "Data-quality notes"}</h2>
            {report.data_quality.map((q) => (
              <div key={q.id} className="claim">
                <p>
                  <b>{q.severity}</b> · <span className="mono">{q.kind}</span> — <Text text={q.description} ctx={ctx} />
                </p>
                <Chips citations={q.citations} ctx={ctx} />
              </div>
            ))}
          </section>
        ) : null}

        <section aria-labelledby="findings">
          <h2 id="findings">Findings</h2>
          {report.findings.map((f) => (
            <FindingView key={f.id} f={f} ctx={ctx} />
          ))}
        </section>

        <section aria-labelledby="recs">
          <h2 id="recs">Recommendations</h2>
          {report.recommendations.map((r) => (
            <RecommendationView key={r.id} r={r} ctx={ctx} />
          ))}
        </section>

        {report.open_questions.length ? (
          <section aria-labelledby="oq">
            <h2 id="oq">Open questions</h2>
            <div className="list">
              {report.open_questions.map((q) => (
                <div key={q.id} className="panel">
                  <p>
                    <b>
                      <Text text={q.question} ctx={ctx} />
                    </b>
                  </p>
                  <p className="muted">
                    <Text text={q.why_it_matters} ctx={ctx} /> Would change: {q.would_change.join(", ")}.
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {report.assumptions.length ? (
          <section aria-labelledby="assumptions">
            <h2 id="assumptions">Assumptions</h2>
            <ul>
              {report.assumptions.map((a) => (
                <li key={a.id}>
                  <span className="mono">{a.id}</span> <Text text={a.text} ctx={ctx} />{" "}
                  {a.affects.length ? <span className="muted">Affects {a.affects.join(", ")}.</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="metrics">
          <h2 id="metrics">Metric definitions</h2>
          <div className="list">
            {report.metrics.map((m) => (
              <div key={m.id} className="panel">
                <p>
                  <b>{m.label}</b> <span className={`tag ${m.status === "confirmed" ? "ok" : "warn"}`}>{m.status}</span>
                </p>
                <p>{m.plain}</p>
                <details>
                  <summary className="hint">SQL</summary>
                  <pre className="doc">{m.sql}</pre>
                </details>
              </div>
            ))}
          </div>
        </section>

        {report.roles?.length || report.table_kinds?.length ? <SemanticsView report={report} ctx={ctx} /> : null}

        <section aria-labelledby="sources">
          <h2 id="sources">Sources</h2>
          <ul>
            {report.sources.map((s) => (
              <li key={s.id}>
                <span className="mono">{s.id}</span> {s.file} <span className="muted">({s.kind})</span>
                {s.external ? <span className="ext">External</span> : null} — <span className="muted">{sourceLocation(s)}</span>{" "}
                <span className="mono muted">sha256 {s.sha256.slice(0, 12)}…</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="verification">
          <h2 id="verification">Verification</h2>
          <div className="verify-grid">
            <div className="stat">
              <b>
                {v.numbers_checked - v.numbers_mismatched}/{v.numbers_checked}
              </b>
              numbers re-checked against their SQL
            </div>
            <div className="stat">
              <b>
                {v.rederived_metrics - v.rederivation_mismatches}/{v.rederived_metrics}
              </b>
              metrics re-derived independently
            </div>
            <div className="stat">
              <b>{v.definition_violations}</b>definition violations
            </div>
            <div className="stat">
              <b>
                {v.citations_checked - v.citations_unsupported}/{v.citations_checked}
              </b>
              citations supported
            </div>
          </div>
          {v.claims_dropped.length || v.claims_downgraded.length ? (
            <ul className="reasons">
              {v.claims_dropped.map((d) => (
                <li key={d.claim}>
                  Dropped: “{d.claim}” — {d.reason}
                </li>
              ))}
              {v.claims_downgraded.map((d) => (
                <li key={d.claim}>
                  Downgraded {d.from} → {d.to}: “{d.claim}” — {d.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </main>

      <aside className="evidence panel" aria-labelledby="evidence">
        <h2 id="evidence">Evidence</h2>
        <p id="aa-ev-empty" className="hint">
          Click a citation to see the cited rows, cells or passage here.
        </p>
        {(report.evidence ?? []).map((e) => (
          <EvidenceView key={e.source_id} e={e} ctx={ctx} />
        ))}
      </aside>

      <div
        id="aa-fact-panel"
        className="panel fact-panel"
        role="dialog"
        aria-modal="false"
        aria-label="How this number was computed"
        hidden
      >
        <button type="button" className="close" data-close="">
          Close
        </button>
        <div className="fp-body" />
      </div>
    </div>
  );
}

/** Data the inline script needs: facts with display values, metric context and citation targets. */
function clientData(report: Report, ctx: Ctx) {
  return {
    facts: report.facts.map((f) => {
      const m = f.metric_id ? ctx.metrics.get(f.metric_id) : undefined;
      return {
        id: f.id,
        label: f.label,
        value: f.value,
        unit: f.unit,
        currency: f.currency,
        display: formatFact(f),
        verified: f.verified,
        computation: f.computation,
        metric: m ? { label: m.label, plain: m.plain, status: m.status } : undefined,
        cites: f.citations.map((c) => citeData(c, ctx)),
      };
    }),
  };
}

const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);

/** JSON safe to embed inside a <script> element. */
function scriptJson(value: unknown): string {
  // U+2028/U+2029 are valid in JSON but end a line in older JS parsers.
  return JSON.stringify(value).replace(/</g, "\\u003c").replaceAll(LINE_SEP, "\\u2028").replaceAll(PARA_SEP, "\\u2029");
}

export function renderReportHtml(report: Report): string {
  const ctx = buildCtx(report);
  const title = `Business diagnosis · ${formatPeriod(report.period.from, report.period.to)}`;
  const body = renderToStaticMarkup(<ReportPage report={report} ctx={ctx} />);
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="generator" content="agentic-analytics ${escapeHtml(report.engine.version)}">`,
    `<title>${escapeHtml(title)}</title>`,
    `<style>${STYLES}</style>`,
    "</head><body>",
    body,
    `<script id="aa-data" type="application/json">${scriptJson(clientData(report, ctx))}</script>`,
    `<script>${CLIENT_SCRIPT}</script>`,
    "</body></html>",
    "",
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
