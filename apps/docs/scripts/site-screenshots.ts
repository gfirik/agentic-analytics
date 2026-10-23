// Screenshots of the built site for review (docs/assets/site/): the landing page, a Learn stage page and a docs page,
// at desktop (1440) and mobile (390) widths. The site is light only. Serve the build first
// (`bun run --filter @agentic-analytics/docs preview`).
//   tsx scripts/site-screenshots.ts [--url http://127.0.0.1:4321/agentic-analytics] [--out dir] [--full] [--only name]
//   tsx scripts/site-screenshots.ts --sections --out dir   → every section of /, /learn/ and /learn/stages/analysis/ at
//                                                1440×900 and 390×844 (JPEG): landing sections as elements, docs pages
//                                                one clip per h2 section, plus the figures (docs/plans/site-v3.md §5)
//   tsx scripts/site-screenshots.ts --hero --out dir → the hero's first screen at 1920, 1440 and 390, with the browser
//                                                set to light and to dark (the site is light only, so both must
//                                                match), named hero-<width>-<scheme>.png (site v5)
//   tsx scripts/site-screenshots.ts --story --out dir → the scroll-driven walkthrough (site v5 PR 2): at 1920 and 1440
//                                                the pinned hero at each step and the release into the engine
//                                                machine, also at 1366×768 and 1280×720; at 390 the stacked tap
//                                                list (pr2-<width>[x<height>]-<what>.png)
//   tsx scripts/site-screenshots.ts --machine --out dir → the engine machine (site v5): at 1920, 1440, 1366×768 and 390
//                                                the tour at its first stop and a middle stop, explore with a
//                                                station's card open, and on the phone the Explore button
//                                                (machine-<width>[x<height>]-<what>.png)
//   tsx scripts/site-screenshots.ts --layout before|after --out dir → §1, §2 and §4 of / whole, at 1920×1080,
//                                                1440×900, 1366×768 and 390×844, light (site v5 section layout:
//                                                sections-<tag>-<id>-<width>.png)
//   tsx scripts/site-screenshots.ts --record   → hero.gif: the hero's verification on load, then the walkthrough
//                                                stepped by scrolling through the pinned exhibit, and a hover
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
    hero: { type: "boolean", default: false },
    story: { type: "boolean", default: false },
    machine: { type: "boolean", default: false },
    layout: { type: "string" },
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

/** The scroll position at which the walkthrough shows step k (1..n): the step's sentinel just past the line 65% down
 * the screen (Exhibit.astro); step 0 is half a step before the first. */
const stepAt = (page: Page, k: number) =>
  page.evaluate((k) => {
    const s = document.querySelector<HTMLElement>(`[data-walk-sentinel="${Math.max(k, 1)}"]`);
    if (!s) return 0;
    const top = s.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.65;
    return Math.max(0, Math.round(k === 0 ? top - s.offsetHeight / 2 : top + 40));
  }, k);
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

// WebGL without a GPU (the engine machine): SwiftShader, as in the browser tests.
const browser = await chromium.launch({
  ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
try {
  if (values.hero) {
    // The first screen as a reader sees it: motion on, after the replay has landed.
    for (const colorScheme of ["light", "dark"] as const)
      for (const [width, height] of [
        [1920, 1080],
        [1440, 900],
        [390, 844],
      ] as const) {
        const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme });
        const page = await ctx.newPage();
        await page.goto(`${base}/`, { waitUntil: "networkidle" });
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        await page.waitForTimeout(3200);
        await page.screenshot({ path: join(out, `hero-${width}-${colorScheme}.png`) });
        await ctx.close();
      }
  } else if (values.sections) {
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
      await page.locator(".aa-hero-exhibit").scrollIntoViewIfNeeded();
      await page.waitForTimeout(3500);
      await page.locator(".aa-hero-exhibit").screenshot({ ...shot, path: join(out, `landing-02-exhibit-${w}.jpg`) });
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
        // Also capture-only: the fixed header and the mobile TOC bar would otherwise sit over element and clip shots.
        await page.addStyleTag({
          content:
            "*, *::before, *::after { transition: none !important; } header.header, mobile-starlight-toc, starlight-menu-button { visibility: hidden !important; }",
        });
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
          [".aa-bridge", "waterfall"],
        ] as const) {
          const fig = page.locator(sel).first();
          if (await fig.count()) await fig.screenshot({ ...shot, path: join(out, `${slug}-fig-${name}-${w}.jpg`) });
        }
      }
      await ctx.close();
    }
  } else if (values.layout) {
    // Site v5 section layout: each of §1, §2 and §4 whole, the same names before and after, so they compare by name.
    for (const [width, height] of [
      [1920, 1080],
      [1440, 900],
      [1366, 768],
      [390, 844],
    ] as const) {
      const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: "light" });
      const page = await ctx.newPage();
      await page.goto(`${base}/`, { waitUntil: "networkidle" });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      for (const id of ["how", "why", "quickstart"]) {
        const section = page.locator(`#${id}`);
        await section.scrollIntoViewIfNeeded();
        await page.waitForTimeout(900);
        await section.screenshot({ path: join(out, `sections-${values.layout}-${id}-${width}.png`) });
      }
      await ctx.close();
    }
  } else if (values.story) {
    // The scroll-driven story for review: pinned steps on desktop, then the release; the tap list on a phone.
    for (const [width, height] of [
      [1920, 1080],
      [1440, 900],
      [1366, 768],
      [1280, 720],
    ] as const) {
      // Laptop sizes are named with their height (the pin must fit a short screen).
      const tag = height === 1080 || height === 900 ? `${width}` : `${width}x${height}`;
      const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(`${base}/`, { waitUntil: "networkidle" });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await page.waitForTimeout(3200);
      const n = await page.locator("[data-walk-sentinel]").count();
      for (let k = 1; k <= n; k++) {
        await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), await stepAt(page, k));
        await page.waitForTimeout(500);
        await page.screenshot({ path: join(out, `pr2-${tag}-step${k}.png`) });
      }
      // Past the track: the pin has let go and the engine machine's band follows.
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), (await stepAt(page, n)) + Math.round(height * 0.9));
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(out, `pr2-${tag}-release.png`) });
      await ctx.close();
    }
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.screenshot({ path: join(out, "pr2-390-top.png") });
    await page.locator(".aa-hero-cmd").evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.evaluate(() => window.scrollBy(0, -16));
    await page.waitForTimeout(3200);
    await page.screenshot({ path: join(out, "pr2-390-install.png") });
    await page.locator(".aa-walk-list").evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, "pr2-390-stacked.png") });
    await page.locator('.aa-walk-list details[data-step-item="2"] > summary').click();
    await page.locator('.aa-walk-list details[data-step-item="2"]').evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, "pr2-390-tap.png") });
    await ctx.close();
  } else if (values.machine) {
    // The engine machine's modes for review (live: a capable device, motion on).
    for (const [width, height] of [
      [1920, 1080],
      [1440, 900],
      [1366, 768],
      [390, 844],
    ] as const) {
      const tag = height === 768 ? `${width}x${height}` : `${width}`;
      const phone = width < 900;
      const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: phone });
      const page = await ctx.newPage();
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
        Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
      });
      await page.goto(`${base}/`, { waitUntil: "networkidle" });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      // Where the camera holds at stop k (0 is the home view): the middle of its share of the band.
      const at = (k: number) =>
        page.evaluate((k) => {
          const track = document.querySelector<HTMLElement>("[data-track]");
          const stage = document.querySelector<HTMLElement>("[data-engine-stage]");
          if (!track || !stage) return 0;
          const shares = Number(getComputedStyle(track.closest("[data-machine]") as Element).getPropertyValue("--aa-engine-stops"));
          return Math.round(
            track.getBoundingClientRect().top + window.scrollY + ((k + 0.5) * (track.offsetHeight - stage.offsetHeight)) / shares,
          );
        }, k);
      const go = async (k: number, wait = 1400) => {
        await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), await at(k));
        await page.waitForTimeout(wait);
      };
      await go(0, 400);
      await page.waitForSelector('[data-machine][data-gl="on"]', { timeout: 30_000 });
      await go(0);
      await page.screenshot({ path: join(out, `machine-${tag}-home.png`) });
      await go(1);
      await page.screenshot({ path: join(out, `machine-${tag}-stop1.png`) });
      await go(4);
      await page.screenshot({ path: join(out, `machine-${tag}-stop4.png`) });
      if (phone) {
        await page.locator("[data-explore]").tap();
        await page.waitForTimeout(600);
        await page.screenshot({ path: join(out, `machine-${tag}-explore.png`) });
      } else {
        // Explore with a station's card open: a click on the station just under its label.
        const label = await page.locator('[data-tag][data-id="analysis"]').boundingBox();
        const want = await page.locator('.aa-stations li[data-station="analysis"] .aa-station-title').textContent();
        for (let dy = 20; label && dy <= 200; dy += 15) {
          await page.mouse.click(label.x + label.width / 2, label.y + label.height + dy);
          if ((await page.locator("[data-card-title]").textContent()) === want) break;
        }
        await page.mouse.move(label ? label.x + label.width / 2 : width / 3, height * 0.55);
        await page.waitForTimeout(900);
        await page.screenshot({ path: join(out, `machine-${tag}-explore.png`) });
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
    // The verification runs on load; then scroll through the pinned exhibit, a step at a time.
    await page.waitForTimeout(3100);
    const n = await page.locator("[data-walk-sentinel]").count();
    for (let k = 1; k <= n; k++) {
      await smoothScroll(page, await stepAt(page, k));
      await page.waitForTimeout(2200);
    }
    // Hover still explores any figure.
    await page.locator('.aa-exhibit a.aa-chip[data-note="N12"]').hover();
    await page.waitForTimeout(1800);
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
        "fps=8,scale=840:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=32:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
        join(out, "hero.gif"),
      ]);
      rmSync(join(out, "hero.webm"));
    } catch {
      process.stdout.write("ffmpeg not available: kept hero.webm only\n");
    }
  } else {
    // The live walkthrough, motion allowed: on desktop each step as the scroll reaches it (pinned); on a phone the
    // tap list with each step opened in turn.
    for (const s of sizes) {
      if (values.only && !`hero-step-${s.name}`.includes(values.only as string)) continue;
      const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(`${base}/`, { waitUntil: "networkidle" });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const n = (await page.locator(".aa-walk-cap").count()) - 1;
      const pinned = (await page.locator("[data-exhibit]").getAttribute("data-walk")) === "pin";
      if (!pinned) await page.evaluate((y) => window.scrollTo(0, y), await walkStart(page));
      for (let k = 0; k <= n; k++) {
        if (pinned) await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), await stepAt(page, k));
        else if (k > 0) {
          const item = page.locator(`.aa-walk-list details[data-step-item="${k}"]`);
          if ((await item.getAttribute("open")) === null) await item.locator("summary").click();
          await item.evaluate((el) => el.scrollIntoView({ block: "start" }));
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
