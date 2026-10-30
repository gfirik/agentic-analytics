// The site stays on its own origin (apps/docs/DESIGN.md §10): no page requests anything from another host, the build
// references no external script, stylesheet, font or image, and the site's own files are served with their types.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { BASE, MISSING, sitemapPaths } from "./helpers.ts";

test("no third-party requests on any page in the sitemap or the 404, scrolled to the end", async ({ page, request }) => {
  test.setTimeout(300_000);
  const outside: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname) && !["data:", "blob:"].includes(url.protocol)) outside.push(r.url());
  });
  const paths = [...(await sitemapPaths(request)), MISSING];
  expect(paths.length).toBeGreaterThan(30);
  for (const path of paths) {
    await page.goto(path, { waitUntil: "networkidle" });
    await page.mouse.wheel(0, 40_000);
    await page.waitForLoadState("networkidle");
  }
  expect(outside).toEqual([]);
});

test("the build references no external script, stylesheet, font or image", () => {
  const DIST = join(import.meta.dirname, "..", "..", "..", "apps", "docs", "dist");
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(html|css|js|mjs)$/.test(name)) {
        const text = readFileSync(p, "utf8");
        const patterns = [
          /<script[^>]*\bsrc=["']?(?:https?:)?\/\/[^"' >]+/gi,
          /<link[^>]*\brel=["']?(?:stylesheet|preload|modulepreload|icon|shortcut icon)["']?[^>]*\bhref=["']?(?:https?:)?\/\/[^"' >]+/gi,
          /<img[^>]*\bsrc=["']?(?:https?:)?\/\/[^"' >]+/gi,
          /@import\s+(?:url\()?["']?(?:https?:)?\/\//gi,
          /url\(["']?https?:\/\/[^)]+\)/gi,
        ];
        for (const re of patterns) for (const m of text.matchAll(re)) offenders.push(`${p.slice(DIST.length)}: ${m[0].slice(0, 120)}`);
      }
    }
  };
  walk(DIST);
  // SVG namespaces (xmlns="http://www.w3.org/2000/svg") are identifiers, not requests; the patterns above don't match them.
  expect(offenders).toEqual([]);
});

test("site files are served", async ({ request }) => {
  for (const [path, type] of [
    ["favicon.svg", "image/svg+xml"],
    ["favicon.ico", "image/"],
    ["og.png", "image/png"],
    ["machine-wide.webp", "image/webp"],
    ["machine-wide.png", "image/png"],
    ["machine-tall.webp", "image/webp"],
    ["machine-tall.png", "image/png"],
    ["sitemap.xml", "xml"],
    ["sitemap-index.xml", "xml"],
  ] as const) {
    const res = await request.get(`${BASE}/${path}`);
    expect(res.status(), path).toBe(200);
    expect(res.headers()["content-type"] ?? "", path).toContain(type);
  }
  const sitemap = await (await request.get(`${BASE}/sitemap-0.xml`)).text();
  expect(sitemap).toContain("<loc>https://gfirik.github.io/agentic-analytics/</loc>");
  expect(sitemap).toContain("/how-it-works/verifier/");
});
