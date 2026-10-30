// Motion across the landing page (apps/docs/DESIGN.md §2.5, §7).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { BASE, LANDING } from "./helpers.ts";

// Site v4 PR 3: motion across the landing page (DESIGN.md §2.5, §7). Sections reveal once, below the fold only; the
// pipeline's connector draws in; the exhibit's figures count up to their recorded value; hovers ease; nothing of it
// under reduced motion or without JS, no layout shift, no sideways scroll.
test.describe("motion", () => {
  const PARTS = "[data-reveal] > .aa-cell > *";
  /** Each revealable part: whether it starts below the screen, whether it is held for its reveal, its opacity. */
  const parts = (page: import("@playwright/test").Page) =>
    page.locator(PARTS).evaluateAll((els) =>
      els.map((el) => ({
        below: el.getBoundingClientRect().top >= window.innerHeight,
        held: el.classList.contains("aa-rv"),
        opacity: getComputedStyle(el).opacity,
      })),
    );
  /** Counts every time a part is put back on hold after the page has loaded (a reveal must happen once). */
  const watchHolds = (page: import("@playwright/test").Page) =>
    page.evaluate(() => {
      const w = window as unknown as { aaHolds: number };
      w.aaHolds = 0;
      new MutationObserver((ms) => {
        for (const m of ms)
          if (m.attributeName === "class" && (m.target as Element).classList.contains("aa-rv") && !m.oldValue?.includes("aa-rv"))
            w.aaHolds++;
      }).observe(document.body, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["class"] });
    });

  test("sections reveal once, only below the fold, and land in their final state", async ({ browser }) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      await page.goto(LANDING, { waitUntil: "networkidle" });
      const start = await parts(page);
      expect(start.length, `${viewport.width}`).toBeGreaterThanOrEqual(8);
      // Held exactly when below the screen at load: what the reader sees on load is final and never animates.
      for (const p of start) expect(p.held, `${viewport.width}`).toBe(p.below);
      expect(start.filter((p) => p.held).every((p) => p.opacity === "0")).toBe(true);
      // The hero and the engine machine's band are never held.
      await expect(page.locator(".aa-hero .aa-rv, .aa-engine-band .aa-rv")).toHaveCount(0);
      await watchHolds(page);
      // Scrolled into view, a part fades and rises into place, then stays.
      const head = page.locator("#why .aa-cell-head");
      await head.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await expect(head).not.toHaveClass(/\baa-rv\b/);
      await expect.poll(() => head.evaluate((el) => getComputedStyle(el).opacity), { timeout: 2_000 }).toBe("1");
      await expect.poll(() => head.evaluate((el) => getComputedStyle(el).transform), { timeout: 2_000 }).toBe("none");
      // Scrolling down to the end and back: every part is shown, and nothing is held again.
      for (let y = 0; y <= (await page.evaluate(() => document.documentElement.scrollHeight)); y += 500) {
        await page.evaluate((v) => window.scrollTo(0, v), y);
        await page.waitForTimeout(40);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(over, `no sideways scroll mid-reveal at ${viewport.width}`).toBeLessThanOrEqual(0);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(400);
      expect((await parts(page)).filter((p) => p.held)).toEqual([]);
      expect(await page.evaluate(() => (window as unknown as { aaHolds: number }).aaHolds)).toBe(0);
      await ctx.close();
    }
  });

  test("no sideways scroll at 360 while sections reveal; a jump lands on final content", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(LANDING, { waitUntil: "networkidle" });
    for (let y = 0; y <= (await page.evaluate(() => document.documentElement.scrollHeight)); y += 300) {
      await page.evaluate((v) => window.scrollTo(0, v), y);
      await page.waitForTimeout(30);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `at ${y}`).toBeLessThanOrEqual(0);
    }
    // Loaded at an anchor, that section is on screen at load: final, never held.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${LANDING}#results`, { waitUntil: "networkidle" });
    await expect(page.locator("#results .aa-rv")).toHaveCount(0);
    // An in-page link shows every held part at once, with no fade where it lands.
    await page.goto(LANDING, { waitUntil: "networkidle" });
    expect((await parts(page)).some((p) => p.held)).toBe(true);
    await page.locator('#aa-site-menu a[href$="#results"]').first().click();
    await expect(page.locator(".aa-rv, .aa-rv-go")).toHaveCount(0);
  });

  test("reduced motion and no JS: nothing is held, nothing counts, the connector is drawn", async ({ browser }) => {
    for (const opts of [
      { reducedMotion: "reduce" as const, viewport: { width: 1440, height: 900 } },
      { reducedMotion: "reduce" as const, viewport: { width: 390, height: 844 } },
      { javaScriptEnabled: false, viewport: { width: 1440, height: 900 } },
    ]) {
      const ctx = await browser.newContext(opts);
      const page = await ctx.newPage();
      await page.goto(LANDING, { waitUntil: "networkidle" });
      const all = await parts(page);
      expect(all.filter((p) => p.held || p.opacity !== "1")).toEqual([]);
      await expect(page.locator("[data-exhibit]")).not.toHaveAttribute("data-anim", "pending");
      await expect(page.locator(".aa-exhibit .aa-fig[data-count]")).toHaveCount(0);
      const colours = await page.locator(".aa-exhibit .aa-fig").evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
      expect(new Set(colours)).toEqual(new Set(["rgb(18, 20, 23)"]));
      await expect(page.locator(".aa-stages.is-undrawn, .aa-stages.is-drawing")).toHaveCount(0);
      for (let y = 0; y <= (await page.evaluate(() => document.documentElement.scrollHeight)); y += 900)
        await page.evaluate((v) => window.scrollTo(0, v), y);
      await page.waitForTimeout(300);
      expect((await parts(page)).filter((p) => p.held || p.opacity !== "1")).toEqual([]);
      await ctx.close();
    }
  });

  test("the pipeline's connector draws in as the rail comes into view; Play and the stops still step it", async ({ page }) => {
    // Without the 3D machine (its chunk refused, so the band keeps its still frame, DESIGN §6): mounting it creates a
    // WebGL context, a long task on CI's software renderer, and it could land inside the draw-in's short mid-draw window
    // and starve the frames this test samples (main CI after #109). The machine's own tests cover the machine.
    await page.route(/machine-3d[^/]*\.js(\?|$)/, (r) => r.abort());
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(LANDING, { waitUntil: "networkidle" });
    const root = page.locator("#how .aa-stages");
    /** Each stop's segment, as its horizontal scale (0 undrawn, 1 drawn). */
    const scales = () =>
      root.locator(".aa-stages-rail li").evaluateAll((lis) =>
        lis.map((li) => {
          const t = getComputedStyle(li, "::after").transform;
          return t === "none" ? 1 : Number(t.match(/matrix\(([^,]+)/)?.[1] ?? Number.NaN);
        }),
      );
    await expect(root).toHaveClass(/\bis-undrawn\b/);
    // Undrawing eases each segment to 0 over 180ms (the rail's own transition), so wait for it to land rather than
    // read it once: read straight after load it caught 0.0103 on a busy machine.
    await expect.poll(scales, { timeout: 2_000 }).toEqual([0, 0, 0, 0, 0, 0, 0]);
    await root.locator(".aa-stages-rail").evaluate((el) => el.scrollIntoView({ block: "center" }));
    // Mid-draw: the first stops are drawn while the last are not yet; it runs left to right.
    const mid = await page.waitForFunction(
      () => {
        const lis = [...document.querySelectorAll("#how .aa-stages-rail li")];
        const s = lis.map((li) => Number(getComputedStyle(li, "::after").transform.match(/matrix\(([^,]+)/)?.[1] ?? 1));
        return (s[0] ?? 0) > 0.99 && (s[6] ?? 1) < 0.5 ? s : null;
      },
      undefined,
      { polling: "raf", timeout: 3_000 },
    );
    const at = (await mid.jsonValue()) as number[];
    for (let i = 1; i < at.length; i++) expect(at[i] ?? 0).toBeLessThanOrEqual((at[i - 1] ?? 0) + 1e-6);
    await expect.poll(scales, { timeout: 3_000 }).toEqual([1, 1, 1, 1, 1, 1, 1]);
    await expect(root).not.toHaveClass(/\bis-(undrawn|drawing)\b/);
    // A stop still opens its panel, and the connector follows it.
    await root.getByRole("button", { name: "Files", exact: true }).click();
    await expect.poll(scales, { timeout: 2_000 }).toEqual([1, 0, 0, 0, 0, 0, 0]);
    await root.getByRole("button", { name: "SQL", exact: true }).click();
    await expect.poll(scales, { timeout: 2_000 }).toEqual([1, 1, 1, 1, 0, 0, 0]);
    // Docs pages don't draw in: the rail is drawn from the start.
    await page.goto(`${BASE}/learn/`, { waitUntil: "networkidle" });
    await expect(page.locator(".aa-stages.is-undrawn")).toHaveCount(0);
    // Loaded with the rail on screen: drawn from the start.
    await page.goto(`${LANDING}#how`, { waitUntil: "networkidle" });
    await expect(page.locator(".aa-stages.is-undrawn")).toHaveCount(0);
  });

  test("the exhibit's figures count up to their recorded value, then verify; the HTML holds the real value", async ({ page, request }) => {
    const exhibit = JSON.parse(readFileSync(join(import.meta.dirname, "../../../apps/docs/src/data/exhibit.json"), "utf8")) as {
      lines: { fact?: string }[][];
      notes: Record<string, { value: string }>;
    };
    const values = exhibit.lines.flat().flatMap((p) => (p.fact ? [exhibit.notes[p.fact]?.value ?? ""] : []));
    expect(values.length).toBeGreaterThan(5);
    // The static HTML already holds every recorded value.
    const html = await (await request.get(LANDING)).text();
    for (const v of values) expect(html, v).toContain(v);
    const num = (s: string) => Number(s.replace(/[^\d.]/g, "")) || 0;
    await page.setViewportSize({ width: 1440, height: 900 });
    // Without the 3D machine, for the same reason as the connector test above: its mount could starve the count's frames.
    await page.route(/machine-3d[^/]*\.js(\?|$)/, (r) => r.abort());
    await page.goto(LANDING);
    // Mid-count: a running value drawn over the figure, never past the recorded one, the real text underneath unchanged.
    const mid = await page.waitForFunction(
      () => {
        const f = [...document.querySelectorAll<HTMLElement>(".aa-exhibit .aa-fig[data-count]")].find(
          (e) => e.dataset.count !== e.textContent && Number((e.dataset.count ?? "").replace(/[^\d.]/g, "")) > 0,
        );
        return f ? { count: f.dataset.count ?? "", text: f.textContent ?? "", colour: getComputedStyle(f).color } : null;
      },
      undefined,
      { polling: "raf", timeout: 3_000 },
    );
    const m = (await mid.jsonValue()) as { count: string; text: string; colour: string };
    expect(values).toContain(m.text);
    expect(num(m.count)).toBeLessThan(num(m.text));
    expect(m.colour).toBe("rgba(0, 0, 0, 0)");
    // Then the checks; at the end every figure is its recorded value, in ink, with nothing drawn over it.
    await expect(page.locator("[data-exhibit]")).toHaveAttribute("data-anim", "done", { timeout: 3_500 });
    await expect(page.locator(".aa-exhibit .aa-fig[data-count]")).toHaveCount(0);
    const end = await page
      .locator(".aa-exhibit .aa-exhibit-line .aa-fig")
      .evaluateAll((els) => els.map((e) => ({ text: e.textContent, colour: getComputedStyle(e).color })));
    expect(end.map((e) => e.text)).toEqual(values);
    expect(new Set(end.map((e) => e.colour))).toEqual(new Set(["rgb(18, 20, 23)"]));
  });

  test("hover states ease in 150 ms on links, chips, buttons and rows", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(LANDING, { waitUntil: "networkidle" });
    for (const sel of [".aa-more", ".aa-exhibit a.aa-chip", ".aa-button-primary", "#results tbody th[scope='row']", ".aa-doors li"]) {
      const durations = await page
        .locator(sel)
        .first()
        .evaluate((el) =>
          getComputedStyle(el)
            .transitionDuration.split(",")
            .map((d) => Number.parseFloat(d) * (d.includes("ms") ? 1 : 1000)),
        );
      for (const d of durations) {
        expect(d, sel).toBeGreaterThanOrEqual(150);
        expect(d, sel).toBeLessThanOrEqual(200);
      }
    }
  });

  // The hero field (site v5 PR 1): the drifting net behind the statement, on a canvas.
  const NET = ".aa-hero-field .aa-hf-net";
  const frames = (page: import("@playwright/test").Page) =>
    page.locator(NET).evaluate((c) => (c as HTMLCanvasElement & { aaFrames?: number }).aaFrames ?? 0);

  test("hero field: the net drifts while the hero is on screen, and pauses off-screen and in a hidden tab; it has no pause control", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(LANDING, { waitUntil: "networkidle" });
    const net = page.locator(NET);
    await expect(net).toHaveAttribute("data-state", "running", { timeout: 5_000 });
    const a = await frames(page);
    // Waited for, not read once after a fixed 600ms: a busy CI runner drew only 2 frames in that time.
    await expect.poll(() => frames(page), { message: "draws while on screen", timeout: 3_000 }).toBeGreaterThan(a + 5);
    // Site v5 PR 1b: the connectors draw themselves in, pulses run along them, and it never draws past 30 fps.
    type Debug = HTMLCanvasElement & { aaFrames?: number; aaLinks?: number; aaDrawn?: number; aaPulses?: number };
    const stats = () =>
      net.evaluate((c: Debug) => ({ frames: c.aaFrames ?? 0, links: c.aaLinks ?? 0, drawn: c.aaDrawn ?? 0, pulses: c.aaPulses ?? 0 }));
    const t0 = await stats();
    const started = Date.now();
    let pulsed = 0;
    for (let k = 0; k < 10; k++) {
      await page.waitForTimeout(200);
      pulsed = Math.max(pulsed, (await stats()).pulses);
    }
    const t1 = await stats();
    const fps = ((t1.frames - t0.frames) * 1000) / (Date.now() - started);
    expect(fps, "frames a second").toBeLessThanOrEqual(31);
    expect(t1.links, "connectors").toBeGreaterThanOrEqual(12);
    expect(t1.drawn, "connectors drawn in").toBeGreaterThanOrEqual(12);
    expect(pulsed, "pulses along the connectors").toBeGreaterThanOrEqual(1);
    // The backing store is DPR-aware and capped, and the canvas is sized by CSS (it never sizes the layout).
    const size = await net.evaluate((c: HTMLCanvasElement) => ({
      w: c.width,
      h: c.height,
      cw: c.clientWidth,
      ch: c.clientHeight,
      position: getComputedStyle(c).position,
    }));
    expect(size.position).toBe("absolute");
    expect(size.w * size.h).toBeLessThanOrEqual(1_600_000 + size.w + size.h);
    expect(Math.abs(size.w - size.cw)).toBeLessThanOrEqual(1);
    // Scrolled off-screen: paused, and no frame is drawn.
    await page.locator("#how").evaluate((el) => el.scrollIntoView());
    await expect(net).toHaveAttribute("data-state", "paused");
    const b = await frames(page);
    await page.waitForTimeout(600);
    expect(await frames(page), "no frames off-screen").toBe(b);
    // Back on screen it runs again.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(net).toHaveAttribute("data-state", "running");
    // A hidden tab pauses it.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(net).toHaveAttribute("data-state", "paused");
    const c = await frames(page);
    await page.waitForTimeout(400);
    expect(await frames(page), "no frames in a hidden tab").toBe(c);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(net).toHaveAttribute("data-state", "running");
    // No pause control (site v5 PR 2): the maintainer accepts the WCAG 2.2.2 trade-off; reduced motion turns it off.
    await expect(page.locator("[data-hf-toggle]")).toHaveCount(0);
  });

  test("hero field: under reduced motion and without JS the net is absent; the static grid, glow and grain remain", async ({ browser }) => {
    for (const opts of [{ reducedMotion: "reduce" as const }, { javaScriptEnabled: false }]) {
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
      ]) {
        const ctx = await browser.newContext({ ...opts, viewport });
        const page = await ctx.newPage();
        await page.goto(LANDING, { waitUntil: "networkidle" });
        await page.waitForTimeout(2_500); // past the idle start
        const net = page.locator(NET);
        await expect(net).toHaveAttribute("data-state", "off");
        expect(await frames(page)).toBe(0);
        if (opts.reducedMotion) expect(await net.evaluate((c) => getComputedStyle(c).display)).toBe("none");
        for (const layer of [".aa-hf-grid", ".aa-hf-glow", ".aa-hf-grain"])
          expect(await page.locator(layer).evaluate((el) => getComputedStyle(el).backgroundImage), layer).not.toBe("none");
        await ctx.close();
      }
    }
  });

  test("hero field: no layout shift as it starts and fades in (1440, 390)", async ({ browser }) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      page.on("console", (m) => {
        if (m.text().startsWith("hero shift") || m.text().startsWith("page shift")) console.log(`${viewport.width}: ${m.text()}`);
      });
      await page.addInitScript(() => {
        const w = window as unknown as { aaHeroShift: number; aaShiftTotal: number };
        w.aaHeroShift = 0;
        w.aaShiftTotal = 0;
        type Entry = PerformanceEntry & { value: number; hadRecentInput: boolean; sources: { node?: Node | null }[] };
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as Entry[]) {
            if (e.hadRecentInput) continue;
            w.aaShiftTotal += e.value;
            // Every shift is printed with what it moved, so a CI-only failure (other fallback fonts) names its cause.
            console.log(
              `page shift ${e.value.toFixed(6)} at ${Math.round(e.startTime)} ms: ${e.sources
                .map((s) => (s.node instanceof Element ? s.node : s.node?.parentElement)?.getAttribute("class") ?? "?")
                .join("; ")}`,
            );
            const inHero = e.sources.some((s) => {
              const el = s.node instanceof Element ? s.node : (s.node?.parentElement ?? null);
              // The field, its control and the corner marks: what this adds to the hero. (The font swap may still nudge
              // a word of the statement by a pixel early on; that is the page's font budget, counted in the total.)
              return Boolean(el?.closest(".aa-hero-field, .aa-hero-corners"));
            });
            if (inHero) {
              w.aaHeroShift += e.value;
              console.log(
                `hero shift ${e.value.toFixed(6)} at ${Math.round(e.startTime)} ms: ${e.sources
                  .map((s) => (s.node instanceof Element ? s.node : s.node?.parentElement)?.className ?? "?")
                  .join("; ")}`,
              );
            }
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      await page.goto(LANDING, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const before = await page.locator(".aa-statement").boundingBox();
      await expect(page.locator(NET)).toHaveAttribute("data-state", "running", { timeout: 5_000 });
      await page.waitForTimeout(800); // the fade-in
      expect(await page.locator(".aa-statement").boundingBox(), `${viewport.width}: the statement keeps its box`).toEqual(before);
      const { aaHeroShift, aaShiftTotal } = await page.evaluate(() => {
        const w = window as unknown as { aaHeroShift: number; aaShiftTotal: number };
        return { aaHeroShift: w.aaHeroShift, aaShiftTotal: w.aaShiftTotal };
      });
      expect(aaHeroShift, `${viewport.width}: shifts in the hero field or the corner marks`).toBe(0);
      expect(aaShiftTotal, `${viewport.width}: CLS on load`).toBeLessThan(0.05);
      await ctx.close();
    }
  });

  test("no layout shift from any of it: CLS under 0.05 through the whole landing page (1440, 390)", async ({ browser }) => {
    type Shift = { value: number; time: number; mine: boolean; pinned: boolean; sources: string[] };
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      // Every unexpected shift, and whether any node it moved sits in what this motion touches: the revealed parts, the
      // pipeline stages or the exhibit.
      await page.addInitScript(() => {
        const w = window as unknown as { aaShifts: Shift[] };
        w.aaShifts = [];
        type Rect = { x: number; y: number; width: number; height: number };
        type Entry = PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
          sources: { node?: Node | null; previousRect: Rect; currentRect: Rect }[];
        };
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as Entry[]) {
            if (e.hadRecentInput) continue;
            const els = e.sources.map((s) => (s.node instanceof Element ? s.node : (s.node?.parentElement ?? null)));
            w.aaShifts.push({
              value: e.value,
              time: e.startTime,
              mine: els.some((el) => Boolean(el?.closest("[data-reveal], .aa-stages, .aa-exhibit"))),
              // The pinned hero (site v5 PR 2): the whole hero row is sticky over the hero's scroll track
              // and move with the scroll by design as the pin releases; position, not animation, told apart the same way.
              pinned:
                els.length > 0 &&
                els.every((el) => {
                  const host = el?.closest(".aa-hero-row");
                  return Boolean(host) && getComputedStyle(host as Element).position === "sticky";
                }),
              sources: e.sources.map((s, i) => {
                const el = els[i];
                const r = (q: Rect) => `${Math.round(q.x)},${Math.round(q.y)} ${Math.round(q.width)}×${Math.round(q.height)}`;
                return `${el ? `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}` : "?"} ${r(s.previousRect)} → ${r(s.currentRect)}`;
              }),
            });
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      await page.goto(LANDING, { waitUntil: "networkidle" });
      await page.waitForTimeout(3_000); // the replay
      for (let y = 0; y <= (await page.evaluate(() => document.documentElement.scrollHeight)); y += 400) {
        await page.evaluate((v) => window.scrollTo(0, v), y);
        await page.waitForTimeout(120);
      }
      await page.waitForTimeout(800);
      const shifts = await page.evaluate(() => (window as unknown as { aaShifts: Shift[] }).aaShifts);
      // CLS as browsers report it: the largest session window (shifts under 1 s apart, at most 5 s long).
      let cls = 0;
      let win = 0;
      let first = 0;
      let last = Number.NEGATIVE_INFINITY;
      for (const s of shifts) {
        if (s.time - last > 1000 || s.time - first > 5000) {
          win = 0;
          first = s.time;
        }
        win += s.value;
        last = s.time;
        cls = Math.max(cls, win);
      }
      const total = shifts.reduce((t, s) => t + s.value, 0);
      console.log(`CLS through the landing page at ${viewport.width}: ${cls.toFixed(4)} (all shifts summed ${total.toFixed(4)})`);
      // Every shift in an animated part is printed with its sources, and every shift at all when CLS is over budget, so
      // a failure names the node that moved.
      for (const s of shifts.filter((x) => x.mine || cls >= 0.05))
        console.log(`shift ${s.value.toFixed(6)} at ${Math.round(s.time)} ms: ${s.sources.join("; ")}`);
      expect(
        shifts.filter((s) => s.mine && !s.pinned),
        `${viewport.width}: shifts in the revealed parts, the stages or the exhibit`,
      ).toEqual([]);
      expect(cls, `${viewport.width}`).toBeLessThan(0.05);
      await ctx.close();
    }
  });
});
