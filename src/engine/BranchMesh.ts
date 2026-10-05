import * as THREE from 'three';
import { TRACE_VERT, TRACE_FRAG, PART_VERT, PART_FRAG } from './shaders';
import { generateTrunk, Trunk } from './trunk';
import type { P } from './trunk';
import { buildDetail } from './detail';
import type { DetailOut } from './detail';
import { Rng } from './rng';
import type { TreeNode } from './types';

export type Uniform<T = number> = { value: T };
// shader uniforms are inherently loosely typed; this is the single place we allow it
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyUniform = { value: any };

export interface Shared {
  uTime: Uniform;
  quad: THREE.PlaneGeometry; // ±1 quad
}

interface RibbonLine {
  pts: P[];
  zs?: number[];
  z?: number;
  t0: number;
  t1: number;
  w: number;
  b: number;
  kind: number;
  seed: number;
  taper?: number;
}

function buildRibbon(lines: RibbonLine[]): THREE.BufferGeometry {
  let vc = 0;
  let ic = 0;
  for (const l of lines) {
    if (l.pts.length < 2) continue;
    vc += l.pts.length * 2;
    ic += (l.pts.length - 1) * 6;
  }
  const pos = new Float32Array(vc * 3);
  const nor = new Float32Array(vc * 2);
  const A = new Float32Array(vc * 4);
  const B = new Float32Array(vc * 4);
  const idx = new Uint32Array(ic);
  let v = 0;
  let ii = 0;
  for (const l of lines) {
    const n = l.pts.length;
    if (n < 2) continue;
    const cum = new Float32Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(l.pts[i].x - l.pts[i - 1].x, l.pts[i].y - l.pts[i - 1].y);
    const total = cum[n - 1] || 1e-4;
    for (let i = 0; i < n; i++) {
      const a = l.pts[Math.max(0, i - 1)];
      const b = l.pts[Math.min(n - 1, i + 1)];
      let tx = b.x - a.x;
      let ty = b.y - a.y;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const nx = -ty;
      const ny = tx;
      const u = cum[i] / total;
      const t = l.t0 + (l.t1 - l.t0) * u;
      const w = l.w * (1 - (l.taper ?? 0) * u);
      const z = l.zs ? l.zs[i] : (l.z ?? 0);
      for (let s = 0; s < 2; s++) {
        const side = s === 0 ? -1 : 1;
        pos[v * 3] = l.pts[i].x;
        pos[v * 3 + 1] = l.pts[i].y;
        pos[v * 3 + 2] = z;
        nor[v * 2] = nx;
        nor[v * 2 + 1] = ny;
        A[v * 4] = side;
        A[v * 4 + 1] = t;
        A[v * 4 + 2] = w;
        A[v * 4 + 3] = l.b;
        B[v * 4] = l.seed;
        B[v * 4 + 1] = l.kind;
        B[v * 4 + 2] = cum[i];
        B[v * 4 + 3] = total;
        v++;
      }
      if (i < n - 1) {
        const base = v - 2;
        idx[ii++] = base;
        idx[ii++] = base + 1;
        idx[ii++] = base + 2;
        idx[ii++] = base + 1;
        idx[ii++] = base + 3;
        idx[ii++] = base + 2;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aNormal', new THREE.BufferAttribute(nor, 2));
  g.setAttribute('aA', new THREE.BufferAttribute(A, 4));
  g.setAttribute('aB', new THREE.BufferAttribute(B, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

function buildParts(out: DetailOut, quad: THREE.PlaneGeometry): THREE.InstancedBufferGeometry | null {
  const n = out.parts.length;
  if (!n) return null;
  const iPos = new Float32Array(n * 3);
  const iSize = new Float32Array(n * 4);
  const iMeta = new Float32Array(n * 4);
  out.parts.forEach((p, i) => {
    iPos.set([p.x, p.y, p.z], i * 3);
    iSize.set([p.sx, p.sy, p.rot, p.shape], i * 4);
    iMeta.set([p.t, p.b, p.seed, p.mix], i * 4);
  });
  const g = new THREE.InstancedBufferGeometry();
  g.index = quad.index;
  g.setAttribute('position', quad.attributes.position);
  g.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
  g.setAttribute('iSize', new THREE.InstancedBufferAttribute(iSize, 4));
  g.setAttribute('iMeta', new THREE.InstancedBufferAttribute(iMeta, 4));
  g.instanceCount = n;
  return g;
}

const additive = {
  transparent: true,
  depthWrite: false,
  depthTest: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
  side: THREE.DoubleSide,
} as const;

/**
 * One branch of the tree: a spine (trunk), procedural circuitry that follows it, instanced
 * components, and a faint "ghost" preview thread. Growth is driven by a single uniform.
 */
export class BranchMesh {
  readonly group = new THREE.Group();
  readonly trunk: Trunk;
  readonly node: TreeNode;
  readonly u: Record<string, AnyUniform>;
  private ghostU: Record<string, AnyUniform>;
  private ghostMesh: THREE.Mesh;
  private traceMesh: THREE.Mesh | null = null;
  private partMesh: THREE.Mesh | null = null;
  private detailBuilt = false;
  private disposables: { dispose(): void }[] = [];

  constructor(
    node: TreeNode,
    parentPos: P,
    parentZ: number,
    startHeading: P,
    private shared: Shared,
  ) {
    this.node = node;
    const rng = new Rng(node.id + ':trunk');
    this.trunk = generateTrunk(node, parentPos, parentZ, startHeading, rng);

    this.u = {
      uTime: shared.uTime,
      uProgress: { value: 0 },
      uPulse: { value: -1 },
      uPulseAmp: { value: 0 },
      uDim: { value: 1 },
      uBoost: { value: 1 },
      uIdle: { value: 1 },
      uGrow: { value: 1 },
      uGhost: { value: 0 },
      uColA: { value: node.palette.a },
      uColB: { value: node.palette.b },
      uAccent: { value: node.palette.accent },
    };
    this.ghostU = {
      ...this.u,
      uProgress: { value: 0 },
      uGhost: { value: 1 },
      uDim: { value: 1 },
      uBoost: { value: 1 },
    };

    // ghost thread = spine only
    const gg = buildRibbon([
      { pts: this.trunk.pts, zs: this.trunk.z, t0: 0, t1: 1, w: 0.016, b: 0.5, kind: 2, seed: 0.5 },
    ]);
    const gm = new THREE.ShaderMaterial({ uniforms: this.ghostU, vertexShader: TRACE_VERT, fragmentShader: TRACE_FRAG, ...additive });
    this.ghostMesh = new THREE.Mesh(gg, gm);
    this.ghostMesh.frustumCulled = false;
    this.ghostMesh.renderOrder = 1;
    this.ghostMesh.visible = false;
    this.group.add(this.ghostMesh);
    this.disposables.push(gg, gm);
  }

  get length() {
    return this.trunk.len;
  }

  /** build the full circuitry lazily the first time the branch is activated */
  ensureDetail(density: number) {
    if (this.detailBuilt) return;
    this.detailBuilt = true;
    const node = this.node;
    const rng = new Rng(node.id + ':detail');
    const L = this.trunk.len;
    const reach = Math.max(0.28, Math.min(1.5, node.clearance * 0.36, L * 0.26));
    const dens = density * Math.min(1, Math.max(0.55, L / 5.5));
    const detail = buildDetail(node.style, this.trunk, rng, reach, dens);

    const lines: RibbonLine[] = [
      {
        pts: this.trunk.pts,
        zs: this.trunk.z,
        t0: 0,
        t1: 1,
        w: node.depth === 1 ? 0.05 : node.depth === 2 ? 0.042 : 0.036,
        b: 1,
        kind: 0,
        seed: 0.37,
        taper: 0.3,
      },
    ];
    for (const l of detail.lines) lines.push({ ...l, kind: 1 });
    const geo = buildRibbon(lines);
    const mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: TRACE_VERT, fragmentShader: TRACE_FRAG, ...additive });
    this.traceMesh = new THREE.Mesh(geo, mat);
    this.traceMesh.frustumCulled = false;
    this.traceMesh.renderOrder = 2;
    this.group.add(this.traceMesh);
    this.disposables.push(geo, mat);

    const pg = buildParts(detail, this.shared.quad);
    if (pg) {
      const pm = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: PART_VERT, fragmentShader: PART_FRAG, ...additive });
      this.partMesh = new THREE.Mesh(pg, pm);
      this.partMesh.frustumCulled = false;
      this.partMesh.renderOrder = 3;
      this.group.add(this.partMesh);
      // position/index attributes belong to the shared quad – only dispose instance data
      this.disposables.push(pm, { dispose: () => pg.dispose() });
    }
  }

  get built() {
    return this.detailBuilt;
  }

  set progress(v: number) {
    this.u.uProgress.value = v;
  }
  get progress() {
    return this.u.uProgress.value as number;
  }
  set ghostProgress(v: number) {
    this.ghostU.uProgress.value = v;
    this.ghostMesh.visible = v > 0.0005;
  }
  get ghostProgress() {
    return this.ghostU.uProgress.value as number;
  }
  setGhostDim(v: number) {
    this.ghostU.uDim.value = v;
  }
  setGhostBoost(v: number) {
    this.ghostU.uBoost.value = v;
  }

  /** world position & heading along the spine, t ∈ [0,1] */
  sample(t: number) {
    return this.trunk.atT(Math.max(0, Math.min(1, t)));
  }

  setVisible(v: boolean) {
    this.group.visible = v;
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.group.clear();
  }
}
