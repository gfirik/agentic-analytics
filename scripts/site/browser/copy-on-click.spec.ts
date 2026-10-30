// Copy on click (apps/docs/DESIGN.md §6): every code block's copy button copies exactly the runnable text.

import { expect, test } from "@playwright/test";
import { BASE, LANDING } from "./helpers.ts";

test.describe("copy on click (site v5 PR 3)", () => {
  const HERO = "git clone https://github.com/gfirik/agentic-analytics\ncd agentic-analytics && bun install";
  const STEP3 =
    "bun run aa analyze examples/coffee-roaster --open\n# no model yet? replay it offline\nAA_DEMO_MODEL=scripted bun run aa analyze examples/coffee-roaster --yes --embedder hash";
  const HTTP_API =
    "curl -F 'files[]=@examples/coffee-roaster/sales-2026.xlsx' -F 'files[]=@examples/coffee-roaster/email-0412.eml' -F 'options={\"currency\":\"USD\"}' http://127.0.0.1:8080/v1/jobs\n" +
    "curl -N http://127.0.0.1:8080/v1/jobs/<job_id>/events      # live progress (SSE)\n" +
    "curl http://127.0.0.1:8080/v1/jobs/<job_id>/report?format=html > report.html";
  const LEARN = `${BASE}/learn/tutorials/first-file/`;

  async function copyContext(browser: import("@playwright/test").Browser, opts: { width?: number } = {}) {
    const ctx = await browser.newContext({
      viewport: { width: opts.width ?? 1440, height: 900 },
      reducedMotion: "reduce",
      permissions: ["clipboard-read", "clipboard-write"],
    });
    return { ctx, page: await ctx.newPage() };
  }
  const clipboard = (page: import("@playwright/test").Page) => page.evaluate(() => navigator.clipboard.readText());
  const reset = (page: import("@playwright/test").Page) => page.evaluate(() => navigator.clipboard.writeText("(unchanged)"));

  test("the button copies exactly the runnable text: hero, §4 with continuations, a docs page and a Learn page", async ({ browser }) => {
    const { ctx, page } = await copyContext(browser);
    await page.goto(LANDING, { waitUntil: "networkidle" });
    const cases: [string, string][] = [
      [".aa-hero-cmd-frame .aa-copy-btn", HERO],
      [".aa-steps .aa-step:nth-child(3) .aa-copy-btn", STEP3],
      [
        ".aa-steps .aa-step:nth-child(1) .aa-copy-btn",
        "git clone https://github.com/gfirik/agentic-analytics\ncd agentic-analytics\nbun install\nbun run aa doctor",
      ],
    ];
    for (const [sel, want] of cases) {
      await reset(page);
      await page.locator(sel).click();
      await expect.poll(() => clipboard(page), sel).toBe(want);
    }
    // Inline values: a door's command and a binary's name.
    await reset(page);
    await page.locator(".aa-door-cmd .aa-copy-btn").nth(1).click();
    await expect.poll(() => clipboard(page)).toBe("aa serve");
    await reset(page);
    await page.locator(".aa-binaries .aa-copy-btn").first().click();
    await expect.poll(() => clipboard(page)).toBe("aa-linux-x64");

    await page.goto(`${BASE}/use-it/http-api/`, { waitUntil: "networkidle" });
    await reset(page);
    await page.locator("main .expressive-code .aa-copy-btn").first().click();
    await expect.poll(() => clipboard(page)).toBe(HTTP_API);
    // Expressive Code's own button is off: one button per block.
    await expect(page.locator(".expressive-code .copy")).toHaveCount(0);
    expect(await page.locator("main .expressive-code .frame").first().locator(".aa-copy-btn").count()).toBe(1);

    await page.goto(LEARN, { waitUntil: "networkidle" });
    const block = page.locator("main .expressive-code pre").first();
    const shown = await block.evaluate((pre) =>
      [...pre.querySelectorAll(".ec-line")].map((l) => (l.textContent ?? "").replace(/\s+$/, "")).join("\n"),
    );
    await reset(page);
    await page.locator("main .expressive-code .aa-copy-btn").first().click();
    await expect.poll(() => clipboard(page)).toBe(shown.trim());
    // A command in a docs table carries a button too.
    await page.goto(`${BASE}/use-it/cli/`, { waitUntil: "networkidle" });
    const value = page.locator("main td code[data-copy]").first();
    const text = ((await value.textContent()) ?? "").replace(/\s+/g, " ").trim();
    await reset(page);
    await value.locator(".aa-copy-btn").click();
    await expect.poll(() => clipboard(page)).toBe(text);
    await ctx.close();
  });

  test('"Copied" is announced and shown on the button, then reverts; nothing moves', async ({ browser }) => {
    const { ctx, page } = await copyContext(browser);
    await page.goto(LANDING, { waitUntil: "networkidle" });
    const btn = page.locator(".aa-hero-cmd-frame .aa-copy-btn");
    const before = await btn.boundingBox();
    const frame = await page.locator(".aa-hero-cmd-frame").boundingBox();
    await btn.click();
    await expect(page.locator("#aa-copy-live")).toHaveText("Copied");
    await expect(page.locator("#aa-copy-live")).toHaveAttribute("aria-live", "polite");
    await expect(btn).toHaveAttribute("data-state", "copied");
    await expect
      .poll(() => btn.evaluate((b) => [getComputedStyle(b, "::after").content, getComputedStyle(b, "::after").opacity]))
      .toEqual(['"Copied"', "1"]);
    expect(await btn.boundingBox()).toEqual(before);
    expect(await page.locator(".aa-hero-cmd-frame").boundingBox()).toEqual(frame);
    // Reverts after about 1.5 s.
    await expect(btn).not.toHaveAttribute("data-state", /./, { timeout: 4000 });
    await expect(page.locator("#aa-copy-live")).toHaveText("");
    await ctx.close();
  });

  test("a click on the block copies it; a drag-selection inside it doesn't", async ({ browser }) => {
    const { ctx, page } = await copyContext(browser);
    await page.goto(LANDING, { waitUntil: "networkidle" });
    const pre = page.locator(".aa-steps .aa-step:nth-child(3) pre");
    await pre.scrollIntoViewIfNeeded();
    await reset(page);
    await pre.click({ position: { x: 40, y: 20 } });
    await expect.poll(() => clipboard(page)).toBe(STEP3);
    // Drag across the first line: the text is selected, the clipboard untouched, the button never says Copied.
    await expect(page.locator(".aa-steps .aa-step:nth-child(3) .aa-copy-btn")).not.toHaveAttribute("data-state", /./, { timeout: 4000 });
    await reset(page);
    const box = await pre.boundingBox();
    if (!box) throw new Error("no box");
    await page.mouse.move(box.x + 18, box.y + 26);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + 26, { steps: 5 });
    await page.mouse.move(box.x + 160, box.y + 50, { steps: 5 });
    await page.mouse.up();
    expect((await page.evaluate(() => getSelection()?.toString() ?? "")).length).toBeGreaterThan(3);
    await page.waitForTimeout(400); // a negative check: give a stray copy the time it would take
    expect(await clipboard(page)).toBe("(unchanged)");
    await expect(page.locator(".aa-steps .aa-step:nth-child(3) .aa-copy-btn")).not.toHaveAttribute("data-state", /./);
    // A link inside a copyable value keeps working as a link (the door names sit beside their commands).
    await ctx.close();
  });

  test("keyboard: the button is a real button with a focus ring; Enter and Space copy", async ({ browser }) => {
    const { ctx, page } = await copyContext(browser);
    await page.goto(LANDING, { waitUntil: "networkidle" });
    const btn = page.locator(".aa-hero-cmd-frame .aa-copy-btn");
    expect(await btn.evaluate((b) => [b.tagName, (b as HTMLButtonElement).type, b.getAttribute("aria-label")])).toEqual([
      "BUTTON",
      "button",
      "Copy Install command",
    ]);
    for (const key of ["Enter", " "]) {
      await reset(page);
      await btn.focus();
      await page.keyboard.press(key === " " ? "Space" : key);
      await expect.poll(() => clipboard(page), key).toBe(HERO);
    }
    // Focus by keyboard shows the 2px ink ring.
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    expect(
      await btn.evaluate(
        (b) => b === document.activeElement && getComputedStyle(b).outlineStyle !== "none" && getComputedStyle(b).outlineWidth,
      ),
    ).toBe("2px");
    await ctx.close();
  });

  test("fallback: when the Clipboard API rejects, a hidden textarea and execCommand copy the same text", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await ctx.addInitScript(() => {
      const w = window as unknown as { __copied: string[] };
      w.__copied = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")),
          readText: () => Promise.reject(new Error("no")),
        },
      });
      document.execCommand = (cmd: string) => {
        const ta = document.activeElement;
        if (cmd === "copy" && ta instanceof HTMLTextAreaElement) w.__copied.push(ta.value.slice(ta.selectionStart, ta.selectionEnd));
        return cmd === "copy";
      };
    });
    const page = await ctx.newPage();
    const copied = () => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
    await page.goto(LANDING, { waitUntil: "networkidle" });
    await page.locator(".aa-hero-cmd-frame .aa-copy-btn").click();
    await expect.poll(copied).toEqual([HERO]);
    await expect(page.locator(".aa-hero-cmd-frame .aa-copy-btn")).toHaveAttribute("data-state", "copied");
    await page.locator(".aa-steps .aa-step:nth-child(3) .aa-copy-btn").click();
    await expect.poll(copied).toEqual([HERO, STEP3]);
    // The scratch textarea is gone again and focus is back on the button.
    await expect(page.locator(".aa-copy-scratch")).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.className)).toContain("aa-copy-btn");
    await page.goto(`${BASE}/use-it/http-api/`, { waitUntil: "networkidle" });
    await page.locator("main .expressive-code .aa-copy-btn").first().click();
    await expect.poll(copied).toEqual([HTTP_API]);
    await ctx.close();
  });

  test("the buttons and wrappers arrive after first paint and move nothing (landing and Learn pages, 1440 and 390)", async ({
    browser,
  }) => {
    // Every element's box with the buttons in place, then with every wrapper undone and every button removed: equal. On a
    // slow runner the script runs after first paint, so any difference would be a layout shift (CI caught one, 0.0021).
    for (const width of [1440, 390]) {
      const { ctx, page } = await copyContext(browser, { width });
      for (const path of [LANDING, `${BASE}/learn/stages/metric-layer/`, `${BASE}/learn/stages/retrieval/`, LEARN]) {
        await page.goto(path, { waitUntil: "networkidle" });
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        const moved = await page.evaluate(() => {
          const els = [...document.querySelectorAll("main *")].filter(
            (e) => !e.closest(".aa-copy-btn") && !e.classList.contains("aa-copy-wrap"),
          );
          const boxes = () =>
            els.map((e) => {
              const r = e.getBoundingClientRect();
              return `${r.left.toFixed(1)},${r.top.toFixed(1)},${r.width.toFixed(1)},${r.height.toFixed(1)}`;
            });
          const before = boxes();
          for (const w of document.querySelectorAll(".aa-copy-wrap")) {
            const pre = w.querySelector("pre") as HTMLElement;
            pre.style.margin = "";
            w.replaceWith(pre);
          }
          for (const b of document.querySelectorAll(".aa-copy-btn")) b.remove();
          const after = boxes();
          return els
            .filter((_, i) => before[i] !== after[i])
            .map((e) => `${e.tagName}.${String(e.className).slice(0, 40)}`)
            .slice(0, 5);
        });
        expect(moved, `${width} ${path}`).toEqual([]);
      }
      await ctx.close();
    }
  });

  test("every <pre> on the landing page and on sampled docs and Learn pages has a copy control; none without JS", async ({ browser }) => {
    const sample = [
      LANDING,
      `${BASE}/start/quickstart/`,
      `${BASE}/use-it/http-api/`,
      LEARN,
      `${BASE}/learn/stages/analysis/`,
      `${BASE}/learn/stages/metric-layer/`,
    ];
    const { ctx, page } = await copyContext(browser);
    for (const path of sample) {
      await page.goto(path, { waitUntil: "networkidle" });
      const missing = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("pre:not(.aa-nocopy)")]
          .filter((pre) => !pre.closest(".aa-copy-host")?.querySelector(".aa-copy-btn"))
          .map((pre) => pre.className || pre.parentElement?.className || "pre"),
      );
      expect(missing, path).toEqual([]);
      expect(await page.locator("main pre").count(), path).toBeGreaterThan(0);
    }
    await ctx.close();
    const off = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
    const p = await off.newPage();
    for (const path of [LANDING, `${BASE}/use-it/http-api/`, LEARN, `${BASE}/use-it/cli/`]) {
      await p.goto(path);
      expect(await p.locator(".aa-copy-btn, .expressive-code .copy button").count(), path).toBe(0);
      // No room is reserved for a button that isn't there.
      expect(await p.evaluate(() => document.documentElement.hasAttribute("data-aa-copy")), path).toBe(false);
    }
    await off.close();
  });
});
