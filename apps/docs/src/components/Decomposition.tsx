// <Decomposition />: a contribution bridge (site v3, finding 8) for a real split of the change (revenue, March →
// April, by the decomposition's own dimension). Start total, each member's change, end total, joined by connectors.
// Every figure shown is a fact's stored value with its id; the island computes no figure. The bar geometry is layout
// only: the axis starts near the lower totals (marked with a break, no numeric tick), so the changes are readable at
// the scale of the change rather than as slivers at the end of two long bars. It renders complete on the server.
import coffee from "../data/coffee.json";
import "./islands.css";
import { type FactLike, formatWithCurrency } from "./format.ts";

type Fact = FactLike & { readonly currency?: string | null; readonly computation?: { kind: string; fn?: string; inputs?: string[] } };
const report = coffee.report as unknown as {
  facts: Fact[];
  findings: { title: string; drivers?: { label: string; fact: string; share_of_change: string }[]; claims: { facts: string[] }[] }[];
};
const facts = new Map(report.facts.map((f) => [f.id, f]));

/** "revenue_2026-03" → "Revenue 2026-03". */
const periodName = (f: Fact) => f.label.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
/** "contribution.v1 revenue 2026-04 by channel:delta:wholesale" → "channel". */
const dimensionOf = (f: Fact) => /\bby ([\w ]+?):/.exec(f.label)?.[1] ?? "member";

export default function Decomposition() {
  const finding = report.findings.find((f) => f.drivers?.length);
  if (!finding?.drivers) return null;
  const periods = (finding.claims[0]?.facts ?? [])
    .map((id) => facts.get(id))
    .filter((f): f is Fact => !!f && /_\d{4}-\d{2}$/.test(f.label));
  const [before, after] = periods;
  const drivers = finding.drivers
    .map((d) => ({ label: d.label.replace(/[“”"]/g, ""), delta: facts.get(d.fact), share: facts.get(d.share_of_change) }))
    .filter((d): d is { label: string; delta: Fact; share: Fact | undefined } => !!d.delta);
  const first = drivers[0]?.delta;
  if (!before || !after || !first) return null;
  // The decomposition's own total is the sum of every member's delta, and its computation names them. Members in the
  // total that aren't drivers are named by fact id, never counted or subtracted here; without a total fact the island
  // claims nothing about completeness.
  const prefix = first.label.replace(/:delta:[^:]*$/, "");
  const total = report.facts.find((f) => f.label === `${prefix}:delta:total`);
  const others = (total?.computation?.inputs ?? []).filter((id) => !drivers.some((d) => d.delta.id === id));
  // Layout only: where each bar starts and ends on the track.
  let level = before.value;
  const steps = drivers.map((d) => {
    const from = level;
    level += d.delta.value;
    return { ...d, from, to: level };
  });
  const levels = [before.value, after.value, ...steps.map((s) => s.to)];
  const lo = Math.min(...levels);
  const hi = Math.max(...levels);
  const span = hi - lo || Math.abs(hi) || 1;
  const axis = lo - span * 0.6; // the break: totals are drawn from here, not from zero
  const top = hi + span * 0.05;
  const pct = (v: number) => ((v - axis) / (top - axis)) * 100;
  const bar = (a: number, b: number) => ({ left: `${pct(Math.min(a, b))}%`, width: `${Math.max(0.4, Math.abs(pct(b) - pct(a)))}%` });
  const fig = (f: Fact) => (
    <>
      <span className="aa-fig">{formatWithCurrency(f)}</span> <span className="aa-bridge-id">{f.id}</span>
    </>
  );

  return (
    <section className="aa-island aa-bridge" aria-label={`Contribution bridge by ${dimensionOf(first)}`}>
      <p className="aa-island-label">
        Contribution by {dimensionOf(first)} · {finding.title}
      </p>
      <ol className="aa-bridge-rows">
        <li className="aa-bridge-row">
          <span className="aa-bridge-name">{periodName(before)}</span>
          <span className="aa-bridge-track" aria-hidden="true">
            <span className="aa-bridge-bar total" style={bar(axis, before.value)} />
          </span>
          <span className="aa-bridge-value">{fig(before)}</span>
        </li>
        {steps.map((s, i) => (
          <li key={s.label} className="aa-bridge-row">
            <span className="aa-bridge-name">{s.label}</span>
            <span className="aa-bridge-track" aria-hidden="true">
              {/* The connector: from the level the previous bar ended at, down to this bar. */}
              <span className="aa-bridge-link" style={{ left: `${pct(s.from)}%` }} />
              <span className={s.delta.value < 0 ? "aa-bridge-bar neg" : "aa-bridge-bar pos"} style={bar(s.from, s.to)} />
            </span>
            <span className="aa-bridge-value">
              {fig(s.delta)}
              {s.share ? (
                <span className="aa-bridge-share">
                  {formatWithCurrency(s.share)} of the change <span className="aa-bridge-id">{s.share.id}</span>
                </span>
              ) : null}
              {i === steps.length - 1 && others.length ? (
                <span className="aa-bridge-share">also in the total, not drawn: {others.join(", ")}</span>
              ) : null}
            </span>
          </li>
        ))}
        <li className="aa-bridge-row">
          <span className="aa-bridge-name">{periodName(after)}</span>
          <span className="aa-bridge-track" aria-hidden="true">
            <span className="aa-bridge-link" style={{ left: `${pct(level)}%` }} />
            <span className="aa-bridge-bar total" style={bar(axis, after.value)} />
          </span>
          <span className="aa-bridge-value">{fig(after)}</span>
        </li>
      </ol>
      <p className="aa-small">
        Both totals are drawn from a broken axis (≈), so the changes show at their own scale. Each change and its share are{" "}
        <code>contribution.v1</code> facts recomputed by the verifier.
        {total && !others.length ? (
          <> The members drawn are all of them: their changes are the decomposition's total, {fig(total)}.</>
        ) : null}
      </p>
    </section>
  );
}
