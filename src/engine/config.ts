export type Quality = 'high' | 'medium' | 'low';

export interface QualityProfile {
  dpr: number;
  /** most pixels the canvas may render; big screens on weak machines get a lower resolution instead of a lower frame rate */
  budget: number;
  bloom: boolean;
  bloomScale: number;
  particles: number;
  sparks: number;
  detail: number;
  bgLights: number;
  chroma: boolean;
}

export const PROFILES: Record<Quality, QualityProfile> = {
  high: { dpr: 2, budget: 5.0e6, bloom: true, bloomScale: 1, particles: 1200, sparks: 1600, detail: 1, bgLights: 8, chroma: true },
  medium: { dpr: 1.5, budget: 2.4e6, bloom: true, bloomScale: 0.75, particles: 640, sparks: 800, detail: 0.75, bgLights: 6, chroma: false },
  low: { dpr: 1.25, budget: 1.4e6, bloom: true, bloomScale: 0.5, particles: 260, sparks: 420, detail: 0.5, bgLights: 4, chroma: false },
};

const ORDER: Quality[] = ['low', 'medium', 'high'];

/** `?q=low|medium|high` pins a tier (handy for testing a weak device on a strong one) */
function pinned(): Quality | null {
  try {
    const q = new URLSearchParams(window.location.search).get('q');
    return q === 'low' || q === 'medium' || q === 'high' ? q : null;
  } catch {
    return null;
  }
}

export function detectQuality(): Quality {
  if (typeof navigator === 'undefined') return 'medium';
  const forced = pinned();
  if (forced) return forced;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 900);
  const cores = navigator.hardwareConcurrency || 4;
  // Chrome reports 0.25 to 8 (GB, rounded); other browsers report nothing, so assume capable
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  if (mobile) return cores <= 4 || mem <= 4 || saveData ? 'low' : 'medium';
  if ((cores <= 4 && mem <= 4) || mem <= 2) return 'low';
  if (cores <= 4 || mem <= 4 || saveData) return 'medium';
  return 'high';
}

/** software rasterisers and old integrated GPUs cannot keep the full look at speed: step the tier down */
const WEAK_GPU = /swiftshader|llvmpipe|softpipe|software|basic render|mali-(4|t6|t7|t8[0-4])|adreno \(tm\) ?[2-4]\d\d\b|powervr (sgx|ge8)|intel\(r\) (hd|uhd) graphics (2|3|4|5)\d{2,3}\b|intel\(r\) hd graphics$|vivante|videocore/i;

export function refineQuality(q: Quality, gl: WebGLRenderingContext | WebGL2RenderingContext): Quality {
  if (pinned()) return q;
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    if (WEAK_GPU.test(name)) return 'low';
    // a tiny texture ceiling is a reliable tell for a very old GPU
    if ((gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) < 4096) return ORDER[Math.max(0, ORDER.indexOf(q) - 1)];
  } catch {
    /* keep the guess */
  }
  return q;
}

/** device pixel ratio for this screen: capped by the tier and by the pixel budget */
export function fitDpr(profile: QualityProfile, w: number, h: number): number {
  const dpr = Math.min(window.devicePixelRatio || 1, profile.dpr);
  const cap = Math.sqrt(profile.budget / Math.max(1, w * h));
  return Math.max(0.75, Math.min(dpr, cap));
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
