// Batches the engine machine's scene for drawing (DESIGN.md §6 "Engine machine", §7 "Motion"). machine-scene.ts builds the
// scene piece by piece (hundreds of small meshes, each with its own edge lines), which is right for the still frames and
// for reading; drawn as built it costs one draw call per mesh and per outline, 110 to 220 a frame. This module bakes every
// mesh's world transform into its geometry and merges what shares a material into one mesh, so the same picture is drawn
// in about fifteen calls:
//   - meshes with the same colour, side, opacity and draw order become one mesh;
//   - all hairline edges of one material become one set of line segments, and the dashed cables one more (their dash
//     distances are carried over, so the dashes are the ones the cables had);
//   - a piece keeps its identity for the page: an invisible pick mesh (never drawn, never in the scene) holds its geometry
//     for picking and its bounds for fitView, and a hidden set of ink edges is drawn over its outline while it is
//     highlighted (the same lines as before, swapped for ink).
// The look is the scene's own: same geometry, same materials, same lights. Only the number of calls changes.
// Time-sliced (it yields to the page between pieces), so batching never makes one long task.
import {
  Box3,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  type Light,
  type Line,
  LineBasicMaterial,
  LineSegments,
  type Material,
  Mesh,
  MeshBasicMaterial,
  type MeshLambertMaterial,
  type Object3D,
  Scene,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Built } from "./machine-scene.ts";

export interface Batched extends Built {
  /** Each piece's outline in ink, hidden; shown over the piece's own edges while it is highlighted. */
  readonly inkEdges: ReadonlyMap<string, LineSegments>;
  /** Frees every geometry and material this module made or kept (the renderer is disposed by its owner). */
  dispose(): void;
}

type Geo = BufferGeometry;
interface Bucket<M extends Material> {
  material: M;
  order: number;
  geos: Geo[];
}

const isMesh = (o: Object3D): o is Mesh => (o as Mesh).isMesh === true;
const isLine = (o: Object3D): o is Line => (o as Line).isLine === true;
const isSegments = (o: Object3D): o is LineSegments => (o as LineSegments).isLineSegments === true;
const isLight = (o: Object3D): o is Light => (o as Light).isLight === true;

/** Two materials that draw alike share one bucket. */
const meshKey = (m: Material, order: number): string => {
  const l = m as MeshLambertMaterial;
  return [m.type, l.color?.getHex(), m.side, m.transparent, m.opacity, m.depthWrite, order].join("|");
};

/** The geometry as the merge needs it: world space, position and normal only, all indexed or none. */
const baked = (o: Mesh | LineSegments, keepNormal: boolean): Geo => {
  const g = o.geometry.clone();
  g.applyMatrix4(o.matrixWorld);
  for (const name of Object.keys(g.attributes)) if (name !== "position" && !(keepNormal && name === "normal")) g.deleteAttribute(name);
  g.clearGroups();
  return g;
};
const unify = (geos: Geo[]): Geo[] =>
  geos.every((g) => g.index) || geos.every((g) => !g.index) ? geos : geos.map((g) => (g.index ? g.toNonIndexed() : g));
const merged = (geos: Geo[]): Geo => {
  const one = unify(geos);
  const out = one.length === 1 ? (one[0] as Geo) : mergeGeometries(one, false);
  if (!out) throw new Error("engine machine: could not merge geometry");
  return out;
};

/** A cable (one Line strip with dash distances) as separate segments that keep each point's distance along the strip. */
const cableSegments = (o: Line): Geo | null => {
  const src = o.geometry;
  const pos = src.getAttribute("position");
  const dist = src.getAttribute("lineDistance");
  if (!pos || !dist) return null;
  o.updateMatrixWorld();
  const p: number[] = [];
  const d: number[] = [];
  const v = { x: 0, y: 0, z: 0 };
  const at = (i: number) => {
    v.x = pos.getX(i);
    v.y = pos.getY(i);
    v.z = pos.getZ(i);
    return v;
  };
  for (let i = 0; i + 1 < pos.count; i++) {
    for (const k of [i, i + 1]) {
      const q = at(k);
      p.push(q.x, q.y, q.z);
      d.push(dist.getX(k));
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(p, 3));
  g.setAttribute("lineDistance", new Float32BufferAttribute(d, 1));
  g.applyMatrix4(o.matrixWorld);
  return g;
};

/**
 * @param tick  awaited between pieces to give the page back its thread (a setTimeout 0, in the browser)
 */
export async function batchMachine(built: Built, tick: () => Promise<void>): Promise<Batched> {
  const old = built.scene;
  old.updateMatrixWorld(true);
  const marks = new Set<Object3D>(built.marks.values());
  const pieceOf = (o: Object3D): string | null => {
    for (let p: Object3D | null = o; p; p = p.parent) if (typeof p.userData.id === "string") return p.userData.id;
    return null;
  };
  // The original bounds, taken before anything moves: fitView frames the machine from them, and must keep framing it the
  // same way (a rotated part's box is looser than its baked one).
  const bounds = new Map<string, Box3>();
  for (const [k, g] of built.groups) bounds.set(k, new Box3().setFromObject(g));

  const meshes = new Map<string, Bucket<Material>>();
  const edges = new Map<Material, Bucket<Material>>();
  const cables = new Map<Material, Bucket<Material>>();
  const keep: Object3D[] = [];
  const lights: Light[] = [];
  const pick = new Map<string, Geo[]>();
  const ink = new Map<string, Geo[]>();
  const toDispose = new Set<Material>();
  const add = <K, M extends Material>(map: Map<K, Bucket<M>>, key: K, material: M, order: number, g: Geo) => {
    const b = map.get(key) ?? { material, order, geos: [] };
    map.set(key, b);
    b.geos.push(g);
  };

  let sliceStart = performance.now();
  const objects: Object3D[] = [];
  old.traverse((o) => {
    if (o !== old) objects.push(o);
  });
  for (const o of objects) {
    if (performance.now() - sliceStart > 6) {
      await tick();
      sliceStart = performance.now();
    }
    if (marks.has(o)) continue;
    if (isLight(o)) {
      lights.push(o);
      continue;
    }
    const id = pieceOf(o);
    if (isMesh(o)) {
      const g = baked(o, true);
      const m = o.material as Material;
      toDispose.add(m);
      add(meshes, meshKey(m, o.renderOrder), m, o.renderOrder, g);
      if (id) {
        const pg = new BufferGeometry();
        pg.setAttribute("position", g.getAttribute("position"));
        if (g.index) pg.setIndex(g.index);
        const list = pick.get(id) ?? [];
        list.push(pg);
        pick.set(id, list);
      }
      continue;
    }
    if (isSegments(o)) {
      // The graph-paper grid has vertex colours: it is drawn as it is.
      if ((o.material as LineBasicMaterial).vertexColors) {
        keep.push(o);
        continue;
      }
      const g = baked(o, false);
      const m = o.material as Material;
      toDispose.add(m);
      add(edges, m, m, o.renderOrder, g);
      if (id) {
        const list = ink.get(id) ?? [];
        list.push(g);
        ink.set(id, list);
      }
      continue;
    }
    if (isLine(o) && !isSegments(o)) {
      const g = cableSegments(o);
      const m = o.material as Material;
      toDispose.add(m);
      if (g) add(cables, m, m, o.renderOrder, g);
    }
  }

  const scene = new Scene();
  scene.background = old.background;
  for (const l of lights) scene.add(l);
  const made: Geo[] = [];
  const addMerged = (b: Bucket<Material>, kind: "mesh" | "lines") => {
    const g = merged(b.geos);
    made.push(g);
    const obj = kind === "mesh" ? new Mesh(g, b.material) : new LineSegments(g, b.material);
    obj.renderOrder = b.order;
    obj.matrixAutoUpdate = false;
    scene.add(obj);
  };
  for (const b of meshes.values()) addMerged(b, "mesh");
  await tick();
  for (const b of edges.values()) addMerged(b, "lines");
  for (const b of cables.values()) addMerged(b, "lines");
  for (const o of keep) scene.add(o);
  for (const m of built.marks.values()) scene.add(m);

  // The ink outline of each piece: hidden, drawn after the base edges, over exactly the same lines.
  const inkMat = new LineBasicMaterial({ color: built.colors.ink });
  const inkEdges = new Map<string, LineSegments>();
  for (const [id, geos] of ink) {
    const g = merged(geos);
    made.push(g);
    const s = new LineSegments(g, inkMat);
    s.visible = false;
    s.renderOrder = 1;
    s.matrixAutoUpdate = false;
    scene.add(s);
    inkEdges.set(id, s);
  }
  await tick();

  // Pick groups: what machine-3d's raycaster and fitView read, never added to the scene.
  const pickMat = new MeshBasicMaterial({ side: DoubleSide });
  const groups = new Map<string, Group>();
  for (const [id, geos] of pick) {
    const g = merged(geos);
    made.push(g);
    g.boundingBox = bounds.get(id)?.clone() ?? null;
    const grp = new Group();
    grp.userData.id = id;
    grp.add(new Mesh(g, pickMat));
    groups.set(id, grp);
  }
  // The scene as built is no longer needed: free what it held that the batched one did not take over.
  const owned = new Set<Material>(toDispose);
  for (const o of objects)
    if (isMesh(o) || isSegments(o) || isLine(o)) if (!marks.has(o) && o.geometry && !keep.includes(o)) o.geometry.dispose();
  old.clear();

  const used = new Set<Material>();
  scene.traverse((o) => {
    const m = (o as Mesh).material as Material | undefined;
    if (m) used.add(m);
  });
  return {
    ...built,
    scene,
    groups,
    inkEdges,
    dispose() {
      for (const g of made) g.dispose();
      for (const grp of groups.values()) for (const c of grp.children) (c as Mesh).geometry?.dispose();
      for (const m of new Set([...owned, ...used, pickMat, inkMat])) m.dispose();
      for (const o of keep) (o as Mesh).geometry?.dispose();
      for (const m of built.marks.values()) m.geometry.dispose();
      scene.clear();
    },
  };
}
