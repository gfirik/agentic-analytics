// Screenshots of the engine machine from two builds of the site, side by side, with how many pixels differ: the tour's start,
// a middle stop, and explore with a card open, at 1440 and 390 (and 1440 at a device pixel ratio of 2). On demand only:
//
//   bunx tsx scripts/site/perf/machine-shots.ts --before http://127.0.0.1:4330/agentic-analytics/ --after http://127.0.0.1:4331/agentic-analytics/ --out <dir>
//
// The slow drift is a function of time, so the tour shots run with Math.sin pinned to 0 in both builds (the drift is the
// only use of it in the tour); explore is shot without that, since the orbit needs it.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const BEFORE = arg("before", "http://127.0.0.1:4330/agentic-analytics/");
const AFTER = arg("after", "http://127.0.0.1:4331/agentic-analytics/");
const OUT = arg("out", "machine-shots");
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
mkdirSync(OUT, { recursive: true });

const VIEWS = [
  { name: "1440", width: 1440, height: 900, dsf: 1 },
  { name: "390", width: 390, height: 844, dsf: 1 },
  { name: "1440-dpr2", width: 1440, height: 900, dsf: 2 },
];

const band = (page: Page) =>
  page.evaluate(() => {
    const track = document.querySelector<HTMLElement>("[data-track]");
    const stage = document.querySelector<HTMLElement>("[data-engine-stage]");
    if (!track || !stage) throw new Error("no band");
    const shares = Number(getComputedStyle(track.closest("[data-machine]") as Element).getPropertyValue("--aa-engine-stops"));
    const top = track.getBoundingClientRect().top + scrollY - (Number.parseFloat(getComputedStyle(stage).top) || 0);
    return { top, per: (track.offsetHeight - stage.offsetHeight) / shares };
  });

async function shoot(url: string, label: string, view: (typeof VIEWS)[number]) {
  const files: Record<string, Buffer> = {};
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--use-gl=angle", "--use-angle=gl", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"],
  });
  for (const pinned of [true, false]) {
    const ctx = await browser.newContext({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.dsf });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
      Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
    });
    if (pinned)
      await ctx.addInitScript(() => {
        Math.sin = () => 0;
      });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "load" });
    const b = await band(page);
    const at = (k: number) => Math.round(b.top + (k + 0.5) * b.per);
    await page.evaluate((y) => scrollTo(0, y), at(0));
    await page.locator("[data-machine][data-gl=on]").waitFor({ timeout: 60_000 });
    if (pinned) {
      await sleep(3000);
      files[`${view.name}-1-tour-start`] = await page.screenshot();
      await page.evaluate((y) => scrollTo(0, y), at(4));
      await sleep(4000);
      files[`${view.name}-2-middle-stop`] = await page.screenshot();
    } else {
      await sleep(1500);
      if (view.width < 600) {
        await page.locator("[data-explore]").click();
        await sleep(1500);
        await page.locator('[data-tag][data-id="analysis"]').click({ force: true });
      } else {
        await page.evaluate((y) => scrollTo(0, y), at(4));
        await sleep(3500);
        const box = await page.locator('[data-tag][data-id="analysis"]').boundingBox();
        if (!box) throw new Error("no label");
        await page.mouse.click(box.x + box.width / 2, box.y + box.height + 60);
      }
      await page.locator("[data-machine][data-view=explore]").waitFor();
      await sleep(3000);
      await page.mouse.move(0, 0);
      files[`${view.name}-3-explore-card`] = await page.screenshot();
    }
    await ctx.close();
  }
  await browser.close();
  for (const [name, buf] of Object.entries(files)) writeFileSync(join(OUT, `${label}-${name}.png`), buf);
  return files;
}

async function main() {
  const rows: string[] = [];
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  // tsx wraps named functions in a helper the page does not have.
  await page.addInitScript("window.__name = (f) => f");
  await page.goto("about:blank");
  for (const view of VIEWS) {
    const before = await shoot(BEFORE, "before", view);
    const after = await shoot(AFTER, "after", view);
    for (const name of Object.keys(before)) {
      const a = before[name] as Buffer;
      const b = after[name] as Buffer;
      const r = await page.evaluate(
        async ([x, y]) => {
          const load = async (b64: string) => {
            const img = new Image();
            img.src = `data:image/png;base64,${b64}`;
            await img.decode();
            const c = document.createElement("canvas");
            c.width = img.width;
            c.height = img.height;
            const g = c.getContext("2d", { willReadFrequently: true });
            if (!g) throw new Error("no 2d");
            g.drawImage(img, 0, 0);
            return g.getImageData(0, 0, c.width, c.height);
          };
          const [p, q] = [await load(x as string), await load(y as string)];
          if (p.width !== q.width || p.height !== q.height) return { size: false, over8: 0, over32: 0, max: 0, total: 0, diff: "" };
          const out = new ImageData(p.width, p.height);
          let over8 = 0;
          let over32 = 0;
          let max = 0;
          for (let i = 0; i < p.data.length; i += 4) {
            const d = Math.max(
              Math.abs((p.data[i] ?? 0) - (q.data[i] ?? 0)),
              Math.abs((p.data[i + 1] ?? 0) - (q.data[i + 1] ?? 0)),
              Math.abs((p.data[i + 2] ?? 0) - (q.data[i + 2] ?? 0)),
            );
            max = Math.max(max, d);
            if (d > 8) over8++;
            if (d > 32) over32++;
            // The difference, amplified, on white: where the two builds draw differently.
            const v = 255 - Math.min(255, d * 8);
            out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
            out.data[i + 3] = 255;
          }
          const c = document.createElement("canvas");
          c.width = p.width;
          c.height = p.height;
          c.getContext("2d")?.putImageData(out, 0, 0);
          return { size: true, over8, over32, max, total: p.width * p.height, diff: c.toDataURL("image/png").split(",")[1] ?? "" };
        },
        [a.toString("base64"), b.toString("base64")],
      );
      if (r.diff) writeFileSync(join(OUT, `diff-${name}.png`), Buffer.from(r.diff, "base64"));
      rows.push(
        `${name.padEnd(28)} same size ${r.size}  pixels differing by >8/255: ${((100 * r.over8) / Math.max(1, r.total)).toFixed(3)}%  by >32: ${((100 * r.over32) / Math.max(1, r.total)).toFixed(3)}%  max channel diff ${r.max}`,
      );
    }
  }
  await browser.close();
  console.log(rows.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
