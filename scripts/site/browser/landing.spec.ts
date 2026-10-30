// The landing page's sections (apps/docs/DESIGN.md §5): stable heights while fonts load, complete without JS, the
// results table, section heads, the status strip, and no large empty block in the full-width bands.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { LANDING } from "./helpers.ts";

test("landing: the strip, header and install line keep their height while the fonts arrive late (390, 1440 px)", async ({ browser }) => {
  // These boxes changed height when Plex Mono swapped in (a re-wrapping strip and install line, a header collapsing
  // when its menu script ran late): the page below moved (Lighthouse CLS 0.05). Their heights must not depend on the
  // font, so they are measured in the fallback faces and again once the web fonts are in. Glyphs re-centring inside
  // their boxes depends on the machine's fallback fonts and is not tested here; Lighthouse measures CLS 0.
  // The web fonts are held; the local metric-matched fallback faces (fonts.css, "… Fallback") load at once.
  const boxes = [".aa-strip", ".aa-header", ".aa-hero-cmd", ".aa-hero-title", ".aa-actions", ".aa-hero-proof"];
  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ] as const) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    let release: () => void = () => {};
    const held = new Promise<void>((ok) => {
      release = ok;
    });
    await page.route(/\.woff2$/, async (r) => {
      await held;
      await r.continue();
    });
    const heights = () => page.evaluate((sel) => sel.map((s) => document.querySelector(s)?.getBoundingClientRect().height ?? -1), boxes);
    await page.goto(LANDING, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => [...document.fonts].some((f) => f.status === "loaded" && !f.family.endsWith("Fallback")))).toBe(false);
    const before = await heights();
    release();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => [...document.fonts].some((f) => f.status === "loaded" && !f.family.endsWith("Fallback")))).toBe(true);
    expect(await heights(), `${width} px`).toEqual(before);
    await ctx.close();
  }
});

test("without JS the landing page is complete and chips link into the fact ledger", async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(LANDING);
  await expect(page.locator(".aa-stages .aa-stage")).toHaveCount(7);
  await expect(page.locator(".aa-exhibit a.aa-chip .aa-check").first()).toBeVisible();
  const chip = page.locator(".aa-exhibit a.aa-chip").first();
  const href = await chip.getAttribute("href");
  expect(href).toMatch(/^#fact-N\d+$/);
  await expect(page.locator(".aa-walk-list > li").first()).toBeVisible();
  // The static list: every step's note open, nothing pinned, no track.
  const items = page.locator(".aa-walk-list details");
  await expect(items).not.toHaveCount(0);
  for (const d of await items.all()) await expect(d).toHaveAttribute("open", "");
  await expect(items.last().locator(".aa-walk-item-note")).toBeVisible();
  await expect(page.locator(".aa-hero-track")).toBeHidden();
  expect(await page.locator(".aa-hero-row").evaluate((el) => getComputedStyle(el).position)).not.toBe("sticky");
  await expect(page.locator(".aa-walk-bar")).toBeHidden();
  await expect(page.locator(".aa-notes")).toBeHidden();
  await expect(page.locator("#ledger")).toBeHidden();
  await chip.click();
  await expect(page.locator(href as string)).toBeVisible();
  await expect(page.locator("#results table tbody tr")).not.toHaveCount(0);
  await ctx.close();
});

test("results: metrics as rows and runs as columns, no sideways scroll at 1440 or 1920, one cell for a run without rates", async ({
  browser,
}) => {
  type Bars = { bars: { metric: string; value: number | null; pass: boolean | null }[] };
  const evals = JSON.parse(readFileSync(join(import.meta.dirname, "../../../apps/docs/src/data/evals.json"), "utf8")) as {
    full: Bars & { status: string; completed: number; datasets: number };
    smoke: Bars & { status: string };
    synthetic: Bars & { status: string };
    real: { datasets: { checks: { pass: boolean }[] }[] };
  };
  const fmt = (metric: string, v: number) => (metric === "Number mismatches" ? String(v) : `${(v * 100).toFixed(1)}%`);
  for (const width of [1440, 1920]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(LANDING, { waitUntil: "networkidle" });
    const wrap = page.locator("#results .aa-ledger-wrap");
    expect(await wrap.evaluate((e) => e.scrollWidth - e.clientWidth), `width ${width}`).toBe(0);
    const table = page.locator("#results table");
    await expect(table.locator('thead th[scope="col"]')).toHaveCount(5);
    await expect(table.locator('tbody th[scope="row"]')).toHaveCount(7);
    // Screen-reader text stays off screen: no "meets the bar" painted in the cells.
    const painted = await table.locator(".aa-sr").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 1).length);
    expect(painted).toBe(0);
    // A run that didn't finish has one cell spanning every metric row, labelled from the generated status.
    if (evals.full.status !== "complete") {
      const span = table.locator("td.aa-span", { hasText: `${evals.full.completed}/${evals.full.datasets}` });
      await expect(span).toHaveAttribute("rowspan", "7");
    }
    // Every figure is its run's own value from evals.json, in the row of its metric, with "below bar" exactly where the
    // run missed the bar. Columns with rates, in page order: smoke, then the nightly run if complete, then the baseline.
    const shown = [evals.smoke, evals.full, evals.synthetic].filter((r) => r.status === "complete");
    const rows = await table.locator("tbody tr").all();
    for (const row of rows) {
      const metric = ((await row.locator('th[scope="row"] .aa-metric').textContent()) ?? "").trim();
      const cells = row.locator("td.num");
      await expect(cells).toHaveCount(shown.length);
      for (const [k, run] of shown.entries()) {
        const b = run.bars.find((x) => x.metric === metric);
        expect(b, metric).toBeTruthy();
        const cell = cells.nth(k);
        await expect(cell.locator(".aa-fig"), metric).toHaveText(fmt(metric, b?.value ?? Number.NaN));
        if (b?.pass === false) await expect(cell.locator(".aa-below"), metric).toHaveCount(1);
        else await expect(cell.locator(".aa-below"), metric).toHaveCount(0);
      }
    }
    // The real public data cell: the checks passed of all checks, counted from the result file.
    const checks = evals.real.datasets.flatMap((d) => d.checks);
    await expect(table.locator('td.aa-span[headers="aa-run-real"]')).toContainText(
      `${checks.filter((c) => c.pass).length}/${checks.length}`,
    );
    await ctx.close();
  }
  // At 390 the table scrolls inside its wrapper and the metric column stays at its left edge.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(LANDING, { waitUntil: "networkidle" });
  const wrap = page.locator("#results .aa-ledger-wrap");
  expect(await wrap.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeGreaterThan(0);
  await wrap.evaluate((e) => {
    e.scrollLeft = e.scrollWidth;
  });
  const [wrapLeft, labelLeft] = await wrap.evaluate((e) => [
    e.getBoundingClientRect().left,
    (e.querySelector('tbody th[scope="row"]') as HTMLElement).getBoundingClientRect().left,
  ]);
  expect(Math.abs((labelLeft ?? 0) - (wrapLeft ?? 0))).toBeLessThan(2);
  await ctx.close();
});

test("landing section heads: label, h2, one-sentence lead; at 1440 each section a band, its head above its content", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  for (const id of ["how", "why", "results", "quickstart"]) {
    const head = page.locator(`#${id} .aa-cell-head`);
    await expect(head.locator(".aa-seclabel")).toHaveCount(1);
    await expect(head.locator("h2")).toHaveCount(1);
    const lead = head.locator("p.aa-lead");
    await expect(lead, id).toHaveCount(1);
    // One sentence (a semicolon may join two clauses), about 90 characters at most.
    const text = ((await lead.textContent()) ?? "").trim().replace(/\s+/g, " ");
    expect(text.split(/[.!?](\s|$)/).filter((x) => x.trim().length > 2).length, id).toBe(1);
    expect(text.length, id).toBeLessThanOrEqual(90);
    const [h, lh] = await head
      .locator("h2")
      .evaluate((el) => [el.getBoundingClientRect().height, Number.parseFloat(getComputedStyle(el).lineHeight)]);
    // Site v5: §1–§4 are full-width bands, the head across the top (its h2 on one line at 1440) and every other part
    // of the section below it, never beside it (a head column left a large empty block, DESIGN.md §5).
    expect(h, `${id} h2 on one line`).toBeLessThan((lh ?? 0) * 1.5);
    const [headBox, ...rest] = await page
      .locator(`#${id} .aa-band`)
      .evaluate((band) => [...band.children].map((c) => c.getBoundingClientRect().toJSON() as DOMRect));
    for (const box of rest) expect(box.top, `${id}: content below its head`).toBeGreaterThanOrEqual(headBox?.bottom ?? 0);
  }
});

test("the status strip scrolls sideways with no scrollbar and a fade where there is more", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  for (const sel of [".aa-strip"]) {
    const box = page.locator(sel);
    expect(
      await box.evaluate((e: HTMLElement) => e.offsetHeight - e.clientHeight - 2 * Number.parseFloat(getComputedStyle(e).borderTopWidth)),
      sel,
    ).toBeLessThanOrEqual(1);
    await expect(box, sel).toHaveAttribute("data-overflow", "end");
    await box.evaluate((e) => {
      e.scrollLeft = e.scrollWidth;
    });
    await expect(box, sel).toHaveAttribute("data-overflow", "start");
    await box.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(box, sel).toHaveAttribute("data-overflow", "both");
    // Focused, nothing is masked, so the focus ring outside the box shows (WCAG 2.4.7).
    expect(await box.evaluate((e) => getComputedStyle(e).maskImage), sel).toBe("none");
    await page.locator("h1").click();
    expect(await box.evaluate((e) => getComputedStyle(e).maskImage), sel).not.toBe("none");
  }
  // Where the whole line fits, nothing fades (at 1440 the strip is still a little wider than the screen).
  await page.setViewportSize({ width: 1920, height: 1000 });
  await expect(page.locator(".aa-strip")).toHaveAttribute("data-overflow", "none");
});

test("the status strip leads with proven results and links the nightly regression suite to §3", async ({ page }) => {
  await page.goto(LANDING);
  await expect(page.locator(".aa-strip")).toContainText(
    /v\d+\.\d+\.\d+ (pre-)?release\s*·\s*real public data: \d+\/\d+ checks\s*·\s*real-model smoke: \d+\/\d+ jobs[^·]*·\s*\d+ test files\s*·\s*verifier on every report\s*·\s*nightly regression: \d+ generated businesses/,
  );
  await expect(page.locator(".aa-strip")).not.toContainText(/in progress|partial/);
  await expect(page.locator(".aa-strip a")).toHaveAttribute("href", "#results");
});

// Site v5 (the maintainer's review): §1, §2 and §4 had the head on the left and the content on the right, a large empty
// column beside tall visuals. They are full-width bands now (DESIGN.md §5). This measures the rule itself: at several
// scroll positions through each section, no rectangle wider than 40% and taller than 35% of the viewport is empty of
// content inside the section's visible part. Content is text (its line boxes), media and controls, framed or filled
// boxes, and rules (a border counts as its own strip, so a ruled list's lines count but its empty middle doesn't; a
// hairline drawn by a pseudo-element counts as its element's box). Graph paper behind a head is decoration, not content.
test("no large empty block in §1, §2 and §4 at any scroll position (1920×1080, 1440×900, 1366×768)", async ({ browser }) => {
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
  ]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await page.goto(LANDING, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    for (const id of ["how", "why", "quickstart"]) {
      const [top, bottom] = await page
        .locator(`#${id} .aa-cell`)
        .evaluate((el) => [el.getBoundingClientRect().top + window.scrollY, el.getBoundingClientRect().bottom + window.scrollY]);
      // From the section's top entering the screen's middle to its bottom reaching it, a quarter screen at a time.
      const ys: number[] = [];
      for (let y = top - viewport.height / 2; y <= bottom - viewport.height / 2; y += viewport.height / 4) ys.push(Math.round(y));
      ys.push(Math.round(bottom - viewport.height / 2));
      for (const y of ys) {
        await page.evaluate((v) => window.scrollTo(0, v), Math.max(0, y));
        // Waits for state, not time: a part still revealing (opacity under 1) reads as empty until it lands.
        await expect
          .poll(
            () =>
              page.evaluate((sid) => {
                const cell = document.querySelector(`#${sid} .aa-cell`) as HTMLElement;
                const c = cell.getBoundingClientRect();
                const vw = document.documentElement.clientWidth;
                const vh = window.innerHeight;
                const box = { l: Math.max(0, c.left), t: Math.max(0, c.top), r: Math.min(vw, c.right), b: Math.min(vh, c.bottom) };
                const W = vw * 0.4;
                const H = vh * 0.35;
                if (box.r - box.l < W || box.b - box.t < H) return "";
                const rects: { l: number; t: number; r: number; b: number }[] = [];
                const add = (r: { left: number; top: number; right: number; bottom: number }) => {
                  if (r.right > r.left && r.bottom > r.top) rects.push({ l: r.left, t: r.top, r: r.right, b: r.bottom });
                };
                const shown = (el: Element) => {
                  if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
                  for (let a: Element | null = el; a && a !== cell; a = a.parentElement)
                    if (Number(getComputedStyle(a).opacity) <= 0.5) return false;
                  return true;
                };
                const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
                for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                  if (!n.textContent?.trim() || !n.parentElement || !shown(n.parentElement)) continue;
                  const range = document.createRange();
                  range.selectNodeContents(n);
                  for (const r of range.getClientRects()) add(r);
                }
                for (const el of cell.querySelectorAll("*")) {
                  if (!shown(el)) continue;
                  const r = el.getBoundingClientRect();
                  if (el.matches("img, svg, canvas, video, pre, button, input, table")) {
                    add(r);
                    continue;
                  }
                  // A rule drawn by a pseudo-element (the section label's hairline) spans its element's box.
                  const ruled = (["::before", "::after"] as const).some((pe) => {
                    const ps = getComputedStyle(el, pe);
                    return ps.content !== "none" && (ps.borderTopStyle !== "none" || ps.borderBottomStyle !== "none");
                  });
                  if (ruled) add(r);
                  const cs = getComputedStyle(el);
                  const filled = cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent";
                  const bw = (side: string) =>
                    cs.getPropertyValue(`border-${side}-style`) === "none"
                      ? 0
                      : Number.parseFloat(cs.getPropertyValue(`border-${side}-width`));
                  const [bt, br, bb, bl] = [bw("top"), bw("right"), bw("bottom"), bw("left")];
                  if (filled || (bt && br && bb && bl)) add(r);
                  else {
                    if (bt) add({ left: r.left, top: r.top, right: r.right, bottom: r.top + bt });
                    if (bb) add({ left: r.left, top: r.bottom - bb, right: r.right, bottom: r.bottom });
                    if (bl) add({ left: r.left, top: r.top, right: r.left + bl, bottom: r.bottom });
                    if (br) add({ left: r.right - br, top: r.top, right: r.right, bottom: r.bottom });
                  }
                }
                // An 8px occupancy grid over the visible part, then a W×H window slid over it with 2D prefix sums.
                const S = 8;
                const cols = Math.ceil((box.r - box.l) / S);
                const rows = Math.ceil((box.b - box.t) / S);
                const occ = new Uint8Array(cols * rows);
                for (const q of rects) {
                  const c0 = Math.max(0, Math.floor((q.l - box.l) / S));
                  const c1 = Math.min(cols, Math.ceil((q.r - box.l) / S));
                  const r0 = Math.max(0, Math.floor((q.t - box.t) / S));
                  const r1 = Math.min(rows, Math.ceil((q.b - box.t) / S));
                  for (let y = r0; y < r1; y++) occ.fill(1, y * cols + c0, y * cols + Math.max(c0, c1));
                }
                const P = new Int32Array((cols + 1) * (rows + 1));
                for (let y = 0; y < rows; y++)
                  for (let x = 0; x < cols; x++)
                    P[(y + 1) * (cols + 1) + x + 1] =
                      (occ[y * cols + x] ?? 0) +
                      (P[y * (cols + 1) + x + 1] ?? 0) +
                      (P[(y + 1) * (cols + 1) + x] ?? 0) -
                      (P[y * (cols + 1) + x] ?? 0);
                const w = Math.ceil(W / S);
                const h = Math.ceil(H / S);
                for (let y = 0; y + h <= rows; y++)
                  for (let x = 0; x + w <= cols; x++) {
                    const sum =
                      (P[(y + h) * (cols + 1) + x + w] ?? 0) -
                      (P[y * (cols + 1) + x + w] ?? 0) -
                      (P[(y + h) * (cols + 1) + x] ?? 0) +
                      (P[y * (cols + 1) + x] ?? 0);
                    if (sum === 0)
                      return `empty ${Math.round(W)}×${Math.round(H)} at ${Math.round(box.l + x * S)},${Math.round(box.t + y * S)}`;
                  }
                return "";
              }, id),
            { message: `#${id} at ${viewport.width}×${viewport.height}, scrolled to ${y}`, timeout: 5_000 },
          )
          .toBe("");
      }
    }
    await ctx.close();
  }
});
