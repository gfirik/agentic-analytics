// The engine machine (DESIGN.md §6 "Engine machine"): the pipeline drawn as a factory line. This module is its data.
// The stations, their names and their order come from the same run as §1's pipeline stages
// (docs/assets/readme/pipeline.json, its event log's `stages`), grouped by one small mapping below.
// Nothing here computes or types a figure: every number shown is a stored value with its fact id, or a count the run
// recorded.
import type { PipelineData } from "../pipeline-scene.ts";
import type { StageFact, StageRow } from "./pipeline-stages.ts";

/** The Learn stage pages a station's sheet links to (apps/docs/src/content/docs/learn/stages/<slug>.mdx). */
export const LEARN_STAGES = [
  "analysis",
  "ingestion",
  "metric-layer",
  "models",
  "planner",
  "report",
  "retrieval",
  "security",
  "verifier",
  "web-lane",
] as const;
export type LearnStage = (typeof LEARN_STAGES)[number];

/** How a station is drawn (machine-scene.ts). */
export type MachineKind = "doors" | "code" | "model" | "analysis" | "verify" | "render";
export type ModelRole = "planner" | "extractor" | "judge";

export type StationKey =
  | "doors"
  | "ingest"
  | "profile"
  | "metrics"
  | "analysis"
  | "index"
  | "web"
  | "explain"
  | "decide"
  | "verify"
  | "render";
export type SideKey = "vault" | "models";

/** The one mapping from the run's engine stages to the machine's stations (several stages can share one station). */
export const STATION_OF_STAGE: Readonly<Record<string, StationKey>> = {
  INGEST: "ingest",
  PROFILE: "profile",
  METRICS_DRAFT: "metrics",
  AWAIT_CONFIRM: "metrics",
  MEASURE: "analysis",
  DETECT: "analysis",
  DECOMPOSE: "analysis",
  INDEX_DOCS: "index",
  WEB_CONTEXT: "web",
  EXPLAIN: "explain",
  DECIDE: "decide",
  VERIFY: "verify",
  RENDER: "render",
};

interface Info {
  /** The engine's own name for the station. */
  readonly name: string;
  /** Its name in plain words. */
  readonly simple: string;
  /** What it does, in one plain sentence, then one more. */
  readonly plain: readonly [string, string];
  readonly kind: MachineKind;
  /** The model roles it calls (drawn as dashed cables to the model room); none means plain code. */
  readonly calls: readonly ModelRole[];
  /** Its Learn stage pages, the first one the main link. */
  readonly learn: readonly [LearnStage, ...LearnStage[]];
  /** Drawn on a spur off the line (optional stations). */
  readonly spur?: true;
}

/** Each station's wording, drawing and Learn pages, in one place. Wording only: no figures. */
export const STATION_INFO: Readonly<Record<StationKey | SideKey, Info>> = {
  doors: {
    name: "Doors",
    simple: "Your files go in",
    plain: [
      "Where you hand over your files.",
      "A terminal command, an HTTP API, an MCP server for AI assistants and a Telegram bot: whichever you use, the same job starts.",
    ],
    kind: "doors",
    calls: [],
    learn: ["ingestion"],
  },
  ingest: {
    name: "Ingest",
    simple: "Read the files",
    plain: [
      "Opens every file and finds the real tables in it.",
      "Titles, totals and several tables on one sheet are told apart; documents and emails are cut into sections. Every row remembers its file and row number.",
    ],
    kind: "code",
    calls: [],
    learn: ["ingestion"],
  },
  profile: {
    name: "Profile",
    simple: "Understand the columns",
    plain: [
      "Works out what each column means.",
      "Dates, money and its currency, customers; it flags problems such as duplicates or refunds, and screens cell text for instructions aimed at a model.",
    ],
    kind: "code",
    calls: [],
    learn: ["ingestion", "security"],
  },
  metrics: {
    name: "Metrics",
    simple: "Agree what to measure",
    plain: [
      "Decides what to measure, and lets you approve it.",
      "A model proposes each definition; code checks every column it names and compiles it to SQL, and you confirm or edit it before anything is measured.",
    ],
    kind: "model",
    calls: ["planner"],
    learn: ["metric-layer"],
  },
  analysis: {
    name: "Analysis",
    simple: "Calculate the numbers",
    plain: [
      "Every number is made here, by the database, not by a model.",
      "SQL computes each figure, tests a change against its own noise and splits it by who caused it. Each number is stored as a fact with an id, its query and the rows it read.",
    ],
    kind: "analysis",
    calls: [],
    learn: ["analysis"],
  },
  index: {
    name: "Index docs",
    simple: "Make documents searchable",
    plain: [
      "Makes your documents and emails searchable.",
      "Passages keep their exact source text, page and position. Text addressed to a model is screened and locked away first.",
    ],
    kind: "code",
    calls: [],
    learn: ["retrieval", "security"],
  },
  web: {
    name: "Web lane",
    simple: "Look things up online",
    plain: [
      "Optional: outside context, such as an industry benchmark.",
      "Before any search leaves your computer, customer names and amounts are removed from it; fetched pages are read only by the quarantined extractor.",
    ],
    kind: "code",
    calls: [],
    learn: ["web-lane", "security"],
    spur: true,
  },
  explain: {
    name: "Explain",
    simple: "Find out why",
    plain: [
      "A model looks for why things changed.",
      "It sees the list of facts with their ids, never the raw data, and works through a few fixed tools. It writes {{N…}} placeholders, never a number.",
    ],
    kind: "model",
    calls: ["planner", "extractor"],
    learn: ["planner", "security"],
  },
  decide: {
    name: "Decide",
    simple: "Suggest what to do",
    plain: [
      "A model suggests what to do next.",
      "What each action could be worth is a range computed by code, with the metric and the date that will show whether it worked.",
    ],
    kind: "model",
    calls: ["planner"],
    learn: ["planner"],
  },
  verify: {
    name: "Verify",
    simple: "Check everything",
    plain: [
      "Nothing reaches you until it passes.",
      "Its checks recompute every number from its SQL, find every quote in its file and drop or reword any claim they can't prove. A small judge model only confirms that a quote supports its claim.",
    ],
    kind: "verify",
    calls: ["judge"],
    learn: ["verifier"],
  },
  render: {
    name: "Render",
    simple: "Write the report",
    plain: [
      "Builds the final report.",
      "Each placeholder is filled with its checked fact; in the report, any number opens how it was computed.",
    ],
    kind: "render",
    calls: [],
    learn: ["report"],
  },
  vault: {
    name: "Workspace · job.duckdb",
    simple: "The job's database file",
    plain: [
      "One DuckDB file per job, where every station saves its work.",
      "Tables, facts, document passages, claims and checks live in it, and each stage is checkpointed there, so a job that stops resumes where it was.",
    ],
    kind: "code",
    calls: [],
    learn: ["report"],
  },
  models: {
    name: "Model room · planner · extractor · judge",
    simple: "The AI models",
    plain: [
      "Where the models work, each with one narrow job, behind glass.",
      "The planner drafts definitions, causes and actions; the extractor alone reads untrusted text; the judge checks quotes. They run on free endpoints or your own machine.",
    ],
    kind: "model",
    calls: [],
    learn: ["models", "security"],
  },
};

export interface Station {
  readonly key: StationKey | SideKey;
  /** "00"… for the stations on the line; empty for the vault and the model room. */
  readonly n: string;
  /** The engine stages behind it, in the order the run's event log reported them. */
  readonly stages: readonly string[];
  readonly info: Info;
  /** What it did in the recorded run: counts the run recorded, or facts with their ids. */
  readonly run: readonly StageRow[];
}

const fact = (f: { id: string; text: string }): StageFact => ({ id: f.id, text: f.text });

/** What each station did in the recorded run (only the run's own data, picked, never computed). */
function runRows(key: StationKey | SideKey, run: PipelineData): StageRow[] {
  const c = run.change;
  const d = run.driver;
  const v = run.verification;
  switch (key) {
    case "doors":
      return [
        { label: "Input folder", value: run.run.example },
        { label: "Files handed over", value: String(run.files.length) },
      ];
    case "ingest":
      return [
        { label: "Files read", value: String(run.files.length) },
        { label: "Tables found", value: String(run.profile.tables) },
        { label: "Document sections", value: String(run.profile.sections) },
      ];
    case "profile":
      return [{ label: "Data-quality issues", value: String(run.profile.issues) }];
    case "metrics":
      return [
        { label: run.metric.id, value: `${run.metric.formula}, per ${run.metric.grain}` },
        { label: "Status", value: run.metric.status },
      ];
    case "analysis":
      return [
        { label: `${c.metric}, ${c.fromPeriod}`, facts: [fact(c.from)] },
        { label: `${c.metric}, ${c.period}`, facts: [fact(c.to)] },
        { label: "Change", facts: [fact(c.delta), fact(c.pct)] },
        { label: `By ${d.dimension}: ${d.member}`, facts: [fact(d.delta), fact(d.share)] },
      ];
    case "index":
      return [
        { label: "Sections indexed", value: String(run.profile.sections) },
        ...run.docs.map((doc) => ({ label: doc.source_id, value: doc.file })),
      ];
    case "web":
      return run.web
        ? [
            { label: run.web.source_id, value: new URL(run.web.url).host },
            { label: "Gap to the benchmark", facts: [fact(run.web.gap)] },
            { label: "Source", value: run.run.web },
          ]
        : [{ label: "In this run", value: "off" }];
    case "explain": {
      const cause = run.docs.find((doc) => doc.grade === "document_supported") ?? run.docs[0];
      return cause
        ? [
            { label: "Cause found in", value: `${cause.source_id} · ${cause.file}` },
            { label: "Graded", value: (cause.grade ?? "ungraded").replace(/_/g, " ") },
          ]
        : [];
    }
    case "decide":
      return [
        { label: "Top action", value: run.action.text },
        { label: `Impact, ${run.action.horizon}`, facts: [fact(run.action.low), fact(run.action.high)] },
        { label: "Checked later by", value: run.action.check },
      ];
    case "verify":
      return [
        { label: "Numbers recomputed", value: `${v.numbers_checked} · ${v.numbers_mismatched} mismatched` },
        { label: "Citations checked", value: String(v.citations_checked) },
        { label: "Claims dropped · reworded", value: `${v.claims_dropped} · ${v.claims_downgraded}` },
      ];
    case "render":
      return [{ label: "Headline", value: run.headline }];
    case "vault":
      return [{ label: "Events recorded", value: String(run.run.events) }];
    case "models":
      return [{ label: "In this run", value: run.run.model }];
  }
}

/**
 * The stations on the line, in the order the run's event log reported their stages: the doors first (where a job
 * starts, before any stage), then one station per group of stages.
 */
export function machineStations(run: PipelineData): Station[] {
  const groups: { key: StationKey; stages: string[] }[] = [];
  for (const stage of run.stages) {
    const key = STATION_OF_STAGE[stage];
    if (!key) continue;
    const g = groups.find((x) => x.key === key);
    if (g) g.stages.push(stage);
    else groups.push({ key, stages: [stage] });
  }
  const line = [{ key: "doors" as StationKey, stages: [] as string[] }, ...groups];
  return line.map((g, i) => ({
    key: g.key,
    n: String(i).padStart(2, "0"),
    stages: g.stages,
    info: STATION_INFO[g.key],
    run: runRows(g.key, run),
  }));
}

/** The two pieces beside the line: the job's database file in front, the model room behind. */
export function sidePieces(run: PipelineData): Station[] {
  return (["vault", "models"] as const).map((key) => ({ key, n: "", stages: [], info: STATION_INFO[key], run: runRows(key, run) }));
}

/** One stop of the scroll tour: one piece, or a few neighbouring pieces seen together. */
export interface TourStop {
  /** The stop's id (its first piece's key). */
  readonly key: string;
  /** What the stop shows, in plain words (a single piece's stop uses the piece's own name). */
  readonly title: string;
  /** The pieces it shows and highlights, in line order (station and side-piece keys). */
  readonly members: readonly (StationKey | SideKey)[];
}

/**
 * The tour's groups (site v5, the maintainer's "quicker tour"): files in, read and understand, the database file,
 * calculate, explain and decide (with the model room), verify, report. Neighbouring stations share a stop, so the
 * camera makes seven moves instead of thirteen; every piece is still on one stop. Wording only: no figures.
 */
const TOUR_GROUPS: readonly { readonly title: string; readonly members: readonly (StationKey | SideKey)[] }[] = [
  { title: "Your files go in", members: ["doors"] },
  { title: "Read and understand the files", members: ["ingest", "profile"] },
  { title: "Everything is saved in one database file", members: ["vault"] },
  { title: "Agree what to measure, then calculate it", members: ["metrics", "analysis"] },
  { title: "Find out why, and suggest what to do", members: ["index", "web", "explain", "decide", "models"] },
  { title: "Check everything", members: ["verify"] },
  { title: "Write the report", members: ["render"] },
];

/**
 * The scroll tour's stops after the home view: the groups above, keeping only the pieces this run has (a station
 * the run never reached is not drawn), and any piece the groups miss as a stop of its own, so every piece is on
 * exactly one stop.
 */
export function tourStops(stations: readonly Station[]): TourStop[] {
  const present = new Set<string>([...stations.map((s) => s.key), "vault", "models"]);
  const out: TourStop[] = [];
  for (const g of TOUR_GROUPS) {
    const members = g.members.filter((k) => present.has(k));
    const first = members[0];
    if (!first) continue;
    const title = members.length === 1 ? STATION_INFO[first].simple : g.title;
    out.push({ key: first, title, members });
  }
  const seen = new Set(out.flatMap((s) => s.members));
  for (const s of stations) if (!seen.has(s.key)) out.push({ key: s.key, title: s.info.simple, members: [s.key] });
  return out;
}

/** What the 3D scene draws (machine-scene.ts SceneInput): each station's kind and model calls, and the verifier's checks with what each failed. */
export function sceneInput(run: PipelineData) {
  return {
    stations: machineStations(run).map((s) => ({
      key: s.key,
      kind: s.info.kind,
      calls: [...s.info.calls],
      ...(s.info.spur ? { spur: true } : {}),
    })),
    checks: run.checks.map((c) => ({ check: c.check, failed: c.failed })),
  };
}

/**
 * The still frames' sizes in pixels (scripts/site-assets.ts renders them; the page gives the same width and height): the
 * live section's home view in the stage beside its card (desktop) and on a phone's view.
 */
export const STILLS = { wide: [1600, 1160], tall: [720, 840] } as const satisfies Record<string, readonly [number, number]>;

/** The Learn page of a stage, under the site's base. */
export const learnPath = (slug: LearnStage) => `learn/stages/${slug}/`;
