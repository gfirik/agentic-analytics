// The engine machine's live view (DESIGN.md §6 "Engine machine", §7): the chunk EngineMachine.astro starts on idle
// after load, once the band is near. It draws machine-scene.ts with three.js over the still frame and
// places the station labels (the HTML buttons the server rendered) from projected coordinates. The page script owns
// the scroll position, the mode, the station card and the list; this module only moves the camera to where it is told
// (the tour) or hands it to the reader (explore: three's OrbitControls), highlights pieces, and reports which piece the
// pointer is over or taps. No wording or figure lives in this file.
// It renders only while the section is on screen and the tab is visible; the slow drift is off on phones (the lighter
// scene) and the section never mounts this module under reduced motion (the still frame and the list instead).
import { LineBasicMaterial, LineSegments, OrthographicCamera, Raycaster, SRGBColorSpace, Vector2, Vector3, WebGLRenderer } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
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
}

const $ = <T extends Element>(root: ParentNode, sel: string) => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`engine machine: missing ${sel}`);
  return el;
};
/** One task's break, so building the scene, compiling its shaders and the first frame never make one long task. */
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

/** A camera pose: the direction it looks from, the point at the view's centre and the scene width across the view. */
interface Pose {
  dir: Vector3;
  look: Vector3;
  full: number;
}

export async function mount(root: HTMLElement, data: MachineData, opts: MountOptions): Promise<Live> {
  const viewport = $<HTMLElement>(root, "[data-viewport]");
  const tagLayer = $<HTMLElement>(root, "[data-tags]");
  const tags = [...tagLayer.querySelectorAll<HTMLButtonElement>("[data-tag]")];

  const canvas = document.createElement("canvas");
  canvas.className = "aa-engine-canvas";
  canvas.setAttribute("aria-hidden", "true");
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "low-power" });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.detail === "lite" ? 1.5 : 2));
  await yieldTask();
  const built = buildMachine(data.scene, readTokens(document.documentElement), opts.detail);
  await yieldTask();

  // The highlight: the piece's edges turn ink (its own hairlines, swapped back when it is let go).
  const inkEdge = new LineBasicMaterial({ color: built.colors.ink });
  const swapEdges = (key: string, on: boolean) =>
    built.groups.get(key)?.traverse((o) => {
      if (!(o instanceof LineSegments)) return;
      if (on) {
        o.userData.edge ??= o.material;
        o.material = inkEdge;
      } else if (o.userData.edge) o.material = o.userData.edge as LineBasicMaterial;
    });

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
  const t0 = performance.now();
  const right = new Vector3();
  const camUp = new Vector3();
  /** The tour's pose for the camera's place `at`, drifting by `now`. */
  const tourPose = (now: number): Pose | null => {
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
    if (drift) dir.applyAxisAngle(UP, 0.06 * Math.sin(((now - t0) / 26_000) * Math.PI * 2));
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
    kick();
  };

  // The labels. Only the pieces that matter now carry one, the rest fade: in the tour, the stop's pieces and their
  // neighbours on the line (at the home view every station's number); in explore, the ones near the pointer (or the
  // view's centre on a touch screen). A pressed label always shows. Each is kept inside the view and moved up once
  // past a label it would cover; one that still collides is faded rather than stacked (site v5: no label collisions).
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
  const layout = () => {
    const home = mode === "tour" && at < 0.5;
    tagLayer.classList.toggle("is-compact", width < 600 || home);
    const near = nearSet();
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const pressed = (t: HTMLElement) => lit.includes(t.dataset.id ?? "") || t.dataset.id === hovered;
    // The pressed first, then the stations in line order, then the side pieces.
    const order = [...tags].sort((a, b) => Number(pressed(b)) - Number(pressed(a)));
    const cover = opts.coveredRight();
    const reach = Math.max(160, Math.min(width, height) * (pointer ? 0.32 : 0.45));
    const [px, py] = pointer ?? [(width - cover) / 2, height / 2];
    for (const t of order) {
      const id = t.dataset.id ?? "";
      const anchor = built.anchors.get(id);
      if (!anchor) continue;
      let [x, y] = project(anchor);
      let show = pressed(t) || (near ? near.has(id) : Math.hypot(x - px, y - py) < reach);
      if (show && near && !pressed(t) && home && t.classList.contains("is-side")) show = width >= 1000;
      const w = t.offsetWidth;
      const h = t.offsetHeight;
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
        t.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      }
      t.classList.toggle("is-far", !show);
    }
  };

  // Frames only while on screen and the tab is visible: continuously while the camera drifts, eases or is handled, else
  // on demand.
  let onScreen = true;
  let raf = 0;
  let lastDrawn = 0;
  const kick = () => {
    if (!raf && onScreen && !document.hidden) raf = requestAnimationFrame(frame);
  };
  function frame(now: number) {
    raf = 0;
    if (mode === "explore") {
      const changed = controls.update();
      keepInside();
      renderer.render(built.scene, camera);
      layout();
      if (changed) kick();
      return;
    }
    const moving = Math.abs(goal - at) > 1e-3;
    at = moving && !reduced ? at + (goal - at) * 0.14 : goal;
    const returning = back !== null;
    // The drift alone needs no more than 30 frames a second.
    if (moving || returning || !drift || now - lastDrawn > 30) {
      lastDrawn = now;
      const p = tourPose(now);
      if (p && back) {
        const t = reduced ? 1 : smooth(clamp((now - back.start) / RETURN_MS, 0, 1));
        const f = back.from;
        p.dir = f.dir.clone().lerp(p.dir, t).normalize();
        p.look = f.look.clone().lerp(p.look, t);
        p.full = Math.exp(Math.log(f.full) + (Math.log(p.full) - Math.log(f.full)) * t);
        if (t >= 1) back = null;
      }
      if (p) apply(p);
      renderer.render(built.scene, camera);
      layout();
    }
    if (moving || drift || back) kick();
  }
  document.addEventListener("visibilitychange", () => (document.hidden ? cancel() : kick()));
  const cancel = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
  new IntersectionObserver(([e]) => {
    onScreen = e?.isIntersecting ?? true;
    if (onScreen) kick();
    else cancel();
  }).observe(viewport);
  controls.addEventListener("change", kick);

  // Hover (a mouse) reports a piece; a press with no drag reports a tap.
  const ray = new Raycaster();
  // The stations' hairline edges are LineSegments: with three's default 1-unit threshold a neighbour's edge near the
  // pointer could win the pick.
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
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    // One pick per frame at most.
    if (!pending)
      requestAnimationFrame(() => {
        const ev = pending;
        pending = null;
        if (!ev) return;
        const r = canvas.getBoundingClientRect();
        pointer = [ev.clientX - r.left, ev.clientY - r.top];
        const k = ev.buttons ? hovered : pieceAt(ev);
        if (k !== hovered) {
          hovered = k;
          opts.onHover(k);
        }
        canvas.style.cursor = k ? "pointer" : mode === "explore" ? "grab" : "";
        if (mode === "explore") kick();
      });
    pending = e;
  });
  canvas.addEventListener("pointerleave", () => {
    hovered = null;
    pointer = null;
    canvas.style.cursor = "";
    opts.onHover(null);
    kick();
  });
  let down: [number, number] | null = null;
  canvas.addEventListener("pointerdown", (e) => {
    down = [e.clientX, e.clientY];
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8) return;
    down = null;
    opts.onTap(pieceAt(e), e.pointerType);
  });

  // First frame: compile the shaders off the main path where the browser can, then draw, then show the canvas over the
  // still (the page fades it in).
  width = Math.max(1, viewport.clientWidth);
  height = Math.max(1, viewport.clientHeight);
  renderer.setSize(width, height, false);
  keyframes();
  const first = tourPose(t0);
  if (first) apply(first);
  await renderer.compileAsync(built.scene, camera);
  await yieldTask();
  renderer.render(built.scene, camera);
  viewport.insertBefore(canvas, tagLayer);
  layout();
  new ResizeObserver(resize).observe(viewport);
  kick();

  return {
    setProgress(f) {
      goal = clamp(f, 0, frames.length - 1);
      stopIndex = Math.round(goal);
      kick();
    },
    highlight(keys) {
      if (keys.length === lit.length && keys.every((k, i) => lit[i] === k)) return;
      for (const k of lit) swapEdges(k, false);
      for (const k of keys) swapEdges(k, true);
      for (const [k, m] of built.marks) m.visible = keys.includes(k);
      for (const t of tags) t.setAttribute("aria-pressed", String(keys.includes(t.dataset.id ?? "")));
      lit = [...keys];
      kick();
      // Draw now, even if the drift is between its frames.
      lastDrawn = 0;
    },
    setMode(next) {
      if (next === mode) return;
      if (next === "explore") {
        // Hand the camera to the reader exactly where it is: the controls orbit the view's centre, at the home view's
        // scale, zoomed to match.
        const p = (back ? null : tourPose(performance.now())) ?? explorePose();
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
      lastDrawn = 0;
      kick();
    },
  };
}
