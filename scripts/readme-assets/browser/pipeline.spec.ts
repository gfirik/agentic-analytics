// The README pipeline GIF (docs/DOCS-SITE.md §3.3) in a real browser: the <picture> picks the GIF for the color
// scheme and the still PNG under reduced motion; and every frame of the shared scene keeps its text inside the
// canvas, so nothing is clipped in the GIF or the docs island.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { HEIGHT, POSTER_SECONDS, SCENES, sceneSvg, WIDTH } from "../../../apps/docs/src/components/pipeline-scene.ts";
import { readPipelineData } from "../pipeline.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const picture = () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const block = /<!-- diagram:pipeline-gif:start -->[\s\S]*?(<picture>[\s\S]*?<\/picture>)/.exec(readme)?.[1] ?? "";
  return block.replace(/(srcset|src)="docs\//g, `$1="file://${ROOT}/docs/`);
};

for (const [scheme, motion, file] of [
  ["light", "no-preference", "pipeline-light.gif"],
  ["dark", "no-preference", "pipeline-dark.gif"],
  ["light", "reduce", "pipeline-light.png"],
  ["dark", "reduce", "pipeline-dark.png"],
] as const) {
  test(`the README pipeline <picture> shows ${file} in ${scheme} mode, motion ${motion}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: motion });
    await page.setContent(`<!doctype html><html><body>${picture()}</body></html>`);
    await page.waitForFunction(() => (document.querySelector("img") as HTMLImageElement | null)?.complete === true);
    const img = await page.evaluate(() => {
      const i = document.querySelector("img") as HTMLImageElement;
      return { src: i.currentSrc, alt: i.alt };
    });
    expect(img.src.endsWith(file)).toBe(true);
    expect(img.alt).toContain("−17.9%");
  });
}

test("every scene keeps its text inside the 640×480 canvas, off the edges", async ({ page }) => {
  const data = readPipelineData();
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.setContent(`<!doctype html><html><body style="margin:0"><div id="s"></div></body></html>`);
  for (const t of [...SCENES.map((s) => s.end - 0.3), POSTER_SECONDS]) {
    await page.evaluate(
      (html) => {
        (document.getElementById("s") as HTMLElement).innerHTML = html;
      },
      sceneSvg(data, t, { theme: "light", width: WIDTH }),
    );
    // Screen boxes (the SVG is drawn at 640 px, so CSS px are canvas units), after every transform and scale.
    const out = await page.evaluate(
      ([w, h]) =>
        [...document.querySelectorAll("text")]
          .map((el) => ({ text: el.textContent, b: el.getBoundingClientRect() }))
          .filter(({ b }) => b.left < 16 || b.top < 0 || b.right > (w ?? 0) - 16 || b.bottom > (h ?? 0) - 8)
          .map(({ text }) => text),
      [WIDTH, HEIGHT],
    );
    expect(out, `t=${t}`).toEqual([]);
  }
});
