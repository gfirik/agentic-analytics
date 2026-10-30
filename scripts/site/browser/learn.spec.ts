// Learn pages (apps/docs/DESIGN.md §6): sidenotes in the margin (inline under 1000 px), the stage page's epigraph and
// TOC, fact chips landing on the page's ledger, and stage diagrams complete without JS.

import { expect, test } from "@playwright/test";
import { BASE, sitemapPaths } from "./helpers.ts";

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
