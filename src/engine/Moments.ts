import * as THREE from 'three';
import { MOMENT_FRAG, MOMENT_VERT } from './shaders';
import { SIGNATURE, STYLE_INDEX } from './signature';
import type { AnyUniform, Shared } from './BranchMesh';
import type { TreeNode } from './types';

const additive = {
  transparent: true,
  depthWrite: false,
  depthTest: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
} as const;

interface Slot {
  mesh: THREE.Mesh;
  u: Record<string, AnyUniform>;
  age: number;
  dur: number;
  live: boolean;
}

/**
 * The signature moment of a branch, played where a node opens: a signal crossing a neural net, a servo
 * locking, a flower blooming… A small pool of quads shares one shader; each plays its own short film.
 */
export class Moments {
  readonly group = new THREE.Group();
  private pool: Slot[] = [];
  private mats: THREE.ShaderMaterial[] = [];

  constructor(shared: Shared, size = 3) {
    for (let i = 0; i < size; i++) {
      const u = {
        uPos: { value: new THREE.Vector3() },
        uSize: { value: 2.6 },
        uAge: { value: 0 },
        uStyle: { value: 0 },
        uSeed: { value: 0 },
        uPower: { value: 1 },
        uCalm: { value: 0 },
        uColA: { value: new THREE.Color() },
        uColB: { value: new THREE.Color() },
        uAccent: { value: new THREE.Color() },
      };
      const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: MOMENT_VERT, fragmentShader: MOMENT_FRAG, ...additive });
      const mesh = new THREE.Mesh(shared.quad, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 7;
      mesh.visible = false;
      this.group.add(mesh);
      this.mats.push(mat);
      this.pool.push({ mesh, u, age: 1, dur: 1, live: false });
    }
  }

  /** `power` softens a replay (re-visiting a node); `calm` drops flicker and glitch for reduced motion */
  fire(node: TreeNode, power = 1, calm = false) {
    const slot = this.pool.find((s) => !s.live) ?? this.pool.reduce((a, b) => (b.age > a.age ? b : a));
    slot.live = true;
    slot.age = 0;
    slot.dur = SIGNATURE[node.style].dur * (calm ? 0.8 : 1);
    const u = slot.u;
    u.uPos.value.set(node.pos.x, node.pos.y, node.pos.z);
    u.uSize.value = node.depth <= 1 ? 2.9 : node.depth === 2 ? 2.6 : 2.3;
    u.uAge.value = 0;
    u.uStyle.value = STYLE_INDEX[node.style];
    u.uSeed.value = (node.index * 0.6180339 + node.catIndex * 0.137) % 1;
    u.uPower.value = power;
    u.uCalm.value = calm ? 1 : 0;
    u.uColA.value.copy(node.palette.a);
    u.uColB.value.copy(node.palette.b);
    u.uAccent.value.copy(node.palette.accent);
    slot.mesh.visible = true;
  }

  update(dt: number) {
    for (const s of this.pool) {
      if (!s.live) continue;
      s.age += dt / s.dur;
      if (s.age >= 1) {
        s.live = false;
        s.mesh.visible = false;
      } else s.u.uAge.value = s.age;
    }
  }

  dispose() {
    for (const m of this.mats) m.dispose();
  }
}
