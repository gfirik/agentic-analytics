// The engine machine's live view (DESIGN.md §6 "Engine machine", §7): the chunk EngineMachine.astro starts on idle
// after load, once the band is near. It draws machine-scene.ts with three.js over the still frame and
// places the station labels (the HTML buttons the server rendered) from projected coordinates. The page script owns
// the scroll position, the station card and the list; this module only moves the camera to where it is told, highlights
// a piece, and reports which piece the pointer is over. No wording or figure lives in this file.
// It renders only while the section is on screen and the tab is visible; the slow drift is off on phones (the lighter
// scene) and the section never mounts this module under reduced motion (the still frame and the list instead).
import { LineBasicMaterial, LineSegments, OrthographicCamera, Raycaster, SRGBColorSpace, Vector2, Vector3, WebGLRenderer } from "three";
import { buildMachine, type Detail, fitView, placeCamera, readTokens, type SceneInput, type View } from "./machine-scene.ts";

export interface MachineData {
  readonly scene: SceneInput;
  /** The scroll tour's stops after the home view, in order (station and side-piece keys). */
  readonly tour: readonly string[];
}

export interface MountOptions {
  readonly detail: Detail;
  /** The slow camera drift (desktop only). */
  readonly drift: boolean;
  /** The pointer is over a piece (or none): the page shows its card. */
  readonly onHover: (key: string | null) => void;
  /** A tap (no drag) on a piece: the page selects it. */
  readonly onPick: (key: string) => void;
  /** How many CSS pixels on the right of the view an overlay (the station card) covers, so a focused piece centres in the rest. */
  readonly coveredRight: () => number;
}

export interface Live {
  /** Where the camera is on the tour: 0 is the home view, k the k-th stop; fractions ease between them. */
  setProgress(f: number): void;
  /** The piece to highlight (its edges in ink, its floor mark, its label pressed), or none. */
  highlight(key: string | null): void;
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

  const camera = new OrthographicCamera();
  let width = 1;
  let height = 1;
  let home: View | null = null;
  /** The tour's keyframes: the home view, then each stop's target and the scene width it shows. */
  let frames: { target: Vector3; width: number }[] = [];
  const zoomOf = (key: string) => (key === "vault" || key === "models" ? 1.7 : opts.detail === "lite" ? 2.1 : 2.6);
  // The part of the view the card leaves free: the home view fits the machine into it, as the still frame does.
  const free = () => Math.max(1, width - opts.coveredRight());
  const keyframes = () => {
    home = fitView(built, free() / height);
    const h = home;
    frames = [
      { target: h.target.clone(), width: h.width },
      ...data.tour.map((k) => ({ target: (built.focus.get(k) ?? h.target).clone(), width: h.width / zoomOf(k) })),
    ];
  };
  const resize = () => {
    width = Math.max(1, viewport.clientWidth);
    height = Math.max(1, viewport.clientHeight);
    renderer.setSize(width, height, false);
    keyframes();
    kick();
  };

  // Where the camera is: `at` eases toward the page's `goal` (the scroll position, in stops).
  let goal = 0;
  let at = 0;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const drift = opts.drift && !reduced;
  const t0 = performance.now();
  const right = new Vector3();
  const pose = (now: number) => {
    const h = home;
    if (!h || frames.length === 0) return;
    const i = clamp(Math.floor(at), 0, frames.length - 1);
    const j = Math.min(i + 1, frames.length - 1);
    const t = ease(at - i);
    const a = frames[i] as (typeof frames)[number];
    const b = frames[j] as (typeof frames)[number];
    const target = a.target.clone().lerp(b.target, t);
    // Zoom in log space, so the scale changes evenly between a wide and a close view.
    const w = Math.exp(Math.log(a.width) + (Math.log(b.width) - Math.log(a.width)) * t);
    // The machine (and a focused piece) centres in the part of the view the card doesn't cover: the camera's width is
    // the free part's, widened to the whole view, and shifted by half the cover.
    const full = (w * width) / free();
    const shift = (full - w) / 2;
    const dir = h.dir.clone();
    if (drift) dir.applyAxisAngle(new Vector3(0, 1, 0), 0.06 * Math.sin(((now - t0) / 26_000) * Math.PI * 2));
    placeCamera(camera, dir, target, width / height, full);
    camera.updateMatrixWorld();
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    camera.position.addScaledVector(right, shift);
  };

  // The labels, from their anchors' projected positions: kept inside the view, and moved up past a label they would
  // cover (the pressed one first, then the stations in line order, then the side pieces).
  const tmp = new Vector3();
  const project = (pos: Vector3): [number, number] => {
    tmp.copy(pos).project(camera);
    return [(tmp.x * 0.5 + 0.5) * width, (-tmp.y * 0.5 + 0.5) * height];
  };
  const layout = () => {
    tagLayer.classList.toggle("is-compact", width < 600 || (at < 0.5 && width < 1000));
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const order = [...tags].sort(
      (a, b) => Number(b.getAttribute("aria-pressed") === "true") - Number(a.getAttribute("aria-pressed") === "true"),
    );
    const cover = opts.coveredRight();
    for (const t of order) {
      const anchor = built.anchors.get(t.dataset.id ?? "");
      if (!anchor) continue;
      const w = t.offsetWidth;
      const h = t.offsetHeight;
      let [x, y] = project(anchor);
      const off = x < -w / 2 || x > width - cover + w / 2 || y < 0 || y > height + h;
      x = clamp(x, w / 2 + 4, width - w / 2 - 4);
      y = clamp(y, h + 4, height - 4);
      for (let k = 0; k < placed.length; k++) {
        const hit = placed.find((r) => x - w / 2 < r.x1 + 2 && x + w / 2 > r.x0 - 2 && y - h < r.y1 + 2 && y > r.y0 - 2);
        if (!hit) break;
        y = hit.y0 - 3;
      }
      y = Math.max(y, h + 4);
      placed.push({ x0: x - w / 2, x1: x + w / 2, y0: y - h, y1: y });
      t.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      t.style.visibility = off ? "hidden" : "visible";
    }
  };

  // Frames only while on screen and the tab is visible: continuously while the camera drifts or eases, else on demand.
  let onScreen = true;
  let raf = 0;
  let lastDrawn = 0;
  const kick = () => {
    if (!raf && onScreen && !document.hidden) raf = requestAnimationFrame(frame);
  };
  function frame(now: number) {
    raf = 0;
    const moving = Math.abs(goal - at) > 1e-3;
    at = moving ? at + (goal - at) * 0.14 : goal;
    // The drift alone needs no more than 30 frames a second.
    if (moving || !drift || now - lastDrawn > 30) {
      lastDrawn = now;
      pose(now);
      renderer.render(built.scene, camera);
      layout();
    }
    if (moving || drift) kick();
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

  // Hover (a mouse) shows a piece's card; a tap with no drag picks it.
  const ray = new Raycaster();
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
  let hovered: string | null = null;
  let pending: PointerEvent | null = null;
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    // One pick per frame at most.
    if (!pending)
      requestAnimationFrame(() => {
        const ev = pending;
        pending = null;
        if (!ev) return;
        const k = pieceAt(ev);
        if (k !== hovered) {
          hovered = k;
          canvas.style.cursor = k ? "pointer" : "";
          opts.onHover(k);
        }
      });
    pending = e;
  });
  canvas.addEventListener("pointerleave", () => {
    hovered = null;
    canvas.style.cursor = "";
  });
  let down: [number, number] | null = null;
  canvas.addEventListener("pointerdown", (e) => {
    down = [e.clientX, e.clientY];
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8) return;
    const k = pieceAt(e);
    if (k) opts.onPick(k);
  });

  // First frame: compile the shaders off the main path where the browser can, then draw, then show the canvas over the
  // still (the page fades it in).
  width = Math.max(1, viewport.clientWidth);
  height = Math.max(1, viewport.clientHeight);
  renderer.setSize(width, height, false);
  keyframes();
  pose(t0);
  await renderer.compileAsync(built.scene, camera);
  await yieldTask();
  renderer.render(built.scene, camera);
  viewport.insertBefore(canvas, tagLayer);
  layout();
  new ResizeObserver(resize).observe(viewport);
  kick();

  let lit: string | null = null;
  return {
    setProgress(f) {
      goal = clamp(f, 0, frames.length - 1);
      if (reduced) at = goal;
      kick();
    },
    highlight(key) {
      if (key === lit) return;
      if (lit) swapEdges(lit, false);
      if (key) swapEdges(key, true);
      for (const [k, m] of built.marks) m.visible = k === key;
      for (const t of tags) t.setAttribute("aria-pressed", String(t.dataset.id === key));
      lit = key;
      kick();
      // Draw now, even if the drift is between its frames.
      lastDrawn = 0;
    },
  };
}
