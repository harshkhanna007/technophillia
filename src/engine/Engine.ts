import * as THREE from 'three';
import gsap from 'gsap';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
} from 'postprocessing';
import { BranchMesh } from './BranchMesh';
import type { Shared } from './BranchMesh';
import { AudioEngine } from './AudioEngine';
import { CameraRig } from './CameraRig';
import { Occupancy } from './clearance';
import { Foliage } from './Foliage';
import type { FoliageSource } from './Foliage';
import { Moments } from './Moments';
import { Rng } from './rng';
import { Cursor } from './Cursor';
import type { CursorTarget, PointerState } from './Cursor';
import type { Framing } from './CameraRig';
import { LOOK, LOOK_PROFILE, maxDpr, SEED_SCALE } from './config';
import { AmbientParticles, Background, EnergyOrb, NodeLeaves, NodeMarkers, Seed, ShockRings, Sparks } from './Fx';
import { ancestry, buildTree, DEFAULT_LAYOUT, isDescendant } from './layout';
import type { TreeModel } from './layout';
import { Overlay } from './Overlay';
import type { NodeRole } from './Overlay';
import { generateTrunk } from './trunk';
import type { P, Trunk } from './trunk';
import { facts } from '@/data/facts';
import { Blossoms } from './Blossoms';
import { loadProgress, saveProgress } from './progress';
import { SIGNATURE } from './signature';
import type { BranchIndexItem, CategoryData, FinaleState, RevealState, TreeNode } from './types';

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
  /** the card for the active node, once its own moment has played */
  reveal: RevealState | null;
  /** a branch (or the whole tree) was just completed */
  finale: FinaleState | null;
  /** the six branches with how much of each is open: the index */
  index: BranchIndexItem[];
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
  leaves: NodeLeaves;
  overlay: Overlay;
  group: THREE.Group;
  /** the trunk every primary leaves from */
  stem: BranchMesh;
  /** decorative twigs that grow with the stem (`leaf` = their group in the foliage) */
  ornaments: { mesh: BranchMesh; t: number; leaf: number }[];
  /** small twigs on each primary bough while it waits to be opened */
  twigs: { rt: NodeRT; mesh: BranchMesh; fade: number; delay: number; leaf: number }[];
  /** every strand that stands in the open: new twigs and leaves steer clear of it */
  occ: Occupancy;
  /** leaves on the twigs and ornaments; built together with the twigs */
  foliage: Foliage | null;
  /** flowers on the same twigs: they open when a branch is finished */
  blossoms: Blossoms | null;
}

/** how close two strands may come, and how much of a twig next to its parent is exempt from that rule */
const GAP = 0.38;
const FREE = 1.1;
/** a finale plays the node's own signature moment this much bigger and slower */
const FINALE = { scale: 1.9, stretch: 1.35 };

interface EnergyJob {
  branch: BranchMesh;
  mode: 'grow' | 'pulse' | 'retract';
  t: number;
  color: THREE.Color;
}

const WHITE = new THREE.Color('#ffffff');
const SEED_LIGHT = new THREE.Color('#5fd0ff');
const BLOOM_BASE = 1.7;
/** the closer you zoom on a node, the wider the view must stay once more of the tree is open (see frameFor) */
const ZOOM = { levelStep: 1.7, perOpen: 0.6, share: 0.55, cap: 0.8 };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const hexOf = (c: THREE.Color) => '#' + c.getHexString(THREE.SRGBColorSpace);
const growEase = (p: number) => 0.32 * p + 0.68 * (p * p * (3 - 2 * p));

export class Engine {
  private host: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private scene = new THREE.Scene();
  private rig: CameraRig;
  private shared: Shared;
  private profile = LOOK_PROFILE;
  /** the canvas pixel ratio right now, and the sharpest this screen may reach (see monitor) */
  private dpr: number;
  private dprMax: number;
  /** a pixel ratio this device was found unable to hold (Infinity until then) */
  private ceil = Infinity;
  /** `?dpr=0.75` pins the resolution (testing) */
  private pinned = false;
  private reduced: boolean;
  private audio = new AudioEngine();
  private gctx: gsap.Context;

  private bg!: Background;
  private ambient!: AmbientParticles;
  private sparks!: Sparks;
  private seed!: Seed;
  private orb!: EnergyOrb;
  private rings!: ShockRings;
  private moments!: Moments;
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
  private drs = newDrs();
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
  private warming = false;
  /** a device with few cores or little memory: its click effects start light instead of waiting to be measured */
  private weak = (navigator.hardwareConcurrency || 4) <= 4 || ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4;
  private lastDrawn = 0;
  /** drawing every other frame because the device cannot hold 60 (see monitor) */
  private half = false;
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
  /** the keyboard cursor: a virtual pointer that glides to the focused node, so keyboard focus gets the same light as the mouse */
  private kbPtr = { x: 0, y: 0, vx: 0, vy: 0, ready: false };
  private hoverViaKey = false;
  private indexOpen = false;
  /** the cards you have seen, in order: N and P walk through them, like pages */
  private trail: string[] = [];
  private trailPos = -1;
  private trailTarget: string | null = null;
  /** the hover comes from the card's hook: the light stays on the button (`hoverAt` when the keyboard holds it) while the node it points at glows */
  private hoverUi = false;
  private hoverAt: { x: number; y: number } | null = null;
  private kbPressUntil = 0;
  private ptrMode: 'mouse' | 'key' = 'mouse';
  /** what has been opened, which branches have had their finale, and how many nodes each branch has */
  private visited = new Set<string>();
  private done = new Set<number>();
  private totals: number[] = [];
  private reveal: RevealState | null = null;
  private finale: FinaleState | null = null;
  private revealSeq = 0;
  private finaleSeq = 0;
  /** each branch's bloom wave (0..1), and the one that sweeps the whole tree */
  private bloomCat: { v: number }[] = [];
  private bloomAll = { v: 0 };
  /** branches whose twigs stay on show while their finale plays */
  private finaleKeep = new Set<number>();
  /** where the HUD has put the reveal card, so node labels keep clear of it */
  private cardBox: { side: 'l' | 'r' | 'b'; w: number; h: number } | null = null;

  constructor(host: HTMLElement, private categories: CategoryData[]) {
    this.host = host;
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
    this.w = Math.max(1, host.clientWidth);
    this.h = Math.max(1, host.clientHeight);
    // every device gets the same picture; only its sharpness is negotiated. Start modest and sharpen while the frame rate holds.
    this.dprMax = maxDpr(this.w, this.h);
    // phones are small but dense: they get the sharp ratio their pixel budget allows; the monitor steps down if they cannot hold it
    this.dpr = this.dprMax;
    this.setLite(true);
    const qs = new URLSearchParams(window.location.search);
    const pin = Number(qs.get('dpr'));
    if (pin > 0) {
      this.dpr = this.dprMax = clamp(pin, 0.25, 3);
      this.pinned = true;
    }
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.w, this.h);
    const canvas = this.renderer.domElement;
    canvas.className = 'stage';
    host.appendChild(canvas);

    this.rig = new CameraRig(LOOK.fov, this.w / this.h);
    this.rig.reduced = this.reduced;
    this.shared = { uTime: { value: 0 }, uDpr: { value: this.dpr }, quad: new THREE.PlaneGeometry(2, 2) };

    this.buildFx();
    this.world = this.buildWorld(this.layoutKind());
    this.initProgress();
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
      reveal: this.reveal,
      finale: this.finale,
      index: this.world
        ? this.world.model.primaries.map((p, c) => ({
            id: p.id,
            title: p.title,
            a: hexOf(p.palette.a),
            b: hexOf(p.palette.b),
            opened: this.countVisited(c),
            total: this.totals[c] ?? 0,
            done: this.done.has(c),
          }))
        : [],
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
    // pressing Enter on a node dips the light, like a click
    if (this.hoverViaKey) this.kbPressUntil = performance.now() + 240;
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
    this.moments.dispose();
    this.shared.quad.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.audio.dispose();
    this.listeners.clear();
    delete document.documentElement.dataset.q;
  }

  /* ─────────────────────────── construction ─────────────────────────── */
  private buildFx() {
    const root = new THREE.Color('#37d8ff');
    this.bg = new Background(this.shared, this.profile.bgLights);
    this.scene.add(this.bg.mesh);
    this.ambient = new AmbientParticles(this.shared, this.profile.particles, this.dpr, this.bg.lightU, this.profile.bgLights);
    this.scene.add(this.ambient.points);
    this.seed = new Seed(this.shared, root, new THREE.Color('#7b5cff'), new THREE.Color('#ffffff'));
    this.scene.add(this.seed.mesh);
    this.sparks = new Sparks(this.shared, this.profile.sparks, this.dpr);
    this.scene.add(this.sparks.points);
    this.orb = new EnergyOrb(this.shared);
    this.scene.add(this.orb.mesh);
    this.rings = new ShockRings(this.shared);
    this.scene.add(this.rings.group);
    this.moments = new Moments(this.shared, this.profile.moments);
    this.scene.add(this.moments.group);
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
    const leaves = new NodeLeaves(model.nodes, this.shared, { leaves: this.profile.leaves, sway: !this.reduced });
    this.scene.add(leaves.mesh);
    const group = new THREE.Group();
    this.scene.add(group);
    const stem = new BranchMesh(model.stemNode, { x: 0, y: 0 }, 0, { x: 0, y: 1 }, this.shared, model.stem);
    group.add(stem.group);
    // everything that already stands: the stem and every bough. Ornaments and twigs are fitted around it.
    const occ = new Occupancy(0.4);
    occ.add('stem', model.stem.pts);
    for (const p of model.primaries) {
      const o = p.origin!;
      occ.add(p.id, generateTrunk(p, { x: o.x, y: o.y }, 0, { x: o.hx, y: o.hy }, new Rng(p.id + ':trunk')).pts);
    }
    const ornaments: World['ornaments'] = [];
    const kept: TreeModel['ornaments'] = [];
    for (const o of model.ornaments) {
      const trunk = this.settleOrnament(o, occ);
      if (!trunk) continue;
      const mesh = new BranchMesh(o.node, { x: o.origin.x, y: o.origin.y }, 0, { x: o.origin.hx, y: o.origin.hy }, this.shared, trunk);
      group.add(mesh.group);
      ornaments.push({ mesh, t: o.t, leaf: -1 });
      kept.push(o);
    }
    model.ornaments = kept;
    const overlay = new Overlay(this.host, model.nodes, {
      select: (id) => this.select(id),
      hover: (id, viaKey) => this.setHover(id, viaKey),
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
    return { kind, model, rts, list, markers, leaves, overlay, group, stem, ornaments, twigs: [], occ, foliage: null, blossoms: null };
  }

  /**
   * An ornament keeps the place the layout gave it unless that would cross something standing. Then it tries a
   * small nudge, a shorter reach, and finally the other side of the stem; if nothing is clear it is left out.
   */
  private settleOrnament(o: TreeModel['ornaments'][number], occ: Occupancy): Trunk | null {
    const { node, origin } = o;
    const A = { x: origin.x, y: origin.y };
    const reach = { x: node.pos.x - A.x, y: node.pos.y - A.y };
    const angle = node.angle;
    for (const mirror of [1, -1]) {
      node.angle = mirror === 1 ? angle : Math.PI - angle;
      const heading = { x: origin.hx * mirror, y: origin.hy };
      for (const k of [1, 0.88, 0.76, 0.64, 0.52, 0.42]) {
        for (const rot of [0, 0.12, -0.12, 0.24, -0.24]) {
          const c = Math.cos(rot);
          const s = Math.sin(rot);
          const rx = reach.x * mirror;
          node.pos = { x: A.x + (rx * c - reach.y * s) * k, y: A.y + (rx * s + reach.y * c) * k, z: 0 };
          const trunk = generateTrunk(node, A, 0, heading, new Rng(node.id + ':trunk'));
          if (occ.clashes(trunk.pts, node.id, GAP, A, FREE)) continue;
          occ.add(node.id, trunk.pts);
          origin.hx = heading.x;
          if (mirror === -1) node.side = node.side === 'r' ? 'l' : 'r';
          return trunk;
        }
      }
    }
    node.angle = angle;
    return null;
  }

  private destroyWorld() {
    const w = this.world;
    for (const rt of w.list) rt.branch?.dispose();
    w.stem.dispose();
    for (const o of w.ornaments) o.mesh.dispose();
    for (const t of w.twigs) t.mesh.dispose();
    if (w.foliage) {
      w.foliage.dispose();
      this.scene.remove(w.foliage.mesh);
    }
    if (w.blossoms) {
      w.blossoms.dispose();
      this.scene.remove(w.blossoms.mesh);
    }
    w.markers.dispose();
    this.scene.remove(w.markers.mesh);
    w.leaves.dispose();
    this.scene.remove(w.leaves.mesh);
    this.scene.remove(w.group);
    w.overlay.dispose();
  }

  private setupPost() {
    try {
      // the picture is built in half-float so bright glows keep their colour; a GPU that cannot render to half-float
      // gets 8-bit buffers with dithering, which looks the same once it is on screen
      const hdr = this.renderer.extensions.has('EXT_color_buffer_half_float') || this.renderer.extensions.has('EXT_color_buffer_float');
      const composer = new EffectComposer(this.renderer, {
        frameBufferType: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
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
        levels: 6,
      });
      this.bloom = bloom;
      const effectPass = new EffectPass(this.rig.camera, bloom);
      effectPass.dithering = !hdr;
      composer.addPass(effectPass);
      this.composer = composer;
      this.sizePost();
    } catch (e) {
      console.warn('[technophilia] post-processing unavailable, rendering directly', e);
      this.composer = null;
    }
  }

  /** the canvas changed size: resize the post buffers, and keep the bloom's pyramid no deeper than the picture is wide */
  private sizePost() {
    const c = this.composer;
    if (!c) return;
    c.setSize(this.w, this.h);
    const levels = clamp(Math.floor(Math.log2(Math.min(this.w, this.h) * this.dpr)) - 1, 4, 8);
    if (this.bloom && this.bloom.mipmapBlurPass.levels !== levels) this.bloom.mipmapBlurPass.levels = levels;
  }

  private bindEvents() {
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.host);
    this.cleanups.push(() => ro.disconnect());

    const move = (e: PointerEvent) => {
      this.rig.pTarget.set((e.clientX / this.w) * 2 - 1, -((e.clientY / this.h) * 2 - 1));
      this.dragView(e);
      const p = this.ptr;
      const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
      p.x = e.clientX;
      p.y = e.clientY;
      p.type = e.pointerType || 'mouse';
      if (!p.seen) {
        p.seen = true;
        this.ptrPrev.x = p.x;
        this.ptrPrev.y = p.y;
      }
      p.inside = true;
      // the mouse takes the light back as soon as it really moves
      if (this.hoverViaKey && moved > 2) this.hoverViaKey = false;
      this.lastInput = performance.now();
    };
    window.addEventListener('pointermove', move, { passive: true });
    this.cleanups.push(() => window.removeEventListener('pointermove', move));

    const down = (e: PointerEvent) => {
      this.hoverViaKey = false;
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
    const vis = () => {
      this.audio.setHidden(document.hidden);
      // a throttled background tab is not a slow GPU: start the frame-rate watch afresh when it comes back
      this.drs = newDrs(this.drs);
    };
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
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      this.lastInput = performance.now();
      const k = e.key;
      // a focused control (a node, a crumb, the sound switch) already answers Enter and Space itself
      const onControl = (e.target as Element | null)?.closest?.('button, a') != null;
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (k === 'Escape' || k === 'Backspace') {
        e.preventDefault();
        this.back();
      } else if (k === 'Home') {
        this.home();
      } else if (k in arrows) {
        e.preventDefault();
        this.keyMove(arrows[k][0], arrows[k][1]);
      } else if ((k === 'Enter' || k === ' ') && !onControl) {
        e.preventDefault();
        this.keyOpen();
      } else if (k.toLowerCase() === 'n' && !e.repeat) {
        this.keyCard(1);
      } else if (k.toLowerCase() === 'p' && !e.repeat) {
        this.keyCard(-1);
      } else if (/^[1-6]$/.test(k) && !e.repeat) {
        this.keyBranch(Number(k) - 1);
      } else if (k === '+' || k === '=') {
        this.keyZoom(0.8);
      } else if (k === '-' || k === '_') {
        this.keyZoom(1.25);
      } else if (k.toLowerCase() === 'm') {
        this.toggleMute();
      } else if (k.toLowerCase() === 'f') {
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
    // a bigger window may not fit the pixel budget at the current ratio
    this.dprMax = Math.min(maxDpr(w, h), this.ceil);
    if (this.dpr > this.dprMax) this.setDpr(this.dprMax);
    if (this.composer) this.sizePost();
    else this.renderer.setSize(w, h);
    this.rig.setAspect(w / h);
    const kind = this.layoutKind();
    if (kind !== this.world.kind) {
      this.rebuildWorld(kind);
    } else {
      this.setCameraLimits();
      this.applyCardBox();
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
    this.reveal = null;
    this.finale = null;
    this.finaleKeep.clear();
    this.applyCardBox();
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

  /** the node a twig is drawn from: one clean tapered line, grown from a point at an angle */
  private twigNode(id: string, A: { x: number; y: number }, a: number, len: number, curl: number, owner: TreeNode, depth: number): TreeNode {
    const end = a + curl * 0.5;
    return {
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
  }

  /**
   * A twig that keeps clear of everything standing. It tries the angle it was given, small nudges of it, the
   * other side of its parent, and ever shorter reaches; if nothing is clear the twig is simply not grown.
   */
  private fitTwig(id: string, A: { x: number; y: number; z: number }, base: number, sign: number, off: number, len: number, curl: number, owner: TreeNode, depth: number): BranchMesh | null {
    const { occ, group } = this.world;
    const tries: [number, number][] = [
      [sign, off],
      [sign, off * 0.78],
      [sign, off * 1.22],
      [-sign, off],
    ];
    for (const k of [1, 0.85, 0.7, 0.56, 0.44]) {
      for (const [sg, o] of tries) {
        const a = base + sg * o;
        const node = this.twigNode(id, A, a, len * k, sg * curl, owner, depth);
        const heading = { x: Math.cos(a), y: Math.sin(a) };
        const trunk = generateTrunk(node, A, A.z, heading, new Rng(id + ':trunk'));
        if (occ.clashes(trunk.pts, id, GAP, A, FREE)) continue;
        occ.add(id, trunk.pts);
        const mesh = new BranchMesh(node, { x: A.x, y: A.y }, A.z, heading, this.shared, trunk);
        mesh.setVisible(false);
        group.add(mesh.group);
        return mesh;
      }
    }
    return null;
  }

  /** every primary bough forks into twigs that fork again: a branching system, not a single wire */
  private buildTwigs() {
    const w = this.world;
    if (w.foliage) return;
    const specs = [
      { t: 0.3, off: 0.95, len: 4.2, delay: 0.1 },
      { t: 0.5, off: 0.7, len: 3.5, delay: 0.25 },
      { t: 0.7, off: 0.5, len: 2.6, delay: 0.4 },
    ];
    // every bough's own twigs first, then the forks of those: a fork gives way to a twig, never the other way round
    const forks: { rt: NodeRT; p: TreeNode; pi: number; k: number; len: number; delay: number; twig: BranchMesh }[] = [];
    w.model.primaries.forEach((p, pi) => {
      const rt = w.rts.get(p.id)!;
      const bough = this.branchFor(rt);
      specs.forEach((sp, k) => {
        const f = bough.sample(sp.t);
        const base = Math.atan2(f.ty, f.tx);
        // fork off on whichever side climbs
        const sign = Math.sin(base + 0.7) >= Math.sin(base - 0.7) ? 1 : -1;
        const twig = this.fitTwig(`twig-${pi}-${k}`, f, base, sign, sp.off, sp.len, 0.7, p, 5);
        if (!twig) return;
        w.twigs.push({ rt, mesh: twig, fade: 0, delay: sp.delay, leaf: -1 });
        if (k < 2) forks.push({ rt, p, pi, k, len: sp.len, delay: sp.delay, twig });
      });
    });
    for (const { rt, p, pi, k, len, delay, twig } of forks) {
      // each of the first two forks once more
      const g = twig.sample(0.58);
      const tb = Math.atan2(g.ty, g.tx);
      const s2 = Math.sin(tb + 0.8) >= Math.sin(tb - 0.8) ? 1 : -1;
      const sub = this.fitTwig(`twig-${pi}-${k}s`, g, tb, s2, 0.8, len * 0.5, 0.6, p, 6);
      if (sub) w.twigs.push({ rt, mesh: sub, fade: 0, delay: delay + 0.3, leaf: -1 });
    }

    // leaves, in the colours of the branch each one grows on
    const sources: FoliageSource[] = [];
    for (const o of w.ornaments) {
      o.leaf = sources.length;
      sources.push({ id: o.mesh.node.id, trunk: o.mesh.trunk, palette: o.mesh.node.palette });
    }
    for (const t of w.twigs) {
      t.leaf = sources.length;
      sources.push({ id: t.mesh.node.id, trunk: t.mesh.trunk, palette: t.mesh.node.palette });
    }
    w.foliage = new Foliage(sources, this.shared, w.occ, { sway: !this.reduced, density: 1 });
    this.scene.add(w.foliage.mesh);
    w.blossoms = new Blossoms(sources, this.shared, w.occ, { sway: !this.reduced, density: 1 });
    this.scene.add(w.blossoms.mesh);
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

  private setHover(id: string | null, viaKey = false, ui = false, at: { x: number; y: number } | null = null) {
    this.hoverViaKey = viaKey && id !== null;
    this.hoverUi = ui && id !== null;
    this.hoverAt = this.hoverUi ? at : null;
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
        this.audio.hover(rt.node.style, rt.node.index);
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

  /**
   * How much of each burst of effects to play: 1 on any device that holds full resolution, less as the canvas has had to
   * drop below it. The burst is what a node opening costs all at once, so a device already short of pixels gets a lighter one.
   */
  private fx() {
    if (this.weak) return Math.min(0.4, clamp((this.dpr - LOOK_PROFILE.dprMin) / (1 - LOOK_PROFILE.dprMin), 0.3, 1));
    return clamp((this.dpr - LOOK_PROFILE.dprMin) / (1 - LOOK_PROFILE.dprMin), 0.3, 1);
  }

  private burstAt(node: TreeNode, n: number, speed = 3.2) {
    n = Math.max(8, Math.round(n * this.fx()));
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
    this.reveal = null;
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

  /** run something n frames from now: the work of a node opening is spread over a few frames, never done in one */
  private afterFrames(n: number, fn: () => void) {
    const step = (left: number) => {
      if (this.destroyed) return;
      if (left <= 0) fn();
      else requestAnimationFrame(() => step(left - 1));
    };
    step(n);
  }

  private arrive(node: TreeNode, grown: boolean) {
    const rt = this.world.rts.get(node.id)!;
    rt.pending = false;
    if (grown) rt.grown = true;
    rt.hovT = this.hoverId === node.id ? 1 : 0;
    this.path = ancestry(node);
    const finishing = this.visit(node);
    const fx = this.fx();

    // frame 0: only what the eye needs first (the node lights, a ring, a flash, the camera kick)
    this.refreshBuds();
    this.flareNode(node, 2.6);
    this.rings.fire(node.pos.x, node.pos.y, node.pos.z, node.palette.a, 7.2, 2.3);
    this.flash(node.pos.x, node.pos.y, node.palette.a, 1.5, 11, 2.4);
    if (!this.reduced) {
      this.rig.impulse(-13 * this.weight);
      this.rig.shake((node.index % 2 ? 1 : -1) * 0.035 * this.weight);
    }
    this.rig.followTarget = 0;

    // frame 1: the signature moment and the sparks
    this.afterFrames(1, () => {
      // the moment's shader is the costliest thing a click plays: a weak device gets it smaller, and none covers more than the screen allows
      this.moments.fire(node, grown ? 1 : 0.6, this.reduced, this.momentScale(node, (finishing ? FINALE.scale : 1) * (this.weak ? 0.65 : 1)), finishing ? FINALE.stretch : 1);
      this.burstAt(node, 110, 6.4);
      if (fx > 2) this.bloomSurge(1.3);
    });
    // frame 2: the title and the card (the page's own work: text, layout, the React state)
    this.afterFrames(2, () => {
      this.setReveal(node, grown, finishing);
      this.world.overlay.revealTitle(node.id, this.speed() > 1 ? 1.4 : 1);
      this.emit();
    });
    // frame 3: sound, haptics and the finale
    this.afterFrames(3, () => {
      this.audio.impact();
      this.haptic([10, 40, 18]);
      this.audio.signature(node.style, node.depth, node.index, grown);
      this.syncHarmony();
      if (finishing) this.finaleBranch(node);
    });
    this.warmChildren(node);
  }

  /** shrink a moment so its square covers at most ~0.7 of the screen height: its shader cost grows with that area */
  private momentScale(node: TreeNode, scale: number) {
    const cam = this.rig.camera;
    const base = node.depth <= 1 ? 2.9 : node.depth === 2 ? 2.6 : 2.3;
    const dist = Math.max(1, cam.position.z - node.pos.z);
    const worldH = 2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const maxSize = (0.7 * worldH) / 2;
    return Math.min(scale, maxSize / base);
  }

  /** build the circuitry of a node's children in idle time: the next click then has nothing heavy left to do */
  private warmChildren(node: TreeNode) {
    const world = this.world;
    const kids = node.children.slice();
    const next = () => {
      if (this.destroyed || this.world !== world) return;
      const kid = kids.shift();
      if (!kid) return;
      const rt = world.rts.get(kid.id);
      if (rt) this.branchFor(rt).ensureDetail(this.profile.detail);
      this.idle(next);
    };
    this.idle(next);
  }

  /** run something when the browser has a quiet moment (a short timer where there is no idle callback) */
  private idle(fn: () => void) {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(fn, { timeout: 600 });
    else window.setTimeout(fn, 120);
  }

  /** the chord follows the branch you are in and grows with every node left open */
  private syncHarmony() {
    const deepest = this.path[this.path.length - 1];
    let open = 0;
    for (const rt of this.world.list) if (rt.grown && !rt.retracting) open++;
    this.audio.setHarmony(deepest ? deepest.style : null, open);
  }

  /* ─────────────────────────── progress, reveal cards and finales ─────────────────────────── */
  private initProgress() {
    const { model } = this.world;
    const n = model.primaries.length;
    this.totals = new Array<number>(n).fill(0);
    for (const nd of model.nodes) if (nd.depth >= 1 && nd.catIndex >= 0) this.totals[nd.catIndex]++;
    const saved = loadProgress();
    for (const id of saved.visited) if (id !== 'root' && model.byId.has(id)) this.visited.add(id);
    for (const c of saved.done) if (c >= 0 && c < n) this.done.add(c);
    // a branch that is already complete never replays its finale
    for (let c = 0; c < n; c++) if (this.countVisited(c) >= this.totals[c]) this.done.add(c);
    this.bloomCat = Array.from({ length: n }, (_, c) => ({ v: this.done.has(c) ? 1 : 0 }));
    this.bloomAll = { v: this.done.size === n ? 1 : 0 };
  }

  private countVisited(cat: number) {
    let n = 0;
    for (const id of this.visited) if (this.world.model.byId.get(id)?.catIndex === cat) n++;
    return n;
  }

  /** note that a node has been opened; true when this is the one that completes its branch for the first time */
  private visit(node: TreeNode): boolean {
    const first = !this.visited.has(node.id);
    if (first) this.visited.add(node.id);
    const c = node.catIndex;
    const finishing = first && c >= 0 && !this.done.has(c) && this.countVisited(c) >= this.totals[c];
    if (finishing) this.done.add(c);
    if (first) saveProgress({ visited: [...this.visited], done: [...this.done] });
    return finishing;
  }

  /** the card for the node that just opened, timed to slide in as its own moment finishes */
  private setReveal(node: TreeNode, grown: boolean, finishing: boolean) {
    const fact = facts[node.id];
    if (!fact || node.catIndex < 0) {
      this.reveal = null;
      return;
    }
    // a card reached by walking the trail keeps its place; a new one is added after the current page
    if (this.trailTarget === node.id) this.trailTarget = null;
    else if (this.trail[this.trailPos] !== node.id) {
      this.trail.length = this.trailPos + 1;
      this.trail.push(node.id);
      this.trailPos = this.trail.length - 1;
    }
    const dur = SIGNATURE[node.style].dur * (this.reduced ? 0.8 : 1) * (finishing ? FINALE.stretch : 1);
    const target = this.nextTarget(node);
    this.reveal = {
      seq: ++this.revealSeq,
      id: node.id,
      title: node.title,
      colors: { a: hexOf(node.palette.a), accent: hexOf(node.palette.accent), b: hexOf(node.palette.b) },
      side: node.side === 'r' ? 'l' : 'r',
      fact,
      opened: this.countVisited(node.catIndex),
      total: this.totals[node.catIndex],
      delay: dur * (grown ? 0.78 : 0.4),
      hook: target && facts[target.id] ? { id: target.id, title: target.title, teaser: facts[target.id].why } : null,
    };
    // when the hook appears, the node it points at gives a small glint, so the eye knows where it leads
    if (target && this.reveal.hook && !this.reduced) {
      const { seq, delay } = this.reveal;
      this.g(() =>
        gsap.delayedCall(delay + 0.7, () => {
          if (this.reveal?.seq === seq) this.flareNode(target, 1);
        }),
      );
    }
  }

  /**
   * The next node to open from here: the first one after this node, in the order the tree tells its story, that you have
   * not opened yet and can open right now (the children of the root and of every node on your path). Following these hooks
   * walks the whole tree, branch by branch, and ends on the finale.
   */
  private nextTarget(node: TreeNode): TreeNode | null {
    const { model, rts } = this.world;
    const order = model.nodes.filter((n) => n.depth >= 1).sort((a, b) => a.catIndex - b.catIndex);
    const at = order.indexOf(node);
    if (at < 0) return null;
    const openable = new Set<string>();
    for (const owner of [model.root, ...ancestry(node)]) {
      for (const c of owner.children) {
        const rt = rts.get(c.id);
        if (rt && !rt.grown && !rt.retracting) openable.add(c.id);
      }
    }
    for (let i = 1; i < order.length; i++) {
      const n = order[(at + i) % order.length];
      if (openable.has(n.id) && !this.visited.has(n.id)) return n;
    }
    return null;
  }

  /** lights a node in the scene while the pointer rests on the card's hook, so you can see where it leads */
  peek(id: string | null, viaKey = false, at: { x: number; y: number } | null = null) {
    if (this.destroyed || this.busy) return;
    this.setHover(id, viaKey, true, at);
  }

  /* ─────────────────────────── keyboard ─────────────────────────── */
  /**
   * An arrow key moves the keyboard cursor to the nearest node in that direction, judged by where nodes sit on screen:
   * mostly straight ahead wins over nearer but off to the side. The cursor is real DOM focus, so the node blooms, its
   * name shows, and Enter (or Space) opens it like a click.
   */
  private keyMove(dx: number, dy: number) {
    if (this.destroyed) return;
    this.audio.unlock();
    if (!this.started) return;
    const ov = this.world.overlay;
    const list = ov.focusables(this.w, this.h);
    if (!list.length) return;
    const from = ov.focusedId() ?? this.path[this.path.length - 1]?.id ?? null;
    const origin = from ? list.find((n) => n.id === from) : undefined;
    const ox = origin ? origin.x : this.w / 2;
    const oy = origin ? origin.y : this.h / 2;
    let best: string | null = null;
    let bestScore = Infinity;
    for (const n of list) {
      if (n.id === origin?.id) continue;
      const vx = n.x - ox;
      const vy = n.y - oy;
      const along = vx * dx + vy * dy;
      if (along < 6) continue;
      const score = along + Math.abs(vx * dy - vy * dx) * 2;
      if (score < bestScore) {
        bestScore = score;
        best = n.id;
      }
    }
    if (best) ov.focus(best);
    else this.audio.tick();
  }

  /**
   * Enter or Space with no node under the cursor: begin if the seed is waiting, otherwise open the card's suggested next
   * node, or failing that the openable node nearest the middle of the screen.
   */
  private keyOpen(nextOnly = false) {
    if (this.destroyed) return;
    this.audio.unlock();
    if (!this.started) return this.home();
    if (!nextOnly) {
      const focused = this.world.overlay.focusedId();
      if (focused) return this.select(focused);
    }
    const hook = this.reveal?.hook;
    if (hook) return this.select(hook.id);
    let best: string | null = null;
    let bestD = Infinity;
    for (const n of this.world.overlay.focusables(this.w, this.h)) {
      if (!this.buds.has(n.id)) continue;
      const d = Math.hypot(n.x - this.w / 2, n.y - this.h / 2);
      if (d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    if (best) this.select(best);
  }

  /** the index pane is open at the top right: labels keep clear of it only while it is */
  setIndexOpen(open: boolean) {
    this.indexOpen = open;
    this.applyCardBox();
  }

  /**
   * N and P turn the cards like pages. P goes back to the card you saw before; N goes forward again, and from the newest
   * card it opens the one the card suggests next.
   */
  private keyCard(dir: 1 | -1) {
    if (this.destroyed) return;
    this.audio.unlock();
    if (!this.started) return this.home();
    const to = this.trailPos + dir;
    if (to >= 0 && to < this.trail.length) {
      this.trailPos = to;
      this.trailTarget = this.trail[to];
      this.select(this.trail[to]);
    } else if (dir === 1) this.keyOpen(true);
    else this.audio.tick();
  }

  /** the index jumps to a branch, like its number key */
  branch(c: number) {
    this.keyBranch(c);
  }

  /** the number keys jump to a branch */
  private keyBranch(c: number) {
    const p = this.world.model.primaries[c];
    if (!p || this.destroyed) return;
    this.audio.unlock();
    if (!this.started) return this.home();
    const rt = this.world.rts.get(p.id);
    if (rt && (rt.grown || this.buds.has(p.id))) this.select(p.id);
  }

  /** plus and minus zoom about the middle of the screen */
  private keyZoom(factor: number) {
    if (!this.started || this.destroyed) return;
    this.rig.camera.updateMatrixWorld();
    this.toWorld(this.w / 2, this.h / 2);
    this.rig.zoomAbout(factor, this.ptrWorld.x, this.ptrWorld.y);
  }

  /** the HUD reports where the reveal card sits, so node labels keep clear of it */
  setCardBox(box: { side: 'l' | 'r' | 'b'; w: number; h: number } | null) {
    this.cardBox = box;
    this.applyCardBox();
  }

  /** the screen the HUD has claimed: the reveal card, and the caption of a finale at the top centre */
  private applyCardBox() {
    const box = this.cardBox;
    const rects: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const pad = 28;
    if (box?.side === 'b') rects.push({ x0: 0, x1: this.w, y0: this.h - 76 - box.h - pad, y1: this.h });
    else if (box) {
      // the card is centred between the HUD rows (56px from the top, 84px from the bottom)
      const y0 = (this.h - 28 - box.h) / 2 - pad;
      const x0 = box.side === 'l' ? 0 : this.w - 26 - box.w - pad;
      const x1 = box.side === 'l' ? 26 + box.w + pad : this.w;
      rects.push({ x0, x1, y0, y1: y0 + box.h + pad * 2 });
    }
    if (this.finale) {
      const half = Math.min(this.w * 0.4, 300);
      rects.push({ x0: this.w / 2 - half, x1: this.w / 2 + half, y0: 0, y1: this.w < 700 ? 160 : 130 });
    }
    // the index sits at the top right while it is open on a roomy screen (see .index in the stylesheet)
    if (this.indexOpen && this.w >= 1200 && this.h >= 760) rects.push({ x0: this.w - 26 - 264 - pad, x1: this.w, y0: 0, y1: 22 + 270 + pad });
    this.world.overlay.setReserve(rects);
  }

  private showFinale(f: Omit<FinaleState, 'seq'>, secs: number) {
    const seq = ++this.finaleSeq;
    this.finale = { seq, ...f };
    this.applyCardBox();
    this.emit();
    this.g(() =>
      gsap.delayedCall(secs, () => {
        if (this.finale?.seq !== seq) return;
        this.finale = null;
        this.applyCardBox();
        this.emit();
      }),
    );
  }

  /** a framing that holds a whole branch: its nodes and every twig that blooms on it */
  private branchFraming(c: number): Framing {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    const take = (x: number, y: number) => {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    };
    for (const n of this.world.model.nodes) if (n.catIndex === c) take(n.pos.x, n.pos.y);
    for (const tw of this.world.twigs) {
      if (tw.rt.node.catIndex !== c) continue;
      const pts = tw.mesh.trunk.pts;
      for (let i = 0; i < pts.length; i += 6) take(pts[i].x, pts[i].y);
    }
    const o = this.world.model.primaries[c].origin;
    if (o) take(o.x, o.y);
    const phone = this.world.kind === 'portrait';
    return this.rig.fit(x0, x1, y0, y1, phone ? 2.2 : 3.4, phone ? 3.2 : 2.6);
  }

  /** the last node of a branch has opened: a grander moment, the twigs burst into bloom, the chord resolves home */
  private finaleBranch(node: TreeNode) {
    const w = this.world;
    const c = node.catIndex;
    const primary = w.model.primaries[c];
    const sp = this.speed();
    const calm = this.reduced;
    const colors = { a: hexOf(primary.palette.a), accent: hexOf(primary.palette.accent), b: hexOf(primary.palette.b) };
    this.showFinale({ kind: 'branch', title: primary.title, sub: `All ${this.totals[c]} opened`, colors }, 7.5 * sp);
    this.audio.finale(node.style, 'branch');
    this.finaleKeep.add(c);
    const spark = primary.palette.a.clone().lerp(primary.palette.accent, 0.3);
    const tips = w.twigs.filter((t) => t.rt.node.catIndex === c).map((t) => t.mesh.trunk.at(t.mesh.trunk.len));
    this.g(() => {
      // the root of the branch answers with its own moment
      gsap.delayedCall(0.55 * sp, () => this.moments.fire(primary, 1, calm, 1.5, 1.2));
      // the camera draws back to show the whole branch while the bloom wave runs out along its twigs
      gsap.delayedCall(0.9 * sp, () => {
        this.resetView();
        this.rig.setTarget(this.branchFraming(c), 0.6 / sp);
      });
      gsap.to(this.bloomCat[c], { v: 1, duration: 3.4 * sp, delay: 1.3 * sp, ease: 'power2.out' });
      gsap.delayedCall(1.4 * sp, () => this.bloomSurge(1.1));
      // a burst of light at each twig tip as the wave reaches it
      tips.forEach((p, i) => gsap.delayedCall((1.5 + (i / Math.max(1, tips.length)) * 2.6) * sp, () => this.sparks.burst(p.x, p.y, p.z, 26, { speed: 1.8, size: 5, life: 1.2, color: spark, hot: 0.5 })));
      // once it is over the twigs rest again; the bloom stays
      gsap.delayedCall(8.2 * sp, () => this.finaleKeep.delete(c));
      if (this.done.size === w.model.primaries.length) gsap.delayedCall(8.4 * sp, () => this.finaleTree());
    });
  }

  /** all six branches are complete: the tree takes a bow, every twig blooms at once and the six moments play in turn */
  private finaleTree() {
    if (this.destroyed) return;
    const w = this.world;
    const sp = this.speed();
    const calm = this.reduced;
    const n = w.model.primaries.length;
    for (let c = 0; c < n; c++) this.finaleKeep.add(c);
    if (this.busy) this.finish();
    if (this.path.length) this.retractTo(w.model.root);
    this.showFinale({ kind: 'tree', title: 'The tree is in bloom', sub: `All ${w.model.nodes.length - 1} opened`, colors: { a: '#37d8ff', accent: '#ffffff', b: '#7b5cff' } }, 10 * sp);
    this.g(() => {
      gsap.delayedCall(2 * sp, () => this.audio.finale(null, 'tree'));
      w.model.primaries.forEach((p, i) => gsap.delayedCall((2.2 + i * 0.45) * sp, () => this.moments.fire(p, 1, calm, 1.5, 1.15)));
      gsap.delayedCall(2.4 * sp, () => this.bloomSurge(1.8));
      gsap.to(this.bloomAll, { v: 1, duration: 4 * sp, delay: 2.4 * sp, ease: 'power2.out' });
      gsap.delayedCall(11 * sp, () => this.finaleKeep.clear());
    });
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
    this.reveal = null;
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
    this.reveal = null;
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
    this.syncHarmony();
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
        this.warmUp();
      });
    });
  }

  /**
   * Compile every shader the scene will ever use, including those of things not on show yet (rings, moments, branches).
   * A shader built for the screen is not the one used inside the post-processing buffers, so compile against those.
   */
  private compileAll() {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.composer ? this.composer.inputBuffer : null);
    void r.compileAsync(this.scene, this.rig.camera);
    r.setRenderTarget(prev);
  }

  /**
   * While the seed waits to be clicked the device is idle, so the first-time work happens now, one small step
   * at a time: the stem and the six boughs build their circuitry, the twigs and leaves grow, and every shader
   * is compiled. Otherwise each of those lands as a stutter right when the tree starts to move.
   */
  private warmUp() {
    if (this.warming) return;
    this.warming = true;
    const w = this.world;
    const steps: (() => void)[] = [
      () => w.stem.ensureDetail(this.profile.detail),
      () => this.buildTwigs(),
      ...w.model.primaries.map((n) => () => {
        const rt = w.rts.get(n.id);
        if (rt) this.branchFor(rt).ensureDetail(this.profile.detail);
      }),
      () => this.compileAll(),
    ];
    const later = (fn: () => void) => this.idle(fn);
    const next = () => {
      // a rebuilt world (the window changed shape) ends the warm-up; the click on the seed does not, so the work
      // still left runs while the stem grows and the visitor looks, not on their first node click
      if (this.destroyed || this.world !== w) return;
      const step = steps.shift();
      if (!step) return;
      step();
      later(next);
    };
    later(next);
  }

  /** the click: the seed cracks, a shoot climbs out, the stem rises to its crown, then the six buds open */
  private begin() {
    if (this.started || this.destroyed) return;
    this.started = true;
    this.ready = true;
    this.warmUp();
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

  /**
   * While the keyboard holds a node, a virtual pointer glides to it with the same spring-and-light as the mouse, starting from
   * wherever the mouse last was, so a key press reads as the light travelling to the node. Null when the mouse is in charge.
   */
  private keyboardPointer(dt: number): PointerState | null {
    const rt = this.hoverViaKey && this.hoverId ? this.world.rts.get(this.hoverId) : null;
    const sp = this.hoverAt ?? (rt && rt.role !== 'hidden' ? this.world.overlay.screenOf(rt.node.id) : null);
    const k = this.kbPtr;
    if (!sp) {
      k.ready = false;
      return null;
    }
    if (!k.ready) {
      k.ready = true;
      k.x = this.ptr.seen ? this.ptr.x : sp.x;
      k.y = this.ptr.seen ? this.ptr.y : sp.y;
      k.vx = 0;
      k.vy = 0;
    }
    const f = this.reduced ? 1 : 1 - Math.exp(-dt * 11);
    const nx = k.x + (sp.x - k.x) * f;
    const ny = k.y + (sp.y - k.y) * f;
    const kv = 1 - Math.exp(-dt * 12);
    k.vx += ((nx - k.x) / dt - k.vx) * kv;
    k.vy += ((ny - k.y) / dt - k.vy) * kv;
    k.x = nx;
    k.y = ny;
    return { x: k.x, y: k.y, vx: k.vx, vy: k.vy, speed: Math.hypot(k.vx, k.vy), type: 'mouse', down: performance.now() < this.kbPressUntil, seen: true, inside: true };
  }

  private updatePointer(dt: number) {
    const real = this.ptr;
    const virt = this.keyboardPointer(dt);
    const p = virt ?? real;
    const mode = virt ? 'key' : 'mouse';
    if (mode !== this.ptrMode) {
      // the hand-over between mouse and keyboard must not read as a leap
      this.ptrMode = mode;
      this.ptrPrev.x = p.x;
      this.ptrPrev.y = p.y;
    }
    const dx = p.x - this.ptrPrev.x;
    const dy = p.y - this.ptrPrev.y;
    this.ptrPrev.x = p.x;
    this.ptrPrev.y = p.y;
    if (!virt) {
      const k = 1 - Math.exp(-dt * 12);
      real.vx += (dx / dt - real.vx) * k;
      real.vy += (dy / dt - real.vy) * k;
      real.speed = Math.hypot(real.vx, real.vy);
    }

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
    if (this.hoverUi) target = { x: p.x, y: p.y, kind: 'ui' };
    else if (rt && rt.role !== 'hidden') {
      const sp = this.world.overlay.screenOf(rt.node.id);
      if (sp) target = { x: sp.x, y: sp.y, kind: 'node' };
    } else if (this.overUi) target = { x: p.x, y: p.y, kind: 'ui' };
    this.cursor.update(dt, p, target, '#' + color.getHexString(THREE.SRGBColorSpace), !!virt);
  }

  /* ─────────────────────────── frame ─────────────────────────── */
  private tick = () => {
    if (this.destroyed || this.contextLost) return;
    const now = performance.now();
    const raw = (now - this.lastTime) / 1000;
    const dt = Math.min(0.05, Math.max(0.0005, raw));
    this.lastTime = now;
    this.skipAcc += dt;
    // an idle scene renders every other frame (still 30fps), and so does a device that cannot hold 60 but can hold a steady
    // 30: an even 30 looks smoother than a frame rate that keeps slipping between 20 and 50
    const idle = this.introDone && !this.busy && !this.ptr.down && now - this.lastInput > 2500;
    if (idle || this.half) {
      this.skipFlip = !this.skipFlip;
      if (this.skipFlip) return;
    }
    const d = Math.min(0.066, this.skipAcc);
    this.skipAcc = 0;
    // idle frames say nothing about how the GPU copes, so only frames that are really being asked for are measured;
    // what is measured is the gap between drawn frames, so a half-rate device is judged against 30, not 60
    const gap = (now - this.lastDrawn) / 1000;
    this.lastDrawn = now;
    this.frame(d, idle ? 0 : gap);
  };

  private frame(dt: number, sample: number) {
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
      w.leaves.set(rt.i, rt.vis, rt.act, rt.hov, rt.flare);
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
    w.leaves.commit();

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
      w.foliage?.set(o.leaf, p, this.stemFlare);
      w.blossoms?.set(o.leaf, p, this.bloomAll.v);
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      this.flashes[i].age += dt;
      if (this.flashes[i].age > this.flashes[i].dur) this.flashes.splice(i, 1);
    }

    // twigs on each waiting bough: they grow outward with the bud and rest once the branch is opened
    for (const tw of w.twigs) {
      const rt = tw.rt;
      const keep = this.finaleKeep.has(rt.node.catIndex);
      const target = keep || (rt.visT > 0.5 && !rt.grown && !rt.pending && !rt.retracting) ? 1 : 0;
      tw.fade += (target - tw.fade) * (1 - Math.exp(-dt * (target ? 1.1 : 5)));
      const g = clamp((tw.fade - tw.delay) / (1 - tw.delay), 0, 1);
      tw.mesh.ghostProgress = g;
      tw.mesh.setVisible(g > 0.0005);
      tw.mesh.setGhostDim(0.9);
      tw.mesh.setGhostBoost(1.4 + rt.hov * 1.0);
      w.foliage?.set(tw.leaf, g, rt.hov);
      w.blossoms?.set(tw.leaf, g, Math.max(this.bloomCat[rt.node.catIndex]?.v ?? 0, this.bloomAll.v));
    }
    w.foliage?.commit();
    w.blossoms?.commit();

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
      (orb.u.uColor.value as THREE.Color).copy(job.color).lerp(WHITE, 0.25);
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
    this.moments.update(dt);

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
    this.bg.renderField(this.renderer, cam);

    // ── dom
    w.overlay.update(cam, this.w, this.h);

    // ── render
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, cam);

    this.monitor(sample);
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

  /** `lite` swaps the frosted-glass blur (re-done on the GPU every frame under a live canvas) for solid dark glass */
  private setLite(on: boolean) {
    if (on) document.documentElement.dataset.q = 'lite';
    else delete document.documentElement.dataset.q;
  }

  private setDpr(v: number) {
    this.dpr = v;
    this.renderer.setPixelRatio(v);
    if (this.composer) this.sizePost();
    else this.renderer.setSize(this.w, this.h);
    this.ambient.u.uPx.value = v;
    this.sparks.setPixelRatio(v);
    this.shared.uDpr.value = v;
    this.drs.settle = SETTLE;
  }

  /** last resort: render the scene straight to the screen, without the bloom pass */
  private dropPost() {
    if (!this.composer) return;
    this.composer.dispose();
    this.composer = null;
    this.bloom = null;
    this.renderer.setSize(this.w, this.h);
  }

  /**
   * Dynamic resolution. The picture is always the full one; this only chooses how many pixels it is drawn at.
   * It starts modest and sharpens while the frame rate holds, steps down in proportion when it does not, and
   * remembers a step that failed. When the picture is already well under full sharpness it gives up the glass
   * blur, and only if the lowest resolution still lags does it thin the dust and, last of all, drop the bloom pass.
   */
  private monitor(sample: number) {
    // idle half-rate frames, hitches and background tabs say nothing about how the device copes
    if (sample <= 0 || sample > 0.25 || document.hidden || this.pinned) return;
    const d = this.drs;
    if (d.settle > 0) {
      d.settle--;
      return;
    }
    const now = performance.now();
    if (d.n === 0) d.t0 = now;
    d.buf[d.n++] = sample * 1000;
    // a window is 45 frames, or about a second when the frames are slow, so a struggling device reacts quickly
    if (d.n < WINDOW && !(d.n >= 6 && now - d.t0 > 900)) return;
    const count = d.n;
    d.n = 0;
    const win = d.buf.slice(0, count).sort((a, b) => a - b);
    const avg = win.reduce((a, b) => a + b, 0) / count;
    if (d.warm) {
      d.warm = false; // the first window holds shader compiles and the intro: not representative
      return;
    }
    // the display's own cadence: what a window that kept up looks like (60Hz unless the frames prove faster)
    if (avg < 18.3 && !this.half) d.period = clamp(win[count >> 1], 6.9, 17.5);
    const period = this.half ? d.period * 2 : d.period;
    const bad = avg > period * 1.25;
    const good = avg < period * 1.12;
    if (d.hold > 0) d.hold--;

    if (bad) {
      d.badRun++;
      // a sharpening step that did not hold: go back, and wait longer before trying again
      if (d.probe > 0 && this.dpr > d.probe) {
        const back = d.probe;
        d.fails++;
        d.hold = d.holdNext;
        d.holdNext = Math.min(d.holdNext * 2, 48);
        if (d.fails >= 2) {
          // twice is a verdict: this is the sharpest it can do
          this.ceil = back;
          this.dprMax = Math.min(this.dprMax, back);
        }
        d.probe = 0;
        this.setDpr(back);
        return;
      }
      d.probe = 0;
      if (this.dpr <= 0.8 && document.documentElement.dataset.q !== 'lite') {
        // already well below full sharpness: the blur under the cards is the next thing to go, before the picture loses more
        this.setLite(true);
        d.settle = SETTLE;
        d.hold = Math.max(d.hold, 12);
        d.badRun = 0;
      } else if (this.dpr > LOOK_PROFILE.dprMin + 0.01) {
        const k = clamp(Math.sqrt((period * 1.02) / avg), 0.55, 0.92);
        this.setDpr(Math.max(LOOK_PROFILE.dprMin, Math.round(this.dpr * k * 20) / 20));
        // having stepped down, stay there a while: a canvas that keeps resizing is itself a stutter
        d.hold = Math.max(d.hold, 12);
        d.badRun = 0;
      } else if (d.badRun >= 2) {
        // the lowest resolution still lags: give up the next cheapest thing
        d.badRun = 0;
        // slow but steady, and the frames could hold 30: pace them at an even 30. Too slow for that: lighten the scene.
        if (d.rung === 0 && avg < 36) {
          d.rung = 1;
          this.half = true;
        } else if (d.rung <= 1) {
          d.rung = 2;
          this.ambient.points.geometry.setDrawRange(0, this.profile.particles >> 1);
        } else {
          d.rung = 3;
          this.dropPost();
        }
        d.settle = SETTLE;
      }
      return;
    }
    d.badRun = 0;
    d.probe = 0;
    if (false && good && d.rung === 0 && d.hold === 0 && this.dpr < this.dprMax - 0.01) {
      d.probe = this.dpr;
      this.setDpr(Math.min(this.dprMax, Math.round((this.dpr + 0.25) * 20) / 20));
    }
  }
}

/** frames per measuring window, and frames ignored after the canvas changes size (its buffers are being rebuilt) */
const WINDOW = 45;
const SETTLE = 6;

function newDrs(prev?: Drs): Drs {
  return {
    buf: new Array<number>(WINDOW).fill(0),
    n: 0,
    t0: 0,
    warm: true,
    settle: 0,
    period: prev?.period ?? 16.7,
    probe: prev?.probe ?? 0,
    hold: prev?.hold ?? 0,
    holdNext: prev?.holdNext ?? 6,
    fails: prev?.fails ?? 0,
    badRun: 0,
    rung: prev?.rung ?? 0,
  };
}

interface Drs {
  buf: number[];
  n: number;
  /** when the current window began */
  t0: number;
  warm: boolean;
  settle: number;
  /** frame interval of the display, in ms */
  period: number;
  /** the pixel ratio before the last sharpening step, while that step is on trial (0 = none) */
  probe: number;
  /** windows to wait before sharpening again, and how long the next wait is */
  hold: number;
  holdNext: number;
  fails: number;
  badRun: number;
  /** how many extras have been given up at the lowest resolution */
  rung: number;
}
