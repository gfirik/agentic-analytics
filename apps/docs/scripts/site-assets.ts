// Renders the site's binary assets from committed sources, so they can be regenerated rather than hand-exported:
//   public/og.png       the 1200×630 Open Graph card: on-system HTML with the site's self-hosted fonts, its
//                       headline number read from the README pipeline run (docs/assets/readme/pipeline.json);
//   public/favicon.ico  the favicon.svg "aa" lettermark rasterized at 16, 32 and 48 px, packed as PNG-in-ICO;
//   public/machine-wide.{webp,png}, machine-tall.{webp,png}
//                       the engine machine's still frames (shown at once, under the live view, and alone without JS,
//                       under reduced motion and on weak devices): its own scene (src/components/site/machine-scene.ts)
//                       rendered in the browser with WebGL, from the same stations, tokens, lights and home view as the
//                       live section, with no labels (they are HTML). Wide for desktop, tall for phones (the lighter scene).
// It records the hash of its inputs in scripts/site-assets.json (checked by scripts/test/site-assets.test.ts).
// Run: `bun run --filter @agentic-analytics/docs assets` (needs Playwright's Chromium, or PW_CHANNEL=chrome).
import { readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import type { PipelineData } from "../src/components/pipeline-scene.ts";
import { STILLS, sceneInput } from "../src/components/site/engine-machine.ts";
import { TONES } from "../src/components/site/machine-scene.ts";
import { SITE_ASSETS_MANIFEST, siteAssetsManifest } from "./site-assets-inputs.ts";

const DOCS = join(import.meta.dirname, "..");
const ROOT = join(DOCS, "..", "..");
const PUBLIC = join(DOCS, "public");
// Inlined as data URLs: the page is set from a string, so nothing is fetched while rendering.
const font = (pkg: string, file: string) =>
  `data:font/woff2;base64,${readFileSync(join(DOCS, "node_modules", pkg, "files", file)).toString("base64")}`;

interface Shown {
  readonly id: string;
  readonly text: string;
}
const run = JSON.parse(readFileSync(join(ROOT, "docs/assets/readme/pipeline.json"), "utf8")) as {
  readonly change: {
    readonly metric: string;
    readonly fromPeriod: string;
    readonly period: string;
    readonly pct: Shown;
    readonly delta: Shown;
  };
  readonly verification: { readonly numbers_checked: number; readonly numbers_mismatched: number };
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const favicon = readFileSync(join(PUBLIC, "favicon.svg"), "utf8");

const og = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"OgSerif";src:url(${font("@fontsource-variable/source-serif-4", "source-serif-4-latin-opsz-normal.woff2")});font-weight:200 900}
@font-face{font-family:"OgSans";src:url(${font("@fontsource/ibm-plex-sans", "ibm-plex-sans-latin-400-normal.woff2")});font-weight:400}
@font-face{font-family:"OgSans";src:url(${font("@fontsource/ibm-plex-sans", "ibm-plex-sans-latin-600-normal.woff2")});font-weight:600}
@font-face{font-family:"OgMono";src:url(${font("@fontsource/ibm-plex-mono", "ibm-plex-mono-latin-500-normal.woff2")});font-weight:500}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;background:#f8f8f6;color:#121417;font-family:"OgSans";padding:72px 88px;display:flex;flex-direction:column;justify-content:space-between}
.top{display:flex;align-items:center;font-weight:600;font-size:28px;letter-spacing:-.01em}
h1{font-family:"OgSerif";font-weight:450;font-size:84px;line-height:1.02;letter-spacing:-.02em;max-width:900px}
.ledger span{white-space:nowrap}
.ledger{border-top:2px solid #8b8f94;border-bottom:1px solid #dcdcd6;display:flex;align-items:center;gap:28px;padding:20px 0;font-size:26px;color:#4a4f57}
.fig{font-family:"OgMono";font-weight:500;color:#121417;font-size:34px}
.chip{display:inline-flex;align-items:center;gap:6px;font-family:"OgMono";font-weight:500;font-size:22px;border:1.5px solid #8b8f94;border-radius:3px;padding:4px 9px;color:#4a4f57}
.chip svg{width:20px;height:20px}
.foot{display:flex;justify-content:space-between;font-family:"OgMono";font-weight:500;font-size:20px;letter-spacing:.08em;text-transform:uppercase;color:#5f646c}
</style></head><body>
<div class="top"><span>agentic-analytics</span></div>
<h1>An AI analyst you can audit.</h1>
<div>
<div class="ledger"><span>${esc(run.change.metric)} ${esc(run.change.fromPeriod)} → ${esc(run.change.period)}</span><span class="fig">${esc(run.change.pct.text)}</span><span class="chip"><svg viewBox="0 0 16 16"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="#0b6b3a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>${esc(run.change.pct.id)}</span><span>${run.verification.numbers_checked} recomputed · ${run.verification.numbers_mismatched} mismatched</span></div>
</div>
<div class="foot"><span>SQL-computed · verified · cited</span><span>Open source · self-hosted</span></div>
</body></html>`;

/** An ICO file holding the given PNGs (Windows Vista+ and every browser read PNG entries). */
function ico(pngs: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

/** The colour tokens, read from tokens.css (the page reads the same ones with getComputedStyle). */
function tokens(): Record<keyof typeof TONES, string> {
  const css = readFileSync(join(DOCS, "src", "styles", "tokens.css"), "utf8");
  return Object.fromEntries(
    Object.entries(TONES).map(([k, v]) => {
      const m = new RegExp(`${v}:\\s*(#[0-9a-f]{6});`).exec(css);
      if (!m) throw new Error(`site-assets: no ${v} in tokens.css`);
      return [k, m[1] as string];
    }),
  ) as Record<keyof typeof TONES, string>;
}

/**
 * The engine machine's stills: a page on a made-up origin, served from memory (nothing is fetched from the network):
 * three's own ES modules and the scene module with its types stripped, joined by an import map.
 */
async function machineStills(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const ORIGIN = "http://machine.invalid";
  const three = join(DOCS, "node_modules", "three", "build");
  const files: Record<string, string> = {
    "/three.module.js": readFileSync(join(three, "three.module.js"), "utf8"),
    "/three.core.js": readFileSync(join(three, "three.core.js"), "utf8"),
    "/machine-scene.js": stripTypeScriptTypes(readFileSync(join(DOCS, "src", "components", "site", "machine-scene.ts"), "utf8"), {
      mode: "strip",
    }),
    "/index.html": `<!doctype html><html><head><meta charset="utf-8"><script type="importmap">{"imports":{"three":"${ORIGIN}/three.module.js"}}</script></head><body></body></html>`,
  };
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = files[path];
    if (body === undefined) return route.abort();
    return route.fulfill({ status: 200, contentType: path.endsWith(".html") ? "text/html" : "text/javascript", body });
  });
  await page.goto(`${ORIGIN}/index.html`);
  const run = JSON.parse(readFileSync(join(ROOT, "docs/assets/readme/pipeline.json"), "utf8")) as PipelineData;
  const out = await page.evaluate(
    async ([url, input, toks, sizes]) => {
      const m = (await import(url)) as typeof import("../src/components/site/machine-scene.ts");
      return m.renderStills(input, toks, sizes);
    },
    [`${ORIGIN}/machine-scene.js`, sceneInput(run), tokens(), { wide: [...STILLS.wide], tall: [...STILLS.tall] }] as const,
  );
  const bytes = (dataUrl: string, type: string) => {
    if (!dataUrl.startsWith(`data:${type};base64,`)) throw new Error(`site-assets: the browser didn't encode ${type}`);
    return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  };
  for (const name of ["wide", "tall"] as const) {
    writeFileSync(join(PUBLIC, `machine-${name}.webp`), bytes(out[name].webp, "image/webp"));
    writeFileSync(join(PUBLIC, `machine-${name}.png`), bytes(out[name].png, "image/png"));
  }
  await page.close();
}

// WebGL without a GPU (CI, headless): SwiftShader, Chromium's software renderer.
const browser = await chromium.launch({
  ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(og, { waitUntil: "load" });
  await page.evaluate(async () => {
    await Promise.all([...document.fonts].map((f) => f.load()));
    await document.fonts.ready;
  });
  writeFileSync(join(PUBLIC, "og.png"), await page.screenshot({ type: "png" }));

  const pngs: { size: number; data: Buffer }[] = [];
  for (const size of [16, 32, 48]) {
    const p = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await p.emulateMedia({ colorScheme: "light" });
    await p.setContent(
      `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${favicon}`,
    );
    pngs.push({ size, data: await p.screenshot({ type: "png", omitBackground: true }) });
  }
  writeFileSync(join(PUBLIC, "favicon.ico"), ico(pngs));
  await machineStills(browser);
  writeFileSync(SITE_ASSETS_MANIFEST, `${JSON.stringify(siteAssetsManifest(), null, 2)}\n`);
} finally {
  await browser.close();
}
process.stdout.write("docs: wrote public/og.png, public/favicon.ico and public/machine-{wide,tall}.{webp,png}\n");
