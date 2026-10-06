import type { TreeNode } from './types';
import { Rng } from './rng';

export interface P {
  x: number;
  y: number;
}

export interface Frame {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  nx: number;
  ny: number;
}

const TAU = Math.PI * 2;
const norm = (x: number, y: number): P => {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
};

/** Dense polyline with arc-length lookup – the spine every branch is built around. */
export class Trunk {
  pts: P[];
  cum: number[];
  z: number[];
  len: number;
  endHeading: P;
  startHeading: P;

  constructor(pts: P[], z0: number, z1: number) {
    this.pts = pts;
    this.cum = new Array(pts.length);
    this.cum[0] = 0;
    for (let i = 1; i < pts.length; i++) {
      this.cum[i] = this.cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    this.len = this.cum[pts.length - 1];
    this.z = pts.map((_, i) => {
      const u = this.len ? this.cum[i] / this.len : 0;
      const e = u * u * (3 - 2 * u);
      return z0 + (z1 - z0) * e;
    });
    const n = pts.length;
    const k = Math.min(4, n - 1);
    this.endHeading = norm(pts[n - 1].x - pts[n - 1 - k].x, pts[n - 1].y - pts[n - 1 - k].y);
    this.startHeading = norm(pts[k].x - pts[0].x, pts[k].y - pts[0].y);
  }

  at(s: number): Frame {
    const L = this.len;
    s = Math.max(0, Math.min(L, s));
    const c = this.cum;
    let lo = 0;
    let hi = c.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid] <= s) lo = mid;
      else hi = mid;
    }
    const a = this.pts[lo];
    const b = this.pts[hi];
    const seg = c[hi] - c[lo] || 1;
    const f = (s - c[lo]) / seg;
    // tangent: blend the neighbouring segments for smoothness
    const i0 = Math.max(0, lo - 1);
    const i1 = Math.min(this.pts.length - 1, hi + 1);
    const t = norm(this.pts[i1].x - this.pts[i0].x, this.pts[i1].y - this.pts[i0].y);
    return {
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      z: this.z[lo] + (this.z[hi] - this.z[lo]) * f,
      tx: t.x,
      ty: t.y,
      nx: -t.y,
      ny: t.x,
    };
  }

  atT(t: number): Frame {
    return this.at(t * this.len);
  }
}

function resample(poly: P[], step: number): P[] {
  const cum = [0];
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y));
  const total = cum[cum.length - 1];
  const n = Math.max(2, Math.ceil(total / step));
  const out: P[] = [];
  let j = 0;
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * total;
    while (j < poly.length - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const f = Math.min(1, Math.max(0, (s - cum[j]) / seg));
    out.push({ x: poly[j].x + (poly[j + 1].x - poly[j].x) * f, y: poly[j].y + (poly[j + 1].y - poly[j].y) * f });
  }
  return out;
}

function hermite(A: P, B: P, h0: P, h1: P, k0: number, k1: number, n: number): P[] {
  const D = Math.hypot(B.x - A.x, B.y - A.y);
  const m0 = { x: h0.x * D * k0, y: h0.y * D * k0 };
  const m1 = { x: h1.x * D * k1, y: h1.y * D * k1 };
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const u2 = u * u;
    const u3 = u2 * u;
    const a = 2 * u3 - 3 * u2 + 1;
    const b = u3 - 2 * u2 + u;
    const c = -2 * u3 + 3 * u2;
    const d = u3 - u2;
    out.push({
      x: a * A.x + b * m0.x + c * B.x + d * m1.x,
      y: a * A.y + b * m0.y + c * B.y + d * m1.y,
    });
  }
  return out;
}

function meander(poly: P[], amp: number, freq: number, phase: number): P[] {
  const n = poly.length;
  return poly.map((p, i) => {
    const u = i / (n - 1);
    const a = poly[Math.max(0, i - 1)];
    const b = poly[Math.min(n - 1, i + 1)];
    const t = norm(b.x - a.x, b.y - a.y);
    const env = Math.pow(Math.sin(Math.PI * u), 0.9);
    const o = amp * Math.sin(TAU * freq * u + phase) * env;
    return { x: p.x - t.y * o, y: p.y + t.x * o };
  });
}

/** PCB-style routing: two compass directions (45° apart) plus an occasional dog-leg jog. */
function manhattan(A: P, B: P, rng: Rng): P[] {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const a = Math.atan2(dy, dx);
  const q = Math.PI / 4;
  const k = Math.floor(a / q);
  const u1 = { x: Math.cos(k * q), y: Math.sin(k * q) };
  const u2 = { x: Math.cos((k + 1) * q), y: Math.sin((k + 1) * q) };
  // solve d = c1*u1 + c2*u2
  const det = u1.x * u2.y - u1.y * u2.x;
  let c1 = (dx * u2.y - dy * u2.x) / det;
  let c2 = (u1.x * dy - u1.y * dx) / det;
  c1 = Math.max(0, c1);
  c2 = Math.max(0, c2);
  const D = Math.hypot(dx, dy);
  const pts: P[] = [A];
  let cx = A.x;
  let cy = A.y;
  const go = (u: P, s: number) => {
    if (s < 1e-4) return;
    cx += u.x * s;
    cy += u.y * s;
    pts.push({ x: cx, y: cy });
  };
  const major = c1 >= c2 ? u1 : u2;
  const minor = c1 >= c2 ? u2 : u1;
  const cMajor = Math.max(c1, c2);
  const cMinor = Math.min(c1, c2);
  if (cMinor < 0.22 * D) {
    // near-straight: add a jog so the trace still reads as engineered
    const sgn = rng.sign();
    const jogLen = Math.min(rng.range(0.55, 1.0), cMajor * 0.2);
    const ang = Math.atan2(major.y, major.x) + sgn * q;
    const uj = { x: Math.cos(ang), y: Math.sin(ang) };
    const ub = { x: Math.cos(ang - sgn * 2 * q), y: Math.sin(ang - sgn * 2 * q) };
    const f = rng.range(0.3, 0.5);
    go(major, cMajor * f);
    go(uj, jogLen);
    go(ub, jogLen);
    const used = cMajor * f + Math.SQRT2 * jogLen;
    go(major, Math.max(0, cMajor - used));
    go(minor, cMinor);
    pts[pts.length - 1] = { x: B.x, y: B.y };
    return chamfer(pts, 0.18);
  }
  go(major, cMajor * 0.55);
  go(minor, cMinor);
  go(major, cMajor * 0.45);
  pts[pts.length - 1] = { x: B.x, y: B.y };
  return chamfer(pts, 0.2);
}

function chamfer(poly: P[], size: number): P[] {
  if (poly.length < 3) return poly;
  const out: P[] = [poly[0]];
  for (let i = 1; i < poly.length - 1; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    const c = poly[i + 1];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y);
    const l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const s = Math.min(size, l1 * 0.4, l2 * 0.4);
    out.push({ x: b.x + ((a.x - b.x) / l1) * s, y: b.y + ((a.y - b.y) / l1) * s });
    out.push({ x: b.x + ((c.x - b.x) / l2) * s, y: b.y + ((c.y - b.y) / l2) * s });
  }
  out.push(poly[poly.length - 1]);
  return out;
}

function jagged(A: P, B: P, rng: Rng, lat: number): P[] {
  const d = norm(B.x - A.x, B.y - A.y);
  const n = { x: -d.y, y: d.x };
  const D = Math.hypot(B.x - A.x, B.y - A.y);
  const m = rng.int(4, 7);
  const us: number[] = [];
  for (let i = 1; i < m; i++) us.push((i + rng.range(-0.3, 0.3)) / m);
  const pts: P[] = [A];
  let side = rng.sign();
  for (const u of us) {
    const o = side * rng.range(0.35, 1) * lat * Math.sin(Math.PI * u) * 1.25;
    pts.push({ x: A.x + d.x * D * u + n.x * o, y: A.y + d.y * D * u + n.y * o });
    side = -side;
  }
  pts.push(B);
  return pts;
}

export function generateTrunk(node: TreeNode, A: P, zA: number, startHeading: P, rng: Rng): Trunk {
  const B = { x: node.pos.x, y: node.pos.y };
  const d = norm(B.x - A.x, B.y - A.y);
  const D = Math.hypot(B.x - A.x, B.y - A.y);
  const radial = norm(Math.cos(node.angle), Math.sin(node.angle));
  const endDir = norm(d.x * 0.55 + radial.x * 0.45, d.y * 0.55 + radial.y * 0.45);
  const lat = Math.min(0.75, node.clearance * 0.13, D * 0.14);
  const step = 0.075;
  const n = Math.max(24, Math.ceil(D / step));
  let poly: P[];

  if (node.depth === 1) {
    // a bough leaves the trunk steeply and bends outward in one clean arc, whatever its style
    const out = norm(Math.cos(node.angle), Math.sin(node.angle));
    poly = meander(hermite(A, B, startHeading, out, 1.3, 0.95, n), lat * 0.2, 1.2, rng.next() * TAU);
    return new Trunk(resample(poly, step), zA, node.pos.z);
  }

  switch (node.style) {
    case 'mechanical':
      poly = node.depth === 1 ? meander(hermite(A, B, startHeading, endDir, 1.0, 1.0, n), lat * 0.2, 1.1, rng.next() * TAU) : manhattan(A, B, rng);
      break;
    case 'chaotic':
      poly = jagged(A, B, rng, lat);
      break;
    case 'organic':
      poly = meander(hermite(A, B, startHeading, endDir, 1.2, 1.2, n), lat * 1.15, 1.7, rng.next() * TAU);
      break;
    case 'neural':
      poly = meander(hermite(A, B, startHeading, endDir, 1.05, 1.05, n), lat * 0.5, 1.3, rng.next() * TAU);
      break;
    case 'quantum':
      poly = meander(hermite(A, B, startHeading, endDir, 1.0, 1.0, n), lat * 0.35, 2.0, rng.next() * TAU);
      break;
    default:
      poly = meander(hermite(A, B, startHeading, endDir, 0.9, 0.9, n), lat * 0.25, 1.1, rng.next() * TAU);
  }
  return new Trunk(resample(poly, step), zA, node.pos.z);
}
