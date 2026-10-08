import * as THREE from 'three';
import { FOLIAGE_VERT, LEAF_FRAG } from './shaders';
import type { Occupancy } from './clearance';
import type { Shared } from './BranchMesh';
import { Rng } from './rng';
import type { Trunk } from './trunk';
import type { RuntimePalette } from './types';

/** a branch that carries leaves: its spine, the palette they take their colour from, and the id it is registered under */
export interface FoliageSource {
  id: string;
  trunk: Trunk;
  palette: RuntimePalette;
}

export interface FoliageOptions {
  sway: boolean;
  /** 1 = full canopy; fewer leaves on weaker devices */
  density: number;
}

const BASE_LEN = 0.5;
const STALK = 0.04;
/** a leaf's tip and middle must stay at least this far from any other strand */
const TIP_GAP = 0.17;
const MID_GAP = 0.14;

const additive = {
  transparent: true,
  depthWrite: false,
  depthTest: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
} as const;

interface LeafOut {
  x: number;
  y: number;
  z: number;
  fan: number;
  len: number;
  hw: number;
  curl: number;
  appear: number;
  seed: number;
  tangent: number;
}

/** leaves alternate along a spine, largest near the base and smaller toward the bud, with one at the very tip */
function sprout(src: FoliageSource, occ: Occupancy, density: number, emit: (l: LeafOut) => void) {
  const { trunk, id } = src;
  const rng = new Rng(id + ':leaves');
  const L = trunk.len;
  const place = (s: number, side: number, fanAbs: number, scale: number) => {
    const f = trunk.at(s);
    const tangent = Math.atan2(f.ty, f.tx);
    const fan = side * fanAbs;
    let len = BASE_LEN * scale * rng.range(0.85, 1.15);
    // steer clear of the neighbours: shorten the leaf until its tip and middle stand free, or leave this one out
    for (; len >= 0.17; len *= 0.78) {
      const ax = Math.cos(tangent + fan);
      const ay = Math.sin(tangent + fan);
      if (occ.distance(f.x + ax * (STALK + len), f.y + ay * (STALK + len), 0.3, id) > TIP_GAP && occ.distance(f.x + ax * (STALK + len * 0.55), f.y + ay * (STALK + len * 0.55), 0.3, id) > MID_GAP) {
        emit({ x: f.x, y: f.y, z: f.z, fan, len, hw: rng.range(0.2, 0.25), curl: -side * rng.range(0.1, 0.22), appear: (s / L) * 0.88, seed: rng.next(), tangent });
        return;
      }
    }
  };
  const s0 = Math.min(0.9, L * 0.3);
  const s1 = L * 0.96;
  const n = Math.floor((s1 - s0) / (0.46 / density));
  for (let i = 0; i < n; i++) {
    const s = s0 + ((i + rng.range(0.15, 0.85)) / n) * (s1 - s0);
    place(s, i % 2 === 0 ? 1 : -1, rng.range(0.7, 1.1), 1 - 0.42 * (s / L));
  }
  place(L, rng.sign(), rng.range(0.05, 0.25), 0.6);
}

/**
 * Leaves for every twig and ornament, drawn as one instanced mesh. Each carries its branch's own colours,
 * unfurls as that branch grows, and sways in a breeze that ripples across the whole canopy.
 */
export class Foliage {
  readonly mesh: THREE.Mesh;
  private state: Float32Array;
  private attr: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;
  /** first leaf of every group, plus the end of the last: group g owns [starts[g], starts[g + 1]) */
  private starts: number[] = [0];
  private last: Float32Array;
  private dirty = false;

  constructor(sources: FoliageSource[], shared: Shared, occ: Occupancy, opts: FoliageOptions) {
    const pos: number[] = [];
    const col: number[] = [];
    const acc: number[] = [];
    const leaf: number[] = [];
    const meta: number[] = [];
    let count = 0;
    for (const src of sources) {
      const { a, accent } = src.palette;
      sprout(src, occ, opts.density, (l) => {
        pos.push(l.x, l.y, l.z);
        col.push(a.r, a.g, a.b);
        acc.push(accent.r, accent.g, accent.b);
        leaf.push(l.fan, l.len, l.hw, l.curl);
        meta.push(l.appear, l.seed, l.tangent, STALK);
        count++;
      });
      this.starts.push(count);
    }
    this.last = new Float32Array(sources.length * 2).fill(-1);
    this.state = new Float32Array(count * 4);

    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = shared.quad.index;
    this.geo.setAttribute('position', shared.quad.attributes.position);
    this.geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(pos), 3));
    this.geo.setAttribute('iColA', new THREE.InstancedBufferAttribute(new Float32Array(col), 3));
    this.geo.setAttribute('iAccent', new THREE.InstancedBufferAttribute(new Float32Array(acc), 3));
    this.geo.setAttribute('iLeaf', new THREE.InstancedBufferAttribute(new Float32Array(leaf), 4));
    this.geo.setAttribute('iMeta', new THREE.InstancedBufferAttribute(new Float32Array(meta), 4));
    this.attr = new THREE.InstancedBufferAttribute(this.state, 4);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iState', this.attr);
    this.geo.instanceCount = count;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: shared.uTime, uSway: { value: opts.sway ? 1 : 0 } },
      vertexShader: FOLIAGE_VERT,
      fragmentShader: LEAF_FRAG,
      ...additive,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = count > 0;
  }

  /** how far a branch has grown (0..1) and how lit it is; every leaf on it follows */
  set(group: number, progress: number, glow: number) {
    const k = group * 2;
    if (Math.abs(this.last[k] - progress) < 1e-4 && Math.abs(this.last[k + 1] - glow) < 1e-3) return;
    this.last[k] = progress;
    this.last[k + 1] = glow;
    for (let i = this.starts[group], end = this.starts[group + 1]; i < end; i++) {
      this.state[i * 4] = progress;
      this.state[i * 4 + 1] = glow;
    }
    this.dirty = true;
  }

  commit() {
    if (!this.dirty) return;
    this.attr.needsUpdate = true;
    this.dirty = false;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}
