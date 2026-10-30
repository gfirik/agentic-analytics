// Layout guard: no page of the built site scrolls sideways. Every page in the sitemap is opened at 390, 768, 1366, 1440 and 1920
// and its document must be no wider than the viewport (wide tables, diagrams and commands scroll inside their own boxes).

import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const SITEMAP = new URL("../../../apps/docs/dist/sitemap-0.xml", import.meta.url);
const paths = [...readFileSync(SITEMAP, "utf8").matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => new URL(m[1] ?? "").pathname);

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
