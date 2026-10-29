// Commands and code blocks (apps/docs/DESIGN.md §6): a command is one line when it fits, scrolls sideways inside its
// box when it doesn't (never wraps), and its copy button copies exactly the command shown.

import { expect, type Page, test } from "@playwright/test";

const BASE = "/agentic-analytics";
const LANDING = `${BASE}/`;
const DOC_WITH_LONG_COMMAND = `${BASE}/use-it/telegram/`;

/** Command blocks on the landing page: the hero install lines, the three quickstart steps, the four doors. */
const LANDING_COMMANDS = ".aa-hero-cmd pre, .aa-steps pre, .aa-door-cmd .aa-scroll";

async function open(page: Page, path: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
}

/** Rendered lines of an element's text: the distinct tops of its non-blank characters. */
async function visualLines(el: ReturnType<Page["locator"]>) {
  return el.evaluate((root) => {
    const range = document.createRange();
    const tops = new Set<number>();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent ?? "";
      for (let i = 0; i < text.length; i++) {
        if (/\s/.test(text[i] ?? "")) continue;
        range.setStart(n, i);
        range.setEnd(n, i + 1);
        tops.add(Math.round(range.getBoundingClientRect().top));
      }
    }
    return { rendered: tops.size, source: (root.textContent ?? "").split("\n").length };
  });
}

test("at 1440 the hero install line, the quickstart steps and the four doors do not wrap, scroll or clip", async ({ page }) => {
  await open(page, LANDING, 1440);
  const blocks = page.locator(LANDING_COMMANDS);
  expect(await blocks.count()).toBeGreaterThanOrEqual(8);
  for (const block of await blocks.all()) {
    const { rendered, source } = await visualLines(block);
    expect(rendered, await block.innerText()).toBe(source);
    expect(await block.evaluate((e) => e.scrollWidth - e.clientWidth), await block.innerText()).toBeLessThanOrEqual(0);
    expect(await block.evaluate((e) => getComputedStyle(e).whiteSpace)).toBe("pre");
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("at 390 command blocks scroll sideways inside their box instead of wrapping, and the page does not", async ({ page }) => {
  await open(page, LANDING, 390);
  let scrolling = 0;
  for (const block of await page.locator(LANDING_COMMANDS).all()) {
    const { rendered, source } = await visualLines(block);
    expect(rendered, await block.innerText()).toBe(source);
    expect(await block.evaluate((e) => getComputedStyle(e).overflowX)).toBe("auto");
    if (await block.evaluate((e) => e.scrollWidth > e.clientWidth)) scrolling++;
  }
  // The hero's clone line, step 1's, step 3's and the Telegram door are longer than a phone's column.
  expect(scrolling).toBeGreaterThanOrEqual(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("a docs page's long command is one line that scrolls inside its box at 390 and fits at 1440", async ({ page }) => {
  for (const width of [390, 1440]) {
    await open(page, DOC_WITH_LONG_COMMAND, width);
    const pre = page.locator(".expressive-code pre", { hasText: "TELEGRAM_BOT_TOKEN" }).first();
    expect(await pre.evaluate((e) => getComputedStyle(e).whiteSpace), `${width}`).toBe("pre");
    expect(await pre.evaluate((e) => getComputedStyle(e).overflowX), `${width}`).toBe("auto");
    const lines = await pre.locator(".ec-line").count();
    expect(lines).toBe(2);
    for (const line of await pre.locator(".ec-line").all()) expect((await line.boundingBox())?.height ?? 0, `${width}`).toBeLessThan(40);
    const scrolls = await pre.evaluate((e) => e.scrollWidth > e.clientWidth);
    if (width === 390) expect(scrolls).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${width}`).toBeLessThanOrEqual(0);
  }
});

test("no command block on the landing page or in the docs uses a backslash line break", async ({ page, request }) => {
  const sitemap = await (await request.get(`${BASE}/sitemap-0.xml`)).text();
  const paths = [...sitemap.matchAll(/<loc>https:\/\/gfirik\.github\.io([^<]+)<\/loc>/g)].map((m) => m[1] as string);
  for (const path of paths) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    const broken = await page.evaluate(() =>
      [...document.querySelectorAll("pre")]
        .filter((p) => /\\[ \t]*\n/.test(p.textContent ?? ""))
        .map((p) => (p.textContent ?? "").slice(0, 60)),
    );
    expect(broken, path).toEqual([]);
  }
});

test("a copy button copies exactly the command shown", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  await page.goto(LANDING, { waitUntil: "networkidle" });
  const hosts = page.locator("[data-copy-host]:has(pre), .aa-doors li");
  expect(await hosts.count()).toBeGreaterThanOrEqual(7);
  for (const host of await hosts.all()) {
    await host.scrollIntoViewIfNeeded();
    const block = host.locator("pre, code[data-copy]").first();
    // What is shown: the block's text, without the button; blank lines dropped.
    const shown = await block.evaluate((e) =>
      (e.textContent ?? "")
        .split("\n")
        .map((l) => l.replace(/\s+$/, ""))
        .join("\n")
        .trim(),
    );
    const expected = (await block.evaluate((e) => e.tagName)) === "CODE" ? shown.replace(/\s+/g, " ") : shown;
    await host.locator(".aa-copy-btn").first().click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied, expected).toBe(expected);
  }
  await context.close();
});
