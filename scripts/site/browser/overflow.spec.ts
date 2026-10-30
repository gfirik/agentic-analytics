// Layout guard: no page of the built site scrolls sideways. Every page in the sitemap is opened at 390, 768, 1366, 1440 and 1920
// and its document must be no wider than the viewport (wide tables, diagrams and commands scroll inside their own boxes).
// Also at 360 (key pages and the whole sitemap) and through 1000-1440, where the docs' margin column is narrowest.

import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { BASE, DOCS, LANDING, MISSING, sitemapPaths } from "./helpers.ts";

const SITEMAP = new URL("../../../apps/docs/dist/sitemap-0.xml", import.meta.url);
const paths = [...readFileSync(SITEMAP, "utf8").matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => new URL(m[1] ?? "").pathname);
const PAGES = [LANDING, ...DOCS, MISSING];

for (const width of [390, 768, 1366, 1440, 1920]) {
  test(`at ${width} no page of the sitemap overflows horizontally`, async ({ page }) => {
    test.setTimeout(300_000);
    expect(paths.length).toBeGreaterThan(40);
    await page.setViewportSize({ width, height: 900 });
    const wide: string[] = [];
    for (const path of paths) {
      await page.goto(path, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      const over = await page.evaluate(() => {
        const el = document.scrollingElement;
        return el ? el.scrollWidth - window.innerWidth : 0;
      });
      if (over > 0) wide.push(`${path} (+${over}px)`);
    }
    expect(wide).toEqual([]);
  });
}

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
