// Screenshots of the built site for review (docs/assets/site/): the landing page, a Learn stage page and a docs page,
// at desktop (1440) and mobile (390) widths. The site is light only. Serve the build first
// (`bun run --filter @agentic-analytics/docs preview`).
//   tsx scripts/site-screenshots.ts [--url http://127.0.0.1:4321/agentic-analytics] [--out dir] [--full] [--only name]
//   tsx scripts/site-screenshots.ts --record   → hero.gif: the hero's verification as it comes into view, the
//                                                scroll-linked walkthrough step by step, a hover, then Replay
//                                                (needs ffmpeg; without it hero.webm is kept)
// Besides the pages (rendered with reduced motion, so the hero's walkthrough shows as its static list), it captures
// the live walkthrough: hero-step-<k>-desktop.png at each step (scrolled) and hero-step-<k>-mobile.png (timed).
// PW_CHANNEL=chrome uses an installed Chrome instead of Playwright's own build.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Page } from "@playwright/test";

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

/** The scroll position where the walkthrough's sticky section starts (its verification phase). */
const walkStart = (page: Page) =>
  page.evaluate(() => {
    const w = document.querySelector("[data-exhibit]") as HTMLElement;
    const s = document.querySelector(".aa-walk-stick") as HTMLElement;
    return window.scrollY + w.getBoundingClientRect().top - Number.parseFloat(getComputedStyle(s).top || "0");
  });
/** Scrolls to y over ~700 ms in small steps, as a reader's wheel would (instant jumps look like cuts in a recording). */
const smoothScroll = async (page: Page, y: number) => {
  const from = await page.evaluate(() => window.scrollY);
  for (let i = 1; i <= 14; i++) {
    await page.evaluate((v) => window.scrollTo(0, v), from + ((y - from) * i) / 14);
    await page.waitForTimeout(50);
  }
};

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
    await page.waitForTimeout(1200);
    // Scroll the exhibit into view (the verification runs), then step through the walkthrough by scrolling.
    const start = await walkStart(page);
    await smoothScroll(page, start);
    await page.waitForTimeout(3000);
    const n = (await page.locator(".aa-walk-cap").count()) - 1;
    for (let k = 1; k <= n; k++) {
      await smoothScroll(page, start + k * (760 / 2) + 20);
      await page.waitForTimeout(2600);
    }
    // Hover still explores any figure; Replay starts over.
    await page.locator('.aa-exhibit a.aa-chip[data-note="N332"]').hover();
    await page.waitForTimeout(1800);
    await page.mouse.move(10, 10);
    await page.locator("[data-walk-replay]").click();
    await page.waitForTimeout(3200);
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
        "fps=8,scale=840:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=32:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
        join(out, "hero.gif"),
      ]);
      rmSync(join(out, "hero.webm"));
    } catch {
      process.stdout.write("ffmpeg not available: kept hero.webm only\n");
    }
  } else {
    // The live walkthrough, motion allowed: each step on desktop (scrolled) and on mobile (timed, stepped by hand here).
    for (const s of sizes) {
      if (values.only && !`hero-step-${s.name}`.includes(values.only as string)) continue;
      const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(`${base}/`, { waitUntil: "networkidle" });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const n = (await page.locator(".aa-walk-cap").count()) - 1;
      const start = await walkStart(page);
      for (let k = 0; k <= n; k++) {
        if (s.name === "desktop") await page.evaluate((y) => window.scrollTo(0, y), start + k * (s.height / 2) + 20);
        else if (k === 0) await page.locator(".aa-walk-stick").scrollIntoViewIfNeeded();
        else {
          // At the notes, under the sticky step bar; stepping by hand from the first step (the timer stops).
          await page.locator(".aa-notes").evaluate((el) => el.scrollIntoView({ block: "center" }));
          if (k === 1) while (await page.locator("[data-walk-prev]").isEnabled()) await page.locator("[data-walk-prev]").click();
          await page.locator("[data-walk-next]").click();
        }
        await page.waitForTimeout(k === 0 ? 3200 : 500);
        await page.screenshot({ path: join(out, `hero-step-${k}-${s.name}.png`) });
      }
      await ctx.close();
    }
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
  }
} finally {
  await browser.close();
}
process.stdout.write(`screenshots: ${out}\n`);
