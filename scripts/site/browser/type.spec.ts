// Type (apps/docs/DESIGN.md §4): code is one size everywhere, and on every page in the sitemap nothing is above h2 but
// the hero and the page's h1, with floors for reading text and labels.

import { expect, test } from "@playwright/test";
import { BASE, LANDING, MISSING, sitemapPaths } from "./helpers.ts";

test("code is one size everywhere: blocks, inline code and Expressive Code (--aa-text-code); headings keep their scale", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const path of [
    LANDING,
    `${BASE}/start/quickstart/`,
    `${BASE}/learn/stages/analysis/`,
    `${BASE}/how-it-works/verifier/`,
    `${BASE}/how-it-works/drivers/`,
    `${BASE}/how-it-works/pipeline/`,
    `${BASE}/use-it/cli/`,
    MISSING,
  ]) {
    await page.goto(path, { waitUntil: "networkidle" });
    const sizes = await page.evaluate(() => {
      const want = getComputedStyle(document.documentElement).getPropertyValue("--aa-text-code").trim();
      const px = Number.parseFloat(want) * Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
      const shown = [...document.querySelectorAll<HTMLElement>("main pre, main code")].filter(
        (e) => e.getClientRects().length > 0 && (e.textContent ?? "").trim(),
      );
      // The one exception: code in a heading keeps the heading's scale (0.875em of it).
      const heading = (e: HTMLElement) => e.closest<HTMLElement>("h1, h2, h3, h4, h5, h6");
      const off = shown
        .filter((e) => !heading(e))
        .map((e) => Number.parseFloat(getComputedStyle(e).fontSize))
        .filter((v) => Math.abs(v - px) > 0.1);
      const headingOff = shown.filter((e) => {
        const h = heading(e);
        if (!h) return false;
        return Math.abs(Number.parseFloat(getComputedStyle(e).fontSize) - 0.875 * Number.parseFloat(getComputedStyle(h).fontSize)) > 0.2;
      }).length;
      return { off: [...new Set(off)], headingOff, n: shown.length };
    });
    if (path !== MISSING) expect(sizes.n, path).toBeGreaterThan(0);
    expect(sizes.off, path).toEqual([]);
    expect(sizes.headingOff, path).toBe(0);
  }
});

test("type on every page in the sitemap: nothing above h2 but the hero and the page's h1; floors for reading text and labels", async ({
  page,
  request,
}) => {
  test.setTimeout(400_000);
  const off: string[] = [];
  const paths = await sitemapPaths(request);
  // Every page at 1440; the landing page and two Learn pages at 390 too (the mobile scale differs).
  const runs = [
    ...paths.map((p) => [p, 1440] as const),
    ...[LANDING, `${BASE}/learn/`, `${BASE}/learn/stages/analysis/`].map((p) => [p, 390] as const),
  ];
  for (const [path, width] of runs) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(path, { waitUntil: "networkidle" });
    const found = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const rem = Number.parseFloat(root.fontSize);
      const h2 = Number.parseFloat(root.getPropertyValue("--aa-text-h2")) * rem;
      // A figure: any diagram, island, ledger or framed panel (DESIGN.md §4).
      const figures = document.querySelectorAll(
        ".aa-island, .aa-flow, .aa-stages, .aa-exhibit, .aa-notes, .aa-walk-list, .aa-ledger-wrap, .aa-transcript, .aa-diagram, .aa-proofs, .aa-map",
      );
      const out: string[] = [];
      const seen = new Set<Element>();
      const check = (e: Element, inFigure: boolean) => {
        if (seen.has(e) || !e.getClientRects().length || e.closest(".aa-sr")) return;
        seen.add(e);
        const own = [...e.childNodes]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent ?? "")
          .join("")
          .trim();
        if (!own) return;
        const cs = getComputedStyle(e);
        const px = Number.parseFloat(cs.fontSize);
        // The ceiling: only the hero statement and the page's own h1 may be larger than h2.
        if (px > h2 + 0.5 && !e.closest(".aa-display, h1")) out.push(`${px}px above h2: "${own.slice(0, 30)}"`);
        // Labels: mono uppercase labels, chips, and short mono tags and ids ("N141", "bar ≥ 80%", "recomputed"); a
        // figure (.aa-fig) is reading text, whatever its face.
        const label =
          !e.closest(".aa-fig") &&
          (cs.textTransform === "uppercase" || e.closest(".aa-chip") !== null || (/mono/i.test(cs.fontFamily) && own.length <= 32));
        if (px < 11.95) out.push(`${px}px under the label size: "${own.slice(0, 30)}"`);
        else if (inFigure && !label && px < 12.95) out.push(`${px}px reading text in a figure: "${own.slice(0, 30)}"`);
      };
      for (const f of figures) for (const e of f.querySelectorAll("*")) check(e, true);
      for (const e of document.querySelectorAll("main *")) check(e, false);
      return out;
    });
    for (const x of found) off.push(`${path} at ${width}: ${x}`);
  }
  expect(off).toEqual([]);
});
