export type Quality = 'high' | 'medium' | 'low' | 'min';

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
  /** weak device: solid glass instead of blur, plain fades (see `data-q="lite"`) */
  lite: boolean;
  /** half-float post buffers (8 bytes a pixel); off = 8-bit with dithering (4 bytes a pixel, far lighter on shared memory) */
  hdr: boolean;
  bloomLevels: number;
  /** how many signature moments may play at once */
  moments: number;
  /** leaves per node sprig */
  leaves: number;
  /** twigs fork a second time */
  forks: boolean;
}

export const PROFILES: Record<Quality, QualityProfile> = {
  high: { dpr: 2, budget: 5.0e6, bloom: true, bloomScale: 1, particles: 1200, sparks: 1600, detail: 1, bgLights: 8, chroma: true, lite: false, hdr: true, bloomLevels: 8, moments: 8, leaves: 3, forks: true },
  medium: { dpr: 1.5, budget: 2.4e6, bloom: true, bloomScale: 0.75, particles: 640, sparks: 800, detail: 0.75, bgLights: 6, chroma: false, lite: false, hdr: true, bloomLevels: 6, moments: 6, leaves: 3, forks: true },
  low: { dpr: 1.25, budget: 1.4e6, bloom: true, bloomScale: 0.5, particles: 260, sparks: 420, detail: 0.5, bgLights: 4, chroma: false, lite: true, hdr: true, bloomLevels: 4, moments: 5, leaves: 2, forks: false },
  // 2 to 3GB of RAM, or integrated graphics sharing it: the lightest look that still reads as the same tree
  min: { dpr: 1, budget: 0.95e6, bloom: true, bloomScale: 0.5, particles: 120, sparks: 220, detail: 0.35, bgLights: 4, chroma: false, lite: true, hdr: false, bloomLevels: 3, moments: 3, leaves: 2, forks: false },
};

const ORDER: Quality[] = ['min', 'low', 'medium', 'high'];
const lower = (q: Quality, cap: Quality): Quality => (ORDER.indexOf(q) <= ORDER.indexOf(cap) ? q : cap);

/** `?q=min|low|medium|high` pins a tier (handy for testing a weak device on a strong one) */
function pinned(): Quality | null {
  try {
    const q = new URLSearchParams(window.location.search).get('q');
    return q === 'min' || q === 'low' || q === 'medium' || q === 'high' ? q : null;
  } catch {
    return null;
  }
}

type Nav = Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };

/** Chrome reports 0.25 to 8 (GB, rounded down to a power of two, so 2 means 2 to 3GB); other browsers say nothing, so assume capable */
function memoryGb(): number {
  return (navigator as Nav).deviceMemory ?? 8;
}

export function detectQuality(): Quality {
  if (typeof navigator === 'undefined') return 'medium';
  const forced = pinned();
  if (forced) return forced;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 900);
  const cores = navigator.hardwareConcurrency || 4;
  const mem = memoryGb();
  const saveData = (navigator as Nav).connection?.saveData === true;
  if (mem <= 2) return 'min';
  if (mobile) return cores <= 4 || mem <= 4 || saveData ? 'low' : 'medium';
  if (cores <= 4 && mem <= 4) return 'low';
  if (cores <= 4 || mem <= 4 || saveData) return 'medium';
  return 'high';
}

/** software rasterisers and old GPUs: nothing here can hold the look at speed */
const WEAK_GPU = /swiftshader|llvmpipe|softpipe|software|basic render|mali-(4|t6|t7|t8[0-4])|adreno \(tm\) ?[2-4]\d\d\b|powervr (sgx|ge8)|intel\(r\) (hd|uhd) graphics (2|3|4|5)\d{2,3}\b|intel\(r\) hd graphics$|vivante|videocore/i;
/** GPUs that share system memory with the page (Apple's are fast enough to count as discrete) */
const INTEGRATED_GPU = /intel(?!.*\barc\b)|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics|mali|adreno|powervr|videocore|vivante/i;
const FASTER_INTEGRATED = /iris\(r\) xe|iris xe|iris pro|radeon\(tm\) (780m|760m|740m|680m|660m|610m)/i;

/** the tier guessed from the device, sharpened by what the GPU says it is */
export function refineQuality(q: Quality, gl: WebGLRenderingContext | WebGL2RenderingContext): Quality {
  if (pinned()) return q;
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    if (WEAK_GPU.test(name)) return 'min';
    // a tiny texture ceiling is a reliable tell for a very old GPU
    if ((gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) < 4096) return ORDER[Math.max(0, ORDER.indexOf(q) - 1)];
    if (INTEGRATED_GPU.test(name)) {
      const capped = lower(q, FASTER_INTEGRATED.test(name) ? 'medium' : 'low');
      // integrated graphics with little RAM share that RAM with the page: take the lightest tier
      return capped === 'low' && memoryGb() <= 4 ? 'min' : capped;
    }
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
