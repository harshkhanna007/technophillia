import * as THREE from 'three';
import type { CategoryData, NodeData, TreeNode } from './types';
import { Rng } from './rng';
import { SEED_SCALE } from './config';
import { Trunk } from './trunk';
import type { P } from './trunk';

export interface LayoutOptions {
  /** anisotropic squash applied to node positions only (used for portrait screens) */
  squashX: number;
  squashY: number;
  /** horizontal reach of the LOWEST first-level nodes from the stem (the crown is widest here) */
  ring: number;
  /** horizontal reach of the HIGHEST first-level nodes: the crown tucks in toward the top */
  ringMin: number;
  /** horizontal distance added per level (index 0 = level 2) */
  steps: number[];
  /** fraction of its band a territory may use (<1 leaves a corridor between neighbours) */
  bandFill: number;
  /** height of one primary band right next to the stem */
  band: number;
  /** how much every band widens per unit of reach beyond the first level: the canopy fans out */
  flare: number;
  /** how steeply every bough climbs: vertical rise from fork to node per unit of horizontal reach */
  lift: number;
  /** height of the lowest band's floor */
  base: number;
  /** stem length above the highest fork */
  crown: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  squashX: 1,
  squashY: 1,
  ring: 13.8,
  ringMin: 6.4,
  steps: [6.6, 5.9, 5.2, 4.6],
  bandFill: 0.9,
  band: 4.4,
  flare: 0.15,
  lift: 0.56,
  base: 6.4,
  crown: 2.6,
};

/** a decorative twig that fills out the trunk: it grows with the stem and never carries a node */
export interface Ornament {
  node: TreeNode;
  origin: { x: number; y: number; hx: number; hy: number };
  /** stem fraction at which it starts to grow */
  t: number;
}

export interface TreeModel {
  root: TreeNode;
  nodes: TreeNode[]; // includes root at index 0
  byId: Map<string, TreeNode>;
  primaries: TreeNode[];
  /** the trunk every primary branch leaves from (seed → crown) */
  stem: Trunk;
  /** palette / style carrier for the stem's branch mesh (not part of `nodes`) */
  stemNode: TreeNode;
  ornaments: Ornament[];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function leafCount(n: NodeData): number {
  if (!n.children || n.children.length === 0) return 1;
  return n.children.reduce((a, c) => a + leafCount(c), 0);
}

const SEED_COLORS = { a: '#37d8ff', b: '#7b5cff', accent: '#ffffff' };
const seedPalette = () => ({
  a: new THREE.Color(SEED_COLORS.a),
  b: new THREE.Color(SEED_COLORS.b),
  accent: new THREE.Color(SEED_COLORS.accent),
});

/**
 * Tree layout.
 * A single stem rises from the seed. Primaries leave it at staggered heights, alternating right and
 * left. Each side is a stack of horizontal bands (one per primary) that fan wider the further they
 * reach from the stem, like a canopy. Children partition their parent's slice of the band, so sibling
 * sub-trees can never cross: the guarantee that the six organisms stay independent.
 */
export function buildTree(categories: CategoryData[], opt: LayoutOptions = DEFAULT_LAYOUT): TreeModel {
  const root: TreeNode = {
    id: 'root',
    title: 'ROOT',
    description: '',
    depth: 0,
    index: 0,
    catIndex: -1,
    parent: null,
    children: [],
    style: 'neural',
    palette: seedPalette(),
    pos: { x: 0, y: 0, z: 0 },
    angle: Math.PI / 2,
    side: 'r',
    leaves: categories.length,
    clearance: 4,
    number: '00',
  };
  const nodes: TreeNode[] = [root];
  const byId = new Map<string, TreeNode>([['root', root]]);
  const N = categories.length;

  const radiusAt = (depth: number, ringBase: number) => {
    let r = ringBase;
    for (let d = 2; d <= depth; d++) r += opt.steps[Math.min(d - 2, opt.steps.length - 1)];
    return r;
  };

  // ── side stacks: even slots grow to the right, odd to the left, bottom → top
  type Side = 1 | -1;
  const slotsOf = (side: Side) => categories.map((_, i) => i).filter((i) => (i % 2 === 0 ? 1 : -1) === side);
  const stacks = new Map<Side, { base: number; height: number; u0: number[]; u1: number[]; slots: number[] }>();
  for (const side of [1, -1] as Side[]) {
    const slots = slotsOf(side);
    if (!slots.length) continue;
    const weights = slots.map((i) => Math.pow(leafCount(categories[i]), 0.75));
    const total = weights.reduce((a, b) => a + b, 0);
    let cursor = 0;
    const u0: number[] = [];
    const u1: number[] = [];
    weights.forEach((w) => {
      u0.push(cursor);
      cursor += w / total;
      u1.push(cursor);
    });
    // the left stack sits half a band higher, so forks zig-zag up the stem
    const base = opt.base + (side === -1 ? opt.band * 0.32 : 0);
    stacks.set(side, { base, height: slots.length * opt.band, u0, u1, slots });
  }

  const place = (
    data: NodeData,
    parent: TreeNode,
    depth: number,
    u0: number,
    u1: number,
    index: number,
    cat: CategoryData,
    catIndex: number,
    side: Side,
    ringBase: number,
  ) => {
    const stack = stacks.get(side)!;
    const id = data.id ?? `${parent.id === 'root' ? '' : parent.id + '/'}${slug(data.title)}`;
    const rng = new Rng(id);
    let u = (u0 + u1) / 2;
    let r = radiusAt(depth, ringBase);
    // stagger odd siblings outward so neighbouring labels never share a baseline
    if (depth >= 2 && index % 2 === 1) r += depth === 2 ? 0.9 : 1.55;
    const span = u1 - u0;
    if (cat.style === 'chaotic' && depth >= 2) {
      r += rng.range(-0.7, 0.9);
      u += rng.range(-0.16, 0.16) * span;
    } else if (cat.style === 'organic' && depth >= 2) {
      u += 0.05 * span * Math.sin(index * 1.7);
      r += Math.sin(index * 2.3) * 0.35;
    } else if (cat.style === 'mechanical' && depth >= 2) {
      // snap to a lattice for a more engineered rhythm
      const q = 0.55 / (stack.height * (1 + opt.flare * Math.max(0, r - ringBase)));
      u = Math.round(u / q) * q;
      u = Math.min(u1 - span * 0.12, Math.max(u0 + span * 0.12, u));
    }
    const yRaw = stack.base + stack.height * u * (1 + opt.flare * Math.max(0, r - ringBase));
    const pos = { x: side * r * opt.squashX, y: yRaw * opt.squashY, z: (rng.next() - 0.5) * 0.9 };
    // outward heading, tilted by how steeply this node climbs away from its parent
    const dx = Math.abs(pos.x - parent.pos.x) || 1;
    const slope = Math.max(-1.2, Math.min(1.2, (pos.y - parent.pos.y) / dx));
    // boughs leave the trunk climbing; deeper levels follow the slope they climb away from their parent
    const angle = depth === 1 ? Math.atan2(0.2, side) : Math.atan2(slope * 0.5, side);

    const node: TreeNode = {
      id,
      title: data.title,
      description: data.description ?? '',
      depth,
      index,
      catIndex,
      parent,
      children: [],
      style: cat.style,
      palette: {
        a: new THREE.Color(cat.palette.a),
        b: new THREE.Color(cat.palette.b),
        accent: new THREE.Color(cat.palette.accent),
      },
      pos,
      angle,
      side: side === 1 ? 'r' : 'l',
      leaves: leafCount(data),
      clearance: 3,
      number: String(depth === 1 ? catIndex + 1 : index + 1).padStart(2, '0'),
    };
    parent.children.push(node);
    nodes.push(node);
    byId.set(id, node);

    const kids = data.children ?? [];
    if (kids.length) {
      const weights = kids.map((k) => Math.pow(leafCount(k), 0.75));
      const total = weights.reduce((a, b) => a + b, 0);
      let cursor = u0;
      kids.forEach((k, i) => {
        const w = (weights[i] / total) * (u1 - u0);
        place(k, node, depth + 1, cursor, cursor + w, i, cat, catIndex, side, ringBase);
        cursor += w;
      });
    }
    return node;
  };

  for (const [side, stack] of stacks) {
    stack.slots.forEach((catIndex, k) => {
      const cat = categories[catIndex];
      const mid = (stack.u0[k] + stack.u1[k]) / 2;
      const half = ((stack.u1[k] - stack.u0[k]) / 2) * opt.bandFill;
      // low boughs reach furthest, the topmost tuck in: a rounded crown
      const K = stack.slots.length;
      const ringBase = opt.ring - (opt.ring - opt.ringMin) * (K > 1 ? k / (K - 1) : 0);
      place(cat, root, 1, mid - half, mid + half, catIndex, cat, catIndex, side, ringBase);
    });
  }
  // keep the children of the root in category order, whatever side they sit on
  root.children.sort((a, b) => a.catIndex - b.catIndex);

  // ── the stem: seed → crown, forks at the height every primary sets out from
  const y0 = 0.6 * SEED_SCALE;
  const minFork = y0 + 1.5;
  const forkY = new Map<string, number>();
  let top = minFork;
  for (const p of root.children) {
    // a bough sweeps up to its node: the further it reaches, the lower on the trunk it starts
    const reach = Math.abs(p.pos.x) / Math.max(0.5, opt.squashX);
    const fy = Math.max(minFork, p.pos.y - opt.lift * reach * opt.squashY);
    forkY.set(p.id, fy);
    top = Math.max(top, fy);
  }
  top += opt.crown;
  const pts: P[] = [];
  const step = 0.075;
  const n = Math.ceil((top - y0) / step);
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const y = y0 + (top - y0) * u;
    // a living sway: strongest mid-stem, zero where it leaves the seed and at the crown
    const env = Math.pow(Math.sin(Math.PI * u), 0.8);
    pts.push({ x: 0.34 * Math.sin(y * 0.34 + 0.6) * env, y });
  }
  const stem = new Trunk(pts, 0, 0);

  const yAt = (s: number) => stem.at(s).y;
  for (const p of root.children) {
    const fy = forkY.get(p.id)!;
    let lo = 0;
    let hi = stem.len;
    for (let k = 0; k < 28; k++) {
      const mid = (lo + hi) / 2;
      if (yAt(mid) < fy) lo = mid;
      else hi = mid;
    }
    const s = (lo + hi) / 2;
    const f = stem.at(s);
    const side = p.side === 'r' ? 1 : -1;
    // boughs leave steeply and flatten as they reach out: an arch
    const tt = s / stem.len;
    const ang = ((62 + 10 * tt) * Math.PI) / 180;
    p.origin = { x: f.x, y: f.y, hx: side * Math.cos(ang), hy: Math.sin(ang), t: tt };
  }

  // ── ornamental twigs: fill the silhouette between the forks, flare the base, crown the tip
  const ornaments: Ornament[] = [];
  {
    const forks = root.children.map((p) => ({ t: p.origin!.t, side: p.side === 'r' ? 1 : -1, p }));
    const nearest = (t: number) => forks.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
    const add = (k: number, t: number, side: 1 | -1, len: number, angDeg: number, bend: number, palette?: TreeNode['palette']) => {
      const rng = new Rng('ornament-' + k);
      const f = stem.at(Math.min(stem.len, Math.max(0, t * stem.len)));
      const a = (angDeg * Math.PI) / 180;
      const l = len * (1 + rng.range(-0.12, 0.12));
      const dx = side * Math.cos(a) * l * Math.max(0.6, opt.squashX);
      const dy = (Math.sin(a) * l + bend) * Math.sqrt(opt.squashY);
      const src = palette ?? nearest(t).p.palette;
      const node: TreeNode = {
        id: 'ornament-' + k,
        title: '',
        description: '',
        depth: 4,
        index: k,
        catIndex: -1,
        parent: null,
        children: [],
        style: 'network',
        palette: { a: src.a.clone(), b: src.b.clone(), accent: src.accent.clone() },
        pos: { x: f.x + dx, y: f.y + dy, z: 0 },
        angle: Math.atan2(Math.sin(a) + 0.55, side * Math.cos(a)),
        side: side === 1 ? 'r' : 'l',
        leaves: 1,
        clearance: 2.2,
        number: '',
      };
      ornaments.push({ node, origin: { x: f.x, y: f.y, hx: side * Math.cos(a), hy: Math.sin(a) }, t });
    };
    let k = 0;
    // one twig in every gap between forks: below the first, between each pair, above the last
    const byT = [...forks].sort((x, y) => x.t - y.t);
    const slots: { t: number; side: 1 | -1 }[] = [{ t: byT[0].t * 0.58, side: (byT[0].side * -1) as 1 | -1 }];
    for (let i = 0; i < byT.length - 1; i++) slots.push({ t: (byT[i].t + byT[i + 1].t) / 2, side: byT[i + 1].side as 1 | -1 });
    const last = byT[byT.length - 1];
    slots.push({ t: Math.min(0.94, (last.t + 1) / 2), side: (last.side * -1) as 1 | -1 });
    for (const sl of slots) add(k++, sl.t, sl.side, 5.0 - 2.2 * sl.t, 24 + 34 * sl.t, 0.5 + 0.9 * sl.t);
    // buttresses: the trunk spreads at its base
    const seedPal = seedPalette();
    add(k++, 0.05, 1, 5.6, 12, -0.15, seedPal);
    add(k++, 0.05, -1, 5.6, 12, -0.15, seedPal);
    // crown: the tip opens into three
    add(k++, 0.985, 1, 3.2, 50, 0.7, seedPal);
    add(k++, 0.985, -1, 3.2, 50, 0.7, seedPal);
  }

  // clearance = distance to the nearest sibling (or neighbouring primary on the same side)
  for (const nd of nodes) {
    if (!nd.parent) continue;
    let best = Infinity;
    for (const s of nd.parent.children) {
      if (s === nd) continue;
      if (nd.depth === 1 && s.side !== nd.side) continue;
      best = Math.min(best, Math.hypot(s.pos.x - nd.pos.x, s.pos.y - nd.pos.y));
    }
    nd.clearance = Number.isFinite(best) ? best : 4;
  }

  const stemNode: TreeNode = {
    id: 'stem',
    title: 'STEM',
    description: '',
    depth: 0,
    index: 0,
    catIndex: -1,
    parent: null,
    children: [],
    style: 'quantum',
    palette: seedPalette(),
    pos: { x: pts[pts.length - 1].x, y: top, z: 0 },
    angle: Math.PI / 2,
    side: 'r',
    leaves: N,
    clearance: 3.4,
    number: '00',
  };

  return { root, nodes, byId, primaries: root.children, stem, stemNode, ornaments };
}

export function ancestry(node: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  let n: TreeNode | null = node;
  while (n && n.depth > 0) {
    out.unshift(n);
    n = n.parent;
  }
  return out;
}

export function isDescendant(node: TreeNode, ancestor: TreeNode): boolean {
  let n: TreeNode | null = node;
  while (n) {
    if (n === ancestor) return true;
    n = n.parent;
  }
  return false;
}
