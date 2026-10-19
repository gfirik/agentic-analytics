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

test("no horizontal scroll where the docs' margin column is narrowest (1000–1100 px)", async ({ page }) => {
  for (const width of [1000, 1024, 1072, 1100]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${BASE}/learn/stages/analysis/`, { waitUntil: "networkidle" });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, `${width} px`).toBeLessThanOrEqual(0);
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

test("hero: scrolling steps through the walkthrough on desktop, each step opening its note; prev, next and replay", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(LANDING);
  const wrap = page.locator("[data-exhibit]");
  const steps = JSON.parse((await wrap.getAttribute("data-steps")) ?? "[]") as string[];
  expect(steps.length).toBeGreaterThanOrEqual(3);
  expect(steps.length).toBeLessThanOrEqual(4);
  const cap = (k: number) => page.locator(`.aa-walk-cap[data-step="${k}"]`);
  const open = page.locator(".aa-note.is-open");
  await expect(wrap).toHaveAttribute("data-anim", "done", { timeout: 3_500 });
  await expect(cap(0)).toBeVisible();
  await expect(open).toHaveCount(0);
  // The section sticks while its track scrolls past: half a screen per step after the verification's own.
  const stick = page.locator(".aa-walk-stick");
  const start = await page.evaluate(() => {
    const w = document.querySelector("[data-exhibit]") as HTMLElement;
    const s = document.querySelector(".aa-walk-stick") as HTMLElement;
    return window.scrollY + w.getBoundingClientRect().top - Number.parseFloat(getComputedStyle(s).top);
  });
  for (let k = 1; k <= steps.length; k++) {
    await page.evaluate((y) => window.scrollTo(0, y), start + k * 450 + 20);
    await expect(page.locator(".aa-walk-stick")).toBeInViewport({ ratio: 1 });
    await expect(cap(k)).toBeVisible();
    await expect(cap(k)).toContainText(`${k}/${steps.length}`);
    await expect(open).toHaveCount(1);
    await expect(open).toHaveAttribute("id", `aa-note-${steps[k - 1]}`);
    await expect(page.locator(`.aa-exhibit a.aa-chip[data-note="${steps[k - 1]}"]`)).toHaveAttribute("aria-expanded", "true");
    // The exhibit is still on screen: the section is sticky.
    const box = await stick.boundingBox();
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(900);
    if (k === 2) {
      // The second step is the change's SQL input: its SQL and the sheet rows it read.
      await expect(open.locator(".aa-note-sql")).toContainText("FROM");
      await expect(open.locator("tr.is-cited")).not.toHaveCount(0);
    }
  }
  await expect(page.locator("[data-walk-next]")).toHaveAttribute("aria-disabled", "true");
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
  await expect(wrap).toHaveAttribute("data-anim", "done", { timeout: 4_000 });
  await page.waitForTimeout(1_200);
  await expect(cap(0)).toBeVisible();
  await page.locator("[data-walk-next]").click();
  await expect(cap(1)).toBeVisible();
});

test("hero: from 1100 × 704 px (where scroll drives the steps) every step's note fits on screen", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 704 });
  await page.goto(LANDING);
  const steps = JSON.parse((await page.locator("[data-exhibit]").getAttribute("data-steps")) ?? "[]") as string[];
  const start = await page.evaluate(() => {
    const w = document.querySelector("[data-exhibit]") as HTMLElement;
    const s = document.querySelector(".aa-walk-stick") as HTMLElement;
    return window.scrollY + w.getBoundingClientRect().top - Number.parseFloat(getComputedStyle(s).top);
  });
  for (let k = 1; k <= steps.length; k++) {
    await page.evaluate((y) => window.scrollTo(0, y), start + k * 352 + 20);
    await expect(page.locator(`.aa-walk-cap[data-step="${k}"]`)).toBeVisible();
    await expect(page.locator(".aa-note.is-open")).toBeInViewport({ ratio: 1 });
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
  await page.locator(".aa-walk-stick").scrollIntoViewIfNeeded();
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
  // Stepping never moves what follows: the notes share one cell as tall as the tallest.
  const below = async () => (await page.locator("#how").boundingBox())?.y ?? 0;
  const before = await below();
  await expect(page.locator('.aa-walk-cap[data-step="2"]')).toBeVisible({ timeout: 6_000 });
  expect(await below()).toBe(before);
  // Pause stops the timer (WCAG 2.2.2), Play resumes it; stepping by hand pauses too.
  const pause = page.locator("[data-walk-pause]");
  await pause.click();
  await expect(pause).toHaveAttribute("aria-pressed", "true");
  await expect(pause).toHaveText("Pause");
  await page.waitForTimeout(5_000);
  await expect(page.locator('.aa-walk-cap[data-step="2"]')).toBeVisible();
  await pause.click();
  await expect(pause).toHaveAttribute("aria-pressed", "false");
  // Exploring holds the timer: while the pointer is inside the exhibit no step passes; leaving lets it run again.
  await page.locator(".aa-walk-grid").hover();
  await page.waitForTimeout(5_500);
  await expect(page.locator('.aa-walk-cap[data-step="2"]')).toBeVisible();
  await page.mouse.move(195, 5);
  await expect(page.locator('.aa-walk-cap[data-step="3"]')).toBeVisible({ timeout: 6_000 });
  await page.locator("[data-walk-prev]").click();
  await expect(page.locator('.aa-walk-cap[data-step="2"]')).toBeVisible();
  await expect(pause).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(5_000);
  await expect(page.locator('.aa-walk-cap[data-step="2"]')).toBeVisible();
});

test("landing: no box moves while the fonts arrive late (390, 1440 px)", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[])
        if (!e.hadRecentInput) w.__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  // Every font held back 1.5 s, far longer than the preloaded faces take: text first paints in the fallback faces,
  // then swaps. Only glyphs re-centre by a few pixels inside their boxes (about 0.01 at 390 px); a box that changed
  // height on the swap (a wrapping strip or install line) scored 0.15. Lighthouse, with the preloads, measures 0.
  await page.route(/\.woff2$/, async (r) => {
    await new Promise((ok) => setTimeout(ok, 1_500));
    await r.continue();
  });
  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(LANDING);
    await page.waitForTimeout(3_500);
    expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls), `${width} px`).toBeLessThan(0.02);
  }
});

test("hero: with reduced motion the walkthrough is a static ruled list, every step's note shown", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  const steps = JSON.parse((await page.locator("[data-exhibit]").getAttribute("data-steps")) ?? "[]") as string[];
  await expect(page.locator(".aa-walk-bar")).toBeHidden();
  await expect(page.locator(".aa-walk-track")).toBeHidden();
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
  await expect(page.locator(".aa-pipe-frame svg")).toHaveCount(1);
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

test("the pipeline scene is still until Play is pressed (the hero is the one moment of motion)", async ({ page }) => {
  await page.goto(LANDING, { waitUntil: "networkidle" });
  const frame = page.locator(".aa-pipe-frame");
  await frame.scrollIntoViewIfNeeded();
  const before = await frame.innerHTML();
  await page.waitForTimeout(1500);
  expect(await frame.innerHTML()).toBe(before);
  await expect(page.locator(".aa-pipe button", { hasText: "Play" })).toHaveAttribute("aria-pressed", "false");
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
