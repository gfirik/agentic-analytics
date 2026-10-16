// <Pipeline />: the animated pipeline, the same scene as the README GIF (pipeline-scene.ts), fed by the same run
// data (docs/assets/readme/pipeline.json: a real engine run on examples/coffee-roaster, scripted planner, no LLM).
// It loops while on screen; under reduced motion it shows the finished report and steps through the stages on demand.
import { useEffect, useRef, useState } from "react";
import data from "../../../../docs/assets/readme/pipeline.json";
import "./islands.css";
import { reducedMotion } from "./format.ts";
import { LOOP_SECONDS, type PipelineData, POSTER_SECONDS, RAIL, SCENES, sceneAt, sceneSvg } from "./pipeline-scene.ts";

const run = data as PipelineData;
/** A still moment in each rail stage: just before its scene starts to fade out. */
const STILLS = RAIL.map((_, i) => {
  const last = [...SCENES].reverse().find((s) => s.rail === i);
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

  const current = sceneAt(t).scene.rail;
  return (
    <section className="aa-island aa-pipe" aria-label="Pipeline animation">
      <h4>One real run · examples/coffee-roaster · scripted planner, no LLM</h4>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: our own SVG, built from the committed run data with every string escaped (pipeline-scene.ts) */}
      <div ref={box} className="aa-pipe-frame" dangerouslySetInnerHTML={{ __html: sceneSvg(run, t) }} />
      <div className="aa-row" style={{ marginTop: "0.6rem" }}>
        <button type="button" className="aa-btn" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>
          {playing ? "Pause" : "Play"}
        </button>
        {RAIL.map((label, i) => (
          <button
            key={label}
            type="button"
            className="aa-btn"
            aria-pressed={!playing && current === i}
            onClick={() => {
              setPlaying(false);
              setT(STILLS[i] ?? POSTER_SECONDS);
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
