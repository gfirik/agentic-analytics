// Records the README "How it works" GIFs (light and dark) and their still PNGs from the same scene the docs
// <Pipeline /> island plays (apps/docs/src/components/pipeline-scene.ts), fed by the checked-in run data
// (docs/assets/readme/pipeline.json, from `tsx apps/docs/scripts/pipeline-data.ts --write`). Each frame is the
// scene at an exact time, screenshotted by Playwright, so the GIF is deterministic and needs no screen capture;
// ffmpeg turns the frames into a palette GIF. Writes pipeline-gif.json with the hash of what was recorded, which
// `bun run readme:check` compares against the current inputs.
//   PW_CHANNEL=chrome node --import tsx scripts/readme-assets/pipeline-gif.ts
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { HEIGHT, LOOP_SECONDS, type PipelineData, POSTER_SECONDS, sceneSvg, WIDTH } from "../../apps/docs/src/components/pipeline-scene.ts";
import { PIPELINE_FPS, PIPELINE_SCALE, pipelineInputsHash, ROOT } from "./pipeline.ts";

const OUT = join(ROOT, "docs/assets/readme");
const data = JSON.parse(readFileSync(join(OUT, "pipeline.json"), "utf8")) as PipelineData;
// Frames are a few hundred MB of PNGs; AA_FRAMES_DIR moves them off a small /tmp.
const work = mkdtempSync(join(process.env.AA_FRAMES_DIR ?? tmpdir(), "aa-pipeline-gif-"));
const frames = Math.round(LOOP_SECONDS * PIPELINE_FPS);
const sizes: Record<string, number> = {};

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
try {
  for (const theme of ["light", "dark"] as const) {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: PIPELINE_SCALE });
    const bg = theme === "dark" ? "#161614" : "#fbfaf7";
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:${bg}"><div id="s" style="width:${WIDTH}px;height:${HEIGHT}px"></div></body></html>`,
    );
    const shot = async (t: number, path: string) => {
      await page.evaluate(
        (html) => {
          (document.getElementById("s") as HTMLElement).innerHTML = html;
        },
        sceneSvg(data, t, { theme, width: WIDTH }),
      );
      await page.screenshot({ path, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
    };
    const dir = join(work, theme);
    mkdirSync(dir);
    for (let i = 0; i < frames; i++) await shot(i / PIPELINE_FPS, join(dir, `f${String(i).padStart(4, "0")}.png`));
    await shot(POSTER_SECONDS, join(OUT, `pipeline-${theme}.png`));
    await page.close();
    const gif = join(OUT, `pipeline-${theme}.gif`);
    // One palette for the whole loop (flat colors: few are needed), no dithering, only changed rectangles stored.
    execFileSync("ffmpeg", [
      "-loglevel",
      "error",
      "-y",
      "-framerate",
      String(PIPELINE_FPS),
      "-i",
      join(dir, "f%04d.png"),
      "-filter_complex",
      "[0:v]split[a][b];[a]palettegen=max_colors=48:stats_mode=full:reserve_transparent=0[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
      "-loop",
      "0",
      gif,
    ]);
    sizes[`pipeline-${theme}.gif`] = statSync(gif).size;
    sizes[`pipeline-${theme}.png`] = statSync(join(OUT, `pipeline-${theme}.png`)).size;
  }
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}

writeFileSync(
  join(OUT, "pipeline-gif.json"),
  `${JSON.stringify(
    { inputs: pipelineInputsHash(), fps: PIPELINE_FPS, frames, width: WIDTH * PIPELINE_SCALE, height: HEIGHT * PIPELINE_SCALE },
    null,
    2,
  )}\n`,
);
for (const [f, b] of Object.entries(sizes)) process.stdout.write(`${f}  ${(b / 1024).toFixed(0)} KB\n`);
