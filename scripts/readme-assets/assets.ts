// README visuals (docs/DOCS-SITE.md §3): every asset is generated here, so none can drift from the product.
//   bun run readme:assets   → write the hero SVGs and the generated blocks of README.md and docs/ARCHITECTURE.md
//   bun run readme:check    → fail on drift, on hero rule violations, and on the demo and pipeline GIF limits
//                             (inside `bun run check`)
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
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
  readonly seconds: number;
  readonly tokens: { readonly input: number; readonly output: number };
  readonly bars: { readonly metric: string; readonly value?: number }[];
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
        .filter((r) => !r.model.startsWith("baseline"))
    : [];
  const head = [
    "| Model | Suite | Jobs completed | Planted recall@5 | Driver accuracy | Number mismatches | Citation precision | Cost / time | Hardware |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  if (!files.length) return [...head, "| real-model results not yet run | | | | | | | | |"].join("\n");
  const pct = (r: ResultFile, m: string) => {
    const v = r.bars.find((b) => b.metric === m)?.value;
    return v === undefined || v === null ? "n/a" : `${(v * 100).toFixed(0)}%`;
  };
  const num = (r: ResultFile, m: string) => String(r.bars.find((b) => b.metric === m)?.value ?? "n/a");
  return [
    ...head,
    ...files.map((r) => {
      const hosted = r.model.includes(":groq:") ? "Groq free tier (hosted)" : r.model.startsWith("ollama") ? "local (see note)" : "hosted";
      const tokens = r.tokens.input + r.tokens.output;
      return `| ${r.model.replace(/^openai-compatible:/, "")} | ${r.suite} (${r.datasets}) | ${pct(r, "Jobs completed")} | ${pct(r, "Planted recall@5")} | ${pct(r, "Driver accuracy")} | ${num(r, "Number mismatches")} | ${pct(r, "Citation precision")} | ${Math.round(r.seconds / 60)} min, ${Math.round(tokens / 1000)}k tokens | ${hosted} |`;
    }),
  ].join("\n");
}

/** Every generated file, as it must be on disk. */
export function expected(): Map<string, string> {
  const out = new Map<string, string>();
  out.set("docs/assets/readme/hero-light.svg", heroSvg(LIGHT, "light"));
  out.set("docs/assets/readme/hero-dark.svg", heroSvg(DARK, "dark"));
  let readme = readFileSync(join(ROOT, "README.md"), "utf8");
  readme = inject(readme, "diagram:pipeline-gif", pipelinePicture(readPipelineData()));
  readme = inject(readme, "diagram:architecture", mermaid("architecture.mmd"));
  readme = inject(readme, "diagram:pipeline", mermaid("pipeline.mmd"));
  readme = inject(readme, "table:problems", problemsTable());
  readme = inject(readme, "table:evals", evalsTable());
  out.set("README.md", readme);
  let arch = readFileSync(join(ROOT, "docs/ARCHITECTURE.md"), "utf8");
  arch = inject(arch, "diagram:architecture", mermaid("architecture.mmd"));
  arch = inject(arch, "diagram:pipeline", mermaid("pipeline.mmd"));
  out.set("docs/ARCHITECTURE.md", arch);
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
