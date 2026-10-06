import * as THREE from 'three';
import gsap from 'gsap';
import type { TreeNode } from './types';

export type NodeRole = 'hidden' | 'rootbud' | 'bud' | 'farbud' | 'active' | 'trail' | 'dormant' | 'seed';

interface Item {
  node: TreeNode;
  el: HTMLDivElement;
  btn: HTMLButtonElement;
  lab: HTMLSpanElement;
  title: HTMLSpanElement;
  desc: HTMLSpanElement;
  role: NodeRole;
  vis: number;
  side: string;
  split: boolean;
  revealed: boolean;
  dy: number;
  dx: number;
  x: number;
  y: number;
  mw: number;
  mh: number;
  dirty: boolean;
  measureUntil: number;
}

export interface OverlayHandlers {
  select(id: string): void;
  hover(id: string | null): void;
}

interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  owner?: Item;
}

interface Candidate {
  side: string;
  dy: number;
  dx: number;
  rect: Rect;
  pen: number;
}

const hex = (c: THREE.Color) => '#' + c.getHexString(THREE.SRGBColorSpace);
const OBST_CAP = 5200; // projected obstacle points per frame (x,y pairs)

/**
 * DOM layer for node labels / hit-areas. One button per node (accessible + keyboard friendly),
 * positioned every frame by projecting the node's world position. No React re-renders involved.
 *
 * Label layout is a small scored search per label: it measures the real label box, then tries both
 * sides and several vertical offsets and picks the clearest spot. Node markers, other labels AND the
 * glowing strands themselves (sampled geometry, supplied by the engine) are all obstacles. A hysteresis
 * margin keeps labels from flipping while the camera glides.
 */
export class Overlay {
  readonly root: HTMLDivElement;
  private items = new Map<string, Item>();
  private v = new THREE.Vector3();
  private disposers: (() => void)[] = [];
  private tweens: gsap.core.Tween[] = [];
  private obstSource: (() => Float32Array[]) | null = null;
  private obst = new Float32Array(OBST_CAP);
  private obstN = 0;
  private lastW = 0;

  constructor(
    host: HTMLElement,
    nodes: TreeNode[],
    private h: OverlayHandlers,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'overlay';
    host.appendChild(this.root);

    for (const node of nodes) {
      const el = document.createElement('div');
      el.className = 'nd';
      el.dataset.role = 'hidden';
      el.dataset.side = 'r';
      el.style.setProperty('--c', hex(node.palette.a));
      el.style.setProperty('--c2', hex(node.palette.accent));
      el.style.setProperty('--c3', hex(node.palette.b));
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nd__btn';
      btn.tabIndex = -1;
      btn.setAttribute('aria-label', node.id === 'root' ? 'Return to the seed' : node.title);
      const lab = document.createElement('span');
      lab.className = 'nd__lab';
      const title = document.createElement('span');
      title.className = 'nd__title';
      title.textContent = node.id === 'root' ? '' : node.title;
      const desc = document.createElement('span');
      desc.className = 'nd__desc';
      desc.textContent = node.description;
      lab.append(title, desc);
      btn.append(lab);
      el.append(btn);
      this.root.append(el);

      const item: Item = {
        node,
        el,
        btn,
        lab,
        title,
        desc,
        role: 'hidden',
        vis: 0,
        side: 'r',
        split: false,
        revealed: false,
        dy: 0,
        dx: 0,
        x: 0,
        y: 0,
        mw: 0,
        mh: 0,
        dirty: true,
        measureUntil: 0,
      };
      this.items.set(node.id, item);

      const onClick = () => this.h.select(node.id);
      const onEnter = () => this.h.hover(node.id);
      const onLeave = () => this.h.hover(null);
      btn.addEventListener('click', onClick);
      btn.addEventListener('pointerenter', onEnter);
      btn.addEventListener('pointerleave', onLeave);
      btn.addEventListener('focus', onEnter);
      btn.addEventListener('blur', onLeave);
      this.disposers.push(() => {
        btn.removeEventListener('click', onClick);
        btn.removeEventListener('pointerenter', onEnter);
        btn.removeEventListener('pointerleave', onLeave);
        btn.removeEventListener('focus', onEnter);
        btn.removeEventListener('blur', onLeave);
      });
    }
  }

  /** the engine supplies world-space (x,y) samples of every visible strand so labels can avoid them */
  setObstacleSource(fn: () => Float32Array[]) {
    this.obstSource = fn;
  }

  setRole(id: string, role: NodeRole) {
    const it = this.items.get(id);
    if (!it || it.role === role) return;
    const prev = it.role;
    it.role = role;
    it.el.dataset.role = role;
    it.btn.tabIndex = role !== 'hidden' ? 0 : -1;
    it.dirty = true;
    if (role === 'active' && prev !== 'active') it.revealed = false;
  }

  /** last projected screen position of a node (px), or null while it is hidden */
  screenOf(id: string): { x: number; y: number } | null {
    const it = this.items.get(id);
    return it && it.role !== 'hidden' && it.vis > 0.05 ? { x: it.x, y: it.y } : null;
  }

  setVis(id: string, v: number) {
    const it = this.items.get(id);
    if (it) it.vis = v;
  }

  /** luminous title entrance for a freshly activated node */
  revealTitle(id: string, speed = 1) {
    const it = this.items.get(id);
    if (!it || it.node.id === 'root') return;
    if (!it.split) {
      const text = it.node.title;
      it.title.textContent = '';
      text.split(' ').forEach((word, wi, arr) => {
        const wEl = document.createElement('span');
        wEl.className = 'word';
        for (const ch of word) {
          const s = document.createElement('span');
          s.className = 'ch';
          s.textContent = ch;
          wEl.append(s);
        }
        it.title.append(wEl);
        if (wi < arr.length - 1) it.title.append(document.createTextNode(' '));
      });
      it.split = true;
    }
    const chars = it.title.querySelectorAll('.ch');
    this.tweens.push(
      gsap.fromTo(
        chars,
        { opacity: 0, y: 16, filter: 'blur(10px)' },
        { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.95 / speed, ease: 'power3.out', stagger: { each: 0.028 / speed, from: 'start' }, overwrite: true },
      ),
      gsap.fromTo(it.title, { letterSpacing: '0.55em' }, { letterSpacing: '0.14em', duration: 1.9 / speed, ease: 'expo.out', overwrite: true }),
      gsap.fromTo(it.desc, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 1.1 / speed, delay: 0.5 / speed, ease: 'power2.out', overwrite: true }),
    );
    it.revealed = true;
    it.dirty = true;
    it.measureUntil = performance.now() + 2600; // the title tracks in, so its box keeps changing
  }

  private measure(it: Item) {
    // layout read, but only for the handful of labels whose box actually changed
    it.mw = it.lab.offsetWidth;
    it.mh = it.lab.offsetHeight;
    it.dirty = false;
  }

  update(camera: THREE.Camera, w: number, hgt: number) {
    const narrow = w < 700;
    const now = performance.now();
    if (w !== this.lastW) {
      this.lastW = w;
      for (const it of this.items.values()) it.dirty = true;
    }

    // ── project nodes
    const live: { it: Item; x: number; y: number; prio: number }[] = [];
    for (const it of this.items.values()) {
      const visible = it.vis > 0.012 && it.role !== 'hidden';
      if (!visible) {
        if (it.el.style.visibility !== 'hidden') {
          it.el.style.visibility = 'hidden';
          it.el.style.opacity = '0';
        }
        continue;
      }
      const n = it.node;
      this.v.set(n.pos.x, n.pos.y, n.pos.z).project(camera);
      if (this.v.z > 1 || this.v.z < -1) {
        it.el.style.visibility = 'hidden';
        continue;
      }
      const x = (this.v.x * 0.5 + 0.5) * w;
      const y = (-this.v.y * 0.5 + 0.5) * hgt;
      if (it.el.style.visibility !== 'visible') it.el.style.visibility = 'visible';
      it.x = x;
      it.y = y;
      it.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
      it.el.style.opacity = it.vis.toFixed(3);
      const prio = it.role === 'active' ? 0 : it.role === 'trail' ? 1 : it.role === 'seed' ? 9 : it.role === 'dormant' ? 3 : 2;
      live.push({ it, x, y, prio });
    }

    // ── project strand samples (obstacles)
    let on = 0;
    if (this.obstSource) {
      for (const arr of this.obstSource()) {
        for (let i = 0; i < arr.length && on < OBST_CAP - 1; i += 2) {
          this.v.set(arr[i], arr[i + 1], 0).project(camera);
          if (this.v.x < -1.15 || this.v.x > 1.15 || this.v.y < -1.15 || this.v.y > 1.15) continue;
          this.obst[on++] = (this.v.x * 0.5 + 0.5) * w;
          this.obst[on++] = (-this.v.y * 0.5 + 0.5) * hgt;
        }
      }
    }
    this.obstN = on;
    const obst = this.obst;
    const strandsIn = (r: Rect) => {
      let c = 0;
      const x0 = r.x0 - 5;
      const x1 = r.x1 + 5;
      const y0 = r.y0 - 5;
      const y1 = r.y1 + 5;
      for (let k = 0; k < this.obstN; k += 2) {
        const px = obst[k];
        const py = obst[k + 1];
        if (px > x0 && px < x1 && py > y0 && py < y1) c++;
      }
      return c;
    };

    // ── label layout
    live.sort((a, b) => a.prio - b.prio || a.it.node.index - b.it.node.index);
    const placed: Rect[] = [];
    for (const { it, x, y } of live) {
      if (it.role === 'seed') continue;
      placed.push({ x0: x - 22, x1: x + 22, y0: y - 22, y1: y + 22, owner: it });
    }
    const overlap = (r: Rect, self: Item) => {
      let a = 0;
      for (const p of placed) {
        if (p.owner === self) continue;
        const ox = Math.min(r.x1, p.x1 + 6) - Math.max(r.x0, p.x0 - 6);
        const oy = Math.min(r.y1, p.y1 + 3) - Math.max(r.y0, p.y0 - 3);
        if (ox > 0 && oy > 0) a += ox * oy;
      }
      return a;
    };

    const fs = narrow ? Math.min(24, Math.max(15, w * 0.052)) : Math.min(38, Math.max(17, w * 0.022));
    for (const { it, x, y } of live) {
      if (it.role === 'seed') continue;
      const n = it.node;
      const active = it.role === 'active';
      const label = it.role !== 'farbud';
      if (!label) continue; // far nodes are label-less until hovered (CSS), nothing to lay out

      if (it.dirty || (active && now < it.measureUntil)) this.measure(it);
      const cw = narrow ? 8.3 : it.role === 'trail' || it.role === 'dormant' ? 8.6 : 9.9;
      const labW = it.mw || Math.min(n.title.length * cw, narrow ? w * 0.38 : 320);
      const labH = it.mh || (active ? 150 : 22);

      let base = n.side as string;
      if (narrow && n.id !== 'root') {
        const rel = x / w;
        base = rel > 0.56 ? 'l' : rel < 0.44 ? 'r' : n.index % 2 ? 'l' : 'r';
      }
      const other = base === 'r' ? 'l' : 'r';
      const gap = active ? 72 : 52;
      const cands: Candidate[] = [];
      const push = (side: string, dy: number, dx: number, rect: Rect, pen: number) => cands.push({ side, dy, dx, rect, pen });

      if (active && narrow) {
        // phones: the big title sits centred above or below its node, clamped to the viewport
        const aw = Math.min(labW, w - 16);
        const cx = Math.min(w - 8 - aw / 2, Math.max(8 + aw / 2, x));
        const childrenUp = (n.children.length ? n.children.reduce((a, c) => a + c.pos.y, 0) / n.children.length - n.pos.y : n.pos.y) > 0;
        const order = childrenUp ? ['b', 't'] : ['t', 'b'];
        order.forEach((sd, oi) => {
          for (const d of [0, 30, 60]) {
            const rect: Rect =
              sd === 'b'
                ? { x0: cx - aw / 2, x1: cx + aw / 2, y0: y + 36 + d, y1: y + 36 + d + labH }
                : { x0: cx - aw / 2, x1: cx + aw / 2, y0: y - 36 - labH - d, y1: y - 36 - d };
            push(sd, sd === 'b' ? d : -d, cx - x, rect, oi * 60 + d * 1.2);
          }
        });
      } else {
        const dys = active ? [0, -34, 34, -68, 68, -110, 110] : [0, -20, 20, -40, 40, -62, 62];
        for (const sd of [base, other]) {
          for (const dy of dys) {
            const x0 = sd === 'r' ? x + gap : x - gap - labW;
            const y0 = active ? y - fs * 0.6 + dy : y - labH / 2 + dy;
            push(sd, dy, 0, { x0, x1: x0 + labW, y0, y1: y0 + labH }, (sd === base ? 0 : 28) + Math.abs(dy) * 1.4);
          }
        }
      }

      const topSafe = 44;
      const botSafe = hgt - 70;
      const scoreOf = (c: Candidate) => {
        const r = c.rect;
        let s = c.pen;
        if (r.x0 < 10) s += (10 - r.x0) * 40 + 400;
        if (r.x1 > w - 10) s += (r.x1 - (w - 10)) * 40 + 400;
        if (r.y0 < topSafe) s += (topSafe - r.y0) * 12 + 150;
        if (r.y1 > botSafe) s += (r.y1 - botSafe) * 12 + 150;
        s += overlap(r, it) * 0.12;
        s += strandsIn(r) * (active ? 8 : 22);
        return s;
      };
      let best = cands[0];
      let bestS = Infinity;
      let cur: Candidate | null = null;
      let curS = Infinity;
      for (const c of cands) {
        const s = scoreOf(c);
        if (s < bestS) {
          bestS = s;
          best = c;
        }
        if (c.side === it.side && c.dy === it.dy) {
          cur = c;
          curS = s;
        }
      }
      // hysteresis: stay where we are unless the new spot is clearly better
      const pick = cur && curS <= bestS + 45 ? cur : best;
      placed.push({ ...pick.rect });

      if (it.side !== pick.side) {
        it.side = pick.side;
        it.el.dataset.side = pick.side;
      }
      if (it.dy !== pick.dy) {
        it.dy = pick.dy;
        it.el.style.setProperty('--dy', pick.dy + 'px');
      }
      if (Math.abs(it.dx - pick.dx) > 0.5) {
        it.dx = pick.dx;
        it.el.style.setProperty('--dx', pick.dx.toFixed(1) + 'px');
      }
    }
  }

  dispose() {
    this.tweens.forEach((t) => t.kill());
    this.disposers.forEach((d) => d());
    this.root.remove();
    this.items.clear();
  }
}
