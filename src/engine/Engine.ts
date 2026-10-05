import * as THREE from 'three';
import gsap from 'gsap';
import {
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  VignetteEffect,
  BlendFunction,
} from 'postprocessing';
import { BranchMesh } from './BranchMesh';
import type { Shared } from './BranchMesh';
import { AudioEngine } from './AudioEngine';
import { CameraRig } from './CameraRig';
import type { Framing } from './CameraRig';
import { detectQuality, LOOK, PROFILES } from './config';
import type { Quality, QualityProfile } from './config';
import { AmbientParticles, Background, EnergyOrb, NodeMarkers, Seed, ShockRings, Sparks } from './Fx';
import { ancestry, buildTree, DEFAULT_LAYOUT, isDescendant } from './layout';
import type { TreeModel } from './layout';
import { Overlay } from './Overlay';
import type { NodeRole } from './Overlay';
import type { P } from './trunk';
import type { CategoryData, TreeNode } from './types';

export interface EngineState {
  path: { id: string; title: string }[];
  busy: boolean;
  muted: boolean;
  intro: boolean;
  current: { title: string; description: string } | null;
}

type Listener = (s: EngineState) => void;
type LayoutKind = 'landscape' | 'square' | 'portrait';

interface NodeRT {
  node: TreeNode;
  i: number;
  branch: BranchMesh | null;
  grown: boolean;
  pending: boolean;
  retracting: boolean;
  hold: boolean;
  role: NodeRole;
  vis: number;
  visT: number;
  act: number;
  actT: number;
  hov: number;
  hovT: number;
  flare: number;
  dim: number;
  dimT: number;
}

interface World {
  kind: LayoutKind;
  model: TreeModel;
  rts: Map<string, NodeRT>;
  list: NodeRT[];
  markers: NodeMarkers;
  overlay: Overlay;
  group: THREE.Group;
}

interface EnergyJob {
  branch: BranchMesh;
  mode: 'grow' | 'pulse' | 'retract';
  t: number;
  color: THREE.Color;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const growEase = (p: number) => 0.32 * p + 0.68 * (p * p * (3 - 2 * p));

export class Engine {
  private host: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private scene = new THREE.Scene();
  private rig: CameraRig;
  private shared: Shared;
  private quality: Quality;
  private profile: QualityProfile;
  private dpr: number;
  private reduced: boolean;
  private audio = new AudioEngine();
  private gctx: gsap.Context;

  private bg!: Background;
  private ambient!: AmbientParticles;
  private sparks!: Sparks;
  private seed!: Seed;
  private orb!: EnergyOrb;
  private rings!: ShockRings;
  private world!: World;

  private path: TreeNode[] = [];
  private buds = new Set<string>();
  private busy = false;
  private tl: gsap.core.Timeline | null = null;
  private energy: EnergyJob | null = null;
  private hoverId: string | null = null;
  private introDone = false;
  private listeners = new Set<Listener>();
  private activity = 0;
  private lastTime = 0;
  private sparkAcc = 0;
  private perf = { acc: 0, n: 0, bad: 0 };
  private destroyed = false;
  private w = 1;
  private h = 1;
  private bloom: BloomEffect | null = null;
  private cleanups: (() => void)[] = [];
  private contextLost = false;

  constructor(host: HTMLElement, private categories: CategoryData[]) {
    this.host = host;
    this.quality = detectQuality();
    this.profile = PROFILES[this.quality];
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.gctx = gsap.context(() => {});

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      stencil: false,
      depth: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(new THREE.Color().setRGB(0.00018, 0.00035, 0.0014, THREE.LinearSRGBColorSpace), 1);
    this.dpr = Math.min(window.devicePixelRatio || 1, this.profile.dpr);
    this.renderer.setPixelRatio(this.dpr);
    this.w = Math.max(1, host.clientWidth);
    this.h = Math.max(1, host.clientHeight);
    this.renderer.setSize(this.w, this.h);
    const canvas = this.renderer.domElement;
    canvas.className = 'stage';
    host.appendChild(canvas);

    this.rig = new CameraRig(LOOK.fov, this.w / this.h);
    this.rig.reduced = this.reduced;
    this.shared = { uTime: { value: 0 }, quad: new THREE.PlaneGeometry(2, 2) };

    this.buildFx();
    this.world = this.buildWorld(this.layoutKind());
    this.setupPost();
    this.bindEvents();

    this.rig.snap(this.frameFor(null, 1.55));
    this.rig.setTarget(this.frameFor(null), 0.42);
    this.syncRoles();
    this.emit();
    this.lastTime = performance.now();
    gsap.ticker.add(this.tick);
    if (process.env.NODE_ENV !== 'production' && window.location.search.includes('pump')) {
      // dev-only: keep frames flowing when the tab is occluded (automated screenshots)
      const id = window.setInterval(() => gsap.ticker.tick(), 16);
      this.cleanups.push(() => window.clearInterval(id));
    }
    this.intro();
  }

  /* ─────────────────────────── public API ─────────────────────────── */
  onState(cb: Listener) {
    this.listeners.add(cb);
    cb(this.getState());
    return () => this.listeners.delete(cb);
  }

  getState(): EngineState {
    const cur = this.path[this.path.length - 1];
    return {
      path: this.path.map((n) => ({ id: n.id, title: n.title })),
      busy: this.busy,
      muted: this.audio.muted,
      intro: this.introDone,
      current: cur ? { title: cur.title, description: cur.description } : null,
    };
  }

  toggleMute() {
    this.audio.unlock();
    this.audio.setMuted(!this.audio.muted);
    if (!this.audio.muted) this.audio.tick();
    this.emit();
  }

  select(id: string) {
    if (this.destroyed) return;
    this.audio.unlock();
    if (id === 'root') return this.home();
    const rt = this.world.rts.get(id);
    if (!rt) return;
    if (this.busy) this.finish();
    if (!rt.grown) {
      if (!this.buds.has(id)) return;
      this.grow(rt.node);
    } else if (this.path.includes(rt.node)) {
      if (rt.node === this.path[this.path.length - 1]) this.ping(rt);
      else this.retractTo(rt.node);
    } else {
      this.navigate(rt.node);
    }
  }

  home() {
    this.audio.unlock();
    if (this.busy) this.finish();
    if (this.path.length === 0) {
      this.seedFlare();
      this.audio.tick();
      return;
    }
    this.retractTo(this.world.model.root);
  }

  back() {
    if (this.path.length === 0) return;
    this.audio.unlock();
    if (this.busy) this.finish();
    const anchor = this.path.length >= 2 ? this.path[this.path.length - 2] : this.world.model.root;
    this.retractTo(anchor);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    gsap.ticker.remove(this.tick);
    this.tl?.kill();
    this.gctx.kill();
    this.cleanups.forEach((c) => c());
    this.destroyWorld();
    this.bg.dispose();
    this.ambient.dispose();
    this.sparks.dispose();
    this.seed.dispose();
    this.orb.dispose();
    this.rings.dispose();
    this.shared.quad.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.audio.dispose();
    this.listeners.clear();
  }

  /* ─────────────────────────── construction ─────────────────────────── */
  private buildFx() {
    const root = new THREE.Color('#5ad8ff');
    this.bg = new Background(this.shared, this.profile.bgLights);
    this.scene.add(this.bg.mesh);
    this.ambient = new AmbientParticles(this.shared, this.profile.particles, this.dpr);
    this.scene.add(this.ambient.points);
    this.seed = new Seed(this.shared, root, new THREE.Color('#8f7bff'), new THREE.Color('#ffffff'));
    this.scene.add(this.seed.mesh);
    this.sparks = new Sparks(this.shared, this.profile.sparks, this.dpr);
    this.scene.add(this.sparks.points);
    this.orb = new EnergyOrb(this.shared);
    this.scene.add(this.orb.mesh);
    this.rings = new ShockRings(this.shared);
    this.scene.add(this.rings.group);
  }

  private layoutKind(): LayoutKind {
    const a = this.w / this.h;
    return a >= 1.05 ? 'landscape' : a < 0.8 ? 'portrait' : 'square';
  }

  private buildWorld(kind: LayoutKind): World {
    const sq = kind === 'portrait' ? { x: 0.62, y: 1.1 } : kind === 'square' ? { x: 0.86, y: 1 } : { x: 1, y: 1 };
    const model = buildTree(this.categories, { ...DEFAULT_LAYOUT, squashX: sq.x, squashY: sq.y, ring: kind === 'portrait' ? 6.8 : 6.4 });
    const markers = new NodeMarkers(model.nodes, this.shared);
    this.scene.add(markers.mesh);
    const group = new THREE.Group();
    this.scene.add(group);
    const overlay = new Overlay(this.host, model.nodes, {
      select: (id) => this.select(id),
      hover: (id) => this.setHover(id),
    });
    const rts = new Map<string, NodeRT>();
    const list: NodeRT[] = [];
    model.nodes.forEach((node, i) => {
      const rt: NodeRT = {
        node,
        i,
        branch: null,
        grown: false,
        pending: false,
        retracting: false,
        hold: false,
        role: 'hidden',
        vis: 0,
        visT: 0,
        act: 0,
        actT: 0,
        hov: 0,
        hovT: 0,
        flare: 0,
        dim: 1,
        dimT: 1,
      };
      rts.set(node.id, rt);
      list.push(rt);
    });
    return { kind, model, rts, list, markers, overlay, group };
  }

  private destroyWorld() {
    const w = this.world;
    for (const rt of w.list) rt.branch?.dispose();
    w.markers.dispose();
    this.scene.remove(w.markers.mesh);
    this.scene.remove(w.group);
    w.overlay.dispose();
  }

  private setupPost() {
    const p = this.profile;
    if (!p.bloom) return;
    try {
      const composer = new EffectComposer(this.renderer, {
        frameBufferType: THREE.HalfFloatType,
        multisampling: 0,
        depthBuffer: false,
        stencilBuffer: false,
      });
      composer.addPass(new RenderPass(this.scene, this.rig.camera));
      const bloom = new BloomEffect({
        intensity: 1.05,
        luminanceThreshold: 0.5,
        luminanceSmoothing: 0.4,
        mipmapBlur: true,
        radius: 0.78,
        levels: this.quality === 'low' ? 5 : 7,
      });
      this.bloom = bloom;
      const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.82 });
      const noise = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.SCREEN });
      noise.blendMode.opacity.value = 0.025;
      const effects: (BloomEffect | VignetteEffect | NoiseEffect | ChromaticAberrationEffect)[] = [bloom];
      if (p.chroma) {
        effects.push(
          new ChromaticAberrationEffect({
            offset: new THREE.Vector2(0.0007, 0.0009),
            radialModulation: true,
            modulationOffset: 0.35,
          }),
        );
      }
      effects.push(vignette, noise);
      composer.addPass(new EffectPass(this.rig.camera, ...effects));
      composer.setSize(this.w, this.h);
      this.composer = composer;
    } catch (e) {
      console.warn('[technophilia] post-processing unavailable, rendering directly', e);
      this.composer = null;
    }
  }

  private bindEvents() {
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.host);
    this.cleanups.push(() => ro.disconnect());

    const move = (e: PointerEvent) => {
      this.rig.pTarget.set((e.clientX / this.w) * 2 - 1, -((e.clientY / this.h) * 2 - 1));
    };
    window.addEventListener('pointermove', move, { passive: true });
    this.cleanups.push(() => window.removeEventListener('pointermove', move));

    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        this.back();
      } else if (e.key === 'Home') {
        this.home();
      } else if (e.key.toLowerCase() === 'm') {
        this.toggleMute();
      }
    };
    window.addEventListener('keydown', key);
    this.cleanups.push(() => window.removeEventListener('keydown', key));

    const canvas = this.renderer.domElement;
    const lost = (e: Event) => {
      e.preventDefault();
      this.contextLost = true;
    };
    const restored = () => window.location.reload();
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    this.cleanups.push(() => {
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
    });
  }

  private resize() {
    if (this.destroyed) return;
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    if (this.composer) this.composer.setSize(w, h);
    else this.renderer.setSize(w, h);
    this.rig.setAspect(w / h);
    const kind = this.layoutKind();
    if (kind !== this.world.kind) {
      this.rebuildWorld(kind);
    } else {
      this.rig.setTarget(this.frameFor(this.path[this.path.length - 1] ?? null), 1.6);
    }
  }

  /** orientation class changed → recompute the layout and restart from the seed */
  private rebuildWorld(kind: LayoutKind) {
    this.tl?.kill();
    this.tl = null;
    this.busy = false;
    this.energy = null;
    this.gctx.kill();
    this.gctx = gsap.context(() => {});
    this.destroyWorld();
    this.world = this.buildWorld(kind);
    this.path = [];
    this.buds.clear();
    this.hoverId = null;
    this.rig.followTarget = 0;
    this.rig.snap(this.frameFor(null));
    this.refreshBuds(true);
    this.syncRoles();
    this.emit();
  }

  /* ─────────────────────────── helpers ─────────────────────────── */
  private g<T>(fn: () => T): T {
    let out!: T;
    this.gctx.add(() => {
      out = fn();
    });
    return out;
  }

  private speed() {
    return this.reduced ? 1.6 : 1;
  }

  private emit() {
    const s = this.getState();
    this.listeners.forEach((l) => l(s));
  }

  private frameFor(node: TreeNode | null, zoomOut = 1): Framing {
    const pts: { x: number; y: number }[] = [];
    const { model } = this.world;
    let padX: number;
    let padY: number;
    let minDist: number;
    if (!node) {
      for (const n of model.primaries) pts.push(n.pos);
      pts.push({ x: 0, y: 0 });
      padX = 3.0;
      padY = 1.9;
      minDist = 14;
    } else {
      pts.push(node.pos);
      pts.push(node.parent && node.parent.depth > 0 ? node.parent.pos : { x: 0, y: 0 });
      for (const c of node.children) pts.push(c.pos);
      if (node.children.length === 0) {
        // leaf: leave breathing room beyond the node for its title
        const l = Math.hypot(node.pos.x, node.pos.y) || 1;
        pts.push({ x: node.pos.x + (node.pos.x / l) * 3.2, y: node.pos.y + (node.pos.y / l) * 3.2 });
      }
      padX = node.depth === 1 ? 2.6 : 2.1;
      padY = node.depth === 1 ? 2.2 : 1.8;
      minDist = node.depth >= 3 ? 9 : 10.5;
    }
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    const f = this.rig.fit(x0, x1, y0, y1, padX, padY);
    f.dist = Math.max(f.dist, minDist) * zoomOut;
    if (node && this.w > 700) {
      // leave room for the luminous title on the side it will appear
      const { hw } = this.rig.halfView(f.dist);
      f.fx += (node.side === 'r' ? 1 : -1) * hw * 0.17;
    } else if (node) {
      const { hh } = this.rig.halfView(f.dist);
      f.fy -= hh * 0.06;
    }
    return f;
  }

  private branchFor(rt: NodeRT): BranchMesh {
    if (rt.branch) return rt.branch;
    const node = rt.node;
    const parent = node.parent!;
    let A: P;
    let zA = 0;
    let heading: P;
    if (parent.depth === 0) {
      const l = Math.hypot(node.pos.x, node.pos.y) || 1;
      heading = { x: node.pos.x / l, y: node.pos.y / l };
      A = { x: heading.x * 0.5, y: heading.y * 0.5 };
    } else {
      const pb = this.branchFor(this.world.rts.get(parent.id)!);
      heading = pb.trunk.endHeading;
      A = { x: parent.pos.x, y: parent.pos.y };
      zA = parent.pos.z;
    }
    rt.branch = new BranchMesh(node, A, zA, heading, this.shared);
    this.world.group.add(rt.branch.group);
    return rt.branch;
  }

  /* ─────────────────────────── state sync ─────────────────────────── */
  private syncRoles() {
    const { list, overlay } = this.world;
    const onPath = new Set(this.path.map((n) => n.id));
    const deepest = this.path[this.path.length - 1];
    for (const rt of list) {
      if (rt.node.id === 'root') {
        overlay.setRole('root', 'seed');
        overlay.setVis('root', 1);
        rt.role = 'seed';
        continue;
      }
      let role: NodeRole = 'hidden';
      let visT = 0;
      let actT = 0;
      let dimT = 1;
      if (rt.retracting) {
        role = 'hidden';
      } else if (rt.grown) {
        if (onPath.has(rt.node.id)) {
          role = rt.node === deepest ? 'active' : 'trail';
          actT = rt.node === deepest ? 1 : 0.55;
          visT = 1;
        } else {
          role = 'dormant';
          actT = 0.4;
          visT = 0.8;
          dimT = 0.3;
        }
      } else if (this.buds.has(rt.node.id)) {
        role = rt.node.depth === 1 && this.path.length === 0 ? 'rootbud' : 'bud';
        // phones: only the children of the current node keep their label, the rest stay as bare nodes
        if (this.w < 700 && deepest && rt.node.parent !== deepest) role = 'farbud';
        visT = rt.hold ? 0 : 1;
      }
      rt.role = role;
      rt.visT = visT;
      rt.actT = actT;
      rt.dimT = dimT;
      overlay.setRole(rt.node.id, role);
    }
  }

  private refreshBuds(immediate = false) {
    const desired = new Set<string>();
    const owners = [this.world.model.root, ...this.path];
    for (const o of owners) {
      for (const c of o.children) {
        const rt = this.world.rts.get(c.id)!;
        if (!rt.grown && !rt.retracting) desired.add(c.id);
      }
    }
    let k = 0;
    for (const id of desired) {
      if (this.buds.has(id)) continue;
      const rt = this.world.rts.get(id)!;
      const branch = this.branchFor(rt);
      if (immediate) {
        rt.hold = false;
        continue;
      }
      const delay = 0.18 + k++ * 0.11;
      rt.hold = true;
      this.g(() => {
        gsap.delayedCall(delay, () => {
          rt.hold = false;
          if (!this.buds.has(id)) return;
          rt.visT = 1;
          this.g(() => gsap.to(branch, { ghostProgress: 1, duration: 1.15 * this.speed(), ease: 'power2.out', overwrite: true }));
        });
      });
    }
    for (const id of this.buds) {
      if (desired.has(id)) continue;
      const rt = this.world.rts.get(id)!;
      if (rt.branch && !rt.grown && !rt.pending) {
        const b = rt.branch;
        this.g(() => gsap.to(b, { ghostProgress: 0, duration: 0.45, ease: 'power2.in', overwrite: true }));
      }
    }
    this.buds = desired;
    this.syncRoles();
    if (immediate) {
      for (const id of desired) {
        const rt = this.world.rts.get(id)!;
        rt.vis = rt.visT;
        if (rt.branch) rt.branch.ghostProgress = 1;
      }
    }
  }

  private setHover(id: string | null) {
    if (this.hoverId === id) return;
    const prev = this.hoverId ? this.world.rts.get(this.hoverId) : null;
    if (prev) {
      prev.hovT = prev.pending ? 1 : 0;
      if (prev.branch) prev.branch.setGhostBoost(1);
    }
    this.hoverId = id;
    const rt = id ? this.world.rts.get(id) : null;
    if (rt) {
      rt.hovT = 1;
      if (rt.role === 'bud' || rt.role === 'rootbud' || rt.role === 'farbud') {
        this.audio.hover();
        rt.branch?.setGhostBoost(2.6);
      } else if (rt.role !== 'hidden') this.audio.tick();
    }
    this.world.overlay.setHot(!!rt && rt.role !== 'hidden');
  }

  /* ─────────────────────────── energy / fx ─────────────────────────── */
  private seedFlare() {
    this.g(() => {
      gsap.fromTo(this.seed.u.uFlare, { value: 0.0001 }, { value: 1, duration: 1.6 * this.speed(), ease: 'power2.out', overwrite: true });
      gsap.fromTo(this.seed.u.uEnergy, { value: 1 }, { value: 0, duration: 2.2, ease: 'power2.out', overwrite: true });
    });
  }

  private burstAt(node: TreeNode, n: number, speed = 3.2) {
    this.sparks.burst(node.pos.x, node.pos.y, node.pos.z, n, { speed, size: 6, life: 1.3, color: node.palette.a.clone().lerp(node.palette.accent, 0.3), hot: 0.4 });
  }

  private flareNode(node: TreeNode, amount = 1.4) {
    const rt = this.world.rts.get(node.id);
    if (rt) rt.flare = Math.max(rt.flare, amount);
  }

  private finish() {
    if (this.tl) {
      this.tl.progress(1);
      this.tl = null;
    }
    this.busy = false;
  }

  private newTimeline() {
    this.busy = true;
    this.activity = Math.max(this.activity, 0.4);
    const tl = this.g(() =>
      gsap.timeline({
        onComplete: () => {
          if (this.tl === tl) this.tl = null;
          this.busy = false;
          this.energy = null;
          this.rig.followTarget = 0;
          this.emit();
        },
      }),
    );
    this.tl = tl;
    this.emit();
    return tl;
  }

  /** pulse an existing branch from the seed end to its tip */
  private pulseChain(tl: gsap.core.Timeline, chain: TreeNode[], startAt: number): number {
    let at = startAt;
    for (const a of chain) {
      const art = this.world.rts.get(a.id)!;
      const b = art.branch;
      if (!b) continue;
      const d = (b.length / LOOK.pulseSpeed + 0.12) * this.speed();
      const state = { v: -0.05 };
      tl.add(() => {
        b.u.uPulseAmp.value = 1;
        this.energy = { branch: b, mode: 'pulse', t: 0, color: a.palette.accent };
        if (a.depth === 1) this.seedFlare();
      }, at);
      tl.fromTo(
        b.u.uPulse,
        { value: -0.05 },
        {
          value: 1.35,
          duration: d,
          ease: 'power1.in',
          onUpdate: () => {
            state.v = b.u.uPulse.value;
            if (this.energy && this.energy.branch === b) this.energy.t = state.v;
          },
          onComplete: () => {
            b.u.uPulseAmp.value = 0;
            b.u.uPulse.value = -1;
            this.flareNode(a, 1.1);
            this.rings.fire(a.pos.x, a.pos.y, a.pos.z, a.palette.a, 1.7, 0.9);
            this.audio.tick();
          },
        },
        at,
      );
      at += d;
    }
    return at;
  }

  private grow(node: TreeNode) {
    const rt = this.world.rts.get(node.id)!;
    const branch = this.branchFor(rt);
    branch.ensureDetail(this.profile.detail);
    const chain = ancestry(node);
    const anc = chain.slice(0, -1);
    const sp = this.speed();
    const dur = clamp(LOOK.growMin + branch.length * 0.17, LOOK.growMin, LOOK.growMax) * sp;

    rt.pending = true;
    rt.hovT = 1;
    rt.flare = 1.6;
    this.audio.select();
    this.rings.fire(node.pos.x, node.pos.y, node.pos.z, node.palette.a, 2.3, 1.1);
    this.burstAt(node, 26, 2.4);
    this.g(() => gsap.to(branch, { ghostProgress: 0, duration: 0.35, ease: 'power2.in', overwrite: true }));
    branch.progress = 0;
    branch.u.uGrow.value = 1;
    branch.u.uDim.value = 1;
    this.rig.setTarget(this.frameFor(node), 1.05 / sp);
    this.rig.followTarget = this.reduced ? 0 : 0.3;

    const tl = this.newTimeline();
    let at = 0;
    if (anc.length) {
      const pulseTotal = anc.reduce((s, a) => s + ((this.world.rts.get(a.id)?.branch?.length ?? 0) / LOOK.pulseSpeed + 0.12) * sp, 0);
      this.audio.pulse(pulseTotal);
      at = this.pulseChain(tl, anc, 0.1);
    } else {
      this.seedFlare();
      this.audio.pulse(0.6);
      at = 0.35;
    }
    let arrived = false;
    tl.add(() => {
      this.audio.grow(dur);
      this.energy = { branch, mode: 'grow', t: 0, color: node.palette.accent };
      this.activity = 1;
    }, at);
    tl.fromTo(
      branch,
      { progress: 0 },
      {
        progress: 1.2,
        duration: dur * 1.16,
        ease: growEase,
        onUpdate: () => {
          const p = branch.progress;
          if (this.energy && this.energy.branch === branch) this.energy.t = p;
          if (!arrived && p >= 1.0) {
            arrived = true;
            this.arrive(node, true);
          }
        },
      },
      at,
    );
  }

  private arrive(node: TreeNode, grown: boolean) {
    const rt = this.world.rts.get(node.id)!;
    rt.pending = false;
    if (grown) rt.grown = true;
    rt.hovT = this.hoverId === node.id ? 1 : 0;
    this.path = ancestry(node);
    this.refreshBuds();
    this.world.overlay.revealTitle(node.id, this.speed() > 1 ? 1.4 : 1);
    this.flareNode(node, 2.2);
    this.rings.fire(node.pos.x, node.pos.y, node.pos.z, node.palette.a, 3.4, 1.7);
    this.rings.fire(node.pos.x, node.pos.y, node.pos.z, node.palette.accent, 2.1, 1.1);
    this.burstAt(node, 90, 4.2);
    this.audio.impact();
    if (!this.reduced) this.rig.impulse(-5.5);
    this.rig.followTarget = 0;
    this.emit();
  }

  private ping(rt: NodeRT) {
    this.audio.select();
    this.flareNode(rt.node, 1.8);
    this.rings.fire(rt.node.pos.x, rt.node.pos.y, rt.node.pos.z, rt.node.palette.a, 2.6, 1.3);
    this.burstAt(rt.node, 40, 3);
    this.world.overlay.revealTitle(rt.node.id, 1.6);
  }

  /** re-activate an already grown branch that is not on the current path */
  private navigate(node: TreeNode) {
    const chain = ancestry(node);
    this.audio.select();
    this.rings.fire(node.pos.x, node.pos.y, node.pos.z, node.palette.a, 2.2, 1);
    this.rig.setTarget(this.frameFor(node), 1.1 / this.speed());
    const tl = this.newTimeline();
    this.audio.pulse(0.9);
    const end = this.pulseChain(tl, chain, 0.05);
    tl.add(() => this.arrive(node, false), end - 0.1);
    tl.to({}, { duration: 0.2 }, end);
  }

  private retractTo(anchor: TreeNode) {
    const isHome = anchor.depth === 0;
    const remove: NodeRT[] = [];
    for (const rt of this.world.list) {
      if (rt.node === anchor || rt.node.depth === 0) continue;
      if (rt.grown && isDescendant(rt.node, anchor)) remove.push(rt);
    }
    // hide current bud labels instantly, the ghost threads fade away
    for (const id of this.buds) {
      const rt = this.world.rts.get(id)!;
      rt.visT = 0;
      if (rt.branch) {
        const b = rt.branch;
        this.g(() => gsap.to(b, { ghostProgress: 0, duration: 0.4, ease: 'power2.in', overwrite: true }));
      }
    }
    this.buds.clear();
    remove.sort((a, b) => b.node.depth - a.node.depth);
    for (const rt of remove) {
      rt.retracting = true;
      rt.visT = 0;
      rt.actT = 0;
    }
    this.path = isHome ? [] : ancestry(anchor);
    this.syncRoles();
    this.rig.setTarget(this.frameFor(isHome ? null : anchor), 1.0 / this.speed());
    this.rig.followTarget = 0;

    const tl = this.newTimeline();
    this.audio.reverse(1.5 * this.speed());
    let at = 0.05;
    const levels = [...new Set(remove.map((r) => r.node.depth))].sort((a, b) => b - a);
    for (const depth of levels) {
      const group = remove.filter((r) => r.node.depth === depth);
      let longest = 0;
      for (const rt of group) {
        const b = rt.branch!;
        const d = clamp(0.55 + b.length * 0.09, 0.8, 1.5) * this.speed();
        longest = Math.max(longest, d);
        b.u.uGrow.value = 1;
        tl.add(() => {
          this.energy = { branch: b, mode: 'retract', t: b.progress, color: rt.node.palette.accent };
        }, at);
        tl.to(
          b,
          {
            progress: 0,
            duration: d,
            ease: 'power2.inOut',
            onUpdate: () => {
              if (this.energy && this.energy.branch === b) this.energy.t = b.progress;
            },
            onComplete: () => {
              rt.grown = false;
              rt.retracting = false;
              rt.dim = 1;
              rt.flare = 0;
            },
          },
          at,
        );
      }
      at += longest * 0.62;
    }
    tl.add(() => {
      for (const rt of remove) {
        rt.grown = false;
        rt.retracting = false;
      }
      this.refreshBuds();
      this.seedFlare();
      if (isHome) this.audio.tick();
      else {
        this.world.overlay.revealTitle(anchor.id, 1.5);
        this.flareNode(anchor, 1.4);
        this.rings.fire(anchor.pos.x, anchor.pos.y, anchor.pos.z, anchor.palette.a, 2.4, 1.2);
      }
    }, at + 0.55);
    tl.to({}, { duration: 0.15 }, at + 0.65);
  }

  /* ─────────────────────────── intro ─────────────────────────── */
  private intro() {
    const sp = this.speed();
    this.g(() => {
      gsap.to(this.seed.u.uAppear, { value: 1, duration: 3.2 * sp, ease: 'power2.out' });
      gsap.fromTo(this.bg.u.uReveal, { value: 0 }, { value: 1, duration: 4, ease: 'power1.inOut' });
      gsap.delayedCall(1.7 * sp, () => this.refreshBuds());
      gsap.delayedCall(4.0 * sp, () => {
        this.introDone = true;
        this.emit();
      });
    });
  }

  /* ─────────────────────────── frame ─────────────────────────── */
  private tick = () => {
    if (this.destroyed || this.contextLost) return;
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.0005, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.frame(dt);
  };

  private frame(dt: number) {
    const sh = this.shared;
    sh.uTime.value += dt;
    const time = sh.uTime.value;
    const w = this.world;

    // ── node state smoothing
    const kv = 1 - Math.exp(-dt * 6.5);
    const ka = 1 - Math.exp(-dt * 5);
    const kh = 1 - Math.exp(-dt * 11);
    const kd = 1 - Math.exp(-dt * 3.2);
    const fd = Math.exp(-dt * 2.1);
    for (const rt of w.list) {
      if (rt.node.depth === 0) continue;
      rt.vis += (rt.visT - rt.vis) * kv;
      rt.act += (rt.actT - rt.act) * ka;
      rt.hov += (rt.hovT - rt.hov) * kh;
      rt.dim += (rt.dimT - rt.dim) * kd;
      rt.flare *= fd;
      if (rt.vis < 0.002 && rt.visT === 0) rt.vis = 0;
      w.markers.set(rt.i, rt.vis, rt.act, rt.hov, rt.flare);
      w.overlay.setVis(rt.node.id, rt.vis);
      const b = rt.branch;
      if (b) {
        const alive = b.progress > 0.0005 || b.ghostProgress > 0.0005;
        b.setVisible(alive);
        if (alive) {
          b.u.uDim.value = rt.dim;
          b.u.uBoost.value = 1 + rt.hov * 0.45 + rt.flare * 0.25;
          b.u.uIdle.value = clamp(rt.dim * 1.2, 0.2, 1);
          if (b.progress >= 1.19 && !rt.retracting) b.u.uGrow.value += (0 - b.u.uGrow.value) * (1 - Math.exp(-dt * 3));
        }
      }
    }
    w.markers.commit();

    // ── energy orb + sparks
    const orb = this.orb;
    const job = this.energy;
    let orbTarget = 0;
    if (job) {
      const tt = clamp(job.t, 0, 1);
      const f = job.branch.sample(tt);
      orb.u.uPos.value.set(f.x, f.y, f.z + 0.05);
      const dir = job.mode === 'retract' ? -1 : 1;
      orb.u.uDir.value.set(f.tx * dir, f.ty * dir);
      (orb.u.uColor.value as THREE.Color).copy(job.color).lerp(new THREE.Color('#ffffff'), 0.25);
      const live = job.mode === 'grow' ? job.t < 1.0 : job.mode === 'pulse' ? job.t < 1.02 && job.t > -0.04 : job.t > 0.015;
      orbTarget = live ? 1 : 0;
      this.rig.follow.set(f.x, f.y, 0);
      if (live) {
        this.sparkAcc += dt * (job.mode === 'pulse' ? 110 : 70);
        const n = Math.floor(this.sparkAcc);
        this.sparkAcc -= n;
        if (n > 0) {
          this.sparks.burst(f.x, f.y, f.z, n, {
            speed: 1.9,
            size: 3.8,
            life: 0.9,
            color: job.color,
            dir: { x: -f.tx * dir, y: -f.ty * dir },
            spread: 1.1,
            hot: 0.35,
          });
        }
      }
    }
    const amp = orb.u.uAmp.value as number;
    orb.u.uAmp.value = amp + (orbTarget - amp) * (1 - Math.exp(-dt * (orbTarget > amp ? 14 : 8)));
    orb.mesh.visible = (orb.u.uAmp.value as number) > 0.01;
    this.sparks.flush();
    this.rings.update(dt);

    // ── ambient
    this.activity += ((this.busy ? 1 : 0) - this.activity) * (1 - Math.exp(-dt * (this.busy ? 3 : 1.2)));
    this.ambient.flow += dt * (this.reduced ? 0.15 : 0.35 + this.activity * 2.4);
    this.ambient.u.uFlow.value = this.ambient.flow;
    this.ambient.u.uActivity.value = this.activity;

    // ── seed
    const hoverRoot = this.hoverId === 'root' ? 1 : 0;
    const sh2 = this.seed.u.uHover.value as number;
    this.seed.u.uHover.value = sh2 + (hoverRoot - sh2) * (1 - Math.exp(-dt * 8));

    // ── camera
    this.rig.update(dt, time);
    const cam = this.rig.camera;
    this.bg.mesh.position.x = this.rig.focus.x;
    this.bg.mesh.position.y = this.rig.focus.y;
    (this.bg.u.uFocus.value as THREE.Vector2).set(this.rig.focus.x, this.rig.focus.y);
    (this.ambient.u.uCenter.value as THREE.Vector3).set(this.rig.focus.x, this.rig.focus.y, 0);
    this.updateLights();

    // ── dom
    w.overlay.update(cam, this.w, this.h, dt);

    // ── render
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, cam);

    this.monitor(dt);
  }

  private updateLights() {
    const bg = this.bg;
    let i = 0;
    const seedE = 0.55 + (this.seed.u.uEnergy.value as number) * 0.8;
    bg.setLight(i++, 0, 0, 3.8, seedE);
    const job = this.energy;
    if (job && (this.orb.u.uAmp.value as number) > 0.05) {
      const o = this.orb.u.uPos.value as THREE.Vector3;
      bg.setLight(i++, o.x, o.y, 3.4, 1.7 * (this.orb.u.uAmp.value as number));
    }
    const cur = this.path[this.path.length - 1];
    if (cur) bg.setLight(i++, cur.pos.x, cur.pos.y, 5.2, 1.0);
    for (let k = this.path.length - 2; k >= 0 && i < 8; k--) bg.setLight(i++, this.path[k].pos.x, this.path[k].pos.y, 3.8, 0.6);
    for (const rt of this.world.list) {
      if (i >= 8) break;
      if (rt.role === 'dormant') bg.setLight(i++, rt.node.pos.x, rt.node.pos.y, 3.2, 0.32);
    }
    while (i < 8) bg.setLight(i++, 0, 0, 1, 0);
  }

  /** adaptive resolution: if we cannot hold ~45fps for a while, trade pixels for smoothness */
  private monitor(dt: number) {
    const p = this.perf;
    p.acc += dt;
    p.n++;
    if (p.n < 120) return;
    const avg = p.acc / p.n;
    p.acc = 0;
    p.n = 0;
    if (avg > 1 / 42) p.bad++;
    else p.bad = Math.max(0, p.bad - 1);
    if (p.bad >= 2 && this.dpr > 1) {
      this.dpr = Math.max(1, this.dpr - 0.25);
      this.renderer.setPixelRatio(this.dpr);
      if (this.composer) this.composer.setSize(this.w, this.h);
      else this.renderer.setSize(this.w, this.h);
      this.ambient.u.uPx.value = this.dpr;
      p.bad = 0;
    }
  }
}
