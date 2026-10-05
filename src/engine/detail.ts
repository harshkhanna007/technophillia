import type { StyleId } from './types';
import { Rng } from './rng';
import type { P, Trunk } from './trunk';

/** shape ids understood by the parts shader */
export const SHAPE = { DOT: 0, RING: 1, LED: 2, CHIP: 3, DIAMOND: 4, HEX: 5, VIA: 6, TRI: 7, CROSS: 8, TARGET: 9 } as const;

export interface LineSpec {
  pts: P[];
  z: number;
  t0: number;
  t1: number;
  w: number;
  b: number;
  seed: number;
}

export interface PartSpec {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  rot: number;
  shape: number;
  t: number;
  b: number;
  mix: number;
  seed: number;
}

export interface DetailOut {
  lines: LineSpec[];
  parts: PartSpec[];
}

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Helper that knows the trunk geometry – all detail is placed relative to it. */
class Ctx {
  lines: LineSpec[] = [];
  parts: PartSpec[] = [];
  L: number;
  constructor(
    public trunk: Trunk,
    public rng: Rng,
    public reach: number,
    public density: number,
  ) {
    this.L = trunk.len;
  }

  /** scaled integer count (never below 1 if base>0) */
  n(base: number): number {
    return base > 0 ? Math.max(1, Math.round(base * this.density)) : 0;
  }

  /** offset curve that follows the trunk between s0..s1 and grows with the energy front */
  offsetLine(s0: number, s1: number, off: (s: number) => number, w: number, b: number, lag = 0.008) {
    const pts: P[] = [];
    const step = 0.11;
    const n = Math.max(2, Math.ceil((s1 - s0) / step));
    let z = 0;
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      const f = this.trunk.at(s);
      const o = off(s);
      pts.push({ x: f.x + f.nx * o, y: f.y + f.ny * o });
      z = f.z;
    }
    this.lines.push({ pts, z, t0: s0 / this.L + lag, t1: s1 / this.L + lag, w, b, seed: this.rng.next() });
  }

  /** free polyline sprouting at trunk position s; grows quickly after the front passes */
  sprout(pts: P[], s: number, w: number, b: number, speed = 0.9, delay = 0.012): number {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const t0 = s / this.L + delay;
    const t1 = t0 + Math.min(0.14, (len / this.L) * speed);
    this.lines.push({ pts, z: this.trunk.at(s).z, t0, t1, w, b, seed: this.rng.next() });
    return t1;
  }

  part(x: number, y: number, z: number, shape: number, size: number, t: number, b = 0.9, mix = 0, sy?: number, rot = 0) {
    this.parts.push({ x, y, z, sx: size, sy: sy ?? size, rot, shape, t, b, mix, seed: this.rng.next() });
  }

  partOn(s: number, off: number, shape: number, size: number, b = 0.9, mix = 0, sy?: number, rot = 0, lag = 0.014) {
    const f = this.trunk.at(s);
    this.part(f.x + f.nx * off, f.y + f.ny * off, f.z, shape, size, s / this.L + lag, b, mix, sy, rot);
  }

  /** LEDs and tiny vias along the spine – shared by every style */
  baseline() {
    const { L, rng } = this;
    const leds = this.n(L / 1.25);
    for (let i = 0; i < leds; i++) {
      const s = L * (0.1 + 0.88 * ((i + rng.range(0.1, 0.9)) / leds));
      this.partOn(s, 0, rng.chance(0.55) ? SHAPE.LED : SHAPE.DOT, rng.range(0.03, 0.045), 0.95, rng.chance(0.4) ? 1 : 0);
    }
  }
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number, n: number): P[] {
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return out;
}

function bezier(p0: P, p1: P, p2: P, n: number): P[] {
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const a = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const c = u * u;
    out.push({ x: a * p0.x + b * p1.x + c * p2.x, y: a * p0.y + b * p1.y + c * p2.y });
  }
  return out;
}

const env = (s: number, L: number) => Math.min(1, s / (L * 0.12)) * Math.min(1, (L - s) / (L * 0.06) + 0.05);

/* ───────────────────────── NEURAL ───────────────────────── */
function neural(c: Ctx) {
  const { L, rng, reach } = c;
  // braided strands
  const strands = c.n(3);
  for (let k = 0; k < strands; k++) {
    const amp = rng.range(0.1, 0.24) * clamp(reach / 0.8, 0.45, 1.2);
    const lam = rng.range(1.3, 2.7);
    const ph = rng.next() * TAU;
    const s0 = L * rng.range(0.06, 0.22);
    const s1 = L * rng.range(0.86, 0.99);
    c.offsetLine(s0, s1, (s) => amp * Math.sin((TAU * s) / lam + ph) * env(s, L), 0.015, 0.6);
    // synapse nodes where the strand crosses the spine
    const k0 = Math.ceil(((TAU * s0) / lam + ph) / Math.PI);
    for (let k = k0; k < k0 + 40; k++) {
      const s = ((k * Math.PI - ph) * lam) / TAU;
      if (s > s1 - 0.2) break;
      if (s > s0 + 0.2 && rng.chance(0.55)) c.partOn(s, 0, SHAPE.DOT, 0.03, 0.9, 1);
    }
  }
  // dendrite trees
  const dendrites = c.n(L * 1.5);
  const maxDepth = c.density > 0.7 ? 2 : 1;
  const grow = (x: number, y: number, ang: number, len: number, depth: number, s: number, tStart: number) => {
    const end = { x: x + Math.cos(ang) * len, y: y + Math.sin(ang) * len };
    const bend = rng.range(-0.38, 0.38) * len;
    const ctrl = { x: (x + end.x) / 2 - Math.sin(ang) * bend, y: (y + end.y) / 2 + Math.cos(ang) * bend };
    const pts = bezier({ x, y }, ctrl, end, 9);
    const z = c.trunk.at(s).z;
    const t1 = tStart + Math.min(0.1, (len / c.L) * 0.9);
    c.lines.push({ pts, z, t0: tStart, t1, w: 0.013 * (1 - depth * 0.15), b: 0.55, seed: rng.next() });
    if (depth < maxDepth && len > 0.25) {
      const kids = rng.chance(0.5) ? 2 : 3;
      if (depth === 0) c.part(end.x, end.y, z, SHAPE.TARGET, 0.06, t1, 0.9, 0.5);
      for (let i = 0; i < kids; i++) {
        grow(end.x, end.y, ang + (i - (kids - 1) / 2) * rng.range(0.5, 0.85), len * rng.range(0.5, 0.72), depth + 1, s, t1);
      }
    } else {
      c.part(end.x, end.y, z, SHAPE.DOT, rng.range(0.028, 0.045), t1, 0.95, rng.chance(0.4) ? 1 : 0.3);
    }
  };
  for (let i = 0; i < dendrites; i++) {
    const s = L * rng.range(0.2, 0.97);
    const f = c.trunk.at(s);
    const sd = rng.sign();
    const ang = Math.atan2(f.ty, f.tx) + sd * rng.range(0.5, 1.15);
    const len = clamp(rng.range(0.4, 1.0) * reach * 1.25, 0.22, 1.1);
    grow(f.x + f.nx * sd * 0.02, f.y + f.ny * sd * 0.02, ang, len, 0, s, s / L + 0.012);
  }
}

/* ───────────────────────── MECHANICAL ───────────────────────── */
function mechanical(c: Ctx) {
  const { L, rng, reach } = c;
  // parallel data buses
  const buses = c.n(2);
  for (let b = 0; b < buses; b++) {
    const lanes = rng.int(3, 5);
    const sd = rng.sign() * (b % 2 === 0 ? 1 : -1);
    const centre = sd * rng.range(0.26, Math.max(0.3, Math.min(0.55, reach * 0.75)));
    const s0 = L * rng.range(0.12, 0.35);
    const s1 = L * rng.range(0.62, 0.97);
    for (let l = 0; l < lanes; l++) {
      const off = centre + (l - (lanes - 1) / 2) * 0.072;
      const a = s0 + l * 0.06;
      const e = s1 - l * 0.045;
      c.offsetLine(a, e, () => off, 0.011, 0.55);
      c.partOn(a, off, SHAPE.VIA, 0.022, 0.8, 0.2);
      c.partOn(e, off, SHAPE.VIA, 0.022, 0.8, 0.2);
    }
  }
  // right-angle stubs
  const stubs = c.n(L * 1.2);
  for (let i = 0; i < stubs; i++) {
    const s = L * rng.range(0.14, 0.97);
    const f = c.trunk.at(s);
    const sd = rng.sign();
    const len = clamp(rng.range(0.3, 1.0) * reach, 0.2, 1.1);
    const p0 = { x: f.x, y: f.y };
    const p1 = { x: f.x + f.nx * sd * len * 0.62, y: f.y + f.ny * sd * len * 0.62 };
    const dirT = rng.sign();
    const p2 = { x: p1.x + f.tx * dirT * len * 0.4, y: p1.y + f.ty * dirT * len * 0.4 };
    const t1 = c.sprout([p0, p1, p2], s, 0.013, 0.6, 1.4);
    c.part(p2.x, p2.y, f.z, len > 0.7 ? SHAPE.HEX : SHAPE.VIA, len > 0.7 ? 0.05 : 0.032, t1, 0.9, 0.2);
  }
  // chips with bonded pins
  const chips = c.n(L / 2.2);
  for (let i = 0; i < chips; i++) {
    const s = L * ((i + rng.range(0.25, 0.8)) / chips) * 0.9 + L * 0.08;
    const f = c.trunk.at(s);
    const sd = i % 2 === 0 ? 1 : -1;
    const hw = rng.range(0.15, 0.24);
    const hh = hw * rng.range(0.55, 0.8);
    const off = sd * (Math.min(reach, 0.9) * 0.55 + hh + 0.12);
    const cx = f.x + f.nx * off;
    const cy = f.y + f.ny * off;
    const rot = Math.atan2(f.ty, f.tx);
    c.part(cx, cy, f.z, SHAPE.CHIP, hw, s / L + 0.02, 0.95, rng.range(0, 0.5), hh, rot);
    for (let p = -1; p <= 1; p++) {
      const sp = s + p * hw * 0.55;
      const g = c.trunk.at(sp);
      c.sprout(
        [
          { x: g.x, y: g.y },
          { x: cx + f.tx * p * hw * 0.55 - f.nx * sd * hh * 0.9, y: cy + f.ty * p * hw * 0.55 - f.ny * sd * hh * 0.9 },
        ],
        sp,
        0.01,
        0.6,
        2.2,
        0.015,
      );
    }
  }
  // corner vias – detect trunk bends
  for (let s = 0.4; s < L - 0.4; s += 0.2) {
    const a = c.trunk.at(s - 0.22);
    const b = c.trunk.at(s + 0.22);
    const da = Math.atan2(a.ty, a.tx);
    const db = Math.atan2(b.ty, b.tx);
    let d = Math.abs(db - da);
    if (d > Math.PI) d = TAU - d;
    if (d > 0.5) {
      const f = c.trunk.at(s);
      c.part(f.x, f.y, f.z, SHAPE.HEX, 0.05, s / L + 0.012, 0.95, 0.6);
      s += 0.5;
    }
  }
}

/* ───────────────────────── ORGANIC ───────────────────────── */
function organic(c: Ctx) {
  const { L, rng, reach } = c;
  // two lazy, flowing strands
  for (let k = 0; k < c.n(2); k++) {
    const amp = rng.range(0.14, 0.28) * clamp(reach / 0.8, 0.5, 1.2);
    const lam = rng.range(1.9, 3.1);
    const ph = rng.next() * TAU;
    c.offsetLine(L * 0.05, L * rng.range(0.85, 0.99), (s) => amp * Math.sin((TAU * s) / lam + ph) * env(s, L), 0.017, 0.55);
  }
  // spiralling tendrils
  const tendrils = c.n(L * 1.1);
  for (let i = 0; i < tendrils; i++) {
    const s = L * rng.range(0.16, 0.96);
    const f = c.trunk.at(s);
    const sd = i % 2 === 0 ? 1 : -1;
    let h = Math.atan2(f.ty, f.tx) + sd * rng.range(0.7, 1.2);
    const len = clamp(rng.range(0.55, 1.1) * reach * 1.15, 0.28, 1.2);
    const n = 16;
    const kappa = rng.range(1.4, 2.8) * -sd;
    let x = f.x;
    let y = f.y;
    const pts: P[] = [{ x, y }];
    for (let j = 1; j <= n; j++) {
      const u = j / n;
      h += (kappa * (0.3 + 2.4 * u * u) * len) / n;
      x += (Math.cos(h) * len) / n;
      y += (Math.sin(h) * len) / n;
      pts.push({ x, y });
    }
    const t1 = c.sprout(pts, s, 0.014, 0.6, 1.1);
    c.part(x, y, f.z, SHAPE.DOT, rng.range(0.04, 0.06), t1, 0.95, 0.5);
  }
  // leaves (outline + midrib)
  const leaves = c.n(L / 1.3);
  for (let i = 0; i < leaves; i++) {
    const s = L * ((i + rng.range(0.2, 0.8)) / leaves) * 0.88 + L * 0.1;
    const f = c.trunk.at(s);
    const sd = rng.sign();
    const ang = Math.atan2(f.ty, f.tx) + sd * rng.range(0.6, 0.95);
    const ll = clamp(rng.range(0.5, 0.95) * reach, 0.25, 0.9);
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const tip = { x: f.x + dx * ll, y: f.y + dy * ll };
    const bulge = ll * 0.28;
    const mid = { x: f.x + dx * ll * 0.5, y: f.y + dy * ll * 0.5 };
    const left = bezier({ x: f.x, y: f.y }, { x: mid.x - dy * bulge, y: mid.y + dx * bulge }, tip, 8);
    const right = bezier({ x: f.x, y: f.y }, { x: mid.x + dy * bulge, y: mid.y - dx * bulge }, tip, 8);
    c.sprout(left, s, 0.011, 0.5, 0.7);
    c.sprout(right, s, 0.011, 0.5, 0.7);
    const t1 = c.sprout([{ x: f.x, y: f.y }, tip], s, 0.009, 0.4, 0.7);
    c.part(tip.x, tip.y, f.z, SHAPE.DOT, 0.03, t1, 0.85, 0.7);
  }
}

/* ───────────────────────── CHAOTIC ───────────────────────── */
function chaotic(c: Ctx) {
  const { L, rng, reach } = c;
  const spurs = c.n(L * 1.55);
  for (let i = 0; i < spurs; i++) {
    const s = L * rng.range(0.14, 0.98);
    const f = c.trunk.at(s);
    const sd = rng.sign();
    let ang = Math.atan2(f.ty, f.tx) + sd * rng.range(0.5, 1.4);
    let x = f.x;
    let y = f.y;
    const segs = rng.int(2, 4);
    const pts: P[] = [{ x, y }];
    const unit = clamp(reach * rng.range(0.22, 0.42), 0.1, 0.42);
    for (let j = 0; j < segs; j++) {
      const l = unit * rng.range(0.7, 1.3);
      x += Math.cos(ang) * l;
      y += Math.sin(ang) * l;
      pts.push({ x, y });
      ang += rng.sign() * rng.range(0.55, 1.3);
    }
    const t1 = c.sprout(pts, s, 0.014, 0.65, 1.6);
    const kind = rng.next();
    c.part(x, y, f.z, kind < 0.45 ? SHAPE.TRI : kind < 0.8 ? SHAPE.DIAMOND : SHAPE.CROSS, rng.range(0.04, 0.07), t1, 0.95, rng.chance(0.5) ? 1 : 0.4, undefined, rng.range(0, TAU));
    if (rng.chance(0.4) && pts.length > 2) {
      // fork
      const m = pts[1];
      const a2 = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) + rng.sign() * rng.range(0.7, 1.2);
      const e = { x: m.x + Math.cos(a2) * unit * 0.9, y: m.y + Math.sin(a2) * unit * 0.9 };
      c.sprout([m, e], s, 0.011, 0.55, 1.6);
      c.part(e.x, e.y, f.z, SHAPE.DOT, 0.03, t1, 0.9, 1);
    }
  }
  // broken, dashed parallels
  for (let k = 0; k < c.n(2); k++) {
    const sd = rng.sign();
    const off = sd * rng.range(0.14, Math.max(0.16, Math.min(0.4, reach * 0.55)));
    let s = L * rng.range(0.08, 0.25);
    while (s < L * 0.96) {
      const run = rng.range(0.35, 1.0);
      const e = Math.min(L * 0.98, s + run);
      c.offsetLine(s, e, () => off, 0.011, 0.6);
      s = e + rng.range(0.12, 0.35);
    }
  }
  // glitch blocks
  for (let i = 0; i < c.n(L * 0.7); i++) {
    c.partOn(L * rng.range(0.15, 0.97), rng.sign() * rng.range(0.08, Math.max(0.1, reach * 0.5)), SHAPE.VIA, rng.range(0.025, 0.05), 0.85, 1, undefined, rng.range(0, TAU));
  }
}

/* ───────────────────────── NETWORK ───────────────────────── */
function network(c: Ctx) {
  const { L, rng, reach } = c;
  const gap = clamp(L / 7, 0.65, 0.95);
  const count = Math.max(3, Math.floor((L * 0.9) / gap));
  const sats: { x: number; y: number; z: number; s: number }[][] = [[], []];
  for (let k = 0; k < count; k++) {
    const s = L * 0.12 + (k / (count - 1)) * L * 0.86 + rng.range(-0.08, 0.08);
    const f = c.trunk.at(clamp(s, 0.1, L));
    for (let sd = 0; sd < 2; sd++) {
      const side = sd === 0 ? 1 : -1;
      const off = rng.range(0.4, 1.0) * reach * 0.85 + 0.12;
      sats[sd].push({ x: f.x + f.nx * side * off, y: f.y + f.ny * side * off, z: f.z, s });
    }
    c.partOn(s, 0, SHAPE.DOT, 0.04, 0.95, 0.6);
  }
  const link = (a: { x: number; y: number; s: number }, b: { x: number; y: number; s: number }, w = 0.012, bright = 0.55) => {
    c.sprout([{ x: a.x, y: a.y }, { x: b.x, y: b.y }], Math.max(a.s, b.s) - 0.02, w, bright, 2.2, 0);
  };
  for (let k = 0; k < count; k++) {
    for (let sd = 0; sd < 2; sd++) {
      const st = sats[sd][k];
      const f = c.trunk.at(st.s);
      link({ x: f.x, y: f.y, s: st.s }, st, 0.012, 0.6);
      c.part(st.x, st.y, st.z, SHAPE.HEX, rng.range(0.045, 0.07), st.s / L + 0.03, 0.95, sd === 0 ? 0.2 : 0.8);
      if (k < count - 1) {
        link(st, sats[sd][k + 1]);
        if (rng.chance(0.55)) link(st, sats[1 - sd][k + 1], 0.01, 0.45);
      }
      if (k < count - 2 && rng.chance(0.35)) link(st, sats[sd][k + 2], 0.009, 0.4);
    }
  }
}

/* ───────────────────────── QUANTUM ───────────────────────── */
function quantum(c: Ctx) {
  const { L, rng, reach } = c;
  const amp = clamp(reach * 0.42, 0.12, 0.28);
  const lam = rng.range(1.35, 1.8);
  const s0 = L * 0.1;
  const s1 = L * 0.97;
  const fade = (s: number) => clamp((s - s0) / 0.6, 0, 1) * clamp((s1 - s) / 0.4, 0, 1);
  c.offsetLine(s0, s1, (s) => amp * Math.sin((TAU * s) / lam) * fade(s), 0.017, 0.75);
  c.offsetLine(s0, s1, (s) => -amp * Math.sin((TAU * s) / lam) * fade(s), 0.017, 0.75);
  let i = 0;
  for (let s = s0 + lam * 0.5; s < s1 - 0.15; s += lam * 0.5, i++) {
    c.partOn(s, 0, i % 2 === 0 ? SHAPE.TARGET : SHAPE.DOT, i % 2 === 0 ? 0.06 : 0.035, 0.95, i % 2 === 0 ? 1 : 0.2);
  }
  // orbital rings crossing the spine
  const rings = c.n(3);
  for (let k = 0; k < rings; k++) {
    const s = L * ((k + rng.range(0.3, 0.8)) / rings) * 0.85 + L * 0.12;
    const f = c.trunk.at(s);
    const sd = rng.sign();
    const r = clamp(rng.range(0.4, 0.8) * reach, 0.2, 0.85);
    const cx = f.x + f.nx * sd * r * 0.4;
    const cy = f.y + f.ny * sd * r * 0.4;
    const a0 = rng.next() * TAU;
    const sweep = rng.range(3.4, 5.6);
    const pts = arc(cx, cy, r, a0, a0 + sweep, 36);
    c.sprout(pts, s, 0.012, 0.55, 1.0);
    const ea = a0 + sweep;
    c.part(cx + Math.cos(ea) * r, cy + Math.sin(ea) * r, f.z, SHAPE.DOT, 0.036, s / L + 0.06, 1, 1);
    c.part(cx, cy, f.z, SHAPE.RING, 0.06, s / L + 0.02, 0.8, 0.5);
  }
}

const BUILDERS: Record<StyleId, (c: Ctx) => void> = { neural, mechanical, organic, chaotic, network, quantum };

export function buildDetail(style: StyleId, trunk: Trunk, rng: Rng, reach: number, density: number): DetailOut {
  const c = new Ctx(trunk, rng, reach, density);
  BUILDERS[style](c);
  c.baseline();
  return { lines: c.lines, parts: c.parts };
}
