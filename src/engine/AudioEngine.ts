import { SIGNATURE } from './signature';
import type { StyleId } from './types';

/**
 * Every branch has its own voice: a root note, a scale and a timbre. Hovering one of its nodes sounds a note of
 * its scale, opening a node plays a short phrase of it in time with the branch's visual moment, and the chord
 * underneath is stacked from the same scale, so the music always agrees with the branch you are in.
 */
interface Flavor {
  /** Hz */
  root: number;
  /** semitones above the root */
  scale: number[];
  /** the two oscillator shapes of the chord pad */
  pad: [OscillatorType, OscillatorType];
  /** where the pad's low-pass sits with one voice; it opens as the chord grows */
  cutoff: number;
}

const FLAVOR: Record<StyleId, Flavor> = {
  neural: { root: 220, scale: [0, 3, 5, 7, 10], pad: ['sine', 'triangle'], cutoff: 700 }, // A minor pentatonic: glassy
  mechanical: { root: 146.83, scale: [0, 2, 3, 5, 7, 9, 10], pad: ['triangle', 'sawtooth'], cutoff: 520 }, // D dorian: dry, engineered
  organic: { root: 174.61, scale: [0, 2, 4, 7, 9], pad: ['sine', 'sine'], cutoff: 800 }, // F major pentatonic: warm, open
  chaotic: { root: 164.81, scale: [0, 1, 4, 5, 7, 8, 10], pad: ['sawtooth', 'square'], cutoff: 560 }, // E phrygian dominant: restless
  network: { root: 196, scale: [0, 2, 4, 6, 7, 9, 11], pad: ['sawtooth', 'sawtooth'], cutoff: 760 }, // G lydian: bright, expanding
  quantum: { root: 261.63, scale: [0, 2, 4, 6, 8, 10], pad: ['sine', 'sine'], cutoff: 900 }, // C whole tone: weightless
};

/** voices in the chord, and how loud each one sits once it has joined */
const HARMONY = 6;
const PAD_VOL = [0.026, 0.021, 0.021, 0.021, 0.021, 0.021];
/** octave of each chord voice relative to the branch root: low foundation, then the upper tones, never above the pad filter */
const PAD_OCT = [-1, -1, 0, 0, 0, -1];

/**
 * Fully synthesised sound design (no audio files). Everything is deliberately quiet:
 *  hover → tiny blip · select → click · pulse → electric travel · grow → rising swell
 *  impact → deep node ignition · reverse → soft energy return
 *  signature → the branch's phrase · harmony → a chord that builds as more nodes open
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private dry: GainNode | null = null;
  private wet: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private ambient: { stop(): void } | null = null;
  muted: boolean;
  private lastHover = 0;
  private harmony: { style: StyleId | null; swap: number; voices: { a: OscillatorNode; b: OscillatorNode; g: GainNode; lp: BiquadFilterNode }[] } | null = null;

  constructor() {
    let m = false;
    try {
      m = window.localStorage.getItem('technophilia:muted') === '1';
    } catch {
      /* storage can be blocked */
    }
    this.muted = m;
  }

  get ready() {
    return !!this.ctx;
  }

  /** must be called from a user gesture */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    this.master = master;
    this.dry = ctx.createGain();
    this.dry.connect(master);
    // generated reverb tail
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    conv.buffer = ir;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.32;
    this.wet.connect(conv).connect(master);
    // 1s of white noise reused by every noise voice
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noise = nb;
    void ctx.resume();
    this.startAmbient();
  }

  /** battery friendly: stop the audio graph while the tab is in the background */
  setHidden(hidden: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (hidden) void ctx.suspend();
    else void ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      window.localStorage.setItem('technophilia:muted', m ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.ctx && this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(m ? 0 : 0.8, t, 0.12);
    }
  }

  private out(reverb = 0.25) {
    // returns a gain node feeding dry + wet buses
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.connect(this.dry!);
    const send = ctx.createGain();
    send.gain.value = reverb;
    g.connect(send).connect(this.wet!);
    return g;
  }

  private osc(type: OscillatorType, f0: number, f1: number, t0: number, dur: number, peak: number, attack = 0.005, reverb = 0.25, filter?: { type: BiquadFilterType; f0: number; f1?: number; q?: number }) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node: AudioNode = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type;
      f.frequency.setValueAtTime(filter.f0, t0);
      if (filter.f1) f.frequency.exponentialRampToValueAtTime(filter.f1, t0 + dur);
      f.Q.value = filter.q ?? 1;
      node.connect(f);
      node = f;
    }
    node.connect(g).connect(this.out(reverb));
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private noiseVoice(t0: number, dur: number, peak: number, filter: { type: BiquadFilterType; f0: number; f1: number; q?: number }, attack = 0.01, reverb = 0.3, swell = false) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter.type;
    f.frequency.setValueAtTime(filter.f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, filter.f1), t0 + dur);
    f.Q.value = filter.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    if (swell) {
      g.gain.exponentialRampToValueAtTime(peak, t0 + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    } else {
      g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    }
    src.connect(f).connect(g).connect(this.out(reverb));
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.05);
  }

  private startAmbient() {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 340;
    const a = ctx.createOscillator();
    const b = ctx.createOscillator();
    a.type = 'sine';
    b.type = 'sine';
    a.frequency.value = 55;
    b.frequency.value = 55.4;
    const c = ctx.createOscillator();
    c.type = 'triangle';
    c.frequency.value = 82.6;
    const cg = ctx.createGain();
    cg.gain.value = 0.25;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 90;
    lfo.connect(lg).connect(lp.frequency);
    a.connect(lp);
    b.connect(lp);
    c.connect(cg).connect(lp);
    lp.connect(g).connect(this.out(0.5));
    [a, b, c, lfo].forEach((o) => o.start());
    this.ambient = {
      stop: () => [a, b, c, lfo].forEach((o) => o.stop()),
    };
  }

  /* ───────────── voices ───────────── */
  /** the same tiny blip, tuned to a note of the hovered branch's scale (`seed` picks which) */
  hover(style?: StyleId, seed = 0) {
    if (!this.ctx || this.muted) return;
    const now = performance.now();
    if (now - this.lastHover < 70) return;
    this.lastHover = now;
    const t = this.ctx.currentTime;
    const f = style ? this.note(style, seed, 3) : 2300;
    this.osc('sine', f, f * 1.43, t, 0.07, 0.03, 0.004, 0.4);
    this.osc('sine', f * 1.61, f * 1.61, t + 0.015, 0.05, 0.012, 0.004, 0.5);
  }

  select() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this.osc('square', 980, 260, t, 0.16, 0.05, 0.003, 0.3, { type: 'lowpass', f0: 3200, f1: 500 });
    this.noiseVoice(t, 0.04, 0.05, { type: 'highpass', f0: 5000, f1: 3000 }, 0.002, 0.2);
    this.osc('sine', 1560, 2200, t + 0.02, 0.18, 0.025, 0.004, 0.6);
  }

  pulse(dur: number) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this.noiseVoice(t, dur, 0.08, { type: 'bandpass', f0: 420, f1: 3400, q: 4 }, 0.02, 0.35, true);
    this.osc('sawtooth', 130, 520, t, dur, 0.026, dur * 0.4, 0.3, { type: 'lowpass', f0: 500, f1: 2600 });
  }

  grow(dur: number) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this.osc('sawtooth', 110, 220, t, dur, 0.032, dur * 0.65, 0.45, { type: 'lowpass', f0: 220, f1: 2600, q: 2 });
    this.osc('sawtooth', 111.6, 223, t, dur, 0.026, dur * 0.65, 0.45, { type: 'lowpass', f0: 200, f1: 2200, q: 2 });
    this.osc('sine', 220, 1100, t, dur, 0.028, dur * 0.7, 0.55);
    this.osc('triangle', 440, 1760, t + dur * 0.2, dur * 0.8, 0.012, dur * 0.6, 0.6);
  }

  impact() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this.osc('sine', 96, 36, t, 0.95, 0.24, 0.004, 0.35);
    this.osc('sine', 192, 70, t, 0.4, 0.07, 0.004, 0.3);
    this.noiseVoice(t, 0.55, 0.12, { type: 'lowpass', f0: 1400, f1: 90 }, 0.004, 0.4);
    this.osc('sine', 1760, 1320, t + 0.01, 1.4, 0.022, 0.01, 0.9);
    this.osc('triangle', 2640, 2200, t + 0.03, 1.1, 0.01, 0.01, 0.9);
  }

  reverse(dur: number) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this.noiseVoice(t, dur, 0.07, { type: 'bandpass', f0: 3200, f1: 260, q: 3 }, 0.02, 0.4, true);
    this.osc('sawtooth', 640, 90, t, dur, 0.022, dur * 0.3, 0.4, { type: 'lowpass', f0: 2400, f1: 200 });
    this.osc('sine', 1200, 200, t, dur, 0.02, dur * 0.4, 0.5);
  }

  tick() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this.osc('sine', 1800, 2600, t, 0.05, 0.02, 0.003, 0.5);
  }

  /* ───────────── branch identity ───────────── */

  /** the n-th note of a branch's scale, `oct` octaves above its root; degrees past the end of the scale climb into the next octave */
  private note(style: StyleId, degree: number, oct = 0) {
    const { root, scale } = FLAVOR[style];
    const n = scale.length;
    const d = Math.floor(degree);
    const idx = ((d % n) + n) % n;
    return root * Math.pow(2, (scale[idx] + 12 * (Math.floor(d / n) + oct)) / 12);
  }

  /** a struck bell: a sine bent by an inharmonic partner that dies away quickly */
  private bell(f: number, t0: number, dur: number, peak: number, reverb = 0.6) {
    const ctx = this.ctx!;
    const c = ctx.createOscillator();
    const m = ctx.createOscillator();
    c.frequency.value = f;
    m.frequency.value = f * 3.5;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 1.4, t0);
    mg.gain.exponentialRampToValueAtTime(f * 0.05, t0 + dur * 0.6);
    m.connect(mg).connect(c.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    c.connect(g).connect(this.out(reverb));
    c.start(t0);
    m.start(t0);
    c.stop(t0 + dur + 0.05);
    m.stop(t0 + dur + 0.05);
  }

  /** marimba / kalimba: a soft sine with a short-lived fourth partial */
  private mallet(f: number, t0: number, dur: number, peak: number, reverb = 0.5) {
    this.osc('sine', f, f, t0, dur, peak, 0.003, reverb);
    this.osc('sine', f * 4, f * 4, t0, dur * 0.22, peak * 0.32, 0.002, reverb);
  }

  /** a plucked string: a bright wave whose filter closes as it rings */
  private pluck(f: number, t0: number, dur: number, peak: number, type: OscillatorType = 'sawtooth', reverb = 0.35) {
    this.osc(type, f, f, t0, dur, peak, 0.003, reverb, { type: 'lowpass', f0: f * 7, f1: f * 1.5, q: 1 });
  }

  /** two detuned sines under a fast tremolo: the shimmer of many possible states */
  private shimmer(f: number, t0: number, dur: number, peak: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.06);
    g.gain.setValueAtTime(peak, Math.max(t0 + 0.07, t0 + dur - 0.05));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const trem = ctx.createGain();
    trem.gain.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 13;
    const depth = ctx.createGain();
    depth.gain.value = 0.4;
    lfo.connect(depth).connect(trem.gain);
    for (const fr of [f, f * 1.006]) {
      const o = ctx.createOscillator();
      o.frequency.value = fr;
      o.connect(trem);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    }
    trem.connect(g).connect(this.out(0.7));
    lfo.start(t0);
    lfo.stop(t0 + dur + 0.05);
  }

  /**
   * The phrase a branch plays when one of its nodes opens, laid on the cues of its visual moment (signature.ts).
   * Each node starts its phrase on a different degree of the branch's scale, so no two openings sound alike.
   */
  signature(style: StyleId, depth: number, index: number, full = true) {
    if (!this.ctx || this.muted) return;
    const { dur, cues } = SIGNATURE[style];
    const t = this.ctx.currentTime;
    // sits under the node-ignition thump that plays at the same moment; a revisit is softer still
    const k = full ? 0.72 : 0.4;
    const base = (index * 2 + depth) % FLAVOR[style].scale.length;
    const at = (i: number) => t + cues[i] * dur;
    const last = cues.length - 1;
    const rnd = (n: number) => {
      const x = Math.sin((index + 1) * 12.9898 + n * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    switch (style) {
      case 'neural':
        // one glassy note per layer as the signal arrives, each with a tiny data blip, then a soft fifth for the verdict
        cues.forEach((_, i) => {
          this.bell(this.note(style, base + i * 2, 1), at(i), 1.3, 0.034 * k);
          this.osc('sine', 3200 + i * 350, 4300 + i * 350, at(i), 0.05, 0.01 * k, 0.002, 0.5);
        });
        this.bell(this.note(style, base + 6, 0), at(last), 1.9, 0.028 * k, 0.8);
        break;
      case 'mechanical': {
        // a servo whine under the sweep, a ratchet click for every notch, a thunk and a chime when it locks
        const { root } = FLAVOR.mechanical;
        this.osc('sawtooth', root * 1.5, root * 3.6, at(0), (cues[last - 1] - cues[0]) * dur + 0.12, 0.013 * k, 0.05, 0.25, { type: 'bandpass', f0: 900, f1: 2200, q: 3 });
        for (let i = 0; i < last; i++) {
          this.noiseVoice(at(i), 0.025, 0.05 * k, { type: 'highpass', f0: 2600, f1: 1800 }, 0.001, 0.15);
          if (i % 2 === 0) this.pluck(this.note(style, base + i, 1), at(i), 0.22, 0.011 * k, 'square');
        }
        const lock = at(last);
        this.osc('sine', 160, 55, lock, 0.28, 0.12 * k, 0.003, 0.2);
        this.noiseVoice(lock, 0.05, 0.08 * k, { type: 'bandpass', f0: 3500, f1: 1800, q: 2 }, 0.001, 0.2);
        this.pluck(this.note(style, base, 1), lock + 0.02, 0.6, 0.03 * k, 'triangle', 0.5);
        break;
      }
      case 'organic':
        // petals open in an ascending run, with a breath of air underneath and a little sparkle at the end
        cues.forEach((_, i) => this.mallet(this.note(style, base + i, 1 + (i > 6 ? 1 : 0)), at(i), 0.95, (0.03 - i * 0.0008) * k));
        this.noiseVoice(at(0), dur * 0.5, 0.02 * k, { type: 'bandpass', f0: 1600, f1: 4200, q: 1.2 }, 0.01, 0.6, true);
        this.osc('sine', this.note(style, base, 3), this.note(style, base, 3), at(last) + 0.1, 1.1, 0.012 * k, 0.004, 0.9);
        this.osc('sine', this.note(style, base + 2, 3), this.note(style, base + 2, 3), at(last) + 0.2, 1.1, 0.01 * k, 0.004, 0.9);
        break;
      case 'chaotic': {
        // glitching blips as shards fly in, then a thud and a detuned stab as they snap into the prototype
        cues.slice(0, last).forEach((_, i) => {
          const f = this.note(style, Math.floor(rnd(i) * 7), 2);
          this.osc('square', f, f * 0.5, at(i), 0.07, 0.02 * k, 0.002, 0.25, { type: 'lowpass', f0: 5000, f1: 900 });
          this.noiseVoice(at(i), 0.03, 0.035 * k, { type: 'highpass', f0: 4000, f1: 2500 }, 0.001, 0.2);
        });
        const snap = at(last);
        this.osc('sine', 120, 42, snap, 0.4, 0.13 * k, 0.003, 0.3);
        this.noiseVoice(snap, 0.12, 0.08 * k, { type: 'bandpass', f0: 3000, f1: 700, q: 1.5 }, 0.002, 0.3);
        [0, 2, 4].forEach((d, n) => {
          const f = this.note(style, base + d, 1);
          this.osc('sawtooth', f * (1 + n * 0.003), f * (1 + n * 0.003), snap, 0.55, 0.014 * k, 0.004, 0.5, { type: 'lowpass', f0: 3000, f1: 500 });
        });
        break;
      }
      case 'network': {
        // each satellite joins with a ping that echoes away; a soft pad swells underneath as the ring closes
        cues.forEach((_, i) => {
          const f = this.note(style, base + i, 1);
          [0, 0.17, 0.34].forEach((d, e) => this.osc('sine', f, f, at(i) + d, 0.7, 0.026 * k * (1 - e * 0.4), 0.003, 0.8));
        });
        const { root } = FLAVOR.network;
        for (const det of [1, 1.004]) this.osc('sawtooth', root * 2 * det, root * 2 * det, at(0) - 0.3, dur * 0.85, 0.011 * k, dur * 0.5, 0.6, { type: 'lowpass', f0: 300, f1: 1800 });
        break;
      }
      case 'quantum': {
        // a shimmering cloud of states with random blips, then the collapse: a swell, a clean bell, a low note
        [0, 2, 4].forEach((d) => this.shimmer(this.note(style, base + d, 1), at(0), (cues[last] - cues[0]) * dur, 0.012 * k));
        cues.slice(0, last).forEach((_, i) => {
          const f = this.note(style, Math.floor(rnd(i + 3) * 6), 2);
          this.osc('sine', f, f * 1.01, at(i), 0.09, 0.013 * k, 0.003, 0.7);
        });
        const c = at(last);
        this.noiseVoice(c - 0.45, 0.45, 0.04 * k, { type: 'bandpass', f0: 400, f1: 5000, q: 2 }, 0.01, 0.6, true);
        this.bell(this.note(style, base, 2), c, 2.2, 0.04 * k, 0.9);
        this.bell(this.note(style, base + 3, 1), c + 0.05, 1.8, 0.022 * k, 0.9);
        this.osc('sine', 98, 65, c, 1.4, 0.08 * k, 0.01, 0.4);
        break;
      }
    }
  }

  /** the chord under everything: voices are stacked in the current branch's scale and join one by one as more nodes open */
  setHarmony(style: StyleId | null, level: number) {
    if (!this.ctx) return;
    const h = this.ensureHarmony();
    const lvl = style ? Math.max(0, Math.min(HARMONY, Math.round(level))) : 0;
    if (style === h.style) {
      if (style) this.applyHarmony(h, style, lvl);
      return;
    }
    // another branch (or none): fade the chord out, retune it while it is silent, then bring it back
    const t = this.ctx.currentTime;
    const token = ++h.swap;
    h.style = style;
    for (const v of h.voices) {
      v.g.gain.cancelScheduledValues(t);
      v.g.gain.setTargetAtTime(0.0001, t, 0.1);
    }
    if (!style) return;
    window.setTimeout(() => {
      if (!this.ctx || token !== h.swap) return;
      const f = FLAVOR[style];
      const now = this.ctx.currentTime;
      h.voices.forEach((v, i) => {
        const freq = this.note(style, i * 2, PAD_OCT[i]);
        v.a.type = f.pad[0];
        v.b.type = f.pad[1];
        v.a.frequency.setValueAtTime(freq, now);
        v.b.frequency.setValueAtTime(freq, now);
        v.lp.frequency.setValueAtTime(f.cutoff, now);
      });
      this.applyHarmony(h, style, lvl);
    }, 260);
  }

  private ensureHarmony() {
    if (this.harmony) return this.harmony;
    const ctx = this.ctx!;
    const voices: NonNullable<AudioEngine['harmony']>['voices'] = [];
    for (let i = 0; i < HARMONY; i++) {
      const a = ctx.createOscillator();
      const b = ctx.createOscillator();
      b.detune.value = 5 + i * 1.5;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 500;
      lp.Q.value = 0.6;
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      a.connect(lp);
      b.connect(lp);
      lp.connect(g).connect(this.out(0.55));
      a.start();
      b.start();
      voices.push({ a, b, g, lp });
    }
    this.harmony = { style: null, swap: 0, voices };
    return this.harmony;
  }

  private applyHarmony(h: NonNullable<AudioEngine['harmony']>, style: StyleId, level: number) {
    const t = this.ctx!.currentTime;
    h.voices.forEach((v, i) => {
      v.g.gain.cancelScheduledValues(t);
      v.g.gain.setTargetAtTime(i < level ? PAD_VOL[i] : 0.0001, t, 0.9);
    });
    // the more voices, the more the chord opens up
    h.voices.forEach((v) => v.lp.frequency.setTargetAtTime(FLAVOR[style].cutoff * (1 + 0.28 * level), t, 1.2));
  }

  dispose() {
    try {
      this.harmony?.voices.forEach((v) => {
        v.a.stop();
        v.b.stop();
      });
      this.ambient?.stop();
      void this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
  }
}
