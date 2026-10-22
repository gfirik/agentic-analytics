// The engine machine's 3D scene (DESIGN.md §6 "Engine machine", the one 3D exception in §1/§2.6/§9): the pipeline as a
// factory line of solid, lit models. One hemisphere light and one directional light, both in token colours, shade
// Lambert surfaces (no shadow maps, no glow, no tone mapping); the model rooms' glass is a translucent pane; hairline
// edges in a token tone keep each part's outline against the page. The verifier's gate lights are unlit, so the green of
// a passed check is exactly `--aa-verified`. Every colour is a CSS token read at runtime (readTokens), set as sRGB so
// three's colour management hands it back unchanged on the sRGB canvas.
// Used by the client module (machine-3d.ts) and, at build time, by scripts/site-assets.ts for the still frames, so the
// still and the live view are one scene. It imports only from "three" (ES modules, tree-shaken).
import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  Color,
  CubicBezierCurve3,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  GridHelper,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Object3D,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";

/** The tokens the scene draws with (apps/docs/src/styles/tokens.css). */
export const TONES = {
  page: "--aa-page",
  grid: "--aa-grid",
  raised: "--aa-raised",
  surface: "--aa-surface",
  mark: "--aa-mark",
  rule: "--aa-rule",
  ruleStrong: "--aa-rule-strong",
  ink: "--aa-ink",
  ink2: "--aa-ink-2",
  ink3: "--aa-ink-3",
  verified: "--aa-verified",
} as const;
export type Tone = keyof typeof TONES;
export type Tokens = Readonly<Record<Tone, string>>;

/** The tokens as the page has them (getComputedStyle), so no colour is typed twice. */
export function readTokens(el: Element): Tokens {
  const cs = getComputedStyle(el);
  const out = {} as Record<Tone, string>;
  for (const [k, v] of Object.entries(TONES) as [Tone, string][]) out[k] = cs.getPropertyValue(v).trim();
  return out;
}

export type SceneKind = "doors" | "code" | "model" | "analysis" | "verify" | "render";
export type SceneRole = "planner" | "extractor" | "judge";
export interface SceneStation {
  readonly key: string;
  readonly kind: SceneKind;
  readonly calls: readonly SceneRole[];
  readonly spur?: boolean;
}
export interface SceneInput {
  /** The stations on the line, in order. */
  readonly stations: readonly SceneStation[];
  /** Each verifier check the run ran, with how many claims it failed (one gate light each). */
  readonly checks: readonly { readonly check: string; readonly failed: number }[];
}

/** How finely curved parts are drawn: "lite" for phones (fewer segments), "full" elsewhere and for the stills. */
export type Detail = "full" | "lite";

/** Each kind's footprint along the line: stations are laid out edge to edge from these, then centred. */
const FOOTPRINT: Record<SceneKind, number> = { doors: 4.2, code: 3, model: 3, analysis: 4.4, verify: 3, render: 3.8 };
const VAULT_Z = 3.7;
const ROOM_Z = -4.6;
const SPUR_Z = -1.8;

/**
 * The lights. Lambert shading in three is linear, so with these the top of a white part renders at the raised tone,
 * the faces toward the light a step darker, and the faces away from it about the surface tone's next step down: the
 * shading stays inside the page's own greys. Calibrated against the stills (scripts/site-assets.ts).
 */
const LIGHT = { hemi: 2.35, sun: 1.0, sunDir: new Vector3(-4, 10, 6) } as const;

export interface Built {
  readonly scene: Scene;
  /** Each piece's group (stations, "vault", "models"), for picking. */
  readonly groups: ReadonlyMap<string, Group>;
  /** The floor mark under each piece, shown when it is highlighted. */
  readonly marks: ReadonlyMap<string, Mesh>;
  /** Where each piece's HTML label sits, and where the camera looks when it is focused. */
  readonly anchors: ReadonlyMap<string, Vector3>;
  readonly focus: ReadonlyMap<string, Vector3>;
  readonly line: { readonly start: number; readonly end: number };
  /** Where each station sits on the line. */
  readonly x: ReadonlyMap<string, number>;
  readonly colors: Readonly<Record<Tone, Color>>;
}

/** The scene, built from the station list and the tokens. */
export function buildMachine(input: SceneInput, tokens: Tokens, detail: Detail = "full"): Built {
  const colors = {} as Record<Tone, Color>;
  for (const k of Object.keys(TONES) as Tone[]) colors[k] = new Color().setStyle(tokens[k], SRGBColorSpace);
  const seg = detail === "lite" ? { cyl: 12, sph: [10, 8] as const, pipe: 6 } : { cyl: 28, sph: [20, 14] as const, pipe: 12 };
  const lit = (k: Tone) => new MeshLambertMaterial({ color: colors[k] });
  const M = {
    page: new MeshBasicMaterial({ color: colors.page }),
    body: lit("raised"),
    part: lit("surface"),
    belt: lit("rule"),
    dark: lit("ink2"),
    ink: lit("ink"),
    pipe: lit("ruleStrong"),
    // The highlight under a piece: the mark wash, unlit so it reads as the page's own tone.
    mark: new MeshBasicMaterial({ color: colors.mark }),
    // The gate lights are unlit: a passed check is exactly the verified token, a failed one exactly ink.
    pass: new MeshBasicMaterial({ color: colors.verified, transparent: true, opacity: 1 }),
    fail: new MeshBasicMaterial({ color: colors.ink, transparent: true, opacity: 1 }),
    // Glass: a pane of the mark tone, translucent, that never hides what is behind it from the depth test.
    glass: new MeshLambertMaterial({
      color: colors.mark,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      side: DoubleSide,
    }),
  };
  const edgeMat = new LineBasicMaterial({ color: colors.ruleStrong });
  const glassEdge = new LineBasicMaterial({ color: colors.ink3 });
  const cableMat = new LineDashedMaterial({ color: colors.ink2, dashSize: 0.18, gapSize: 0.12 });

  const scene = new Scene();
  scene.background = colors.page;
  const hemi = new HemisphereLight(colors.raised, colors.surface, LIGHT.hemi);
  scene.add(hemi);
  const sun = new DirectionalLight(colors.raised, LIGHT.sun);
  sun.position.copy(LIGHT.sunDir);
  scene.add(sun);

  const groups = new Map<string, Group>();
  const marks = new Map<string, Mesh>();
  const anchors = new Map<string, Vector3>();
  const focus = new Map<string, Vector3>();

  const edges = (g: BufferGeometry, mat: LineBasicMaterial = edgeMat) => new LineSegments(new EdgesGeometry(g, 30), mat);
  const box = (w: number, h: number, d: number, mat: Material, x: number, y: number, z: number, parent: Object3D, outline = true) => {
    const g = new BoxGeometry(w, h, d);
    const mesh = new Mesh(g, mat);
    mesh.position.set(x, y + h / 2, z);
    if (outline) mesh.add(edges(g));
    parent.add(mesh);
    return mesh;
  };
  /** Glass: a translucent pane box with a hairline frame. */
  const glass = (w: number, h: number, d: number, x: number, y: number, z: number, parent: Object3D) => {
    const g = new BoxGeometry(w, h, d);
    const pane = new Mesh(g, M.glass);
    pane.position.set(x, y + h / 2, z);
    pane.renderOrder = 2;
    pane.add(edges(g, glassEdge));
    parent.add(pane);
  };
  const cyl = (r: number, h: number, mat: Material, x: number, y: number, z: number, parent: Object3D) => {
    const g = new CylinderGeometry(r, r, h, seg.cyl);
    const mesh = new Mesh(g, mat);
    mesh.position.set(x, y, z);
    mesh.add(edges(g));
    parent.add(mesh);
    return mesh;
  };
  const sphere = (r: number, mat: Material, x: number, y: number, z: number, parent: Object3D) => {
    const s = new Mesh(new SphereGeometry(r, seg.sph[0], seg.sph[1]), mat);
    s.position.set(x, y, z);
    parent.add(s);
  };
  const mark = (id: string, x: number, z: number, w: number, d: number) => {
    const m = new Mesh(new PlaneGeometry(w, d), M.mark);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.004, z);
    m.visible = false;
    scene.add(m);
    marks.set(id, m);
  };

  // The floor: the page, with the graph paper's lines.
  const floor = new Mesh(new PlaneGeometry(120, 40), M.page);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  scene.add(floor);
  const grid = new GridHelper(120, 120, colors.grid, colors.grid);
  grid.position.y = 0.001;
  scene.add(grid);

  // Lay the stations out edge to edge, centred on 0.
  const xs = new Map<string, number>();
  let at = 0;
  input.stations.forEach((s, i) => {
    const prev = input.stations[i - 1];
    at += prev ? (FOOTPRINT[prev.kind] + FOOTPRINT[s.kind]) / 2 : 0;
    xs.set(s.key, at);
  });
  const first = input.stations[0];
  const last = input.stations.at(-1);
  const span = at;
  for (const [k, v] of xs) xs.set(k, v - span / 2);
  const start = (xs.get(first?.key ?? "") ?? 0) - (first ? FOOTPRINT[first.kind] / 2 : 0) - 0.4;
  const end = (xs.get(last?.key ?? "") ?? 0) + (last ? FOOTPRINT[last.kind] / 2 : 0);

  // The conveyor: a belt on its frame, with its rollers.
  box(end - start, 0.12, 1.25, M.part, (start + end) / 2, 0, 0, scene);
  box(end - start, 0.06, 1.05, M.belt, (start + end) / 2, 0.12, 0, scene, false);
  for (let x = start + 0.4; x < end; x += 1.2) box(0.08, 0.2, 1.3, M.pipe, x, 0, 0, scene, false);

  const tagY: Record<SceneKind, number> = { doors: 1.9, code: 1.9, model: 2.2, analysis: 2.35, verify: 2.8, render: 1.9 };
  input.stations.forEach((s, i) => {
    const x = xs.get(s.key) ?? 0;
    const z = s.spur ? SPUR_Z : 0;
    const g = new Group();
    g.position.set(x, 0, z);
    g.userData.id = s.key;
    scene.add(g);
    groups.set(s.key, g);
    // Labels alternate between two heights so neighbours never collide.
    anchors.set(s.key, new Vector3(x + (s.kind === "doors" ? 0.3 : 0), tagY[s.kind] + (i % 2 ? 1.1 : 0), z));
    focus.set(s.key, new Vector3(x, 0.6, z));
    if (s.spur) box(0.9, 0.12, Math.abs(SPUR_Z), M.part, x, 0.06, SPUR_Z / 2, scene);

    if (s.kind === "doors") {
      for (let k = 0; k < 4; k++) box(0.62, 0.9 + (k % 2) * 0.2, 0.62, M.body, -0.6 + (k % 2) * 1.2, 0, -1.6 + k * 1.05, g);
      const hopper = new CylinderGeometry(0.85, 0.3, 0.9, 4, 1, true);
      const hop = new Mesh(hopper, new MeshLambertMaterial({ color: colors.surface, side: DoubleSide }));
      hop.position.set(1.1, 1.0, 0);
      hop.rotation.y = Math.PI / 4;
      hop.add(edges(new CylinderGeometry(0.85, 0.3, 0.9, 4)));
      g.add(hop);
      box(0.5, 0.55, 0.5, M.part, 1.1, 0, 0, g);
      mark(s.key, x + 0.3, 0, 3.4, 5.2);
      return;
    }
    if (s.kind === "analysis") {
      box(3.0, 1.15, 1.9, M.body, 0, 0, 0, g);
      for (const k of [-1, 0, 1]) {
        box(0.78, 0.55, 1.2, M.part, k * 0.95, 1.15, 0, g);
        cyl(0.07, 0.6, M.dark, k * 0.95 + 0.25, 1.95, -0.35, g);
      }
      mark(s.key, x, 0, 3.6, 2.6);
      return;
    }
    if (s.kind === "verify") {
      box(0.35, 1.9, 1.8, M.body, -0.75, 0, 0, g);
      box(0.35, 1.9, 1.8, M.body, 0.75, 0, 0, g);
      box(1.85, 0.4, 1.8, M.body, 0, 1.9, 0, g);
      glass(2.25, 2.55, 2.15, 0, 0, 0, g);
      // One gate light per check the verifier ran: green only for a check that passed everything, ink for one that
      // failed a claim (failure is never a colour, DESIGN.md §3).
      const n = input.checks.length;
      input.checks.forEach((c, k) => {
        const light = box(0.13, 0.26, 0.08, c.failed === 0 ? M.pass : M.fail, -0.6 + (k * 1.2) / Math.max(1, n - 1), 2.0, 0.92, g, false);
        // Drawn after the glass (which writes no depth), so no pane tints the light: its colour stays the token.
        light.renderOrder = 3;
        light.userData.check = c.check;
        light.userData.pass = c.failed === 0;
      });
      mark(s.key, x, 0, 2.6, 2.6);
      return;
    }
    if (s.kind === "render") {
      box(1.7, 0.9, 1.6, M.body, 0, 0, 0, g);
      box(1.2, 0.5, 1.1, M.part, 0, 0.9, 0, g);
      cyl(0.08, 0.9, M.dark, 0, 1.85, 0, g);
      box(1.2, 0.08, 1.0, M.part, 1.6, 0, 0, g);
      for (let k = 0; k < 4; k++) box(0.72, 0.035, 0.9, M.body, 1.6, 0.09 + k * 0.045, 0, g);
      mark(s.key, x + 0.6, 0, 3.2, 2.4);
      return;
    }
    const w = 1.7;
    const h = s.kind === "model" ? 1.0 : 1.15;
    const d = 1.5;
    box(w, h, d, M.body, 0, 0, 0, g);
    box(w * 0.62, 0.32, d * 0.55, M.part, -0.15, h, -0.1, g);
    if (s.kind === "model") {
      glass(w + 0.35, 1.95, d + 0.35, 0, 0, 0, g);
      sphere(0.16, M.ink, 0.55, h + 0.25, 0.35, g);
    }
    if (s.key === "metrics") {
      // The confirm booth: you approve the definitions here.
      box(0.5, 0.75, 0.5, M.part, 1.35, 0, 1.15, g);
      sphere(0.16, M.dark, 1.35, 1.0, 1.15, g);
    }
    if (s.key === "index") cyl(0.32, 0.6, M.part, 0.5, h + 0.3, 0.3, g);
    if (s.spur) {
      cyl(0.04, 1.3, M.dark, 0.55, h + 0.65, 0.4, g);
      const dish = new Mesh(
        new SphereGeometry(0.28, seg.sph[0], seg.sph[1] / 2, 0, Math.PI * 2, 0, Math.PI / 2),
        new MeshLambertMaterial({ color: colors.surface, side: DoubleSide }),
      );
      dish.position.set(0.55, h + 1.3, 0.4);
      dish.rotation.x = Math.PI;
      g.add(dish);
    }
    mark(s.key, x, z, 2.5, 2.4);
  });

  // The job's database file in front of the line, and a pipe from each station that saves to it.
  const vault = new Group();
  vault.userData.id = "vault";
  scene.add(vault);
  groups.set("vault", vault);
  const vaultLen = end - start - 2.5;
  const vaultX = (start + end) / 2;
  box(vaultLen, 0.7, 0.9, M.body, vaultX, 0.05, VAULT_Z, vault);
  for (let x = vaultX - vaultLen / 2 + 0.6; x <= vaultX + vaultLen / 2 - 0.5; x += 3.1) box(0.08, 0.8, 1.0, M.part, x, 0, VAULT_Z, vault);
  mark("vault", vaultX, VAULT_Z, vaultLen + 1, 1.8);
  anchors.set("vault", new Vector3(vaultX - vaultLen / 2 + 4.6, 1.05, VAULT_Z));
  focus.set("vault", new Vector3(vaultX - 2, 0.4, VAULT_Z));
  for (const s of input.stations) {
    if (s.kind === "doors") continue;
    const z = s.spur ? SPUR_Z : 0;
    const len = VAULT_Z - 0.9 - z;
    const p = new Mesh(new CylinderGeometry(0.055, 0.055, len, seg.pipe), M.pipe);
    p.rotation.x = Math.PI / 2;
    p.position.set((xs.get(s.key) ?? 0) - 0.35, 0.12, z + 0.85 + len / 2);
    scene.add(p);
  }

  // The model room behind glass, its three roles, and a dashed cable from each role to each station that calls it.
  const callers = input.stations.filter((s) => s.calls.length > 0);
  const roomX = xs.get(callers.at(-2)?.key ?? callers.at(-1)?.key ?? "") ?? 0;
  const room = new Group();
  room.userData.id = "models";
  scene.add(room);
  groups.set("models", room);
  box(7.0, 0.1, 2.0, M.part, roomX, 0, ROOM_Z, room);
  const roleX: Record<SceneRole, number> = { planner: roomX - 2.3, extractor: roomX, judge: roomX + 2.3 };
  for (const rx of Object.values(roleX)) {
    box(1.0, 1.05, 1.0, M.body, rx, 0.1, ROOM_Z, room);
    sphere(0.14, M.ink, rx, 1.4, ROOM_Z, room);
  }
  glass(7.2, 1.8, 2.2, roomX, 0, ROOM_Z, room);
  mark("models", roomX, ROOM_Z, 7.8, 2.8);
  anchors.set("models", new Vector3(roomX, 2.15, ROOM_Z));
  focus.set("models", new Vector3(roomX, 0.6, ROOM_Z));
  for (const s of callers) {
    for (const [i, role] of s.calls.entries()) {
      const fx = roleX[role];
      const tx = (xs.get(s.key) ?? 0) + (role === "extractor" ? 0.2 : -0.2);
      const h = 2.2 + (((callers.indexOf(s) * 2 + i) * 0.4) % 1.6);
      const curve = new CubicBezierCurve3(
        new Vector3(fx, 1.2, ROOM_Z + 1.1),
        new Vector3(fx, h, ROOM_Z + 1.6),
        new Vector3(tx, h, -0.4),
        new Vector3(tx, 1.6, -0.2),
      );
      const line = new Line(new BufferGeometry().setFromPoints(curve.getPoints(detail === "lite" ? 20 : 40)), cableMat);
      line.computeLineDistances();
      scene.add(line);
    }
  }

  return { scene, groups, marks, anchors, focus, line: { start, end }, x: xs, colors };
}

/** The views: the axonometric directions the home view may look from (it picks the one that draws the machine largest for the canvas). */
export const HOME_DIRS = [0.1, 0.4, 0.7, 1.0].map((x) => new Vector3(x, 0.7, 1).normalize());

/** Room above the machine for the HTML labels, and below it, as shares of the view's height. */
export const HOME_MARGIN = { top: 0.16, bottom: 0.08 } as const;

export interface View {
  readonly dir: Vector3;
  readonly target: Vector3;
  /** The scene width the view shows at zoom 1. */
  readonly width: number;
}

/**
 * The view that fits the machine (every piece and its label anchor) into a canvas of this aspect, as large as it can
 * be drawn, from the given directions: the projected bounds, with room above for the HTML labels.
 */
export function fitView(
  b: Built,
  aspect: number,
  dirs: readonly Vector3[] = HOME_DIRS,
  margin: { readonly top: number; readonly bottom: number } = HOME_MARGIN,
): View {
  const points: Vector3[] = [];
  const box = new Box3();
  for (const g of b.groups.values()) {
    box.setFromObject(g);
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) points.push(new Vector3(x, y, z));
  }
  for (const a of b.anchors.values()) points.push(a.clone());
  const cam = new OrthographicCamera();
  let best: View | null = null;
  for (const dir of dirs) {
    cam.position.copy(dir).multiplyScalar(60);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse;
    let x0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    const p = new Vector3();
    for (const q of points) {
      p.copy(q).applyMatrix4(inv);
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    const w = (x1 - x0) * 1.06;
    const h = (y1 - y0) / (1 - margin.top - margin.bottom);
    const width = Math.max(w, h * aspect);
    // Centred in the view, less the label room above and the margin below (the same whether the width or the height
    // limits the fit, so a wide machine in a tall view sits in the middle, not on the floor).
    const cy = (y0 + y1) / 2 + ((margin.top - margin.bottom) * (width / aspect)) / 2;
    // The centre, back in the world, at the origin's depth (an orthographic view: any depth on the line of sight).
    const target = new Vector3((x0 + x1) / 2, cy, -60).applyMatrix4(cam.matrixWorld);
    if (!best || width < best.width) best = { dir, target, width };
  }
  return best as View;
}

/** An orthographic camera looking from `dir` at `target`, sized so `width` scene units fill the view's width. */
export function placeCamera(camera: OrthographicCamera, dir: Vector3, target: Vector3, aspect: number, width: number) {
  const h = width / aspect;
  camera.left = -width / 2;
  camera.right = width / 2;
  camera.top = h / 2;
  camera.bottom = -h / 2;
  camera.near = 0.1;
  camera.far = 200;
  camera.position.copy(target).addScaledVector(dir, 60);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
}

/** The stills' WebP quality: flat-shaded faces on a flat page keep their edges at this setting. */
const WEBP_QUALITY = 0.72;

/**
 * The still frames (build time, scripts/site-assets.ts): the home view for a wide stage (desktop) and a tall one
 * (phones), each as WebP and PNG data URLs, rendered from the same scene, lights and view as the live section, with no
 * labels (labels are HTML, DESIGN.md §6).
 */
export function renderStills(
  input: SceneInput,
  tokens: Tokens,
  sizes: { readonly wide: readonly [number, number]; readonly tall: readonly [number, number] },
) {
  const canvas = document.createElement("canvas");
  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = SRGBColorSpace;
  const camera = new OrthographicCamera();
  const shot = ([w, h]: readonly [number, number], detail: Detail) => {
    const built = buildMachine(input, tokens, detail);
    renderer.setSize(w, h, false);
    const v = fitView(built, w / h);
    placeCamera(camera, v.dir, v.target, w / h, v.width);
    renderer.render(built.scene, camera);
    return { webp: canvas.toDataURL("image/webp", WEBP_QUALITY), png: canvas.toDataURL("image/png") };
  };
  const out = { wide: shot(sizes.wide, "full"), tall: shot(sizes.tall, "lite") };
  renderer.dispose();
  return out;
}
