// The README "How it works" GIF (docs/DOCS-SITE.md §3.3): its limits, its <picture> block and the hash that ties
// the recorded files to the data and scene they were recorded from. Recording: pipeline-gif.ts.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { altText, type PipelineData } from "../../apps/docs/src/components/pipeline-scene.ts";

export const ROOT = join(import.meta.dirname, "..", "..");
export const PIPELINE_FPS = 12.5;
/** Device scale for the screenshots: the 640×480 scene is recorded at 960×720. */
export const PIPELINE_SCALE = 1.5;
export const PIPELINE_LIMITS = { bytes: 3 * 1024 * 1024, seconds: 15, minWidth: 720 } as const;

const SCENE = "apps/docs/src/components/pipeline-scene.ts";
const DATA = "docs/assets/readme/pipeline.json";

/** What a recording depends on: the run data and the scene code. A change to either means re-recording. */
export function pipelineInputsHash(root = ROOT): string {
  const h = createHash("sha256");
  for (const f of [DATA, SCENE]) h.update(readFileSync(join(root, f), "utf8").replace(/\r\n/g, "\n"));
  return h.digest("hex");
}

export const readPipelineData = (root = ROOT) => JSON.parse(readFileSync(join(root, DATA), "utf8")) as PipelineData;

/** Width and height from a GIF's logical screen descriptor. */
export function gifDimensions(b: Uint8Array): { width: number; height: number } {
  const at = (i: number) => b[i] ?? 0;
  if (String.fromCharCode(at(0), at(1), at(2)) !== "GIF") return { width: 0, height: 0 };
  return { width: at(6) | (at(7) << 8), height: at(8) | (at(9) << 8) };
}

/** Width and height from a PNG's IHDR chunk. */
export function pngDimensions(b: Uint8Array): { width: number; height: number } {
  const at = (i: number) => b[i] ?? 0;
  if (at(1) !== 0x50 || at(2) !== 0x4e || at(3) !== 0x47) return { width: 0, height: 0 };
  const u32 = (i: number) => ((at(i) << 24) | (at(i + 1) << 16) | (at(i + 2) << 8) | at(i + 3)) >>> 0;
  return { width: u32(16), height: u32(20) };
}

/**
 * The README block: reduced motion gets the still PNG, otherwise the GIF matching the color scheme; the <img>
 * fallback is the light PNG. The alt text is generated from the same run data as the frames.
 */
export function pipelinePicture(d: PipelineData): string {
  const a = "docs/assets/readme/pipeline";
  return [
    "<picture>",
    `  <source media="(prefers-reduced-motion: reduce) and (prefers-color-scheme: dark)" srcset="${a}-dark.png">`,
    `  <source media="(prefers-reduced-motion: reduce)" srcset="${a}-light.png">`,
    `  <source media="(prefers-color-scheme: dark)" srcset="${a}-dark.gif">`,
    `  <source media="(prefers-color-scheme: light)" srcset="${a}-light.gif">`,
    `  <img alt="${altText(d).replace(/"/g, "&quot;")}" src="${a}-light.png" width="100%">`,
    "</picture>",
    "",
    `<sub>One real engine run on \`${d.run.example}\` with the scripted planner (no LLM) and an offline web fixture: every number on screen is a fact from its verified report, shown with its id. Recorded by \`scripts/readme-assets/pipeline-gif.ts\` from the same animation as the docs site.</sub>`,
  ].join("\n");
}

/** Every rule the recorded files must keep. `sizes`/`bytes` are injected so the rules test without files. */
export function pipelineProblems(files: {
  readonly manifest: { readonly inputs: string } | undefined;
  readonly inputs: string;
  readonly gifs: Record<string, Uint8Array | undefined>;
  readonly pngs: Record<string, Uint8Array | undefined>;
  readonly seconds: (b: Uint8Array) => number;
}): string[] {
  const problems: string[] = [];
  if (!files.manifest) problems.push("pipeline-gif.json is missing: run scripts/readme-assets/pipeline-gif.ts");
  else if (files.manifest.inputs !== files.inputs)
    problems.push("the pipeline GIFs are stale (pipeline.json or pipeline-scene.ts changed): run scripts/readme-assets/pipeline-gif.ts");
  for (const [name, b] of Object.entries(files.gifs)) {
    if (!b) {
      problems.push(`${name} is missing: run scripts/readme-assets/pipeline-gif.ts`);
      continue;
    }
    if (b.length > PIPELINE_LIMITS.bytes) problems.push(`${name} is larger than 3 MB`);
    const s = files.seconds(b);
    if (s > PIPELINE_LIMITS.seconds) problems.push(`${name} lasts ${s.toFixed(1)} s (at most ${PIPELINE_LIMITS.seconds})`);
    if (gifDimensions(b).width < PIPELINE_LIMITS.minWidth) problems.push(`${name} is narrower than ${PIPELINE_LIMITS.minWidth} px`);
  }
  for (const [name, b] of Object.entries(files.pngs)) {
    if (!b) problems.push(`${name} is missing: run scripts/readme-assets/pipeline-gif.ts`);
    else if (pngDimensions(b).width < PIPELINE_LIMITS.minWidth)
      problems.push(`${name} is not a PNG of at least ${PIPELINE_LIMITS.minWidth} px`);
  }
  return problems;
}
