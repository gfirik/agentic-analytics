// The docs home's sections (DocsHome.astro): what each is for and where to start in it. Slugs are the docs' own.
export interface HomeLink {
  label: string;
  slug: string;
}
export interface HomeSection {
  id: string;
  title: string;
  summary: string;
  /** The page that opens the section. */
  slug: string;
  links: HomeLink[];
}

/** The four sections a reader chooses between, in reading order. */
export const MAIN_SECTIONS: HomeSection[] = [
  {
    id: "start",
    title: "Start",
    summary: "What the engine is, a first run on your own files, and how to run it on free models.",
    slug: "start/what-it-is",
    links: [
      { label: "What it is", slug: "start/what-it-is" },
      { label: "Quickstart", slug: "start/quickstart" },
      { label: "Your first report", slug: "start/first-report" },
      { label: "Running on free models", slug: "models/running-free" },
    ],
  },
  {
    id: "how-it-works",
    title: "How it works",
    summary: "The pipeline stage by stage: ingest, metrics, analysis, evidence, the verifier and the security model.",
    slug: "how-it-works/pipeline",
    links: [
      { label: "Pipeline overview", slug: "how-it-works/pipeline" },
      { label: "The verifier", slug: "how-it-works/verifier" },
      { label: "Finding drivers", slug: "how-it-works/drivers" },
      { label: "Security and prompt injection", slug: "how-it-works/security" },
    ],
  },
  {
    id: "learn",
    title: "Learn",
    summary: "A beginner's path on one small business's files: concepts, tutorials and a glossary.",
    slug: "learn",
    links: [
      { label: "The big picture", slug: "learn" },
      { label: "Your first file", slug: "learn/tutorials/first-file" },
      { label: "Confirm metrics", slug: "learn/tutorials/confirm-metrics" },
      { label: "Glossary", slug: "learn/glossary" },
    ],
  },
  {
    id: "reference",
    title: "Reference",
    summary: "Configuration, the metric file format, the report schema and the report templates.",
    slug: "reference/overview",
    links: [
      { label: "Configuration", slug: "reference/config" },
      { label: "Metric YAML", slug: "reference/metric-yaml" },
      { label: "Report schema", slug: "reference/report-schema" },
      { label: "Templates", slug: "reference/templates" },
    ],
  },
];

/** The rest of the docs, as one line each. */
export const MORE_SECTIONS: HomeLink[] = [
  { label: "Use it: CLI, HTTP API, MCP, Telegram, viewer", slug: "use-it/overview" },
  { label: "Quality: evals and results", slug: "quality/evals" },
  { label: "Project: architecture, decisions, roadmap, changelog", slug: "project/architecture" },
];
