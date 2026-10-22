// The report half of the README demo: the report opens, a table citation is clicked and its rows light up, then a
// document citation highlights the quoted email. Headless, no browser chrome, a file:// page: no URL in frame.
//   tsx scripts/readme-assets/report-clip.ts <report.html> <out dir>
import { chromium } from "@playwright/test";

const [report, out] = process.argv.slice(2);
if (!report || !out) throw new Error("usage: report-clip.ts <report.html> <out dir>");
const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
// Chromium is closed even when a locator fails, so no browser is left running (AGENTS.md §9), as in pipeline-gif.ts.
try {
  const context = await browser.newContext({
    viewport: { width: 1100, height: 680 },
    recordVideo: { dir: out, size: { width: 1100, height: 680 } },
  });
  const page = await context.newPage();
  await page.goto(`file://${report}`);
  await page.waitForTimeout(1800);
  const table = page.locator(".cite[data-rows]").first();
  await table.scrollIntoViewIfNeeded();
  await table.hover();
  await page.waitForTimeout(600);
  await table.click();
  await page.waitForTimeout(2600);
  const doc = page.locator(".cite[data-q]").first();
  await doc.scrollIntoViewIfNeeded();
  await doc.hover();
  await page.waitForTimeout(500);
  await doc.click();
  await page.waitForTimeout(2600);
  await context.close();
} finally {
  await browser.close();
}
