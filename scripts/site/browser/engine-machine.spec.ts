// The engine machine band under the hero (apps/docs/DESIGN.md §6, §7).

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { LANDING } from "./helpers.ts";

// The engine machine (apps/docs/DESIGN.md §6 "Engine machine", §7): a live band under the hero. WebGL runs on
// SwiftShader (playwright.config.ts); the device is made a capable one, except in the weak-device test.
test.describe("engine machine", () => {
  const CHUNK = /\/_astro\/machine-3d\.[^/]*\.js$/;
  /** An init script: the device's cores and memory as the page sees them. */
  const device = ([cores, memory]: number[]) => {
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => cores });
    Object.defineProperty(navigator, "deviceMemory", { get: () => memory });
  };
  const offOrigin = (url: string) => {
    const u = new URL(url);
    return !["127.0.0.1", "localhost"].includes(u.hostname) && !["data:", "blob:"].includes(u.protocol);
  };
  /** The share of the canvas's pixels within 1 of an sRGB colour, read from a screenshot of it (no hooks in the page). */
  const share = async (page: import("@playwright/test").Page, png: Buffer, token: string) =>
    page.evaluate(
      async ([b64, tok]) => {
        const want = getComputedStyle(document.documentElement).getPropertyValue(tok).trim();
        const rgb = [1, 3, 5].map((i) => Number.parseInt(want.slice(i, i + 2), 16));
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d");
        if (!ctx) return 0;
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let hit = 0;
        for (let i = 0; i < d.length; i += 4)
          if (
            Math.abs((d[i] ?? 0) - (rgb[0] ?? 0)) <= 1 &&
            Math.abs((d[i + 1] ?? 0) - (rgb[1] ?? 0)) <= 1 &&
            Math.abs((d[i + 2] ?? 0) - (rgb[2] ?? 0)) <= 1
          )
            hit++;
        return hit / (d.length / 4);
      },
      [png.toString("base64"), token] as const,
    );
  /**
   * The band's geometry (site v5): where its track starts on the page, how far it scrolls per share (each stop, the
   * home view included, holds an equal share), the number of stops after the home view, and the tour.
   */
  const band = (page: import("@playwright/test").Page) =>
    page.evaluate(() => {
      const track = document.querySelector<HTMLElement>("[data-track]");
      const stage = document.querySelector<HTMLElement>("[data-engine-stage]");
      if (!track || !stage) throw new Error("no band");
      const shares = Number(getComputedStyle(track.closest("[data-machine]") as Element).getPropertyValue("--aa-engine-stops"));
      const top = track.getBoundingClientRect().top + scrollY - (Number.parseFloat(getComputedStyle(stage).top) || 0);
      const tour = (
        JSON.parse(document.querySelector("[data-machine-data]")?.textContent ?? "{}") as { tour: { key: string; members: string[] }[] }
      ).tour;
      return {
        top,
        per: (track.offsetHeight - stage.offsetHeight) / shares,
        stops: shares - 1,
        tour,
        tall: track.offsetHeight > stage.offsetHeight + 10,
      };
    });
  type Band = Awaited<ReturnType<typeof band>>;
  const scrollToY = (page: import("@playwright/test").Page, y: number) => page.evaluate((v) => window.scrollTo(0, v), Math.round(y));
  /** The page's scroll position that holds the camera at stop k (0 is the home view). */
  const atStop = (b: Band, k: number) => b.top + (k + 0.5) * b.per;
  /** The stop (1-based) that shows a piece. */
  const stopOf = (b: Band, key: string) => b.tour.findIndex((t) => t.members.includes(key)) + 1;
  /** The visible station labels' boxes, and every pair that overlaps. */
  const labelBoxes = (page: import("@playwright/test").Page) =>
    page.evaluate(() => {
      const boxes = [...document.querySelectorAll<HTMLElement>("[data-tag]")]
        .filter((t) => getComputedStyle(t).visibility === "visible" && getComputedStyle(t).display !== "none")
        .map((t) => ({ id: t.dataset.id ?? "", r: t.getBoundingClientRect() }));
      const overlaps: string[] = [];
      for (const [i, a] of boxes.entries())
        for (const c of boxes.slice(i + 1))
          if (a.r.left < c.r.right && c.r.left < a.r.right && a.r.top < c.r.bottom && c.r.top < a.r.bottom)
            overlaps.push(`${a.id}/${c.id}`);
      return { ids: boxes.map((b) => b.id), overlaps };
    });
  const live = async (page: import("@playwright/test").Page, width: number, height: number) => {
    await page.addInitScript(device, [8, 8]);
    await page.setViewportSize({ width, height });
    await page.goto(LANDING);
    const b = await band(page);
    await scrollToY(page, atStop(b, 0));
    await expect(page.locator("[data-machine]")).toHaveAttribute("data-gl", "on", { timeout: 20_000 });
    return band(page);
  };

  test("live from load: the still frame first, three on idle with no input, hover shows a station's card, all on the site", async ({
    page,
  }) => {
    await page.addInitScript(device, [8, 8]);
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(LANDING);
    const root = page.locator("[data-machine]");
    await expect(root).toHaveAttribute("data-mode", "live");
    // The still frame is in the HTML with its own size; the band is tall, set before first paint.
    const still = page.locator(".aa-engine-still img");
    await expect(still).toHaveAttribute("width", /\d+/);
    expect((await band(page)).tall).toBe(true);
    // The exhibit's report page stays on the first screen, and the band follows the hero.
    expect(await page.locator(".aa-exhibit-page").evaluate((e) => e.getBoundingClientRect().top)).toBeLessThan((900 * 5) / 6);
    // three starts on idle after the page's load event, once the band is near: not while the first screen is in use.
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2500);
    expect(requests.filter((u) => CHUNK.test(u))).toEqual([]);
    await scrollToY(page, (await band(page)).top - 900);
    await expect(root).toHaveAttribute("data-gl", "on", { timeout: 20_000 });
    const timing = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      const chunk = performance.getEntriesByType("resource").find((r) => /machine-3d\./.test(r.name));
      return { load: nav.loadEventEnd, chunk: chunk?.startTime ?? -1 };
    });
    expect(timing.chunk).toBeGreaterThanOrEqual(timing.load);
    await expect(page.locator(".aa-engine-view canvas")).toBeVisible();

    // Hovering a station's label shows its card (the list's own entry) and presses it; the card links its Learn page.
    // At Analysis's own stop, once the tour has reached it and the camera has settled, as the tour tests do.
    const b = await band(page);
    await scrollToY(page, atStop(b, stopOf(b, "analysis")));
    const kickerAtStop = new RegExp(`^Stop ${stopOf(b, "analysis")} of `);
    await expect(page.locator("[data-card-kicker]")).toHaveText(kickerAtStop, { timeout: 10_000 });
    await page.waitForTimeout(1000);
    const analysis = page.locator('[data-tag][data-id="analysis"]');
    await expect(analysis).toBeVisible();
    await expect(analysis).not.toHaveClass(/\bis-far\b/);
    // The mouse goes straight to the label, not through locator.hover(): the labels drift with the camera, so they are
    // never "stable" to Playwright, which then scrolls the label into view, and for a label in the sticky stage that
    // scrolls the page back up the band, to another stop, which resets the hover (main after #92).
    const at = await analysis.boundingBox();
    if (!at) throw new Error("no label");
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await expect(analysis).toHaveAttribute("aria-pressed", "true");
    // The hover holds while the drift slides the label under the still mouse.
    await page.waitForTimeout(1500);
    await expect(analysis).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-card-kicker]")).not.toHaveText(kickerAtStop);
    await expect(page.locator('[data-tag][aria-pressed="true"]')).toHaveCount(1);
    const card = page.locator("[data-card]");
    await expect(card.locator("[data-card-title]")).toHaveText(
      (await page.locator('.aa-stations li[data-station="analysis"] .aa-station-title').textContent()) ?? "?",
    );
    await expect(card.locator('a[href$="/learn/stages/analysis/"]')).toHaveCount(1);
    // The labels are buttons in station order, so the keyboard meets them in line order.
    const ids = await page.locator("[data-tag]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id ?? ""));
    expect(ids.slice(0, 11)).toEqual(
      await page
        .locator("ol.aa-stations > li[data-station]")
        .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.station ?? "")),
    );

    // Let the labels' colour and opacity transitions land first: on CI axe once measured the pressed label halfway
    // through its 150ms change and reported its contrast (main after #92).
    await page.waitForFunction(
      () =>
        document
          .getAnimations()
          .filter((a) => a.playState === "running")
          .every((a) => !((a.effect as KeyframeEffect | null)?.target as Element | null)?.closest?.(".aa-engine")),
      undefined,
      { polling: "raf", timeout: 3_000 },
    );
    const axe = await new AxeBuilder({ page }).include(".aa-engine").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    expect(requests.filter(offOrigin)).toEqual([]);
  });

  test("the stage fills the screen with no frame, pins through the tour right after the hero, then releases", async ({ page }) => {
    const b = await live(page, 1440, 900);
    const stage = page.locator("[data-engine-stage]");
    const rect = () => stage.evaluate((e) => e.getBoundingClientRect().toJSON() as DOMRect);
    // At every stop the stage is the whole screen, in the same place; the view has no border or radius.
    for (const k of [0, Math.ceil(b.stops / 2), b.stops]) {
      await scrollToY(page, atStop(b, k));
      const r = await rect();
      expect([Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], `stop ${k}`).toEqual([0, 0, 1440, 900]);
    }
    const view = await page.locator("[data-viewport]").evaluate((e) => {
      const cs = getComputedStyle(e);
      return [cs.borderTopWidth, cs.borderLeftWidth, cs.borderTopLeftRadius];
    });
    expect(view).toEqual(["0px", "0px", "0px"]);
    // The band starts right where the hero ends (nothing between the hero's release and the stage).
    const gap = await page.evaluate(() => {
      const hero = document.querySelector(".aa-hero")?.getBoundingClientRect();
      const trackTop = document.querySelector("[data-track]")?.getBoundingClientRect().top ?? 0;
      return hero ? trackTop - hero.bottom : 999;
    });
    expect(Math.abs(gap)).toBeLessThanOrEqual(2);
    // Past the band the stage scrolls away and §1 follows.
    await scrollToY(page, b.top + b.per * (b.stops + 1) + 900);
    expect((await rect()).top).toBeLessThan(0);
    expect(await page.locator("#how").evaluate((e) => e.getBoundingClientRect().top)).toBeLessThan(900);
  });

  test("a quicker tour: about seven stops, each scroll share the next, the camera moving and the stop's pieces pressed", async ({
    page,
  }) => {
    const b = await live(page, 1440, 900);
    expect(b.stops).toBeGreaterThanOrEqual(6);
    expect(b.stops).toBeLessThanOrEqual(7);
    expect(b.tour.length).toBe(b.stops);
    const kicker = page.locator("[data-card-kicker]");
    const canvas = page.locator(".aa-engine-view canvas");
    await expect(kicker).toHaveText("How to read the machine");
    await page.waitForTimeout(600);
    let last = await canvas.screenshot();
    for (let k = 1; k <= b.stops; k++) {
      await scrollToY(page, atStop(b, k));
      await expect(kicker).toHaveText(new RegExp(`^Stop ${k} of ${b.stops}( · |$)`));
      const members = b.tour[k - 1]?.members ?? [];
      await expect(page.locator('[data-tag][aria-pressed="true"]')).toHaveCount(members.length);
      for (const m of members) await expect(page.locator(`[data-tag][data-id="${m}"]`)).toHaveAttribute("aria-pressed", "true");
      await page.waitForTimeout(700);
      const shot = await canvas.screenshot();
      expect(shot.equals(last), `stop ${k} moved the camera`).toBe(false);
      last = shot;
    }
    // A label pressed in the tour scrolls the page to its stop (waiting for the smooth scroll to land, not reading once).
    await scrollToY(page, atStop(b, 1));
    await expect(kicker).toHaveText(new RegExp(`^Stop 1 of ${b.stops}`));
    await page.locator('[data-tag][data-id="ingest"]').click();
    await expect(kicker).toHaveText(new RegExp(`^Stop ${stopOf(b, "ingest")} of ${b.stops}`), { timeout: 10_000 });
  });

  test("labels: none overlap at the start of the tour (1440×900, 1366×768, 390×844), and only the stop's neighbourhood is labelled", async ({
    page,
  }) => {
    for (const [w, h] of [
      [1440, 900],
      [1366, 768],
      [390, 844],
    ] as const) {
      const b = await live(page, w, h);
      // Waited for, not read once: the labels are placed on a drawn frame and fade over 200ms, so a read right after the
      // first frame can still see the previous layout.
      await expect.poll(async () => (await labelBoxes(page)).overlaps, { message: `${w}×${h} home overlaps`, timeout: 10_000 }).toEqual([]);
      await expect
        .poll(async () => (await labelBoxes(page)).ids.length, { message: `${w}×${h} home labels`, timeout: 10_000 })
        .toBeGreaterThanOrEqual(8);
      const home = await labelBoxes(page);
      expect(home.overlaps, `${w}×${h} home`).toEqual([]);
      for (const k of [1, stopOf(b, "verify")]) {
        await scrollToY(page, atStop(b, k));
        await settled(page, () => machineFrames(page), 600);
        await expect
          .poll(async () => (await labelBoxes(page)).overlaps, { message: `${w}×${h} stop ${k} overlaps`, timeout: 10_000 })
          .toEqual([]);
        const at = await labelBoxes(page);
        // The stop's pieces and their neighbours on the line, not the whole machine.
        expect(at.ids.length, `${w}×${h} stop ${k}`).toBeLessThanOrEqual(5);
      }
    }
  });

  test("explore: the hover hint, a click enters, a station click opens its panel, the wheel zooms (not the page), Esc returns to the stop", async ({
    page,
  }) => {
    const b = await live(page, 1440, 900);
    const root = page.locator("[data-machine]");
    const canvas = page.locator(".aa-engine-view canvas");
    const kicker = page.locator("[data-card-kicker]");
    const title = page.locator("[data-card-title]");
    const hint = page.locator(".aa-engine-hint");
    const k = stopOf(b, "analysis");
    await scrollToY(page, atStop(b, k));
    await expect(kicker).toHaveText(new RegExp(`^Stop ${k} of `));
    await page.waitForTimeout(1000);
    // In the tour the wheel scrolls the page, and the hint shows over the canvas only on hover.
    await expect.poll(() => hint.evaluate((e) => getComputedStyle(e).opacity)).toBe("0");
    await page.mouse.move(300, 450);
    await expect.poll(() => hint.evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
    await expect(hint).toHaveText("Click to explore");
    const y0 = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 120);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(y0);
    await scrollToY(page, atStop(b, k));
    await expect(kicker).toHaveText(new RegExp(`^Stop ${k} of `));
    await page.waitForTimeout(1000);

    // A click on a station (just under its label) enters explore with that station's panel open.
    const want = (await page.locator('.aa-stations li[data-station="analysis"] .aa-station-title').textContent()) ?? "?";
    const box = await page.locator('[data-tag][data-id="analysis"]').boundingBox();
    if (!box) throw new Error("no label");
    for (let dy = 20; dy <= 200; dy += 15) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height + dy);
      if ((await title.textContent()) === want) break;
    }
    await expect(root).toHaveAttribute("data-view", "explore");
    await expect(title).toHaveText(want);
    await expect(page.locator("[data-back]")).toBeVisible();
    await expect(page.locator("[data-announce]")).toContainText("Explore mode");
    await expect.poll(() => hint.evaluate((e) => getComputedStyle(e).opacity)).toBe("0");
    expect(await canvas.evaluate((c) => (c as HTMLElement).style.touchAction)).toBe("none");
    // The wheel zooms the machine and the page stays where it is.
    const y1 = await page.evaluate(() => scrollY);
    const before = await canvas.screenshot();
    await page.mouse.move(500, 500);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => scrollY)).toBe(y1);
    expect((await canvas.screenshot()).equals(before)).toBe(false);
    // A drag turns it, and the page still doesn't move.
    await page.mouse.move(500, 500);
    await page.mouse.down();
    await page.mouse.move(650, 520, { steps: 8 });
    await page.mouse.up();
    expect(await page.evaluate(() => scrollY)).toBe(y1);
    // axe is clean in explore too.
    const axe = await new AxeBuilder({ page }).include(".aa-engine").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);

    // Esc returns to the tour at the stop the scroll is on.
    await page.keyboard.press("Escape");
    await expect(root).toHaveAttribute("data-view", "tour");
    await expect(kicker).toHaveText(new RegExp(`^Stop ${k} of `));
    await expect(page.locator("[data-back]")).toBeHidden();
    await expect(page.locator("[data-announce]")).toContainText(`stop ${k} of`);
    expect(await canvas.evaluate((c) => (c as HTMLElement).style.touchAction)).toBe("pan-y");
  });

  test("explore: Back to tour and a click outside the canvas return to the tour stop of the scroll", async ({ page }) => {
    const b = await live(page, 1440, 900);
    const root = page.locator("[data-machine]");
    const kicker = page.locator("[data-card-kicker]");
    const k = stopOf(b, "verify");
    await scrollToY(page, atStop(b, k));
    await expect(kicker).toHaveText(new RegExp(`^Stop ${k} of `));
    // Back to tour (the button, from the keyboard too).
    await page.mouse.click(250, 820);
    await expect(root).toHaveAttribute("data-view", "explore");
    await expect(page.locator("[data-card-title]")).toHaveText(/./);
    await page.locator("[data-back]").focus();
    await page.keyboard.press("Enter");
    await expect(root).toHaveAttribute("data-view", "tour");
    await expect(kicker).toHaveText(new RegExp(`^Stop ${k} of `));
    // Focus goes back to the Explore button (hidden from sight on a desktop until it has the keyboard's focus), which
    // enters too.
    await expect(page.locator("[data-explore]")).toBeFocused();
    await expect(page.locator("[data-explore]")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(root).toHaveAttribute("data-view", "explore");
    await expect(page.locator("[data-back]")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(root).toHaveAttribute("data-view", "tour");

    // A click outside: with the band's start a third of the way down the screen, outside the canvas is the page above it.
    await scrollToY(page, b.top - 300);
    await page.waitForTimeout(500);
    await page.mouse.click(400, 700);
    await expect(root).toHaveAttribute("data-view", "explore");
    const outside = await page.evaluate(() => {
      for (let y = 20; y < 280; y += 20) {
        const el = document.elementFromPoint(20, y);
        if (el && !el.closest("a, button, [data-machine]")) return y;
      }
      return -1;
    });
    expect(outside).toBeGreaterThan(0);
    await page.mouse.click(20, outside);
    await expect(root).toHaveAttribute("data-view", "tour");
    await expect(kicker).toHaveText("How to read the machine");
  });

  test("phones: an Explore button (no hover hint), touch scrolls the page in the tour, Back to tour returns", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const b = await live(page, 390, 844);
    const root = page.locator("[data-machine]");
    const canvas = page.locator(".aa-engine-view canvas");
    const explore = page.locator("[data-explore]");
    await expect(explore).toBeVisible();
    await expect(explore).toHaveText("Explore");
    expect(await page.locator(".aa-engine-hint").evaluate((e) => getComputedStyle(e).opacity)).toBe("0");
    // The stage is the whole screen; in the tour a touch on the canvas scrolls the page.
    const r = await page.locator("[data-engine-stage]").evaluate((e) => e.getBoundingClientRect().toJSON() as DOMRect);
    expect([Math.round(r.top), Math.round(r.height)]).toEqual([0, 844]);
    expect(await canvas.evaluate((c) => (c as HTMLElement).style.touchAction)).toBe("pan-y");
    const cdp = await ctx.newCDPSession(page);
    /** A one-finger swipe up, as raw touch events (the browser decides what it scrolls). */
    const swipe = async (x: number, y: number) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - i * 25 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    for (const y of [400, 720]) {
      // On the canvas and on the card alike.
      await scrollToY(page, atStop(b, 1));
      await page.waitForTimeout(300);
      const y0 = await page.evaluate(() => scrollY);
      await swipe(195, y);
      await expect.poll(() => page.evaluate(() => scrollY), { message: `swipe at ${y}` }).toBeGreaterThan(y0 + 100);
    }
    await scrollToY(page, atStop(b, 2));
    await page.waitForTimeout(800);
    // Explore: the canvas takes the touch (rotate, pinch, two-finger pan), and Back to tour returns to the stop.
    await explore.tap();
    await expect(root).toHaveAttribute("data-view", "explore");
    await expect(page.locator("[data-back]")).toBeVisible();
    expect(await canvas.evaluate((c) => (c as HTMLElement).style.touchAction)).toBe("none");
    const y1 = await page.evaluate(() => scrollY);
    await swipe(195, 400);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => scrollY)).toBe(y1);
    // Chrome spends the first tap after a fast synthetic swipe on stopping its fling (no click), so the tap is retried
    // until it lands, rather than read once.
    await expect(async () => {
      await page.locator("[data-back]").tap({ timeout: 1000 });
      await expect(root).toHaveAttribute("data-view", "tour", { timeout: 700 });
    }).toPass({ timeout: 10_000 });
    await expect(page.locator("[data-card-kicker]")).toHaveText(/^Stop 2 of /);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
    await ctx.close();
  });

  test("the canvas draws the tokens: the page unshifted by colour management, green only on the verifier's gate", async ({ page }) => {
    await page.addInitScript(device, [8, 8]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(LANDING);
    const b = await band(page);
    await scrollToY(page, atStop(b, 0));
    await expect(page.locator("[data-machine]")).toHaveAttribute("data-gl", "on", { timeout: 20_000 });
    await page.waitForTimeout(600);
    const canvas = page.locator(".aa-engine-view canvas");
    const home = await canvas.screenshot({ animations: "disabled" });
    expect(await share(page, home, "--aa-page")).toBeGreaterThan(0.2);
    // At the verifier's stop its passed checks' lights are the verified token; at the doors there is no green at all.
    await scrollToY(page, atStop(b, stopOf(b, "verify")));
    await page.waitForTimeout(1500);
    expect(await share(page, await canvas.screenshot(), "--aa-verified")).toBeGreaterThan(0);
    await scrollToY(page, atStop(b, stopOf(b, "doors")));
    await page.waitForTimeout(1500);
    expect(await share(page, await canvas.screenshot(), "--aa-verified")).toBe(0);
  });

  test("reduced motion: the still frame with the station list, a short band, and three never loads", async ({ page }) => {
    await page.addInitScript(device, [8, 8]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(LANDING, { waitUntil: "networkidle" });
    await expect(page.locator("[data-machine]")).toHaveAttribute("data-mode", "still");
    expect((await band(page)).tall).toBe(false);
    await expect(page.locator(".aa-engine-list")).toHaveAttribute("open", "");
    await page.locator(".aa-engine-still img").scrollIntoViewIfNeeded();
    await expect(page.locator(".aa-engine-still img")).toBeVisible();
    await expect(page.locator("ol.aa-stations > li[data-station]")).toHaveCount(11);
    await expect(page.locator("[data-tag]").first()).toBeHidden();
    // No modes without the live view: no Explore button, no hint.
    await expect(page.locator("[data-explore]")).toBeHidden();
    await page.waitForTimeout(2500);
    expect(requests.filter((u) => CHUNK.test(u))).toEqual([]);
  });

  test("a weak device gets the still frame and the list, and three never loads", async ({ page }) => {
    await page.addInitScript(device, [2, 8]);
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(LANDING, { waitUntil: "networkidle" });
    await expect(page.locator("[data-machine]")).toHaveAttribute("data-mode", "still");
    await expect(page.locator(".aa-engine-list")).toHaveAttribute("open", "");
    await page.waitForTimeout(2500);
    expect(requests.filter((u) => CHUNK.test(u))).toEqual([]);
  });

  test("phones: the tall still, the lighter scene only once the band is near, tap to select, nothing scrolls sideways at 360", async ({
    page,
  }) => {
    await page.addInitScript(device, [8, 8]);
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    for (const width of [390, 360]) {
      requests.length = 0;
      await page.setViewportSize({ width, height: 800 });
      await page.goto(LANDING, { waitUntil: "networkidle" });
      await page.waitForTimeout(2500);
      // Not near yet (the band is under the stacked hero): nothing fetched.
      expect(
        requests.filter((u) => CHUNK.test(u)),
        `${width}`,
      ).toEqual([]);
      const b = await band(page);
      await scrollToY(page, atStop(b, 0));
      await expect(page.locator("[data-machine]")).toHaveAttribute("data-gl", "on", { timeout: 20_000 });
      expect(requests.some((u) => /machine-tall\.webp/.test(u))).toBe(true);
      expect(requests.some((u) => /machine-wide/.test(u))).toBe(false);
      // At the stop that shows Analysis its label is pressed; a tap in the tour (a phone has no click-to-explore) picks
      // the piece under it.
      await scrollToY(page, atStop(b, stopOf(b, "analysis")));
      await page.waitForTimeout(1200);
      await expect(page.locator('[data-tag][data-id="analysis"]')).toHaveAttribute("aria-pressed", "true");
      // A tap on another station (under its label, which sits above it) selects that one: its label and its card.
      const box = await page.locator('[data-tag][data-id="index"]').boundingBox();
      if (!box) throw new Error("no label");
      for (let dy = 20; dy <= 160; dy += 15) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height + dy);
        if ((await page.locator('[data-tag][data-id="index"]').getAttribute("aria-pressed")) === "true") break;
      }
      await expect(page.locator('[data-tag][data-id="index"]')).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("[data-card-title]")).toHaveText(
        (await page.locator('.aa-stations li[data-station="index"] .aa-station-title').textContent()) ?? "?",
      );
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${width}`).toBeLessThanOrEqual(0);
    }
  });

  test("without JS: the still frame and every station in the list, each linking its Learn page", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(LANDING);
    await expect(page.locator("[data-machine]")).not.toHaveAttribute("data-mode", /./);
    await expect(page.locator(".aa-engine-list")).toHaveAttribute("open", "");
    await page.locator(".aa-engine-still img").scrollIntoViewIfNeeded();
    await expect(page.locator(".aa-engine-still img")).toBeVisible();
    await expect(page.locator("[data-tag]").first()).toBeHidden();
    const stations = page.locator(".aa-stations li[data-station]");
    await expect(stations).toHaveCount(13);
    for (const li of await stations.all()) await expect(li.locator('a[href*="/learn/stages/"]').first()).toBeVisible();
    await ctx.close();
  });

  // Performance (DESIGN.md §7, "The engine machine draws on demand"): a laptop froze under the always-running loop, the
  // double context and the 5-million-pixel canvas. These check the rules that fixed it; the numbers come from
  // scripts/site/perf/machine-perf.ts.
  type Counted = { __gl: number; __raf: number };
  const count = () => {
    const w = window as unknown as Counted;
    w.__gl = 0;
    w.__raf = 0;
    const get = HTMLCanvasElement.prototype.getContext as (...a: unknown[]) => unknown;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      const c = get.call(this, kind, ...rest);
      if (c && /webgl/.test(kind)) w.__gl++;
      return c;
    } as typeof HTMLCanvasElement.prototype.getContext;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      w.__raf++;
      return raf(cb);
    };
  };
  const machineFrames = (page: import("@playwright/test").Page) =>
    page.locator(".aa-engine-canvas").evaluate((c) => (c as HTMLCanvasElement & { aaFrames?: number }).aaFrames ?? -1);
  const netFrames = (page: import("@playwright/test").Page) =>
    page.locator(".aa-hero-field .aa-hf-net").evaluate((c) => (c as HTMLCanvasElement & { aaFrames?: number }).aaFrames ?? 0);
  /** Waits until `read` stops changing for `quiet` ms. */
  const settled = async (page: import("@playwright/test").Page, read: () => Promise<number>, quiet = 1200) => {
    await expect
      .poll(
        async () => {
          const a = await read();
          await page.waitForTimeout(quiet);
          return (await read()) - a;
        },
        { timeout: 30_000, intervals: [0] },
      )
      .toBe(0);
  };

  test("one WebGL context for the page's life: tour, explore, tour and resizes never make another", async ({ page }) => {
    await page.addInitScript(count);
    const b = await live(page, 1440, 900);
    const contexts = () => page.evaluate(() => (window as unknown as Counted).__gl);
    expect(await contexts(), "after the first frame").toBe(1);
    const root = page.locator("[data-machine]");
    for (const k of [1, b.stops, 2]) {
      await scrollToY(page, atStop(b, k));
      await settled(page, () => machineFrames(page), 600);
    }
    await page.mouse.click(720, 700);
    await expect(root).toHaveAttribute("data-view", "explore");
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, -200);
    await page.keyboard.press("Escape");
    await expect(root).toHaveAttribute("data-view", "tour");
    for (const [w, h] of [
      [1100, 800],
      [1440, 900],
      [1280, 720],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      await settled(page, () => machineFrames(page), 600);
    }
    await page.mouse.click(600, 600);
    await expect(root).toHaveAttribute("data-view", "explore");
    await page.locator("[data-back]").click();
    await expect(root).toHaveAttribute("data-view", "tour");
    expect(await contexts(), "after tour, explore, tour and three resizes").toBe(1);
    expect(await page.locator("canvas.aa-engine-canvas").count()).toBe(1);
  });

  test("it draws on demand: no frame and no animation-frame loop while nothing changes, none off screen or in a hidden tab", async ({
    page,
  }) => {
    await page.addInitScript(count);
    const b = await live(page, 1440, 900);
    const raf = () => page.evaluate(() => (window as unknown as Counted).__raf);
    await scrollToY(page, atStop(b, 2));
    // The camera eases to the stop, and the slow drift runs a few seconds after the last scroll; then nothing is drawn.
    await settled(page, () => machineFrames(page), 6000);
    const idle = await machineFrames(page);
    const r0 = await raf();
    await page.waitForTimeout(3000);
    expect(await machineFrames(page), "frames drawn in 3 s of nothing").toBe(idle);
    expect((await raf()) - r0, "animation-frame callbacks in 3 s of nothing").toBe(0);
    expect(idle, "it did draw before").toBeGreaterThan(0);
    // A scroll draws again (the camera moves), then it rests again.
    await scrollToY(page, atStop(b, 4));
    await expect.poll(() => machineFrames(page)).toBeGreaterThan(idle);
    await settled(page, () => machineFrames(page), 6000);
    // Off screen (the hero): no frame.
    await scrollToY(page, 0);
    await page.waitForTimeout(800);
    const away = await machineFrames(page);
    await page.waitForTimeout(1200);
    expect(await machineFrames(page), "frames drawn while the band is off screen").toBe(away);
    // A hidden tab: back at a stop, the camera moves, but a hidden tab draws nothing.
    await scrollToY(page, atStop(b, 3));
    await settled(page, () => machineFrames(page), 6000);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await scrollToY(page, atStop(b, 5));
    await page.waitForTimeout(500);
    const hidden = await machineFrames(page);
    await page.waitForTimeout(1000);
    expect(await machineFrames(page), "frames drawn in a hidden tab").toBe(hidden);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => machineFrames(page)).toBeGreaterThan(hidden);
  });

  test("the hero's net and the machine never animate together", async ({ page }) => {
    const b = await live(page, 1440, 900);
    const NETSEL = ".aa-hero-field .aa-hf-net";
    const state = () => page.locator(NETSEL).getAttribute("data-state");
    const on = () => page.evaluate(() => document.documentElement.hasAttribute("data-aa-machine"));
    // The hero: the net runs, the machine rests.
    await scrollToY(page, 0);
    await expect.poll(state, { timeout: 15_000 }).toBe("running");
    expect(await on()).toBe(false);
    await settled(page, () => machineFrames(page), 600);
    // The band: the machine is live, the net rests and draws nothing.
    await scrollToY(page, atStop(b, 2));
    await expect.poll(on).toBe(true);
    await expect.poll(state).toBe("paused");
    await page.waitForTimeout(300);
    const net = await netFrames(page);
    await page.waitForTimeout(900);
    expect(await netFrames(page), "net frames while the machine is on screen").toBe(net);
    // At every step of a slow scroll through the release of the hero into the band, the two are never both live.
    await scrollToY(page, 0);
    await expect.poll(state).toBe("running");
    let both = 0;
    const from = b.top - 900;
    for (let y = from; y <= b.top + 200; y += 60) {
      await scrollToY(page, y);
      await page.waitForTimeout(40);
      const [isOn, st] = [await on(), await state()];
      if (isOn && st === "running") both++;
    }
    expect(both, "samples with the machine on and the net running").toBe(0);
    // Back to the hero: the net runs again.
    await scrollToY(page, 0);
    await expect.poll(state).toBe("running");
    expect(await on()).toBe(false);
  });
});
