// Measures the landing page's 3D engine machine (apps/docs/DESIGN.md §6, §7) in a real Chrome with the DevTools Protocol:
// frames drawn, long tasks, JS heap, WebGL contexts, draw calls, GPU resources, CPU while idle, and whether the hero's
// net and the machine ever animate at the same time. On demand only (not in CI):
//
//   bun run --filter @agentic-analytics/docs build
//   bun run --filter @agentic-analytics/docs preview --port 4329 --host 127.0.0.1 &      (note its PID, kill it after)
//   bash scripts/heavy.sh bunx tsx scripts/site/perf/machine-perf.ts --label after --throttle 4
//
// Options: --url <landing url>  --label <name>  --throttle <cpu factor, default 4>  --size 1440x900  --soak <seconds, default 0>
//          --out <dir>  --channel <chrome|chromium, default chrome>  --gpu (do not force SwiftShader).
// Everything is read from instruments injected before the page's own scripts: wrapped getContext / draw calls / resource
// creation on WebGL, wrapped requestAnimationFrame, a longtask observer, plus the page's own debug counters when they exist
// (canvas.aaFrames on the hero net and the machine, canvas.aaInfo() = three's renderer.info on the machine).
// The default run uses SwiftShader (as CI does); --gpu uses the machine's GPU, which is what a reader's laptop has.
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CDPSession, chromium, type Page } from "@playwright/test";

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const flag = (name: string) => process.argv.includes(`--${name}`);
const URL_ = arg("url", "http://127.0.0.1:4329/agentic-analytics/");
const LABEL = arg("label", "run");
const THROTTLE = Number(arg("throttle", "4"));
const [W, H] = arg("size", "1440x900").split("x").map(Number) as [number, number];
const SOAK_S = Number(arg("soak", "0"));
const OUT = arg("out", join(tmpdir(), "machine-perf"));
const CHANNEL = arg("channel", "chrome");
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

type Perf = {
  contexts: { kind: string; at: number }[];
  draws: number;
  drawFrames: number;
  rafCalls: number;
  created: Record<string, number>;
  deleted: Record<string, number>;
  longtasks: { start: number; duration: number }[];
  both: number;
  renderer: string;
};

/** Injected before any page script. */
const INSTRUMENT = () => {
  const P: Perf = { contexts: [], draws: 0, drawFrames: 0, rafCalls: 0, created: {}, deleted: {}, longtasks: [], both: 0, renderer: "" };
  (window as unknown as { __aaPerf: Perf }).__aaPerf = P;
  const getContext = HTMLCanvasElement.prototype.getContext as (this: HTMLCanvasElement, ...a: unknown[]) => unknown;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
    const ctx = getContext.call(this, kind, ...rest);
    if (ctx && /webgl/.test(kind)) {
      P.contexts.push({ kind, at: performance.now() });
      if (!P.renderer) {
        const g = ctx as WebGLRenderingContext;
        const ext = g.getExtension("WEBGL_debug_renderer_info");
        P.renderer = ext ? String(g.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";
      }
    }
    return ctx;
  } as typeof HTMLCanvasElement.prototype.getContext;
  for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype] as unknown as Record<string, unknown>[]) {
    for (const fn of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced", "drawRangeElements"]) {
      const orig = proto[fn] as ((...a: unknown[]) => unknown) | undefined;
      if (!orig) continue;
      proto[fn] = function (this: unknown, ...a: unknown[]) {
        P.draws++;
        return orig.apply(this, a);
      };
    }
    for (const what of ["Buffer", "Texture", "Program", "Framebuffer", "Renderbuffer", "VertexArray"]) {
      const c = proto[`create${what}`] as ((...a: unknown[]) => unknown) | undefined;
      const d = proto[`delete${what}`] as ((...a: unknown[]) => unknown) | undefined;
      if (c)
        proto[`create${what}`] = function (this: unknown, ...a: unknown[]) {
          P.created[what] = (P.created[what] ?? 0) + 1;
          return c.apply(this, a);
        };
      if (d)
        proto[`delete${what}`] = function (this: unknown, ...a: unknown[]) {
          P.deleted[what] = (P.deleted[what] ?? 0) + 1;
          return d.apply(this, a);
        };
    }
  }
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb: FrameRequestCallback): number =>
    raf((t) => {
      const before = P.draws;
      cb(t);
      P.rafCalls++;
      if (P.draws !== before) P.drawFrames++;
    });
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) P.longtasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch {
    // no longtask support: reported as none
  }
  // Both at once: in each 250 ms window, did the hero net and the machine both draw?
  let heroLast = 0;
  let drawLast = 0;
  setInterval(() => {
    const hero = document.querySelector<HTMLCanvasElement & { aaFrames?: number }>(".aa-hf-net");
    const h = hero?.aaFrames ?? 0;
    if (h !== heroLast && P.drawFrames !== drawLast) P.both++;
    heroLast = h;
    drawLast = P.drawFrames;
  }, 250);
};

interface Snap {
  t: number;
  drawFrames: number;
  draws: number;
  rafCalls: number;
  longtasks: number;
  heroFrames: number;
  machineFrames: number | null;
  y: number;
  both: number;
  heap: number;
  task: number;
  script: number;
  layouts: number;
  recalcs: number;
  layoutDur: number;
  contexts: number;
}

const metrics = async (cdp: CDPSession) => {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const m = (n: string) => metrics.find((x) => x.name === n)?.value ?? 0;
  return {
    heap: m("JSHeapUsedSize"),
    task: m("TaskDuration"),
    script: m("ScriptDuration"),
    layouts: m("LayoutCount"),
    recalcs: m("RecalcStyleCount"),
    layoutDur: m("LayoutDuration"),
  };
};
const snap = async (page: Page, cdp: CDPSession): Promise<Snap> => {
  const m = await metrics(cdp);
  const p = await page.evaluate(() => {
    const P = (window as unknown as { __aaPerf: Perf }).__aaPerf;
    const hero = document.querySelector<HTMLCanvasElement & { aaFrames?: number }>(".aa-hf-net");
    const mc = document.querySelector<HTMLCanvasElement & { aaFrames?: number }>(".aa-engine-canvas");
    return {
      drawFrames: P.drawFrames,
      draws: P.draws,
      rafCalls: P.rafCalls,
      longtasks: P.longtasks.length,
      both: P.both,
      contexts: P.contexts.length,
      heroFrames: hero?.aaFrames ?? 0,
      machineFrames: mc ? (mc.aaFrames ?? null) : null,
      y: Math.round(scrollY),
    };
  });
  return { t: Date.now(), ...m, ...p };
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    ...(CHANNEL === "chromium" ? {} : { channel: CHANNEL }),
    headless: true,
    // --gpu: the machine's own GPU through ANGLE's OpenGL backend (headless Chrome otherwise falls back to SwiftShader, a
    // software renderer, which is what CI uses and which is far slower than any laptop GPU).
    args: flag("gpu")
      ? ["--use-gl=angle", "--use-angle=gl", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"]
      : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await ctx.addInitScript(INSTRUMENT);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  page.on("console", (m) =>
    m.type() === "error" || m.type() === "warning" ? console.error(`console ${m.type()}:`, m.text().slice(0, 200)) : undefined,
  );
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });

  const phases: { name: string; ms: number; y: number; d: Record<string, number | null>; longtasks: number[] }[] = [];
  let cursor: Snap | null = null;
  const t0 = Date.now();
  const mark = async (name: string) => {
    const s = await snap(page, cdp);
    if (cursor) {
      const wall = (s.t - cursor.t) / 1000;
      const all = await page.evaluate(() => (window as unknown as { __aaPerf: Perf }).__aaPerf.longtasks.map((l) => l.duration));
      const frames = s.drawFrames - cursor.drawFrames;
      phases.push({
        name,
        ms: Math.round(wall * 1000),
        y: s.y,
        longtasks: all.slice(cursor.longtasks, s.longtasks).map((d) => Math.round(d)),
        d: {
          drawnFrames: frames,
          drawnFps: +(frames / wall).toFixed(1),
          framesPer10s: +((frames / wall) * 10).toFixed(1),
          drawCallsPerFrame: frames > 0 ? +((s.draws - cursor.draws) / frames).toFixed(1) : 0,
          rafCallbacks: s.rafCalls - cursor.rafCalls,
          heroNetFrames: s.heroFrames - cursor.heroFrames,
          machineFrameCounter: s.machineFrames === null ? null : s.machineFrames - (cursor.machineFrames ?? 0),
          cpuPct: +(((s.task - cursor.task) / wall) * 100).toFixed(1),
          scriptPct: +(((s.script - cursor.script) / wall) * 100).toFixed(1),
          layouts: s.layouts - cursor.layouts,
          styleRecalcs: s.recalcs - cursor.recalcs,
          layoutMs: Math.round((s.layoutDur - cursor.layoutDur) * 1000),
          heapMB: +(s.heap / 1048576).toFixed(1),
          windowsBothAnimating: s.both - cursor.both,
        },
      });
    }
    cursor = s;
  };
  const wheel = async (dy: number, steps: number, gap: number) => {
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, dy);
      await sleep(gap);
    }
  };
  const gc = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    await sleep(300);
    return +((await metrics(cdp)).heap / 1048576).toFixed(1);
  };

  await page.goto(URL_, { waitUntil: "load" });
  await page.mouse.move(W / 2, H / 2);
  await mark("load");
  await sleep(2500);
  await mark("hero idle 2.5s");
  await sleep(7500);
  await mark("HERO idle 7.5s (net runs)");
  const heapStart = await gc();

  const geo = await page.evaluate(() => {
    const track = document.querySelector<HTMLElement>("[data-track]");
    const stage = document.querySelector<HTMLElement>("[data-engine-stage]");
    if (!track || !stage) return null;
    return { top: track.getBoundingClientRect().top + scrollY, span: track.offsetHeight - stage.offsetHeight, vh: innerHeight };
  });
  if (!geo) throw new Error("no machine band on the page (still mode?)");
  const toY = async (y: number, step = 90, gap = 18) => {
    const cur = await page.evaluate(() => scrollY);
    await wheel(Math.sign(y - cur) * step, Math.ceil(Math.abs(y - cur) / step), gap);
  };

  await toY(geo.top - geo.vh * 0.6);
  await mark("scroll: hero to machine band");
  let glOn = "never";
  try {
    await page.locator("[data-machine][data-gl=on]").waitFor({ timeout: 60_000 });
    glOn = "on";
  } catch {
    glOn = (await page.locator("[data-machine]").first().getAttribute("data-gl")) ?? "never";
  }
  await mark("wait for webgl (ignored)");
  await toY(geo.top, 60, 20);
  await mark("scroll: into the band");
  await toY(geo.top + geo.span, 40, 25);
  await mark("scroll: the whole 3D tour");
  await toY(geo.top + geo.span * 0.5, 40, 25);
  await mark("scroll: back to the middle stop");
  await sleep(5500); // the camera settles and the drift's few seconds after the last input are over
  await mark("settle (ignored)");
  await sleep(10_000);
  await mark("IDLE on the middle stop, 10s");
  await page.mouse.move(W / 2, H / 2);
  await page.mouse.click(W / 2, H / 2);
  await sleep(800);
  await mark("enter explore");
  for (let k = 0; k < 4; k++) {
    await page.mouse.move(W / 2, H / 2);
    await page.mouse.down();
    for (let i = 0; i < 30; i++) {
      await page.mouse.move(W / 2 + (k % 2 ? -1 : 1) * i * 8, H / 2 + Math.sin(i / 4) * 30);
      await sleep(16);
    }
    await page.mouse.up();
  }
  await mark("explore: orbit x4");
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, i < 6 ? -120 : 120);
    await sleep(40);
  }
  await sleep(800);
  await mark("explore: zoom in and out");
  await sleep(6000);
  await mark("IDLE in explore, 6s");
  await page.keyboard.press("Escape");
  await sleep(2500);
  await mark("leave explore (ignored: easing)");
  await sleep(10_000);
  await mark("IDLE back in the tour, 10s");
  await toY(geo.top + geo.span + geo.vh * 0.8);
  await mark("scroll: past the machine");
  await sleep(1500);
  await mark("settle (ignored)");
  await sleep(5000);
  await mark("IDLE below the machine, 5s");
  await toY(0, 220, 14);
  await mark("scroll: back to top");
  await sleep(3000);
  await mark("hero idle again, 3s");

  const soak: { t: number; heapMB: number }[] = [];
  if (SOAK_S > 0) {
    const s0 = Date.now();
    let next = s0;
    soak.push({ t: 0, heapMB: await gc() });
    while (Date.now() < s0 + SOAK_S * 1000) {
      await toY(geo.top + geo.span, 120, 16);
      await toY(0, 160, 16);
      if (Date.now() >= next) {
        soak.push({ t: Math.round((Date.now() - s0) / 1000), heapMB: +((await metrics(cdp)).heap / 1048576).toFixed(1) });
        next = Date.now() + 15_000;
      }
    }
  }
  const heapEnd = await gc();
  if (SOAK_S > 0) soak.push({ t: SOAK_S, heapMB: heapEnd });

  const final = await page.evaluate(() => {
    const P = (window as unknown as { __aaPerf: Perf }).__aaPerf;
    const mc = document.querySelector<HTMLCanvasElement & { aaInfo?: () => unknown }>(".aa-engine-canvas");
    return {
      contexts: P.contexts.length,
      renderer: P.renderer,
      created: P.created,
      deleted: P.deleted,
      longtasks: P.longtasks,
      info: typeof mc?.aaInfo === "function" ? mc.aaInfo() : null,
      canvasPx: mc ? [mc.width, mc.height] : null,
    };
  });
  const long = final.longtasks.map((l) => Math.round(l.duration));
  const report = {
    label: LABEL,
    url: URL_,
    cpuThrottle: THROTTLE,
    viewport: [W, H],
    glState: glOn,
    wallSeconds: Math.round((Date.now() - t0) / 1000),
    webglRenderer: final.renderer,
    webglContextsCreated: final.contexts,
    glResourcesCreated: final.created,
    glResourcesDeleted: final.deleted,
    rendererInfo: final.info,
    canvasBackingPx: final.canvasPx,
    longTasksOver50ms: long,
    longTasksOver100ms: long.filter((d) => d > 100),
    heapAfterGcStartMB: heapStart,
    heapAfterGcEndMB: heapEnd,
    soak,
    phases,
  };
  writeFileSync(join(OUT, `${LABEL}.json`), JSON.stringify(report, null, 2));
  for (const p of phases)
    console.log(
      `${p.name.padEnd(36)} y${String(p.y).padStart(5)} ${String(p.ms).padStart(6)}ms drawn ${String(p.d.drawnFrames).padStart(4)} (${String(p.d.drawnFps).padStart(5)} fps, ${String(p.d.framesPer10s).padStart(6)}/10s) calls/frame ${String(p.d.drawCallsPerFrame).padStart(5)} hero ${String(p.d.heroNetFrames).padStart(4)} cpu ${String(p.d.cpuPct).padStart(5)}% layouts ${String(p.d.layouts).padStart(4)} heap ${p.d.heapMB}MB both ${p.d.windowsBothAnimating} long ${p.longtasks.length ? p.longtasks.join(",") : "-"}`,
    );
  console.log(JSON.stringify({ ...report, phases: undefined }, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
