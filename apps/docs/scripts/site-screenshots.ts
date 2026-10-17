// Screenshots of the built site for review (docs/assets/site/): the landing page and a docs page, in light and dark,
// at desktop (1440) and mobile (390) widths. Serve the build first (`bun run --filter @agentic-analytics/docs preview`).
//   tsx scripts/site-screenshots.ts [--url http://127.0.0.1:4321/agentic-analytics] [--out dir] [--full]
// PW_CHANNEL=chrome uses an installed Chrome instead of Playwright's own build.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:4321/agentic-analytics" },
    out: { type: "string", default: join(import.meta.dirname, "..", "..", "..", "docs", "assets", "site") },
    full: { type: "boolean", default: false },
    only: { type: "string" },
    sections: { type: "boolean", default: false },
    compare: { type: "string" },
  },
});
const base = (values.url as string).replace(/\/$/, "");
const out = values.out as string;
mkdirSync(out, { recursive: true });

const pages = [
  { name: "landing", path: "/" },
  { name: "docs", path: "/how-it-works/verifier/" },
];
const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
try {
  for (const p of pages)
    for (const s of sizes)
      for (const scheme of ["light", "dark"] as const) {
        const name = `${p.name}-${scheme}-${s.name}`;
        if (values.only && !name.includes(values.only as string)) continue;
        const ctx = await browser.newContext({
          viewport: { width: s.width, height: s.height },
          deviceScaleFactor: 1,
          colorScheme: scheme,
          reducedMotion: "reduce",
        });
        const page = await ctx.newPage();
        await page.goto(`${base}${p.path}`, { waitUntil: "networkidle" });
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        await page.screenshot({ path: join(out, `${name}.png`), fullPage: Boolean(values.full) });
        if (values.sections) {
          const parts = page.locator("main > section, main .sl-markdown-content, body > footer");
          for (let i = 0; i < (await parts.count()); i++) await parts.nth(i).screenshot({ path: join(out, `${name}-part${i}.png`) });
        }
        await ctx.close();
      }
  // --compare <url>: our landing page next to another site's, both light, desktop, above the fold.
  if (values.compare) {
    const shot = async (url: string, scheme: "light" | "dark") => {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: "networkidle" });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const png = (await page.screenshot({ type: "png" })).toString("base64");
      await ctx.close();
      return `data:image/png;base64,${png}`;
    };
    const rows: string[] = [];
    for (const scheme of ["light", "dark"] as const) {
      const [ours, theirs] = [await shot(`${base}/`, scheme), await shot(values.compare as string, scheme)];
      rows.push(
        `<div class="row"><figure><img src="${ours}"><figcaption>agentic-analytics · ${scheme}</figcaption></figure><figure><img src="${theirs}"><figcaption>pas-agent · ${scheme}</figcaption></figure></div>`,
      );
    }
    const page = await browser.newPage({ viewport: { width: 1480, height: 400 } });
    await page.setContent(
      `<!doctype html><style>body{margin:0;padding:12px;background:#ffffff;font:500 14px/1.4 monospace;color:#333}.row{display:flex;gap:16px;margin-bottom:12px}figure{margin:0;width:720px}img{width:720px;display:block;border:1px solid #ccc}figcaption{padding:4px 0}</style>${rows.join("")}`,
    );
    await page.screenshot({ path: join(out, "compare-pas-agent.png"), fullPage: true });
  }
} finally {
  await browser.close();
}
process.stdout.write(`screenshots: ${out}\n`);
