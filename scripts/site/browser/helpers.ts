// Shared by the site's browser specs: the site's base path, the pages several specs open, and the sitemap's pages.

import type { APIRequestContext } from "@playwright/test";

export const BASE = "/agentic-analytics";
export const LANDING = `${BASE}/`;
export const DOCS = [`${BASE}/how-it-works/verifier/`, `${BASE}/start/quickstart/`, `${BASE}/use-it/overview/`];
export const MISSING = `${BASE}/no-such-page/`;

/** Every page the sitemap lists (the landing page and every docs page), as local paths. */
export async function sitemapPaths(request: APIRequestContext): Promise<string[]> {
  const sitemap = await (await request.get(`${BASE}/sitemap-0.xml`)).text();
  return [...sitemap.matchAll(/<loc>https:\/\/gfirik\.github\.io([^<]+)<\/loc>/g)].map((m) => m[1] as string);
}
