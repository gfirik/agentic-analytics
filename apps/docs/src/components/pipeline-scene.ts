// The animated pipeline, as one pure function of time: sceneSvg(data, t) → the SVG frame at t seconds. The docs
// <Pipeline /> island plays it with requestAnimationFrame, and scripts/readme-assets/pipeline-gif.ts screenshots it
// frame by frame into the README GIFs, so the two can't drift. Every number and quote comes from `data`, which is
// extracted from a real engine run (apps/docs/scripts/pipeline-data.ts); this file only lays it out.
// Sized for a 640×480 canvas that stays legible when the GIF is shown 360 px wide: body type ≥ 22 px, a few
// words per frame. Colors are CSS custom properties (light by default, dark under `.dark` or Starlight's
// `data-theme="dark"`), so one frame serves both themes.

export interface ShownFact {
  readonly id: string;
  readonly value: number;
  readonly label: string;
  /** The stored value, formatted for reading (presentation only). */
  readonly text: string;
}

export interface PipelineData {
  readonly run: { readonly example: string; readonly model: string; readonly web: string; readonly events: number };
  /** Stages the run completed, in the order its event log reported them. */
  readonly stages: readonly string[];
  readonly files: readonly { readonly name: string; readonly kind: string }[];
  readonly profile: { readonly tables: number; readonly sections: number; readonly issues: number };
  readonly metric: {
    readonly id: string;
    readonly label: string;
    readonly formula: string;
    readonly grain: string;
    readonly currency: string | null;
    readonly status: string;
  };
  readonly change: {
    readonly metric: string;
    readonly fromPeriod: string;
    readonly period: string;
    readonly from: ShownFact;
    readonly to: ShownFact;
    readonly delta: ShownFact;
    readonly pct: ShownFact;
  };
  readonly driver: { readonly dimension: string; readonly member: string; readonly delta: ShownFact; readonly share: ShownFact };
  readonly docs: readonly {
    readonly source_id: string;
    readonly file: string;
    readonly kind: string;
    readonly at: string;
    readonly quote: string;
    readonly grade: string | null;
  }[];
  readonly web: { readonly source_id: string; readonly url: string; readonly quote: string; readonly gap: ShownFact } | null;
  readonly checks: readonly { readonly check: string; readonly name: string; readonly run: number; readonly failed: number }[];
  readonly verification: {
    readonly numbers_checked: number;
    readonly numbers_mismatched: number;
    readonly citations_checked: number;
    readonly claims_dropped: number;
    readonly claims_downgraded: number;
  };
  readonly headline: string;
  readonly action: {
    readonly id: string;
    readonly rank: number;
    readonly of: number;
    readonly text: string;
    readonly low: ShownFact;
    readonly high: ShownFact;
    readonly horizon: string;
    readonly confidence: string;
    readonly check: string;
  };
}

export const WIDTH = 640;
export const HEIGHT = 480;

/** The rail along the top: what the viewer tracks while the card below changes. */
export const RAIL = ["Files", "Profile", "Metric", "SQL", "Evidence", "Verify", "Report"] as const;

interface Scene {
  readonly key: string;
  readonly rail: number;
  readonly start: number;
  readonly end: number;
}

/** The loop: under 15 s, one scene per pipeline step (the driver and the SQL facts share the SQL node). */
export const SCENES: readonly Scene[] = [
  { key: "files", rail: 0, start: 0, end: 1.6 },
  { key: "profile", rail: 1, start: 1.6, end: 3.2 },
  { key: "metric", rail: 2, start: 3.2, end: 4.8 },
  { key: "facts", rail: 3, start: 4.8, end: 7.0 },
  { key: "driver", rail: 3, start: 7.0, end: 8.4 },
  { key: "evidence", rail: 4, start: 8.4, end: 10.4 },
  { key: "verify", rail: 5, start: 10.4, end: 12.2 },
  { key: "report", rail: 6, start: 12.2, end: 14.8 },
];
export const LOOP_SECONDS = 14.8;
/** The still frame (PNG fallback, reduced motion, server render): the finished report. */
export const POSTER_SECONDS = 14.3;

export const THEME_CSS = `
.pp{--pp-bg:#fbfaf7;--pp-card:#ffffff;--pp-ink:#1d1d1b;--pp-muted:#6b6a66;--pp-line:#d9d5cc;--pp-accent:#2d6a4f;
--pp-accent-ink:#ffffff;--pp-bad:#b42318;--pp-web:#6c3fa0;--pp-hl:#f6d77a;--pp-warn:#8a4f0f}
.pp.dark,:root[data-theme="dark"] .pp:not(.light){--pp-bg:#161614;--pp-card:#201f1c;--pp-ink:#ecebe6;--pp-muted:#a3a29c;
--pp-line:#3a3934;--pp-accent:#74c69d;--pp-accent-ink:#10140f;--pp-bad:#f08a7c;--pp-web:#c4a3f0;--pp-hl:#6b5418;--pp-warn:#f0b46c}
.pp text{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;fill:var(--pp-ink)}
.pp .mono{font-family:ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace}
.pp .muted{fill:var(--pp-muted)}
.pp .accent{fill:var(--pp-accent)}
.pp .bad{fill:var(--pp-bad)}
.pp .webc{fill:var(--pp-web)}
.pp .warn{fill:var(--pp-warn)}
.pp .on-accent{fill:var(--pp-accent-ink)}
.pp .bg{fill:var(--pp-bg)}
.pp .card{fill:var(--pp-card);stroke:var(--pp-line);stroke-width:2}
.pp .line{stroke:var(--pp-line);stroke-width:3;fill:none}
.pp .lit{stroke:var(--pp-accent);stroke-width:3;fill:none}
.pp .dot{fill:var(--pp-card);stroke:var(--pp-line);stroke-width:3}
.pp .dot.done{fill:var(--pp-accent);stroke:var(--pp-accent)}
.pp .dot.now{fill:var(--pp-card);stroke:var(--pp-accent);stroke-width:4}
.pp .packet{fill:var(--pp-hl);stroke:var(--pp-ink);stroke-width:1.5}
.pp .chip{fill:var(--pp-accent)}
.pp .chip-web{fill:var(--pp-web)}
.pp .hl{fill:var(--pp-hl)}
.pp .webline{stroke:var(--pp-web);stroke-width:2;fill:var(--pp-card)}
`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clamp = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => 1 - (1 - clamp(x)) ** 3;
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Greedy word wrap by character count (SVG text has no layout; the type is sized so this is safe). */
export function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/** Which scene is on screen at t, and how far into it (seconds). */
export function sceneAt(t: number): { scene: Scene; local: number } {
  const x = ((t % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS;
  const scene = SCENES.find((s) => x >= s.start && x < s.end) ?? (SCENES[SCENES.length - 1] as Scene);
  return { scene, local: x - scene.start };
}

interface Txt {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly text: string;
  readonly cls?: string;
  readonly weight?: number;
  readonly anchor?: "start" | "middle" | "end";
}
const txt = (o: Txt) =>
  `<text x="${r1(o.x)}" y="${r1(o.y)}" font-size="${o.size}"${o.weight ? ` font-weight="${o.weight}"` : ""}${
    o.anchor && o.anchor !== "start" ? ` text-anchor="${o.anchor}"` : ""
  }${o.cls ? ` class="${o.cls}"` : ""}>${esc(o.text)}</text>`;

/** Fades in (0.3 s) from `at`, sliding up 14 px; the whole scene fades out in its last 0.25 s. */
function group(local: number, at: number, dur: number, body: string, slide = 14): string {
  const k = ease((local - at) / 0.3);
  const out = clamp((dur - local) / 0.25);
  const o = r1(Math.min(k, out) * 100) / 100;
  if (o <= 0) return "";
  return `<g opacity="${o}" transform="translate(0 ${r1((1 - k) * slide)})">${body}</g>`;
}

/** A fact id stamped onto a number: it drops in slightly large and settles. */
function chip(x: number, y: number, id: string, local: number, at: number, cls = "chip"): string {
  const k = ease((local - at) / 0.35);
  if (k <= 0) return "";
  const w = 14 + id.length * 12.5;
  const s = r1((1.5 - 0.5 * k) * 100) / 100;
  return `<g opacity="${r1(k * 100) / 100}" transform="translate(${r1(x)} ${r1(y)}) scale(${s})"><rect x="0" y="-17" width="${r1(w)}" height="26" rx="6" class="${cls}"/>${txt({ x: w / 2, y: 3, size: 19, text: id, cls: "mono on-accent", weight: 700, anchor: "middle" })}</g>`;
}

const RAIL_Y = 40;
// Inset so the bold active label stays off the edge even with wider fallback fonts (DejaVu on CI).
const railX = (i: number) => 60 + i * ((WIDTH - 120) / (RAIL.length - 1));

function rail(scene: Scene, local: number): string {
  const lines = RAIL.slice(1).map((_, i) => {
    const x1 = railX(i) + 11;
    const x2 = railX(i + 1) - 11;
    return `<line x1="${r1(x1)}" y1="${RAIL_Y}" x2="${r1(x2)}" y2="${RAIL_Y}" class="${i < scene.rail ? "lit" : "line"}"/>`;
  });
  const dots = RAIL.map((label, i) => {
    const cls = i < scene.rail ? "dot done" : i === scene.rail ? "dot now" : "dot";
    return `<circle cx="${r1(railX(i))}" cy="${RAIL_Y}" r="10" class="${cls}"/>${txt({
      x: railX(i),
      y: RAIL_Y + 34,
      size: 17,
      text: label,
      cls: i === scene.rail ? "accent" : "muted",
      weight: i === scene.rail ? 700 : 400,
      anchor: "middle",
    })}`;
  });
  // Data moving on: in a scene's last 0.45 s a packet runs to the next node.
  const next = SCENES[SCENES.indexOf(scene) + 1];
  let packet = "";
  const go = (local - (scene.end - scene.start - 0.45)) / 0.45;
  if (next && next.rail !== scene.rail && go > 0) {
    const x = railX(scene.rail) + (railX(next.rail) - railX(scene.rail)) * ease(go);
    packet = `<circle cx="${r1(x)}" cy="${RAIL_Y}" r="8" class="packet"/>`;
  }
  return lines.join("") + dots.join("") + packet;
}

const title = (step: string, words: string) =>
  txt({ x: 40, y: 128, size: 17, text: step, cls: "muted", weight: 700 }) + txt({ x: 40, y: 162, size: 30, text: words, weight: 700 });

function files(d: PipelineData, local: number, dur: number): string {
  const rows = d.files
    .slice(0, 5)
    .map((f, i) =>
      group(
        local,
        0.1 + i * 0.15,
        dur,
        `<rect x="40" y="${192 + i * 58}" width="560" height="46" rx="10" class="card"/>${txt({ x: 60, y: 223 + i * 58, size: 23, text: f.name, cls: "mono" })}${txt({ x: 580, y: 223 + i * 58, size: 20, text: f.kind, cls: "muted", anchor: "end" })}`,
        -40,
      ),
    );
  return group(local, 0, dur, title("YOUR FILES", `${d.files.length} files in`)) + rows.join("");
}

function stat(x: number, n: number, label: string, local: number, at: number, dur: number): string {
  return group(
    local,
    at,
    dur,
    `<rect x="${x}" y="200" width="172" height="170" rx="12" class="card"/>${txt({ x: x + 86, y: 292, size: 64, text: String(n), weight: 700, anchor: "middle", cls: "accent" })}${txt({ x: x + 86, y: 336, size: 22, text: label, anchor: "middle", cls: "muted" })}`,
  );
}

function profile(d: PipelineData, local: number, dur: number): string {
  return (
    group(local, 0, dur, title("PROFILE", "Tables found, text parsed")) +
    stat(40, d.profile.tables, "tables", local, 0.15, dur) +
    stat(234, d.profile.sections, "doc sections", local, 0.3, dur) +
    stat(428, d.profile.issues, "data issues", local, 0.45, dur)
  );
}

function metric(d: PipelineData, local: number, dur: number): string {
  const m = d.metric;
  const stamp = m.status === "assumed" ? "KEPT AS ASSUMPTION (--yes)" : "CONFIRMED";
  const k = ease((local - 0.7) / 0.3);
  return (
    group(local, 0, dur, title("METRIC DEFINITION", "Shown in plain words")) +
    group(
      local,
      0.15,
      dur,
      `<rect x="40" y="196" width="560" height="160" rx="12" class="card"/>${txt({ x: 64, y: 248, size: 34, text: m.label, weight: 700 })}${txt({ x: 64, y: 292, size: 26, text: `= ${m.formula}`, cls: "mono" })}${txt({ x: 64, y: 330, size: 22, text: `per ${m.grain}${m.currency ? ` · ${m.currency}` : ""}`, cls: "muted" })}`,
    ) +
    (k > 0 && local < dur
      ? `<g opacity="${r1(Math.min(k, clamp((dur - local) / 0.25)) * 100) / 100}"><rect x="40" y="378" width="${14 + stamp.length * 13}" height="40" rx="8" class="chip"/>${txt({ x: 54, y: 405, size: 20, text: stamp, cls: "on-accent", weight: 700 })}</g>`
      : "")
  );
}

function facts(d: PipelineData, local: number, dur: number): string {
  const c = d.change;
  return (
    group(local, 0, dur, title("ANALYSIS · DuckDB SQL", `${c.metric}, month on month`)) +
    group(
      local,
      0.15,
      dur,
      `${txt({ x: 40, y: 214, size: 20, text: c.fromPeriod, cls: "muted" })}${txt({ x: 40, y: 256, size: 38, text: c.from.text, weight: 700 })}${txt({ x: 320, y: 248, size: 34, text: "→", cls: "muted", anchor: "middle" })}${txt({ x: 380, y: 214, size: 20, text: c.period, cls: "muted" })}${txt({ x: 380, y: 256, size: 38, text: c.to.text, weight: 700 })}`,
    ) +
    chip(40, 290, c.from.id, local, 0.55) +
    chip(380, 290, c.to.id, local, 0.75) +
    group(
      local,
      1.0,
      dur,
      `${txt({ x: 40, y: 392, size: 84, text: c.pct.text, weight: 800, cls: "bad" })}${txt({ x: 380, y: 368, size: 26, text: c.delta.text, weight: 700, cls: "bad" })}`,
    ) +
    chip(40, 436, c.pct.id, local, 1.35) +
    chip(380, 404, c.delta.id, local, 1.5)
  );
}

function driver(d: PipelineData, local: number, dur: number): string {
  const v = d.driver;
  return (
    group(local, 0, dur, title(`DECOMPOSE · by ${v.dimension}`, `Driver: ${v.member}`)) +
    group(
      local,
      0.15,
      dur,
      `<rect x="40" y="196" width="560" height="190" rx="12" class="card"/>${txt({ x: 64, y: 268, size: 56, text: v.delta.text, weight: 800, cls: "bad" })}${txt({ x: 64, y: 344, size: 40, text: v.share.text, weight: 700 })}${txt({ x: 64 + v.share.text.length * 24 + 12, y: 344, size: 24, text: "of the drop", cls: "muted" })}`,
    ) +
    chip(460, 252, v.delta.id, local, 0.5) +
    chip(460, 330, v.share.id, local, 0.7)
  );
}

const quoteLines = (quote: string) => wrap(`“${quote}”`, 40).slice(0, 3);
const quoteHeight = (quote: string) => 66 + quoteLines(quote).length * 28;

function quoteCard(y: number, head: string, quote: string, src: string, local: number, at: number, dur: number, web: boolean): string {
  const lines = quoteLines(quote);
  // A highlighter sweeps across the quote: the citation resolving to its exact span.
  const sweep = ease((local - at - 0.35) / 0.6);
  const marks = lines
    .map(
      (l, i) => `<rect x="60" y="${y + 46 + i * 28}" width="${r1(Math.min(l.length * 12.6, 524) * sweep)}" height="25" rx="3" class="hl"/>`,
    )
    .join("");
  return group(
    local,
    at,
    dur,
    `<rect x="40" y="${y}" width="560" height="${quoteHeight(quote)}" rx="12" class="${web ? "webline" : "card"}"/>${txt({ x: 60, y: y + 30, size: 19, text: head, weight: 700, cls: web ? "webc" : "accent" })}${txt({ x: 580, y: y + 30, size: 19, text: src, cls: "mono muted", anchor: "end" })}${marks}${lines
      .map((l, i) => txt({ x: 64, y: y + 65 + i * 28, size: 22, text: l }))
      .join("")}`,
  );
}

function evidence(d: PipelineData, local: number, dur: number): string {
  // The customer's own email first (the document that explains the driver), then the web lane's labelled quote.
  const doc = d.docs.find((x) => x.kind === "email") ?? d.docs[0];
  const docCard = doc ? quoteCard(180, doc.file, doc.quote, doc.source_id, local, 0.15, dur, false) : "";
  const webCard = d.web
    ? quoteCard(
        doc ? 180 + quoteHeight(doc.quote) + 14 : 180,
        `EXTERNAL · ${d.web.url.replace(/^https?:\/\//, "").split("/")[0] ?? ""}`,
        d.web.quote,
        d.web.source_id,
        local,
        0.9,
        dur,
        true,
      )
    : "";
  return group(local, 0, dur, title("EVIDENCE · documents + web", "Why it changed, cited")) + docCard + webCard;
}

function verify(d: PipelineData, local: number, dur: number): string {
  const rows = d.checks.map((c, i) => {
    const col = i < 4 ? 0 : 1;
    const row = i % 4;
    const x = 40 + col * 288;
    const y = 214 + row * 56;
    const at = 0.2 + i * 0.16;
    const ok = c.failed === 0;
    const k = ease((local - at - 0.15) / 0.2);
    const mark =
      k > 0 ? txt({ x: x + 262, y: y + 6, size: 26, text: ok ? "✓" : "✎", cls: ok ? "accent" : "warn", weight: 800, anchor: "end" }) : "";
    const count = ok ? `${c.run}` : `${c.failed} flagged`;
    return group(
      local,
      at,
      dur,
      `<rect x="${x}" y="${y - 30}" width="272" height="48" rx="10" class="card"/>${txt({ x: x + 14, y: y + 3, size: 21, text: c.check, weight: 800, cls: "mono" })}${txt({ x: x + 56, y: y + 3, size: 19, text: c.name })}${txt({ x: x + 230, y: y + 3, size: 17, text: count, cls: ok ? "muted" : "warn", anchor: "end" })}${mark}`,
      8,
    );
  });
  const v = d.verification;
  return (
    group(local, 0, dur, title("VERIFIER · V1–V8", `${v.numbers_checked} numbers recomputed`)) +
    rows.join("") +
    group(
      local,
      1.5,
      dur,
      txt({
        x: 40,
        y: 446,
        size: 20,
        text: `${v.numbers_mismatched} mismatches · ${v.citations_checked} citations checked · ${v.claims_dropped} dropped`,
        cls: "muted",
      }),
    )
  );
}

function report(d: PipelineData, local: number, dur: number): string {
  const head = wrap(d.headline, 40).slice(0, 3);
  const act = wrap(d.action.text, 42).slice(0, 3);
  const top = 180 + head.length * 34;
  const h = 118 + act.length * 28;
  const a = d.action;
  const impactY = top + 76 + act.length * 28;
  return (
    group(local, 0, dur, txt({ x: 40, y: 128, size: 17, text: "REPORT · verified, cited", cls: "muted", weight: 700 })) +
    group(local, 0.1, dur, head.map((l, i) => txt({ x: 40, y: 162 + i * 34, size: 26, text: l, weight: 700 })).join("")) +
    group(
      local,
      0.5,
      dur,
      `<rect x="40" y="${top}" width="560" height="${h}" rx="12" class="card"/><rect x="40" y="${top}" width="8" height="${h}" rx="4" class="chip"/>${txt({ x: 66, y: top + 32, size: 19, text: `#${a.rank} ACTION of ${a.of} · ${a.confidence} confidence`, cls: "accent", weight: 700 })}${act
        .map((l, i) => txt({ x: 66, y: top + 64 + i * 28, size: 21, text: l }))
        .join(
          "",
        )}${txt({ x: 66, y: impactY, size: 27, text: `+${a.low.text} to +${a.high.text}`, weight: 800, cls: "accent" })}${txt({ x: 66, y: impactY + 26, size: 18, text: a.horizon, cls: "muted" })}`,
    ) +
    chip(420, impactY - 6, a.low.id, local, 1.0) +
    chip(510, impactY - 6, a.high.id, local, 1.15)
  );
}

const RENDER: Record<string, (d: PipelineData, local: number, dur: number) => string> = {
  files,
  profile,
  metric,
  facts,
  driver,
  evidence,
  verify,
  report,
};

/** Alt text / aria-label: the whole story in words, from the same data. */
export function altText(d: PipelineData): string {
  const doc = d.docs.find((x) => x.kind === "email") ?? d.docs[0];
  return [
    `Animated pipeline on ${d.run.example} (a real engine run, scripted planner, no LLM): ${d.files.map((f) => f.name).join(", ")} flow in;`,
    `profiling finds ${d.profile.tables} tables and ${d.profile.sections} document sections; the ${d.metric.label} metric is defined in plain words;`,
    `DuckDB SQL computes ${d.change.metric} ${d.change.from.text} in ${d.change.fromPeriod} and ${d.change.to.text} in ${d.change.period}, ${d.change.pct.text} (fact ${d.change.pct.id});`,
    `the driver is ${d.driver.member} (${d.driver.delta.text}, ${d.driver.share.text} of the drop);`,
    doc ? `${doc.file} is cited: “${doc.quote}”;` : "",
    d.web ? `a web benchmark is cited and labelled External;` : "",
    `the verifier runs V1–V8 and recomputes ${d.verification.numbers_checked} numbers with ${d.verification.numbers_mismatched} mismatches;`,
    `the report's top-ranked action: ${d.action.text} (+${d.action.low.text} to +${d.action.high.text}, ${d.action.horizon}).`,
  ]
    .filter(Boolean)
    .join(" ");
}

export interface SceneOptions {
  /** "light" / "dark" pin the palette (the GIF recorder); "auto" follows Starlight's data-theme. */
  readonly theme?: "light" | "dark" | "auto";
  /** Rendered width in CSS px (the viewBox stays 640×480). */
  readonly width?: number | string;
}

/** The frame at t seconds (looping every LOOP_SECONDS). Pure: same data and t, same SVG. */
export function sceneSvg(d: PipelineData, t: number, o: SceneOptions = {}): string {
  const { scene, local } = sceneAt(t);
  const dur = scene.end - scene.start;
  const theme = o.theme ?? "auto";
  const cls = theme === "auto" ? "pp" : `pp ${theme}`;
  const w = o.width ?? "100%";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${w}" class="${cls}" role="img" aria-label="${esc(altText(d))}"><style>${THEME_CSS}</style><rect width="${WIDTH}" height="${HEIGHT}" rx="16" class="bg"/>${rail(scene, local)}${RENDER[scene.key]?.(d, local, dur) ?? ""}</svg>`;
}
