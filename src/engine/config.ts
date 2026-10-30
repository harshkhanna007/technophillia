/**
 * One look for every device. There are no quality tiers: the scene is always the full one (every light,
 * leaf, spark and the whole bloom). What changes from device to device is only how many pixels it is
 * drawn at, and that is decided by measuring the frame rate while it runs (see Engine.monitor).
 */
export const LOOK_PROFILE = {
  /** sharpest pixel ratio the canvas may reach, and the most pixels it may render at that ratio */
  dprMax: 2,
  budget: 5.0e6,
  /** the canvas never drops below this ratio, however slow the device */
  dprMin: 0.5,
  particles: 1200,
  sparks: 1600,
  detail: 1,
  bgLights: 8,
  /** how many signature moments may play at once */
  moments: 8,
  /** leaves per node sprig */
  leaves: 3,
} as const;

/** the pixel ratio the canvas is allowed to reach on this screen */
export function maxDpr(w: number, h: number): number {
  const cap = Math.sqrt(LOOK_PROFILE.budget / Math.max(1, w * h));
  return Math.max(LOOK_PROFILE.dprMin, Math.min(window.devicePixelRatio || 1, LOOK_PROFILE.dprMax, cap));
}

/** Global look-and-feel numbers. */
export const LOOK = {
  background: 0x01020a,
  fov: 38,
  /** growth speed ≈ world units per second, used to derive timeline durations */
  growMin: 2.3,
  growMax: 4.0,
  pulseSpeed: 15,
};

/** world-space scale of the seed artwork (its sprouts end at 0.6 x this) */
export const SEED_SCALE = 1.9;
