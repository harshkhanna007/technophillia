export type Quality = 'high' | 'medium' | 'low';

export interface QualityProfile {
  dpr: number;
  bloom: boolean;
  bloomScale: number;
  particles: number;
  sparks: number;
  detail: number;
  bgLights: number;
  chroma: boolean;
}

export const PROFILES: Record<Quality, QualityProfile> = {
  high: { dpr: 2, bloom: true, bloomScale: 1, particles: 1200, sparks: 1600, detail: 1, bgLights: 8, chroma: true },
  medium: { dpr: 1.5, bloom: true, bloomScale: 0.75, particles: 700, sparks: 900, detail: 0.75, bgLights: 6, chroma: false },
  low: { dpr: 1.25, bloom: true, bloomScale: 0.5, particles: 320, sparks: 500, detail: 0.5, bgLights: 4, chroma: false },
};

export function detectQuality(): Quality {
  if (typeof navigator === 'undefined') return 'medium';
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 900);
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  if (mobile) return cores <= 4 || mem < 4 ? 'low' : 'medium';
  if (cores <= 4 || mem < 4) return 'medium';
  return 'high';
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
