import type { P } from './trunk';

/**
 * A spatial hash of every strand already standing, so new twigs and leaves can steer clear of
 * what is there instead of drawing straight through it.
 */
export class Occupancy {
  private cells = new Map<number, number[]>();
  private xs: number[] = [];
  private ys: number[] = [];
  private who: number[] = [];
  private ids = new Map<string, number>();

  /** `cell` must be at least as large as the biggest search radius used with `distance` */
  constructor(private cell = 0.4) {}

  private key(ix: number, iy: number) {
    return (ix + 4096) * 8192 + (iy + 4096);
  }

  add(owner: string, pts: P[]) {
    let id = this.ids.get(owner);
    if (id === undefined) {
      id = this.ids.size;
      this.ids.set(owner, id);
    }
    for (const p of pts) {
      const i = this.xs.length;
      this.xs.push(p.x);
      this.ys.push(p.y);
      this.who.push(id);
      const k = this.key(Math.floor(p.x / this.cell), Math.floor(p.y / this.cell));
      const bucket = this.cells.get(k);
      if (bucket) bucket.push(i);
      else this.cells.set(k, [i]);
    }
  }

  /** distance to the nearest strand point of any owner but `ignore`, or Infinity if none lies within r */
  distance(x: number, y: number, r: number, ignore?: string): number {
    const skip = ignore === undefined ? -1 : (this.ids.get(ignore) ?? -1);
    const span = Math.ceil(r / this.cell);
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    let best = r * r;
    let found = false;
    for (let ix = cx - span; ix <= cx + span; ix++) {
      for (let iy = cy - span; iy <= cy + span; iy++) {
        const bucket = this.cells.get(this.key(ix, iy));
        if (!bucket) continue;
        for (const i of bucket) {
          if (this.who[i] === skip) continue;
          const dx = this.xs[i] - x;
          const dy = this.ys[i] - y;
          const d = dx * dx + dy * dy;
          if (d < best) {
            best = d;
            found = true;
          }
        }
      }
    }
    return found ? Math.sqrt(best) : Infinity;
  }

  /**
   * Would this polyline come within `gap` of anything standing? The stretch within `free` of `from` is
   * exempt: that is where the branch leaves its parent and must be allowed to touch it.
   */
  clashes(pts: P[], owner: string, gap: number, from?: P, free = 0): boolean {
    const f2 = free * free;
    for (let i = 0; i < pts.length; i += 2) {
      const p = pts[i];
      if (from && (p.x - from.x) ** 2 + (p.y - from.y) ** 2 < f2) continue;
      if (this.distance(p.x, p.y, gap, owner) < gap) return true;
    }
    return false;
  }
}
