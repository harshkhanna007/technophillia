/**
 * Fully synthesised sound design (no audio files). Everything is deliberately quiet:
 *  hover → tiny blip · select → click · pulse → electric travel · grow → rising swell
 *  impact → deep node ignition · reverse → soft energy return
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
  hover() {
    if (!this.ctx || this.muted) return;
    const now = performance.now();
    if (now - this.lastHover < 70) return;
    this.lastHover = now;
    const t = this.ctx.currentTime;
    this.osc('sine', 2300, 3300, t, 0.07, 0.03, 0.004, 0.4);
    this.osc('sine', 3700, 3700, t + 0.015, 0.05, 0.012, 0.004, 0.5);
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

  dispose() {
    try {
      this.ambient?.stop();
      void this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
  }
}
