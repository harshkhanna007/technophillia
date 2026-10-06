import * as THREE from 'three';
import gsap from 'gsap';
import {
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
} from 'postprocessing';
import { BranchMesh } from './BranchMesh';
import type { AnyUniform, Shared } from './BranchMesh';
import { AudioEngine } from './AudioEngine';
import { CameraRig } from './CameraRig';
import { Cursor } from './Cursor';
import type { CursorTarget, PointerState } from './Cursor';
import type { Framing } from './CameraRig';
import { detectQuality, LOOK, PROFILES, SEED_SCALE } from './config';
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
  /** the seed is awake and waiting to be clicked */
  ready: boolean;
  /** the seed has been clicked: the tree is growing or grown */
  started: boolean;
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
  /** the trunk every primary leaves from */
  stem: BranchMesh;
  /** decorative twigs that grow with the stem */
  ornaments: { mesh: BranchMesh; t: number }[];
  /** small twigs on each primary bough while it waits to be opened */
  twigs: { rt: NodeRT; mesh: BranchMesh; fade: number; delay: number }[];
}

interface EnergyJob {
  branch: BranchMesh;
  mode: 'grow' | 'pulse' | 'retract';
  t: number;
  color: THREE.Color;
}

const SEED_LIGHT = new THREE.Color('#5fd0ff');
const BLOOM_BASE = 1.7;
/** the closer you zoom on a node, the wider the view must stay once more of the tree is open (see frameFor) */
const ZOOM = { levelStep: 1.7, perOpen: 0.6, share: 0.55, cap: 0.8 };
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
  private cursor!: Cursor;
  private ptr: PointerState = { x: 0, y: 0, vx: 0, vy: 0, speed: 0, type: 'mouse', down: false, seen: false, inside: false };
  private ptrPrev = { x: 0, y: 0 };
  private ptrWorld = new THREE.Vector3();
  private tmpV = new THREE.Vector3();
  private pointerLive = false;
  private overUi = false;
  private trailAcc = 0;
  private cursorLight = 0;
  private lastInput = 0;
  private skipAcc = 0;
  private skipFlip = false;
  private coarse = false;
  private stemFlare = 0;
  private started = false;
  private ready = false;
  private lastInvite = 0;
  private flashes: { x: number; y: number; c: THREE.Color; age: number; dur: number; power: number; r: number }[] = [];
  private diving = false;
  private drag: { id: number; x: number; y: number; sx: number; sy: number; moved: boolean } | null = null;
  private touches = new Map<number, { x: number; y: number }>();
  private pinchPrev = 0;

  constructor(host: HTMLElement, private categories: CategoryData[]) {
    this.host = host;
    this.quality = detectQuality();
    this.profile = PROFILES[this.quality];
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.gctx = gsap.context(() => {});
    this.coarse = window.matchMedia('(pointer: coarse)').matches;
    this.cursor = new Cursor(this.reduced);
    this.lastInput = performance.now();

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      stencil: false,
      depth: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 1);
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

    this.setCameraLimits();
    this.rig.snap(this.seedFraming());
    this.rig.setTarget(this.seedFraming(), 0.42);
    this.syncRoles();
    this.emit();
    this.lastTime = performance.now();
    gsap.ticker.add(this.tick);
    if (process.env.NODE_ENV !== 'production' && window.location.search.includes('pump')) {
      // dev-only: keep frames flowing when the tab is occluded (automated screenshots)
      (window as unknown as { __gsap?: typeof gsap }).__gsap = gsap;
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
      ready: this.ready,
      started: this.started,
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
    this.lastInput = performance.now();
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
    if (!this.started) return this.begin();
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
    this.cursor.dispose();
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
    const root = new THREE.Color('#37d8ff');
    this.bg = new Background(this.shared, this.profile.bgLights);
    this.scene.add(this.bg.mesh);
    this.ambient = new AmbientParticles(this.shared, this.profile.particles, this.dpr, this.bg.u as { uLights: AnyUniform; uLightCol: AnyUniform }, this.profile.bgLights);
    this.scene.add(this.ambient.points);
    this.seed = new Seed(this.shared, root, new THREE.Color('#7b5cff'), new THREE.Color('#ffffff'));
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
    const sq = kind === 'portrait' ? { x: 0.5, y: 1.5 } : kind === 'square' ? { x: 0.86, y: 1.12 } : { x: 1, y: 1 };
    const model = buildTree(this.categories, { ...DEFAULT_LAYOUT, squashX: sq.x, squashY: sq.y, ring: kind === 'portrait' ? 10.5 : DEFAULT_LAYOUT.ring, flare: kind === 'portrait' ? 0.3 : DEFAULT_LAYOUT.flare });
    const markers = new NodeMarkers(model.nodes, this.shared);
    this.scene.add(markers.mesh);
    const group = new THREE.Group();
    this.scene.add(group);
    const stem = new BranchMesh(model.stemNode, { x: 0, y: 0 }, 0, { x: 0, y: 1 }, this.shared, model.stem);
    group.add(stem.group);
    const ornaments = model.ornaments.map((o) => {
      const mesh = new BranchMesh(o.node, { x: o.origin.x, y: o.origin.y }, 0, { x: o.origin.hx, y: o.origin.hy }, this.shared);
      group.add(mesh.group);
      return { mesh, t: o.t };
    });
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
    overlay.setObstacleSource(() => {
      const out: Float32Array[] = [];
      if (stem.group.visible) out.push(stem.obstacles);
      for (const o of ornaments) if (o.mesh.group.visible) out.push(o.mesh.obstacles);
      for (const rt of list) {
        const b = rt.branch;
        if (b && b.group.visible) out.push(b.obstacles);
      }
      return out;
    });
    return { kind, model, rts, list, markers, overlay, group, stem, ornaments, twigs: [] };
  }

  private destroyWorld() {
    const w = this.world;
    for (const rt of w.list) rt.branch?.dispose();
    w.stem.dispose();
    for (const o of w.ornaments) o.mesh.dispose();
    for (const t of w.twigs) t.mesh.dispose();
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
        intensity: BLOOM_BASE,
        luminanceThreshold: 0.34,
        luminanceSmoothing: 0.5,
        mipmapBlur: true,
        radius: 0.88,
        levels: this.quality === 'low' ? 5 : 8,
      });
      this.bloom = bloom;
      const effects: (BloomEffect | ChromaticAberrationEffect)[] = [bloom];
      if (p.chroma) {
        effects.push(
          new ChromaticAberrationEffect({
            offset: new THREE.Vector2(0.0008, 0.001),
            radialModulation: true,
            modulationOffset: 0.3,
          }),
        );
      }
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
      this.dragView(e);
      const p = this.ptr;
      p.x = e.clientX;
      p.y = e.clientY;
      p.type = e.pointerType || 'mouse';
      if (!p.seen) {
        p.seen = true;
        this.ptrPrev.x = p.x;
        this.ptrPrev.y = p.y;
      }
      p.inside = true;
      this.lastInput = performance.now();
    };
    window.addEventListener('pointermove', move, { passive: true });
    this.cleanups.push(() => window.removeEventListener('pointermove', move));

    const down = (e: PointerEvent) => {
      const p = this.ptr;
      p.x = e.clientX;
      p.y = e.clientY;
      p.type = e.pointerType || 'mouse';
      p.down = true;
      p.seen = true;
      p.inside = true;
      this.ptrPrev.x = p.x;
      this.ptrPrev.y = p.y;
      this.lastInput = performance.now();
      this.audio.unlock();
      const el = e.target as Element | null;
      const onUi = !!el?.closest?.('.nd__btn, .hud button');
      // empty space gets a ripple of light; nodes and HUD buttons already react on their own
      if (!onUi) {
        this.tapRipple(e.clientX, e.clientY);
        this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.touches.size === 1) this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
        else this.drag = null;
        this.pinchPrev = 0;
      }
    };
    const up = (e: PointerEvent) => {
      this.ptr.down = false;
      this.touches.delete(e.pointerId);
      if (this.drag?.id === e.pointerId) this.drag = null;
      if (this.touches.size < 2) this.pinchPrev = 0;
    };
    const wheel = (e: WheelEvent) => {
      if ((e.target as Element | null)?.closest?.('.hud')) return;
      e.preventDefault();
      this.lastInput = performance.now();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dy = Math.max(-240, Math.min(240, e.deltaY * unit));
      this.rig.camera.updateMatrixWorld();
      this.toWorld(e.clientX, e.clientY);
      this.rig.zoomAbout(Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0016)), this.ptrWorld.x, this.ptrWorld.y);
    };
    const dbl = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.('.nd__btn, .hud')) return;
      this.dive();
    };
    window.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('dblclick', dbl);
    const over = (e: PointerEvent) => {
      this.overUi = !!(e.target as Element | null)?.closest?.('button, a');
    };
    const leave = () => {
      this.ptr.inside = false;
    };
    window.addEventListener('pointerdown', down, { passive: true });
    window.addEventListener('pointerup', up, { passive: true });
    window.addEventListener('pointercancel', up, { passive: true });
    window.addEventListener('pointerover', over, { passive: true });
    document.documentElement.addEventListener('pointerleave', leave);
    const vis = () => this.audio.setHidden(document.hidden);
    document.addEventListener('visibilitychange', vis);
    this.cleanups.push(() => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('pointerover', over);
      document.documentElement.removeEventListener('pointerleave', leave);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('wheel', wheel);
      window.removeEventListener('dblclick', dbl);
    });

    const key = (e: KeyboardEvent) => {
      this.lastInput = performance.now();
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        this.back();
      } else if (e.key === 'Home') {
        this.home();
      } else if (e.key.toLowerCase() === 'm') {
        this.toggleMute();
      } else if (e.key.toLowerCase() === 'f') {
        this.dive();
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
      this.setCameraLimits();
      if (this.started) this.rig.setTarget(this.frameFor(this.path[this.path.length - 1] ?? null, 1, this.diving), 1.6);
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
    this.diving = false;
    this.setCameraLimits();
    if (this.started) {
      // the tree restarts fully germinated: the stem is already standing
      this.seed.u.uAppear.value = 1;
      this.seed.u.uSprout.value = 1;
      this.world.stem.ensureDetail(this.profile.detail);
      this.world.stem.progress = 1.2;
      this.world.stem.u.uGrow.value = 0;
      this.buildTwigs();
      this.rig.snap(this.frameFor(null));
      this.refreshBuds(true);
    } else {
      this.rig.snap(this.seedFraming());
    }
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

  /** the close-up the story opens on: the seed and the shoot leaving it */
  private seedFraming(close = true): Framing {
    const phone = this.world.kind === 'portrait';
    if (close) return { fx: 0, fy: 0.35, dist: phone ? 8.4 : 6.4 };
    return { fx: 0, fy: 1.45, dist: phone ? 11 : 8.6 };
  }

  /** a touch device feels motion more: landings are softened there */
  private get weight() {
    return this.coarse ? 0.62 : 1;
  }

  /** the camera may roam the whole tree, never far beyond it */
  private setCameraLimits() {
    const { model } = this.world;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const n of model.nodes) {
      x0 = Math.min(x0, n.pos.x);
      x1 = Math.max(x1, n.pos.x);
      y0 = Math.min(y0, n.pos.y);
      y1 = Math.max(y1, n.pos.y);
    }
    this.rig.setBounds(x0 - 5, x1 + 5, y0 - 4, y1 + 5);
    this.rig.minDist = 5.5;
    this.rig.maxDist = this.frameFor(null).dist * 1.35;
  }

  /** one clean tapered line, grown from a point at an angle: the building block of every twig */
  private makeTwig(id: string, A: { x: number; y: number; z: number }, a: number, len: number, curl: number, owner: TreeNode, depth: number): BranchMesh {
    const end = a + curl * 0.5;
    const node: TreeNode = {
      id,
      title: '',
      description: '',
      depth,
      index: 0,
      catIndex: owner.catIndex,
      parent: null,
      children: [],
      style: 'network',
      palette: { a: owner.palette.a.clone(), b: owner.palette.b.clone(), accent: owner.palette.accent.clone() },
      pos: { x: A.x + Math.cos(end) * len, y: A.y + Math.sin(end) * len + 0.3 * len * 0.25, z: 0 },
      angle: a + curl,
      side: Math.cos(a) >= 0 ? 'r' : 'l',
      leaves: 1,
      clearance: 2.2,
      number: '',
    };
    const mesh = new BranchMesh(node, { x: A.x, y: A.y }, A.z, { x: Math.cos(a), y: Math.sin(a) }, this.shared);
    mesh.setVisible(false);
    this.world.group.add(mesh.group);
    return mesh;
  }

  /** every primary bough forks into twigs that fork again: a branching system, not a single wire */
  private buildTwigs() {
    const w = this.world;
    if (w.twigs.length) return;
    const low = this.quality === 'low';
    w.model.primaries.forEach((p, pi) => {
      const rt = w.rts.get(p.id)!;
      const bough = this.branchFor(rt);
      const specs = [
        { t: 0.3, off: 0.95, len: 4.2, delay: 0.1 },
        { t: 0.5, off: 0.7, len: 3.5, delay: 0.25 },
        { t: 0.7, off: 0.5, len: 2.6, delay: 0.4 },
      ];
      specs.forEach((sp, k) => {
        const f = bough.sample(sp.t);
        const base = Math.atan2(f.ty, f.tx);
        // fork off on whichever side climbs
        const sign = Math.sin(base + 0.7) >= Math.sin(base - 0.7) ? 1 : -1;
        const a = base + sign * sp.off;
        const twig = this.makeTwig(`twig-${pi}-${k}`, f, a, sp.len, sign * 0.7, p, 5);
        w.twigs.push({ rt, mesh: twig, fade: 0, delay: sp.delay });
        if (low || k === 2) return;
        // each of the first two forks once more
        const g = twig.sample(0.58);
        const tb = Math.atan2(g.ty, g.tx);
        const s2 = Math.sin(tb + 0.8) >= Math.sin(tb - 0.8) ? 1 : -1;
        const sub = this.makeTwig(`twig-${pi}-${k}s`, g, tb + s2 * 0.8, sp.len * 0.5, s2 * 0.6, p, 6);
        w.twigs.push({ rt, mesh: sub, fade: 0, delay: sp.delay + 0.3 });
      });
    });
  }

  /** where a node's own branch starts: the fork on the stem for primaries, the parent otherwise */
  private startOf(node: TreeNode): { x: number; y: number } {
    if (node.depth === 1 && node.origin) return { x: node.origin.x, y: node.origin.y };
    return node.parent ? { x: node.parent.pos.x, y: node.parent.pos.y } : { x: 0, y: 0 };
  }

  private frameFor(node: TreeNode | null, zoomOut = 1, dive = false): Framing {
    const pts: { x: number; y: number }[] = [];
    const { model } = this.world;
    let padX: number;
    let padY: number;
    let minDist: number;
    const phone = this.world.kind === 'portrait';
    if (!node) {
      for (const n of model.primaries) pts.push(n.pos);
      pts.push({ x: 0, y: 0 });
      pts.push(model.stemNode.pos);
      // the whole silhouette: the twigs and the crown frame the picture too
      for (const o of model.ornaments) pts.push(o.node.pos);
      padX = 3.4;
      padY = 2.6;
      minDist = 14;
    } else {
      pts.push(node.pos);
      if (!phone) pts.push(this.startOf(node));
      for (const c of node.children) pts.push(c.pos);
      if (node.children.length === 0) {
        // leaf: leave breathing room beyond the node for its title
        const room = phone ? 1.6 : 3.2;
        pts.push({ x: node.pos.x + (node.side === 'r' ? room : -room), y: node.pos.y });
      }
      padX = phone ? (node.depth === 1 ? 1.9 : 1.6) : node.depth === 1 ? 2.6 : 2.1;
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
    if (node && !dive) f.dist = Math.max(f.dist, this.zoomFloor(node, padX, padY) * zoomOut);
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

  /**
   * The zoom budget. A node still frames tightly, as it always did, but the tightest allowed view
   * widens with every level you go down and every extra branch you have open, and never drops below a
   * share of the view that would hold everything open so far. The camera pans along the branch
   * instead of diving, so the tree around you stays readable. Wheel / pinch / F override this.
   */
  private zoomFloor(node: TreeNode, padX: number, padY: number): number {
    let x0 = node.pos.x;
    let x1 = node.pos.x;
    let y0 = node.pos.y;
    let y1 = node.pos.y;
    let open = 0;
    const take = (n: TreeNode) => {
      x0 = Math.min(x0, n.pos.x);
      x1 = Math.max(x1, n.pos.x);
      y0 = Math.min(y0, n.pos.y);
      y1 = Math.max(y1, n.pos.y);
    };
    for (const rt of this.world.list) {
      if (rt.grown && !rt.retracting && rt.node !== node) {
        take(rt.node);
        open++;
      }
    }
    for (const c of node.children) take(c);
    const depth = node.depth;
    const levels = 10.5 + ZOOM.levelStep * (depth - 1) + ZOOM.perOpen * Math.max(0, open - (depth - 1));
    const phone = this.world.kind === 'portrait';
    const all = this.rig.fit(x0, x1, y0, y1, padX, padY).dist * (phone ? 0.4 : ZOOM.share);
    const overview = this.frameFor(null).dist;
    return Math.min(Math.max(levels, all), overview * (phone ? 0.62 : ZOOM.cap));
  }

  private branchFor(rt: NodeRT): BranchMesh {
    if (rt.branch) return rt.branch;
    const node = rt.node;
    const parent = node.parent!;
    let A: P;
    let zA = 0;
    let heading: P;
    if (parent.depth === 0) {
      const o = node.origin ?? { x: 0, y: 0.6 * SEED_SCALE, hx: Math.sign(node.pos.x) * 0.8, hy: 0.6, t: 0 };
      heading = { x: o.hx, y: o.hy };
      A = { x: o.x, y: o.y };
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
        // declutter: only the nodes you can step to next keep a permanent label; the rest reveal theirs on hover
        const focusParent = deepest ? (deepest.children.length ? deepest : deepest.parent) : null;
        if (deepest && rt.node.parent !== focusParent) role = 'farbud';
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
  }

  /* ─────────────────────────── energy / fx ─────────────────────────── */
  private seedFlare() {
    this.g(() => {
      gsap.fromTo(this.seed.u.uFlare, { value: 0.0001 }, { value: 1, duration: 1.6 * this.speed(), ease: 'power2.out', overwrite: true });
      gsap.fromTo(this.seed.u.uEnergy, { value: 1 }, { value: 0, duration: 2.2, ease: 'power2.out', overwrite: true });
    });
  }

  /** coloured light thrown onto the black: it blooms outward from a point and fades, like a reflection */
  private flash(x: number, y: number, color: THREE.Color, power = 1, r = 9, dur = 1.9) {
    if (this.flashes.length > 5) this.flashes.shift();
    this.flashes.push({ x, y, c: color.clone(), age: 0, dur, power, r });
  }

  /** the whole picture swells with light for a moment */
  private bloomSurge(amount: number) {
    const bloom = this.bloom;
    if (!bloom || this.reduced) return;
    const o = { v: amount * this.weight };
    this.g(() =>
      gsap.to(o, {
        v: 0,
        duration: 1.5,
        ease: 'power3.out',
        overwrite: 'auto',
        onUpdate: () => {
          bloom.intensity = BLOOM_BASE + o.v;
        },
      }),
    );
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

  private stemPulseDur(primary: TreeNode) {
    const t = primary.origin?.t ?? 1;
    return ((this.world.stem.length * t) / LOOK.pulseSpeed + 0.12) * this.speed();
  }

  /** energy climbs the stem from the seed to the fork a primary leaves from */
  private stemPulse(tl: gsap.core.Timeline, primary: TreeNode, startAt: number): number {
    const b = this.world.stem;
    const t = primary.origin?.t ?? 1;
    const d = this.stemPulseDur(primary);
    tl.add(() => {
      b.u.uPulseAmp.value = 1;
      this.energy = { branch: b, mode: 'pulse', t: 0, color: primary.palette.accent };
      this.seedFlare();
    }, startAt);
    tl.fromTo(
      b.u.uPulse,
      { value: -0.05 },
      {
        value: t + 0.04,
        duration: d,
        ease: 'power1.in',
        onUpdate: () => {
          if (this.energy && this.energy.branch === b) this.energy.t = b.u.uPulse.value as number;
        },
        onComplete: () => {
          b.u.uPulseAmp.value = 0;
          b.u.uPulse.value = -1;
          this.stemFlare = 1;
          const o = primary.origin;
          if (o) {
            this.rings.fire(o.x, o.y, 0, primary.palette.a, 3.0, 1.1);
            this.flash(o.x, o.y, primary.palette.a, 0.8, 7, 1.4);
          }
          this.audio.tick();
        },
      },
      startAt,
    );
    return startAt + d;
  }

  /** pulse the stem up to `via`'s fork, then every existing branch of the chain from its seed end to its tip */
  private pulseChain(tl: gsap.core.Timeline, chain: TreeNode[], startAt: number, via?: TreeNode): number {
    let at = startAt;
    if (via) at = this.stemPulse(tl, via, at);
    for (const a of chain) {
      const art = this.world.rts.get(a.id)!;
      const b = art.branch;
      if (!b) continue;
      const d = (b.length / LOOK.pulseSpeed + 0.12) * this.speed();
      const state = { v: -0.05 };
      tl.add(() => {
        b.u.uPulseAmp.value = 1;
        this.energy = { branch: b, mode: 'pulse', t: 0, color: a.palette.accent };
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
    this.haptic(12);
    this.rings.fire(node.pos.x, node.pos.y, node.pos.z, node.palette.a, 3.6, 1.3);
    this.burstAt(node, 60, 3.6);
    this.flash(node.pos.x, node.pos.y, node.palette.a, 0.9, 7, 1.6);
    this.g(() => gsap.to(branch, { ghostProgress: 0, duration: 0.35, ease: 'power2.in', overwrite: true }));
    branch.progress = 0;
    branch.u.uGrow.value = 1;
    branch.u.uDim.value = 1;
    this.resetView();
    this.rig.setTarget(this.frameFor(node), 0.8 / sp);
    this.rig.followTarget = this.reduced ? 0 : 0.3;

    const tl = this.newTimeline();
    const pulseTotal = anc.reduce((s, a) => s + ((this.world.rts.get(a.id)?.branch?.length ?? 0) / LOOK.pulseSpeed + 0.12) * sp, this.stemPulseDur(chain[0]));
    this.audio.pulse(pulseTotal);
    const at = this.pulseChain(tl, anc, 0.1, chain[0]);
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
    this.flareNode(node, 2.6);
    this.rings.fire(node.pos.x, node.pos.y, node.pos.z, node.palette.a, 7.2, 2.3);
    this.rings.fire(node.pos.x, node.pos.y, node.pos.z, node.palette.accent, 4.2, 1.5);
    this.rings.fire(node.pos.x, node.pos.y, node.pos.z, node.palette.b, 10.5, 3.0);
    this.burstAt(node, 240, 6.4);
    this.flash(node.pos.x, node.pos.y, node.palette.a, 1.5, 11, 2.4);
    this.bloomSurge(1.3);
    this.audio.impact();
    this.haptic([10, 40, 18]);
    if (!this.reduced) {
      this.rig.impulse(-13 * this.weight);
      this.rig.shake((node.index % 2 ? 1 : -1) * 0.035 * this.weight);
    }
    this.rig.followTarget = 0;
    this.emit();
  }

  private ping(rt: NodeRT) {
    this.audio.select();
    this.flareNode(rt.node, 1.8);
    this.rings.fire(rt.node.pos.x, rt.node.pos.y, rt.node.pos.z, rt.node.palette.a, 4.6, 1.6);
    this.burstAt(rt.node, 80, 4.4);
    this.flash(rt.node.pos.x, rt.node.pos.y, rt.node.palette.a, 0.9, 8, 1.6);
    this.bloomSurge(0.5);
    this.world.overlay.revealTitle(rt.node.id, 1.6);
  }

  /** re-activate an already grown branch that is not on the current path */
  private navigate(node: TreeNode) {
    const chain = ancestry(node);
    this.audio.select();
    this.rings.fire(node.pos.x, node.pos.y, node.pos.z, node.palette.a, 2.2, 1);
    this.resetView();
    this.rig.setTarget(this.frameFor(node), 0.9 / this.speed());
    const tl = this.newTimeline();
    this.audio.pulse(0.9);
    const end = this.pulseChain(tl, chain, 0.05, chain[0]);
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
    this.resetView();
    this.rig.setTarget(this.frameFor(isHome ? null : anchor), 0.85 / this.speed());
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
  /** the seed fades in out of the dark and waits, softly pulsing, to be clicked */
  private intro() {
    const sp = this.speed();
    this.g(() => {
      gsap.to(this.seed.u.uAppear, { value: 1, duration: 3.2 * sp, ease: 'power2.out' });
      gsap.fromTo(this.bg.u.uReveal, { value: 0 }, { value: 1, duration: 4, ease: 'power1.inOut' });
      gsap.delayedCall(2.4 * sp, () => {
        this.ready = true;
        this.emit();
      });
    });
  }

  /** the click: the seed cracks, a shoot climbs out, the stem rises to its crown, then the six buds open */
  private begin() {
    if (this.started || this.destroyed) return;
    this.started = true;
    this.ready = true;
    const sp = this.speed();
    const stem = this.world.stem;
    stem.ensureDetail(this.profile.detail);
    this.buildTwigs();
    const climb = this.reduced ? 1.4 : 3.8;
    const start = 1.7 * sp;
    this.audio.select();
    this.haptic([10, 40, 18]);
    this.seedFlare();
    this.rings.fire(0, 0, 0.1, SEED_LIGHT, 5.5, 1.8);
    this.rings.fire(0, 0, 0.1, new THREE.Color('#9b8cff'), 9, 2.6);
    this.sparks.burst(0, 0, 0.1, 160, { speed: 4.6, size: 7, life: 1.8, color: SEED_LIGHT, hot: 0.5 });
    this.flash(0, 0, SEED_LIGHT, 1.8, 12, 2.8);
    this.bloomSurge(1.6);
    if (!this.reduced) this.rig.impulse(-9 * this.weight);
    this.rig.setTarget(this.seedFraming(false), 0.7);
    this.emit();
    this.g(() => {
      gsap.to(this.seed.u.uSprout, { value: 1, duration: 2.2 * sp, ease: 'power2.inOut' });
      gsap.delayedCall(start, () => {
        this.audio.grow(climb);
        this.seedFlare();
        this.stemFlare = 1;
        this.energy = { branch: stem, mode: 'grow', t: 0, color: SEED_LIGHT };
        this.flash(0, 1.2, SEED_LIGHT, 1.4, 9, 2.2);
        this.activity = 1;
        this.rig.followTarget = this.reduced ? 0 : 0.4;
        this.rig.setTarget(this.frameFor(null), 0.5);
        stem.progress = 0;
        gsap.to(stem, {
          progress: 1.2,
          duration: climb * 1.16,
          ease: growEase,
          onUpdate: () => {
            if (this.energy && this.energy.branch === stem) this.energy.t = stem.progress;
          },
          onComplete: () => {
            if (this.energy && this.energy.branch === stem) this.energy = null;
            this.rig.followTarget = 0;
          },
        });
      });
      gsap.delayedCall(start + climb * 0.78, () => this.refreshBuds());
      gsap.delayedCall(start + climb * 1.16 + 0.6, () => {
        this.introDone = true;
        this.audio.impact();
        const top = this.world.model.stemNode.pos;
        this.rings.fire(top.x, top.y, 0, SEED_LIGHT, 8, 2.4);
        this.flash(top.x, top.y, SEED_LIGHT, 1.3, 11, 2.4);
        this.bloomSurge(1.1);
        if (!this.reduced) {
          this.rig.impulse(-8 * this.weight);
          this.rig.shake(0.03 * this.weight);
        }
        this.emit();
      });
    });
  }

  /** back to the auto camera (and out of a manual dive) whenever the story moves to another level */
  private resetView() {
    this.rig.resetView();
    this.diving = false;
  }

  /** F / double-click: dive in to the original tight close-up on the current branch, again to come back */
  private dive() {
    const cur = this.path[this.path.length - 1];
    if (!cur) return;
    this.rig.resetView();
    this.diving = !this.diving;
    this.rig.setTarget(this.frameFor(cur, 1, this.diving), 1.3);
  }

  /* ─────────────────────────── pointer, cursor, touch ─────────────────────────── */
  /** one pointer drags the view, two pinch it: free zoom + pan on top of the auto camera */
  private dragView(e: PointerEvent) {
    if (!this.touches.has(e.pointerId)) return;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchPrev > 0 && d > 8) {
        this.rig.camera.updateMatrixWorld();
        this.toWorld((a.x + b.x) / 2, (a.y + b.y) / 2);
        this.rig.zoomAbout(this.pinchPrev / d, this.ptrWorld.x, this.ptrWorld.y);
      }
      this.pinchPrev = d;
      this.drag = null;
      return;
    }
    const dr = this.drag;
    if (!dr || dr.id !== e.pointerId) return;
    if (!dr.moved && Math.hypot(e.clientX - dr.sx, e.clientY - dr.sy) < 7) return;
    dr.moved = true;
    const k = (this.rig.halfView(this.rig.tDist).hh * 2) / this.h;
    this.rig.panBy(-(e.clientX - dr.x) * k, (e.clientY - dr.y) * k);
    dr.x = e.clientX;
    dr.y = e.clientY;
  }

  private haptic(pattern: number | number[]) {
    if (this.coarse && !this.reduced && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch {
        /* not permitted */
      }
    }
  }

  /** pointer position projected onto the z=0 plane of the tree */
  private toWorld(cx: number, cy: number) {
    const cam = this.rig.camera;
    this.tmpV
      .set((cx / this.w) * 2 - 1, -((cy / this.h) * 2 - 1), 0.5)
      .unproject(cam)
      .sub(cam.position)
      .normalize();
    const t = -cam.position.z / this.tmpV.z;
    this.ptrWorld.set(cam.position.x + this.tmpV.x * t, cam.position.y + this.tmpV.y * t, 0);
  }

  private pointerColor(): THREE.Color {
    const rt = this.hoverId ? this.world.rts.get(this.hoverId) : null;
    if (rt && rt.node.depth > 0) return rt.node.palette.a;
    const cur = this.path[this.path.length - 1];
    return cur ? cur.palette.a : SEED_LIGHT;
  }

  private tapRipple(cx: number, cy: number) {
    this.toWorld(cx, cy);
    const c = this.pointerColor();
    this.rings.fire(this.ptrWorld.x, this.ptrWorld.y, 0.1, c, 1.5, 0.85);
    if (!this.reduced) {
      this.sparks.burst(this.ptrWorld.x, this.ptrWorld.y, 0.1, 14, { speed: 1.8, size: 3.6, life: 0.8, color: c, hot: 0.4 });
    }
  }

  private updatePointer(dt: number) {
    const p = this.ptr;
    const dx = p.x - this.ptrPrev.x;
    const dy = p.y - this.ptrPrev.y;
    this.ptrPrev.x = p.x;
    this.ptrPrev.y = p.y;
    const k = 1 - Math.exp(-dt * 12);
    p.vx += (dx / dt - p.vx) * k;
    p.vy += (dy / dt - p.vy) * k;
    p.speed = Math.hypot(p.vx, p.vy);

    const live = p.type === 'touch' ? p.down : p.seen && p.inside;
    this.pointerLive = live;
    const color = this.pointerColor();
    if (live) {
      this.rig.camera.updateMatrixWorld();
      this.toWorld(p.x, p.y);
      if (!this.reduced) {
        // a thread of light trails the pointer, denser the faster it moves
        this.trailAcc = Math.min(6, this.trailAcc + dt * Math.min(80, p.speed * 0.04) * (p.type === 'touch' ? 0.8 : 1));
        const n = Math.min(3, Math.floor(this.trailAcc));
        if (n > 0) {
          this.trailAcc -= n;
          this.sparks.burst(this.ptrWorld.x, this.ptrWorld.y, 0.15, n, {
            speed: 0.55,
            size: 3.4,
            life: 0.75,
            color,
            hot: 0.3,
            dir: { x: -dx, y: dy },
            spread: 1.5,
          });
        }
      }
    } else this.trailAcc = 0;
    const lt = live ? (this.hoverId ? 0.9 : 0.45) : 0;
    this.cursorLight += (lt - this.cursorLight) * (1 - Math.exp(-dt * 8));

    // the visible cursor (mouse / pen only)
    let target: CursorTarget | null = null;
    const rt = this.hoverId ? this.world.rts.get(this.hoverId) : null;
    if (rt && rt.role !== 'hidden') {
      const sp = this.world.overlay.screenOf(rt.node.id);
      if (sp) target = { x: sp.x, y: sp.y, kind: 'node' };
    } else if (this.overUi) target = { x: p.x, y: p.y, kind: 'ui' };
    this.cursor.update(dt, p, target, '#' + color.getHexString(THREE.SRGBColorSpace));
  }

  /* ─────────────────────────── frame ─────────────────────────── */
  private tick = () => {
    if (this.destroyed || this.contextLost) return;
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.0005, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.skipAcc += dt;
    // battery: on non-flagship devices an idle scene renders every other frame (still 30fps)
    if (this.quality !== 'high' && this.introDone && !this.busy && !this.ptr.down && now - this.lastInput > 2500) {
      this.skipFlip = !this.skipFlip;
      if (this.skipFlip) return;
    }
    const d = Math.min(0.066, this.skipAcc);
    this.skipAcc = 0;
    this.frame(d);
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

    // ── the stem: always standing once grown, lit by the energy that climbs it
    const st = w.stem;
    const stAlive = st.progress > 0.0005;
    st.setVisible(stAlive);
    if (stAlive) {
      this.stemFlare *= fd;
      st.u.uDim.value = (this.path.length ? 0.62 : 0.88) + this.stemFlare * 0.3;
      st.u.uBoost.value = 1 + (this.seed.u.uHover.value as number) * 0.3 + this.stemFlare * 0.4;
      st.u.uIdle.value = 1;
      if (st.progress >= 1.19) st.u.uGrow.value += (0 - st.u.uGrow.value) * (1 - Math.exp(-dt * 3));
    }

    // ── ornamental boughs follow the stem's growth, drawn as clean tapered lines
    for (const o of w.ornaments) {
      const p = clamp((st.progress - o.t) / 0.18, 0, 1);
      const m = o.mesh;
      m.ghostProgress = p;
      m.setVisible(p > 0.0005);
      m.setGhostDim(0.95 + this.stemFlare * 0.4);
      m.setGhostBoost(1.7);
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      this.flashes[i].age += dt;
      if (this.flashes[i].age > this.flashes[i].dur) this.flashes.splice(i, 1);
    }

    // twigs on each waiting bough: they grow outward with the bud and rest once the branch is opened
    for (const tw of w.twigs) {
      const rt = tw.rt;
      const target = rt.visT > 0.5 && !rt.grown && !rt.pending && !rt.retracting ? 1 : 0;
      tw.fade += (target - tw.fade) * (1 - Math.exp(-dt * (target ? 1.1 : 5)));
      const g = clamp((tw.fade - tw.delay) / (1 - tw.delay), 0, 1);
      tw.mesh.ghostProgress = g;
      tw.mesh.setVisible(g > 0.0005);
      tw.mesh.setGhostDim(0.9);
      tw.mesh.setGhostBoost(1.4 + rt.hov * 1.0);
    }

    // while the seed waits, a soft ripple reminds you it is the way in
    if (!this.started && this.ready && time - this.lastInvite > 5.2) {
      this.lastInvite = time;
      this.seedFlare();
    }

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
    this.updatePointer(dt);
    const cam = this.rig.camera;
    this.bg.mesh.position.x = this.rig.focus.x;
    this.bg.mesh.position.y = this.rig.focus.y;
    (this.bg.u.uFocus.value as THREE.Vector2).set(this.rig.focus.x, this.rig.focus.y);
    (this.ambient.u.uCenter.value as THREE.Vector3).set(this.rig.focus.x, this.rig.focus.y, 0);
    this.updateLights();

    // ── dom
    w.overlay.update(cam, this.w, this.h);

    // ── render
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, cam);

    this.monitor(dt);
  }

  private updateLights() {
    const bg = this.bg;
    // the last light slot always belongs to the cursor, everything else stays below it
    const cap = Math.min(8, this.profile.bgLights) - 1;
    let i = 0;
    const seedE = 0.7 + (this.seed.u.uEnergy.value as number) * 1.1;
    bg.setLight(i++, 0, 0, 4.2, seedE, SEED_LIGHT);
    const job = this.energy;
    if (job && (this.orb.u.uAmp.value as number) > 0.05 && i < cap) {
      const o = this.orb.u.uPos.value as THREE.Vector3;
      bg.setLight(i++, o.x, o.y, 7.5, 2.7 * (this.orb.u.uAmp.value as number), job.color);
    }
    for (const f of this.flashes) {
      if (i >= cap) break;
      const k = f.age / f.dur;
      const rise = 1 - Math.pow(1 - Math.min(1, k * 2.2), 3);
      bg.setLight(i++, f.x, f.y, f.r * (0.45 + 0.75 * rise), f.power * 3.4 * Math.pow(1 - k, 1.7), f.c);
    }
    const cur = this.path[this.path.length - 1];
    if (cur && i < cap) bg.setLight(i++, cur.pos.x, cur.pos.y, 8, 1.3, cur.palette.a);
    for (let k = this.path.length - 2; k >= 0 && i < cap; k--) {
      const n = this.path[k];
      bg.setLight(i++, n.pos.x, n.pos.y, 6, 0.8, n.palette.a);
    }
    for (const rt of this.world.list) {
      if (i >= cap) break;
      if (rt.role === 'dormant') bg.setLight(i++, rt.node.pos.x, rt.node.pos.y, 5, 0.5, rt.node.palette.a);
    }
    // buds on the tree throw a faint tint of their own colour onto the dark
    if (!this.path.length) {
      for (const rt of this.world.list) {
        if (i >= cap) break;
        if (rt.role === 'rootbud') bg.setLight(i++, rt.node.pos.x, rt.node.pos.y, 3.4, 0.3 * rt.vis, rt.node.palette.a);
      }
    }
    while (i < cap) bg.setLight(i++, 0, 0, 1, 0);
    // the pointer is a small lamp: it reveals the circuitry under it
    bg.setLight(cap, this.ptrWorld.x, this.ptrWorld.y, 2.4, this.cursorLight, this.pointerColor());
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
