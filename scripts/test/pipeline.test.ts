// The README pipeline GIF and the docs <Pipeline /> island (docs/DOCS-SITE.md §3.3): the data they show is a real
// run's, the checked-in copy can't drift from the engine, the scene is deterministic, and the asset limits hold.
import { describe, expect, it } from "vitest";
import { extractPipelineData, pipelineJson, recordRun, senderOf } from "../../apps/docs/scripts/pipeline-data.ts";
import { LOOP_SECONDS, POSTER_SECONDS, railOf, SCENES, sceneSvg, wrap } from "../../apps/docs/src/components/pipeline-scene.ts";
import { gifDimensions, PIPELINE_LIMITS, pipelineProblems, pngDimensions, readPipelineData } from "../readme-assets/pipeline.ts";

const data = readPipelineData();

/** Floats from DuckDB sums may differ in the last bits between machines; V2's tolerance (1e-9 relative) applies. */
const stable = (json: string) =>
  JSON.stringify(JSON.parse(json, (_k, v: unknown) => (typeof v === "number" ? Number(v.toPrecision(9)) : v)));

describe("pipeline.json (from a real run)", () => {
  it("shows the coffee-roaster headline: revenue −17.9% from 2026-03 to 2026-04, as facts with ids", () => {
    const c = data.change;
    expect(c.metric).toBe("Revenue");
    expect([c.fromPeriod, c.period]).toEqual(["2026-03", "2026-04"]);
    expect([c.from.text, c.to.text, c.delta.text, c.pct.text]).toEqual(["$44,100", "$36,200", "−$7,900", "−17.9%"]);
    // Hand-computed: (36,200 − 44,100) / 44,100 = −17.9138…%
    expect(c.pct.value).toBeCloseTo(((36_200 - 44_100) / 44_100) * 100, 9);
    for (const f of [c.from, c.to, c.delta, c.pct, data.driver.delta, data.driver.share, data.action.low, data.action.high])
      expect(f.id).toMatch(/^N\d+$/);
  });

  it("names wholesale as the driver: −$8,500, 108% of the drop", () => {
    expect(data.driver).toMatchObject({ dimension: "channel", member: "wholesale" });
    expect(data.driver.delta.text).toBe("−$8,500");
    // −8,500 / −7,900 = 107.59…%
    expect(data.driver.share.value).toBeCloseTo((8_500 / 7_900) * 100, 6);
  });

  it("cites the hotel's email and a labelled web benchmark", () => {
    const email = data.docs.find((d) => d.kind === "email");
    expect(email).toMatchObject({ file: "email-0412.eml", source_id: "D1", grade: "document_supported" });
    expect(email?.quote).toContain("pausing our standing order");
    // The sender comes from the From header ingest parsed: "Purchasing, Hotel Group" <purchasing@hotelgroup.example>
    expect(email?.from).toBe("Purchasing, Hotel Group");
    expect(data.web?.url).toBe("https://coffee-benchmarks.example/refunds");
    expect(data.web?.quote).toContain("1–2% of sales");
  });

  it("carries the verifier's V1–V8 table and the top-ranked action", () => {
    expect(data.checks.map((c) => c.check)).toEqual(["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8"]);
    for (const c of data.checks) expect(c.run).toBeGreaterThan(0);
    expect(data.verification.numbers_mismatched).toBe(0);
    expect(data.action).toMatchObject({ id: "R1", rank: 1, of: 2, horizon: "next quarter" });
    expect(data.action.text).toMatch(/wholesale/);
    expect(data.stages).toEqual(expect.arrayContaining(["INGEST", "PROFILE", "METRICS_DRAFT", "WEB_CONTEXT", "VERIFY", "RENDER"]));
  });

  it("matches a fresh run of the engine (regenerate with `tsx apps/docs/scripts/pipeline-data.ts --write`)", async () => {
    const fresh = extractPipelineData(await recordRun());
    expect(stable(pipelineJson(fresh))).toEqual(stable(JSON.stringify(data)));
  }, 180_000);
});

describe("rail from the event log", () => {
  it("groups the run's completed stages into rail nodes, in the order the log reported them", () => {
    expect(railOf(data.stages)).toEqual([
      { node: "Files", stages: ["INGEST"] },
      { node: "Profile", stages: ["PROFILE"] },
      { node: "Metric", stages: ["METRICS_DRAFT"] },
      { node: "SQL", stages: ["MEASURE", "DETECT", "DECOMPOSE"] },
      { node: "Evidence", stages: ["INDEX_DOCS", "WEB_CONTEXT", "EXPLAIN", "DECIDE"] },
      { node: "Verify", stages: ["VERIFY"] },
      { node: "Report", stages: ["RENDER"] },
    ]);
    expect(data.run.events).toBeGreaterThan(data.stages.length);
  });

  it("follows the log, not a fixed list: order, missing stages and captions change with it", () => {
    expect(railOf(["PROFILE", "INGEST"]).map((s) => s.node)).toEqual(["Profile", "Files"]);
    const noWeb = { ...data, stages: data.stages.filter((s) => s !== "WEB_CONTEXT") };
    const evidenceAt = (SCENES.find((s) => s.key === "evidence")?.end ?? 0) - 0.3;
    expect(sceneSvg(data, evidenceAt)).toContain("INDEX_DOCS · WEB_CONTEXT · EXPLAIN · DECIDE");
    expect(sceneSvg(noWeb, evidenceAt)).toContain("INDEX_DOCS · EXPLAIN · DECIDE");
    const noProfile = { ...data, stages: data.stages.filter((s) => s !== "PROFILE") };
    expect(sceneSvg(noProfile, 0.5)).not.toContain(">Profile<");
    expect(sceneSvg(data, 0.5)).toContain(">Profile<");
  });

  it("reads the sender's name from an email chunk prefix", () => {
    expect(senderOf("[email-0412.eml · from Purchasing, Hotel Group <purchasing@hotelgroup.example> · to x · Standing order]")).toBe(
      "Purchasing, Hotel Group",
    );
    expect(senderOf("[notes.docx · 1. Roasting]")).toBeNull();
  });
});

describe("pipeline scene", () => {
  it("is a pure function of time and loops in under 15 s", () => {
    expect(LOOP_SECONDS).toBeLessThanOrEqual(PIPELINE_LIMITS.seconds);
    expect(SCENES.at(-1)?.end).toBe(LOOP_SECONDS);
    expect(sceneSvg(data, 5.5, { theme: "dark" })).toBe(sceneSvg(data, 5.5 + LOOP_SECONDS, { theme: "dark" }));
  });

  it("puts every scene's numbers on screen, with no unfilled values", () => {
    const at = (key: string) => {
      const s = SCENES.find((x) => x.key === key);
      return sceneSvg(data, (s?.end ?? 0) - 0.3);
    };
    expect(at("facts")).toContain("−17.9%");
    expect(at("facts")).toContain(data.change.pct.id);
    expect(at("driver")).toContain("Driver by channel: wholesale");
    expect(at("evidence")).toContain("email-0412.eml");
    expect(at("verify")).toContain("V8");
    const poster = sceneSvg(data, POSTER_SECONDS);
    expect(poster).toContain(data.action.low.id);
    expect(poster).toContain("+$3,995 to +$7,191");
    for (let t = 0; t < LOOP_SECONDS; t += 0.25) expect(sceneSvg(data, t)).not.toMatch(/NaN|undefined|\{\{N/);
  });

  it("never sets type below 18 px (labels); body text is 22 px or more", () => {
    for (let t = 0; t < LOOP_SECONDS; t += 0.2) {
      const sizes = [...sceneSvg(data, t).matchAll(/font-size="(\d+)"/g)].map((m) => Number(m[1]));
      expect(Math.min(...sizes), `t=${t.toFixed(1)}`).toBeGreaterThanOrEqual(18);
    }
    // The body lines: the cited quote, the action and the verifier summary.
    const evidence = sceneSvg(data, (SCENES.find((s) => s.key === "evidence")?.end ?? 0) - 0.3);
    expect(evidence).toMatch(/font-size="22">“After the new price list/);
    expect(sceneSvg(data, POSTER_SECONDS)).toMatch(/font-size="22">Offer wholesale/);
  });

  it("wraps text by words", () => {
    expect(wrap("one two three four", 9)).toEqual(["one two", "three", "four"]);
  });
});

describe("pipeline asset rules", () => {
  // A 960×720 GIF header, then the trailer.
  const gif = (w: number) => new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, w & 0xff, w >> 8, 0xd0, 0x02, 0, 0, 0, 0x3b]);
  const png = (w: number) =>
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, w >> 8, w & 0xff, 0, 0, 2, 0xd0]);
  const ok = {
    manifest: { inputs: "h" },
    inputs: "h",
    gifs: { "a.gif": gif(960) },
    pngs: { "a.png": png(960) },
    seconds: () => 14.8,
  };

  it("reads GIF and PNG dimensions", () => {
    expect(gifDimensions(gif(960))).toEqual({ width: 960, height: 720 });
    expect(pngDimensions(png(960))).toEqual({ width: 960, height: 720 });
  });

  it("passes a fresh, small, short recording", () => {
    expect(pipelineProblems(ok)).toEqual([]);
  });

  it("flags stale, missing, long, large and narrow files", () => {
    expect(pipelineProblems({ ...ok, inputs: "changed" })[0]).toMatch(/stale/);
    expect(pipelineProblems({ ...ok, manifest: undefined })[0]).toMatch(/missing/);
    expect(pipelineProblems({ ...ok, seconds: () => 15.04 })[0]).toMatch(/lasts 15.0 s/);
    const big = new Uint8Array(3 * 1024 * 1024 + 1);
    big.set(gif(960));
    expect(pipelineProblems({ ...ok, gifs: { "a.gif": big } })).toContain("a.gif is larger than 3 MB");
    expect(pipelineProblems({ ...ok, gifs: { "a.gif": gif(480) } })[0]).toMatch(/narrower/);
    expect(pipelineProblems({ ...ok, pngs: { "a.png": undefined } })[0]).toMatch(/missing/);
  });
});
