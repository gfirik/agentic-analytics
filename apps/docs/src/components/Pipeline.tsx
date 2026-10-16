// <Pipeline />: the stage diagram, replaying the event log of a real run (examples/coffee-roaster, scripted model).
// Under reduced motion it shows the finished run and steps on demand instead of animating.
import { useEffect, useMemo, useState } from "react";
import coffee from "../data/coffee.json";
import "./islands.css";
import { reducedMotion } from "./format.ts";

type Ev = { seq: number; type: string; stage?: string; message?: string; duration_ms?: number };
const STAGES = [
  "INGEST",
  "PROFILE",
  "METRICS_DRAFT",
  "AWAIT_CONFIRM",
  "MEASURE",
  "DETECT",
  "DECOMPOSE",
  "INDEX_DOCS",
  "WEB_CONTEXT",
  "EXPLAIN",
  "DECIDE",
  "VERIFY",
  "RENDER",
];

export default function Pipeline() {
  const events = useMemo(() => (coffee.events as Ev[]).filter((e) => e.type !== "done"), []);
  const [n, setN] = useState(events.length);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    if (n >= events.length) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setN((x) => x + 1), 260);
    return () => clearTimeout(t);
  }, [playing, n, events.length]);
  const seen = events.slice(0, n);
  const state = (s: string) => {
    if (seen.some((e) => e.type === "stage_completed" && e.stage === s)) return "done";
    if (seen.some((e) => e.type === "stage_started" && e.stage === s)) return "running";
    return n === events.length ? "skipped" : "";
  };
  const play = () => {
    if (reducedMotion()) {
      setN((x) => (x >= events.length ? 1 : x + 1));
      return;
    }
    setN(0);
    setPlaying(true);
  };
  return (
    <section className="aa-island" aria-label="Pipeline replay">
      <h4>A real run, replayed · examples/coffee-roaster</h4>
      <div className="aa-row">
        {STAGES.map((s) => (
          <span key={s} className={`aa-chip ${state(s)}`}>
            {s}
          </span>
        ))}
      </div>
      <div className="aa-row" style={{ marginTop: "0.6rem" }}>
        <button type="button" className="aa-btn" onClick={play}>
          {reducedMotion() ? "Next event" : "Replay"}
        </button>
        <span style={{ fontSize: "0.8rem" }}>
          event {n} of {events.length}
        </span>
      </div>
      <div className="aa-log" aria-live="polite">
        {seen.slice(-6).map((e) => (
          <div key={e.seq}>
            {e.type === "stage_completed"
              ? `✓ ${e.stage} (${Math.round(e.duration_ms ?? 0)} ms)`
              : e.type === "stage_started"
                ? `▸ ${e.stage}`
                : `  ${e.message ?? e.type}`}
          </div>
        ))}
      </div>
    </section>
  );
}
