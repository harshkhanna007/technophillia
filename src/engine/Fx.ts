import * as THREE from 'three';
import {
  BG_FRAG,
  BG_VERT,
  LEAF_FRAG,
  LEAF_VERT,
  MARKER_FRAG,
  MARKER_VERT,
  ORB_FRAG,
  ORB_VERT,
  PARTICLE_FRAG,
  PARTICLE_VERT,
  RING_FRAG,
  RING_VERT,
  SEED_FRAG,
  SEED_VERT,
  SPARK_FRAG,
  SPARK_VERT,
} from './shaders';
import type { AnyUniform, Shared } from './BranchMesh';
import { SEED_SCALE } from './config';
import type { TreeNode } from './types';

const additive = {
  transparent: true,
  depthWrite: false,
  depthTest: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
} as const;

/* ───────────────────────── node markers ───────────────────────── */
export class NodeMarkers {
  readonly mesh: THREE.Mesh;
  private state: Float32Array;
  private attr: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;

  constructor(nodes: TreeNode[], shared: Shared) {
    const n = nodes.length;
    const iPos = new Float32Array(n * 3);
    const iColA = new Float32Array(n * 3);
    const iAccent = new Float32Array(n * 3);
    const iInfo = new Float32Array(n * 4);
    this.state = new Float32Array(n * 4);
    nodes.forEach((node, i) => {
      iPos.set([node.pos.x, node.pos.y, node.pos.z], i * 3);
      iColA.set([node.palette.a.r, node.palette.a.g, node.palette.a.b], i * 3);
      iAccent.set([node.palette.accent.r, node.palette.accent.g, node.palette.accent.b], i * 3);
      const size = node.depth === 1 ? 0.72 : node.depth === 2 ? 0.52 : 0.42;
      iInfo.set([size, (i * 0.6180339) % 1, node.depth, 0], i * 4);
    });
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = shared.quad.index;
    this.geo.setAttribute('position', shared.quad.attributes.position);
    this.geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
    this.geo.setAttribute('iColA', new THREE.InstancedBufferAttribute(iColA, 3));
    this.geo.setAttribute('iAccent', new THREE.InstancedBufferAttribute(iAccent, 3));
    this.geo.setAttribute('iInfo', new THREE.InstancedBufferAttribute(iInfo, 4));
    this.attr = new THREE.InstancedBufferAttribute(this.state, 4);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iState', this.attr);
    this.geo.instanceCount = n;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: shared.uTime },
      vertexShader: MARKER_VERT,
      fragmentShader: MARKER_FRAG,
      ...additive,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  set(i: number, vis: number, act: number, hov: number, flare: number) {
    const o = i * 4;
    this.state[o] = vis;
    this.state[o + 1] = act;
    this.state[o + 2] = hov;
    this.state[o + 3] = flare;
  }

  commit() {
    this.attr.needsUpdate = true;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/* ───────────────────────── node leaves ───────────────────────── */
/** nodes this deep (or deeper) wear a sprig; the trunk and the primary boughs keep their clean look */
const LEAF_MIN_DEPTH = 2;
/** per leaf: [angle off the node's heading, length, half width, curl] and [stalk length, unfurl delay] (world units) */
const LEAF_SPEC_A = [
  [1.0, 0.54, 0.23, -0.2],
  [-0.92, 0.48, 0.22, 0.18],
  [0.16, 0.3, 0.2, -0.08],
];
const LEAF_SPEC_B = [
  [0.15, 0],
  [0.15, 0.14],
  [0.13, 0.28],
];

/** A sprig of glass leaves on every node, tinted with the node's own palette and driven by the same state as its marker. */
export class NodeLeaves {
  readonly mesh: THREE.Mesh;
  private state: Float32Array;
  private attr: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;
  /** node index → instance slot (-1 = this node has no leaves) */
  private slotOf: Int32Array;

  constructor(nodes: TreeNode[], shared: Shared, opts: { leaves: number; sway: boolean }) {
    const K = Math.min(opts.leaves, LEAF_SPEC_A.length);
    this.slotOf = new Int32Array(nodes.length).fill(-1);
    let n = 0;
    nodes.forEach((node, i) => {
      if (node.depth >= LEAF_MIN_DEPTH) this.slotOf[i] = n++;
    });
    const iPos = new Float32Array(n * 3);
    const iColA = new Float32Array(n * 3);
    const iAccent = new Float32Array(n * 3);
    const iInfo = new Float32Array(n * 4);
    this.state = new Float32Array(n * 4);
    nodes.forEach((node, i) => {
      const s = this.slotOf[i];
      if (s < 0) return;
      iPos.set([node.pos.x, node.pos.y, node.pos.z], s * 3);
      iColA.set([node.palette.a.r, node.palette.a.g, node.palette.a.b], s * 3);
      iAccent.set([node.palette.accent.r, node.palette.accent.g, node.palette.accent.b], s * 3);
      // sprigs scale with the marker they grow from (depth 2 is the reference size)
      const size = node.depth === 2 ? 0.52 : 0.42;
      iInfo.set([node.angle, size / 0.52, (i * 0.6180339) % 1, 0], s * 4);
    });

    // one quad per leaf, tagged with its index
    const pos = new Float32Array(K * 12);
    const leaf = new Float32Array(K * 4);
    const idx = new Uint16Array(K * 6);
    const corner = [-1, -1, 1, -1, 1, 1, -1, 1];
    for (let k = 0; k < K; k++) {
      for (let c = 0; c < 4; c++) {
        pos[(k * 4 + c) * 3] = corner[c * 2];
        pos[(k * 4 + c) * 3 + 1] = corner[c * 2 + 1];
        leaf[k * 4 + c] = k;
      }
      idx.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3], k * 6);
    }
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('aLeaf', new THREE.BufferAttribute(leaf, 1));
    this.geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
    this.geo.setAttribute('iColA', new THREE.InstancedBufferAttribute(iColA, 3));
    this.geo.setAttribute('iAccent', new THREE.InstancedBufferAttribute(iAccent, 3));
    this.geo.setAttribute('iInfo', new THREE.InstancedBufferAttribute(iInfo, 4));
    this.attr = new THREE.InstancedBufferAttribute(this.state, 4);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iState', this.attr);
    this.geo.instanceCount = n;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: shared.uTime,
        uSway: { value: opts.sway ? 1 : 0 },
        uSpecA: { value: LEAF_SPEC_A.map((a) => new THREE.Vector4(...(a as [number, number, number, number]))) },
        uSpecB: { value: LEAF_SPEC_B.map((b) => new THREE.Vector4(b[0], b[1], 0, 0)) },
      },
      vertexShader: LEAF_VERT,
      fragmentShader: LEAF_FRAG,
      ...additive,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  set(i: number, vis: number, act: number, hov: number, flare: number) {
    const s = this.slotOf[i];
    if (s < 0) return;
    const o = s * 4;
    this.state[o] = vis;
    this.state[o + 1] = act;
    this.state[o + 2] = hov;
    this.state[o + 3] = flare;
  }

  commit() {
    this.attr.needsUpdate = true;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/* ───────────────────────── seed ───────────────────────── */
export class Seed {
  readonly mesh: THREE.Mesh;
  readonly u: Record<string, AnyUniform>;
  private mat: THREE.ShaderMaterial;
  flare = 0;

  constructor(shared: Shared, a: THREE.Color, b: THREE.Color, hot: THREE.Color, extent = 2.2 * SEED_SCALE) {
    this.u = {
      uTime: shared.uTime,
      uScale: { value: SEED_SCALE },
      uAppear: { value: 0 },
      uSprout: { value: 0 },
      uEnergy: { value: 0 },
      uFlare: { value: 0 },
      uHover: { value: 0 },
      uExtent: { value: extent },
      uColA: { value: a },
      uColB: { value: b },
      uHot: { value: hot },
    };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: SEED_VERT, fragmentShader: SEED_FRAG, ...additive });
    this.mesh = new THREE.Mesh(shared.quad, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  dispose() {
    this.mat.dispose();
  }
}

/* ───────────────────────── reactive PCB background ───────────────────────── */
export class Background {
  readonly mesh: THREE.Mesh;
  readonly u: Record<string, AnyUniform>;
  private mat: THREE.ShaderMaterial;
  private geo: THREE.PlaneGeometry;
  readonly lights: THREE.Vector4[];
  readonly lightCols: THREE.Color[];

  constructor(shared: Shared, lightCount: number) {
    this.lights = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 4, 0));
    this.lightCols = Array.from({ length: 8 }, () => new THREE.Color(0.3, 0.5, 1));
    this.u = {
      uTime: shared.uTime,
      uLights: { value: this.lights },
      uLightCol: { value: this.lightCols },
      uFocus: { value: new THREE.Vector2() },
      uReveal: { value: 1 },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: BG_VERT,
      fragmentShader: BG_FRAG,
      defines: { LIGHTS: Math.min(8, lightCount) },
      ...additive,
    });
    this.geo = new THREE.PlaneGeometry(260, 260);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.position.z = -6.5;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  setLight(i: number, x: number, y: number, radius: number, intensity: number, color?: THREE.Color) {
    if (i >= this.lights.length) return;
    this.lights[i].set(x, y, radius, intensity);
    if (color) this.lightCols[i].copy(color);
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/* ───────────────────────── ambient particles ───────────────────────── */
export class AmbientParticles {
  readonly points: THREE.Points;
  readonly u: Record<string, AnyUniform>;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  flow = 0;

  constructor(shared: Shared, count: number, pixelRatio: number, lightU: { uLights: AnyUniform; uLightCol: AnyUniform }, lightCount: number) {
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    this.geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.u = {
      uTime: shared.uTime,
      uFlow: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(70, 46, 22) },
      uPx: { value: pixelRatio },
      uActivity: { value: 0 },
      uLights: lightU.uLights,
      uLightCol: lightU.uLightCol,
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      defines: { LIGHTS: Math.min(8, lightCount) },
      ...additive,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = -5;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/* ───────────────────────── sparks ───────────────────────── */
export class Sparks {
  readonly points: THREE.Points;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  private origin: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private color: Float32Array;
  private head = 0;
  private dirty = false;
  private attrs: THREE.BufferAttribute[] = [];

  constructor(private shared: Shared, private count: number, pixelRatio: number) {
    this.origin = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count * 4);
    this.color = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) this.life[i * 4] = -1000;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const mk = (name: string, arr: Float32Array, size: number) => {
      const a = new THREE.BufferAttribute(arr, size);
      a.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute(name, a);
      this.attrs.push(a);
    };
    mk('aOrigin', this.origin, 3);
    mk('aVel', this.vel, 3);
    mk('aLife', this.life, 4);
    mk('aColor', this.color, 3);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: shared.uTime, uPx: { value: pixelRatio } },
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      ...additive,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  /** radial / directional burst */
  burst(
    x: number,
    y: number,
    z: number,
    n: number,
    opt: { speed?: number; life?: number; size?: number; color: THREE.Color; dir?: { x: number; y: number }; spread?: number; hot?: number },
  ) {
    const speed = opt.speed ?? 3;
    const life = opt.life ?? 1.1;
    const size = opt.size ?? 5;
    const spread = opt.spread ?? Math.PI;
    const base = opt.dir ? Math.atan2(opt.dir.y, opt.dir.x) : 0;
    const t = this.shared.uTime.value;
    for (let i = 0; i < n; i++) {
      const k = this.head;
      this.head = (this.head + 1) % this.count;
      const ang = opt.dir ? base + (Math.random() * 2 - 1) * spread : Math.random() * Math.PI * 2;
      const sp = speed * (0.25 + Math.random() * 0.9);
      this.origin[k * 3] = x + (Math.random() - 0.5) * 0.06;
      this.origin[k * 3 + 1] = y + (Math.random() - 0.5) * 0.06;
      this.origin[k * 3 + 2] = z + (Math.random() - 0.5) * 0.3;
      this.vel[k * 3] = Math.cos(ang) * sp;
      this.vel[k * 3 + 1] = Math.sin(ang) * sp;
      this.vel[k * 3 + 2] = (Math.random() - 0.5) * sp * 0.4;
      this.life[k * 4] = t;
      this.life[k * 4 + 1] = life * (0.55 + Math.random() * 0.7);
      this.life[k * 4 + 2] = size * (0.5 + Math.random());
      const mixHot = Math.random() < (opt.hot ?? 0.25) ? 1 : 0;
      this.color[k * 3] = opt.color.r + (1 - opt.color.r) * mixHot * 0.7;
      this.color[k * 3 + 1] = opt.color.g + (1 - opt.color.g) * mixHot * 0.7;
      this.color[k * 3 + 2] = opt.color.b + (1 - opt.color.b) * mixHot * 0.7;
    }
    this.dirty = true;
  }

  flush() {
    if (!this.dirty) return;
    for (const a of this.attrs) a.needsUpdate = true;
    this.dirty = false;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/* ───────────────────────── energy orb ───────────────────────── */
export class EnergyOrb {
  readonly mesh: THREE.Mesh;
  readonly u: Record<string, AnyUniform>;
  private mat: THREE.ShaderMaterial;

  constructor(shared: Shared) {
    this.u = {
      uTime: shared.uTime,
      uPos: { value: new THREE.Vector3() },
      uSize: { value: 0.95 },
      uAmp: { value: 0 },
      uDir: { value: new THREE.Vector2(1, 0) },
      uColor: { value: new THREE.Color('#5ae0ff') },
    };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: ORB_VERT, fragmentShader: ORB_FRAG, ...additive });
    this.mesh = new THREE.Mesh(shared.quad, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.mesh.visible = false;
  }

  dispose() {
    this.mat.dispose();
  }
}

/* ───────────────────────── shock rings ───────────────────────── */
export class ShockRings {
  readonly group = new THREE.Group();
  private pool: { mesh: THREE.Mesh; u: Record<string, AnyUniform>; age: number; dur: number; live: boolean }[] = [];
  private mats: THREE.ShaderMaterial[] = [];

  constructor(shared: Shared, size = 10) {
    for (let i = 0; i < size; i++) {
      const u = {
        uPos: { value: new THREE.Vector3() },
        uSize: { value: 2 },
        uAge: { value: 1 },
        uColor: { value: new THREE.Color('#5ae0ff') },
      };
      const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: RING_VERT, fragmentShader: RING_FRAG, ...additive });
      const mesh = new THREE.Mesh(shared.quad, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 8;
      mesh.visible = false;
      this.group.add(mesh);
      this.mats.push(mat);
      this.pool.push({ mesh, u, age: 1, dur: 1, live: false });
    }
  }

  fire(x: number, y: number, z: number, color: THREE.Color, size = 2.2, dur = 1.2) {
    const r = this.pool.find((p) => !p.live) ?? this.pool[0];
    r.live = true;
    r.age = 0;
    r.dur = dur;
    r.u.uPos.value.set(x, y, z);
    r.u.uSize.value = size;
    r.u.uColor.value.copy(color);
    r.mesh.visible = true;
  }

  update(dt: number) {
    for (const r of this.pool) {
      if (!r.live) continue;
      r.age += dt / r.dur;
      if (r.age >= 1) {
        r.live = false;
        r.mesh.visible = false;
      } else r.u.uAge.value = r.age;
    }
  }

  dispose() {
    for (const m of this.mats) m.dispose();
  }
}
