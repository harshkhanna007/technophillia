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

/** what a node's reveal card says (the copy lives in data/facts.ts) */
export interface NodeFact {
  stat: { value: string; label: string };
  why: string;
  next: string;
}

/** the reveal card the HUD shows for the active node */
export interface RevealState {
  /** bumps on every arrival so the card replays, even on the same node */
  seq: number;
  id: string;
  title: string;
  /** node colours as CSS hex: the line and glow colour, the hot highlight, the cool end */
  colors: { a: string; accent: string; b: string };
  /** the side of the screen the card sits on (the label takes the other) */
  side: 'l' | 'r';
  fact: NodeFact;
  /** how many nodes of this branch have been opened, and how many it has */
  opened: number;
  total: number;
  /** seconds before the card slides in: the node's own moment has to finish first */
  delay: number;
  /** the node the card sends you to next, with the line that makes you want to go: a curiosity hook */
  hook: { id: string; title: string; teaser: string } | null;
}

/** a branch (or the whole tree) has just been completed */
export interface FinaleState {
  seq: number;
  kind: 'branch' | 'tree';
  title: string;
  sub: string;
  colors: { a: string; accent: string; b: string };
}
