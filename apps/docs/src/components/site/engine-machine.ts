// The engine machine (DESIGN.md §6 "Engine machine"): the pipeline drawn as a factory line. This module is its data.
// The stations, their names and their order come from the same run as §1's pipeline stages
// (docs/assets/readme/pipeline.json, its event log's `stages`), grouped by one small mapping below; "Follow" walks the
// run's own headline fact through its real inputs, from the exhibit's generated data (src/data/exhibit.json). Nothing
// here computes or types a figure: every number shown is a stored value with its fact id, or a count the run recorded.
import type { PipelineData } from "../pipeline-scene.ts";
import { firstSentence, type LinePart, placeholders } from "./exhibit.ts";
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
      "Eight checks recompute every number from its SQL, find every quote in its file and drop or reword any claim they can't prove. A small judge model only confirms that a quote supports its claim.",
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

/** The tour: every station in line order, the database file after the first station that writes to it, the model room before the first station after Explain that calls it. */
export function tourOrder(stations: readonly Station[]): (StationKey | SideKey)[] {
  const keys = stations.map((s) => s.key);
  const out: (StationKey | SideKey)[] = [];
  let vault = false;
  let models = false;
  for (const k of keys) {
    out.push(k);
    if (!vault && k !== "doors") {
      out.push("vault");
      vault = true;
    }
    if (!models && k === "explain") {
      out.push("models");
      models = true;
    }
  }
  if (!models) out.push("models");
  return out;
}

/** What the 3D scene draws (machine-scene.ts SceneInput): each station's kind and model calls, and the verifier's checks. */
export function sceneInput(run: PipelineData) {
  return {
    stations: machineStations(run).map((s) => ({
      key: s.key,
      kind: s.info.kind,
      calls: [...s.info.calls],
      ...(s.info.spur ? { spur: true } : {}),
    })),
    checks: run.checks.length,
  };
}

/** The static images' sizes in pixels (scripts/site-assets.ts renders them; the page gives the same width and height). */
export const STILLS = { strip: [2260, 340], full: [1600, 800] } as const satisfies Record<string, readonly [number, number]>;

/** The Learn page of a stage, under the site's base. */
export const learnPath = (slug: LearnStage) => `learn/stages/${slug}/`;

/** The exhibit's generated data, as far as "Follow" reads it (src/data/exhibit.json, scripts/landing-data.ts). */
export interface FollowExhibit {
  readonly lines: readonly (readonly LinePart[])[];
  readonly walk: readonly { readonly id: string }[];
  readonly notes: Readonly<
    Record<
      string,
      {
        readonly id: string;
        readonly kind: string;
        readonly label: string;
        readonly value: string;
        readonly verified: boolean;
        readonly sql?: readonly string[];
        readonly params?: readonly (readonly [string, string])[];
        readonly fn?: string;
        readonly inputs?: readonly { readonly id: string; readonly label: string; readonly value: string }[];
        readonly rows?: {
          readonly file: string;
          readonly columns: readonly string[];
          readonly rows: readonly { readonly row: number; readonly cells: readonly string[]; readonly cited: boolean }[];
          readonly count: number;
        };
        readonly quote?: string;
        readonly section?: string;
      }
    >
  >;
}
type Note = FollowExhibit["notes"][string];

/** One step of "Follow": the station it stops at, a short tag over that station, and what the step shows. */
export type FollowStep =
  | { readonly at: StationKey; readonly kind: "rows"; readonly badge: string; readonly title: string; readonly note: Note }
  | { readonly at: StationKey; readonly kind: "definition"; readonly badge: string; readonly title: string; readonly note: Note }
  | {
      readonly at: StationKey;
      readonly kind: "sql";
      readonly badge: string;
      readonly title: string;
      readonly note: Note;
      readonly head: Note;
    }
  | {
      readonly at: StationKey;
      readonly kind: "placeholders";
      readonly badge: string;
      readonly title: string;
      readonly sentence: string;
      readonly source?: Note;
    }
  | {
      readonly at: StationKey;
      readonly kind: "verify";
      readonly badge: string;
      readonly title: string;
      readonly head: Note;
      readonly recomputed: number;
    }
  | {
      readonly at: StationKey;
      readonly kind: "render";
      readonly badge: string;
      readonly title: string;
      readonly sentence: readonly LinePart[];
    };

export interface Follow {
  /** The headline fact the steps follow: the exhibit walkthrough's first step (chosen there by role). */
  readonly head: Note;
  readonly steps: readonly FollowStep[];
}

/**
 * "Follow": the run's headline fact from the sheet rows to the report. The headline is the exhibit walkthrough's first
 * figure (the percent change, chosen by role in landing-data.ts) and its input is the walkthrough's SQL step (the
 * newest period's query, with the sheet rows it read); the sentence is the report's first, as the model wrote it and
 * as the reader sees it.
 */
export function follow(run: PipelineData, ex: FollowExhibit): Follow {
  const head = ex.notes[ex.walk[0]?.id ?? ""];
  if (!head) throw new Error("engine machine: the exhibit has no headline step");
  const input =
    ex.walk.map((w) => ex.notes[w.id]).find((n) => n && n.kind === "sql" && n.rows && head.inputs?.some((i) => i.id === n.id)) ??
    (head.inputs ?? []).map((i) => ex.notes[i.id]).find((n) => n?.kind === "sql" && n.rows);
  if (!input?.rows) throw new Error(`engine machine: the headline ${head.id} has no SQL input with cited rows`);
  const sentence = firstSentence(ex.lines[0] ?? []);
  const source = Object.values(ex.notes).find((n) => n.kind === "source");
  const cited = input.rows.rows.find((r) => r.cited);
  const v2 = run.checks.find((c) => c.check === "V2");
  const steps: FollowStep[] = [
    { at: "ingest", kind: "rows", badge: `row ${cited?.row ?? ""}`.trim(), title: "It starts as rows in a spreadsheet", note: input },
    { at: "metrics", kind: "definition", badge: run.metric.id, title: "A definition you can read and approve", note: input },
    {
      at: "analysis",
      kind: "sql",
      badge: `${head.id} = ${head.value}`,
      title: "The database computes it and gives it an id",
      note: input,
      head,
    },
    {
      at: "explain",
      kind: "placeholders",
      badge: `{{${head.id}}}`,
      title: "The model writes a placeholder, not a number",
      sentence: placeholders(sentence),
      ...(source ? { source } : {}),
    },
    { at: "verify", kind: "verify", badge: `✓ ${head.id}`, title: "The verifier computes it again", head, recomputed: v2?.run ?? 0 },
    { at: "render", kind: "render", badge: `${head.value} ${head.id}`, title: `Only now does ${head.value} appear`, sentence },
  ];
  return { head, steps };
}
