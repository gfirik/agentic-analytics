// The hero SVGs: no running animation under reduced motion, animation otherwise; and the README <picture> loads
// the variant that matches the color scheme.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const svg = (v: string) => `file://${join(ROOT, "docs/assets/readme", `hero-${v}.svg`)}`;

for (const v of ["light", "dark"]) {
  test(`hero-${v}.svg is static under reduced motion and animates otherwise`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(svg(v));
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(svg(v));
    expect(await page.evaluate(() => document.getAnimations().length)).toBeGreaterThan(0);
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`the README <picture> shows the ${scheme} hero in ${scheme} mode`, async ({ page }) => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const picture = (/<picture>[\s\S]*?<\/picture>/.exec(readme)?.[0] ?? "").replace(/(srcset|src)="docs\//g, `$1="file://${ROOT}/docs/`);
    expect(picture).toContain("hero-dark.svg");
    await page.emulateMedia({ colorScheme: scheme });
    await page.setContent(`<!doctype html><html><body>${picture}</body></html>`);
    await page.waitForFunction(() => (document.querySelector("img") as HTMLImageElement | null)?.complete === true);
    const src = await page.evaluate(() => (document.querySelector("img") as HTMLImageElement).currentSrc);
    expect(src).toMatch(new RegExp(`hero-${scheme}\\.svg$`));
  });
}
