// The engine machine's live view (DESIGN.md §6 "Engine machine", §7): the chunk EngineMachine.astro starts on idle
// after load, once the band is near. It draws machine-scene.ts (batched by machine-batch.ts) with three.js over the still
// frame and places the station labels (the HTML buttons the server rendered) from projected coordinates. The page script
// owns the scroll position, the mode, the station card and the list; this module only moves the camera to where it is
// told (the tour) or hands it to the reader (explore: three's OrbitControls), highlights pieces, and reports which piece
// the pointer is over or taps. No wording or figure lives in this file.
//
// It draws on demand (DESIGN.md §7): a frame is drawn only when the camera, the highlight, the size or the labels changed,
// or an animation is in progress (the camera easing toward the scroll, the return from explore, the damped orbit, the slow
// drift just after the reader last scrolled or moved), and there is no animation-frame loop at all while nothing changes,
// while the stage is mostly off screen or while the tab is hidden. One WebGL context is made, once, and kept for the page's
// life. While the machine is on screen the hero's net rests (document.documentElement[data-aa-machine]), so the two never
// animate together. The slow drift is off on phones (the lighter scene) and the section never mounts this module under
// reduced motion (the still frame and the list instead).
import { OrthographicCamera, Raycaster, SRGBColorSpace, Vector2, Vector3, WebGLRenderer } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { batchMachine } from "./machine-batch.ts";
import { buildMachine, type Detail, fitView, placeCamera, readTokens, type SceneInput } from "./machine-scene.ts";

export interface MachineData {
  readonly scene: SceneInput;
  /** The scroll tour's stops after the home view, in order: each stop's pieces (station and side-piece keys). */
  readonly tour: readonly { readonly key: string; readonly members: readonly string[] }[];
}

export type Mode = "tour" | "explore";

export interface MountOptions {
  readonly detail: Detail;
  /** The slow camera drift (desktop only, tour mode only). */
  readonly drift: boolean;
  /** A mouse is over a piece (or none). */
  readonly onHover: (key: string | null) => void;
  /** A press with no drag on the canvas, over a piece or not, and by which kind of pointer. */
  readonly onTap: (key: string | null, pointer: string) => void;
  /** How many CSS pixels on the right of the view an overlay (the station card) covers, so a focused piece centres in the rest. */
  readonly coveredRight: () => number;
  /** How many CSS pixels at the top of the view the section's head covers at the home view (it fades out after). */
  readonly coveredTop: () => number;
}

export interface Live {
  /** Where the camera is on the tour: 0 is the home view, k the k-th stop; fractions ease between them. */
  setProgress(f: number): void;
  /** The pieces to highlight (their edges in ink, their floor marked, their labels pressed), or none. */
  highlight(keys: readonly string[]): void;
  /** Tour: the scroll drives the camera. Explore: the reader does (rotate, zoom, pan); leaving eases back to the tour. */
  setMode(mode: Mode): void;
  /** Stops drawing and frees the context, the geometry, the observers and the listeners. */
  destroy(): void;
}

/** What the canvas shows to tests and to a developer (the hero net's `aaFrames` is the model). */
export interface Debug extends HTMLCanvasElement {
  /** Frames drawn so far. */
  aaFrames?: number;
  /** three's renderer.info, the pixel ratio in use and the frames drawn. */
  aaInfo?: () => Record<string, number>;
}

const $ = <T extends Element>(root: ParentNode, sel: string) => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`engine machine: missing ${sel}`);
  return el;
};
/** One task's break, so building the scene, batching it, compiling its shaders and the first frame never make one long task. */
const yieldTask = () => new Promise<void>((ok) => setTimeout(ok, 0));
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
/** Each stop holds for the middle of its scroll span, and the camera eases between stops. */
const ease = (t: number) => {
  const u = clamp((t - 0.2) / 0.6, 0, 1);
  return u * u * (3 - 2 * u);
};
const smooth = (t: number) => t * t * (3 - 2 * t);
const UP = new Vector3(0, 1, 0);
/** How long the camera takes to ease back from explore to the tour. */
const RETURN_MS = 700;
/** The slow drift runs this long after the reader last scrolled or moved, then holds still (no frames while idle). */
const DRIFT_HOLD_MS = 4000;
/** The drift alone needs no more than 30 frames a second. */
const DRIFT_FRAME_MS = 30;
/** The share of the stage that must be on screen for the machine to draw (and for the hero's net to rest). */
const ACTIVE_SHARE = 0.4;
/** The device pixel ratio never goes above this: the lines and flat faces look the same, at half the pixels of 2. */
const MAX_PIXEL_RATIO = 1.5;
/** A device that reports little memory draws at no more than this ratio from the first frame. */
const WEAK_PIXEL_RATIO = 1;
/** A software renderer (the browser refused a context that must be fast) starts at this ratio. */
const SOFTWARE_PIXEL_RATIO = 0.75;
/** Slow frames lower the internal resolution in one step, toward the frame time wanted, down to the floor (never in many steps: each reallocates the canvas). */
const WANTED_FRAME_MS = 28;
const MIN_PIXEL_RATIO = 0.6;
/** Frames (while the camera moves) averaged before judging them slow, and the average interval that counts as slow. */
const SAMPLE_FRAMES = 24;
const SLOW_FRAME_MS = 38;

/** A camera pose: the direction it looks from, the point at the view's centre and the scene width across the view. */
interface Pose {
  dir: Vector3;
  look: Vector3;
  full: number;
}

/** One label: the button, its measured size and what was last written to it, so a frame writes only what changed. */
interface Tag {
  readonly el: HTMLButtonElement;
  readonly id: string;
  w: number;
  h: number;
  transform: string;
  far: boolean | null;
}

export async function mount(root: HTMLElement, data: MachineData, opts: MountOptions): Promise<Live> {
  const viewport = $<HTMLElement>(root, "[data-viewport]");
  const tagLayer = $<HTMLElement>(root, "[data-tags]");
  const tags: Tag[] = [...tagLayer.querySelectorAll<HTMLButtonElement>("[data-tag]")].map((el) => ({
    el,
    id: el.dataset.id ?? "",
    w: 0,
    h: 0,
    transform: "",
    far: null,
  }));

  const canvas: Debug = document.createElement("canvas");
  canvas.className = "aa-engine-canvas";
  canvas.setAttribute("aria-hidden", "true");
  // The one context. A browser that would give only a software renderer refuses `failIfMajorPerformanceCaveat`: the
  // machine is then drawn at a lower internal resolution rather than not at all (the same look, fewer pixels). A failed
  // attempt makes no context, so the second one is still the page's first.
  const nav = navigator as Navigator & { deviceMemory?: number };
  const weak = (nav.deviceMemory ?? 8) <= 4;
  let software = false;
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "low-power", failIfMajorPerformanceCaveat: true });
  } catch {
    software = true;
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "low-power" });
    } catch (cause) {
      const err = new Error("engine machine: no WebGL", { cause });
      err.name = "NoWebGL";
      throw err;
    }
  }
  renderer.outputColorSpace = SRGBColorSpace;
  // A browser that does not refuse still may be drawing in software (SwiftShader, llvmpipe): said by its renderer string.
  const gl = renderer.getContext();
  const gpu = gl.getExtension("WEBGL_debug_renderer_info");
  if (gpu && /swiftshader|llvmpipe|software|basic render/i.test(String(gl.getParameter(gpu.UNMASKED_RENDERER_WEBGL)))) software = true;
  let ratio = Math.min(window.devicePixelRatio || 1, weak || software ? WEAK_PIXEL_RATIO : MAX_PIXEL_RATIO);
  if (software) ratio = Math.min(ratio, SOFTWARE_PIXEL_RATIO);
  await yieldTask();
  const raw = buildMachine(data.scene, readTokens(document.documentElement), opts.detail);
  await yieldTask();
  const built = await batchMachine(raw, yieldTask);

  // The highlight: the piece's outline turns ink (a hidden set of ink lines over its own edges is shown, and hidden when
  // it is let go).
  const swapEdges = (key: string, on: boolean) => {
    const edge = built.inkEdges.get(key);
    if (edge) edge.visible = on;
  };

  // The stations in line order (the side pieces have no line neighbours).
  const line = data.scene.stations.map((s) => s.key);

  const camera = new OrthographicCamera();
  let width = 1;
  let height = 1;
  /** The tour's keyframes: the home view, then each stop's centre and the scene width it shows in the free part of the view. */
  let frames: { target: Vector3; width: number; top: number }[] = [];
  let homeDir = new Vector3(0, 1, 1).normalize();
  let homeWidth = 1;
  const free = () => Math.max(1, width - opts.coveredRight());
  const keyframes = () => {
    const top = Math.min(opts.coveredTop(), height * 0.4);
    const home = fitView(built, free() / Math.max(1, height - top));
    homeDir = home.dir;
    homeWidth = home.width;
    frames = [
      { target: home.target.clone(), width: home.width, top: 1 },
      ...data.tour.map((stop) => {
        // A stop frames its group, never closer than a single station was framed before (site v4) nor as wide as home.
        const fit = fitView(built, free() / height, [home.dir], { top: 0.18, bottom: 0.1 }, stop.members);
        const close = opts.detail === "lite" ? 2.1 : 2.6;
        return { target: fit.target.clone(), width: clamp(fit.width * 1.12, home.width / close, home.width / 1.45), top: 0 };
      }),
    ];
  };

  // Where the camera is: `at` eases toward the page's `goal` (the scroll position, in stops).
  let goal = 0;
  let at = 0;
  let mode: Mode = "tour";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const drift = opts.drift && !reduced;
  /** Time the drift has run (it advances only while it runs, so it resumes where it stopped). */
  let driftClock = 0;
  /** The frame time until which the drift runs. */
  let driftUntil = 0;
  const right = new Vector3();
  const camUp = new Vector3();
  /** The tour's pose for the camera's place `at`, drifted by the time the drift has run. */
  const tourPose = (): Pose | null => {
    if (frames.length === 0) return null;
    const i = clamp(Math.floor(at), 0, frames.length - 1);
    const j = Math.min(i + 1, frames.length - 1);
    const t = ease(at - i);
    const a = frames[i] as (typeof frames)[number];
    const b = frames[j] as (typeof frames)[number];
    const target = a.target.clone().lerp(b.target, t);
    // Zoom in log space, so the scale changes evenly between a wide and a close view.
    const w = Math.exp(Math.log(a.width) + (Math.log(b.width) - Math.log(a.width)) * t);
    const topPx = Math.min(opts.coveredTop(), height * 0.4) * (a.top + (b.top - a.top) * t);
    const dir = homeDir.clone();
    if (drift) dir.applyAxisAngle(UP, 0.06 * Math.sin((driftClock / 26_000) * Math.PI * 2));
    // The machine (and a focused piece) centres in the part of the view the card and the head don't cover: the
    // camera's width is the free part's, widened to the whole view, and its centre moved by half of each cover.
    const full = (w * width) / free();
    const perPx = full / width;
    right.crossVectors(UP, dir).normalize();
    camUp.crossVectors(dir, right).normalize();
    const look = target.addScaledVector(right, ((width - free()) / 2) * perPx).addScaledVector(camUp, (topPx / 2) * perPx);
    return { dir, look, full };
  };
  const apply = (p: Pose) => {
    placeCamera(camera, p.dir, p.look, width / height, p.full);
    camera.updateMatrixWorld();
  };

  // Explore: three's OrbitControls, damped, its zoom and tilt bounded so the machine can't be lost or seen from under
  // the floor. It stays switched off in the tour, where it neither takes the wheel nor touch (the page scrolls).
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.zoomToCursor = true;
  controls.minZoom = 0.7;
  controls.maxZoom = 7;
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = 1.3;
  const touchAction = () => {
    canvas.style.touchAction = mode === "explore" ? "none" : "pan-y";
  };
  touchAction();
  // Panning stays over the machine: the target is kept inside the scene's floor plan.
  const lo = new Vector3(built.line.start - 1, 0, -6.5);
  const hi = new Vector3(built.line.end + 1, 2.5, 5);
  const kept = new Vector3();
  const keepInside = () => {
    kept.copy(controls.target).clamp(lo, hi).sub(controls.target);
    if (kept.lengthSq() === 0) return;
    controls.target.add(kept);
    camera.position.add(kept);
  };
  /** The explore camera's pose, read back (its width is the frustum's over its zoom). */
  const explorePose = (): Pose => ({
    dir: camera.position.clone().sub(controls.target).normalize(),
    look: controls.target.clone(),
    full: (camera.right - camera.left) / camera.zoom,
  });
  /** Leaving explore: the camera eases from where the reader left it back to the tour, over RETURN_MS. */
  let back: { from: Pose; start: number } | null = null;

  // What needs drawing. `scene` is the camera or the highlight (a new picture); `labels` is only where the buttons sit.
  let dirtyScene = true;
  let dirtyLabels = true;
  /** The labels' sizes are read in one pass when the layout could have changed them (never per frame). */
  let sizesDirty = true;
  let compact: boolean | null = null;

  const applyPixelRatio = () => {
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    dirtyScene = true;
  };
  const resize = () => {
    width = Math.max(1, viewport.clientWidth);
    height = Math.max(1, viewport.clientHeight);
    renderer.setSize(width, height, false);
    keyframes();
    if (mode === "explore") {
      // Keep the explore view's scale across the resize; only the aspect changes.
      const w = camera.right - camera.left;
      camera.top = w / (width / height) / 2;
      camera.bottom = -camera.top;
      camera.updateProjectionMatrix();
    }
    sizesDirty = true;
    dirtyScene = true;
    kick();
  };

  // The labels. Only the pieces that matter now carry one, the rest fade: in the tour, the stop's pieces and their
  // neighbours on the line (at the home view every station's number); in explore, the ones near the pointer (or the
  // view's centre on a touch screen). A pressed label always shows. Each is kept inside the view and moved up once
  // past a label it would cover; one that still collides is faded rather than stacked (site v5: no label collisions).
  // One pass per drawn frame: sizes are read together first (and only when they could have changed), then only the
  // transforms and classes that changed are written, so a frame never forces a layout in the middle of its writes.
  const tmp = new Vector3();
  const project = (pos: Vector3): [number, number] => {
    tmp.copy(pos).project(camera);
    return [(tmp.x * 0.5 + 0.5) * width, (-tmp.y * 0.5 + 0.5) * height];
  };
  let stopIndex = 0;
  let lit: readonly string[] = [];
  let hovered: string | null = null;
  let pointer: [number, number] | null = null;
  const nearSet = (): Set<string> | null => {
    if (mode === "explore") return null;
    if (stopIndex === 0) return new Set(line);
    const members = data.tour[stopIndex - 1]?.members ?? [];
    const out = new Set<string>(members);
    const idx = members.map((k) => line.indexOf(k)).filter((i) => i >= 0);
    if (idx.length) {
      const before = line[Math.min(...idx) - 1];
      const after = line[Math.max(...idx) + 1];
      if (before) out.add(before);
      if (after) out.add(after);
    }
    return out;
  };
  const measure = () => {
    for (const t of tags) {
      t.w = t.el.offsetWidth;
      t.h = t.el.offsetHeight;
    }
    sizesDirty = false;
  };
  const layout = () => {
    const home = mode === "tour" && at < 0.5;
    const nowCompact = width < 600 || home;
    if (nowCompact !== compact) {
      compact = nowCompact;
      tagLayer.classList.toggle("is-compact", nowCompact);
      sizesDirty = true;
    }
    if (sizesDirty) measure();
    const near = nearSet();
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const pressed = (t: Tag) => lit.includes(t.id) || t.id === hovered;
    // The pressed first, then the stations in line order, then the side pieces.
    const order = [...tags].sort((a, b) => Number(pressed(b)) - Number(pressed(a)));
    const cover = opts.coveredRight();
    const reach = Math.max(160, Math.min(width, height) * (pointer ? 0.32 : 0.45));
    const [px, py] = pointer ?? [(width - cover) / 2, height / 2];
    for (const t of order) {
      const anchor = built.anchors.get(t.id);
      if (!anchor) continue;
      let [x, y] = project(anchor);
      let show = pressed(t) || (near ? near.has(t.id) : Math.hypot(x - px, y - py) < reach);
      if (show && near && !pressed(t) && home && t.el.classList.contains("is-side")) show = width >= 1000;
      const w = t.w;
      const h = t.h;
      if (x < -w / 2 || x > width - cover + w / 2 || y < 0 || y > height + h) show = false;
      x = clamp(x, w / 2 + 4, width - w / 2 - 4);
      y = clamp(y, h + 4, height - 4);
      if (show) {
        const hits = (yy: number) => placed.find((r) => x - w / 2 < r.x1 + 3 && x + w / 2 > r.x0 - 3 && yy - h < r.y1 + 3 && yy > r.y0 - 3);
        const hit = hits(y);
        if (hit) {
          const up = hit.y0 - 4;
          if (up - h >= 4 && !hits(up)) y = up;
          else show = pressed(t) && placed.length === 0;
        }
      }
      // A hidden label stays where it was while it fades (moving it unseen would only count as a layout shift); it
      // takes its new place in the frame it shows again.
      if (show) {
        placed.push({ x0: x - w / 2, x1: x + w / 2, y0: y - h, y1: y });
        const tf = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
        if (tf !== t.transform) {
          t.transform = tf;
          t.el.style.transform = tf;
        }
      }
      if (t.far !== !show) {
        t.far = !show;
        t.el.classList.toggle("is-far", !show);
      }
    }
    dirtyLabels = false;
  };

  // Frames: only while the stage is mostly on screen and the tab is visible, and then only while something changes.
  let active = false;
  let raf = 0;
  let lastFrame = 0;
  let lastDrawn = 0;
  let drawn = 0;
  let lost = false;
  let destroyed = false;
  // Slow frames, judged while the camera moves (the drift's own 30 a second would look slow): the resolution steps down.
  let sampled = 0;
  let sampledMs = 0;
  const judge = (dt: number) => {
    sampledMs += dt;
    if (++sampled < SAMPLE_FRAMES) return;
    const mean = sampledMs / sampled;
    sampled = 0;
    sampledMs = 0;
    if (mean > SLOW_FRAME_MS && ratio > MIN_PIXEL_RATIO) {
      ratio = Math.max(MIN_PIXEL_RATIO, ratio * Math.min(0.85, WANTED_FRAME_MS / mean));
      applyPixelRatio();
    }
  };
  const info = () => ({
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    lines: renderer.info.render.lines,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    programs: renderer.info.programs?.length ?? 0,
    pixelRatio: ratio,
    frames: drawn,
  });
  canvas.aaFrames = 0;
  canvas.aaInfo = info;
  const kick = () => {
    if (!raf && active && !destroyed && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    lastFrame = 0;
  };
  const draw = () => {
    if (lost) return;
    renderer.render(built.scene, camera);
    drawn++;
    canvas.aaFrames = drawn;
    dirtyScene = false;
    layout();
  };
  function frame(now: number) {
    raf = 0;
    const dt = lastFrame ? Math.min(now - lastFrame, 100) : 1000 / 60;
    lastFrame = now;
    let again = false;
    if (mode === "explore") {
      const changed = controls.update();
      keepInside();
      if (changed || dirtyScene) {
        draw();
        if (changed) judge(dt);
      } else if (dirtyLabels) layout();
      again = changed;
    } else {
      const moving = Math.abs(goal - at) > 1e-3;
      // Eased by time, not by frame, so the camera takes as long at 30 frames a second as at 60.
      at = moving && !reduced ? at + (goal - at) * (1 - 0.86 ** (dt / (1000 / 60))) : goal;
      const returning = back !== null;
      const drifting = drift && now < driftUntil;
      if (drifting) driftClock += dt;
      // The drift alone needs no more than 30 frames a second.
      if (moving || returning || dirtyScene || (drifting && now - lastDrawn > DRIFT_FRAME_MS)) {
        lastDrawn = now;
        const p = tourPose();
        if (p && back) {
          const t = reduced ? 1 : smooth(clamp((now - back.start) / RETURN_MS, 0, 1));
          const f = back.from;
          p.dir = f.dir.clone().lerp(p.dir, t).normalize();
          p.look = f.look.clone().lerp(p.look, t);
          p.full = Math.exp(Math.log(f.full) + (Math.log(p.full) - Math.log(f.full)) * t);
          if (t >= 1) back = null;
        }
        if (p) apply(p);
        draw();
        if (moving || returning) judge(dt);
      } else if (dirtyLabels) layout();
      again = moving || back !== null || drifting;
    }
    if (again) kick();
    else lastFrame = 0;
  }
  /** The reader scrolled or moved: the drift runs for a few seconds from now. */
  const touched = () => {
    if (drift) driftUntil = performance.now() + DRIFT_HOLD_MS;
  };
  const announce = (on: boolean) => {
    const el = document.documentElement;
    if (on) el.dataset.aaMachine = "on";
    else delete el.dataset.aaMachine;
    document.dispatchEvent(new CustomEvent("aa:machine", { detail: { active: on } }));
  };
  const setActive = (on: boolean) => {
    if (on === active) return;
    active = on;
    announce(on);
    if (on) {
      // Catch up with wherever the scroll went while it was off screen.
      dirtyScene = true;
      kick();
    } else stop();
  };
  const ac = new AbortController();
  const { signal } = ac;
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : kick()), { signal });
  const io = new IntersectionObserver((entries) => setActive((entries.at(-1)?.intersectionRatio ?? 0) >= ACTIVE_SHARE), {
    threshold: [0, ACTIVE_SHARE, 1],
  });
  io.observe(viewport);
  controls.addEventListener("change", kick);
  canvas.addEventListener(
    "webglcontextlost",
    (e) => {
      e.preventDefault();
      lost = true;
    },
    { signal },
  );
  canvas.addEventListener(
    "webglcontextrestored",
    () => {
      lost = false;
      dirtyScene = true;
      kick();
    },
    { signal },
  );

  // Hover (a mouse) reports a piece; a press with no drag reports a tap.
  const ray = new Raycaster();
  // The pick geometry has no lines, but keep a small threshold in case an edge is ever added to it.
  ray.params.Line = { threshold: 0.02 };
  const ndc = new Vector2();
  const pieceAt = (e: PointerEvent): string | null => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    for (const h of ray.intersectObjects([...built.groups.values()], true)) {
      let o: typeof h.object | null = h.object;
      while (o && !o.userData.id) o = o.parent;
      if (o) return String(o.userData.id);
    }
    return null;
  };
  let pending: PointerEvent | null = null;
  let pickRaf = 0;
  // Where the mouse was before this move, page-wide. When the drift (or the scroll) slides a label out from under a
  // still mouse, the browser sends the canvas a move at the same spot; that is not the reader pointing somewhere new, so
  // it must not take the hover from the label they are on (it reset the pressed label after #92).
  let prevMouse: [number, number] | null = null;
  let lastMouse: [number, number] | null = null;
  addEventListener(
    "pointermove",
    (e) => {
      prevMouse = lastMouse;
      lastMouse = [e.clientX, e.clientY];
    },
    { capture: true, passive: true, signal },
  );
  canvas.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType !== "mouse") return;
      if (prevMouse && prevMouse[0] === e.clientX && prevMouse[1] === e.clientY) return;
      touched();
      kick();
      // One pick per frame at most, and only on a move.
      if (!pickRaf)
        pickRaf = requestAnimationFrame(() => {
          pickRaf = 0;
          const ev = pending;
          pending = null;
          if (!ev || destroyed) return;
          const r = canvas.getBoundingClientRect();
          pointer = [ev.clientX - r.left, ev.clientY - r.top];
          const k = ev.buttons ? hovered : pieceAt(ev);
          if (k !== hovered) {
            hovered = k;
            opts.onHover(k);
          }
          canvas.style.cursor = k ? "pointer" : mode === "explore" ? "grab" : "";
          if (mode === "explore") {
            dirtyLabels = true;
            kick();
          }
        });
      pending = e;
    },
    { signal },
  );
  canvas.addEventListener(
    "pointerleave",
    () => {
      // A move still waiting for its frame belongs to the canvas the pointer has left (onto a label, say): drop it, or
      // its late pick would replace the label's.
      pending = null;
      hovered = null;
      pointer = null;
      canvas.style.cursor = "";
      opts.onHover(null);
      dirtyLabels = true;
      kick();
    },
    { signal },
  );
  let down: [number, number] | null = null;
  canvas.addEventListener(
    "pointerdown",
    (e) => {
      down = [e.clientX, e.clientY];
    },
    { signal },
  );
  canvas.addEventListener(
    "pointerup",
    (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8) return;
      down = null;
      opts.onTap(pieceAt(e), e.pointerType);
    },
    { signal },
  );

  // First frame: compile the shaders off the main path where the browser can, then draw, then show the canvas over the
  // still (the page fades it in).
  width = Math.max(1, viewport.clientWidth);
  height = Math.max(1, viewport.clientHeight);
  renderer.setPixelRatio(ratio);
  renderer.setSize(width, height, false);
  keyframes();
  const first = tourPose();
  if (first) apply(first);
  // Shaders are compiled one material at a time (each compile after the other's task), so no one task holds the page:
  // a browser with parallel compile would not need it, a software renderer compiles on this thread.
  const parts = built.scene.children.filter((o) => o.visible && ((o as { isMesh?: boolean }).isMesh || (o as { isLine?: boolean }).isLine));
  for (const o of parts) o.visible = false;
  for (const o of parts) {
    o.visible = true;
    renderer.compile(built.scene, camera);
    o.visible = false;
    await yieldTask();
  }
  for (const o of parts) o.visible = true;
  draw();
  viewport.insertBefore(canvas, tagLayer);
  const ro = new ResizeObserver(resize);
  ro.observe(viewport);
  // Fonts arriving can change the labels' sizes.
  void document.fonts?.ready.then(() => {
    sizesDirty = true;
    dirtyLabels = true;
    kick();
  });
  kick();

  return {
    setProgress(f) {
      const next = clamp(f, 0, frames.length - 1);
      if (next === goal) return;
      goal = next;
      stopIndex = Math.round(goal);
      touched();
      dirtyLabels = true;
      kick();
    },
    highlight(keys) {
      if (keys.length === lit.length && keys.every((k, i) => lit[i] === k)) return;
      for (const k of lit) swapEdges(k, false);
      for (const k of keys) swapEdges(k, true);
      for (const [k, m] of built.marks) m.visible = keys.includes(k);
      for (const t of tags) t.el.setAttribute("aria-pressed", String(keys.includes(t.id)));
      lit = [...keys];
      // The pressed labels change size; draw now, even if the drift is between its frames.
      sizesDirty = true;
      dirtyScene = true;
      lastDrawn = 0;
      kick();
    },
    setMode(next) {
      if (next === mode) return;
      if (next === "explore") {
        // Hand the camera to the reader exactly where it is: the controls orbit the view's centre, at the home view's
        // scale, zoomed to match.
        const p = (back ? null : tourPose()) ?? explorePose();
        back = null;
        apply({ ...p, full: homeWidth * (width / free()) });
        camera.zoom = (homeWidth * (width / free())) / p.full;
        camera.updateProjectionMatrix();
        controls.target.copy(p.look);
        mode = "explore";
        controls.enabled = true;
        controls.update();
        canvas.style.cursor = "grab";
      } else {
        const from = explorePose();
        mode = "tour";
        controls.enabled = false;
        camera.zoom = 1;
        back = { from, start: performance.now() };
        canvas.style.cursor = "";
        pointer = null;
      }
      touchAction();
      sizesDirty = true;
      dirtyScene = true;
      lastDrawn = 0;
      kick();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      if (pickRaf) cancelAnimationFrame(pickRaf);
      ac.abort();
      io.disconnect();
      ro.disconnect();
      controls.dispose();
      built.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      delete document.documentElement.dataset.aaMachine;
      document.dispatchEvent(new CustomEvent("aa:machine", { detail: { active: false } }));
    },
  };
}
