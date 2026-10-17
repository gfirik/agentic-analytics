// /sitemap.xml: the conventional address, as a sitemap index pointing at the sitemap Starlight's @astrojs/sitemap
// writes (sitemap-0.xml, which lists the landing page and every docs page).
import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const loc = new URL(`${base}/sitemap-0.xml`, site).href;
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${loc}</loc></sitemap></sitemapindex>
`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
