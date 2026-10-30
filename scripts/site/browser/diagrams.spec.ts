// The site's diagrams (apps/docs/DESIGN.md §6): the pipeline stages (still until Play, a stacked list without JS or on
// phones) and the contribution bridge (one shared scale, connectors joining the bars).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { BASE, LANDING } from "./helpers.ts";

test("pipeline stages: still until Play; a stop opens its panel; Play steps once to Report and stops; nothing moves", async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  const root = page.locator(".aa-stages");
  // To the rail's top, so the engine machine's full-screen stage just above is wholly off screen: under the fake
  // clock every runFor would otherwise draw its frames (SwiftShader), slowing the page enough to flake the crossfade.
  await root.evaluate((el) => el.scrollIntoView({ block: "start" }));
  const current = root.locator(".aa-stage.is-current");
  const stop = (name: string) => root.getByRole("button", { name, exact: true });
  // The finished report first, and still.
  await expect(current).toHaveCount(1);
  await expect(current.locator(".aa-stage-name")).toContainText("Report");
  await page.clock.runFor(6000);
  await expect(current.locator(".aa-stage-name")).toContainText("Report");
  const below = async () => page.locator("#why").evaluate((el) => Math.round(el.getBoundingClientRect().top + window.scrollY));
  const y = await below();
  // A stop opens its panel; only that panel is visible.
  await stop("Files").click();
  await expect(stop("Files")).toHaveAttribute("aria-pressed", "true");
  await expect(root.locator("#aa-stages-files")).toBeVisible();
  await expect(root.locator("#aa-stages-report")).toBeHidden();
  expect(await below()).toBe(y);
  // Play steps through the stops, reads Pause while it runs, and stops at Report.
  const play = root.locator("[data-stages-play]");
  await play.click();
  await expect(play).toHaveText("Pause");
  await page.clock.runFor(2600);
  await expect(current.locator(".aa-stage-name")).toContainText("Profile");
  await page.clock.runFor(2600 * 6);
  await expect(current.locator(".aa-stage-name")).toContainText("Report");
  await expect(play).toHaveText("Play");
  expect(await below()).toBe(y);
  // Pressing a stop while playing stops it there.
  await play.click();
  await page.clock.runFor(2600);
  await stop("SQL").click();
  await expect(play).toHaveText("Play");
  await page.clock.runFor(6000);
  await expect(current.locator(".aa-stage-name")).toContainText("SQL");
});

test("pipeline stages: a stacked list without JS and under 40rem, no Play under reduced motion; type at the site's sizes", async ({
  browser,
}) => {
  for (const opts of [{ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } }, { viewport: { width: 390, height: 844 } }]) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    await page.goto(LANDING, { waitUntil: "networkidle" });
    const root = page.locator(".aa-stages");
    await expect(root.locator(".aa-stage")).toHaveCount(7);
    for (const panel of await root.locator(".aa-stage").all()) await expect(panel).toBeVisible();
    await expect(root.locator(".aa-stages-bar")).toBeHidden();
    await ctx.close();
  }
  // On docs pages too (Starlight's prose styles must not reach in): one panel shown, the others hidden, every row on one
  // line at 1440; at 390 the stacked list, each panel below the last with no overlap.
  for (const path of [`${BASE}/learn/`, `${BASE}/start/what-it-is/`, `${BASE}/how-it-works/pipeline/`]) {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      await page.goto(path, { waitUntil: "networkidle" });
      const panels = page.locator(".aa-stages .aa-stage");
      await expect(panels).toHaveCount(7);
      if (viewport.width === 1440) {
        await expect(page.locator(".aa-stages .aa-stage.is-current")).toBeVisible();
        for (const p of await page.locator(".aa-stages .aa-stage:not(.is-current)").all()) await expect(p).toBeHidden();
        const sql = page.locator(".aa-stages").getByRole("button", { name: "SQL", exact: true });
        await sql.click();
        // Each SQL row's label and value share a line.
        const off = await page.locator(".aa-stages .aa-stage-sql tr").evaluateAll((rows) =>
          rows.map((r) => {
            const [a, b] = [...r.children].map((c) => c.getBoundingClientRect().top);
            return Math.abs((a ?? 0) - (b ?? 0));
          }),
        );
        expect(Math.max(...off), path).toBeLessThan(4);
      } else {
        const off = await page.locator(".aa-stages .aa-stage-sql tr").evaluateAll((rows) =>
          rows.map((r) => {
            const [a, b] = [...r.children].map((c) => c.getBoundingClientRect().top);
            return Math.abs((a ?? 0) - (b ?? 0));
          }),
        );
        expect(Math.max(...off), path).toBeLessThan(4);
        const boxes = await panels.evaluateAll((ps) => ps.map((p) => p.getBoundingClientRect()).map((r) => [r.top, r.bottom]));
        for (let i = 1; i < boxes.length; i++) expect(boxes[i]?.[0] ?? 0, path).toBeGreaterThanOrEqual((boxes[i - 1]?.[1] ?? 0) - 1);
      }
      await ctx.close();
    }
  }
  const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/learn/`, { waitUntil: "networkidle" });
  const root = page.locator(".aa-stages");
  await expect(root.locator(".aa-stages-bar")).toBeVisible();
  await expect(root.locator("[data-stages-play]")).toBeHidden();
  await root.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(root.locator("#aa-stages-verify")).toBeVisible();
  // DESIGN.md §4: reading text in a figure is at least note size (13px); labels and chips at least label size (12px).
  const small = await root.evaluate((el) =>
    [...el.querySelectorAll<HTMLElement>("*")]
      .filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim()))
      .map((e) => {
        const cs = getComputedStyle(e);
        const label = cs.textTransform === "uppercase" || e.closest(".aa-chip") !== null;
        return { text: e.textContent?.trim().slice(0, 30), px: Number.parseFloat(cs.fontSize), min: label ? 12 : 13 };
      })
      .filter((x) => x.px < x.min),
  );
  expect(small).toEqual([]);
  await ctx.close();
});

/** The id of the drivers' total change in the page's own data (coffee.json): never typed, since fact ids follow the run. */
function coffeeTotalId(): string {
  const { report } = JSON.parse(readFileSync(join(import.meta.dirname, "../../../apps/docs/src/data/coffee.json"), "utf8")) as {
    report: { findings: { drivers?: { fact: string }[] }[]; facts: { id: string; label: string; computation: { inputs?: string[] } }[] };
  };
  const drivers = new Set((report.findings.find((f) => f.drivers?.length)?.drivers ?? []).map((d) => d.fact));
  const total = report.facts.find(
    (f) =>
      f.label.endsWith(":delta:total") &&
      (f.computation.inputs ?? []).length === drivers.size &&
      (f.computation.inputs ?? []).every((i) => drivers.has(i)),
  );
  if (!total) throw new Error("coffee.json has no total change for its drivers");
  return total.id;
}

test("the contribution bridge: one row per total and member, bars on one shared scale, connectors joining them", async ({ page }) => {
  for (const path of [`${BASE}/learn/stages/analysis/`, `${BASE}/start/first-report/`, `${BASE}/how-it-works/drivers/`]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path, { waitUntil: "networkidle" });
    const bridge = page.locator(".aa-bridge").first();
    await bridge.scrollIntoViewIfNeeded();
    await expect(bridge.locator(".aa-island-label")).toContainText("Contribution by channel");
    await expect(bridge.locator(".aa-bridge-row")).toHaveCount(4);
    await expect(bridge).not.toContainText("Everyone else");
    // The page's own data (coffee.json) proves every member is drawn: the caption says so with the total's id.
    await expect(bridge.locator("p.aa-small")).toContainText("The members drawn are all of them");
    await expect(bridge.locator("p.aa-small")).toContainText(coffeeTotalId());
    await expect(bridge).not.toContainText("not drawn");
    const geo = await bridge.evaluate((el) => {
      const tracks = [...el.querySelectorAll(".aa-bridge-track")].map((t) => t.getBoundingClientRect());
      const rows = [...el.querySelectorAll(".aa-bridge-row")];
      // Each connector sits at an end of the bar above it: the level it carries down to the next bar.
      const joins = rows.slice(1).map((row, i) => {
        const link = row.querySelector(".aa-bridge-link")?.getBoundingClientRect();
        const above = rows[i]?.querySelector(".aa-bridge-bar")?.getBoundingClientRect();
        if (!link || !above) return 999;
        return Math.min(Math.abs(link.left - above.left), Math.abs(link.left - above.right));
      });
      // The bridge itself: March ends where wholesale starts (its right edge, a fall), wholesale ends where retail starts
      // (its left edge), retail ends where April does.
      const bars = rows.map((r) => r.querySelector(".aa-bridge-bar")?.getBoundingClientRect());
      const ends = [
        Math.abs((bars[0]?.right ?? 0) - (bars[1]?.right ?? 9)),
        Math.abs((bars[1]?.left ?? 0) - (bars[2]?.left ?? 9)),
        Math.abs((bars[2]?.right ?? 0) - (bars[3]?.right ?? 9)),
      ];
      return {
        lefts: tracks.map((t) => Math.round(t.left)),
        widths: tracks.map((t) => Math.round(t.width)),
        joins,
        ends,
        track: tracks[0]?.width ?? 0,
      };
    });
    expect(new Set(geo.lefts).size, path).toBe(1);
    expect(new Set(geo.widths).size, path).toBe(1);
    for (const j of geo.joins) expect(j, path).toBeLessThan(2);
    for (const e of geo.ends) expect(e, path).toBeLessThan(2);
    // Legible: the track has most of the island, not its minimum.
    expect(geo.track, path).toBeGreaterThan(200);
    // On a phone the bars stack under their labels at full width, and the connectors are hidden.
    await page.setViewportSize({ width: 390, height: 844 });
    const phone = await bridge.evaluate((el) => ({
      links: [...el.querySelectorAll(".aa-bridge-link")].filter((l) => l.getClientRects().length > 0).length,
      tracks: [...el.querySelectorAll(".aa-bridge-track")].map((t) => Math.round(t.getBoundingClientRect().width)),
      rows: Math.round((el.querySelector(".aa-bridge-rows") as HTMLElement).getBoundingClientRect().width),
    }));
    expect(phone.links, path).toBe(0);
    for (const w of phone.tracks) expect(w, path).toBe(phone.rows);
  }
});
