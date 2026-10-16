// <Decomposition />: the waterfall of a real contribution split (revenue, March → April, by customer). The bars come
// from the report's facts; the island only draws them.
import { useEffect, useState } from "react";
import coffee from "../data/coffee.json";
import "./islands.css";
import { type FactLike, formatFact } from "./format.ts";

const report = coffee.report as unknown as {
  facts: FactLike[];
  findings: { title: string; drivers?: { label: string; fact: string; share_of_change: string }[]; claims: { facts: string[] }[] }[];
};
const facts = new Map(report.facts.map((f) => [f.id, f]));

export default function Decomposition() {
  const finding = report.findings.find((f) => f.drivers?.length);
  const [shown, setShown] = useState(false);
  useEffect(() => setShown(true), []);
  if (!finding?.drivers) return null;
  const first = finding.claims[0]?.facts.map((id) => facts.get(id)).filter((f): f is FactLike => !!f) ?? [];
  const before = first.find((f) => /_\d{4}-\d{2}$/.test(f.label));
  const after = first.filter((f) => /_\d{4}-\d{2}$/.test(f.label))[1];
  const drivers = finding.drivers
    .map((d) => ({ label: d.label, delta: facts.get(d.fact), share: facts.get(d.share_of_change) }))
    .filter((d) => d.delta);
  if (!before || !after) return null;
  const known = drivers.reduce((a, d) => a + (d.delta?.value ?? 0), 0);
  const rest = after.value - before.value - known;
  const steps = [
    { label: `Revenue ${before.label.slice(-7)}`, from: 0, to: before.value, kind: "total", text: formatFact(before) },
    ...drivers.map((d) => ({
      label: d.label,
      delta: d.delta?.value ?? 0,
      kind: (d.delta?.value ?? 0) < 0 ? "neg" : "pos",
      text: `${formatFact(d.delta as FactLike)} · ${formatFact(d.share as FactLike)}`,
    })),
    { label: "Everyone else", delta: rest, kind: rest < 0 ? "neg" : "pos", text: "the remainder" as string },
    { label: `Revenue ${after.label.slice(-7)}`, from: 0, to: after.value, kind: "total", text: formatFact(after) },
  ];
  let level = before.value;
  const bars = steps.map((s) => {
    if ("from" in s) return { ...s, lo: Math.min(s.from ?? 0, s.to ?? 0), hi: Math.max(s.from ?? 0, s.to ?? 0) };
    const lo = Math.min(level, level + s.delta);
    const hi = Math.max(level, level + s.delta);
    level += s.delta;
    return { ...s, lo, hi };
  });
  const min = Math.min(...bars.map((b) => b.lo)) * 0.95;
  const max = Math.max(...bars.map((b) => b.hi));
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  return (
    <section className="aa-island" aria-label="Contribution waterfall">
      <h4>Contribution by customer · {finding.title}</h4>
      <div className="aa-bars">
        {bars.map((b) => (
          <div key={b.label} className="aa-bar">
            <span>{b.label}</span>
            <span className="track">
              <span
                className={`fill ${b.kind}`}
                style={{ left: `${shown ? pct(b.lo) : pct(b.hi)}%`, width: `${shown ? Math.max(0.6, pct(b.hi) - pct(b.lo)) : 0}%` }}
              />
            </span>
            <span style={{ textAlign: "right" }}>{b.text}</span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: "0.8rem" }}>
        The shares and changes are <code>contribution.v1</code> facts recomputed by the verifier; the remainder is shown, not hidden.
      </p>
    </section>
  );
}
