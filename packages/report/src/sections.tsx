/** @jsxRuntime automatic */
/** @jsxImportSource react */
// The report sections built by code in M15 (report-schema §5b, §6): the scorecard, concentration, analyses not run, and
// the column roles and table kinds. Every number is a fact rendered as a clickable button; nothing is computed here.
import type { Concentration, NotRunReason, Report, ScorecardRow } from "@agentic-analytics/schema";
import { type Ctx, Num, Text } from "./parts.tsx";

const NA: Readonly<Record<string, string>> = {
  too_few_periods: "n/a: not enough history",
  grain_not_comparable: "n/a: not compared at this grain",
};
const na = (reason: NotRunReason) => <span className="muted">{NA[reason] ?? `n/a: ${reason.replace(/_/g, " ")}`}</span>;

function Change({ part, ctx }: { part: ScorecardRow["vs_base"] | ScorecardRow["yoy"]; ctx: Ctx }) {
  if ("na" in part) return na(part.na);
  return (
    <>
      <Num id={part.change} ctx={ctx} />
      {part.change_pct ? (
        <>
          {" "}
          (<Num id={part.change_pct} ctx={ctx} />)
        </>
      ) : null}
    </>
  );
}

/** The scorecard (analysis-library §12): each KPI's latest value, its change vs the baseline and vs last year, materiality. */
export function ScorecardView({ scorecard, ctx }: { scorecard: NonNullable<Report["scorecard"]>; ctx: Ctx }) {
  return (
    <section aria-labelledby="scorecard">
      <h2 id="scorecard">Scorecard · {scorecard.period}</h2>
      <div className="grid">
        <table>
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">Value</th>
              <th scope="col">vs baseline</th>
              <th scope="col">Material</th>
              <th scope="col">vs same period last year</th>
            </tr>
          </thead>
          <tbody>
            {scorecard.rows.map((r) => (
              <tr key={r.metric_id}>
                <th scope="row">{ctx.metrics.get(r.metric_id)?.label ?? r.metric_id}</th>
                <td>
                  <Num id={r.value} ctx={ctx} />
                </td>
                <td>
                  <Change part={r.vs_base} ctx={ctx} />
                  {"na" in r.vs_base ? null : (
                    <span className="muted">
                      {" "}
                      {r.vs_base.method === "previous_period" ? "vs previous period" : "vs trailing mean of three"}
                    </span>
                  )}
                </td>
                <td>{r.material === null ? <span className="muted">no noise band yet</span> : r.material ? <b>yes</b> : "no"}</td>
                <td>
                  <Change part={r.yoy} ctx={ctx} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const SHARE_COLUMNS = ["top1", "top3", "top5", "top10", "hhi"] as const;
const SHARE_HEAD: Readonly<Record<(typeof SHARE_COLUMNS)[number], string>> = {
  top1: "Top 1",
  top3: "Top 3",
  top5: "Top 5",
  top10: "Top 10",
  hhi: "HHI",
};

/** The report's latest period and grain: which share rows are the section's own and which are the trend's history. */
export interface SharePeriods {
  readonly latest: string;
  readonly grain: Report["period"]["grain"];
}

/**
 * The share rows the table shows (§11.2): the trailing year, the latest period and each calendar year. The per-period
 * history behind the trend stays in the facts. Chosen by period, not by which top-N shares are stated: a dimension with
 * three members or fewer has no top-3 share in any period.
 */
function shownShares(shares: Concentration["shares"], at: SharePeriods): Concentration["shares"] {
  const calendarYear = (p: string) => at.grain !== "year" && /^\d{4}$/.test(p);
  return shares.filter((s) => s.period === "ttm" || s.period === at.latest || calendarYear(s.period));
}

/** One metric and dimension's Pareto classes, top-N shares and HHI trend (analysis-library §11). */
function ConcentrationEntry({ c, at, ctx }: { c: Concentration; at: SharePeriods; ctx: Ctx }) {
  const shares = shownShares(c.shares, at);
  return (
    <div className="panel">
      <p>
        <b>{ctx.metrics.get(c.metric_id)?.label ?? c.metric_id}</b> by <b>{c.dimension.replace(/_/g, " ")}</b>{" "}
        <span className="mono muted">{c.column}</span>
        {c.dependence ? <span className="muted"> · see finding {c.dependence}</span> : null}
      </p>
      <div className="grid">
        {c.pareto.map((w) => (
          <table key={w.window}>
            <caption>
              {w.window === "ttm" ? "Trailing year" : "The year before"} {w.from} – {w.to}: <Num id={w.members} ctx={ctx} /> members
            </caption>
            <thead>
              <tr>
                <th scope="col">Class</th>
                <th scope="col">Members</th>
                <th scope="col">Value</th>
                <th scope="col">Share</th>
              </tr>
            </thead>
            <tbody>
              {w.classes.map((k) => (
                <tr key={k.class}>
                  <th scope="row">{k.class}</th>
                  <td>
                    <Num id={k.count} ctx={ctx} />
                  </td>
                  <td>
                    <Num id={k.value} ctx={ctx} />
                  </td>
                  <td>
                    <Num id={k.share} ctx={ctx} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
        {shares.length ? (
          <table>
            <caption>Share of the largest members</caption>
            <thead>
              <tr>
                <th scope="col">Period</th>
                {SHARE_COLUMNS.map((k) => (
                  <th key={k} scope="col">
                    {SHARE_HEAD[k]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shares.map((s) => (
                <tr key={s.period}>
                  <th scope="row">{s.period === "ttm" ? "trailing year" : s.period}</th>
                  {SHARE_COLUMNS.map((k) => {
                    const id = s[k];
                    return <td key={k}>{id ? <Num id={id} ctx={ctx} /> : <span className="muted">—</span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
      {c.trend ? (
        <p className="muted">
          HHI trend: <Num id={c.trend.hhi_slope} ctx={ctx} /> per period (Mann–Kendall p <Num id={c.trend.hhi_p} ctx={ctx} />)
          {c.trend.top1_slope && c.trend.top1_p ? (
            <>
              ; top member's share: <Num id={c.trend.top1_slope} ctx={ctx} /> per period (p <Num id={c.trend.top1_p} ctx={ctx} />)
            </>
          ) : null}
          .
        </p>
      ) : null}
    </div>
  );
}

export function ConcentrationView({ entries, at, ctx }: { entries: readonly Concentration[]; at: SharePeriods; ctx: Ctx }) {
  return (
    <section aria-labelledby="concentration">
      <h2 id="concentration">Concentration</h2>
      <div className="list">
        {entries.map((c) => (
          <ConcentrationEntry key={`${c.metric_id}/${c.column}`} c={c} at={at} ctx={ctx} />
        ))}
      </div>
    </section>
  );
}

/** What could not be computed from the data and why (analysis-library §13). The reasons carry no numbers. */
export function NotRunView({ entries }: { entries: NonNullable<Report["analyses_not_run"]> }) {
  return (
    <section aria-labelledby="not-run">
      <h2 id="not-run">Analyses not run</h2>
      <ul>
        {entries.map((n) => (
          <li key={`${n.analysis}/${n.reason_code}`}>
            <span className="mono">{n.analysis}</span> — {n.reason}
            {n.needs.length ? <span className="muted"> Needs: {n.needs.map((x) => x.replace(/_/g, " ")).join(", ")}.</span> : null}
          </li>
        ))}
      </ul>
    </section>
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
export function SemanticsView({ report, ctx }: { report: Report; ctx: Ctx }) {
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
