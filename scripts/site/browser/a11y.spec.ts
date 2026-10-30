// WCAG 2 A/AA with axe (apps/docs/DESIGN.md §10): the key pages, the live walkthrough at 1440 and 390, and every page
// in the sitemap.

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { BASE, DOCS, LANDING, MISSING, sitemapPaths } from "./helpers.ts";

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
