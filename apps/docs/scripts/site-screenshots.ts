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
} finally {
  await browser.close();
}
process.stdout.write(`screenshots: ${out}\n`);
