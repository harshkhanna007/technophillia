import type { Color } from 'three';

/** Procedural personality of a branch. Add a new one by extending `detail.ts` + `trunk.ts`. */
export type StyleId = 'neural' | 'mechanical' | 'organic' | 'chaotic' | 'network' | 'quantum';

export interface Palette {
  /** root-side colour of the traces */
  a: string;
  /** tip-side colour of the traces */
  b: string;
  /** accent used for hot energy, LEDs, terminals */
  accent: string;
}

export interface NodeData {
  /** optional – derived from the title path when omitted */
  id?: string;
  title: string;
  description?: string;
  children?: NodeData[];
}

export interface CategoryData extends NodeData {
  style: StyleId;
  palette: Palette;
}

export interface ExperienceMeta {
  wordmark: string;
  /** shown while the seed waits to be clicked */
  seedHint: string;
  /** shown once the tree has grown, before the first branch is opened */
  hint: string;
}

export interface RuntimePalette {
  a: Color;
  b: Color;
  accent: Color;
}

export interface TreeNode {
  id: string;
  title: string;
  description: string;
  depth: number; // root = 0, primary = 1 …
  index: number; // sibling index
  catIndex: number;
  parent: TreeNode | null;
  children: TreeNode[];
  style: StyleId;
  palette: RuntimePalette;
  pos: { x: number; y: number; z: number };
  angle: number; // outward heading (radians) used to shape the branch that reaches this node
  side: 'l' | 'r';
  leaves: number;
  /** distance to the closest sibling – used to keep procedural detail inside its own territory */
  clearance: number;
  number: string;
  /** primaries only: where on the stem this branch leaves (position, outward heading, arc-length fraction) */
  origin?: { x: number; y: number; hx: number; hy: number; t: number };
}
