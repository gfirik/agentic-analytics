// The engine machine's 3D scene (DESIGN.md §6 "Engine machine", the one 3D exception in §1/§2.6/§9): an axonometric line
// drawing of the pipeline. Unlit materials only (MeshBasicMaterial: no light, so no shading, shadow or glow), hairline
// ink edges, and two surface tones (raised on top faces, surface on the sides). Every colour is a CSS token read at
// runtime (readTokens), set as sRGB so three's colour management hands it back unchanged on the sRGB canvas.
// Used by the lazy client module (machine-3d.ts) and, at build time, by scripts/site-assets.ts for the static images.
// It imports only from "three" (ES modules, tree-shaken) and has no DOM work but the renderer's canvas.
import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  Color,
  CubicBezierCurve3,
  CylinderGeometry,
  EdgesGeometry,
  GridHelper,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  type Material,
  Mesh,
  MeshBasicMaterial,
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

/** Each kind's footprint along the line: stations are laid out edge to edge from these, then centred. */
const FOOTPRINT: Record<SceneKind, number> = { doors: 4.2, code: 3, model: 3, analysis: 4.4, verify: 3, render: 3.8 };
const VAULT_Z = 3.7;
const ROOM_Z = -4.6;
const SPUR_Z = -1.8;

export interface Built {
  readonly scene: Scene;
  /** Each piece's group (stations, "vault", "models"), for picking. */
  readonly groups: ReadonlyMap<string, Group>;
  /** The floor mark under each piece, shown when it is selected. */
  readonly marks: ReadonlyMap<string, Mesh>;
  /** Where each piece's HTML label sits, and where the camera looks when it is focused. */
  readonly anchors: ReadonlyMap<string, Vector3>;
  readonly focus: ReadonlyMap<string, Vector3>;
  readonly pipes: Group;
  readonly cables: Group;
  readonly line: { readonly start: number; readonly end: number };
  /** Where each station sits on the line. */
  readonly x: ReadonlyMap<string, number>;
  readonly packets: Packets;
  readonly colors: Readonly<Record<Tone, Color>>;
}

/** The scene, built from the station list and the tokens. */
export function buildMachine(input: SceneInput, tokens: Tokens): Built {
  const colors = {} as Record<Tone, Color>;
  for (const k of Object.keys(TONES) as Tone[]) colors[k] = new Color().setStyle(tokens[k], SRGBColorSpace);
  const basic = (k: Tone) => new MeshBasicMaterial({ color: colors[k] });
  const M = {
    page: basic("page"),
    raised: basic("raised"),
    surface: basic("surface"),
    mark: basic("mark"),
    ruleStrong: basic("ruleStrong"),
    ink: basic("ink"),
    ink2: basic("ink2"),
    verified: basic("verified"),
  };
  // BoxGeometry's face groups: +x, −x, +y (top), −y, +z, −z. The top takes the raised tone, the sides the surface tone.
  const body: Material[] = [M.surface, M.surface, M.raised, M.surface, M.surface, M.surface];
  const part: Material[] = [M.surface, M.surface, M.surface, M.surface, M.surface, M.surface];
  const edgeMat = new LineBasicMaterial({ color: colors.ink });
  const dashMat = new LineDashedMaterial({ color: colors.ink2, dashSize: 0.18, gapSize: 0.12 });

  const scene = new Scene();
  scene.background = colors.page;
  const groups = new Map<string, Group>();
  const marks = new Map<string, Mesh>();
  const anchors = new Map<string, Vector3>();
  const focus = new Map<string, Vector3>();

  const edges = (g: BufferGeometry, mat: LineBasicMaterial | LineDashedMaterial = edgeMat) => {
    const e = new LineSegments(new EdgesGeometry(g, 30), mat);
    if (mat === dashMat) e.computeLineDistances();
    return e;
  };
  const box = (
    w: number,
    h: number,
    d: number,
    mat: Material | Material[],
    x: number,
    y: number,
    z: number,
    parent: Object3D,
    outline = true,
  ) => {
    const g = new BoxGeometry(w, h, d);
    const mesh = new Mesh(g, mat);
    mesh.position.set(x, y + h / 2, z);
    if (outline) mesh.add(edges(g));
    parent.add(mesh);
    return mesh;
  };
  /** Glass: a dashed outline only, no fill (nothing translucent, nothing that glows). */
  const glass = (w: number, h: number, d: number, x: number, y: number, z: number, parent: Object3D) => {
    const e = edges(new BoxGeometry(w, h, d), dashMat);
    e.position.set(x, y + h / 2, z);
    parent.add(e);
  };
  const cyl = (r: number, h: number, mat: Material | Material[], x: number, y: number, z: number, parent: Object3D, rotZ = 0) => {
    const g = new CylinderGeometry(r, r, h, 28);
    const mesh = new Mesh(g, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.z = rotZ;
    mesh.add(edges(g));
    parent.add(mesh);
    return mesh;
  };
  const sphere = (r: number, mat: Material, x: number, y: number, z: number, parent: Object3D) => {
    const s = new Mesh(new SphereGeometry(r, 16, 12), mat);
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

  // The conveyor: a belt with its slats.
  box(end - start, 0.18, 1.1, body, (start + end) / 2, 0.16, 0, scene);
  for (let x = start + 0.4; x < end; x += 1.2) box(0.08, 0.16, 1.2, M.ruleStrong, x, 0, 0, scene, false);

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
    focus.set(s.key, new Vector3(x, 0.4, z));
    if (s.spur) box(0.9, 0.12, Math.abs(SPUR_Z), body, x, 0.16, SPUR_Z / 2, scene);

    if (s.kind === "doors") {
      for (let k = 0; k < 4; k++) box(0.62, 0.9 + (k % 2) * 0.2, 0.62, body, -0.6 + (k % 2) * 1.2, 0, -1.6 + k * 1.05, g);
      const hopper = new CylinderGeometry(0.85, 0.3, 0.9, 4, 1, true);
      const hop = new Mesh(hopper, M.surface);
      hop.position.set(1.1, 1.0, 0);
      hop.rotation.y = Math.PI / 4;
      hop.add(edges(new CylinderGeometry(0.85, 0.3, 0.9, 4)));
      g.add(hop);
      box(0.5, 0.55, 0.5, part, 1.1, 0, 0, g);
      mark(s.key, x + 0.3, 0, 3.4, 5.2);
      return;
    }
    if (s.kind === "analysis") {
      box(3.0, 1.15, 1.9, body, 0, 0, 0, g);
      for (const k of [-1, 0, 1]) {
        box(0.78, 0.55, 1.2, body, k * 0.95, 1.15, 0, g);
        cyl(0.07, 0.6, M.ink2, k * 0.95 + 0.25, 1.95, -0.35, g);
      }
      mark(s.key, x, 0, 3.6, 2.6);
      return;
    }
    if (s.kind === "verify") {
      box(0.35, 1.9, 1.8, body, -0.75, 0, 0, g);
      box(0.35, 1.9, 1.8, body, 0.75, 0, 0, g);
      box(1.85, 0.4, 1.8, body, 0, 1.9, 0, g);
      glass(2.25, 2.55, 2.15, 0, 0, 0, g);
      // One gate light per check the verifier ran: green only for a check that passed everything, ink for one that
      // failed a claim (failure is never a colour, DESIGN.md §3).
      const n = input.checks.length;
      input.checks.forEach((c, k) => {
        const light = box(
          0.13,
          0.26,
          0.08,
          c.failed === 0 ? M.verified : M.ink,
          -0.6 + (k * 1.2) / Math.max(1, n - 1),
          2.0,
          0.92,
          g,
          false,
        );
        light.userData.check = c.check;
        light.userData.pass = c.failed === 0;
      });
      mark(s.key, x, 0, 2.6, 2.6);
      return;
    }
    if (s.kind === "render") {
      box(1.7, 0.9, 1.6, body, 0, 0, 0, g);
      box(1.2, 0.5, 1.1, body, 0, 0.9, 0, g);
      cyl(0.08, 0.9, M.ink2, 0, 1.85, 0, g);
      box(1.2, 0.08, 1.0, part, 1.6, 0, 0, g);
      for (let k = 0; k < 4; k++) box(0.72, 0.035, 0.9, body, 1.6, 0.09 + k * 0.045, 0, g);
      mark(s.key, x + 0.6, 0, 3.2, 2.4);
      return;
    }
    const w = 1.7;
    const h = s.kind === "model" ? 1.0 : 1.15;
    const d = 1.5;
    box(w, h, d, body, 0, 0, 0, g);
    box(w * 0.62, 0.32, d * 0.55, part, -0.15, h, -0.1, g);
    if (s.kind === "model") {
      glass(w + 0.35, 1.95, d + 0.35, 0, 0, 0, g);
      sphere(0.16, M.ink, 0.55, h + 0.25, 0.35, g);
    }
    if (s.key === "metrics") {
      // The confirm booth: you approve the definitions here.
      box(0.5, 0.75, 0.5, part, 1.35, 0, 1.15, g);
      sphere(0.16, M.ink2, 1.35, 1.0, 1.15, g);
    }
    if (s.key === "index") cyl(0.32, 0.6, part, 0.5, h + 0.3, 0.3, g);
    if (s.spur) {
      cyl(0.04, 1.3, M.ink2, 0.55, h + 0.65, 0.4, g);
      const dish = new Mesh(new SphereGeometry(0.28, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.surface);
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
  box(vaultLen, 0.7, 0.9, body, vaultX, 0.05, VAULT_Z, vault);
  for (let x = vaultX - vaultLen / 2 + 0.6; x <= vaultX + vaultLen / 2 - 0.5; x += 3.1) box(0.08, 0.8, 1.0, part, x, 0, VAULT_Z, vault);
  mark("vault", vaultX, VAULT_Z, vaultLen + 1, 1.8);
  anchors.set("vault", new Vector3(vaultX - vaultLen / 2 + 4.6, 1.05, VAULT_Z));
  focus.set("vault", new Vector3(vaultX - 2, 0.4, VAULT_Z));
  const pipes = new Group();
  scene.add(pipes);
  for (const s of input.stations) {
    if (s.kind === "doors") continue;
    const z = s.spur ? SPUR_Z : 0;
    const len = VAULT_Z - 0.9 - z;
    const p = new Mesh(new CylinderGeometry(0.055, 0.055, len, 10), M.ruleStrong);
    p.rotation.x = Math.PI / 2;
    p.position.set((xs.get(s.key) ?? 0) - 0.35, 0.12, z + 0.85 + len / 2);
    pipes.add(p);
  }

  // The model room behind glass, its three roles, and a dashed cable from each role to each station that calls it.
  const callers = input.stations.filter((s) => s.calls.length > 0);
  const roomX = xs.get(callers.at(-2)?.key ?? callers.at(-1)?.key ?? "") ?? 0;
  const room = new Group();
  room.userData.id = "models";
  scene.add(room);
  groups.set("models", room);
  box(7.0, 0.1, 2.0, part, roomX, 0, ROOM_Z, room);
  glass(7.2, 1.8, 2.2, roomX, 0, ROOM_Z, room);
  const roleX: Record<SceneRole, number> = { planner: roomX - 2.3, extractor: roomX, judge: roomX + 2.3 };
  for (const rx of Object.values(roleX)) {
    box(1.0, 1.05, 1.0, body, rx, 0.1, ROOM_Z, room);
    sphere(0.14, M.ink, rx, 1.4, ROOM_Z, room);
  }
  mark("models", roomX, ROOM_Z, 7.8, 2.8);
  anchors.set("models", new Vector3(roomX, 2.15, ROOM_Z));
  focus.set("models", new Vector3(roomX, 0.4, ROOM_Z));
  const cables = new Group();
  scene.add(cables);
  let lift = 0;
  for (const s of callers) {
    for (const role of s.calls) {
      const fx = roleX[role];
      const tx = (xs.get(s.key) ?? 0) + (role === "extractor" ? 0.2 : -0.2);
      const h = 2.2 + ((lift++ * 0.4) % 1.6);
      const curve = new CubicBezierCurve3(
        new Vector3(fx, 1.2, ROOM_Z + 1.1),
        new Vector3(fx, h, ROOM_Z + 1.6),
        new Vector3(tx, h, -0.4),
        new Vector3(tx, 1.6, -0.2),
      );
      const line = new Line(new BufferGeometry().setFromPoints(curve.getPoints(40)), dashMat);
      line.computeLineDistances();
      cables.add(line);
    }
  }

  const packets = makePackets(
    scene,
    xs,
    input.stations,
    { start, end },
    { raised: M.raised, surface: M.surface, ink2: M.ink2, verified: M.verified },
    edgeMat,
  );
  return { scene, groups, marks, anchors, focus, pipes, cables, line: { start, end }, x: xs, packets, colors };
}

/** "Run the line": what moves down the belt changes form at each station: a file, a table, a fact, a claim, a verified claim. */
export interface Packets {
  /** Advance the moving packets (only while the line runs). */
  step(dt: number, spawn: boolean): void;
  /** The end state, still: one packet of each form between its stations (reduced motion). */
  still(): void;
  clear(): void;
  readonly count: () => number;
}

function makePackets(
  scene: Scene,
  xs: ReadonlyMap<string, number>,
  stations: readonly SceneStation[],
  line: { start: number; end: number },
  M: { raised: Material; surface: Material; ink2: Material; verified: Material },
  edgeMat: LineBasicMaterial,
): Packets {
  const geo = {
    file: new BoxGeometry(0.6, 0.14, 0.75),
    table: new BoxGeometry(0.55, 0.42, 0.55),
    fact: new BoxGeometry(0.32, 0.32, 0.32),
    claim: new BoxGeometry(0.7, 0.08, 0.48),
  };
  const edge = {
    file: new EdgesGeometry(geo.file),
    table: new EdgesGeometry(geo.table),
    fact: new EdgesGeometry(geo.fact),
    claim: new EdgesGeometry(geo.claim),
  };
  type Form = keyof typeof geo | "verified";
  // Where the form changes: after the station that makes the new form.
  const after = (key: string) => xs.get(key) ?? Number.POSITIVE_INFINITY;
  const keyOf = (kind: SceneKind, fallback: string) => stations.find((s) => s.kind === kind)?.key ?? fallback;
  const ingest = stations[1]?.key ?? "";
  const bounds: [number, Form][] = [
    [after(ingest), "table"],
    [after(keyOf("analysis", "")), "fact"],
    [after(stations.find((s) => s.calls.includes("extractor"))?.key ?? ""), "claim"],
    [after(keyOf("verify", "")), "verified"],
  ];
  const formAt = (x: number): Form => {
    let f: Form = "file";
    for (const [b, form] of bounds) if (x >= b) f = form;
    return f;
  };
  const items: Mesh[] = [];
  let wait = 0;
  const set = (p: Mesh, form: Form) => {
    if (p.userData.form === form) return;
    p.userData.form = form;
    const g = form === "verified" ? geo.claim : geo[form];
    p.geometry = g;
    (p.children[0] as LineSegments).geometry = form === "verified" ? edge.claim : edge[form];
    p.material = form === "table" ? M.surface : form === "fact" ? M.ink2 : form === "verified" ? M.verified : M.raised;
    p.position.y = form === "fact" ? 0.52 : form === "table" ? 0.55 : 0.42;
  };
  const add = (x: number) => {
    const p = new Mesh(geo.file, M.raised);
    p.add(new LineSegments(edge.file, edgeMat));
    p.position.set(x, 0.42, 0);
    scene.add(p);
    items.push(p);
    set(p, formAt(x));
    return p;
  };
  const clear = () => {
    for (const p of items) scene.remove(p);
    items.length = 0;
  };
  return {
    step(dt, spawn) {
      if (spawn) {
        wait -= dt;
        if (wait <= 0) {
          add(line.start + 1.1);
          wait = 1.1;
        }
      }
      for (let i = items.length - 1; i >= 0; i--) {
        const p = items[i] as Mesh;
        p.position.x += dt * 2.2;
        set(p, formAt(p.position.x));
        if (p.position.x > line.end - 0.6) {
          scene.remove(p);
          items.splice(i, 1);
        }
      }
    },
    still() {
      clear();
      const marks = [line.start + 1.1, ...bounds.map(([b]) => b).filter(Number.isFinite), line.end - 0.6];
      for (let i = 0; i < marks.length - 1; i++) add(((marks[i] as number) + (marks[i + 1] as number)) / 2 + 0.6);
    },
    clear,
    count: () => items.length,
  };
}

/** The views: the axonometric directions the camera may look from (the home view picks the one that draws the machine largest for the canvas), straight on, and from above. */
export const HOME_DIRS = [0.1, 0.4, 0.7, 1.0].map((x) => new Vector3(x, 0.7, 1).normalize());
export const HOME_DIR = HOME_DIRS[0] as Vector3;
export const HOME_TARGET = new Vector3(0, 0.4, -0.6);
export const FRONT_DIR = new Vector3(0, 0.45, 1).normalize();
export const TOP_DIR = new Vector3(0.001, 1, 0.12).normalize();

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
  margin: { readonly top: number; readonly bottom: number } = { top: 0.14, bottom: 0.22 },
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
    // Room above for the labels over their anchors (and the legend), and below for the toolbar: shares of the height.
    const w = (x1 - x0) * 1.06;
    const h = (y1 - y0) / (1 - margin.top - margin.bottom);
    const width = Math.max(w, h * aspect);
    // The view's bottom edge sits margin.bottom of its height below the lowest point.
    const cy = y0 - margin.bottom * (width / aspect) + width / aspect / 2;
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

/** The stills' WebP quality: a line drawing on a flat page keeps its hairlines at this setting. */
const WEBP_QUALITY = 0.6;

/**
 * The static images (build time, scripts/site-assets.ts): the strip under the hero and the closed machine, each as
 * WebP and PNG data URLs, rendered from the same scene with no labels (labels are HTML, DESIGN.md §6).
 */
export function renderStills(
  input: SceneInput,
  tokens: Tokens,
  sizes: { readonly strip: readonly [number, number]; readonly full: readonly [number, number] },
) {
  const canvas = document.createElement("canvas");
  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = SRGBColorSpace;
  const built = buildMachine(input, tokens);
  const camera = new OrthographicCamera();
  const shot = (w: number, h: number, dir: Vector3, target: Vector3, width: number) => {
    renderer.setSize(w, h, false);
    placeCamera(camera, dir, target, w / h, width);
    renderer.render(built.scene, camera);
    return { webp: canvas.toDataURL("image/webp", WEBP_QUALITY), png: canvas.toDataURL("image/png") };
  };
  const [sw, sh] = sizes.strip;
  const [fw, fh] = sizes.full;
  const lineWidth = built.line.end - built.line.start;
  const out = {
    strip: shot(sw, sh, new Vector3(0.1, 0.42, 1).normalize(), new Vector3(0, 0.9, -0.2), lineWidth * 1.02),
    full: (() => {
      const v = fitView(built, fw / fh, HOME_DIRS, { top: 0.04, bottom: 0.04 });
      return shot(fw, fh, v.dir, v.target, v.width);
    })(),
  };
  renderer.dispose();
  return out;
}
