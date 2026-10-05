import * as THREE from 'three';
import type { CategoryData, NodeData, TreeNode } from './types';
import { Rng } from './rng';

export interface LayoutOptions {
  /** anisotropic squash applied to node positions only (used for portrait screens) */
  squashX: number;
  squashY: number;
  /** radius of the first ring of primary nodes */
  ring: number;
  /** radial distance added per level (index 0 = level 2) */
  steps: number[];
  /** fraction of the half wedge a territory may use (<1 leaves a corridor between neighbours) */
  wedgeFill: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  squashX: 1,
  squashY: 1,
  ring: 6.4,
  steps: [5.9, 5.3, 4.7, 4.2],
  wedgeFill: 0.84,
};

export interface TreeModel {
  root: TreeNode;
  nodes: TreeNode[]; // includes root at index 0
  byId: Map<string, TreeNode>;
  primaries: TreeNode[];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function leafCount(n: NodeData): number {
  if (!n.children || n.children.length === 0) return 1;
  return n.children.reduce((a, c) => a + leafCount(c), 0);
}

/**
 * Radial-wedge layout.
 * Every primary category owns a wedge of the plane. Children partition their parent's
 * angular interval, so sibling sub-trees can never cross – that is the guarantee that the
 * six organisms stay independent and the tree never tangles.
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
    palette: {
      a: new THREE.Color('#5ad8ff'),
      b: new THREE.Color('#8f7bff'),
      accent: new THREE.Color('#ffffff'),
    },
    pos: { x: 0, y: 0, z: 0 },
    angle: 0,
    side: 'r',
    leaves: categories.length,
    clearance: 4,
    number: '00',
  };
  const nodes: TreeNode[] = [root];
  const byId = new Map<string, TreeNode>([['root', root]]);
  const N = categories.length;
  const wedge = (Math.PI * 2) / N;
  const half = (wedge / 2) * opt.wedgeFill;

  const radiusAt = (depth: number) => {
    let r = opt.ring;
    for (let d = 2; d <= depth; d++) r += opt.steps[Math.min(d - 2, opt.steps.length - 1)];
    return r;
  };

  const place = (
    data: NodeData,
    parent: TreeNode,
    depth: number,
    a0: number,
    a1: number,
    index: number,
    cat: CategoryData,
    catIndex: number,
    axis: number | null,
  ) => {
    const id = data.id ?? `${parent.id === 'root' ? '' : parent.id + '/'}${slug(data.title)}`;
    const rng = new Rng(id);
    let angle = axis ?? (a0 + a1) / 2;
    let r = radiusAt(depth);
    // stagger odd siblings radially so neighbouring labels never share a baseline
    if (depth >= 2 && index % 2 === 1) r += depth === 2 ? 0.9 : 1.55;
    // personality offsets
    const span = a1 - a0;
    if (cat.style === 'chaotic' && depth >= 2) {
      r += rng.range(-0.7, 0.9);
      angle += rng.range(-0.16, 0.16) * span;
    } else if (cat.style === 'organic' && depth >= 2) {
      angle += 0.05 * span * Math.sin(index * 1.7);
      r += Math.sin(index * 2.3) * 0.35;
    } else if (cat.style === 'mechanical' && depth >= 2) {
      // snap to a 7.5° lattice for a more engineered rhythm
      const q = Math.PI / 24;
      angle = Math.round(angle / q) * q;
      angle = Math.min(a1 - span * 0.12, Math.max(a0 + span * 0.12, angle));
    }
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
      pos: {
        x: Math.cos(angle) * r * opt.squashX,
        y: Math.sin(angle) * r * opt.squashY,
        z: (rng.next() - 0.5) * 0.9,
      },
      angle,
      side: 'r',
      leaves: leafCount(data),
      clearance: 3,
      number: String(depth === 1 ? catIndex + 1 : index + 1).padStart(2, '0'),
    };
    const ax = node.pos.x / (Math.hypot(node.pos.x, node.pos.y) || 1);
    node.side = ax > 0.28 ? 'r' : ax < -0.28 ? 'l' : index % 2 === 0 ? 'r' : 'l';
    parent.children.push(node);
    nodes.push(node);
    byId.set(id, node);

    const kids = data.children ?? [];
    if (kids.length) {
      const weights = kids.map((k) => Math.pow(leafCount(k), 0.75));
      const total = weights.reduce((a, b) => a + b, 0);
      let cursor = a0;
      kids.forEach((k, i) => {
        const w = (weights[i] / total) * (a1 - a0);
        place(k, node, depth + 1, cursor, cursor + w, i, cat, catIndex, null);
        cursor += w;
      });
    }
    return node;
  };

  categories.forEach((cat, i) => {
    const axis = cat.angle !== undefined ? (cat.angle * Math.PI) / 180 : Math.PI / 2 - i * wedge;
    place(cat, root, 1, axis - half, axis + half, i, cat, i, axis);
  });

  // clearance = distance to the nearest sibling (or neighbouring primary)
  for (const n of nodes) {
    if (!n.parent) continue;
    let best = Infinity;
    for (const s of n.parent.children) {
      if (s === n) continue;
      best = Math.min(best, Math.hypot(s.pos.x - n.pos.x, s.pos.y - n.pos.y));
    }
    n.clearance = Number.isFinite(best) ? best : 4;
  }

  return { root, nodes, byId, primaries: root.children };
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
