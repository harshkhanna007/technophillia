import * as THREE from 'three';
import { BLOSSOM_FRAG, BLOSSOM_VERT } from './shaders';
import type { Occupancy } from './clearance';
import type { Shared } from './BranchMesh';
import { Rng } from './rng';
import type { FoliageSource } from './Foliage';

export interface BlossomOptions {
  sway: boolean;
  /** 1 = full canopy; fewer flowers on weaker devices */
  density: number;
}

/** a flower must stand at least this far from any other strand */
const CLEAR = 0.2;

const additive = {
  transparent: true,
  depthWrite: false,
  depthTest: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
} as const;

interface FlowerOut {
  x: number;
  y: number;
  z: number;
  size: number;
  seed: number;
  appear: number;
}

/** one flower at the tip of a twig, and a few along it on short stalks, alternating sides */
function flowers(src: FoliageSource, occ: Occupancy, density: number, emit: (f: FlowerOut) => void) {
  const { trunk, id } = src;
  const rng = new Rng(id + ':blossoms');
  const L = trunk.len;
  const put = (s: number, side: number, size: number) => {
    const f = trunk.at(s);
    const off = side * 0.1;
    const x = f.x + f.nx * off;
    const y = f.y + f.ny * off;
    if (occ.distance(x, y, 0.3, id) <= CLEAR) return;
    emit({ x, y, z: f.z, size, seed: rng.next(), appear: s / L });
  };
  const tip = trunk.at(L);
  if (occ.distance(tip.x, tip.y, 0.3, id) > CLEAR) emit({ x: tip.x, y: tip.y, z: tip.z, size: rng.range(0.32, 0.4), seed: rng.next(), appear: 1 });
  const s0 = Math.min(1.1, L * 0.35);
  const s1 = L * 0.86;
  const n = Math.floor((s1 - s0) / (0.95 / density));
  for (let i = 0; i < n; i++) put(s0 + ((i + rng.range(0.2, 0.8)) / n) * (s1 - s0), i % 2 === 0 ? 1 : -1, rng.range(0.22, 0.3));
}

/**
 * Blossoms for the twigs and crown branches. They share the foliage's group indices: a group is one twig,
 * and `set(group, progress, bloom)` says how far the twig has grown and how far its bloom wave has travelled.
 */
export class Blossoms {
  readonly mesh: THREE.Mesh;
  private state: Float32Array;
  private attr: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;
  /** group g owns flowers [starts[g], starts[g + 1]) */
  private starts: number[] = [0];
  private last: Float32Array;
  private dirty = false;

  constructor(sources: FoliageSource[], shared: Shared, occ: Occupancy, opts: BlossomOptions) {
    const pos: number[] = [];
    const col: number[] = [];
    const acc: number[] = [];
    const info: number[] = [];
    let count = 0;
    for (const src of sources) {
      const { a, accent } = src.palette;
      flowers(src, occ, opts.density, (f) => {
        pos.push(f.x, f.y, f.z);
        col.push(a.r, a.g, a.b);
        acc.push(accent.r, accent.g, accent.b);
        info.push(f.size, f.seed, f.appear, 0);
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
    this.geo.setAttribute('iFlower', new THREE.InstancedBufferAttribute(new Float32Array(info), 4));
    this.attr = new THREE.InstancedBufferAttribute(this.state, 4);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iState', this.attr);
    this.geo.instanceCount = count;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: shared.uTime, uDpr: shared.uDpr, uSway: { value: opts.sway ? 1 : 0 } },
      vertexShader: BLOSSOM_VERT,
      fragmentShader: BLOSSOM_FRAG,
      ...additive,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = count > 0;
  }

  set(group: number, progress: number, bloom: number) {
    const k = group * 2;
    if (Math.abs(this.last[k] - progress) < 1e-4 && Math.abs(this.last[k + 1] - bloom) < 1e-3) return;
    this.last[k] = progress;
    this.last[k + 1] = bloom;
    for (let i = this.starts[group], end = this.starts[group + 1]; i < end; i++) {
      this.state[i * 4] = progress;
      this.state[i * 4 + 1] = bloom;
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
