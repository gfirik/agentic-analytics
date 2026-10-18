// Screenshots of the built site for review (docs/assets/site/): the landing page, a Learn stage page and a docs page,
// at desktop (1440) and mobile (390) widths. The site is light only. Serve the build first
// (`bun run --filter @agentic-analytics/docs preview`).
//   tsx scripts/site-screenshots.ts [--url http://127.0.0.1:4321/agentic-analytics] [--out dir] [--full] [--only name]
//   tsx scripts/site-screenshots.ts --record   → hero.webm and hero.gif: the hero's verification replay, then a
//                                                figure's margin note opening on hover (needs ffmpeg for the GIF)
// PW_CHANNEL=chrome uses an installed Chrome instead of Playwright's own build.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:4321/agentic-analytics" },
    out: { type: "string", default: join(import.meta.dirname, "..", "..", "..", "docs", "assets", "site") },
    full: { type: "boolean", default: false },
    only: { type: "string" },
    record: { type: "boolean", default: false },
  },
});
const base = (values.url as string).replace(/\/$/, "");
const out = values.out as string;
mkdirSync(out, { recursive: true });

const pages: { name: string; path: string; at?: string }[] = [
  { name: "landing", path: "/" },
  { name: "learn-stage-analysis", path: "/learn/stages/analysis/" },
  { name: "docs-verifier", path: "/how-it-works/verifier/" },
];
const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
try {
  if (values.record) {
    // The one moment of motion: load (the replay runs once, ≤ 2.5 s), then hover two figures in turn.
    const tmp = join(out, ".video");
    rmSync(tmp, { recursive: true, force: true });
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 760 },
      recordVideo: { dir: tmp, size: { width: 1440, height: 760 } },
    });
    const page = await ctx.newPage();
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(3200);
    for (const id of ["N30", "N12", "D1"]) {
      const chip = page.locator(`.aa-exhibit a.aa-chip[data-note="${id}"]`);
      await chip.hover();
      await page.waitForTimeout(2200);
    }
    await page.mouse.move(10, 10);
    await page.waitForTimeout(600);
    await ctx.close();
    const [video] = readdirSync(tmp).filter((f) => f.endsWith(".webm"));
    if (!video) throw new Error("no video recorded");
    renameSync(join(tmp, video), join(out, "hero.webm"));
    rmSync(tmp, { recursive: true, force: true });
    try {
      execFileSync("ffmpeg", [
        "-y",
        "-loglevel",
        "error",
        "-i",
        join(out, "hero.webm"),
        "-vf",
        "fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=48:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
        join(out, "hero.gif"),
      ]);
      rmSync(join(out, "hero.webm"));
    } catch {
      process.stdout.write("ffmpeg not available: kept hero.webm only\n");
    }
  } else
    for (const p of pages)
      for (const s of sizes) {
        const name = `${p.name}-${s.name}`;
        if (values.only && !name.includes(values.only as string)) continue;
        const ctx = await browser.newContext({
          viewport: { width: s.width, height: s.height },
          deviceScaleFactor: 1,
          reducedMotion: "reduce",
        });
        const page = await ctx.newPage();
        await page.goto(`${base}${p.path}`, { waitUntil: "networkidle" });
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        await page.screenshot({ path: join(out, `${name}.png`), fullPage: Boolean(values.full) });
        await ctx.close();
      }
} finally {
  await browser.close();
}
process.stdout.write(`screenshots: ${out}\n`);
