import * as THREE from 'three';
import gsap from 'gsap';
import type { TreeNode } from './types';

export type NodeRole = 'hidden' | 'rootbud' | 'bud' | 'farbud' | 'active' | 'trail' | 'dormant' | 'seed';

interface Item {
  node: TreeNode;
  el: HTMLDivElement;
  btn: HTMLButtonElement;
  title: HTMLSpanElement;
  desc: HTMLSpanElement;
  role: NodeRole;
  vis: number;
  side: string;
  split: boolean;
  revealed: boolean;
  interactive: boolean;
  lastText: string;
  dy: number;
  dx: number;
}

export interface OverlayHandlers {
  select(id: string): void;
  hover(id: string | null): void;
}

const hex = (c: THREE.Color) => '#' + c.getHexString(THREE.SRGBColorSpace);

/**
 * DOM layer for node labels / hit-areas. One button per node (accessible + keyboard friendly),
 * positioned every frame by projecting the node's world position. No React re-renders involved.
 */
export class Overlay {
  readonly root: HTMLDivElement;
  private items = new Map<string, Item>();
  private cursor: HTMLDivElement | null = null;
  private cx = 0;
  private cy = 0;
  private tx = 0;
  private ty = 0;
  private cursorOn = false;
  private v = new THREE.Vector3();
  private disposers: (() => void)[] = [];
  private tweens: gsap.core.Tween[] = [];

  constructor(host: HTMLElement, nodes: TreeNode[], private h: OverlayHandlers) {
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
      const num = document.createElement('span');
      num.className = 'nd__num';
      num.textContent = node.id === 'root' ? '' : node.number;
      const title = document.createElement('span');
      title.className = 'nd__title';
      title.textContent = node.id === 'root' ? '' : node.title;
      const desc = document.createElement('span');
      desc.className = 'nd__desc';
      desc.textContent = node.description;
      lab.append(num, title, desc);
      btn.append(lab);
      el.append(btn);
      this.root.append(el);

      const item: Item = {
        node,
        el,
        btn,
        title,
        desc,
        role: 'hidden',
        vis: 0,
        side: 'r',
        split: false,
        revealed: false,
        interactive: false,
        lastText: '',
        dy: 0,
        dx: 0,
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

    if (window.matchMedia('(pointer: fine)').matches) {
      this.cursor = document.createElement('div');
      this.cursor.className = 'cursor';
      this.cursor.innerHTML = '<i></i><b></b>';
      this.root.append(this.cursor);
      const move = (e: PointerEvent) => {
        if (e.pointerType !== 'mouse') return;
        this.tx = e.clientX;
        this.ty = e.clientY;
        if (!this.cursorOn) {
          this.cx = this.tx;
          this.cy = this.ty;
          this.cursorOn = true;
          this.cursor!.dataset.on = '1';
        }
      };
      const leave = () => {
        this.cursorOn = false;
        if (this.cursor) this.cursor.dataset.on = '0';
      };
      window.addEventListener('pointermove', move, { passive: true });
      document.documentElement.addEventListener('pointerleave', leave);
      this.disposers.push(() => {
        window.removeEventListener('pointermove', move);
        document.documentElement.removeEventListener('pointerleave', leave);
      });
    }
  }

  setRole(id: string, role: NodeRole) {
    const it = this.items.get(id);
    if (!it || it.role === role) return;
    const prev = it.role;
    it.role = role;
    it.el.dataset.role = role;
    const interactive = role !== 'hidden';
    it.btn.tabIndex = interactive ? 0 : -1;
    it.interactive = interactive;
    if (role === 'active' && prev !== 'active') {
      it.revealed = false;
    }
  }

  setVis(id: string, v: number) {
    const it = this.items.get(id);
    if (it) it.vis = v;
  }

  setHot(on: boolean) {
    if (this.cursor) this.cursor.dataset.hot = on ? '1' : '0';
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
      gsap.fromTo(it.title, { letterSpacing: '0.55em' }, { letterSpacing: '0.16em', duration: 1.9 / speed, ease: 'expo.out', overwrite: true }),
      gsap.fromTo(it.desc, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 1.1 / speed, delay: 0.5 / speed, ease: 'power2.out', overwrite: true }),
    );
    it.revealed = true;
  }

  update(camera: THREE.Camera, w: number, hgt: number, dt: number) {
    const narrow = w < 700;
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
      it.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
      it.el.style.opacity = it.vis.toFixed(3);
      const prio = it.role === 'active' ? (narrow ? 2.5 : 0) : it.role === 'trail' ? 1 : it.role === 'seed' ? 9 : it.role === 'dormant' ? 3 : 2;
      live.push({ it, x, y, prio });
    }

    // label layout: keep everything on screen and keep labels from colliding
    live.sort((a, b) => a.prio - b.prio || a.it.node.index - b.it.node.index);
    const placed: { x0: number; x1: number; y0: number; y1: number; owner?: Item }[] = [];
    // every visible node marker is an obstacle for every *other* label
    for (const { it, x, y } of live) {
      if (it.role === 'seed') continue;
      placed.push({ x0: x - 20, x1: x + 20, y0: y - 20, y1: y + 20, owner: it });
    }
    for (const { it, x, y } of live) {
      if (it.role === 'seed') continue;
      if (it.role === 'farbud' || it.role === 'dormant') {
        // label-less on phones – no layout needed
        if (narrow) continue;
      }
      const n = it.node;
      const active = it.role === 'active';
      const cw = narrow ? 8.3 : it.role === 'trail' || it.role === 'dormant' ? 8.6 : 9.7;
      const natural = n.title.length * cw;
      const wrapW = narrow && !active && it.role !== 'trail' && it.role !== 'dormant' ? w * 0.38 : natural;
      const labW = active ? Math.min(w * (narrow ? 0.52 : 0.34), 560) : Math.min(natural, wrapW);
      const lines = Math.ceil(natural / Math.max(40, labW));
      const labH = active ? (narrow ? 170 : 200) : 24 + lines * 14;
      const yOff = active ? -labH * 0.38 : -labH / 2;
      const off = 52 + (active ? 10 : 0);
      const rect = (side: string, dy: number) => {
        const x0 = side === 'r' ? x + off : x - off - labW;
        return { x0, x1: x0 + labW, y0: y + yOff + dy, y1: y + yOff + dy + labH };
      };
      const hit = (r: { x0: number; x1: number; y0: number; y1: number }) =>
        r.x0 < 8 || r.x1 > w - 8 || r.y0 < 4 || r.y1 > hgt - 4 || placed.some((p) => p.owner !== it && r.x0 < p.x1 + 6 && r.x1 > p.x0 - 6 && r.y0 < p.y1 + 2 && r.y1 > p.y0 - 2);

      if (active && narrow) {
        // phones: the big title sits centred above or below its node, clamped to the viewport
        const aw = Math.min(w * 0.8, 420);
        const ah = 150;
        const cx = Math.min(w - 8 - aw / 2, Math.max(8 + aw / 2, x));
        const box = (sd: string, d: number) =>
          sd === 'b'
            ? { x0: cx - aw / 2, x1: cx + aw / 2, y0: y + 36 + d, y1: y + 36 + d + ah }
            : { x0: cx - aw / 2, x1: cx + aw / 2, y0: y - 36 - ah - d, y1: y - 36 - d };
        // keep the title on the side facing away from the child nodes
        const childrenUp = (n.children.length ? n.children.reduce((a, c) => a + c.pos.y, 0) / n.children.length - n.pos.y : n.pos.y) > 0;
        // choose the candidate that overlaps the least (markers and already-placed labels)
        const area = (r: { x0: number; x1: number; y0: number; y1: number }) => {
          let a = 0;
          for (const p of placed) {
            if (p.owner === it) continue;
            const ox = Math.min(r.x1, p.x1) - Math.max(r.x0, p.x0);
            const oy = Math.min(r.y1, p.y1) - Math.max(r.y0, p.y0);
            if (ox > 0 && oy > 0) a += ox * oy;
          }
          if (r.y0 < 40) a += (40 - r.y0) * aw * 2;
          if (r.y1 > hgt - 56) a += (r.y1 - (hgt - 56)) * aw * 2;
          return a;
        };
        const order = childrenUp ? ['b', 't'] : ['t', 'b'];
        let pickS = order[0];
        let pickD = 0;
        let best = Infinity;
        for (let oi = 0; oi < 2; oi++) {
          for (const d of [0, 30, 60]) {
            const sc = area(box(order[oi], d)) + oi * 2500 + d * 12;
            if (sc < best) {
              best = sc;
              pickS = order[oi];
              pickD = d;
            }
          }
        }
        placed.push({ ...box(pickS, pickD) });
        const dyv = pickS === 'b' ? pickD : -pickD;
        const dxv = cx - x;
        if (it.side !== pickS) {
          it.side = pickS;
          it.el.dataset.side = pickS;
        }
        if (it.dy !== dyv) {
          it.dy = dyv;
          it.el.style.setProperty('--dy', dyv + 'px');
        }
        if (Math.abs(it.dx - dxv) > 0.5) {
          it.dx = dxv;
          it.el.style.setProperty('--dx', dxv.toFixed(1) + 'px');
        }
        continue;
      }
      if (it.dx !== 0) {
        it.dx = 0;
        it.el.style.setProperty('--dx', '0px');
      }
      let base = n.side as string;
      if (n.id !== 'root' && narrow) {
        const rel = x / w;
        base = rel > 0.56 ? 'l' : rel < 0.44 ? 'r' : n.index % 2 ? 'l' : 'r';
      }
      const other = base === 'r' ? 'l' : 'r';
      let chosen = base;
      let cdy = 0;
      let ok = false;
      search: for (const dy of [0, -24, 24, -48, 48]) {
        for (const sd of [base, other]) {
          if (!hit(rect(sd, dy))) {
            chosen = sd;
            cdy = dy;
            ok = true;
            break search;
          }
        }
      }
      if (!ok) {
        chosen = base;
        cdy = 0;
      }
      placed.push({ ...rect(chosen, cdy) });
      if (it.side !== chosen) {
        it.side = chosen;
        it.el.dataset.side = chosen;
      }
      if (it.dy !== cdy) {
        it.dy = cdy;
        it.el.style.setProperty('--dy', cdy + 'px');
      }
    }
    if (this.cursor && this.cursorOn) {
      const k = 1 - Math.exp(-dt * 16);
      this.cx += (this.tx - this.cx) * k;
      this.cy += (this.ty - this.cy) * k;
      this.cursor.style.transform = `translate3d(${this.cx.toFixed(1)}px,${this.cy.toFixed(1)}px,0)`;
    }
  }

  dispose() {
    this.tweens.forEach((t) => t.kill());
    this.disposers.forEach((d) => d());
    this.root.remove();
    this.items.clear();
  }
}
