/**
 * The cursor is a point of light. A hot dot tracks the pointer exactly; a hairline ring follows with a
 * critically-damped spring, stretches along the direction of travel, and magnetically locks onto
 * nodes (swelling and showing an orbiting arc, echoing the node markers). Only transform / opacity
 * are animated. It does not exist on touch devices (they get a tap ripple + finger trail in the scene).
 */
export interface PointerState {
  x: number;
  y: number;
  vx: number; // px per second
  vy: number;
  speed: number;
  type: string;
  down: boolean;
  seen: boolean;
  inside: boolean;
}

export interface CursorTarget {
  x: number;
  y: number;
  kind: 'node' | 'ui';
}

export class Cursor {
  readonly enabled: boolean;
  private el: HTMLDivElement | null = null;
  private ring: HTMLElement | null = null;
  private dot: HTMLElement | null = null;
  private rx = 0;
  private ry = 0;
  private rs = 1;
  private ra = 0;
  private rStretch = 0;
  private shown = false;
  private color = '';
  private primed = false;

  constructor(private reduced: boolean) {
    this.enabled = typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (!this.enabled) return;
    const el = document.createElement('div');
    el.className = 'cursor';
    el.dataset.on = '0';
    el.dataset.hot = '0';
    el.dataset.press = '0';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<i class="cursor__ring"></i><b class="cursor__dot"></b>';
    document.body.appendChild(el);
    this.el = el;
    this.ring = el.querySelector('.cursor__ring');
    this.dot = el.querySelector('.cursor__dot');
  }

  update(dt: number, p: PointerState, target: CursorTarget | null, color: string) {
    const el = this.el;
    if (!el || !this.ring || !this.dot) return;
    const show = p.type !== 'touch' && p.seen && p.inside;
    if (show !== this.shown) {
      this.shown = show;
      el.dataset.on = show ? '1' : '0';
      document.documentElement.classList.toggle('has-cursor', show);
    }
    if (!show) return;
    if (color !== this.color) {
      this.color = color;
      el.style.setProperty('--cc', color);
    }
    el.dataset.hot = target ? '1' : '0';
    el.dataset.press = p.down ? '1' : '0';

    // the dot is the pointer itself: zero latency
    this.dot.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0)`;

    // ring: magnetic target + spring (interruptible: it always retargets from its current state)
    let tx = p.x;
    let ty = p.y;
    let ts = 1;
    if (target) {
      const pull = target.kind === 'node' ? 0.86 : 0;
      tx = p.x + (target.x - p.x) * pull;
      ty = p.y + (target.y - p.y) * pull;
      ts = target.kind === 'node' ? 1.85 : 1.38;
    }
    if (p.down) ts *= 0.8;
    if (!this.primed) {
      this.rx = p.x;
      this.ry = p.y;
      this.primed = true;
    }
    const kp = this.reduced ? 1 : 1 - Math.exp(-dt * (target ? 15 : 24));
    const ks = this.reduced ? 1 : 1 - Math.exp(-dt * 18);
    this.rx += (tx - this.rx) * kp;
    this.ry += (ty - this.ry) * kp;
    this.rs += (ts - this.rs) * ks;

    // stretch along the direction of travel (comet-like), relaxing to a circle when still or locked
    const stretchT = this.reduced || target ? 0 : Math.min(0.4, p.speed / 2800);
    this.rStretch += (stretchT - this.rStretch) * (1 - Math.exp(-dt * 12));
    if (p.speed > 90) {
      const a = Math.atan2(p.vy, p.vx);
      let da = a - this.ra;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      this.ra += da * (1 - Math.exp(-dt * 14));
    }
    const sx = this.rs * (1 + this.rStretch);
    const sy = this.rs * (1 - this.rStretch * 0.55);
    this.ring.style.transform = `translate3d(${this.rx.toFixed(1)}px,${this.ry.toFixed(1)}px,0) rotate(${this.ra.toFixed(3)}rad) scale(${sx.toFixed(3)},${sy.toFixed(3)})`;
  }

  dispose() {
    document.documentElement.classList.remove('has-cursor');
    this.el?.remove();
    this.el = null;
  }
}
