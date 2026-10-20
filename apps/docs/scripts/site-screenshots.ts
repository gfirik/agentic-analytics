// Screenshots of the built site for review (docs/assets/site/): the landing page, a Learn stage page and a docs page,
// at desktop (1440) and mobile (390) widths. The site is light only. Serve the build first
// (`bun run --filter @agentic-analytics/docs preview`).
//   tsx scripts/site-screenshots.ts [--url http://127.0.0.1:4321/agentic-analytics] [--out dir] [--full] [--only name]
//   tsx scripts/site-screenshots.ts --sections --out dir   → every section of /, /learn/ and /learn/stages/analysis/ at
//                                                1440×900 and 390×844 (JPEG): landing sections as elements, docs pages
//                                                one clip per h2 section, plus the figures (docs/plans/site-v3.md §5)
//   tsx scripts/site-screenshots.ts --record   → hero.gif: the hero's verification as it comes into view, the
//                                                timed walkthrough step by step, a hover, then Replay
//                                                (needs ffmpeg; without it hero.webm is kept)
// Besides the pages (rendered with reduced motion, so the hero's walkthrough shows as its static list), it captures
// the live walkthrough: hero-step-<k>-desktop.png and hero-step-<k>-mobile.png at each step.
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
    sections: { type: "boolean", default: false },
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

/** The scroll position that puts the exhibit's step bar at the top of the screen. */
const walkStart = (page: Page) =>
  page.evaluate(() => {
    const w = document.querySelector("[data-exhibit]") as HTMLElement;
    return Math.max(0, window.scrollY + w.getBoundingClientRect().top - 24);
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
  if (values.sections) {
    // Before/after shots for a design pass: the same names every time, so two folders compare file by file.
    const shot = { type: "jpeg", quality: 78 } as const;
    for (const s of sizes) {
      const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const w = s.width;
      await page.goto(`${base}/`, { waitUntil: "networkidle" });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await page.screenshot({ ...shot, path: join(out, `landing-01-top-${w}.jpg`) });
      await page.locator(".aa-exhibit-sheet").scrollIntoViewIfNeeded();
      await page.waitForTimeout(3500);
      await page.locator(".aa-exhibit-sheet").screenshot({ ...shot, path: join(out, `landing-02-exhibit-${w}.jpg`) });
      for (const [i, id] of ["how", "why", "results", "quickstart"].entries())
        await page.locator(`#${id}`).screenshot({ ...shot, path: join(out, `landing-0${i + 3}-${id}-${w}.jpg`) });
      await page
        .locator("footer")
        .last()
        .screenshot({ ...shot, path: join(out, `landing-07-footer-${w}.jpg`) });
      for (const [slug, path] of [
        ["learn", "/learn/"],
        ["analysis", "/learn/stages/analysis/"],
      ] as const) {
        await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        // Capture only: a full-page clip renders beyond the viewport and replays the pipeline panels' opacity
        // transition, so every panel shows half-faded on top of the others. Readers never see that (a real resize
        // doesn't do it); turning transitions off makes the clip match the screen.
        await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
        await page.screenshot({ ...shot, path: join(out, `${slug}-00-top-${w}.jpg`) });
        // Each h2 section in full, from its h2 to the next one (or the end of the article).
        const spans = await page.evaluate(() => {
          const hs = [...document.querySelectorAll<HTMLElement>(".sl-markdown-content h2[id]")];
          const article = document.querySelector(".sl-markdown-content") as HTMLElement;
          // No named helpers in here: tsx wraps them in __name(), which the page doesn't have.
          const tops = hs.map((h) => h.getBoundingClientRect().top + window.scrollY - 16);
          tops.push(article.getBoundingClientRect().bottom + window.scrollY + 24);
          return hs.map((h, i) => ({
            id: h.id,
            y: Math.max(0, Math.round(tops[i] ?? 0)),
            h: Math.round((tops[i + 1] ?? 0) - (tops[i] ?? 0)),
          }));
        });
        for (const [i, sp] of spans.entries())
          await page.screenshot({
            ...shot,
            path: join(out, `${slug}-${String(i + 1).padStart(2, "0")}-${sp.id}-${w}.jpg`),
            fullPage: true,
            clip: { x: 0, y: sp.y, width: w, height: sp.h },
          });
        for (const [sel, name] of [
          [".aa-stages", "pipeline"],
          [".aa-flow", "stageflow"],
          ["[aria-label='Contribution waterfall']", "waterfall"],
        ] as const) {
          const fig = page.locator(sel).first();
          if (await fig.count()) await fig.screenshot({ ...shot, path: join(out, `${slug}-fig-${name}-${w}.jpg`) });
        }
      }
      await ctx.close();
    }
  } else if (values.record) {
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
    // Scroll the exhibit into view (the verification runs), then let the timer step through the walkthrough.
    await smoothScroll(page, await walkStart(page));
    const n = (await page.locator(".aa-walk-cap").count()) - 1;
    await page.waitForTimeout(3100 + 600 + n * 4500);
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
    // The live walkthrough, motion allowed: each step, stepped by hand here (the timer stops), on desktop and mobile.
    for (const s of sizes) {
      if (values.only && !`hero-step-${s.name}`.includes(values.only as string)) continue;
      const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(`${base}/`, { waitUntil: "networkidle" });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const n = (await page.locator(".aa-walk-cap").count()) - 1;
      await page.evaluate((y) => window.scrollTo(0, y), await walkStart(page));
      for (let k = 0; k <= n; k++) {
        if (k > 0) {
          // From step 0 by hand; on a phone, at the notes under the sticky step bar.
          if (k === 1)
            while ((await page.locator("[data-walk-prev]").getAttribute("aria-disabled")) !== "true")
              await page.locator("[data-walk-prev]").click();
          await page.locator("[data-walk-next]").click();
          if (s.name === "mobile") await page.locator(".aa-notes").evaluate((el) => el.scrollIntoView({ block: "center" }));
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
