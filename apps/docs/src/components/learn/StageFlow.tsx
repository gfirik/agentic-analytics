// <StageFlow />: one stage of the pipeline as "in → stage → out", with the real numbers of the coffee-roaster run
// (learn.json flows, recorded by scripts/learn-data.ts). The server renders the finished state: every step done,
// every output shown. With JS a reader steps through it: a step marks the outputs it produced. Nothing moves on
// its own; under reduced motion the Play control is not offered (DESIGN.md §7).
import { useEffect, useRef, useState } from "react";
import "../islands.css";
import "./learn.css";
import { reducedMotion } from "../format.ts";
import type { Flow, FlowItem } from "./types.ts";

interface Props {
  flow: Flow;
  facts: Record<string, { text: string; verified: boolean }>;
  /** The page's heading for the diagram (screen readers hear it as the region's name). */
  title?: string;
}

const Check = () => (
  <svg className="aa-check" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const keyOf = (it: FlowItem) => [it.label, it.value, it.fact, it.note].join("|");

function Item({ item, facts, current }: { item: FlowItem; facts: Props["facts"]; current: boolean }) {
  const f = item.fact ? facts[item.fact] : undefined;
  return (
    <li className={current ? "is-current" : undefined}>
      <span className="aa-flow-name">{item.label}</span>
      <span className="aa-flow-value">
        {item.value !== undefined ? <span className="aa-fig-wrap">{item.value}</span> : null}
        {f && item.fact ? (
          <>
            <span className="aa-fig">{f.text}</span>
            <a
              className="aa-chip"
              href={`#fact-${item.fact}`}
              aria-label={`${item.fact}${f.verified ? ", verified" : ""}: how this number was computed`}
            >
              {f.verified ? <Check /> : null}
              {item.fact}
            </a>
          </>
        ) : null}
      </span>
      {item.note ? <span className="aa-flow-note">{item.note}</span> : null}
    </li>
  );
}

export default function StageFlow({ flow, facts, title }: Props) {
  // -1: every step (the finished state, as the server renders it).
  const [step, setStep] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [canPlay, setCanPlay] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => setCanPlay(!reducedMotion()), []);
  useEffect(() => {
    if (!playing) return;
    timer.current = setTimeout(() => {
      if (step + 1 >= flow.steps.length) {
        setPlaying(false);
        setStep(-1);
      } else setStep(step + 1);
    }, 1800);
    return () => clearTimeout(timer.current);
  }, [playing, step, flow.steps.length]);

  const active = step < 0 ? undefined : flow.steps[step];
  const marked = new Set(active?.outputs ?? []);
  return (
    <section className="aa-island aa-flow" aria-label={title ?? `${flow.stage}: what goes in and what comes out`}>
      <p className="aa-island-label">{flow.stage} · the coffee-roaster run</p>
      <div className="aa-row aa-flow-controls">
        {canPlay ? (
          <button
            type="button"
            className="aa-btn"
            aria-pressed={playing}
            onClick={() => {
              if (playing) setPlaying(false);
              else {
                setStep(0);
                setPlaying(true);
              }
            }}
          >
            {playing ? "Pause" : "Play"}
          </button>
        ) : null}
        {flow.steps.map((s, i) => (
          <button
            key={s.label}
            type="button"
            className="aa-btn"
            aria-pressed={step === i}
            onClick={() => {
              setPlaying(false);
              setStep(step === i ? -1 : i);
            }}
          >
            {i + 1} · {s.label}
          </button>
        ))}
        <button
          type="button"
          className="aa-btn"
          aria-pressed={step === -1}
          onClick={() => {
            setPlaying(false);
            setStep(-1);
          }}
        >
          All
        </button>
      </div>
      <div className="aa-flow-grid">
        <div className="aa-flow-col">
          <p className="aa-flow-head">In</p>
          <ul>
            {flow.inputs.map((it) => (
              <Item key={keyOf(it)} item={it} facts={facts} current={false} />
            ))}
          </ul>
        </div>
        <div className="aa-flow-col aa-flow-stage">
          <p className="aa-flow-head">{flow.stage}</p>
          <ol>
            {flow.steps.map((s, i) => (
              <li key={s.label} className={step === i ? "is-current" : undefined} aria-current={step === i ? "step" : undefined}>
                <span className="aa-flow-name">
                  {i + 1} · {s.label}
                </span>
                <span className="aa-flow-note">{s.detail}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="aa-flow-col">
          <p className="aa-flow-head">Out</p>
          <ul>
            {flow.outputs.map((it, i) => (
              <Item key={keyOf(it)} item={it} facts={facts} current={marked.has(i)} />
            ))}
          </ul>
        </div>
      </div>
      <p className="aa-small" aria-live="polite">
        {active ? `Step ${step + 1}: ${active.detail}` : `From ${flow.source}.`}
      </p>
    </section>
  );
}
