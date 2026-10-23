// The product site in a real browser and its build (apps/docs/DESIGN.md §10): no request leaves the site, WCAG 2 A/AA has no
// violations, the site is light only, nothing scrolls sideways at 360 px, the page works without JS and with reduced
// motion, the hero exhibit replays its verification once and opens margin notes, and Learn sidenotes sit in the
// margin (inline under 1000 px).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, expect, test } from "@playwright/test";

const BASE = "/agentic-analytics";
const LANDING = `${BASE}/`;
const DOCS = [`${BASE}/how-it-works/verifier/`, `${BASE}/start/quickstart/`, `${BASE}/use-it/overview/`];
const MISSING = `${BASE}/no-such-page/`;
const PAGES = [LANDING, ...DOCS, MISSING];

/** Every page the sitemap lists (the landing page and every docs page), as local paths. */
async function sitemapPaths(request: APIRequestContext): Promise<string[]> {
  const sitemap = await (await request.get(`${BASE}/sitemap-0.xml`)).text();
  return [...sitemap.matchAll(/<loc>https:\/\/gfirik\.github\.io([^<]+)<\/loc>/g)].map((m) => m[1] as string);
}

test("no third-party requests on any page in the sitemap or the 404, scrolled to the end", async ({ page, request }) => {
  test.setTimeout(300_000);
  const outside: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname) && !["data:", "blob:"].includes(url.protocol)) outside.push(r.url());
  });
  const paths = [...(await sitemapPaths(request)), MISSING];
  expect(paths.length).toBeGreaterThan(30);
  for (const path of paths) {
    await page.goto(path, { waitUntil: "networkidle" });
    await page.mouse.wheel(0, 40_000);
    await page.waitForLoadState("networkidle");
  }
  expect(outside).toEqual([]);
});

test("the build references no external script, stylesheet, font or image", () => {
  const DIST = join(import.meta.dirname, "..", "..", "..", "apps", "docs", "dist");
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(html|css|js|mjs)$/.test(name)) {
        const text = readFileSync(p, "utf8");
        const patterns = [
          /<script[^>]*\bsrc=["']?(?:https?:)?\/\/[^"' >]+/gi,
          /<link[^>]*\brel=["']?(?:stylesheet|preload|modulepreload|icon|shortcut icon)["']?[^>]*\bhref=["']?(?:https?:)?\/\/[^"' >]+/gi,
          /<img[^>]*\bsrc=["']?(?:https?:)?\/\/[^"' >]+/gi,
          /@import\s+(?:url\()?["']?(?:https?:)?\/\//gi,
          /url\(["']?https?:\/\/[^)]+\)/gi,
        ];
        for (const re of patterns) for (const m of text.matchAll(re)) offenders.push(`${p.slice(DIST.length)}: ${m[0].slice(0, 120)}`);
      }
    }
  };
  walk(DIST);
  // SVG namespaces (xmlns="http://www.w3.org/2000/svg") are identifiers, not requests; the patterns above don't match them.
  expect(offenders).toEqual([]);
});

test.describe("WCAG 2 A/AA (axe)", () => {
  for (const path of [LANDING, DOCS[0] as string, `${BASE}/learn/stages/analysis/`, MISSING]) {
    test(path, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(path, { waitUntil: "networkidle" });
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const found = result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
      expect(found).toEqual([]);
    });
  }
});

test("WCAG 2 A/AA (axe) on the live walkthrough: pinned at 1440 mid-story, the tap list at 390 (site v5 PR 2)", async ({ browser }) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await page.goto(LANDING, { waitUntil: "networkidle" });
    // The verification has run (at 390 it starts as the report page comes into view).
    await page.locator(".aa-exhibit-page").scrollIntoViewIfNeeded();
    await expect(page.locator("[data-exhibit]")).toHaveAttribute("data-anim", "done", { timeout: 6_000 });
    if (viewport.width === 1440) {
      const y = await page
        .locator('[data-walk-sentinel="2"]')
        .evaluate((el) => el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.65 + 40);
      await page.evaluate((v) => window.scrollTo({ top: v, behavior: "instant" }), y);
      await expect(page.locator('.aa-walk-cap[data-step="2"]')).toBeVisible();
      await page.waitForTimeout(1_000);
    } else {
      await page.locator('.aa-walk-list details[data-step-item="2"] > summary').click();
    }
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const found = result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    expect(found, `${viewport.width}`).toEqual([]);
    await ctx.close();
  }
});

test("light only, even when the reader's system is dark or an old stored theme says dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => localStorage.setItem("starlight-theme", "dark"));
  for (const path of [LANDING, DOCS[0] as string]) {
    await page.goto(path, { waitUntil: "networkidle" });
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(248, 248, 246)");
    await expect(page.locator("[data-aa-theme], starlight-theme-select")).toHaveCount(0);
  }
});

test.describe("no horizontal scroll at 360 px", () => {
  for (const path of PAGES) {
    test(path, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 780 });
      await page.goto(path, { waitUntil: "networkidle" });
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(wide).toBeLessThanOrEqual(0);
    });
  }
});

test("no horizontal scroll from 1000 to 1440 px: the docs' narrowest margin column, the landing page's frame", async ({ page }) => {
  // 1100 is where the landing rows go two columns (site v4).
  for (const width of [1000, 1024, 1072, 1099, 1100, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    // The Learn page (the margin column's narrowest) and the landing page (its frame meets the screen edge up to 1440).
    for (const path of [`${BASE}/learn/stages/analysis/`, LANDING]) {
      await page.goto(path, { waitUntil: "networkidle" });
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${path} at ${width} px`).toBeLessThanOrEqual(0);
    }
  }
});

test("no horizontal scroll at 360 px on any page in the sitemap", async ({ page, request }) => {
  const paths = await sitemapPaths(request);
  expect(paths.length).toBeGreaterThan(30);
  await page.setViewportSize({ width: 360, height: 780 });
  const wide: string[] = [];
  for (const path of paths) {
    await page.goto(path, { waitUntil: "networkidle" });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 0) wide.push(`${path} (+${over}px)`);
  }
  expect(wide).toEqual([]);
});

test("WCAG 2 A/AA (axe) on every page in the sitemap", async ({ page, request }) => {
  test.setTimeout(600_000);
  const paths = [...(await sitemapPaths(request)), MISSING];
  const found: string[] = [];
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const path of paths) {
    await page.goto(path, { waitUntil: "networkidle" });
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    for (const v of result.violations) found.push(`${path} · ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  }
  expect(found).toEqual([]);
});

test("landing: one h1, a skip link, a footer crediting fhsystems", async ({ page }) => {
  await page.goto(LANDING);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("a[href='#main']")).toHaveCount(1);
  await expect(page.locator("footer a[href='https://fhsystems.dev']")).toHaveText("fhsystems");
});

test("docs pages carry the fhsystems footer too", async ({ page }) => {
  for (const path of [DOCS[0] as string, MISSING]) {
    await page.goto(path);
    await expect(page.locator("footer a[href='https://fhsystems.dev']")).toHaveText("fhsystems");
  }
});

test("hero: the verification replays once, figure by figure, within 2.5 s", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(LANDING);
  const wrap = page.locator("[data-exhibit]");
  // Site v4: the exhibit is the hero's right column, its report page's top above the bottom sixth of the first screen at
  // 1440 × 900, so it verifies (timed) on load, with no scroll (DESIGN.md §5, §6).
  expect(await page.locator(".aa-exhibit-page").evaluate((e) => e.getBoundingClientRect().top)).toBeLessThan((900 * 5) / 6);
  const chips = page.locator(".aa-exhibit a.aa-chip");
  const n = await chips.count();
  expect(n).toBeGreaterThan(5);
  expect(n).toBeLessThanOrEqual(10);
  await expect(wrap).toHaveAttribute("data-anim", "pending");
  await expect(wrap).toHaveAttribute("data-walk", "pin");
  // Mid-replay, some figures are verified and some not yet.
  await expect(page.locator(".aa-exhibit a.aa-chip.is-verified")).not.toHaveCount(0);
  await expect(wrap).toHaveAttribute("data-anim", "done", { timeout: 3_500 });
  await expect(page.locator(".aa-exhibit a.aa-chip.is-verified")).toHaveCount(n);
});

/** Site v5 PR 2: the step shown in the walkthrough's bar (0 is the verification, 1..n the steps). */
const shownStep = (page: import("@playwright/test").Page) =>
  page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".aa-walk-cap")].findIndex((c) => !c.hidden));
/** Scrolls the window to y and waits for the scroll to land (instant, so a test never races smooth scrolling). */
const jumpTo = (page: import("@playwright/test").Page, y: number) =>
  page.evaluate((v) => {
    window.scrollTo({ top: v, behavior: "instant" });
  }, y);

test("hero: at 1440 the exhibit pins and each scroll step opens the next figure's note, with a progress rule; then it releases into the engine machine", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const wrap = page.locator("[data-exhibit]");
  await expect(wrap).toHaveAttribute("data-walk", "pin");
  const steps = JSON.parse((await wrap.getAttribute("data-steps")) ?? "[]") as string[];
  expect(steps.length).toBeGreaterThanOrEqual(3);
  expect(steps.length).toBeLessThanOrEqual(4);
  const open = page.locator(".aa-note.is-open");
  // No timer and no step controls (prev, next, Pause, Replay): nothing advances by itself, only the scroll moves it.
  await expect(page.locator(".aa-hero-exhibit button")).toHaveCount(0);
  await expect(wrap).toHaveAttribute("data-anim", "done", { timeout: 4_000 });
  await page.waitForTimeout(5_000);
  expect(await shownStep(page)).toBe(0);
  // The margin is never empty: step 1's note is open before the first step.
  await expect(open).toHaveCount(1);
  await expect(open).toHaveAttribute("id", `aa-note-${steps[0]}`);
  // The whole hero row (statement and exhibit) is one sticky unit, a screen tall; one sentinel per step in the track.
  const row = page.locator(".aa-hero-row");
  const stage = page.locator(".aa-hero-exhibit");
  const statement = page.locator(".aa-statement");
  expect(await row.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
  expect(await row.evaluate((el) => Math.round(el.getBoundingClientRect().height))).toBeGreaterThanOrEqual(900);
  await expect(page.locator("[data-walk-sentinel]")).toHaveCount(steps.length);
  // Pinned: the row's top at the screen's top; the exhibit and the statement where they were at step 1.
  await jumpTo(
    page,
    (await page.locator('[data-walk-sentinel="1"]').evaluate((el) => el.getBoundingClientRect().top + window.scrollY)) - 900 * 0.65 + 40,
  );
  await expect.poll(() => shownStep(page), { timeout: 3_000 }).toBe(1);
  expect(Math.round(await row.evaluate((el) => el.getBoundingClientRect().top))).toBe(0);
  const pinTop = Math.round(await stage.evaluate((el) => el.getBoundingClientRect().top));
  const statementTop = Math.round(await statement.evaluate((el) => el.getBoundingClientRect().top));
  // Everything in the hero is on screen while pinned: the install line and the exhibit's caption.
  for (const sel of [".aa-hero-cmd-frame", ".aa-exhibit-caption", ".aa-hero-title"])
    expect(await page.locator(sel).evaluate((el) => el.getBoundingClientRect().bottom), sel).toBeLessThanOrEqual(900);
  // Each step: scroll until the step's sentinel crosses the line 65% down the screen; the exhibit stays put.
  const sentinelY = (k: number) =>
    page.locator(`[data-walk-sentinel="${k}"]`).evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  const progress = () => page.locator(".aa-walk-progress > i").evaluate((el) => el.getBoundingClientRect().width);
  let lastProgress = await progress();
  for (let k = 1; k <= steps.length; k++) {
    await jumpTo(page, (await sentinelY(k)) - 900 * 0.65 + 40);
    await expect.poll(() => shownStep(page), { timeout: 3_000 }).toBe(k);
    expect(Math.round(await stage.evaluate((el) => el.getBoundingClientRect().top)), `step ${k} exhibit pinned`).toBe(pinTop);
    expect(Math.round(await statement.evaluate((el) => el.getBoundingClientRect().top)), `step ${k} statement pinned`).toBe(statementTop);
    await expect(page.locator(`.aa-walk-cap[data-step="${k}"]`)).toContainText(`${k}/${steps.length}`);
    await expect(open).toHaveCount(1);
    await expect(open).toHaveAttribute("id", `aa-note-${steps[k - 1]}`);
    const chip = page.locator(`.aa-exhibit a.aa-chip[data-note="${steps[k - 1]}"]`);
    await expect(chip).toHaveAttribute("aria-expanded", "true");
    await expect(chip).toHaveAttribute("aria-current", "step");
    await expect(page.locator('.aa-exhibit a.aa-chip[aria-current="step"]')).toHaveCount(1);
    await expect(page.locator(".aa-walk-dot.is-on")).toHaveCount(k);
    // The open note is inside the screen, beside the report page.
    const b = await open.boundingBox();
    expect((b?.y ?? 0) + (b?.height ?? 0), `step ${k} note on screen`).toBeLessThanOrEqual(900);
    const p = await progress();
    // (Step 1 is where the pin check above already left the page.)
    if (k > 1) expect(p, `step ${k} progress grows`).toBeGreaterThan(lastProgress);
    else expect(p, "step 1 progress has started").toBeGreaterThan(0);
    lastProgress = p;
    if (k === 2) {
      // The change's SQL input: its SQL (open beside the exhibit) and the sheet rows it read.
      await expect(open.locator(".aa-note-sql")).toBeVisible();
      await expect(open.locator(".aa-note-sql")).toContainText("FROM");
      await expect(open.locator("tr.is-cited")).not.toHaveCount(0);
    }
  }
  // At the last step the rule is full.
  const bar = await page.locator(".aa-walk-progress").evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.abs(lastProgress - bar)).toBeLessThan(2);
  // Scrolling back steps back.
  await jumpTo(page, (await sentinelY(2)) - 900 * 0.65 + 40);
  await expect.poll(() => shownStep(page), { timeout: 3_000 }).toBe(2);
  // Exploring mid-walkthrough: hovering another figure opens its note; leaving returns to the step's note.
  await page.locator('.aa-exhibit a.aa-chip[data-note="N12"]').hover();
  await expect(page.locator("#aa-note-N12")).toHaveClass(/is-open/);
  await page.mouse.move(5, 5);
  await expect(open).toHaveAttribute("id", `aa-note-${steps[1]}`);
  // Past the track the whole hero releases straight into the engine machine's band: the row scrolls away together and
  // the band's top follows its bottom edge directly, with no empty block between them.
  const engine = page.locator("#engine");
  await jumpTo(page, (await sentinelY(steps.length)) + 900);
  expect(await stage.evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(pinTop);
  expect(await statement.evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(statementTop);
  await expect.poll(() => shownStep(page), { timeout: 3_000 }).toBe(steps.length);
  const [rowBottom, engineTop, captionBottom] = await Promise.all([
    row.evaluate((el) => el.getBoundingClientRect().bottom),
    engine.evaluate((el) => el.getBoundingClientRect().top),
    page.locator(".aa-exhibit-caption").evaluate((el) => el.getBoundingClientRect().bottom),
  ]);
  expect(engineTop).toBeLessThan(900);
  expect(Math.abs(engineTop - rowBottom), "the band starts where the hero ends").toBeLessThanOrEqual(2);
  expect(engineTop - captionBottom, "no large empty block under the hero").toBeLessThan(160);
});

test("hero: on laptop screens the whole hero still pins and steps (1280×720, 1366×768, 1536×730); under 680px of height it is the tap list", async ({
  browser,
}) => {
  for (const [width, height] of [
    [1280, 720],
    [1366, 768],
    [1536, 730],
  ] as const) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    await page.goto(LANDING, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const wrap = page.locator("[data-exhibit]");
    await expect(wrap, `${width}×${height}`).toHaveAttribute("data-walk", "pin");
    const steps = JSON.parse((await wrap.getAttribute("data-steps")) ?? "[]") as string[];
    const row = page.locator(".aa-hero-row");
    expect(await row.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
    for (let k = 1; k <= steps.length; k++) {
      const y = await page
        .locator(`[data-walk-sentinel="${k}"]`)
        .evaluate((el, h) => el.getBoundingClientRect().top + window.scrollY - h * 0.65 + 40, height);
      await jumpTo(page, y);
      await expect.poll(() => shownStep(page), { timeout: 3_000 }).toBe(k);
      expect(Math.round(await row.evaluate((el) => el.getBoundingClientRect().top)), `${width}×${height} step ${k} pinned`).toBe(0);
      await expect(page.locator(".aa-note.is-open")).toHaveAttribute("id", `aa-note-${steps[k - 1]}`);
      // Everything that matters is on the short screen: the headline, the install line, the step bar, the report
      // page's last line and the open note.
      for (const sel of [".aa-hero-title", ".aa-hero-cmd-frame", ".aa-walk-bar", ".aa-exhibit-foot", ".aa-note.is-open"]) {
        const r = await page.locator(sel).evaluate((el) => {
          const b = el.getBoundingClientRect();
          return { top: b.top, bottom: b.bottom };
        });
        expect(r.top, `${width}×${height} step ${k}: ${sel}`).toBeGreaterThanOrEqual(0);
        expect(r.bottom, `${width}×${height} step ${k}: ${sel}`).toBeLessThanOrEqual(height);
      }
    }
    await ctx.close();
  }
  // Below 680px of viewport height the hero doesn't pin: the steps are the tap list.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 660 } });
  const page = await ctx.newPage();
  await page.goto(LANDING, { waitUntil: "networkidle" });
  await expect(page.locator("[data-exhibit]")).toHaveAttribute("data-walk", "tap");
  expect(await page.locator(".aa-hero-row").evaluate((el) => getComputedStyle(el).position)).not.toBe("sticky");
  await expect(page.locator(".aa-walk-list details")).not.toHaveCount(0);
  await ctx.close();
});

test("hero: keyboard scrolling (Page Down, Space) steps the pinned walkthrough, announced; no step control exists", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  const wrap = page.locator("[data-exhibit]");
  await expect(wrap).toHaveAttribute("data-walk", "pin");
  const steps = JSON.parse((await wrap.getAttribute("data-steps")) ?? "[]") as string[];
  // No controls of its own: no buttons, no focusable group, no key handler to learn.
  await expect(
    page.locator(".aa-hero-exhibit button, [data-walk-prev], [data-walk-next], [data-walk-pause], [data-walk-replay]"),
  ).toHaveCount(0);
  await expect(page.locator(".aa-walk-body")).not.toHaveAttribute("tabindex", /.*/);
  // The step is announced politely, and the step's chip says it is current.
  const status = page.locator(".aa-walk-status");
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status).not.toHaveAttribute("aria-busy", /.*/);
  // The page's own keyboard scrolling drives it: Page Down and Space from the top reach every step, in order.
  await page.locator("h1").click();
  const seen: number[] = [];
  for (let i = 0; i < 12 && (seen.at(-1) ?? 0) < steps.length; i++) {
    await page.keyboard.press(i % 2 ? "Space" : "PageDown");
    await page.waitForTimeout(700);
    const k = await shownStep(page);
    if (k !== (seen.at(-1) ?? 0)) seen.push(k);
  }
  expect(seen.at(-1), "the last step is reached").toBe(steps.length);
  for (let i = 1; i < seen.length; i++) expect(seen[i] ?? 0).toBeGreaterThan(seen[i - 1] ?? 0);
  await expect(status).toContainText(`${steps.length}/${steps.length}`);
  await expect(page.locator(`.aa-exhibit a.aa-chip[data-note="${steps[steps.length - 1]}"]`)).toHaveAttribute("aria-current", "step");
  // Page Up goes back.
  await page.keyboard.press("PageUp");
  await expect.poll(() => shownStep(page), { timeout: 3_000 }).toBeLessThan(steps.length);
  // Every figure stays reachable by Tab, and focusing one opens its note.
  await page.locator('.aa-exhibit a.aa-chip[data-note="N12"]').focus();
  await expect(page.locator("#aa-note-N12")).toHaveClass(/is-open/);
});

test("chips and the SQL toggle are at least 24 px tall to tap or click, and the hit box reaches above and below the chip", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const reach = (sel: string) =>
    page
      .locator(sel)
      .first()
      .evaluate((el) => {
        // Mid-screen, so every probed point is inside the viewport (elementFromPoint returns nothing outside it).
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const hit = (y: number) => {
          const at = document.elementFromPoint(x, y);
          return at === el || el.contains(at);
        };
        // The tallest run of points that land on the element, in 0.5px steps through a 40px band around it.
        let best = 0;
        let run = 0;
        for (let y = r.top - 20; y <= r.bottom + 20; y += 0.5) {
          run = hit(y) ? run + 0.5 : 0;
          best = Math.max(best, run);
        }
        return { height: best, above: hit(r.top - 4), below: hit(r.bottom + 4) };
      });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  for (let k = 0; k < (await page.locator(".aa-exhibit a.aa-chip").count()); k++) {
    const r = await reach(`.aa-exhibit a.aa-chip >> nth=${k}`);
    expect(r.height, `exhibit chip ${k}`).toBeGreaterThanOrEqual(24);
    expect(r.above && r.below, `exhibit chip ${k}`).toBe(true);
  }
  await page.goto(`${BASE}/learn/stages/analysis/`, { waitUntil: "networkidle" });
  const learn = await reach(".sl-markdown-content p a.aa-chip");
  expect(learn.height).toBeGreaterThanOrEqual(24);
  expect(learn.above && learn.below).toBe(true);
  // The SQL toggle under 900 px.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  const id = JSON.parse((await page.locator("[data-exhibit]").getAttribute("data-steps")) ?? "[]")[1] as string;
  await page.locator(`.aa-exhibit a.aa-chip[data-note="${id}"]`).click();
  const summary = page.locator(`#aa-note-${id} details[data-fold] > summary`);
  await summary.scrollIntoViewIfNeeded();
  expect((await summary.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(24);
  await summary.click();
  await expect(page.locator(`#aa-note-${id} details[data-fold]`)).toHaveAttribute("open", "");
  await expect(summary).toContainText("hide");
});

test("hero: stepping through the walkthrough never moves the page below it (1440)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const steps = JSON.parse((await page.locator("[data-exhibit]").getAttribute("data-steps")) ?? "[]") as string[];
  const below = () => page.locator("#engine").evaluate((el) => Math.round(el.getBoundingClientRect().top + window.scrollY));
  const y = await below();
  const at = (k: number) =>
    page
      .locator(`[data-walk-sentinel="${k}"]`)
      .evaluate((el) => el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.65 + 40);
  for (const k of [...steps.keys()].map((i) => i + 1).concat([1])) {
    await jumpTo(page, await at(k));
    await expect(page.locator(`.aa-walk-cap[data-step="${k}"]`)).toBeVisible();
    expect(await below(), `step ${k}`).toBe(y);
  }
});

test("hero: on a landscape phone (667 × 375) the figures still verify as the exhibit comes into view", async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await page.goto(LANDING);
  await page.locator(".aa-exhibit-page").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await expect(page.locator("[data-exhibit]")).toHaveAttribute("data-anim", "done", { timeout: 4_000 });
  await expect(page.locator(".aa-exhibit a.aa-chip.is-verified")).toHaveCount(await page.locator(".aa-exhibit a.aa-chip").count());
});

test("hero: under 900 px nothing is pinned; the steps stack as a list and each opens on tap", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  const wrap = page.locator("[data-exhibit]");
  await expect(wrap).toHaveAttribute("data-walk", "tap");
  const steps = JSON.parse((await wrap.getAttribute("data-steps")) ?? "[]") as string[];
  // No pin, no track, no step bar.
  expect(await page.locator(".aa-hero-row").evaluate((el) => getComputedStyle(el).position)).not.toBe("sticky");
  await expect(page.locator(".aa-hero-track")).toBeHidden();
  await expect(page.locator(".aa-walk-bar")).toBeHidden();
  // The figures still verify as the exhibit comes into view.
  await page.locator(".aa-exhibit-page").scrollIntoViewIfNeeded();
  await expect(wrap).toHaveAttribute("data-anim", "done", { timeout: 4_000 });
  // The list: one item per step, step 1 open, the rest closed until tapped.
  const items = page.locator(".aa-walk-list details");
  await expect(items).toHaveCount(steps.length);
  await expect(items.nth(0)).toHaveAttribute("open", "");
  for (let k = 1; k < steps.length; k++) await expect(items.nth(k)).not.toHaveAttribute("open", /.*/);
  await expect(items.nth(1).locator(".aa-walk-item-note")).toBeHidden();
  const head = items.nth(1).locator("summary");
  await head.scrollIntoViewIfNeeded();
  // A full-width tap target, at least 44 px tall.
  expect((await head.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await head.click();
  await expect(items.nth(1)).toHaveAttribute("open", "");
  await expect(items.nth(1).locator(".aa-note-sql")).toContainText("FROM");
  await head.click();
  await expect(items.nth(1)).not.toHaveAttribute("open", /.*/);
  // Scrolling past it changes nothing: no step is driven by the scroll here.
  await page.mouse.wheel(0, 1500);
  await page.waitForTimeout(400);
  await expect(page.locator(".aa-note.is-open")).toHaveCount(0);
  // The caption reads as one line of text in its row, not split into columns.
  const parts = await items
    .nth(2)
    .locator("summary")
    .evaluate((el) => el.children.length);
  expect(parts).toBe(1);
});

test("landing: the strip, header and install line keep their height while the fonts arrive late (390, 1440 px)", async ({ browser }) => {
  // These boxes changed height when Plex Mono swapped in (a re-wrapping strip and install line, a header collapsing
  // when its menu script ran late): the page below moved (Lighthouse CLS 0.05). Their heights must not depend on the
  // font, so they are measured in the fallback faces and again once the web fonts are in. Glyphs re-centring inside
  // their boxes depends on the machine's fallback fonts and is not tested here; Lighthouse measures CLS 0.
  // The web fonts are held; the local metric-matched fallback faces (fonts.css, "… Fallback") load at once.
  const boxes = [".aa-strip", ".aa-header", ".aa-hero-cmd", ".aa-hero-title", ".aa-actions", ".aa-hero-proof"];
  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ] as const) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    let release: () => void = () => {};
    const held = new Promise<void>((ok) => {
      release = ok;
    });
    await page.route(/\.woff2$/, async (r) => {
      await held;
      await r.continue();
    });
    const heights = () => page.evaluate((sel) => sel.map((s) => document.querySelector(s)?.getBoundingClientRect().height ?? -1), boxes);
    await page.goto(LANDING, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => [...document.fonts].some((f) => f.status === "loaded" && !f.family.endsWith("Fallback")))).toBe(false);
    const before = await heights();
    release();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => [...document.fonts].some((f) => f.status === "loaded" && !f.family.endsWith("Fallback")))).toBe(true);
    expect(await heights(), `${width} px`).toEqual(before);
    await ctx.close();
  }
});

test("hero: with reduced motion the walkthrough is a static ruled list, every step's note shown, nothing pinned", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  const steps = JSON.parse((await page.locator("[data-exhibit]").getAttribute("data-steps")) ?? "[]") as string[];
  await expect(page.locator("[data-exhibit]")).not.toHaveAttribute("data-walk", /.*/);
  await expect(page.locator(".aa-walk-bar")).toBeHidden();
  await expect(page.locator(".aa-hero-track")).toBeHidden();
  expect(await page.locator(".aa-hero-row").evaluate((el) => getComputedStyle(el).position)).not.toBe("sticky");
  for (const d of await page.locator(".aa-walk-list details").all()) await expect(d).toHaveAttribute("open", "");
  const items = page.locator(".aa-walk-list > li");
  await expect(items).toHaveCount(steps.length);
  await expect(items.nth(0)).toBeVisible();
  await expect(items.nth(1).locator(".aa-note-sql")).toContainText("FROM");
});

test("hero: reduced motion shows the verified state at once, with no replay", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  await expect(page.locator("[data-exhibit]")).not.toHaveAttribute("data-anim", /.*/);
  await expect(page.locator(".aa-exhibit a.aa-chip .aa-check").first()).toBeVisible();
  expect(
    await page
      .locator(".aa-exhibit a.aa-chip .aa-check")
      .first()
      .evaluate((el) => getComputedStyle(el).opacity),
  ).toBe("1");
});

test("hero: hovering a figure opens its margin note (SQL and cited rows); Escape closes it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  const chip = page.locator('.aa-exhibit a.aa-chip[data-note="N12"]');
  await chip.hover();
  const note = page.locator("#aa-note-N12");
  await expect(note).toBeVisible();
  await expect(chip).toHaveAttribute("aria-expanded", "true");
  await expect(note.locator(".aa-note-sql")).toContainText("FROM");
  await expect(note.locator("tr.is-cited")).not.toHaveCount(0);
  await expect(page.locator(".aa-leader")).toBeVisible();
  // Beside the exhibit, level with its figure.
  const [c, b, e] = await Promise.all([chip.boundingBox(), note.boundingBox(), page.locator(".aa-exhibit").boundingBox()]);
  expect(b && e && b.x).toBeGreaterThanOrEqual((e?.x ?? 0) + (e?.width ?? 0));
  expect(Math.abs((b?.y ?? 0) - (c?.y ?? 0))).toBeLessThan(24);
  await page.keyboard.press("Escape");
  await expect(note).toBeHidden();
  // Keyboard: focus opens it too; a function fact shows its inputs.
  await page.locator('.aa-exhibit a.aa-chip[data-note="N30"]').focus();
  await expect(page.locator("#aa-note-N30")).toContainText("pct_change");
});

test("hero: under 900 px the margin note opens below the exhibit, on tap", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  await page.locator('.aa-exhibit a.aa-chip[data-note="N12"]').click();
  const note = page.locator("#aa-note-N12");
  await expect(note).toBeVisible();
  const [b, e] = await Promise.all([note.boundingBox(), page.locator(".aa-exhibit").boundingBox()]);
  expect(b?.y ?? 0).toBeGreaterThan((e?.y ?? 0) + (e?.height ?? 0) - 1);
});

test("without JS the landing page is complete and chips link into the fact ledger", async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(LANDING);
  await expect(page.locator(".aa-stages .aa-stage")).toHaveCount(7);
  await expect(page.locator(".aa-exhibit a.aa-chip .aa-check").first()).toBeVisible();
  const chip = page.locator(".aa-exhibit a.aa-chip").first();
  const href = await chip.getAttribute("href");
  expect(href).toMatch(/^#fact-N\d+$/);
  await expect(page.locator(".aa-walk-list > li").first()).toBeVisible();
  // The static list: every step's note open, nothing pinned, no track.
  const items = page.locator(".aa-walk-list details");
  await expect(items).not.toHaveCount(0);
  for (const d of await items.all()) await expect(d).toHaveAttribute("open", "");
  await expect(items.last().locator(".aa-walk-item-note")).toBeVisible();
  await expect(page.locator(".aa-hero-track")).toBeHidden();
  expect(await page.locator(".aa-hero-row").evaluate((el) => getComputedStyle(el).position)).not.toBe("sticky");
  await expect(page.locator(".aa-walk-bar")).toBeHidden();
  await expect(page.locator(".aa-notes")).toBeHidden();
  await expect(page.locator("#ledger")).toBeHidden();
  await chip.click();
  await expect(page.locator(href as string)).toBeVisible();
  await expect(page.locator("#results table tbody tr")).not.toHaveCount(0);
  await ctx.close();
});

test("results: metrics as rows and runs as columns, no sideways scroll at 1440 or 1920, one cell for a run without rates", async ({
  browser,
}) => {
  type Bars = { bars: { metric: string; value: number | null; pass: boolean | null }[] };
  const evals = JSON.parse(readFileSync(join(import.meta.dirname, "../../../apps/docs/src/data/evals.json"), "utf8")) as {
    full: Bars & { status: string; completed: number; datasets: number };
    smoke: Bars & { status: string };
    synthetic: Bars & { status: string };
    real: { datasets: { checks: { pass: boolean }[] }[] };
  };
  const fmt = (metric: string, v: number) => (metric === "Number mismatches" ? String(v) : `${(v * 100).toFixed(1)}%`);
  for (const width of [1440, 1920]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(LANDING, { waitUntil: "networkidle" });
    const wrap = page.locator("#results .aa-ledger-wrap");
    expect(await wrap.evaluate((e) => e.scrollWidth - e.clientWidth), `width ${width}`).toBe(0);
    const table = page.locator("#results table");
    await expect(table.locator('thead th[scope="col"]')).toHaveCount(5);
    await expect(table.locator('tbody th[scope="row"]')).toHaveCount(7);
    // Screen-reader text stays off screen: no "meets the bar" painted in the cells.
    const painted = await table.locator(".aa-sr").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 1).length);
    expect(painted).toBe(0);
    // A run that didn't finish has one cell spanning every metric row, labelled from the generated status.
    if (evals.full.status !== "complete") {
      const span = table.locator("td.aa-span", { hasText: `${evals.full.completed}/${evals.full.datasets}` });
      await expect(span).toHaveAttribute("rowspan", "7");
    }
    // Every figure is its run's own value from evals.json, in the row of its metric, with "below bar" exactly where the
    // run missed the bar. Columns with rates, in page order: smoke, then the nightly run if complete, then the baseline.
    const shown = [evals.smoke, evals.full, evals.synthetic].filter((r) => r.status === "complete");
    const rows = await table.locator("tbody tr").all();
    for (const row of rows) {
      const metric = ((await row.locator('th[scope="row"] .aa-metric').textContent()) ?? "").trim();
      const cells = row.locator("td.num");
      await expect(cells).toHaveCount(shown.length);
      for (const [k, run] of shown.entries()) {
        const b = run.bars.find((x) => x.metric === metric);
        expect(b, metric).toBeTruthy();
        const cell = cells.nth(k);
        await expect(cell.locator(".aa-fig"), metric).toHaveText(fmt(metric, b?.value ?? Number.NaN));
        if (b?.pass === false) await expect(cell.locator(".aa-below"), metric).toHaveCount(1);
        else await expect(cell.locator(".aa-below"), metric).toHaveCount(0);
      }
    }
    // The real public data cell: the checks passed of all checks, counted from the result file.
    const checks = evals.real.datasets.flatMap((d) => d.checks);
    await expect(table.locator('td.aa-span[headers="aa-run-real"]')).toContainText(
      `${checks.filter((c) => c.pass).length}/${checks.length}`,
    );
    await ctx.close();
  }
  // At 390 the table scrolls inside its wrapper and the metric column stays at its left edge.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(LANDING, { waitUntil: "networkidle" });
  const wrap = page.locator("#results .aa-ledger-wrap");
  expect(await wrap.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeGreaterThan(0);
  await wrap.evaluate((e) => {
    e.scrollLeft = e.scrollWidth;
  });
  const [wrapLeft, labelLeft] = await wrap.evaluate((e) => [
    e.getBoundingClientRect().left,
    (e.querySelector('tbody th[scope="row"]') as HTMLElement).getBoundingClientRect().left,
  ]);
  expect(Math.abs((labelLeft ?? 0) - (wrapLeft ?? 0))).toBeLessThan(2);
  await ctx.close();
});

test("landing section heads: label, h2, one-sentence lead; at 1440 a wide row's head beside its visual, a band's h2 on one line", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  for (const id of ["how", "why", "results", "quickstart"]) {
    const head = page.locator(`#${id} .aa-cell-head`);
    await expect(head.locator(".aa-seclabel")).toHaveCount(1);
    await expect(head.locator("h2")).toHaveCount(1);
    const lead = head.locator("p.aa-lead");
    await expect(lead, id).toHaveCount(1);
    // One sentence (a semicolon may join two clauses), about 90 characters at most.
    const text = ((await lead.textContent()) ?? "").trim().replace(/\s+/g, " ");
    expect(text.split(/[.!?](\s|$)/).filter((x) => x.trim().length > 2).length, id).toBe(1);
    expect(text.length, id).toBeLessThanOrEqual(90);
    const [h, lh] = await head
      .locator("h2")
      .evaluate((el) => [el.getBoundingClientRect().height, Number.parseFloat(getComputedStyle(el).lineHeight)]);
    // Site v4: §3 is a full-width band, its h2 on one line; §1, §2 and §4 are wide rows, the head (h2 in at most two
    // lines) in the left column and the visual to its right, both starting at the row's top.
    if (id === "results") expect(h, `${id} h2 on one line`).toBeLessThan((lh ?? 0) * 1.5);
    else {
      expect(h, `${id} h2 in at most two lines`).toBeLessThan((lh ?? 0) * 2.5);
      const [headBox, visualBox] = await page
        .locator(`#${id} .aa-split`)
        .evaluate((row) => [...row.children].slice(0, 2).map((c) => c.getBoundingClientRect().toJSON() as DOMRect));
      expect(visualBox?.left ?? 0, `${id} visual right of its head`).toBeGreaterThan(headBox?.right ?? 0);
      expect(Math.abs((visualBox?.top ?? 0) - (headBox?.top ?? 0)), `${id} same row`).toBeLessThan(1);
    }
  }
});

test("code is one size everywhere: blocks, inline code and Expressive Code (--aa-text-code); headings keep their scale", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const path of [
    LANDING,
    `${BASE}/start/quickstart/`,
    `${BASE}/learn/stages/analysis/`,
    `${BASE}/how-it-works/verifier/`,
    `${BASE}/how-it-works/drivers/`,
    `${BASE}/how-it-works/pipeline/`,
    `${BASE}/use-it/cli/`,
    MISSING,
  ]) {
    await page.goto(path, { waitUntil: "networkidle" });
    const sizes = await page.evaluate(() => {
      const want = getComputedStyle(document.documentElement).getPropertyValue("--aa-text-code").trim();
      const px = Number.parseFloat(want) * Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
      const shown = [...document.querySelectorAll<HTMLElement>("main pre, main code")].filter(
        (e) => e.getClientRects().length > 0 && (e.textContent ?? "").trim(),
      );
      // The one exception: code in a heading keeps the heading's scale (0.875em of it).
      const heading = (e: HTMLElement) => e.closest<HTMLElement>("h1, h2, h3, h4, h5, h6");
      const off = shown
        .filter((e) => !heading(e))
        .map((e) => Number.parseFloat(getComputedStyle(e).fontSize))
        .filter((v) => Math.abs(v - px) > 0.1);
      const headingOff = shown.filter((e) => {
        const h = heading(e);
        if (!h) return false;
        return Math.abs(Number.parseFloat(getComputedStyle(e).fontSize) - 0.875 * Number.parseFloat(getComputedStyle(h).fontSize)) > 0.2;
      }).length;
      return { off: [...new Set(off)], headingOff, n: shown.length };
    });
    if (path !== MISSING) expect(sizes.n, path).toBeGreaterThan(0);
    expect(sizes.off, path).toEqual([]);
    expect(sizes.headingOff, path).toBe(0);
  }
});

test("Quickstart and door commands fit their cells at 1440, 390 and 360, never split mid-word", async ({ page }) => {
  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(LANDING, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    for (const pre of await page.locator(".aa-steps pre, .aa-door-cmd").all()) {
      expect(await pre.evaluate((e) => e.scrollWidth - e.clientWidth), `${width}`).toBeLessThanOrEqual(0);
      // A visual line never starts inside a word: each new line follows a space, a slash or a line break.
      const mid = await pre.evaluate((e) => {
        const range = document.createRange();
        const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
        let lastTop = -1;
        let prev = "\n";
        let count = 0;
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const text = n.textContent ?? "";
          for (let i = 0; i < text.length; i++) {
            const ch = text[i] ?? "";
            if (ch !== "\n") {
              range.setStart(n, i);
              range.setEnd(n, i + 1);
              const top = Math.round(range.getBoundingClientRect().top);
              if (lastTop >= 0 && top > lastTop && prev !== "\n" && !/[\s/]/.test(prev)) count++;
              lastTop = top;
            }
            prev = ch;
          }
        }
        return count;
      });
      expect(mid, `${width}`).toBe(0);
    }
    // At 1440 the commands fit their columns line for line; the one allowed wrap is the clone URL's, and its second line
    // starts where its first does.
    {
      // Rendered lines are counted from the text itself (the cells stretch to the tallest, so heights can't tell).
      const soft = await page.locator(".aa-steps pre").evaluateAll((pres) =>
        pres.map((e) => {
          const range = document.createRange();
          const rowsOf = (root: Element) => {
            const tops = new Set<number>();
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
              const text = n.textContent ?? "";
              for (let k = 0; k < text.length; k++) {
                if (text[k] === "\n" || text[k] === " ") continue;
                range.setStart(n, k);
                range.setEnd(n, k + 1);
                tops.add(Math.round(range.getBoundingClientRect().top));
              }
            }
            return tops;
          };
          const lines = (e.textContent ?? "").split("\n").length;
          const url = e.querySelector(".aa-url");
          const urlTops = url ? [...rowsOf(url)] : [];
          // The URL's continuation starts where its first line does: the inline block's left edge.
          const first = url?.getBoundingClientRect().left ?? 0;
          const starts: number[] = [];
          if (url) {
            const walker = document.createTreeWalker(url, NodeFilter.SHOW_TEXT);
            let last = -1;
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
              const text = n.textContent ?? "";
              for (let k = 0; k < text.length; k++) {
                range.setStart(n, k);
                range.setEnd(n, k + 1);
                const r = range.getBoundingClientRect();
                if (Math.round(r.top) !== last) starts.push(r.left);
                last = Math.round(r.top);
              }
            }
          }
          // …and that is indented under "git clone \\" (it sits beside its two spaces, not on a line of its own).
          const pad = e.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(e).paddingLeft);
          return {
            extra: rowsOf(e).size - lines - Math.max(0, urlTops.length - 1),
            aligned: starts.every((x) => Math.abs(x - first) < 1) && (!url || first - pad > 8),
          };
        }),
      );
      for (const x of soft) {
        // Every source line fits its column at 1440; at every width the URL's continuation is indented under it.
        if (width === 1440) expect(x.extra).toBe(0);
        expect(x.aligned, `${width}`).toBe(true);
      }
    }
  }
});

test("the hero's install line wraps after github.com/ at 390 and 360, never clipped, and fits on two lines at 1440", async ({ page }) => {
  for (const [width, lines] of [
    [390, 3],
    [360, 3],
    [1440, 2],
  ] as const) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(LANDING, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const box = page.locator(".aa-hero-cmd");
    // Nothing overflows the box (no clipped text, no inner scroll) and the page doesn't scroll sideways.
    expect(await box.evaluate((e) => e.scrollWidth - e.clientWidth), `${width}`).toBeLessThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${width}`).toBeLessThanOrEqual(0);
    const code = box.locator("code");
    const lh = await code.evaluate((e) => Number.parseFloat(getComputedStyle(e).lineHeight));
    expect(Math.round(((await code.boundingBox())?.height ?? 0) / lh), `${width}: lines`).toBe(lines);
    // The URL's second line starts under its first, and the break is right after "github.com/".
    const url = box.locator(".aa-url");
    await expect(url).toContainText("https://github.com/gfirik/agentic-analytics");
    if (lines === 3) {
      const [first, second] = await url.evaluate((e) => {
        const r = document.createRange();
        r.selectNodeContents(e);
        return [...r.getClientRects()].map((q) => Math.round(q.left));
      });
      expect(second, `${width}: second line under the first`).toBeGreaterThanOrEqual((first ?? 0) - 1);
      expect(await box.locator(".aa-nowrap").evaluate((e) => e.getClientRects().length)).toBe(1);
    }
  }
});

test("the status strip scrolls sideways with no scrollbar and a fade where there is more", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  for (const sel of [".aa-strip"]) {
    const box = page.locator(sel);
    expect(
      await box.evaluate((e: HTMLElement) => e.offsetHeight - e.clientHeight - 2 * Number.parseFloat(getComputedStyle(e).borderTopWidth)),
      sel,
    ).toBeLessThanOrEqual(1);
    await expect(box, sel).toHaveAttribute("data-overflow", "end");
    await box.evaluate((e) => {
      e.scrollLeft = e.scrollWidth;
    });
    await expect(box, sel).toHaveAttribute("data-overflow", "start");
    await box.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(box, sel).toHaveAttribute("data-overflow", "both");
    // Focused, nothing is masked, so the focus ring outside the box shows (WCAG 2.4.7).
    expect(await box.evaluate((e) => getComputedStyle(e).maskImage), sel).toBe("none");
    await page.locator("h1").click();
    expect(await box.evaluate((e) => getComputedStyle(e).maskImage), sel).not.toBe("none");
  }
  // Where the whole line fits, nothing fades (at 1440 the strip is still a little wider than the screen).
  await page.setViewportSize({ width: 1920, height: 1000 });
  await expect(page.locator(".aa-strip")).toHaveAttribute("data-overflow", "none");
});

test("the status strip leads with proven results and links the nightly regression suite to §3", async ({ page }) => {
  await page.goto(LANDING);
  await expect(page.locator(".aa-strip")).toContainText(
    /v\d+\.\d+\.\d+ (pre-)?release\s*·\s*real public data: \d+\/\d+ checks\s*·\s*real-model smoke: \d+\/\d+ jobs[^·]*·\s*\d+ test files\s*·\s*verifier on every report\s*·\s*nightly regression: \d+ generated businesses/,
  );
  await expect(page.locator(".aa-strip")).not.toContainText(/in progress|partial/);
  await expect(page.locator(".aa-strip a")).toHaveAttribute("href", "#results");
});

test("hero proof chips: every figure is the generated data's, cross-checked against the runs it names (site v5 PR 1b)", async ({
  page,
}) => {
  const DATA = join(import.meta.dirname, "../../../apps/docs/src/data");
  const evals = JSON.parse(readFileSync(join(DATA, "evals.json"), "utf8")) as {
    proof: { id: string; figure: string; text: string; href: string; source: string }[];
    real: { file: string; datasets: { checks: { pass: boolean }[] }[] };
    smoke: { file: string; bars: { metric: string; value: number | null }[] };
  };
  const pipeline = JSON.parse(readFileSync(join(import.meta.dirname, "../../../docs/assets/readme/pipeline.json"), "utf8")) as {
    checks: { check: string }[];
  };
  // The figures, recomputed here from the runs themselves rather than read back from the chips' own data.
  const checks = evals.real.datasets.flatMap((d) => d.checks);
  const mismatches = evals.smoke.bars.find((b) => b.metric === "Number mismatches")?.value;
  const expected: Record<string, { figure: string; href: string; source: RegExp }> = {
    real: { figure: `${checks.filter((c) => c.pass).length}/${checks.length}`, href: "#results", source: new RegExp(evals.real.file) },
    numbers: { figure: String(mismatches), href: "#results", source: new RegExp(evals.smoke.file) },
    verifier: { figure: `V1–V${pipeline.checks.length}`, href: `${BASE}/how-it-works/verifier/`, source: /checks on every report/ },
    local: { figure: "", href: `${BASE}/models/running-free/`, source: /ollama:.*transformers:/ },
  };
  expect(evals.proof.map((c) => c.id)).toEqual(["real", "numbers", "verifier", "local"]);
  await page.goto(LANDING);
  const chips = page.locator(".aa-hero-proof .aa-pchip");
  await expect(chips).toHaveCount(4);
  for (const [i, c] of evals.proof.entries()) {
    const want = expected[c.id] as (typeof expected)[string];
    const chip = chips.nth(i);
    expect(c.figure, c.id).toBe(want.figure);
    await expect(chip).toHaveAttribute("data-proof", c.id);
    await expect(chip).toHaveAttribute("href", want.href);
    await expect(chip).toHaveAttribute("title", want.source);
    // What the chip shows is the figure and the text, nothing typed beside them; its source is read after it.
    await expect(chip.locator(".aa-pchip-text")).toHaveText(c.text);
    if (want.figure) await expect(chip.locator(".aa-pchip-figure")).toHaveText(want.figure);
    else await expect(chip.locator(".aa-pchip-figure")).toHaveCount(0);
    await expect(chip.locator("svg")).toHaveCount(1);
  }
  // The real-data figure is the status strip's figure, the same run.
  await expect(page.locator(".aa-strip")).toContainText(`real public data: ${expected.real?.figure} checks`);
});

test("hero type and spacing at 390 and 360: the eyebrow on one line, each headline voice on one line, a full gap above the exhibit", async ({
  browser,
}) => {
  for (const width of [390, 360]) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(LANDING, { waitUntil: "networkidle" });
    const lines = await page.evaluate(() => {
      const one = (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement;
        const lh = Number.parseFloat(getComputedStyle(el).lineHeight) || Number.parseFloat(getComputedStyle(el).fontSize) * 1.2;
        return Math.round(el.getBoundingClientRect().height / lh);
      };
      return { eyebrow: one(".aa-hero-eyebrow"), sans: one(".aa-hero-title-sans"), serif: one(".aa-hero-title-serif") };
    });
    expect(lines.eyebrow, `${width}: eyebrow`).toBeLessThanOrEqual(2); // one line in a padded tag
    expect(await page.locator(".aa-hero-eyebrow").evaluate((el) => el.getClientRects().length)).toBe(1);
    expect(lines.sans, `${width}: sans voice`).toBe(1);
    expect(lines.serif, `${width}: serif voice`).toBe(1);
    const eyebrowH = await page.locator(".aa-hero-eyebrow").evaluate((el) => el.getBoundingClientRect().height);
    expect(eyebrowH, `${width}: the eyebrow tag is one line tall`).toBeLessThan(32);
    // No pause control (site v5 PR 2, the maintainer's call): a full row gap (at least 32px) from the install line to the
    // exhibit's label.
    await expect(page.locator("[data-hf-toggle], .aa-hero button")).toHaveCount(0);
    const gap = await page.evaluate(() => {
      const t = (document.querySelector(".aa-hero-cmd-frame") as HTMLElement).getBoundingClientRect();
      const l = (document.querySelector(".aa-exhibit-label") as HTMLElement).getBoundingClientRect();
      return l.top - t.bottom;
    });
    expect(gap, `${width}: install line to the exhibit's label`).toBeGreaterThanOrEqual(32);
    await ctx.close();
  }
});

test("hero glow: the lead and headline keep AA over the accent at its strongest behind them (1440, 1100, 390)", async ({ browser }) => {
  for (const [width, height] of [
    [1440, 900],
    [1100, 800],
    [390, 844],
  ] as const) {
    const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto(LANDING, { waitUntil: "networkidle" });
    const colours = await page.evaluate(() => ({
      lead: getComputedStyle(document.querySelector(".aa-statement > .aa-lead") as Element).color,
      title: getComputedStyle(document.querySelector(".aa-hero-title") as Element).color,
    }));
    // Only the glow behind the text: the text made transparent, the paper's 1px lines and the grain hidden (they are
    // the page's existing graph paper, not this background), then the darkest pixel under each block is read.
    await page.addStyleTag({
      content:
        ".aa-statement *{color:transparent!important;text-decoration-color:transparent!important} .aa-hf-grid,.aa-hf-grain,.aa-hf-net{display:none!important}",
    });
    await page.waitForTimeout(200);
    const png = (await page.screenshot()).toString("base64");
    const ratios = await page.evaluate(
      async ({ png, colours }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${png}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext("2d") as CanvasRenderingContext2D;
        g.drawImage(img, 0, 0);
        const lin = (v: number) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        };
        const lum = (r: number, gr: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(gr) + 0.0722 * lin(b);
        const of = (css: string) => {
          const [r, gr, b] = (css.match(/\d+/g) ?? []).map(Number) as [number, number, number];
          return lum(r, gr, b);
        };
        const ratio = (sel: string, fg: string) => {
          const r = (document.querySelector(sel) as Element).getBoundingClientRect();
          const d = g.getImageData(
            Math.max(0, r.x),
            Math.max(0, r.y),
            Math.min(r.width, c.width - r.x),
            Math.min(r.height, c.height - r.y),
          ).data;
          let min = 1;
          for (let i = 0; i < d.length; i += 4) min = Math.min(min, lum(d[i] as number, d[i + 1] as number, d[i + 2] as number));
          return (min + 0.05) / (of(fg) + 0.05);
        };
        return { lead: ratio(".aa-statement > .aa-lead", colours.lead), title: ratio(".aa-hero-title", colours.title) };
      },
      { png, colours },
    );
    expect(ratios.lead, `${width}: lead`).toBeGreaterThanOrEqual(4.5);
    expect(ratios.title, `${width}: headline`).toBeGreaterThanOrEqual(4.5);
    await ctx.close();
  }
});

test("Learn: sidenotes sit in the margin beside their line at 1440 px, and expand inline on tap under 1000 px", async ({ page }) => {
  const path = `${BASE}/learn/stages/analysis/`;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(path, { waitUntil: "networkidle" });
  const note = page.locator(".aa-sn:not(.aa-mn) .aa-sn-note").first();
  const ref = page.locator(".aa-sn:not(.aa-mn) .aa-sn-ref").first();
  await note.scrollIntoViewIfNeeded();
  const [n, r, article] = await Promise.all([note.boundingBox(), ref.boundingBox(), page.locator(".sl-markdown-content").boundingBox()]);
  expect(n?.x ?? 0).toBeGreaterThanOrEqual((article?.x ?? 0) + (article?.width ?? 0));
  expect(Math.abs((n?.y ?? 0) - (r?.y ?? 0))).toBeLessThan(40);
  await expect(ref).toHaveText(/1$/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  await expect(note).toBeHidden();
  await ref.scrollIntoViewIfNeeded();
  await ref.click();
  await expect(note).toBeVisible();
  // The checkbox behind it takes the keyboard too.
  await ref.click();
  await expect(note).toBeHidden();
  await page.locator(".aa-sn-toggle").first().focus();
  await page.keyboard.press("Space");
  await expect(note).toBeVisible();
});

test("Learn: a stage page opens with its epigraph, and the TOC sits in the margin column from 1200 px", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/learn/stages/analysis/`);
  await expect(page.locator(".aa-epigraph")).toHaveCount(1);
  const toc = page.locator(".aa-margin-toc starlight-toc");
  await expect(toc).toBeVisible();
  const [t, article] = await Promise.all([toc.boundingBox(), page.locator(".sl-markdown-content").boundingBox()]);
  expect(t?.x ?? 0).toBeGreaterThan((article?.x ?? 0) + (article?.width ?? 0));
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(toc).toBeHidden();
  await expect(page.locator("mobile-starlight-toc summary")).toBeVisible();
});

test("Learn: every fact chip on every Learn page lands on a row of that page's fact ledger", async ({ page, request }) => {
  const paths = (await sitemapPaths(request)).filter((p) => p.includes("/learn/"));
  expect(paths.length).toBe(17);
  const broken: string[] = [];
  for (const path of paths) {
    await page.goto(path);
    const missing = await page.evaluate(() =>
      [...document.querySelectorAll("a[href^='#fact-']")]
        .map((a) => a.getAttribute("href") ?? "")
        .filter((h) => !document.getElementById(h.slice(1))),
    );
    for (const m of new Set(missing)) broken.push(`${path} ${m}`);
  }
  expect(broken).toEqual([]);
});

test("Learn: a stage diagram is complete without JS, and a step marks what it produced", async ({ browser, page }) => {
  const path = `${BASE}/learn/stages/analysis/`;
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const off = await ctx.newPage();
  await off.goto(path);
  const flow = off.locator(".aa-flow").first();
  await expect(flow.locator(".aa-flow-col").nth(2).locator("li")).not.toHaveCount(0);
  await expect(flow.locator("li.is-current")).toHaveCount(0);
  await ctx.close();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(path, { waitUntil: "networkidle" });
  const live = page.locator(".aa-flow").first();
  // The island hydrates when it scrolls into view (client:visible); Astro drops the `ssr` attribute when it has.
  await live.scrollIntoViewIfNeeded();
  await expect(page.locator("astro-island", { has: live })).not.toHaveAttribute("ssr", /.*/);
  await expect(live.locator("button", { hasText: "Play" })).toHaveCount(0);
  await live.locator("button", { hasText: "3 · Split the change" }).click();
  await expect(live.locator("button", { hasText: "3 · Split the change" })).toHaveAttribute("aria-pressed", "true");
  await expect(live.locator(".aa-flow-col").nth(2).locator("li.is-current")).not.toHaveCount(0);
});

test("pipeline stages: still until Play; a stop opens its panel; Play steps once to Report and stops; nothing moves", async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  const root = page.locator(".aa-stages");
  // To the rail's top, so the engine machine's full-screen stage just above is wholly off screen: under the fake
  // clock every runFor would otherwise draw its frames (SwiftShader), slowing the page enough to flake the crossfade.
  await root.evaluate((el) => el.scrollIntoView({ block: "start" }));
  const current = root.locator(".aa-stage.is-current");
  const stop = (name: string) => root.getByRole("button", { name, exact: true });
  // The finished report first, and still.
  await expect(current).toHaveCount(1);
  await expect(current.locator(".aa-stage-name")).toContainText("Report");
  await page.clock.runFor(6000);
  await expect(current.locator(".aa-stage-name")).toContainText("Report");
  const below = async () => page.locator("#why").evaluate((el) => Math.round(el.getBoundingClientRect().top + window.scrollY));
  const y = await below();
  // A stop opens its panel; only that panel is visible.
  await stop("Files").click();
  await expect(stop("Files")).toHaveAttribute("aria-pressed", "true");
  await expect(root.locator("#aa-stages-files")).toBeVisible();
  await expect(root.locator("#aa-stages-report")).toBeHidden();
  expect(await below()).toBe(y);
  // Play steps through the stops, reads Pause while it runs, and stops at Report.
  const play = root.locator("[data-stages-play]");
  await play.click();
  await expect(play).toHaveText("Pause");
  await page.clock.runFor(2600);
  await expect(current.locator(".aa-stage-name")).toContainText("Profile");
  await page.clock.runFor(2600 * 6);
  await expect(current.locator(".aa-stage-name")).toContainText("Report");
  await expect(play).toHaveText("Play");
  expect(await below()).toBe(y);
  // Pressing a stop while playing stops it there.
  await play.click();
  await page.clock.runFor(2600);
  await stop("SQL").click();
  await expect(play).toHaveText("Play");
  await page.clock.runFor(6000);
  await expect(current.locator(".aa-stage-name")).toContainText("SQL");
});

test("pipeline stages: a stacked list without JS and under 40rem, no Play under reduced motion; type at the site's sizes", async ({
  browser,
}) => {
  for (const opts of [{ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } }, { viewport: { width: 390, height: 844 } }]) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    await page.goto(LANDING, { waitUntil: "networkidle" });
    const root = page.locator(".aa-stages");
    await expect(root.locator(".aa-stage")).toHaveCount(7);
    for (const panel of await root.locator(".aa-stage").all()) await expect(panel).toBeVisible();
    await expect(root.locator(".aa-stages-bar")).toBeHidden();
    await ctx.close();
  }
  // On docs pages too (Starlight's prose styles must not reach in): one panel shown, the others hidden, every row on one
  // line at 1440; at 390 the stacked list, each panel below the last with no overlap.
  for (const path of [`${BASE}/learn/`, `${BASE}/start/what-it-is/`, `${BASE}/how-it-works/pipeline/`]) {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      await page.goto(path, { waitUntil: "networkidle" });
      const panels = page.locator(".aa-stages .aa-stage");
      await expect(panels).toHaveCount(7);
      if (viewport.width === 1440) {
        await expect(page.locator(".aa-stages .aa-stage.is-current")).toBeVisible();
        for (const p of await page.locator(".aa-stages .aa-stage:not(.is-current)").all()) await expect(p).toBeHidden();
        const sql = page.locator(".aa-stages").getByRole("button", { name: "SQL", exact: true });
        await sql.click();
        // Each SQL row's label and value share a line.
        const off = await page.locator(".aa-stages .aa-stage-sql tr").evaluateAll((rows) =>
          rows.map((r) => {
            const [a, b] = [...r.children].map((c) => c.getBoundingClientRect().top);
            return Math.abs((a ?? 0) - (b ?? 0));
          }),
        );
        expect(Math.max(...off), path).toBeLessThan(4);
      } else {
        const off = await page.locator(".aa-stages .aa-stage-sql tr").evaluateAll((rows) =>
          rows.map((r) => {
            const [a, b] = [...r.children].map((c) => c.getBoundingClientRect().top);
            return Math.abs((a ?? 0) - (b ?? 0));
          }),
        );
        expect(Math.max(...off), path).toBeLessThan(4);
        const boxes = await panels.evaluateAll((ps) => ps.map((p) => p.getBoundingClientRect()).map((r) => [r.top, r.bottom]));
        for (let i = 1; i < boxes.length; i++) expect(boxes[i]?.[0] ?? 0, path).toBeGreaterThanOrEqual((boxes[i - 1]?.[1] ?? 0) - 1);
      }
      await ctx.close();
    }
  }
  const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/learn/`, { waitUntil: "networkidle" });
  const root = page.locator(".aa-stages");
  await expect(root.locator(".aa-stages-bar")).toBeVisible();
  await expect(root.locator("[data-stages-play]")).toBeHidden();
  await root.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(root.locator("#aa-stages-verify")).toBeVisible();
  // DESIGN.md §4: reading text in a figure is at least note size (13px); labels and chips at least label size (12px).
  const small = await root.evaluate((el) =>
    [...el.querySelectorAll<HTMLElement>("*")]
      .filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim()))
      .map((e) => {
        const cs = getComputedStyle(e);
        const label = cs.textTransform === "uppercase" || e.closest(".aa-chip") !== null;
        return { text: e.textContent?.trim().slice(0, 30), px: Number.parseFloat(cs.fontSize), min: label ? 12 : 13 };
      })
      .filter((x) => x.px < x.min),
  );
  expect(small).toEqual([]);
  await ctx.close();
});

test("type on every page in the sitemap: nothing above h2 but the hero and the page's h1; floors for reading text and labels", async ({
  page,
  request,
}) => {
  test.setTimeout(400_000);
  const off: string[] = [];
  const paths = await sitemapPaths(request);
  // Every page at 1440; the landing page and two Learn pages at 390 too (the mobile scale differs).
  const runs = [
    ...paths.map((p) => [p, 1440] as const),
    ...[LANDING, `${BASE}/learn/`, `${BASE}/learn/stages/analysis/`].map((p) => [p, 390] as const),
  ];
  for (const [path, width] of runs) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(path, { waitUntil: "networkidle" });
    const found = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const rem = Number.parseFloat(root.fontSize);
      const h2 = Number.parseFloat(root.getPropertyValue("--aa-text-h2")) * rem;
      // A figure: any diagram, island, ledger or framed panel (DESIGN.md §4).
      const figures = document.querySelectorAll(
        ".aa-island, .aa-flow, .aa-stages, .aa-exhibit, .aa-notes, .aa-walk-list, .aa-ledger-wrap, .aa-transcript, .aa-diagram, .aa-proofs, .aa-map",
      );
      const out: string[] = [];
      const seen = new Set<Element>();
      const check = (e: Element, inFigure: boolean) => {
        if (seen.has(e) || !e.getClientRects().length || e.closest(".aa-sr")) return;
        seen.add(e);
        const own = [...e.childNodes]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent ?? "")
          .join("")
          .trim();
        if (!own) return;
        const cs = getComputedStyle(e);
        const px = Number.parseFloat(cs.fontSize);
        // The ceiling: only the hero statement and the page's own h1 may be larger than h2.
        if (px > h2 + 0.5 && !e.closest(".aa-display, h1")) out.push(`${px}px above h2: "${own.slice(0, 30)}"`);
        // Labels: mono uppercase labels, chips, and short mono tags and ids ("N141", "bar ≥ 80%", "recomputed"); a
        // figure (.aa-fig) is reading text, whatever its face.
        const label =
          !e.closest(".aa-fig") &&
          (cs.textTransform === "uppercase" || e.closest(".aa-chip") !== null || (/mono/i.test(cs.fontFamily) && own.length <= 32));
        if (px < 11.95) out.push(`${px}px under the label size: "${own.slice(0, 30)}"`);
        else if (inFigure && !label && px < 12.95) out.push(`${px}px reading text in a figure: "${own.slice(0, 30)}"`);
      };
      for (const f of figures) for (const e of f.querySelectorAll("*")) check(e, true);
      for (const e of document.querySelectorAll("main *")) check(e, false);
      return out;
    });
    for (const x of found) off.push(`${path} at ${width}: ${x}`);
  }
  expect(off).toEqual([]);
});

/** The id of the drivers' total change in the page's own data (coffee.json): never typed, since fact ids follow the run. */
function coffeeTotalId(): string {
  const { report } = JSON.parse(readFileSync(join(import.meta.dirname, "../../../apps/docs/src/data/coffee.json"), "utf8")) as {
    report: { findings: { drivers?: { fact: string }[] }[]; facts: { id: string; label: string; computation: { inputs?: string[] } }[] };
  };
  const drivers = new Set((report.findings.find((f) => f.drivers?.length)?.drivers ?? []).map((d) => d.fact));
  const total = report.facts.find(
    (f) =>
      f.label.endsWith(":delta:total") &&
      (f.computation.inputs ?? []).length === drivers.size &&
      (f.computation.inputs ?? []).every((i) => drivers.has(i)),
  );
  if (!total) throw new Error("coffee.json has no total change for its drivers");
  return total.id;
}

test("the contribution bridge: one row per total and member, bars on one shared scale, connectors joining them", async ({ page }) => {
  for (const path of [`${BASE}/learn/stages/analysis/`, `${BASE}/start/first-report/`, `${BASE}/how-it-works/drivers/`]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path, { waitUntil: "networkidle" });
    const bridge = page.locator(".aa-bridge").first();
    await bridge.scrollIntoViewIfNeeded();
    await expect(bridge.locator(".aa-island-label")).toContainText("Contribution by channel");
    await expect(bridge.locator(".aa-bridge-row")).toHaveCount(4);
    await expect(bridge).not.toContainText("Everyone else");
    // The page's own data (coffee.json) proves every member is drawn: the caption says so with the total's id.
    await expect(bridge.locator("p.aa-small")).toContainText("The members drawn are all of them");
    await expect(bridge.locator("p.aa-small")).toContainText(coffeeTotalId());
    await expect(bridge).not.toContainText("not drawn");
    const geo = await bridge.evaluate((el) => {
      const tracks = [...el.querySelectorAll(".aa-bridge-track")].map((t) => t.getBoundingClientRect());
      const rows = [...el.querySelectorAll(".aa-bridge-row")];
      // Each connector sits at an end of the bar above it: the level it carries down to the next bar.
      const joins = rows.slice(1).map((row, i) => {
        const link = row.querySelector(".aa-bridge-link")?.getBoundingClientRect();
        const above = rows[i]?.querySelector(".aa-bridge-bar")?.getBoundingClientRect();
        if (!link || !above) return 999;
        return Math.min(Math.abs(link.left - above.left), Math.abs(link.left - above.right));
      });
      // The bridge itself: March ends where wholesale starts (its right edge, a fall), wholesale ends where retail starts
      // (its left edge), retail ends where April does.
      const bars = rows.map((r) => r.querySelector(".aa-bridge-bar")?.getBoundingClientRect());
      const ends = [
        Math.abs((bars[0]?.right ?? 0) - (bars[1]?.right ?? 9)),
        Math.abs((bars[1]?.left ?? 0) - (bars[2]?.left ?? 9)),
        Math.abs((bars[2]?.right ?? 0) - (bars[3]?.right ?? 9)),
      ];
      return {
        lefts: tracks.map((t) => Math.round(t.left)),
        widths: tracks.map((t) => Math.round(t.width)),
        joins,
        ends,
        track: tracks[0]?.width ?? 0,
      };
    });
    expect(new Set(geo.lefts).size, path).toBe(1);
    expect(new Set(geo.widths).size, path).toBe(1);
    for (const j of geo.joins) expect(j, path).toBeLessThan(2);
    for (const e of geo.ends) expect(e, path).toBeLessThan(2);
    // Legible: the track has most of the island, not its minimum.
    expect(geo.track, path).toBeGreaterThan(200);
    // On a phone the bars stack under their labels at full width, and the connectors are hidden.
    await page.setViewportSize({ width: 390, height: 844 });
    const phone = await bridge.evaluate((el) => ({
      links: [...el.querySelectorAll(".aa-bridge-link")].filter((l) => l.getClientRects().length > 0).length,
      tracks: [...el.querySelectorAll(".aa-bridge-track")].map((t) => Math.round(t.getBoundingClientRect().width)),
      rows: Math.round((el.querySelector(".aa-bridge-rows") as HTMLElement).getBoundingClientRect().width),
    }));
    expect(phone.links, path).toBe(0);
    for (const w of phone.tracks) expect(w, path).toBe(phone.rows);
  }
});

test("mobile menu: aria-expanded toggles and Escape closes it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(MISSING);
  const button = page.locator("[data-aa-menu]");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#aa-site-menu")).toBeHidden();
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#aa-site-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(button).toBeFocused();
});

test("site files are served", async ({ request }) => {
  for (const [path, type] of [
    ["favicon.svg", "image/svg+xml"],
    ["favicon.ico", "image/"],
    ["og.png", "image/png"],
    ["machine-wide.webp", "image/webp"],
    ["machine-wide.png", "image/png"],
    ["machine-tall.webp", "image/webp"],
    ["machine-tall.png", "image/png"],
    ["sitemap.xml", "xml"],
    ["sitemap-index.xml", "xml"],
  ] as const) {
    const res = await request.get(`${BASE}/${path}`);
    expect(res.status(), path).toBe(200);
    expect(res.headers()["content-type"] ?? "", path).toContain(type);
  }
  const sitemap = await (await request.get(`${BASE}/sitemap-0.xml`)).text();
  expect(sitemap).toContain("<loc>https://gfirik.github.io/agentic-analytics/</loc>");
  expect(sitemap).toContain("/how-it-works/verifier/");
});

test("head: favicons, absolute OG image and canonical on the landing page and the docs", async ({ page }) => {
  for (const path of [LANDING, DOCS[0] as string]) {
    await page.goto(path);
    await expect(page.locator("link[rel~='icon'][href$='/agentic-analytics/favicon.svg']")).toHaveCount(1);
    await expect(page.locator("link[rel~='icon'][href$='/agentic-analytics/favicon.ico']")).toHaveCount(1);
    await expect(page.locator("meta[property='og:image']")).toHaveAttribute("content", "https://gfirik.github.io/agentic-analytics/og.png");
    await expect(page.locator("meta[name='twitter:image']")).toHaveAttribute(
      "content",
      "https://gfirik.github.io/agentic-analytics/og.png",
    );
  }
});

// The engine machine (apps/docs/DESIGN.md §6 "Engine machine", §7): a live band under the hero. WebGL runs on
// SwiftShader (playwright.config.ts); the device is made a capable one, except in the weak-device test.
test.describe("engine machine", () => {
  const CHUNK = /\/_astro\/machine-3d\.[^/]*\.js$/;
  /** An init script: the device's cores and memory as the page sees them. */
  const device = ([cores, memory]: number[]) => {
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => cores });
    Object.defineProperty(navigator, "deviceMemory", { get: () => memory });
  };
  const offOrigin = (url: string) => {
    const u = new URL(url);
    return !["127.0.0.1", "localhost"].includes(u.hostname) && !["data:", "blob:"].includes(u.protocol);
  };
  /** The share of the canvas's pixels within 1 of an sRGB colour, read from a screenshot of it (no hooks in the page). */
  const share = async (page: import("@playwright/test").Page, png: Buffer, token: string) =>
    page.evaluate(
      async ([b64, tok]) => {
        const want = getComputedStyle(document.documentElement).getPropertyValue(tok).trim();
        const rgb = [1, 3, 5].map((i) => Number.parseInt(want.slice(i, i + 2), 16));
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d");
        if (!ctx) return 0;
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let hit = 0;
        for (let i = 0; i < d.length; i += 4)
          if (
            Math.abs((d[i] ?? 0) - (rgb[0] ?? 0)) <= 1 &&
            Math.abs((d[i + 1] ?? 0) - (rgb[1] ?? 0)) <= 1 &&
            Math.abs((d[i + 2] ?? 0) - (rgb[2] ?? 0)) <= 1
          )
            hit++;
        return hit / (d.length / 4);
      },
      [png.toString("base64"), token] as const,
    );
  /**
   * The band's geometry (site v5): where its track starts on the page, how far it scrolls per share (each stop, the
   * home view included, holds an equal share), the number of stops after the home view, and the tour.
   */
  const band = (page: import("@playwright/test").Page) =>
    page.evaluate(() => {
      const track = document.querySelector<HTMLElement>("[data-track]");
      const stage = document.querySelector<HTMLElement>("[data-engine-stage]");
      if (!track || !stage) throw new Error("no band");
      const shares = Number(getComputedStyle(track.closest("[data-machine]") as Element).getPropertyValue("--aa-engine-stops"));
      const top = track.getBoundingClientRect().top + scrollY - (Number.parseFloat(getComputedStyle(stage).top) || 0);
      const tour = (
        JSON.parse(document.querySelector("[data-machine-data]")?.textContent ?? "{}") as { tour: { key: string; members: string[] }[] }
      ).tour;
      return {
        top,
        per: (track.offsetHeight - stage.offsetHeight) / shares,
        stops: shares - 1,
        tour,
        tall: track.offsetHeight > stage.offsetHeight + 10,
      };
    });
  type Band = Awaited<ReturnType<typeof band>>;
  const scrollToY = (page: import("@playwright/test").Page, y: number) => page.evaluate((v) => window.scrollTo(0, v), Math.round(y));
  /** The page's scroll position that holds the camera at stop k (0 is the home view). */
  const atStop = (b: Band, k: number) => b.top + (k + 0.5) * b.per;
  /** The stop (1-based) that shows a piece. */
  const stopOf = (b: Band, key: string) => b.tour.findIndex((t) => t.members.includes(key)) + 1;
  /** The visible station labels' boxes, and every pair that overlaps. */
  const labelBoxes = (page: import("@playwright/test").Page) =>
    page.evaluate(() => {
      const boxes = [...document.querySelectorAll<HTMLElement>("[data-tag]")]
        .filter((t) => getComputedStyle(t).visibility === "visible" && getComputedStyle(t).display !== "none")
        .map((t) => ({ id: t.dataset.id ?? "", r: t.getBoundingClientRect() }));
      const overlaps: string[] = [];
      for (const [i, a] of boxes.entries())
        for (const c of boxes.slice(i + 1))
          if (a.r.left < c.r.right && c.r.left < a.r.right && a.r.top < c.r.bottom && c.r.top < a.r.bottom)
            overlaps.push(`${a.id}/${c.id}`);
      return { ids: boxes.map((b) => b.id), overlaps };
    });
  const live = async (page: import("@playwright/test").Page, width: number, height: number) => {
    await page.addInitScript(device, [8, 8]);
    await page.setViewportSize({ width, height });
    await page.goto(LANDING);
    const b = await band(page);
    await scrollToY(page, atStop(b, 0));
    await expect(page.locator("[data-machine]")).toHaveAttribute("data-gl", "on", { timeout: 20_000 });
    return band(page);
  };

  test("live from load: the still frame first, three on idle with no input, hover shows a station's card, all on the site", async ({
    page,
  }) => {
    await page.addInitScript(device, [8, 8]);
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(LANDING);
    const root = page.locator("[data-machine]");
    await expect(root).toHaveAttribute("data-mode", "live");
    // The still frame is in the HTML with its own size; the band is tall, set before first paint.
    const still = page.locator(".aa-engine-still img");
    await expect(still).toHaveAttribute("width", /\d+/);
    expect((await band(page)).tall).toBe(true);
    // The exhibit's report page stays on the first screen, and the band follows the hero.
    expect(await page.locator(".aa-exhibit-page").evaluate((e) => e.getBoundingClientRect().top)).toBeLessThan((900 * 5) / 6);
    // three starts on idle after the page's load event, once the band is near: not while the first screen is in use.
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2500);
    expect(requests.filter((u) => CHUNK.test(u))).toEqual([]);
    await scrollToY(page, (await band(page)).top - 900);
    await expect(root).toHaveAttribute("data-gl", "on", { timeout: 20_000 });
    const timing = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      const chunk = performance.getEntriesByType("resource").find((r) => /machine-3d\./.test(r.name));
      return { load: nav.loadEventEnd, chunk: chunk?.startTime ?? -1 };
    });
    expect(timing.chunk).toBeGreaterThanOrEqual(timing.load);
    await expect(page.locator(".aa-engine-view canvas")).toBeVisible();

    // Hovering a station's label shows its card (the list's own entry) and presses it; the card links its Learn page.
    await scrollToY(page, atStop(await band(page), 0));
    const analysis = page.locator('[data-tag][data-id="analysis"]');
    await expect(analysis).toBeVisible();
    await analysis.hover();
    await expect(analysis).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-tag][aria-pressed="true"]')).toHaveCount(1);
    const card = page.locator("[data-card]");
    await expect(card.locator("[data-card-title]")).toHaveText(
      (await page.locator('.aa-stations li[data-station="analysis"] .aa-station-title').textContent()) ?? "?",
    );
    await expect(card.locator('a[href$="/learn/stages/analysis/"]')).toHaveCount(1);
    // The labels are buttons in station order, so the keyboard meets them in line order.
    const ids = await page.locator("[data-tag]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id ?? ""));
    expect(ids.slice(0, 11)).toEqual(
      await page
        .locator("ol.aa-stations > li[data-station]")
        .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.station ?? "")),
    );

    const axe = await new AxeBuilder({ page }).include(".aa-engine").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    expect(requests.filter(offOrigin)).toEqual([]);
  });

  test("the stage fills the screen with no frame, pins through the tour right after the hero, then releases", async ({ page }) => {
    const b = await live(page, 1440, 900);
    const stage = page.locator("[data-engine-stage]");
    const rect = () => stage.evaluate((e) => e.getBoundingClientRect().toJSON() as DOMRect);
    // At every stop the stage is the whole screen, in the same place; the view has no border or radius.
    for (const k of [0, Math.ceil(b.stops / 2), b.stops]) {
      await scrollToY(page, atStop(b, k));
      const r = await rect();
      expect([Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], `stop ${k}`).toEqual([0, 0, 1440, 900]);
    }
    const view = await page.locator("[data-viewport]").evaluate((e) => {
      const cs = getComputedStyle(e);
      return [cs.borderTopWidth, cs.borderLeftWidth, cs.borderTopLeftRadius];
    });
    expect(view).toEqual(["0px", "0px", "0px"]);
    // The band starts right where the hero ends (nothing between the hero's release and the stage).
    const gap = await page.evaluate(() => {
      const hero = document.querySelector(".aa-hero")?.getBoundingClientRect();
      const trackTop = document.querySelector("[data-track]")?.getBoundingClientRect().top ?? 0;
      return hero ? trackTop - hero.bottom : 999;
    });
    expect(Math.abs(gap)).toBeLessThanOrEqual(2);
    // Past the band the stage scrolls away and §1 follows.
    await scrollToY(page, b.top + b.per * (b.stops + 1) + 900);
    expect((await rect()).top).toBeLessThan(0);
    expect(await page.locator("#how").evaluate((e) => e.getBoundingClientRect().top)).toBeLessThan(900);
  });

  test("a quicker tour: about seven stops, each scroll share the next, the camera moving and the stop's pieces pressed", async ({
    page,
  }) => {
    const b = await live(page, 1440, 900);
    expect(b.stops).toBeGreaterThanOrEqual(6);
    expect(b.stops).toBeLessThanOrEqual(7);
    expect(b.tour.length).toBe(b.stops);
    const kicker = page.locator("[data-card-kicker]");
    const canvas = page.locator(".aa-engine-view canvas");
    await expect(kicker).toHaveText("How to read the machine");
    await page.waitForTimeout(600);
    let last = await canvas.screenshot();
    for (let k = 1; k <= b.stops; k++) {
      await scrollToY(page, atStop(b, k));
      await expect(kicker).toHaveText(new RegExp(`^Stop ${k} of ${b.stops}( · |$)`));
      const members = b.tour[k - 1]?.members ?? [];
      await expect(page.locator('[data-tag][aria-pressed="true"]')).toHaveCount(members.length);
      for (const m of members) await expect(page.locator(`[data-tag][data-id="${m}"]`)).toHaveAttribute("aria-pressed", "true");
      await page.waitForTimeout(700);
      const shot = await canvas.screenshot();
      expect(shot.equals(last), `stop ${k} moved the camera`).toBe(false);
      last = shot;
    }
    // A label pressed in the tour scrolls the page to its stop (waiting for the smooth scroll to land, not reading once).
    await scrollToY(page, atStop(b, 1));
    await expect(kicker).toHaveText(new RegExp(`^Stop 1 of ${b.stops}`));
    await page.locator('[data-tag][data-id="ingest"]').click();
    await expect(kicker).toHaveText(new RegExp(`^Stop ${stopOf(b, "ingest")} of ${b.stops}`), { timeout: 10_000 });
  });

  test("labels: none overlap at the start of the tour (1440×900, 1366×768, 390×844), and only the stop's neighbourhood is labelled", async ({
    page,
  }) => {
    for (const [w, h] of [
      [1440, 900],
      [1366, 768],
      [390, 844],
    ] as const) {
      const b = await live(page, w, h);
      await page.waitForTimeout(800);
      const home = await labelBoxes(page);
      expect(home.overlaps, `${w}×${h} home`).toEqual([]);
      expect(home.ids.length, `${w}×${h} home`).toBeGreaterThanOrEqual(8);
      for (const k of [1, stopOf(b, "verify")]) {
        await scrollToY(page, atStop(b, k));
        await page.waitForTimeout(1200);
        const at = await labelBoxes(page);
        expect(at.overlaps, `${w}×${h} stop ${k}`).toEqual([]);
        // The stop's pieces and their neighbours on the line, not the whole machine.
        expect(at.ids.length, `${w}×${h} stop ${k}`).toBeLessThanOrEqual(5);
      }
    }
  });

  test("explore: the hover hint, a click enters, a station click opens its panel, the wheel zooms (not the page), Esc returns to the stop", async ({
    page,
  }) => {
    const b = await live(page, 1440, 900);
    const root = page.locator("[data-machine]");
    const canvas = page.locator(".aa-engine-view canvas");
    const kicker = page.locator("[data-card-kicker]");
    const title = page.locator("[data-card-title]");
    const hint = page.locator(".aa-engine-hint");
    const k = stopOf(b, "analysis");
    await scrollToY(page, atStop(b, k));
    await expect(kicker).toHaveText(new RegExp(`^Stop ${k} of `));
    await page.waitForTimeout(1000);
    // In the tour the wheel scrolls the page, and the hint shows over the canvas only on hover.
    await expect.poll(() => hint.evaluate((e) => getComputedStyle(e).opacity)).toBe("0");
    await page.mouse.move(300, 450);
    await expect.poll(() => hint.evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
    await expect(hint).toHaveText("Click to explore");
    const y0 = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 120);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(y0);
    await scrollToY(page, atStop(b, k));
    await expect(kicker).toHaveText(new RegExp(`^Stop ${k} of `));
    await page.waitForTimeout(1000);

    // A click on a station (just under its label) enters explore with that station's panel open.
    const want = (await page.locator('.aa-stations li[data-station="analysis"] .aa-station-title').textContent()) ?? "?";
    const box = await page.locator('[data-tag][data-id="analysis"]').boundingBox();
    if (!box) throw new Error("no label");
    for (let dy = 20; dy <= 200; dy += 15) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height + dy);
      if ((await title.textContent()) === want) break;
    }
    await expect(root).toHaveAttribute("data-view", "explore");
    await expect(title).toHaveText(want);
    await expect(page.locator("[data-back]")).toBeVisible();
    await expect(page.locator("[data-announce]")).toContainText("Explore mode");
    await expect.poll(() => hint.evaluate((e) => getComputedStyle(e).opacity)).toBe("0");
    expect(await canvas.evaluate((c) => (c as HTMLElement).style.touchAction)).toBe("none");
    // The wheel zooms the machine and the page stays where it is.
    const y1 = await page.evaluate(() => scrollY);
    const before = await canvas.screenshot();
    await page.mouse.move(500, 500);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => scrollY)).toBe(y1);
    expect((await canvas.screenshot()).equals(before)).toBe(false);
    // A drag turns it, and the page still doesn't move.
    await page.mouse.move(500, 500);
    await page.mouse.down();
    await page.mouse.move(650, 520, { steps: 8 });
    await page.mouse.up();
    expect(await page.evaluate(() => scrollY)).toBe(y1);
    // axe is clean in explore too.
    const axe = await new AxeBuilder({ page }).include(".aa-engine").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);

    // Esc returns to the tour at the stop the scroll is on.
    await page.keyboard.press("Escape");
    await expect(root).toHaveAttribute("data-view", "tour");
    await expect(kicker).toHaveText(new RegExp(`^Stop ${k} of `));
    await expect(page.locator("[data-back]")).toBeHidden();
    await expect(page.locator("[data-announce]")).toContainText(`stop ${k} of`);
    expect(await canvas.evaluate((c) => (c as HTMLElement).style.touchAction)).toBe("pan-y");
  });

  test("explore: Back to tour and a click outside the canvas return to the tour stop of the scroll", async ({ page }) => {
    const b = await live(page, 1440, 900);
    const root = page.locator("[data-machine]");
    const kicker = page.locator("[data-card-kicker]");
    const k = stopOf(b, "verify");
    await scrollToY(page, atStop(b, k));
    await expect(kicker).toHaveText(new RegExp(`^Stop ${k} of `));
    // Back to tour (the button, from the keyboard too).
    await page.mouse.click(250, 820);
    await expect(root).toHaveAttribute("data-view", "explore");
    await expect(page.locator("[data-card-title]")).toHaveText(/./);
    await page.locator("[data-back]").focus();
    await page.keyboard.press("Enter");
    await expect(root).toHaveAttribute("data-view", "tour");
    await expect(kicker).toHaveText(new RegExp(`^Stop ${k} of `));
    // Focus goes back to the Explore button (hidden from sight on a desktop until it has the keyboard's focus), which
    // enters too.
    await expect(page.locator("[data-explore]")).toBeFocused();
    await expect(page.locator("[data-explore]")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(root).toHaveAttribute("data-view", "explore");
    await expect(page.locator("[data-back]")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(root).toHaveAttribute("data-view", "tour");

    // A click outside: with the band's start a third of the way down the screen, outside the canvas is the page above it.
    await scrollToY(page, b.top - 300);
    await page.waitForTimeout(500);
    await page.mouse.click(400, 700);
    await expect(root).toHaveAttribute("data-view", "explore");
    const outside = await page.evaluate(() => {
      for (let y = 20; y < 280; y += 20) {
        const el = document.elementFromPoint(20, y);
        if (el && !el.closest("a, button, [data-machine]")) return y;
      }
      return -1;
    });
    expect(outside).toBeGreaterThan(0);
    await page.mouse.click(20, outside);
    await expect(root).toHaveAttribute("data-view", "tour");
    await expect(kicker).toHaveText("How to read the machine");
  });

  test("phones: an Explore button (no hover hint), touch scrolls the page in the tour, Back to tour returns", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const b = await live(page, 390, 844);
    const root = page.locator("[data-machine]");
    const canvas = page.locator(".aa-engine-view canvas");
    const explore = page.locator("[data-explore]");
    await expect(explore).toBeVisible();
    await expect(explore).toHaveText("Explore");
    expect(await page.locator(".aa-engine-hint").evaluate((e) => getComputedStyle(e).opacity)).toBe("0");
    // The stage is the whole screen; in the tour a touch on the canvas scrolls the page.
    const r = await page.locator("[data-engine-stage]").evaluate((e) => e.getBoundingClientRect().toJSON() as DOMRect);
    expect([Math.round(r.top), Math.round(r.height)]).toEqual([0, 844]);
    expect(await canvas.evaluate((c) => (c as HTMLElement).style.touchAction)).toBe("pan-y");
    const cdp = await ctx.newCDPSession(page);
    /** A one-finger swipe up, as raw touch events (the browser decides what it scrolls). */
    const swipe = async (x: number, y: number) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - i * 25 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    for (const y of [400, 720]) {
      // On the canvas and on the card alike.
      await scrollToY(page, atStop(b, 1));
      await page.waitForTimeout(300);
      const y0 = await page.evaluate(() => scrollY);
      await swipe(195, y);
      await expect.poll(() => page.evaluate(() => scrollY), { message: `swipe at ${y}` }).toBeGreaterThan(y0 + 100);
    }
    await scrollToY(page, atStop(b, 2));
    await page.waitForTimeout(800);
    // Explore: the canvas takes the touch (rotate, pinch, two-finger pan), and Back to tour returns to the stop.
    await explore.tap();
    await expect(root).toHaveAttribute("data-view", "explore");
    await expect(page.locator("[data-back]")).toBeVisible();
    expect(await canvas.evaluate((c) => (c as HTMLElement).style.touchAction)).toBe("none");
    const y1 = await page.evaluate(() => scrollY);
    await swipe(195, 400);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => scrollY)).toBe(y1);
    // Chrome spends the first tap after a fast synthetic swipe on stopping its fling (no click), so the tap is retried
    // until it lands, rather than read once.
    await expect(async () => {
      await page.locator("[data-back]").tap({ timeout: 1000 });
      await expect(root).toHaveAttribute("data-view", "tour", { timeout: 700 });
    }).toPass({ timeout: 10_000 });
    await expect(page.locator("[data-card-kicker]")).toHaveText(/^Stop 2 of /);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
    await ctx.close();
  });

  test("the canvas draws the tokens: the page unshifted by colour management, green only on the verifier's gate", async ({ page }) => {
    await page.addInitScript(device, [8, 8]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(LANDING);
    const b = await band(page);
    await scrollToY(page, atStop(b, 0));
    await expect(page.locator("[data-machine]")).toHaveAttribute("data-gl", "on", { timeout: 20_000 });
    await page.waitForTimeout(600);
    const canvas = page.locator(".aa-engine-view canvas");
    const home = await canvas.screenshot({ animations: "disabled" });
    expect(await share(page, home, "--aa-page")).toBeGreaterThan(0.2);
    // At the verifier's stop its passed checks' lights are the verified token; at the doors there is no green at all.
    await scrollToY(page, atStop(b, stopOf(b, "verify")));
    await page.waitForTimeout(1500);
    expect(await share(page, await canvas.screenshot(), "--aa-verified")).toBeGreaterThan(0);
    await scrollToY(page, atStop(b, stopOf(b, "doors")));
    await page.waitForTimeout(1500);
    expect(await share(page, await canvas.screenshot(), "--aa-verified")).toBe(0);
  });

  test("reduced motion: the still frame with the station list, a short band, and three never loads", async ({ page }) => {
    await page.addInitScript(device, [8, 8]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(LANDING, { waitUntil: "networkidle" });
    await expect(page.locator("[data-machine]")).toHaveAttribute("data-mode", "still");
    expect((await band(page)).tall).toBe(false);
    await expect(page.locator(".aa-engine-list")).toHaveAttribute("open", "");
    await page.locator(".aa-engine-still img").scrollIntoViewIfNeeded();
    await expect(page.locator(".aa-engine-still img")).toBeVisible();
    await expect(page.locator("ol.aa-stations > li[data-station]")).toHaveCount(11);
    await expect(page.locator("[data-tag]").first()).toBeHidden();
    // No modes without the live view: no Explore button, no hint.
    await expect(page.locator("[data-explore]")).toBeHidden();
    await page.waitForTimeout(2500);
    expect(requests.filter((u) => CHUNK.test(u))).toEqual([]);
  });

  test("a weak device gets the still frame and the list, and three never loads", async ({ page }) => {
    await page.addInitScript(device, [2, 8]);
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(LANDING, { waitUntil: "networkidle" });
    await expect(page.locator("[data-machine]")).toHaveAttribute("data-mode", "still");
    await expect(page.locator(".aa-engine-list")).toHaveAttribute("open", "");
    await page.waitForTimeout(2500);
    expect(requests.filter((u) => CHUNK.test(u))).toEqual([]);
  });

  test("phones: the tall still, the lighter scene only once the band is near, tap to select, nothing scrolls sideways at 360", async ({
    page,
  }) => {
    await page.addInitScript(device, [8, 8]);
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    for (const width of [390, 360]) {
      requests.length = 0;
      await page.setViewportSize({ width, height: 800 });
      await page.goto(LANDING, { waitUntil: "networkidle" });
      await page.waitForTimeout(2500);
      // Not near yet (the band is under the stacked hero): nothing fetched.
      expect(
        requests.filter((u) => CHUNK.test(u)),
        `${width}`,
      ).toEqual([]);
      const b = await band(page);
      await scrollToY(page, atStop(b, 0));
      await expect(page.locator("[data-machine]")).toHaveAttribute("data-gl", "on", { timeout: 20_000 });
      expect(requests.some((u) => /machine-tall\.webp/.test(u))).toBe(true);
      expect(requests.some((u) => /machine-wide/.test(u))).toBe(false);
      // At the stop that shows Analysis its label is pressed; a tap in the tour (a phone has no click-to-explore) picks
      // the piece under it.
      await scrollToY(page, atStop(b, stopOf(b, "analysis")));
      await page.waitForTimeout(1200);
      await expect(page.locator('[data-tag][data-id="analysis"]')).toHaveAttribute("aria-pressed", "true");
      // A tap on another station (under its label, which sits above it) selects that one: its label and its card.
      const box = await page.locator('[data-tag][data-id="index"]').boundingBox();
      if (!box) throw new Error("no label");
      for (let dy = 20; dy <= 160; dy += 15) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height + dy);
        if ((await page.locator('[data-tag][data-id="index"]').getAttribute("aria-pressed")) === "true") break;
      }
      await expect(page.locator('[data-tag][data-id="index"]')).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("[data-card-title]")).toHaveText(
        (await page.locator('.aa-stations li[data-station="index"] .aa-station-title').textContent()) ?? "?",
      );
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${width}`).toBeLessThanOrEqual(0);
    }
  });

  test("without JS: the still frame and every station in the list, each linking its Learn page", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(LANDING);
    await expect(page.locator("[data-machine]")).not.toHaveAttribute("data-mode", /./);
    await expect(page.locator(".aa-engine-list")).toHaveAttribute("open", "");
    await page.locator(".aa-engine-still img").scrollIntoViewIfNeeded();
    await expect(page.locator(".aa-engine-still img")).toBeVisible();
    await expect(page.locator("[data-tag]").first()).toBeHidden();
    const stations = page.locator(".aa-stations li[data-station]");
    await expect(stations).toHaveCount(13);
    for (const li of await stations.all()) await expect(li.locator('a[href*="/learn/stages/"]').first()).toBeVisible();
    await ctx.close();
  });
});

// Site v4 PR 3: motion across the landing page (DESIGN.md §2.5, §7). Sections reveal once, below the fold only; the
// pipeline's connector draws in; the exhibit's figures count up to their recorded value; hovers ease; nothing of it
// under reduced motion or without JS, no layout shift, no sideways scroll.
test.describe("motion", () => {
  const PARTS = "[data-reveal] > .aa-cell > *";
  /** Each revealable part: whether it starts below the screen, whether it is held for its reveal, its opacity. */
  const parts = (page: import("@playwright/test").Page) =>
    page.locator(PARTS).evaluateAll((els) =>
      els.map((el) => ({
        below: el.getBoundingClientRect().top >= window.innerHeight,
        held: el.classList.contains("aa-rv"),
        opacity: getComputedStyle(el).opacity,
      })),
    );
  /** Counts every time a part is put back on hold after the page has loaded (a reveal must happen once). */
  const watchHolds = (page: import("@playwright/test").Page) =>
    page.evaluate(() => {
      const w = window as unknown as { aaHolds: number };
      w.aaHolds = 0;
      new MutationObserver((ms) => {
        for (const m of ms)
          if (m.attributeName === "class" && (m.target as Element).classList.contains("aa-rv") && !m.oldValue?.includes("aa-rv"))
            w.aaHolds++;
      }).observe(document.body, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["class"] });
    });

  test("sections reveal once, only below the fold, and land in their final state", async ({ browser }) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      await page.goto(LANDING, { waitUntil: "networkidle" });
      const start = await parts(page);
      expect(start.length, `${viewport.width}`).toBeGreaterThanOrEqual(8);
      // Held exactly when below the screen at load: what the reader sees on load is final and never animates.
      for (const p of start) expect(p.held, `${viewport.width}`).toBe(p.below);
      expect(start.filter((p) => p.held).every((p) => p.opacity === "0")).toBe(true);
      // The hero and the engine machine's band are never held.
      await expect(page.locator(".aa-hero .aa-rv, .aa-engine-band .aa-rv")).toHaveCount(0);
      await watchHolds(page);
      // Scrolled into view, a part fades and rises into place, then stays.
      const head = page.locator("#why .aa-cell-head");
      await head.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await expect(head).not.toHaveClass(/\baa-rv\b/);
      await expect.poll(() => head.evaluate((el) => getComputedStyle(el).opacity), { timeout: 2_000 }).toBe("1");
      await expect.poll(() => head.evaluate((el) => getComputedStyle(el).transform), { timeout: 2_000 }).toBe("none");
      // Scrolling down to the end and back: every part is shown, and nothing is held again.
      for (let y = 0; y <= (await page.evaluate(() => document.documentElement.scrollHeight)); y += 500) {
        await page.evaluate((v) => window.scrollTo(0, v), y);
        await page.waitForTimeout(40);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(over, `no sideways scroll mid-reveal at ${viewport.width}`).toBeLessThanOrEqual(0);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(400);
      expect((await parts(page)).filter((p) => p.held)).toEqual([]);
      expect(await page.evaluate(() => (window as unknown as { aaHolds: number }).aaHolds)).toBe(0);
      await ctx.close();
    }
  });

  test("no sideways scroll at 360 while sections reveal; a jump lands on final content", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(LANDING, { waitUntil: "networkidle" });
    for (let y = 0; y <= (await page.evaluate(() => document.documentElement.scrollHeight)); y += 300) {
      await page.evaluate((v) => window.scrollTo(0, v), y);
      await page.waitForTimeout(30);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `at ${y}`).toBeLessThanOrEqual(0);
    }
    // Loaded at an anchor, that section is on screen at load: final, never held.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${LANDING}#results`, { waitUntil: "networkidle" });
    await expect(page.locator("#results .aa-rv")).toHaveCount(0);
    // An in-page link shows every held part at once, with no fade where it lands.
    await page.goto(LANDING, { waitUntil: "networkidle" });
    expect((await parts(page)).some((p) => p.held)).toBe(true);
    await page.locator('#aa-site-menu a[href$="#results"]').first().click();
    await expect(page.locator(".aa-rv, .aa-rv-go")).toHaveCount(0);
  });

  test("reduced motion and no JS: nothing is held, nothing counts, the connector is drawn", async ({ browser }) => {
    for (const opts of [
      { reducedMotion: "reduce" as const, viewport: { width: 1440, height: 900 } },
      { reducedMotion: "reduce" as const, viewport: { width: 390, height: 844 } },
      { javaScriptEnabled: false, viewport: { width: 1440, height: 900 } },
    ]) {
      const ctx = await browser.newContext(opts);
      const page = await ctx.newPage();
      await page.goto(LANDING, { waitUntil: "networkidle" });
      const all = await parts(page);
      expect(all.filter((p) => p.held || p.opacity !== "1")).toEqual([]);
      await expect(page.locator("[data-exhibit]")).not.toHaveAttribute("data-anim", "pending");
      await expect(page.locator(".aa-exhibit .aa-fig[data-count]")).toHaveCount(0);
      const colours = await page.locator(".aa-exhibit .aa-fig").evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
      expect(new Set(colours)).toEqual(new Set(["rgb(18, 20, 23)"]));
      await expect(page.locator(".aa-stages.is-undrawn, .aa-stages.is-drawing")).toHaveCount(0);
      for (let y = 0; y <= (await page.evaluate(() => document.documentElement.scrollHeight)); y += 900)
        await page.evaluate((v) => window.scrollTo(0, v), y);
      await page.waitForTimeout(300);
      expect((await parts(page)).filter((p) => p.held || p.opacity !== "1")).toEqual([]);
      await ctx.close();
    }
  });

  test("the pipeline's connector draws in as the rail comes into view; Play and the stops still step it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(LANDING, { waitUntil: "networkidle" });
    const root = page.locator("#how .aa-stages");
    /** Each stop's segment, as its horizontal scale (0 undrawn, 1 drawn). */
    const scales = () =>
      root.locator(".aa-stages-rail li").evaluateAll((lis) =>
        lis.map((li) => {
          const t = getComputedStyle(li, "::after").transform;
          return t === "none" ? 1 : Number(t.match(/matrix\(([^,]+)/)?.[1] ?? Number.NaN);
        }),
      );
    await expect(root).toHaveClass(/\bis-undrawn\b/);
    // Undrawing eases each segment to 0 over 180ms (the rail's own transition), so wait for it to land rather than
    // read it once: read straight after load it caught 0.0103 on a busy machine.
    await expect.poll(scales, { timeout: 2_000 }).toEqual([0, 0, 0, 0, 0, 0, 0]);
    await root.locator(".aa-stages-rail").evaluate((el) => el.scrollIntoView({ block: "center" }));
    // Mid-draw: the first stops are drawn while the last are not yet; it runs left to right.
    const mid = await page.waitForFunction(
      () => {
        const lis = [...document.querySelectorAll("#how .aa-stages-rail li")];
        const s = lis.map((li) => Number(getComputedStyle(li, "::after").transform.match(/matrix\(([^,]+)/)?.[1] ?? 1));
        return (s[0] ?? 0) > 0.99 && (s[6] ?? 1) < 0.5 ? s : null;
      },
      undefined,
      { polling: "raf", timeout: 3_000 },
    );
    const at = (await mid.jsonValue()) as number[];
    for (let i = 1; i < at.length; i++) expect(at[i] ?? 0).toBeLessThanOrEqual((at[i - 1] ?? 0) + 1e-6);
    await expect.poll(scales, { timeout: 3_000 }).toEqual([1, 1, 1, 1, 1, 1, 1]);
    await expect(root).not.toHaveClass(/\bis-(undrawn|drawing)\b/);
    // A stop still opens its panel, and the connector follows it.
    await root.getByRole("button", { name: "Files", exact: true }).click();
    await expect.poll(scales, { timeout: 2_000 }).toEqual([1, 0, 0, 0, 0, 0, 0]);
    await root.getByRole("button", { name: "SQL", exact: true }).click();
    await expect.poll(scales, { timeout: 2_000 }).toEqual([1, 1, 1, 1, 0, 0, 0]);
    // Docs pages don't draw in: the rail is drawn from the start.
    await page.goto(`${BASE}/learn/`, { waitUntil: "networkidle" });
    await expect(page.locator(".aa-stages.is-undrawn")).toHaveCount(0);
    // Loaded with the rail on screen: drawn from the start.
    await page.goto(`${LANDING}#how`, { waitUntil: "networkidle" });
    await expect(page.locator(".aa-stages.is-undrawn")).toHaveCount(0);
  });

  test("the exhibit's figures count up to their recorded value, then verify; the HTML holds the real value", async ({ page, request }) => {
    const exhibit = JSON.parse(readFileSync(join(import.meta.dirname, "../../../apps/docs/src/data/exhibit.json"), "utf8")) as {
      lines: { fact?: string }[][];
      notes: Record<string, { value: string }>;
    };
    const values = exhibit.lines.flat().flatMap((p) => (p.fact ? [exhibit.notes[p.fact]?.value ?? ""] : []));
    expect(values.length).toBeGreaterThan(5);
    // The static HTML already holds every recorded value.
    const html = await (await request.get(LANDING)).text();
    for (const v of values) expect(html, v).toContain(v);
    const num = (s: string) => Number(s.replace(/[^\d.]/g, "")) || 0;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(LANDING);
    // Mid-count: a running value drawn over the figure, never past the recorded one, the real text underneath unchanged.
    const mid = await page.waitForFunction(
      () => {
        const f = [...document.querySelectorAll<HTMLElement>(".aa-exhibit .aa-fig[data-count]")].find(
          (e) => e.dataset.count !== e.textContent && Number((e.dataset.count ?? "").replace(/[^\d.]/g, "")) > 0,
        );
        return f ? { count: f.dataset.count ?? "", text: f.textContent ?? "", colour: getComputedStyle(f).color } : null;
      },
      undefined,
      { polling: "raf", timeout: 3_000 },
    );
    const m = (await mid.jsonValue()) as { count: string; text: string; colour: string };
    expect(values).toContain(m.text);
    expect(num(m.count)).toBeLessThan(num(m.text));
    expect(m.colour).toBe("rgba(0, 0, 0, 0)");
    // Then the checks; at the end every figure is its recorded value, in ink, with nothing drawn over it.
    await expect(page.locator("[data-exhibit]")).toHaveAttribute("data-anim", "done", { timeout: 3_500 });
    await expect(page.locator(".aa-exhibit .aa-fig[data-count]")).toHaveCount(0);
    const end = await page
      .locator(".aa-exhibit .aa-exhibit-line .aa-fig")
      .evaluateAll((els) => els.map((e) => ({ text: e.textContent, colour: getComputedStyle(e).color })));
    expect(end.map((e) => e.text)).toEqual(values);
    expect(new Set(end.map((e) => e.colour))).toEqual(new Set(["rgb(18, 20, 23)"]));
  });

  test("hover states ease in 150 ms on links, chips, buttons and rows", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(LANDING, { waitUntil: "networkidle" });
    for (const sel of [".aa-more", ".aa-exhibit a.aa-chip", ".aa-button-primary", "#results tbody th[scope='row']", ".aa-doors li"]) {
      const durations = await page
        .locator(sel)
        .first()
        .evaluate((el) =>
          getComputedStyle(el)
            .transitionDuration.split(",")
            .map((d) => Number.parseFloat(d) * (d.includes("ms") ? 1 : 1000)),
        );
      for (const d of durations) {
        expect(d, sel).toBeGreaterThanOrEqual(150);
        expect(d, sel).toBeLessThanOrEqual(200);
      }
    }
  });

  // The hero field (site v5 PR 1): the drifting net behind the statement, on a canvas.
  const NET = ".aa-hero-field .aa-hf-net";
  const frames = (page: import("@playwright/test").Page) =>
    page.locator(NET).evaluate((c) => (c as HTMLCanvasElement & { aaFrames?: number }).aaFrames ?? 0);

  test("hero field: the net drifts while the hero is on screen, and pauses off-screen and in a hidden tab; it has no pause control", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(LANDING, { waitUntil: "networkidle" });
    const net = page.locator(NET);
    await expect(net).toHaveAttribute("data-state", "running", { timeout: 5_000 });
    const a = await frames(page);
    await page.waitForTimeout(600);
    expect(await frames(page), "draws while on screen").toBeGreaterThan(a + 5);
    // Site v5 PR 1b: the connectors draw themselves in, pulses run along them, and it never draws past 30 fps.
    type Debug = HTMLCanvasElement & { aaFrames?: number; aaLinks?: number; aaDrawn?: number; aaPulses?: number };
    const stats = () =>
      net.evaluate((c: Debug) => ({ frames: c.aaFrames ?? 0, links: c.aaLinks ?? 0, drawn: c.aaDrawn ?? 0, pulses: c.aaPulses ?? 0 }));
    const t0 = await stats();
    const started = Date.now();
    let pulsed = 0;
    for (let k = 0; k < 10; k++) {
      await page.waitForTimeout(200);
      pulsed = Math.max(pulsed, (await stats()).pulses);
    }
    const t1 = await stats();
    const fps = ((t1.frames - t0.frames) * 1000) / (Date.now() - started);
    expect(fps, "frames a second").toBeLessThanOrEqual(31);
    expect(t1.links, "connectors").toBeGreaterThanOrEqual(12);
    expect(t1.drawn, "connectors drawn in").toBeGreaterThanOrEqual(12);
    expect(pulsed, "pulses along the connectors").toBeGreaterThanOrEqual(1);
    // The backing store is DPR-aware and capped, and the canvas is sized by CSS (it never sizes the layout).
    const size = await net.evaluate((c: HTMLCanvasElement) => ({
      w: c.width,
      h: c.height,
      cw: c.clientWidth,
      ch: c.clientHeight,
      position: getComputedStyle(c).position,
    }));
    expect(size.position).toBe("absolute");
    expect(size.w * size.h).toBeLessThanOrEqual(1_600_000 + size.w + size.h);
    expect(Math.abs(size.w - size.cw)).toBeLessThanOrEqual(1);
    // Scrolled off-screen: paused, and no frame is drawn.
    await page.locator("#how").evaluate((el) => el.scrollIntoView());
    await expect(net).toHaveAttribute("data-state", "paused");
    const b = await frames(page);
    await page.waitForTimeout(600);
    expect(await frames(page), "no frames off-screen").toBe(b);
    // Back on screen it runs again.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(net).toHaveAttribute("data-state", "running");
    // A hidden tab pauses it.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(net).toHaveAttribute("data-state", "paused");
    const c = await frames(page);
    await page.waitForTimeout(400);
    expect(await frames(page), "no frames in a hidden tab").toBe(c);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(net).toHaveAttribute("data-state", "running");
    // No pause control (site v5 PR 2): the maintainer accepts the WCAG 2.2.2 trade-off; reduced motion turns it off.
    await expect(page.locator("[data-hf-toggle]")).toHaveCount(0);
  });

  test("hero field: under reduced motion and without JS the net is absent; the static grid, glow and grain remain", async ({ browser }) => {
    for (const opts of [{ reducedMotion: "reduce" as const }, { javaScriptEnabled: false }]) {
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
      ]) {
        const ctx = await browser.newContext({ ...opts, viewport });
        const page = await ctx.newPage();
        await page.goto(LANDING, { waitUntil: "networkidle" });
        await page.waitForTimeout(2_500); // past the idle start
        const net = page.locator(NET);
        await expect(net).toHaveAttribute("data-state", "off");
        expect(await frames(page)).toBe(0);
        if (opts.reducedMotion) expect(await net.evaluate((c) => getComputedStyle(c).display)).toBe("none");
        for (const layer of [".aa-hf-grid", ".aa-hf-glow", ".aa-hf-grain"])
          expect(await page.locator(layer).evaluate((el) => getComputedStyle(el).backgroundImage), layer).not.toBe("none");
        await ctx.close();
      }
    }
  });

  test("hero field: no layout shift as it starts and fades in (1440, 390)", async ({ browser }) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      page.on("console", (m) => {
        if (m.text().startsWith("hero shift") || m.text().startsWith("page shift")) console.log(`${viewport.width}: ${m.text()}`);
      });
      await page.addInitScript(() => {
        const w = window as unknown as { aaHeroShift: number; aaShiftTotal: number };
        w.aaHeroShift = 0;
        w.aaShiftTotal = 0;
        type Entry = PerformanceEntry & { value: number; hadRecentInput: boolean; sources: { node?: Node | null }[] };
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as Entry[]) {
            if (e.hadRecentInput) continue;
            w.aaShiftTotal += e.value;
            // Every shift is printed with what it moved, so a CI-only failure (other fallback fonts) names its cause.
            console.log(
              `page shift ${e.value.toFixed(6)} at ${Math.round(e.startTime)} ms: ${e.sources
                .map((s) => (s.node instanceof Element ? s.node : s.node?.parentElement)?.getAttribute("class") ?? "?")
                .join("; ")}`,
            );
            const inHero = e.sources.some((s) => {
              const el = s.node instanceof Element ? s.node : (s.node?.parentElement ?? null);
              // The field, its control and the corner marks: what this adds to the hero. (The font swap may still nudge
              // a word of the statement by a pixel early on; that is the page's font budget, counted in the total.)
              return Boolean(el?.closest(".aa-hero-field, .aa-hero-corners"));
            });
            if (inHero) {
              w.aaHeroShift += e.value;
              console.log(
                `hero shift ${e.value.toFixed(6)} at ${Math.round(e.startTime)} ms: ${e.sources
                  .map((s) => (s.node instanceof Element ? s.node : s.node?.parentElement)?.className ?? "?")
                  .join("; ")}`,
              );
            }
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      await page.goto(LANDING, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const before = await page.locator(".aa-statement").boundingBox();
      await expect(page.locator(NET)).toHaveAttribute("data-state", "running", { timeout: 5_000 });
      await page.waitForTimeout(800); // the fade-in
      expect(await page.locator(".aa-statement").boundingBox(), `${viewport.width}: the statement keeps its box`).toEqual(before);
      const { aaHeroShift, aaShiftTotal } = await page.evaluate(() => {
        const w = window as unknown as { aaHeroShift: number; aaShiftTotal: number };
        return { aaHeroShift: w.aaHeroShift, aaShiftTotal: w.aaShiftTotal };
      });
      expect(aaHeroShift, `${viewport.width}: shifts in the hero field or the corner marks`).toBe(0);
      expect(aaShiftTotal, `${viewport.width}: CLS on load`).toBeLessThan(0.05);
      await ctx.close();
    }
  });

  test("no layout shift from any of it: CLS under 0.05 through the whole landing page (1440, 390)", async ({ browser }) => {
    type Shift = { value: number; time: number; mine: boolean; sticky: boolean; pinned: boolean; sources: string[] };
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      // Every unexpected shift, and whether any node it moved sits in what this motion touches: the revealed parts, the
      // pipeline stages or the exhibit.
      await page.addInitScript(() => {
        const w = window as unknown as { aaShifts: Shift[] };
        w.aaShifts = [];
        type Rect = { x: number; y: number; width: number; height: number };
        type Entry = PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
          sources: { node?: Node | null; previousRect: Rect; currentRect: Rect }[];
        };
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as Entry[]) {
            if (e.hadRecentInput) continue;
            const els = e.sources.map((s) => (s.node instanceof Element ? s.node : (s.node?.parentElement ?? null)));
            w.aaShifts.push({
              value: e.value,
              time: e.startTime,
              mine: els.some((el) => Boolean(el?.closest("[data-reveal], .aa-stages, .aa-exhibit"))),
              // The pinned hero (site v5 PR 2): the whole hero row is sticky over the hero's scroll track
              // and move with the scroll by design as the pin releases; position, not animation, told apart the same way.
              pinned:
                els.length > 0 &&
                els.every((el) => {
                  const host = el?.closest(".aa-hero-row");
                  return Boolean(host) && getComputedStyle(host as Element).position === "sticky";
                }),
              // A sticky row head (§1, §2 from 1100px) moves with the scroll by design once it reaches the end of
              // its row; that is position, not animation, so those shifts are told apart by identity. Those heads are
              // also reveal parts, so their reveal goes unchecked here at 1440; it is still checked at 390 (nothing is
              // sticky there) and on the heads that aren't sticky (#results, #quickstart).
              sticky:
                els.length > 0 &&
                els.every(
                  (el) =>
                    Boolean(el?.closest(".aa-cell-head")) &&
                    getComputedStyle(el?.closest(".aa-cell-head") as Element).position === "sticky",
                ),
              sources: e.sources.map((s, i) => {
                const el = els[i];
                const r = (q: Rect) => `${Math.round(q.x)},${Math.round(q.y)} ${Math.round(q.width)}×${Math.round(q.height)}`;
                return `${el ? `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}` : "?"} ${r(s.previousRect)} → ${r(s.currentRect)}`;
              }),
            });
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      await page.goto(LANDING, { waitUntil: "networkidle" });
      await page.waitForTimeout(3_000); // the replay
      for (let y = 0; y <= (await page.evaluate(() => document.documentElement.scrollHeight)); y += 400) {
        await page.evaluate((v) => window.scrollTo(0, v), y);
        await page.waitForTimeout(120);
      }
      await page.waitForTimeout(800);
      const shifts = await page.evaluate(() => (window as unknown as { aaShifts: Shift[] }).aaShifts);
      // CLS as browsers report it: the largest session window (shifts under 1 s apart, at most 5 s long).
      let cls = 0;
      let win = 0;
      let first = 0;
      let last = Number.NEGATIVE_INFINITY;
      for (const s of shifts) {
        if (s.time - last > 1000 || s.time - first > 5000) {
          win = 0;
          first = s.time;
        }
        win += s.value;
        last = s.time;
        cls = Math.max(cls, win);
      }
      const total = shifts.reduce((t, s) => t + s.value, 0);
      console.log(`CLS through the landing page at ${viewport.width}: ${cls.toFixed(4)} (all shifts summed ${total.toFixed(4)})`);
      // Every shift in an animated part is printed with its sources, and every shift at all when CLS is over budget, so
      // a failure names the node that moved.
      for (const s of shifts.filter((x) => x.mine || cls >= 0.05))
        console.log(`shift ${s.value.toFixed(6)} at ${Math.round(s.time)} ms: ${s.sources.join("; ")}`);
      expect(
        shifts.filter((s) => s.mine && !s.sticky && !s.pinned),
        `${viewport.width}: shifts in the revealed parts, the stages or the exhibit (sticky heads excepted)`,
      ).toEqual([]);
      expect(cls, `${viewport.width}`).toBeLessThan(0.05);
      await ctx.close();
    }
  });
});

test("a sticky row head is alone in its grid column, so it never slides over a neighbour (1100, 1440)", async ({ page }) => {
  for (const width of [1100, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(LANDING, { waitUntil: "networkidle" });
    const clashes = await page.locator(".aa-split > .aa-cell-head").evaluateAll((heads) =>
      heads.flatMap((head) => {
        if (getComputedStyle(head).position !== "sticky") return [];
        const h = head.getBoundingClientRect();
        // Any sibling whose box shares the head's columns: the sticky head would move over it.
        return [...(head.parentElement?.children ?? [])]
          .filter((el) => el !== head)
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.left < h.right - 1 && r.right > h.left + 1;
          })
          .map((el) => `${head.closest("section")?.id}: ${el.className}`);
      }),
    );
    expect(clashes, `width ${width}`).toEqual([]);
    // §1 and §2 keep their sticky heads; §4's isn't sticky.
    expect(
      await page
        .locator("#how .aa-cell-head")
        .first()
        .evaluate((el) => getComputedStyle(el).position),
    ).toBe("sticky");
    expect(
      await page
        .locator("#why .aa-cell-head")
        .first()
        .evaluate((el) => getComputedStyle(el).position),
    ).toBe("sticky");
    expect(
      await page
        .locator("#quickstart .aa-cell-head")
        .first()
        .evaluate((el) => getComputedStyle(el).position),
    ).not.toBe("sticky");
  }
});
