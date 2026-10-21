// The engine machine's interactive view (DESIGN.md §6 "Engine machine", §7): the lazy chunk EngineMachine.astro
// fetches on intent (hover, focus or pointerdown on "Open the machine") and runs on click. It draws machine-scene.ts
// with three.js and wires the HTML the server already rendered: the station labels (buttons placed from projected
// coordinates), the view buttons, the guided modes and the sheet, whose content is cloned from the station list and
// the server's templates, so no wording or figure lives in this file.
// Nothing moves by itself: frames are drawn only on the reader's input (drag, a view button, a guided mode) and while
// that input settles. Under reduced motion the camera jumps and "Run the line" shows its end state, still.
import { OrthographicCamera, Raycaster, SRGBColorSpace, Vector2, Vector3, WebGLRenderer } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  buildMachine,
  FRONT_DIR,
  fitView,
  HOME_DIRS,
  placeCamera,
  readTokens,
  type SceneInput,
  TOP_DIR,
  type View,
} from "./machine-scene.ts";

export interface MachineData {
  readonly scene: SceneInput;
  /** The tour's stops, in order. */
  readonly tour: readonly string[];
  /** The station each "Follow" step stops at. */
  readonly follow: readonly string[];
}

export interface Machine {
  show(): void;
  hide(): void;
}

const $ = <T extends Element>(root: ParentNode, sel: string) => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`engine machine: missing ${sel}`);
  return el;
};

export function mount(stage: HTMLElement, list: HTMLElement, data: MachineData): Machine {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const viewport = $<HTMLElement>(stage, "[data-viewport]");
  const canvas = $<HTMLCanvasElement>(stage, "[data-canvas]");
  const tagLayer = $<HTMLElement>(stage, "[data-tags]");
  const badge = $<HTMLElement>(stage, "[data-badge]");
  const kicker = $<HTMLElement>(stage, "[data-sheet-kicker]");
  const title = $<HTMLElement>(stage, "[data-sheet-title]");
  const body = $<HTMLElement>(stage, "[data-sheet-body]");
  const steps = $<HTMLElement>(stage, "[data-steps]");
  const count = $<HTMLElement>(stage, "[data-step-count]");
  const prev = $<HTMLButtonElement>(stage, "[data-step-prev]");
  const next = $<HTMLButtonElement>(stage, "[data-step-next]");
  const progress = $<HTMLElement>(stage, "[data-progress]");
  const guide = (k: string) => $<HTMLButtonElement>(stage, `[data-guide="${k}"]`);
  const tags = [...tagLayer.querySelectorAll<HTMLButtonElement>("[data-tag]")];

  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const built = buildMachine(data.scene, readTokens(document.documentElement));
  const camera = new OrthographicCamera();
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !reduced;
  controls.dampingFactor = 0.08;
  controls.minPolarAngle = 0.25;
  controls.maxPolarAngle = 1.3;
  controls.minZoom = 0.6;
  controls.maxZoom = 5;
  controls.screenSpacePanning = true;

  let width = 1;
  let height = 1;
  let visible = true;
  const goal = new Vector3();
  let zoomGoal: number | null = null;
  // The view is fitted to the machine's bounds for the canvas's own aspect (the home view also picks the direction
  // that draws it largest), so a phone's square canvas isn't mostly empty.
  let view: View | null = null;
  // From 40rem the legend sits top left and the toolbar is one row; on a phone the toolbar wraps to two.
  const margin = () => (width >= 640 ? { top: 0.3, bottom: 0.16 } : { top: 0.12, bottom: 0.24 });
  const setView = (dirs: readonly Vector3[], zoom: number) => {
    view = fitView(built, width / height, dirs, margin());
    placeCamera(camera, view.dir, view.target, width / height, view.width);
    controls.target.copy(view.target);
    goal.copy(view.target);
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    zoomGoal = null;
    kick();
  };
  const resize = () => {
    width = Math.max(1, viewport.clientWidth);
    height = Math.max(1, viewport.clientHeight);
    renderer.setSize(width, height, false);
    if (view) {
      // Keep where the reader is looking; refit only the frustum to the new aspect.
      const w = fitView(built, width / height, [view.dir], margin()).width;
      camera.left = -w / 2;
      camera.right = w / 2;
      camera.top = w / (width / height) / 2;
      camera.bottom = -camera.top;
      camera.updateProjectionMatrix();
    }
    kick();
  };

  // Frames on demand: one frame per input, and more only while the camera settles or the line runs.
  let raf = 0;
  let last = 0;
  let flowing = false;
  const kick = () => {
    if (!raf && visible) raf = requestAnimationFrame(frame);
  };
  const tmp = new Vector3();
  const project = (pos: Vector3): [number, number] => {
    tmp.copy(pos).project(camera);
    return [(tmp.x * 0.5 + 0.5) * width, (-tmp.y * 0.5 + 0.5) * height];
  };
  const put = (el: HTMLElement, x: number, y: number, shown: boolean) => {
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    el.style.visibility = shown ? "visible" : "hidden";
  };
  /**
   * The labels, from their anchors' projected positions: kept inside the canvas, and moved up past a label they would
   * cover (the pressed one first, then the stations in line order, then the side pieces).
   */
  const layout = () => {
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const order = [...tags].sort(
      (a, b) => Number(b.getAttribute("aria-pressed") === "true") - Number(a.getAttribute("aria-pressed") === "true"),
    );
    for (const t of order) {
      const a = built.anchors.get(t.dataset.id ?? "");
      if (!a) continue;
      const w = t.offsetWidth;
      const h = t.offsetHeight;
      let [x, y] = project(a);
      const off = x < -w / 2 || x > width + w / 2 || y < 0 || y > height + h;
      x = Math.min(Math.max(x, w / 2 + 4), width - w / 2 - 4);
      y = Math.min(Math.max(y, h + 4), height - 4);
      for (let k = 0; k < placed.length; k++) {
        const hit = placed.find((r) => x - w / 2 < r.x1 + 2 && x + w / 2 > r.x0 - 2 && y - h < r.y1 + 2 && y > r.y0 - 2);
        if (!hit) break;
        y = hit.y0 - 3;
      }
      y = Math.max(y, h + 4);
      placed.push({ x0: x - w / 2, x1: x + w / 2, y0: y - h, y1: y });
      put(t, x, y, !off);
    }
  };
  let badgeAt: string | null = null;
  function frame(now: number) {
    raf = 0;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    let moving = false;
    if (!reduced) {
      const d = goal.clone().sub(controls.target).multiplyScalar(0.12);
      if (d.lengthSq() > 1e-6) {
        controls.target.add(d);
        camera.position.add(d);
        moving = true;
      }
      if (zoomGoal !== null) {
        camera.zoom += (zoomGoal - camera.zoom) * 0.12;
        camera.updateProjectionMatrix();
        if (Math.abs(zoomGoal - camera.zoom) < 0.004) zoomGoal = null;
        moving = true;
      }
    }
    if (controls.update()) moving = true;
    if (flowing && !reduced) {
      built.packets.step(dt, true);
      moving = true;
    }
    renderer.render(built.scene, camera);
    tagLayer.classList.toggle("is-compact", width < 600 || (camera.zoom < 1.6 && width < 1000));
    layout();
    const ba = badgeAt ? built.anchors.get(badgeAt) : undefined;
    if (ba) {
      const [x, y] = project(new Vector3(ba.x, ba.y + 0.7, ba.z));
      const w = badge.offsetWidth;
      put(badge, Math.min(Math.max(x, w / 2 + 4), width - w / 2 - 4), Math.max(y, badge.offsetHeight + 4), true);
    }
    if (moving) kick();
    else last = 0;
  }
  controls.addEventListener("change", kick);

  const focusOn = (key: string | null, zoom: number) => {
    const v = key ? built.focus.get(key) : view?.target;
    if (!v) return;
    goal.copy(v);
    zoomGoal = zoom;
    if (reduced) {
      const d = goal.clone().sub(controls.target);
      controls.target.add(d);
      camera.position.add(d);
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
      zoomGoal = null;
    }
    kick();
  };
  const highlight = (key: string | null) => {
    for (const [k, m] of built.marks) m.visible = k === key;
    for (const t of tags) t.setAttribute("aria-pressed", String(t.dataset.id === key));
    kick();
  };

  // The sheet: the station's own entry in the HTML list, or a server-rendered template.
  const fill = (k: string, t: string, content: Node | null) => {
    kicker.textContent = k;
    title.textContent = t;
    body.replaceChildren(...(content ? [content] : []));
    body.scrollTop = 0;
  };
  const stationSheet = (key: string, prefix?: string) => {
    const li = list.querySelector<HTMLElement>(`[data-station="${key}"]`);
    if (!li) return;
    const k = li.querySelector(".aa-station-kicker")?.textContent ?? "";
    fill(
      prefix ? `${prefix} · ${k}` : k,
      li.querySelector(".aa-station-title")?.textContent ?? "",
      li.querySelector(".aa-station-body")?.cloneNode(true) ?? null,
    );
  };
  const template = (sel: string) =>
    (stage.querySelector<HTMLTemplateElement>(sel)?.content.cloneNode(true) as DocumentFragment | undefined) ?? null;
  const overview = () => {
    const t = template('template[data-sheet-for="overview"]');
    const head = t?.querySelector("[data-head]");
    fill(head?.getAttribute("data-kicker") ?? "", head?.getAttribute("data-title") ?? "", t);
  };

  // Guided modes: the tour (every station and both side pieces) and "Follow" (the headline fact, stop by stop).
  let mode: "tour" | "follow" | null = null;
  let at = 0;
  const total = () => (mode === "tour" ? data.tour.length : data.follow.length);
  const setPressed = () => {
    guide("tour").setAttribute("aria-pressed", String(mode === "tour"));
    guide("follow").setAttribute("aria-pressed", String(mode === "follow"));
  };
  const renderStep = () => {
    const n = total();
    progress.replaceChildren(
      ...Array.from({ length: n }, (_, i) => {
        const b = document.createElement("i");
        if (i <= at) b.className = "is-on";
        return b;
      }),
    );
    count.textContent = `${at + 1} / ${n}`;
    prev.setAttribute("aria-disabled", String(at === 0));
    next.textContent = at === n - 1 ? "Start again" : "Next";
    if (mode === "tour") {
      const key = data.tour[at] ?? "";
      stationSheet(key, `Tour · stop ${at + 1} of ${n}`);
      highlight(key);
      badgeAt = null;
      badge.hidden = true;
      focusOn(key, key === "vault" || key === "models" ? 1.6 : 2.4);
      return;
    }
    const key = data.follow[at] ?? "";
    const t = template(`template[data-follow-step="${at}"]`);
    const head = t?.querySelector("[data-head]");
    fill(head?.getAttribute("data-kicker") ?? "", head?.getAttribute("data-title") ?? "", t);
    highlight(key);
    badge.textContent = head?.getAttribute("data-badge") ?? "";
    badge.classList.toggle("is-verified", head?.hasAttribute("data-verified") ?? false);
    badge.hidden = false;
    badgeAt = key;
    focusOn(key, 2.8);
  };
  const start = (m: "tour" | "follow") => {
    mode = m;
    // Under reduced motion a guided mode opens at its end state: the last stop, with no camera move.
    // Back still steps through it.
    at = reduced ? (m === "tour" ? data.tour.length : data.follow.length) - 1 : 0;
    steps.hidden = false;
    setPressed();
    renderStep();
  };
  const end = () => {
    mode = null;
    steps.hidden = true;
    badge.hidden = true;
    badgeAt = null;
    setPressed();
    highlight(null);
    focusOn(null, 1);
    overview();
  };
  const select = (key: string) => {
    if (mode) {
      mode = null;
      steps.hidden = true;
      badge.hidden = true;
      badgeAt = null;
      setPressed();
    }
    stationSheet(key);
    highlight(key);
    focusOn(key, key === "vault" || key === "models" ? 1.6 : 2.2);
  };

  guide("tour").addEventListener("click", () => (mode === "tour" ? end() : start("tour")));
  guide("follow").addEventListener("click", () => (mode === "follow" ? end() : start("follow")));
  prev.addEventListener("click", () => {
    if (at > 0) {
      at--;
      renderStep();
    }
  });
  next.addEventListener("click", () => {
    at = at === total() - 1 ? 0 : at + 1;
    renderStep();
  });
  $<HTMLButtonElement>(stage, "[data-step-close]").addEventListener("click", end);
  for (const t of tags) t.addEventListener("click", () => select(t.dataset.id ?? ""));

  // "Run the line": packets move down the belt while it runs; under reduced motion it shows the end state, still.
  const flow = guide("flow");
  flow.addEventListener("click", () => {
    flowing = !flowing;
    flow.setAttribute("aria-pressed", String(flowing));
    if (reduced) {
      if (flowing) built.packets.still();
      else built.packets.clear();
    } else if (!flowing) built.packets.clear();
    kick();
  });

  // The view buttons.
  const zoomBy = (f: number) => {
    const z = Math.min(controls.maxZoom, Math.max(controls.minZoom, (zoomGoal ?? camera.zoom) * f));
    if (reduced) {
      camera.zoom = z;
      camera.updateProjectionMatrix();
    } else zoomGoal = z;
    kick();
  };
  const views: Record<string, () => void> = {
    in: () => zoomBy(1.35),
    out: () => zoomBy(1 / 1.35),
    front: () => setView([FRONT_DIR], 1),
    top: () => setView([TOP_DIR], 1),
    reset: () => setView(HOME_DIRS, 1),
  };
  for (const b of stage.querySelectorAll<HTMLButtonElement>("[data-view]"))
    b.addEventListener("click", () => views[b.dataset.view ?? ""]?.());

  // Click (not drag) on a machine in the scene selects it.
  const ray = new Raycaster();
  const ndc = new Vector2();
  let down: [number, number] | null = null;
  canvas.addEventListener("pointerdown", (e) => {
    down = [e.clientX, e.clientY];
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    for (const h of ray.intersectObjects([...built.groups.values()], true)) {
      let o: typeof h.object | null = h.object;
      while (o && !o.userData.id) o = o.parent;
      if (o) return select(String(o.userData.id));
    }
  });

  new ResizeObserver(resize).observe(viewport);
  if (typeof IntersectionObserver !== "undefined")
    new IntersectionObserver(([e]) => {
      visible = e?.isIntersecting ?? true;
      if (visible) kick();
    }).observe(viewport);
  resize();
  setView(HOME_DIRS, 1);
  overview();

  return {
    show() {
      visible = true;
      resize();
    },
    hide() {
      visible = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
