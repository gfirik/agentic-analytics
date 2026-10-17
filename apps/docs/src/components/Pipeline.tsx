// <Pipeline />: the animated pipeline, the same scene as the README GIF (pipeline-scene.ts), fed by the same run
// data (docs/assets/readme/pipeline.json: a real engine run on examples/coffee-roaster, scripted planner, no LLM).
// It loops while on screen; under reduced motion it shows the finished report and steps through the stages on demand.
import { useEffect, useRef, useState } from "react";
import data from "../../../../docs/assets/readme/pipeline.json";
import "./islands.css";
import { reducedMotion } from "./format.ts";
import { LOOP_SECONDS, type PipelineData, POSTER_SECONDS, railOf, SCENES, sceneAt, sceneSvg } from "./pipeline-scene.ts";

const run = data as PipelineData;
/** A fact's row in the landing page's fact ledger (the same run), from any page the island is on. */
const factLink = (id: string) => `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}#fact-${id}`;
/** The rail as the run's event log ordered it, and a still moment per node: just before its last scene fades out. */
const STOPS = railOf(run.stages);
const STILLS = STOPS.map((stop) => {
  const last = [...SCENES].reverse().find((s) => s.node === stop.node);
  return last ? last.end - 0.3 : POSTER_SECONDS;
});

export default function Pipeline() {
  const [t, setT] = useState(POSTER_SECONDS);
  const [playing, setPlaying] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const visible = useRef(true);

  // Read after mount: the server render can't know the reader's motion setting, so it renders the still frame.
  useEffect(() => {
    if (reducedMotion()) return;
    setT(0);
    setPlaying(true);
  }, []);

  // Animate only while the island is on screen.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => {
      visible.current = e?.isIntersecting ?? true;
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last: number | undefined;
    const tick = (now: number) => {
      const dt = last === undefined ? 0 : (now - last) / 1000;
      last = now;
      if (visible.current) setT((x) => (x + dt) % LOOP_SECONDS);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const current = sceneAt(t).scene.node;
  return (
    <section className="aa-island aa-pipe" aria-label="Pipeline animation">
      <p className="aa-island-label">One real run · examples/coffee-roaster · scripted planner, no LLM</p>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: our own SVG, built from the committed run data with every string escaped (pipeline-scene.ts) */}
      <div ref={box} className="aa-pipe-frame" dangerouslySetInnerHTML={{ __html: sceneSvg(run, t) }} />
      <div className="aa-row">
        <button type="button" className="aa-btn" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>
          {playing ? "Pause" : "Play"}
        </button>
        {STOPS.map(({ node, stages }, i) => (
          <button
            key={node}
            type="button"
            className="aa-btn"
            title={stages.join(" · ")}
            aria-pressed={!playing && current === node}
            onClick={() => {
              setPlaying(false);
              setT(STILLS[i] ?? POSTER_SECONDS);
            }}
          >
            {node}
          </button>
        ))}
      </div>
      <ol className="aa-pipe-steps" aria-label="The same run, step by step">
        <li>
          <b>Files</b> {run.files.map((f) => f.name).join(", ")}
        </li>
        <li>
          <b>Profile</b> {run.profile.tables} tables, {run.profile.sections} document sections, {run.profile.issues} data-quality issues
        </li>
        <li>
          <b>Metric</b> {run.metric.label} = {run.metric.formula}, per {run.metric.grain} ({run.metric.status})
        </li>
        <li>
          <b>SQL</b> {run.change.metric} {run.change.from.text} → {run.change.to.text},{" "}
          <span className="aa-fig">{run.change.pct.text}</span>{" "}
          <a className="aa-chip" href={factLink(run.change.pct.id)}>
            {run.change.pct.id}
          </a>
          ; driver {run.driver.member} <span className="aa-fig">{run.driver.delta.text}</span>{" "}
          <a className="aa-chip" href={factLink(run.driver.delta.id)}>
            {run.driver.delta.id}
          </a>
        </li>
        {run.docs.slice(0, 1).map((doc) => (
          <li key={doc.source_id}>
            <b>Evidence</b> {doc.file}
            {doc.from ? ` from ${doc.from}` : ""}: <q>{doc.quote}</q>
          </li>
        ))}
        <li>
          <b>Verify</b> V1–V8: {run.verification.numbers_checked} numbers recomputed, {run.verification.numbers_mismatched} mismatched
        </li>
        <li>
          <b>Report</b> {run.action.text}: +{run.action.low.text} to +{run.action.high.text}, {run.action.horizon}
        </li>
      </ol>
    </section>
  );
}
