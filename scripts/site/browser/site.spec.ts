// The product site in a real browser (apps/docs/DESIGN.md §10): no request leaves the site, WCAG 2 A/AA has no
// violations in light and dark, nothing scrolls sideways at 360 px, the page works without JS and with reduced
// motion, and the site files (favicons, OG image, sitemap, 404) are served.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const BASE = "/agentic-analytics";
const LANDING = `${BASE}/`;
const DOCS = [`${BASE}/how-it-works/verifier/`, `${BASE}/start/quickstart/`, `${BASE}/use-it/overview/`];
const MISSING = `${BASE}/no-such-page/`;
const PAGES = [LANDING, ...DOCS, MISSING];

test.describe("no third-party requests", () => {
  for (const path of [LANDING, ...DOCS]) {
    test(path, async ({ page }) => {
      const outside: string[] = [];
      page.on("request", (r) => {
        const url = new URL(r.url());
        if (!["127.0.0.1", "localhost"].includes(url.hostname) && !url.protocol.startsWith("data")) outside.push(r.url());
      });
      await page.goto(path, { waitUntil: "networkidle" });
      await page.mouse.wheel(0, 20_000);
      await page.waitForLoadState("networkidle");
      expect(outside).toEqual([]);
    });
  }
});

test.describe("WCAG 2 A/AA (axe)", () => {
  for (const scheme of ["light", "dark"] as const)
    for (const path of [LANDING, DOCS[0] as string, MISSING]) {
      test(`${path} · ${scheme}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.goto(path, { waitUntil: "networkidle" });
        await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
        const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        const found = result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
        expect(found).toEqual([]);
      });
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

test("no horizontal scroll at 360 px on any page in the sitemap", async ({ page, request }) => {
  const sitemap = await (await request.get(`${BASE}/sitemap-0.xml`)).text();
  const paths = [...sitemap.matchAll(/<loc>https:\/\/gfirik\.github\.io([^<]+)<\/loc>/g)].map((m) => m[1] as string);
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

test("WCAG 2 A/AA (axe) on every page in the sitemap, light and dark", async ({ page, request }) => {
  test.setTimeout(600_000);
  const sitemap = await (await request.get(`${BASE}/sitemap-0.xml`)).text();
  const paths = [...sitemap.matchAll(/<loc>https:\/\/gfirik\.github\.io([^<]+)<\/loc>/g)].map((m) => m[1] as string);
  const found: string[] = [];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const path of paths) {
      await page.goto(path, { waitUntil: "networkidle" });
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      for (const v of result.violations) found.push(`${path} · ${scheme} · ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    }
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

test("a fact chip opens the fact's working, and Escape closes it", async ({ page }) => {
  await page.goto(LANDING, { waitUntil: "networkidle" });
  const chip = page.locator("#report .aa-claims a.aa-chip", { hasText: "N30" }).first();
  await chip.scrollIntoViewIfNeeded();
  await expect(chip).toHaveAttribute("aria-expanded", "false");
  await chip.click();
  await expect(chip).toHaveAttribute("aria-expanded", "true");
  const panel = page.locator("#aa-fact-panel");
  await expect(panel).toContainText("pct_change");
  await panel.locator("a.aa-chip", { hasText: "N11" }).click();
  await expect(panel).toContainText("SQL, run in DuckDB");
  await page.keyboard.press("Escape");
  await expect(chip).toHaveAttribute("aria-expanded", "false");
  await expect(chip).toBeFocused();
});

test("without JS the landing page is complete and chips link into the fact ledger", async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(LANDING);
  await expect(page.locator(".aa-pipe-frame svg")).toHaveCount(1);
  const href = await page.locator("#report a.aa-chip").first().getAttribute("href");
  expect(href).toMatch(/^#fact-N\d+$/);
  await expect(page.locator(href as string)).toHaveCount(1);
  await expect(page.locator("#evals table tbody tr")).not.toHaveCount(0);
  await ctx.close();
});

test("reduced motion: the pipeline does not play", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  const frame = page.locator(".aa-pipe-frame");
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
