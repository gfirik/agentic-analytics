// The hero exhibit (apps/docs/DESIGN.md §5, §6): the verification replays once, the walkthrough pins and steps at
// desktop sizes and is a tap list on phones, figures open margin notes, reduced motion is static, and the hero's
// proof chips, type and glow hold.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { BASE, LANDING } from "./helpers.ts";

test("hero: the verification replays once, figure by figure, within 2.5 s", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(LANDING);
  const wrap = page.locator("[data-exhibit]");
  // Site v4: the exhibit is the hero's right column, its report page's top above the bottom sixth of the first screen at
  // 1440 × 900, so it verifies (timed) on load, with no scroll (DESIGN.md §5, §6).
  expect(await page.locator(".aa-exhibit-page").evaluate((e) => e.getBoundingClientRect().top)).toBeLessThan((900 * 5) / 6);
  const chips = page.locator(".aa-exhibit a.aa-chip");
  const n = await chips.count();
  expect(n).toBeGreaterThan(5);
  expect(n).toBeLessThanOrEqual(10);
  await expect(wrap).toHaveAttribute("data-anim", "pending");
  await expect(wrap).toHaveAttribute("data-walk", "pin");
  // Mid-replay, some figures are verified and some not yet.
  await expect(page.locator(".aa-exhibit a.aa-chip.is-verified")).not.toHaveCount(0);
  await expect(wrap).toHaveAttribute("data-anim", "done", { timeout: 3_500 });
  await expect(page.locator(".aa-exhibit a.aa-chip.is-verified")).toHaveCount(n);
});

/** Site v5 PR 2: the step shown in the walkthrough's bar (0 is the verification, 1..n the steps). */
const shownStep = (page: import("@playwright/test").Page) =>
  page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".aa-walk-cap")].findIndex((c) => !c.hidden));
/** Scrolls the window to y and waits for the scroll to land (instant, so a test never races smooth scrolling). */
const jumpTo = (page: import("@playwright/test").Page, y: number) =>
  page.evaluate((v) => {
    window.scrollTo({ top: v, behavior: "instant" });
  }, y);

test("hero: at 1440 the exhibit pins and each scroll step opens the next figure's note, with a progress rule; then it releases into the engine machine", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const wrap = page.locator("[data-exhibit]");
  await expect(wrap).toHaveAttribute("data-walk", "pin");
  const steps = JSON.parse((await wrap.getAttribute("data-steps")) ?? "[]") as string[];
  expect(steps.length).toBeGreaterThanOrEqual(3);
  expect(steps.length).toBeLessThanOrEqual(4);
  const open = page.locator(".aa-note.is-open");
  // No timer and no step controls (prev, next, Pause, Replay): nothing advances by itself, only the scroll moves it.
  await expect(page.locator(".aa-hero-exhibit button:not(.aa-copy-btn)")).toHaveCount(0);
  await expect(wrap).toHaveAttribute("data-anim", "done", { timeout: 4_000 });
  await page.waitForTimeout(5_000);
  expect(await shownStep(page)).toBe(0);
  // The margin is never empty: step 1's note is open before the first step.
  await expect(open).toHaveCount(1);
  await expect(open).toHaveAttribute("id", `aa-note-${steps[0]}`);
  // The whole hero row (statement and exhibit) is one sticky unit, a screen tall; one sentinel per step in the track.
  const row = page.locator(".aa-hero-row");
  const stage = page.locator(".aa-hero-exhibit");
  const statement = page.locator(".aa-statement");
  expect(await row.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
  expect(await row.evaluate((el) => Math.round(el.getBoundingClientRect().height))).toBeGreaterThanOrEqual(900);
  await expect(page.locator("[data-walk-sentinel]")).toHaveCount(steps.length);
  // Pinned: the row's top at the screen's top; the exhibit and the statement where they were at step 1.
  await jumpTo(
    page,
    (await page.locator('[data-walk-sentinel="1"]').evaluate((el) => el.getBoundingClientRect().top + window.scrollY)) - 900 * 0.65 + 40,
  );
  await expect.poll(() => shownStep(page), { timeout: 3_000 }).toBe(1);
  expect(Math.round(await row.evaluate((el) => el.getBoundingClientRect().top))).toBe(0);
  const pinTop = Math.round(await stage.evaluate((el) => el.getBoundingClientRect().top));
  const statementTop = Math.round(await statement.evaluate((el) => el.getBoundingClientRect().top));
  // Everything in the hero is on screen while pinned: the install line and the exhibit's caption.
  for (const sel of [".aa-hero-cmd-frame", ".aa-exhibit-caption", ".aa-hero-title"])
    expect(await page.locator(sel).evaluate((el) => el.getBoundingClientRect().bottom), sel).toBeLessThanOrEqual(900);
  // Each step: scroll until the step's sentinel crosses the line 65% down the screen; the exhibit stays put.
  const sentinelY = (k: number) =>
    page.locator(`[data-walk-sentinel="${k}"]`).evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  const progress = () => page.locator(".aa-walk-progress > i").evaluate((el) => el.getBoundingClientRect().width);
  let lastProgress = await progress();
  for (let k = 1; k <= steps.length; k++) {
    await jumpTo(page, (await sentinelY(k)) - 900 * 0.65 + 40);
    await expect.poll(() => shownStep(page), { timeout: 3_000 }).toBe(k);
    expect(Math.round(await stage.evaluate((el) => el.getBoundingClientRect().top)), `step ${k} exhibit pinned`).toBe(pinTop);
    expect(Math.round(await statement.evaluate((el) => el.getBoundingClientRect().top)), `step ${k} statement pinned`).toBe(statementTop);
    await expect(page.locator(`.aa-walk-cap[data-step="${k}"]`)).toContainText(`${k}/${steps.length}`);
    await expect(open).toHaveCount(1);
    await expect(open).toHaveAttribute("id", `aa-note-${steps[k - 1]}`);
    const chip = page.locator(`.aa-exhibit a.aa-chip[data-note="${steps[k - 1]}"]`);
    await expect(chip).toHaveAttribute("aria-expanded", "true");
    await expect(chip).toHaveAttribute("aria-current", "step");
    await expect(page.locator('.aa-exhibit a.aa-chip[aria-current="step"]')).toHaveCount(1);
    await expect(page.locator(".aa-walk-dot.is-on")).toHaveCount(k);
    // The open note is inside the screen, beside the report page.
    const b = await open.boundingBox();
    expect((b?.y ?? 0) + (b?.height ?? 0), `step ${k} note on screen`).toBeLessThanOrEqual(900);
    const p = await progress();
    // (Step 1 is where the pin check above already left the page.)
    if (k > 1) expect(p, `step ${k} progress grows`).toBeGreaterThan(lastProgress);
    else expect(p, "step 1 progress has started").toBeGreaterThan(0);
    lastProgress = p;
    if (k === 2) {
      // The change's SQL input: its SQL (open beside the exhibit) and the sheet rows it read.
      await expect(open.locator(".aa-note-sql")).toBeVisible();
      await expect(open.locator(".aa-note-sql")).toContainText("FROM");
      await expect(open.locator("tr.is-cited")).not.toHaveCount(0);
    }
  }
  // At the last step the rule is full.
  const bar = await page.locator(".aa-walk-progress").evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.abs(lastProgress - bar)).toBeLessThan(2);
  // Scrolling back steps back.
  await jumpTo(page, (await sentinelY(2)) - 900 * 0.65 + 40);
  await expect.poll(() => shownStep(page), { timeout: 3_000 }).toBe(2);
  // Exploring mid-walkthrough: hovering another figure opens its note; leaving returns to the step's note.
  await page.locator('.aa-exhibit a.aa-chip[data-note="N12"]').hover();
  await expect(page.locator("#aa-note-N12")).toHaveClass(/is-open/);
  await page.mouse.move(5, 5);
  await expect(open).toHaveAttribute("id", `aa-note-${steps[1]}`);
  // Past the track the whole hero releases straight into the engine machine's band: the row scrolls away together and
  // the band's top follows its bottom edge directly, with no empty block between them.
  const engine = page.locator("#engine");
  await jumpTo(page, (await sentinelY(steps.length)) + 900);
  expect(await stage.evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(pinTop);
  expect(await statement.evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(statementTop);
  await expect.poll(() => shownStep(page), { timeout: 3_000 }).toBe(steps.length);
  const [rowBottom, engineTop, captionBottom] = await Promise.all([
    row.evaluate((el) => el.getBoundingClientRect().bottom),
    engine.evaluate((el) => el.getBoundingClientRect().top),
    page.locator(".aa-exhibit-caption").evaluate((el) => el.getBoundingClientRect().bottom),
  ]);
  expect(engineTop).toBeLessThan(900);
  expect(Math.abs(engineTop - rowBottom), "the band starts where the hero ends").toBeLessThanOrEqual(2);
  expect(engineTop - captionBottom, "no large empty block under the hero").toBeLessThan(160);
});

test("hero: on laptop screens the whole hero still pins and steps (1280×720, 1366×768, 1536×730); under 680px of height it is the tap list", async ({
  browser,
}) => {
  for (const [width, height] of [
    [1280, 720],
    [1366, 768],
    [1536, 730],
  ] as const) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    await page.goto(LANDING, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const wrap = page.locator("[data-exhibit]");
    await expect(wrap, `${width}×${height}`).toHaveAttribute("data-walk", "pin");
    const steps = JSON.parse((await wrap.getAttribute("data-steps")) ?? "[]") as string[];
    const row = page.locator(".aa-hero-row");
    expect(await row.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
    for (let k = 1; k <= steps.length; k++) {
      const y = await page
        .locator(`[data-walk-sentinel="${k}"]`)
        .evaluate((el, h) => el.getBoundingClientRect().top + window.scrollY - h * 0.65 + 40, height);
      await jumpTo(page, y);
      await expect.poll(() => shownStep(page), { timeout: 3_000 }).toBe(k);
      expect(Math.round(await row.evaluate((el) => el.getBoundingClientRect().top)), `${width}×${height} step ${k} pinned`).toBe(0);
      await expect(page.locator(".aa-note.is-open")).toHaveAttribute("id", `aa-note-${steps[k - 1]}`);
      // Everything that matters is on the short screen: the headline, the install line, the step bar, the report
      // page's last line and the open note.
      for (const sel of [".aa-hero-title", ".aa-hero-cmd-frame", ".aa-walk-bar", ".aa-exhibit-foot", ".aa-note.is-open"]) {
        const r = await page.locator(sel).evaluate((el) => {
          const b = el.getBoundingClientRect();
          return { top: b.top, bottom: b.bottom };
        });
        expect(r.top, `${width}×${height} step ${k}: ${sel}`).toBeGreaterThanOrEqual(0);
        expect(r.bottom, `${width}×${height} step ${k}: ${sel}`).toBeLessThanOrEqual(height);
      }
    }
    await ctx.close();
  }
  // Below 680px of viewport height the hero doesn't pin: the steps are the tap list.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 660 } });
  const page = await ctx.newPage();
  await page.goto(LANDING, { waitUntil: "networkidle" });
  await expect(page.locator("[data-exhibit]")).toHaveAttribute("data-walk", "tap");
  expect(await page.locator(".aa-hero-row").evaluate((el) => getComputedStyle(el).position)).not.toBe("sticky");
  await expect(page.locator(".aa-walk-list details")).not.toHaveCount(0);
  await ctx.close();
});

test("hero: keyboard scrolling (Page Down, Space) steps the pinned walkthrough, announced; no step control exists", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  const wrap = page.locator("[data-exhibit]");
  await expect(wrap).toHaveAttribute("data-walk", "pin");
  const steps = JSON.parse((await wrap.getAttribute("data-steps")) ?? "[]") as string[];
  // No controls of its own: no buttons, no focusable group, no key handler to learn.
  await expect(
    page.locator(".aa-hero-exhibit button:not(.aa-copy-btn), [data-walk-prev], [data-walk-next], [data-walk-pause], [data-walk-replay]"),
  ).toHaveCount(0);
  await expect(page.locator(".aa-walk-body")).not.toHaveAttribute("tabindex", /.*/);
  // The step is announced politely, and the step's chip says it is current.
  const status = page.locator(".aa-walk-status");
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status).not.toHaveAttribute("aria-busy", /.*/);
  // The page's own keyboard scrolling drives it: Page Down and Space from the top reach every step, in order.
  await page.locator("h1").click();
  const seen: number[] = [];
  for (let i = 0; i < 12 && (seen.at(-1) ?? 0) < steps.length; i++) {
    await page.keyboard.press(i % 2 ? "Space" : "PageDown");
    await page.waitForTimeout(700);
    const k = await shownStep(page);
    if (k !== (seen.at(-1) ?? 0)) seen.push(k);
  }
  expect(seen.at(-1), "the last step is reached").toBe(steps.length);
  for (let i = 1; i < seen.length; i++) expect(seen[i] ?? 0).toBeGreaterThan(seen[i - 1] ?? 0);
  await expect(status).toContainText(`${steps.length}/${steps.length}`);
  await expect(page.locator(`.aa-exhibit a.aa-chip[data-note="${steps[steps.length - 1]}"]`)).toHaveAttribute("aria-current", "step");
  // Page Up goes back. The press that reached the last step can land up to a screen past it (into the engine machine's
  // band since #92, where three may be starting), so one Page Up isn't always back over step 4's line: press until it is.
  await expect(async () => {
    await page.keyboard.press("PageUp");
    await expect.poll(() => shownStep(page), { timeout: 1_500 }).toBeLessThan(steps.length);
  }).toPass({ timeout: 10_000 });
  // Every figure stays reachable by Tab, and focusing one opens its note.
  await page.locator('.aa-exhibit a.aa-chip[data-note="N12"]').focus();
  await expect(page.locator("#aa-note-N12")).toHaveClass(/is-open/);
});

test("chips and the SQL toggle are at least 24 px tall to tap or click, and the hit box reaches above and below the chip", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const reach = (sel: string) =>
    page
      .locator(sel)
      .first()
      .evaluate((el) => {
        // Mid-screen, so every probed point is inside the viewport (elementFromPoint returns nothing outside it).
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const hit = (y: number) => {
          const at = document.elementFromPoint(x, y);
          return at === el || el.contains(at);
        };
        // The tallest run of points that land on the element, in 0.5px steps through a 40px band around it.
        let best = 0;
        let run = 0;
        for (let y = r.top - 20; y <= r.bottom + 20; y += 0.5) {
          run = hit(y) ? run + 0.5 : 0;
          best = Math.max(best, run);
        }
        return { height: best, above: hit(r.top - 4), below: hit(r.bottom + 4) };
      });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  for (let k = 0; k < (await page.locator(".aa-exhibit a.aa-chip").count()); k++) {
    const r = await reach(`.aa-exhibit a.aa-chip >> nth=${k}`);
    expect(r.height, `exhibit chip ${k}`).toBeGreaterThanOrEqual(24);
    expect(r.above && r.below, `exhibit chip ${k}`).toBe(true);
  }
  await page.goto(`${BASE}/learn/stages/analysis/`, { waitUntil: "networkidle" });
  const learn = await reach(".sl-markdown-content p a.aa-chip");
  expect(learn.height).toBeGreaterThanOrEqual(24);
  expect(learn.above && learn.below).toBe(true);
  // The SQL toggle under 900 px.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  const id = JSON.parse((await page.locator("[data-exhibit]").getAttribute("data-steps")) ?? "[]")[1] as string;
  await page.locator(`.aa-exhibit a.aa-chip[data-note="${id}"]`).click();
  const summary = page.locator(`#aa-note-${id} details[data-fold] > summary`);
  await summary.scrollIntoViewIfNeeded();
  expect((await summary.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(24);
  await summary.click();
  await expect(page.locator(`#aa-note-${id} details[data-fold]`)).toHaveAttribute("open", "");
  await expect(summary).toContainText("hide");
});

test("hero: stepping through the walkthrough never moves the page below it (1440)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const steps = JSON.parse((await page.locator("[data-exhibit]").getAttribute("data-steps")) ?? "[]") as string[];
  const below = () => page.locator("#engine").evaluate((el) => Math.round(el.getBoundingClientRect().top + window.scrollY));
  const y = await below();
  const at = (k: number) =>
    page
      .locator(`[data-walk-sentinel="${k}"]`)
      .evaluate((el) => el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.65 + 40);
  for (const k of [...steps.keys()].map((i) => i + 1).concat([1])) {
    await jumpTo(page, await at(k));
    await expect(page.locator(`.aa-walk-cap[data-step="${k}"]`)).toBeVisible();
    expect(await below(), `step ${k}`).toBe(y);
  }
});

test("hero: on a landscape phone (667 × 375) the figures still verify as the exhibit comes into view", async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await page.goto(LANDING);
  await page.locator(".aa-exhibit-page").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await expect(page.locator("[data-exhibit]")).toHaveAttribute("data-anim", "done", { timeout: 4_000 });
  await expect(page.locator(".aa-exhibit a.aa-chip.is-verified")).toHaveCount(await page.locator(".aa-exhibit a.aa-chip").count());
});

test("hero: under 900 px nothing is pinned; the steps stack as a list and each opens on tap", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  const wrap = page.locator("[data-exhibit]");
  await expect(wrap).toHaveAttribute("data-walk", "tap");
  const steps = JSON.parse((await wrap.getAttribute("data-steps")) ?? "[]") as string[];
  // No pin, no track, no step bar.
  expect(await page.locator(".aa-hero-row").evaluate((el) => getComputedStyle(el).position)).not.toBe("sticky");
  await expect(page.locator(".aa-hero-track")).toBeHidden();
  await expect(page.locator(".aa-walk-bar")).toBeHidden();
  // The figures still verify as the exhibit comes into view.
  await page.locator(".aa-exhibit-page").scrollIntoViewIfNeeded();
  await expect(wrap).toHaveAttribute("data-anim", "done", { timeout: 4_000 });
  // The list: one item per step, step 1 open, the rest closed until tapped.
  const items = page.locator(".aa-walk-list details");
  await expect(items).toHaveCount(steps.length);
  await expect(items.nth(0)).toHaveAttribute("open", "");
  for (let k = 1; k < steps.length; k++) await expect(items.nth(k)).not.toHaveAttribute("open", /.*/);
  await expect(items.nth(1).locator(".aa-walk-item-note")).toBeHidden();
  const head = items.nth(1).locator("summary");
  await head.scrollIntoViewIfNeeded();
  // A full-width tap target, at least 44 px tall.
  expect((await head.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await head.click();
  await expect(items.nth(1)).toHaveAttribute("open", "");
  await expect(items.nth(1).locator(".aa-note-sql")).toContainText("FROM");
  await head.click();
  await expect(items.nth(1)).not.toHaveAttribute("open", /.*/);
  // Scrolling past it changes nothing: no step is driven by the scroll here.
  await page.mouse.wheel(0, 1500);
  await page.waitForTimeout(400);
  await expect(page.locator(".aa-note.is-open")).toHaveCount(0);
  // The caption reads as one line of text in its row, not split into columns.
  const parts = await items
    .nth(2)
    .locator("summary")
    .evaluate((el) => el.children.length);
  expect(parts).toBe(1);
});

test("hero: with reduced motion the walkthrough is a static ruled list, every step's note shown, nothing pinned", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  const steps = JSON.parse((await page.locator("[data-exhibit]").getAttribute("data-steps")) ?? "[]") as string[];
  await expect(page.locator("[data-exhibit]")).not.toHaveAttribute("data-walk", /.*/);
  await expect(page.locator(".aa-walk-bar")).toBeHidden();
  await expect(page.locator(".aa-hero-track")).toBeHidden();
  expect(await page.locator(".aa-hero-row").evaluate((el) => getComputedStyle(el).position)).not.toBe("sticky");
  for (const d of await page.locator(".aa-walk-list details").all()) await expect(d).toHaveAttribute("open", "");
  const items = page.locator(".aa-walk-list > li");
  await expect(items).toHaveCount(steps.length);
  await expect(items.nth(0)).toBeVisible();
  await expect(items.nth(1).locator(".aa-note-sql")).toContainText("FROM");
});

test("hero: reduced motion shows the verified state at once, with no replay", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  await expect(page.locator("[data-exhibit]")).not.toHaveAttribute("data-anim", /.*/);
  await expect(page.locator(".aa-exhibit a.aa-chip .aa-check").first()).toBeVisible();
  expect(
    await page
      .locator(".aa-exhibit a.aa-chip .aa-check")
      .first()
      .evaluate((el) => getComputedStyle(el).opacity),
  ).toBe("1");
});

test("hero: hovering a figure opens its margin note (SQL and cited rows); Escape closes it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  const chip = page.locator('.aa-exhibit a.aa-chip[data-note="N12"]');
  await chip.hover();
  const note = page.locator("#aa-note-N12");
  await expect(note).toBeVisible();
  await expect(chip).toHaveAttribute("aria-expanded", "true");
  await expect(note.locator(".aa-note-sql")).toContainText("FROM");
  await expect(note.locator("tr.is-cited")).not.toHaveCount(0);
  await expect(page.locator(".aa-leader")).toBeVisible();
  // Beside the exhibit, level with its figure.
  const [c, b, e] = await Promise.all([chip.boundingBox(), note.boundingBox(), page.locator(".aa-exhibit").boundingBox()]);
  expect(b && e && b.x).toBeGreaterThanOrEqual((e?.x ?? 0) + (e?.width ?? 0));
  expect(Math.abs((b?.y ?? 0) - (c?.y ?? 0))).toBeLessThan(24);
  await page.keyboard.press("Escape");
  await expect(note).toBeHidden();
  // Keyboard: focus opens it too; a function fact shows its inputs.
  await page.locator('.aa-exhibit a.aa-chip[data-note="N30"]').focus();
  await expect(page.locator("#aa-note-N30")).toContainText("pct_change");
});

test("hero: under 900 px the margin note opens below the exhibit, on tap", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(LANDING, { waitUntil: "networkidle" });
  await page.locator('.aa-exhibit a.aa-chip[data-note="N12"]').click();
  const note = page.locator("#aa-note-N12");
  await expect(note).toBeVisible();
  const [b, e] = await Promise.all([note.boundingBox(), page.locator(".aa-exhibit").boundingBox()]);
  expect(b?.y ?? 0).toBeGreaterThan((e?.y ?? 0) + (e?.height ?? 0) - 1);
});

test("hero proof chips: every figure is the generated data's, cross-checked against the runs it names (site v5 PR 1b)", async ({
  page,
}) => {
  const DATA = join(import.meta.dirname, "../../../apps/docs/src/data");
  const evals = JSON.parse(readFileSync(join(DATA, "evals.json"), "utf8")) as {
    proof: { id: string; figure: string; text: string; href: string; source: string }[];
    real: { file: string; datasets: { checks: { pass: boolean }[] }[] };
    smoke: { file: string; bars: { metric: string; value: number | null }[] };
  };
  const pipeline = JSON.parse(readFileSync(join(import.meta.dirname, "../../../docs/assets/readme/pipeline.json"), "utf8")) as {
    checks: { check: string }[];
  };
  // The figures, recomputed here from the runs themselves rather than read back from the chips' own data.
  const checks = evals.real.datasets.flatMap((d) => d.checks);
  const mismatches = evals.smoke.bars.find((b) => b.metric === "Number mismatches")?.value;
  const expected: Record<string, { figure: string; href: string; source: RegExp }> = {
    real: { figure: `${checks.filter((c) => c.pass).length}/${checks.length}`, href: "#results", source: new RegExp(evals.real.file) },
    numbers: { figure: String(mismatches), href: "#results", source: new RegExp(evals.smoke.file) },
    verifier: { figure: `V1–V${pipeline.checks.length}`, href: `${BASE}/how-it-works/verifier/`, source: /checks on every report/ },
    local: { figure: "", href: `${BASE}/models/running-free/`, source: /ollama:.*transformers:/ },
  };
  expect(evals.proof.map((c) => c.id)).toEqual(["real", "numbers", "verifier", "local"]);
  await page.goto(LANDING);
  const chips = page.locator(".aa-hero-proof .aa-pchip");
  await expect(chips).toHaveCount(4);
  for (const [i, c] of evals.proof.entries()) {
    const want = expected[c.id] as (typeof expected)[string];
    const chip = chips.nth(i);
    expect(c.figure, c.id).toBe(want.figure);
    await expect(chip).toHaveAttribute("data-proof", c.id);
    await expect(chip).toHaveAttribute("href", want.href);
    await expect(chip).toHaveAttribute("title", want.source);
    // What the chip shows is the figure and the text, nothing typed beside them; its source is read after it.
    await expect(chip.locator(".aa-pchip-text")).toHaveText(c.text);
    if (want.figure) await expect(chip.locator(".aa-pchip-figure")).toHaveText(want.figure);
    else await expect(chip.locator(".aa-pchip-figure")).toHaveCount(0);
    await expect(chip.locator("svg")).toHaveCount(1);
  }
  // The real-data figure is the status strip's figure, the same run.
  await expect(page.locator(".aa-strip")).toContainText(`real public data: ${expected.real?.figure} checks`);
});

test("hero type and spacing at 390 and 360: the eyebrow on one line, each headline voice on one line, a full gap above the exhibit", async ({
  browser,
}) => {
  for (const width of [390, 360]) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(LANDING, { waitUntil: "networkidle" });
    const lines = await page.evaluate(() => {
      const one = (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement;
        const lh = Number.parseFloat(getComputedStyle(el).lineHeight) || Number.parseFloat(getComputedStyle(el).fontSize) * 1.2;
        return Math.round(el.getBoundingClientRect().height / lh);
      };
      return { eyebrow: one(".aa-hero-eyebrow"), sans: one(".aa-hero-title-sans"), serif: one(".aa-hero-title-serif") };
    });
    expect(lines.eyebrow, `${width}: eyebrow`).toBeLessThanOrEqual(2); // one line in a padded tag
    expect(await page.locator(".aa-hero-eyebrow").evaluate((el) => el.getClientRects().length)).toBe(1);
    expect(lines.sans, `${width}: sans voice`).toBe(1);
    expect(lines.serif, `${width}: serif voice`).toBe(1);
    const eyebrowH = await page.locator(".aa-hero-eyebrow").evaluate((el) => el.getBoundingClientRect().height);
    expect(eyebrowH, `${width}: the eyebrow tag is one line tall`).toBeLessThan(32);
    // No pause control (site v5 PR 2, the maintainer's call): a full row gap (at least 32px) from the install line to the
    // exhibit's label.
    await expect(page.locator("[data-hf-toggle], .aa-hero button:not(.aa-copy-btn)")).toHaveCount(0);
    const gap = await page.evaluate(() => {
      const t = (document.querySelector(".aa-hero-cmd-frame") as HTMLElement).getBoundingClientRect();
      const l = (document.querySelector(".aa-exhibit-label") as HTMLElement).getBoundingClientRect();
      return l.top - t.bottom;
    });
    expect(gap, `${width}: install line to the exhibit's label`).toBeGreaterThanOrEqual(32);
    await ctx.close();
  }
});

test("hero glow: the lead and headline keep AA over the accent at its strongest behind them (1440, 1100, 390)", async ({ browser }) => {
  for (const [width, height] of [
    [1440, 900],
    [1100, 800],
    [390, 844],
  ] as const) {
    const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto(LANDING, { waitUntil: "networkidle" });
    const colours = await page.evaluate(() => ({
      lead: getComputedStyle(document.querySelector(".aa-statement > .aa-lead") as Element).color,
      title: getComputedStyle(document.querySelector(".aa-hero-title") as Element).color,
    }));
    // Only the glow behind the text: the text made transparent, the paper's 1px lines and the grain hidden (they are
    // the page's existing graph paper, not this background), then the darkest pixel under each block is read.
    await page.addStyleTag({
      content:
        ".aa-statement *{color:transparent!important;text-decoration-color:transparent!important} .aa-hf-grid,.aa-hf-grain,.aa-hf-net{display:none!important}",
    });
    await page.waitForTimeout(200);
    const png = (await page.screenshot()).toString("base64");
    const ratios = await page.evaluate(
      async ({ png, colours }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${png}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext("2d") as CanvasRenderingContext2D;
        g.drawImage(img, 0, 0);
        const lin = (v: number) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        };
        const lum = (r: number, gr: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(gr) + 0.0722 * lin(b);
        const of = (css: string) => {
          const [r, gr, b] = (css.match(/\d+/g) ?? []).map(Number) as [number, number, number];
          return lum(r, gr, b);
        };
        const ratio = (sel: string, fg: string) => {
          const r = (document.querySelector(sel) as Element).getBoundingClientRect();
          const d = g.getImageData(
            Math.max(0, r.x),
            Math.max(0, r.y),
            Math.min(r.width, c.width - r.x),
            Math.min(r.height, c.height - r.y),
          ).data;
          let min = 1;
          for (let i = 0; i < d.length; i += 4) min = Math.min(min, lum(d[i] as number, d[i + 1] as number, d[i + 2] as number));
          return (min + 0.05) / (of(fg) + 0.05);
        };
        return { lead: ratio(".aa-statement > .aa-lead", colours.lead), title: ratio(".aa-hero-title", colours.title) };
      },
      { png, colours },
    );
    expect(ratios.lead, `${width}: lead`).toBeGreaterThanOrEqual(4.5);
    expect(ratios.title, `${width}: headline`).toBeGreaterThanOrEqual(4.5);
    await ctx.close();
  }
});
