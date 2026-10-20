// README visuals (docs/DOCS-SITE.md §3): every asset is generated here, so none can drift from the product.
//   bun run readme:assets   → write the hero SVGs, the generated blocks of README.md and docs/ARCHITECTURE.md, and
//                             evals/RESULTS.md (from evals/results/*.json)
//   bun run readme:check    → fail on drift, on hero rule violations, and on the demo and pipeline GIF limits
//                             (inside `bun run check`)
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { type Passes, resultsPage, runStatus } from "../../evals/runner/src/index.ts";
import { DARK, heroSvg, LIGHT } from "./hero.ts";
import { pipelineInputsHash, pipelinePicture, pipelineProblems, readPipelineData } from "./pipeline.ts";

const ROOT = join(import.meta.dirname, "..", "..");
export const DOCS_URL = "https://gfirik.github.io/agentic-analytics/";

/** Replaces the text between `<!-- name:start -->` and `<!-- name:end -->`; the markers must exist. */
export function inject(text: string, name: string, body: string): string {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const i = text.indexOf(start);
  const j = text.indexOf(end);
  if (i < 0 || j < i) throw new Error(`missing ${start} … ${end}`);
  return `${text.slice(0, i + start.length)}\n${body.trimEnd()}\n${text.slice(j)}`;
}

const mermaid = (file: string) => `\`\`\`mermaid\n${readFileSync(join(ROOT, "docs/assets/diagrams", file), "utf8").trimEnd()}\n\`\`\``;

interface Problem {
  readonly problem: string;
  readonly before: string;
  readonly after: string;
  readonly docs: string;
  readonly source: string;
}

export function problemsTable(): string {
  const { rows } = parse(readFileSync(join(ROOT, "scripts/readme-assets/problems.yaml"), "utf8")) as { rows: Problem[] };
  const cell = (s: string) => s.replace(/\|/g, "\\|");
  return [
    "| Problem | Typical AI analyst | agentic-analytics |",
    "|---|---|---|",
    ...rows.map((r) => `| **${cell(r.problem)}** | ${cell(r.before)} | ${cell(r.after)} [How →](${DOCS_URL}${r.docs}) |`),
  ].join("\n");
}

interface ResultFile {
  readonly suite: string;
  readonly model: string;
  readonly note?: string;
  readonly datasets: number;
  readonly date?: string;
  readonly seconds: number;
  readonly tokens: { readonly input: number; readonly output: number };
  readonly bars: { readonly metric: string; readonly value?: number }[];
  readonly passes?: Passes;
}

/**
 * Real-model results only (EVALS §4): the scripted baseline checks plumbing and is never shown as model quality.
 * With no real-model result the table has one row saying so and no numbers.
 */
export function evalsTable(dir = join(ROOT, "evals/results")): string {
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as ResultFile)
        // The real-data tier has its own table (realDataTable).
        .filter((r) => !r.model.startsWith("baseline") && r.suite !== "real")
    : [];
  const head = [
    "| Model | Suite | Jobs completed | Planted recall@5 | Driver accuracy | Number mismatches | Citation precision | Cost / time | Hardware | Date |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  if (!files.length) return [...head, "| real-model results not yet run | | | | | | | | | |"].join("\n");
  const pct = (r: ResultFile, m: string) => {
    const v = r.bars.find((b) => b.metric === m)?.value;
    return v === undefined || v === null ? "n/a" : `${(v * 100).toFixed(0)}%`;
  };
  const num = (r: ResultFile, m: string) => String(r.bars.find((b) => b.metric === m)?.value ?? "n/a");
  return [
    ...head,
    ...files.map((r) => {
      const hosted = hostOf(r.model);
      const tokens = r.tokens.input + r.tokens.output;
      // A run whose jobs didn't all finish (a free tier's daily quota) is labelled partial: its rates count the
      // unfinished jobs as misses, so they are not the model's quality. A run carried over nightly passes is partial
      // only once its last pass is done; before that its unfinished jobs are still to run (EVALS §4).
      const done = Math.round((r.bars.find((b) => b.metric === "Jobs completed")?.value ?? 1) * r.datasets);
      const status = runStatus(done, r.datasets, r.passes);
      const suite =
        status === "partial"
          ? `${r.suite} (${r.datasets}), **partial: ${done} of ${r.datasets} jobs finished**`
          : status === "resuming"
            ? `${r.suite} (${r.datasets}), **in progress: ${done} of ${r.datasets} jobs finished, the next pass runs the rest**`
            : `${r.suite} (${r.datasets})`;
      return `| ${r.model.replace(/^openai-compatible:/, "")} | ${suite} | ${pct(r, "Jobs completed")} | ${pct(r, "Planted recall@5")} | ${pct(r, "Driver accuracy")} | ${num(r, "Number mismatches")} | ${pct(r, "Citation precision")} | ${Math.round(r.seconds / 60)} min, ${Math.round(tokens / 1000)}k tokens | ${hosted} | ${r.date ?? "n/a"} |`;
    }),
  ].join("\n");
}

/** Where a run's model ran, from its model string: a vLLM label names its hardware (aa eval --label). */
export function hostOf(model: string): string {
  const vllm = /^vllm \(([^)]+)\)/i.exec(model);
  if (vllm) return `${vllm[1]} (self-hosted vLLM)`;
  if (model.includes(":groq:")) return "Groq free tier (hosted)";
  if (model.startsWith("ollama")) return "local (see note)";
  return "hosted";
}

interface RealResultFile {
  readonly suite: "real";
  readonly model: string;
  readonly date: string;
  readonly datasets: {
    readonly title: string;
    readonly publisher: string;
    readonly licence: string;
    readonly citation: string;
    readonly completed: boolean;
    readonly checks: { readonly id: string; readonly about: string; readonly pass: boolean }[];
  }[];
}

/**
 * The real-data demo (evals/real): the latest committed run, one row per check, with each dataset's credit (CC BY
 * 4.0 requires it wherever numbers derived from the data appear). Nothing here needs the downloaded files.
 */
export function realDataTable(dir = join(ROOT, "evals/results")): string {
  const runs = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith("-real.json"))
        .sort()
        .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as RealResultFile)
    : [];
  const r = runs.filter((x) => x.model === "baseline").at(-1) ?? runs.at(-1);
  if (!r) return "_No real-data run yet: `bun run eval:real:fetch && bun run eval:real`._";
  const cell = (s: string) => s.replace(/\|/g, "\\|");
  const rows = r.datasets.flatMap((d) => d.checks.map((c) => `| ${cell(d.title)} | ${cell(c.about)} | ${c.pass ? "pass" : "**fail**"} |`));
  const passed = r.datasets.flatMap((d) => d.checks).filter((c) => c.pass).length;
  const total = r.datasets.flatMap((d) => d.checks).length;
  return [
    `${passed} of ${total} checks pass (${r.model === "baseline" ? "offline baseline, no language model" : r.model}, ${r.date}). Each check reads only report.json; its expected numbers come from SQL in [evals/real/answers](evals/real/answers).`,
    "",
    "| Dataset | Check | Result |",
    "|---|---|---|",
    ...rows,
    "",
    ...r.datasets.map((d) => `- ${cell(d.title)} (${cell(d.publisher)}, ${licenceLink(d.licence)}): ${cell(d.citation)}`),
  ].join("\n");
}

/**
 * The README's status line (M13j): what is proven leads (the real public data, a free real model's smoke run, the
 * verifier), and the generated-business suite is described as the nightly regression check, its latest pass linked
 * rather than headlined. Every number comes from the committed results files.
 */
export function statusBlock(dir = join(ROOT, "evals/results")): string {
  const names = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
    : [];
  const read = <T>(suffix: string) => {
    const f = names.filter((n) => n.endsWith(suffix)).at(-1);
    return f ? (JSON.parse(readFileSync(join(dir, f), "utf8")) as T) : undefined;
  };
  const real = read<RealResultFile>("-baseline-real.json");
  const smoke = read<ResultFile>("-configured-small-smoke.json");
  const full = read<ResultFile>("-configured-small-full.json");
  const value = (r: ResultFile, m: string) => r.bars.find((b) => b.metric === m)?.value;
  const lines = ["> **Status: v0.1, early.** What is proven so far:", ">"];
  if (real) {
    const checks = real.datasets.flatMap((d) => d.checks);
    lines.push(
      `> - **Real public data:** ${checks.filter((c) => c.pass).length} of ${checks.length} checks pass on ${real.datasets.length} public datasets, each expected answer set by SQL written separately ([details](#real-public-data)).`,
    );
  }
  if (smoke) {
    const done = Math.round((value(smoke, "Jobs completed") ?? 0) * smoke.datasets);
    const wrong = value(smoke, "Number mismatches");
    const precision = value(smoke, "Citation precision");
    const model = smoke.model.replace(/^openai-compatible:groq:/, "").replace(/ \(small-model mode\)$/, "");
    const host = hostOf(smoke.model).replace(/ \((hosted|see note)\)$/, "");
    lines.push(
      `> - **A free real model:** ${model} (${host}) finished ${done} of ${smoke.datasets} smoke jobs${wrong === undefined ? "" : ` with ${wrong} wrong number${wrong === 1 ? "" : "s"}`}${precision === undefined ? "" : ` and ${(precision * 100).toFixed(0)}% citation precision`} ([details](#real-model-runs)).`,
    );
  }
  lines.push(
    "> - **Every report is verified:** before a report ships, the verifier recomputes every number and checks every citation. 500+ tests run with no model or key.",
  );
  if (full)
    lines.push(
      ">",
      `> ${full.datasets} generated businesses with planted events are the nightly regression check (one scheduled pass a night, within the free tier's daily quota); the latest published pass is in [Real-model runs](#real-model-runs), shown as it is. Plans: [docs/ROADMAP.md](docs/ROADMAP.md).`,
    );
  return lines.join("\n");
}

const LICENCES: Record<string, string> = { "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/" };
const licenceLink = (name: string) => (LICENCES[name] ? `[${name}](${LICENCES[name]})` : name);

/** Every generated file, as it must be on disk. */
export function expected(): Map<string, string> {
  const out = new Map<string, string>();
  out.set("docs/assets/readme/hero-light.svg", heroSvg(LIGHT, "light"));
  out.set("docs/assets/readme/hero-dark.svg", heroSvg(DARK, "dark"));
  let readme = readFileSync(join(ROOT, "README.md"), "utf8");
  readme = inject(readme, "diagram:pipeline-gif", pipelinePicture(readPipelineData()));
  readme = inject(readme, "diagram:architecture", mermaid("architecture.mmd"));
  readme = inject(readme, "diagram:pipeline", mermaid("pipeline.mmd"));
  readme = inject(readme, "status", statusBlock());
  readme = inject(readme, "table:problems", problemsTable());
  readme = inject(readme, "table:evals", evalsTable());
  readme = inject(readme, "table:real-data", realDataTable());
  out.set("README.md", readme);
  let arch = readFileSync(join(ROOT, "docs/ARCHITECTURE.md"), "utf8");
  arch = inject(arch, "diagram:architecture", mermaid("architecture.mmd"));
  arch = inject(arch, "diagram:pipeline", mermaid("pipeline.mmd"));
  out.set("docs/ARCHITECTURE.md", arch);
  // RESULTS.md from the same results files as the README table, so a results JSON copied in (the Kaggle notebook's)
  // updates both with one command, and neither can drift from evals/results.
  out.set("evals/RESULTS.md", resultsPage(join(ROOT, "evals/results")));
  return out;
}

/** Hero rules: under 100 KB, no script, no http(s) reference except the SVG namespace, motion only under no-preference. */
export function heroProblems(svg: string): string[] {
  const problems: string[] = [];
  if (Buffer.byteLength(svg) >= 100 * 1024) problems.push("larger than 100 KB");
  if (/<script/i.test(svg)) problems.push("contains <script>");
  if (/https?:\/\//.test(svg.replace('xmlns="http://www.w3.org/2000/svg"', ""))) problems.push("references an http(s) URL");
  const style = /<style>([\s\S]*?)<\/style>/.exec(svg)?.[1] ?? "";
  const media = /@media \(prefers-reduced-motion: no-preference\)\{([\s\S]*)\}\s*$/.exec(style.trim());
  const outside = media ? style.replace(media[0], "") : style;
  if (/animation/.test(outside)) problems.push("animation outside @media (prefers-reduced-motion: no-preference)");
  return problems;
}

/**
 * Total GIF duration in seconds: the sum of the Graphic Control Extension delays (1/100 s each), read by walking the
 * block structure (a byte scan would also match the marker inside compressed image data).
 */
export function gifSeconds(b: Uint8Array): number {
  const at = (i: number) => b[i] ?? 0;
  const skipSubBlocks = (i: number) => {
    let p = i;
    while (p < b.length && at(p) !== 0) p += at(p) + 1;
    return p + 1;
  };
  let p = 13; // header (6) + logical screen descriptor (7)
  if (at(10) & 0x80) p += 3 * 2 ** ((at(10) & 0x07) + 1); // global color table
  let cs = 0;
  while (p < b.length) {
    const block = at(p);
    if (block === 0x3b) return cs / 100; // trailer
    if (block === 0x21) {
      if (at(p + 1) === 0xf9 && at(p + 2) === 4) cs += at(p + 4) | (at(p + 5) << 8);
      p = skipSubBlocks(p + 2);
    } else if (block === 0x2c) {
      const flags = at(p + 9);
      p += 10;
      if (flags & 0x80) p += 3 * 2 ** ((flags & 0x07) + 1); // local color table
      p = skipSubBlocks(p + 1); // LZW minimum code size, then the image data
    } else break;
  }
  // No trailer: a truncated or malformed file can't be measured, so it fails the limit rather than under-counting.
  return Number.POSITIVE_INFINITY;
}

export function tapeProblems(tape: string): string[] {
  const problems: string[] = [];
  if (!/^Set Shell /m.test(tape)) problems.push("the tape must set its shell");
  if (!/PS1=/.test(tape)) problems.push("the tape must set a fixed PS1");
  if (!/^Hide[\s\S]*cd [^\n]+[\s\S]*^Show/m.test(tape)) problems.push("the tape must cd to a fixed working directory while hidden");
  if (/\/home\/|\/Users\/|~\//.test(tape)) problems.push("the tape contains a home path");
  return problems;
}

function check(): string[] {
  const problems: string[] = [];
  for (const [rel, content] of expected()) {
    const path = join(ROOT, rel);
    if (!existsSync(path) || readFileSync(path, "utf8") !== content) problems.push(`${rel} is out of date: run \`bun run readme:assets\``);
  }
  for (const v of ["light", "dark"]) {
    const path = join(ROOT, `docs/assets/readme/hero-${v}.svg`);
    if (existsSync(path)) for (const p of heroProblems(readFileSync(path, "utf8"))) problems.push(`hero-${v}.svg ${p}`);
  }
  const gif = join(ROOT, "docs/assets/readme/demo.gif");
  if (!existsSync(gif)) problems.push("docs/assets/readme/demo.gif is missing: run scripts/readme-assets/demo.sh");
  else {
    if (statSync(gif).size >= 5 * 1024 * 1024) problems.push("demo.gif is 5 MB or more");
    const s = gifSeconds(readFileSync(gif));
    if (s > 30) problems.push(`demo.gif lasts ${s.toFixed(1)} s (at most 30)`);
  }
  const asset = (f: string) => {
    const path = join(ROOT, "docs/assets/readme", f);
    return existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
  };
  const manifest = asset("pipeline-gif.json");
  for (const p of pipelineProblems({
    manifest: manifest ? (JSON.parse(Buffer.from(manifest).toString("utf8")) as { inputs: string }) : undefined,
    inputs: pipelineInputsHash(),
    gifs: { "pipeline-light.gif": asset("pipeline-light.gif"), "pipeline-dark.gif": asset("pipeline-dark.gif") },
    pngs: { "pipeline-light.png": asset("pipeline-light.png"), "pipeline-dark.png": asset("pipeline-dark.png") },
    seconds: gifSeconds,
  }))
    problems.push(p);
  for (const p of tapeProblems(readFileSync(join(ROOT, "scripts/readme-assets/demo.tape"), "utf8"))) problems.push(`demo.tape: ${p}`);
  return problems;
}

if (process.argv[1]?.endsWith("assets.ts")) {
  if (process.argv.includes("--write")) {
    for (const [rel, content] of expected()) writeFileSync(join(ROOT, rel), content);
    process.stdout.write("readme assets written\n");
  } else {
    const problems = check();
    for (const p of problems) process.stderr.write(`readme:check: ${p}\n`);
    process.stdout.write(problems.length ? "" : "readme:check: ok\n");
    process.exitCode = problems.length ? 1 : 0;
  }
}
