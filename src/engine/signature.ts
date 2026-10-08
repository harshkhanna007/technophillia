import type { StyleId } from './types';

/**
 * The "signature moment" every branch plays when one of its nodes opens.
 * The visuals (MOMENT_FRAG) and the sound (AudioEngine.signature) both read this table, so each sound
 * lands exactly on the beat it belongs to. `cues` are fractions of `dur`; the comments say what each one is.
 */
export interface Signature {
  /** seconds */
  dur: number;
  cues: number[];
}

export const SIGNATURE: Record<StyleId, Signature> = {
  // a signal crosses a four-layer net: input, two hidden layers, output
  neural: { dur: 2.6, cues: [0.06, 0.26, 0.46, 0.66] },
  // a servo arm sweeps its dial, ratcheting tick by tick, then locks
  mechanical: { dur: 2.4, cues: [0.1, 0.16, 0.22, 0.29, 0.36, 0.43, 0.5, 0.6] },
  // petals unfurl one after another, outer ring then inner
  organic: { dur: 3.0, cues: [0.1, 0.14, 0.18, 0.22, 0.26, 0.3, 0.34, 0.4, 0.46, 0.52] },
  // shards fly in and snap into a hexagon prototype
  chaotic: { dur: 2.4, cues: [0.3, 0.36, 0.42, 0.48, 0.54, 0.62] },
  // satellites connect to a hub, one by one, then the ring closes
  network: { dur: 2.8, cues: [0.34, 0.4, 0.46, 0.52, 0.58, 0.64, 0.74] },
  // a cloud of possible states flickers, then collapses to one
  quantum: { dur: 2.6, cues: [0.08, 0.17, 0.26, 0.35, 0.44, 0.56] },
};

/** the order the fragment shader branches on */
export const STYLE_INDEX: Record<StyleId, number> = { neural: 0, mechanical: 1, organic: 2, chaotic: 3, network: 4, quantum: 5 };
