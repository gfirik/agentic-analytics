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

test("no horizontal scroll from 1000 to 1100 px: the docs' narrowest margin column, the landing page's frame", async ({ page }) => {
  for (const width of [1000, 1024, 1072, 1100]) {
    await page.setViewportSize({ width, height: 800 });
    // The Learn page (the margin column's narrowest) and the landing page (its frame meets the screen edge up to 1180).
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
  const chips = page.locator(".aa-exhibit a.aa-chip");
  const n = await chips.count();
  expect(n).toBeGreaterThan(5);
  expect(n).toBeLessThanOrEqual(10);
  await expect(wrap).toHaveAttribute("data-anim", "pending");
  await expect(wrap).toHaveAttribute("data-walk", "live");
  // Mid-replay, some figures are verified and some not yet.
  await expect(page.locator(".aa-exhibit a.aa-chip.is-verified")).not.toHaveCount(0);
  await expect(wrap).toHaveAttribute("data-anim", "done", { timeout: 3_500 });
  await expect(page.locator(".aa-exhibit a.aa-chip.is-verified")).toHaveCount(n);
});

test("hero: at 1440 the walkthrough advances on a timer, step 1's note open from the start; nothing is pinned to the scroll", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(LANDING);
  const wrap = page.locator("[data-exhibit]");
  const steps = JSON.parse((await wrap.getAttribute("data-steps")) ?? "[]") as string[];
  expect(steps.length).toBeGreaterThanOrEqual(3);
  expect(steps.length).toBeLessThanOrEqual(4);
  const cap = (k: number) => page.locator(`.aa-walk-cap[data-step="${k}"]`);
  const open = page.locator(".aa-note.is-open");
  // No sticky section and no scroll track: the exhibit section is as tall as its content.
  expect(await page.locator(".aa-walk-body").evaluate((el) => getComputedStyle(el).position)).not.toBe("sticky");
  await expect(page.locator(".aa-walk-track")).toHaveCount(0);
  // The margin is never empty: step 1's note is open before the first step, with no hint text.
  await expect(cap(0)).toBeVisible();
  await expect(open).toHaveCount(1);
  await expect(open).toHaveAttribute("id", `aa-note-${steps[0]}`);
  await expect(page.locator(".aa-notes-hint")).toHaveCount(0);
  await page.locator(".aa-exhibit-page").evaluate((el) => el.scrollIntoView({ block: "center" }));
  await expect(wrap).toHaveAttribute("data-anim", "done", { timeout: 4_000 });
  for (let k = 1; k <= steps.length; k++) {
    // Real time: a step every 4.5 s while the notes are on screen.
    await expect(cap(k)).toBeVisible({ timeout: 7_000 });
    await expect(cap(k)).toContainText(`${k}/${steps.length}`);
    await expect(open).toHaveCount(1);
    await expect(open).toHaveAttribute("id", `aa-note-${steps[k - 1]}`);
    await expect(page.locator(`.aa-exhibit a.aa-chip[data-note="${steps[k - 1]}"]`)).toHaveAttribute("aria-expanded", "true");
    if (k === 1) {
      // Pause stops it and Play resumes (WCAG 2.2.2); the pointer on a figure holds it, and leaving lets it run.
      const pause = page.locator("[data-walk-pause]");
      await pause.click();
      await expect(pause).toHaveText("Play");
      await page.waitForTimeout(5_000);
      await expect(cap(1)).toBeVisible();
      await pause.click();
      await expect(pause).toHaveText("Pause");
      await page.locator(`.aa-exhibit a.aa-chip[data-note="${steps[0]}"]`).hover();
      await page.waitForTimeout(5_000);
      await expect(cap(1)).toBeVisible();
      await page.mouse.move(5, 5);
    }
    if (k === 2) {
      // The change's SQL input: its SQL (open beside the exhibit) and the sheet rows it read.
      await expect(open.locator(".aa-note-sql")).toBeVisible();
      await expect(open.locator(".aa-note-sql")).toContainText("FROM");
      await expect(open.locator("tr.is-cited")).not.toHaveCount(0);
    }
  }
  // At the end it stops, and the button offers Play.
  await expect(page.locator("[data-walk-next]")).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator("[data-walk-pause]")).toHaveText("Play");
  await page.locator("[data-walk-prev]").click();
  await expect(cap(steps.length - 1)).toBeVisible();
  // Exploring mid-walkthrough: hovering another figure opens its note; leaving returns to the step's note.
  const stepNote = await open.getAttribute("id");
  await page.locator('.aa-exhibit a.aa-chip[data-note="N12"]').hover();
  await expect(page.locator("#aa-note-N12")).toHaveClass(/is-open/);
  await page.mouse.move(5, 5);
  await expect(open).toHaveAttribute("id", stepNote ?? "");
  await page.locator("[data-walk-replay]").click();
  await expect(cap(0)).toBeVisible();
  await expect(open).toHaveAttribute("id", `aa-note-${steps[0]}`);
  await expect(wrap).toHaveAttribute("data-anim", "done", { timeout: 4_000 });
  await page.locator("[data-walk-next]").click();
  await expect(cap(1)).toBeVisible();
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

test("hero: stepping through the walkthrough never moves the page below it (1440, 390)", async ({ browser }) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await page.goto(LANDING, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const steps = JSON.parse((await page.locator("[data-exhibit]").getAttribute("data-steps")) ?? "[]") as string[];
    const below = () => page.locator("#how").evaluate((el) => Math.round(el.getBoundingClientRect().top + window.scrollY));
    // Step by hand (the timer stops); the section after the exhibit stays where it is at every step and back.
    const y = await below();
    for (let k = 1; k <= steps.length; k++) {
      await page.locator("[data-walk-next]").click();
      await expect(page.locator(`.aa-walk-cap[data-step="${k}"]`)).toBeVisible();
      expect(await below(), `step ${k} at ${viewport.width}`).toBe(y);
    }
    await page.locator("[data-walk-prev]").click();
    expect(await below()).toBe(y);
    await ctx.close();
  }
});

test("hero: on a landscape phone (667 × 375) the figures still verify as the exhibit comes into view", async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await page.goto(LANDING);
  await page.locator(".aa-exhibit-page").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await expect(page.locator("[data-exhibit]")).toHaveAttribute("data-anim", "done", { timeout: 4_000 });
  await expect(page.locator(".aa-exhibit a.aa-chip.is-verified")).toHaveCount(await page.locator(".aa-exhibit a.aa-chip").count());
});

test("hero: under 900 px the walkthrough advances by itself, its notes below the figure, without moving the page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(LANDING);
  // The figures verify as the exhibit comes into view; the steps advance once the notes below it are on screen.
  await page.locator(".aa-walk-body").scrollIntoViewIfNeeded();
  await expect(page.locator("[data-exhibit]")).toHaveAttribute("data-anim", "done", { timeout: 4_000 });
  await expect(page.locator('.aa-walk-cap[data-step="0"]')).toBeVisible();
  await page.locator(".aa-notes").evaluate((el) => el.scrollIntoView({ block: "center" }));
  // The step bar stays on screen while the reader is at the notes.
  await page.mouse.wheel(0, 300);
  await expect(page.locator(".aa-walk-bar")).toBeInViewport({ ratio: 1 });
  const cap1 = page.locator('.aa-walk-cap[data-step="1"]');
  await expect(cap1).toBeVisible({ timeout: 6_000 });
  const open = page.locator(".aa-note.is-open");
  const [b, e] = await Promise.all([open.boundingBox(), page.locator(".aa-exhibit").boundingBox()]);
  expect(b?.y ?? 0).toBeGreaterThan((e?.y ?? 0) + (e?.height ?? 0) - 1);
  // Each note keeps its own height at the top of the shared cell: its last line ends near its bottom, not stretched.
  const slack = await open.evaluate((el) => el.getBoundingClientRect().bottom - (el.lastElementChild?.getBoundingClientRect().bottom ?? 0));
  expect(slack).toBeLessThan(24);
  // Stepping never moves what follows: the notes share one cell as tall as the tallest.
  const below = async () => (await page.locator("#how").boundingBox())?.y ?? 0;
  const before = await below();
  await expect(page.locator('.aa-walk-cap[data-step="2"]')).toBeVisible({ timeout: 6_000 });
  expect(await below()).toBe(before);
  // On a phone the step's SQL is folded behind "Show SQL"; opening it is the reader's own move.
  const fold = page.locator(".aa-note.is-open details[data-fold]");
  await expect(fold).toHaveCount(1);
  await expect(fold).not.toHaveAttribute("open", /.*/);
  await expect(fold.locator(".aa-note-sql")).toBeHidden();
  // Pause stops the timer (WCAG 2.2.2), Play resumes it; stepping by hand pauses too.
  const pause = page.locator("[data-walk-pause]");
  await pause.click();
  // The button names what it will do next, so the paused state is visible: Play while paused.
  await expect(pause).toHaveText("Play");
  await page.waitForTimeout(5_000);
  await expect(page.locator('.aa-walk-cap[data-step="2"]')).toBeVisible();
  await pause.click();
  await expect(pause).toHaveText("Pause");
  // Exploring holds the timer: while the pointer is inside the exhibit no step passes; leaving lets it run again.
  await page.locator(".aa-notes").hover();
  await page.waitForTimeout(5_500);
  await expect(page.locator('.aa-walk-cap[data-step="2"]')).toBeVisible();
  await page.mouse.move(195, 5);
  await expect(page.locator('.aa-walk-cap[data-step="3"]')).toBeVisible({ timeout: 6_000 });
  await page.locator("[data-walk-prev]").click();
  await expect(page.locator('.aa-walk-cap[data-step="2"]')).toBeVisible();
  await expect(pause).toHaveText("Play");
  await page.waitForTimeout(5_000);
  await expect(page.locator('.aa-walk-cap[data-step="2"]')).toBeVisible();
});

test("landing: the strip, header and install line keep their height while the fonts arrive late (390, 1440 px)", async ({ browser }) => {
  // These boxes changed height when Plex Mono swapped in (a re-wrapping strip and install line, a header collapsing
  // when its menu script ran late): the page below moved (Lighthouse CLS 0.05). Their heights must not depend on the
  // font, so they are measured in the fallback faces and again once the web fonts are in. Glyphs re-centring inside
  // their boxes depends on the machine's fallback fonts and is not tested here; Lighthouse measures CLS 0.
  const boxes = [".aa-strip", ".aa-header", ".aa-hero-cmd"];
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
    expect(await page.evaluate(() => [...document.fonts].some((f) => f.status === "loaded"))).toBe(false);
    const before = await heights();
    release();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => [...document.fonts].some((f) => f.status === "loaded"))).toBe(true);
    expect(await heights(), `${width} px`).toEqual(before);
    await ctx.close();
  }
});

test("hero: with reduced motion the walkthrough is a static ruled list, every step's note shown", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  const steps = JSON.parse((await page.locator("[data-exhibit]").getAttribute("data-steps")) ?? "[]") as string[];
  await expect(page.locator(".aa-walk-bar")).toBeHidden();
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

test("landing section heads: label, h2, one-sentence lead, the h2 on one line at 1440", async ({ page }) => {
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
    expect(h, `${id} h2 on one line`).toBeLessThan((lh ?? 0) * 1.5);
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

test("the status strip and the install line scroll sideways with no scrollbar and a fade where there is more", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  for (const sel of [".aa-strip", ".aa-hero-cmd"]) {
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
  await root.scrollIntoViewIfNeeded();
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
