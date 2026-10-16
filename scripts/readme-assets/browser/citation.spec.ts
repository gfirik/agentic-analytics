// The citation click in a real report: `aa analyze examples/coffee-roaster` (scripted demo model, offline
// embedder), then clicking a table citation highlights its rows and a document citation highlights its quote.
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const ROOT = join(import.meta.dirname, "..", "..", "..");
let html = "";

test.beforeAll(() => {
  const out = mkdtempSync(join(tmpdir(), "aa-readme-"));
  execFileSync(
    process.execPath,
    [
      join(ROOT, "apps/cli/bin/aa.js"),
      "analyze",
      "examples/coffee-roaster",
      "--yes",
      "--currency",
      "USD",
      "--today",
      "2026-07-01",
      "--embedder",
      "hash",
      "--out",
      out,
    ],
    { cwd: ROOT, env: { ...process.env, AA_DEMO_MODEL: "scripted", AA_JOBS_DIR: join(out, "jobs") }, stdio: "ignore" },
  );
  html = `file://${join(out, "agentic-analytics", "report.html")}`;
});

test("clicking a table citation highlights the cited rows", async ({ page }) => {
  await page.goto(html);
  const cite = page.locator(".cite[data-rows]").first();
  const rows = (await cite.getAttribute("data-rows"))?.split(",") ?? [];
  await cite.click();
  await expect(cite).toHaveAttribute("aria-pressed", "true");
  const lit = page.locator(".ev:not([hidden]) tr.hl");
  await expect(lit.first()).toBeVisible();
  expect(await lit.evaluateAll((trs) => trs.map((t) => t.getAttribute("data-row")))).toEqual(expect.arrayContaining([rows[0]]));
});

test("clicking a document citation highlights the quoted passage", async ({ page }) => {
  await page.goto(html);
  const cite = page.locator(".cite[data-q]").first();
  await cite.click();
  await expect(page.locator(".ev:not([hidden]) mark.hl").first()).toBeVisible();
});
