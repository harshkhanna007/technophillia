/* All GLSL lives here. Colours are treated as linear; the composer / colorspace chunk handles output. */

export const HALO = '4.0';

export const GLSL_COMMON = /* glsl */ `
float hash11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float sdBox(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdHex(vec2 p, float r){
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}
float sdTri(vec2 p, float r){
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}
`;

/* ───────────────────────── traces (ribbons) ───────────────────────── */
export const TRACE_VERT = /* glsl */ `
attribute vec2 aNormal;
attribute vec4 aA; // side, t, halfWidth, brightness
attribute vec4 aB; // seed, kind, u(world length along line), total length
varying vec4 vA;
varying vec4 vB;
void main(){
  vA = aA;
  vB = aB;
  vec3 p = position + vec3(aNormal * aA.x * aA.z * ${HALO}, 0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

export const TRACE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uProgress;
uniform float uPulse;
uniform float uPulseAmp;
uniform float uDim;
uniform float uBoost;
uniform float uIdle;
uniform float uGrow;
uniform float uGhost;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uAccent;
varying vec4 vA;
varying vec4 vB;
void main(){
  float side = vA.x;
  float t = vA.y;
  float bright = vA.w;
  float seed = vB.x;
  float kind = vB.y;
  float u = vB.z;
  float total = vB.w;
  float d = abs(side);
  float core = exp(-d * d * 20.0);
  float halo = exp(-d * d * 3.5);
  float prof = core + halo * 0.2;
  vec3 col;
  if (uGhost > 0.5) {
    float reveal = smoothstep(t, t + 0.012, uProgress);
    if (reveal < 0.003) discard;
    float ph = fract(u * 2.6 - uTime * 0.12);
    float dash = smoothstep(0.1, 0.3, ph) * (1.0 - smoothstep(0.55, 0.8, ph));
    float head = exp(-max(uProgress - t, 0.0) * 26.0);
    float I = (core * 0.9 + halo * 0.16) * reveal * (0.11 + 0.2 * dash + head * 0.9);
    col = mix(uColA, uColB, t) * I * uDim * uBoost;
  } else {
    float reveal = smoothstep(t, t + 0.004, uProgress);
    if (reveal < 0.003) discard;
    float behind = max(uProgress - t, 0.0);
    float head = exp(-behind * 55.0) * uGrow;
    float trail = exp(-behind * 6.5) * 0.5 * uGrow;
    float pb = uPulse - t;
    float pulse = pb > 0.0 ? (exp(-pb * 40.0) + exp(-pb * 6.0) * 0.35) * uPulseAmp : 0.0;
    float km = mix(1.0, 0.6, step(0.5, kind));
    float energy = (head + trail + pulse) * km;
    float endFade = kind > 0.5 ? smoothstep(0.0, 0.2, u) * smoothstep(0.0, 0.2, total - u) : 1.0;
    float f = fract(u * 0.2 - uTime * 0.4 + seed * 9.0);
    float bead = pow(smoothstep(0.88, 1.0, f), 2.0) * step(0.5, fract(seed * 13.7)) * uIdle;
    vec3 base = mix(uColA, uColB, clamp(t * 0.7 + fract(seed * 3.1) * 0.35, 0.0, 1.0));
    vec3 hot = mix(uAccent, vec3(1.0), 0.7);
    col = base * (0.2 + 0.6 * bright) * uDim * uBoost;
    col += hot * (energy * 1.9 + bead * 0.8 * bright * uDim);
    col += base * energy * 0.9;
    col *= prof * endFade * reveal;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/* ───────────────────────── parts (instanced SDF components) ───────────────────────── */
export const PART_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iSize; // half w, half h, rotation, shape
attribute vec4 iMeta; // t, brightness, seed, mix
uniform float uProgress;
varying vec2 vP;
varying vec2 vExt;
varying vec4 vSize;
varying vec4 vMeta;
void main(){
  float pop = smoothstep(iMeta.x, iMeta.x + 0.03, uProgress);
  float s = pop * (1.0 + 0.55 * sin(pop * 3.14159) * (1.0 - pop) * 2.0);
  vec2 ext = iSize.xy + vec2(max(iSize.x, iSize.y) * 1.2 + 0.05);
  vec2 local = position.xy * ext;
  float c = cos(iSize.z);
  float sn = sin(iSize.z);
  vec2 rotated = vec2(c * local.x - sn * local.y, sn * local.x + c * local.y) * s;
  vP = local;
  vExt = ext;
  vSize = iSize;
  vMeta = iMeta;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(iPos + vec3(rotated, 0.0), 1.0);
  if (pop < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const PART_FRAG = /* glsl */ `
uniform float uTime;
uniform float uProgress;
uniform float uDim;
uniform float uBoost;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uAccent;
varying vec2 vP;
varying vec2 vExt;
varying vec4 vSize;
varying vec4 vMeta;
${GLSL_COMMON}
void main(){
  vec2 p = vP;
  vec2 sz = vSize.xy;
  float shape = vSize.w;
  float seed = vMeta.z;
  float r = min(sz.x, sz.y);
  float flash = exp(-max(uProgress - vMeta.x, 0.0) * 11.0);
  float d = 1e3;
  float solid = 0.0;
  float blink = 1.0;
  if (shape < 0.5) {
    d = length(p) - r * 0.55;
    solid = 1.0;
  } else if (shape < 1.5) {
    d = abs(length(p) - r * 0.95) - r * 0.13;
  } else if (shape < 2.5) {
    d = length(p) - r * 0.5;
    solid = 1.0;
    blink = 0.5 + 0.5 * sin(uTime * (1.6 + seed * 4.0) + seed * 40.0);
  } else if (shape < 3.5) {
    float box = sdBox(p, sz);
    float outline = abs(box) - 0.011;
    float die = sdBox(p, sz * 0.52) - 0.004;
    float px = (fract((p.x / (2.0 * sz.x)) * 4.0 + 0.5) - 0.5) * (sz.x * 0.5);
    float pins = sdBox(vec2(px, abs(p.y) - sz.y - 0.02), vec2(0.011, 0.028));
    pins = max(pins, abs(p.x) - sz.x * 0.92);
    float led = length(p - vec2(sz.x * 0.62, 0.0)) - sz.y * 0.22;
    d = min(min(outline, pins), min(die + 0.0, led));
    solid = 0.0;
    blink = 0.65 + 0.35 * sin(uTime * 2.0 + seed * 30.0) * step(0.0, -led + 0.02);
  } else if (shape < 4.5) {
    vec2 q = vec2(p.x + p.y, p.x - p.y) * 0.7071;
    d = sdBox(q, vec2(r * 0.55));
    solid = 1.0;
  } else if (shape < 5.5) {
    d = abs(sdHex(p, r * 0.95)) - r * 0.1;
    float dotc = length(p) - r * 0.2;
    d = min(d, dotc);
  } else if (shape < 6.5) {
    d = abs(sdBox(p, vec2(r * 0.85))) - r * 0.14;
    d = min(d, length(p) - r * 0.2);
  } else if (shape < 7.5) {
    d = sdTri(p * vec2(1.0, -1.0), r * 0.7);
    solid = 1.0;
  } else if (shape < 8.5) {
    d = min(sdBox(p, vec2(r * 0.9, r * 0.16)), sdBox(p, vec2(r * 0.16, r * 0.9)));
    solid = 1.0;
  } else {
    d = min(abs(length(p) - r * 0.95) - r * 0.11, length(p) - r * 0.32);
  }
  float ew = max(fwidth(d), 1e-4);
  float a = 1.0 - smoothstep(-ew, ew, d);
  vec2 qe = abs(p) / vExt;
  float fadeEdge = 1.0 - smoothstep(0.35, 1.0, max(qe.x, qe.y));
  float glow = exp(-max(d, 0.0) / (r * 0.7 + 0.006)) * 0.5 * fadeEdge;
  vec3 tone = mix(mix(uColA, uColB, fract(seed * 7.3)), uAccent, vMeta.w);
  vec3 hot = mix(uAccent, vec3(1.0), 0.75);
  float I = (a * (0.7 + 0.6 * vMeta.y) + glow * 0.55) * blink * uDim * uBoost;
  vec3 col = tone * I + hot * flash * (a * 2.4 + glow * 0.8);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/* ───────────────────────── node markers ───────────────────────── */
export const MARKER_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iColA;
attribute vec3 iAccent;
attribute vec4 iState; // vis, act, hover, flare
attribute vec4 iInfo;  // size, seed, depth, -
varying vec2 vQ;
varying vec3 vColA;
varying vec3 vAccent;
varying vec4 vState;
varying vec4 vInfo;
void main(){
  vQ = position.xy * 2.4;
  vColA = iColA;
  vAccent = iAccent;
  vState = iState;
  vInfo = iInfo;
  float s = iInfo.x * 2.4 * (0.35 + 0.65 * smoothstep(0.0, 1.0, iState.x));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(iPos + vec3(position.xy * s, 0.0), 1.0);
  if (iState.x < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const MARKER_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vQ;
varying vec3 vColA;
varying vec3 vAccent;
varying vec4 vState;
varying vec4 vInfo;
void main(){
  vec2 q = vQ;
  float r = length(q);
  float ang = atan(q.y, q.x);
  float TAU = 6.28318530718;
  float vis = vState.x;
  float act = vState.y;
  float hov = vState.z;
  float flare = min(vState.w, 1.3);
  float seed = vInfo.y;
  float breathe = 0.5 + 0.5 * sin(uTime * 1.6 + seed * 6.28);
  float ringR = mix(0.4, 0.34, act) * (1.0 + 0.1 * hov + 0.05 * breathe * (1.0 - act));
  float ring = exp(-pow((r - ringR) / 0.04, 2.0));
  float dotR = mix(0.1, 0.2, act) * (1.0 + hov * 0.45);
  float dotc = smoothstep(dotR, dotR * 0.45, r);
  float spin = (0.12 + 0.5 * hov + act * 0.2) * (mod(floor(seed * 10.0), 2.0) * 2.0 - 1.0);
  float dashed = step(0.5, fract(ang / TAU * 14.0 + uTime * spin));
  float ring2 = exp(-pow((r - 0.8) / 0.022, 2.0)) * dashed * (0.28 + 0.55 * hov + 0.25 * act);
  float arcs = exp(-pow((r - 0.62) / 0.03, 2.0)) * step(0.4, fract(ang / TAU * 3.0 - uTime * 0.22)) * act;
  float tick = step(0.86, r) * step(r, 0.95) * step(0.82, fract(ang / TAU * 28.0 + uTime * 0.03)) * (act * 0.6 + hov * 0.4);
  float halo = exp(-r * r * 8.0) * (0.16 + 0.5 * act + 0.45 * hov + flare * 0.8);
  float core = exp(-r * r * 60.0) * (act * 1.7 + hov * 0.6);
  vec3 base = vColA;
  vec3 hot = mix(vAccent, vec3(1.0), 0.8);
  vec3 col = base * (ring * (0.75 + 0.7 * hov) + ring2 + arcs + tick + halo * 0.55 + dotc * (0.7 + act * 0.5));
  col += hot * (core + flare * exp(-r * r * 22.0) * 1.5);
  col *= 1.0 - smoothstep(1.4, 2.3, r);
  gl_FragColor = vec4(col * vis, 1.0);
  #include <colorspace_fragment>
}
`;

/* ───────────────────────── seed ───────────────────────── */
export const SEED_VERT = /* glsl */ `
varying vec2 vP;
uniform float uExtent;
void main(){
  vP = position.xy * uExtent;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy * uExtent, 0.0, 1.0);
}
`;

export const SEED_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAppear;
uniform float uEnergy;
uniform float uFlare;
uniform float uHover;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uHot;
uniform float uExtent;
varying vec2 vP;
${GLSL_COMMON}
float ringp(float r, float R, float w){ return exp(-pow((r - R) / w, 2.0)); }
void main(){
  vec2 p = vP;
  float T = uTime;
  float breathe = 1.0 + 0.06 * sin(T * 1.7);
  float r = length(p) / (breathe * (0.55 + 0.45 * uAppear));
  float a = atan(p.y, p.x);
  float TAU = 6.28318530718;
  float plasma = 0.5 + 0.5 * sin(a * 3.0 + T * 0.7 + sin(r * 14.0 - T * 1.3) * 2.0);
  vec3 col = vec3(0.0);
  float core = exp(-r * r * 60.0);
  col += uHot * core * (1.5 + 0.4 * sin(T * 2.1) + uEnergy * 1.2 + uHover * 0.5);
  col += mix(uColA, uColB, plasma) * exp(-r * r * 16.0) * (0.5 + 0.35 * plasma + uEnergy * 0.4);
  // circuit rings
  for (int k = 0; k < 5; k++) {
    float fk = float(k);
    float R = 0.24 + 0.115 * fk;
    float seg = 9.0 + fk * 6.0;
    float dir = mod(fk, 2.0) * 2.0 - 1.0;
    float cell = floor((a / TAU + T * 0.018 * dir * (1.0 + fk * 0.3)) * seg);
    float h = hash11(cell + fk * 17.3);
    float on = step(0.32, h);
    float band = ringp(r, R, 0.0065 + 0.0015 * fk);
    float flick = 0.55 + 0.45 * step(0.82, h) * (0.5 + 0.5 * sin(T * 3.0 + cell));
    col += mix(uColA, uColB, fk / 4.0) * band * on * flick * (0.85 + uEnergy) * (1.0 - fk * 0.14);
  }
  // radial traces with nodes
  float spokes = 14.0;
  float sa = fract(a / TAU * spokes + 0.5) - 0.5;
  float sid = floor(a / TAU * spokes + 0.5);
  float sh = hash11(sid * 3.7);
  float spoke = exp(-pow(sa * r * 28.0, 2.0)) * smoothstep(0.2, 0.26, r) * (1.0 - smoothstep(0.7, 0.82, r)) * step(0.4, sh);
  float flow = pow(smoothstep(0.85, 1.0, fract(r * 1.8 - T * 0.35 + sh * 4.0)), 2.0);
  col += mix(uColA, uHot, 0.35) * spoke * (0.18 + flow * 1.2);
  // expanding pulses
  float pr = fract(T * 0.2);
  col += uColA * ringp(r, 0.2 + pr * 1.3, 0.016) * (1.0 - pr) * 0.7;
  float fl = clamp(uFlare, 0.0, 1.0);
  col += uHot * ringp(r, 0.2 + fl * 1.5, 0.02 + 0.03 * fl) * (1.0 - fl) * step(0.0001, uFlare) * 1.4;
  // orbiting beads
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float ba = T * (0.55 + fk * 0.22) * (mod(fk, 2.0) * 2.0 - 1.0) + fk * 2.1;
    vec2 bp = vec2(cos(ba), sin(ba)) * (0.37 + fk * 0.115);
    col += uHot * exp(-dot(p / breathe - bp, p / breathe - bp) * 900.0) * 1.3;
  }
  col *= (1.0 - smoothstep(0.75, 1.0, length(p) / uExtent)) * uAppear;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/* ───────────────────────── background circuitry ───────────────────────── */
export const BG_VERT = /* glsl */ `
varying vec2 vWorld;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xy;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const BG_FRAG = /* glsl */ `
uniform float uTime;
uniform vec4 uLights[8];
uniform vec2 uFocus;
uniform vec3 uTintA;
uniform vec3 uTintB;
uniform float uReveal;
varying vec2 vWorld;
${GLSL_COMMON}
float seg(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
vec3 circuit(vec2 p, float scale, float salt){
  vec2 q = p * scale;
  vec2 id = floor(q);
  vec2 f = fract(q) - 0.5;
  float eR = step(0.56, hash21(id + vec2(0.5, 0.0) + salt));
  float eL = step(0.56, hash21(id + vec2(-0.5, 0.0) + salt));
  float eU = step(0.56, hash21(id + vec2(0.0, 0.5) + salt + 7.1));
  float eD = step(0.56, hash21(id + vec2(0.0, -0.5) + salt + 7.1));
  float d = 1e3;
  if (eR > 0.5) d = min(d, seg(f, vec2(0.0), vec2(0.5, 0.0)));
  if (eL > 0.5) d = min(d, seg(f, vec2(0.0), vec2(-0.5, 0.0)));
  if (eU > 0.5) d = min(d, seg(f, vec2(0.0), vec2(0.0, 0.5)));
  if (eD > 0.5) d = min(d, seg(f, vec2(0.0), vec2(0.0, -0.5)));
  float deg = eR + eL + eU + eD;
  float lw = 0.012;
  float line = smoothstep(lw + 0.012, lw, d) * step(0.5, deg);
  float nd = abs(length(f) - 0.08) - 0.009;
  float node = ((deg > 0.5 && deg < 1.5) || deg > 2.5) ? smoothstep(0.012, 0.0, nd) : 0.0;
  float phase = hash21(id + salt) * 10.0 - uTime * 0.3;
  float flow = smoothstep(0.88, 1.0, fract(phase));
  return vec3(line, node, flow);
}
void main(){
  float L = 0.0;
  for (int i = 0; i < LIGHTS; i++) {
    vec4 l = uLights[i];
    vec2 dd = vWorld - l.xy;
    L += l.w * exp(-dot(dd, dd) / (l.z * l.z));
  }
  vec3 c1 = circuit(vWorld, 0.78, 0.0);
  vec3 c2 = circuit(vWorld + 13.7, 0.27, 5.0);
  float pat = (c1.x * 0.6 + c1.y * 1.0 + c1.z * c1.x * 1.6) + 0.75 * (c2.x * 0.5 + c2.y * 0.8 + c2.z * c2.x * 1.2);
  vec2 df = vWorld - uFocus;
  float focusFade = exp(-dot(df, df) / (30.0 * 30.0));
  vec3 tint = mix(uTintA, uTintB, 0.5 + 0.5 * sin(vWorld.x * 0.07 + vWorld.y * 0.05));
  float I = (0.0012 * uReveal + L * 0.085) * pat * focusFade;
  gl_FragColor = vec4(tint * I, 1.0);
  #include <colorspace_fragment>
}
`;

/* ───────────────────────── ambient particles ───────────────────────── */
export const PARTICLE_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uFlow;
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform float uPx;
uniform float uActivity;
varying float vAlpha;
varying vec3 vTone;
void main(){
  vec3 base = (aSeed.xyz - 0.5) * uBox;
  float sp = 0.25 + aSeed.w;
  vec3 drift = vec3(sin(uTime * 0.07 * sp + aSeed.x * 40.0), cos(uTime * 0.06 * sp + aSeed.y * 40.0), 0.0) * 0.9;
  drift += vec3(0.12, 0.2, 0.0) * uFlow * sp;
  vec3 p = base + drift;
  vec3 rel = p - uCenter;
  rel = mod(rel + uBox * 0.5, uBox) - uBox * 0.5;
  p = uCenter + rel;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = -mv.z;
  float size = (0.6 + aSeed.w * 2.2) * (1.0 + uActivity * 0.8);
  gl_PointSize = size * uPx * (22.0 / max(depth, 1.0));
  float edge = 1.0 - pow(length(rel.xy / (uBox.xy * 0.5)), 3.0);
  float tw = 0.55 + 0.45 * sin(uTime * (0.6 + aSeed.w * 2.0) + aSeed.x * 60.0);
  vAlpha = clamp(edge, 0.0, 1.0) * tw * (0.35 + aSeed.w * 0.65) * (1.0 + uActivity * 1.4);
  vTone = mix(vec3(0.25, 0.6, 1.0), vec3(0.7, 0.45, 1.0), fract(aSeed.x * 5.0));
}
`;

export const PARTICLE_FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vTone;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float r = dot(c, c) * 4.0;
  float a = exp(-r * 5.0) * vAlpha;
  gl_FragColor = vec4(vTone * a * 0.7, 1.0);
  #include <colorspace_fragment>
}
`;

/* ───────────────────────── sparks (event driven bursts) ───────────────────────── */
export const SPARK_VERT = /* glsl */ `
attribute vec3 aOrigin;
attribute vec3 aVel;
attribute vec4 aLife; // birth, life, size, -
attribute vec3 aColor;
uniform float uTime;
uniform float uPx;
varying float vAlpha;
varying vec3 vColor;
void main(){
  float age = uTime - aLife.x;
  float k = age / aLife.y;
  if (age < 0.0 || k > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vAlpha = 0.0;
    vColor = vec3(0.0);
    return;
  }
  float drag = 1.0 - exp(-age * 2.6);
  vec3 p = aOrigin + aVel * (drag / 2.6);
  vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aLife.z * uPx * (1.0 - k * 0.6) * (24.0 / max(-mv.z, 1.0));
  vAlpha = pow(1.0 - k, 1.6);
  vColor = aColor;
}
`;

export const SPARK_FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float r = dot(c, c) * 4.0;
  float a = exp(-r * 4.0) * vAlpha;
  float hotc = exp(-r * 16.0) * vAlpha;
  gl_FragColor = vec4(vColor * a * 1.6 + vec3(hotc), 1.0);
  #include <colorspace_fragment>
}
`;

/* ───────────────────────── energy orb ───────────────────────── */
export const ORB_VERT = /* glsl */ `
varying vec2 vUv;
uniform float uSize;
uniform vec3 uPos;
void main(){
  vUv = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(uPos + vec3(position.xy * uSize, 0.0), 1.0);
}
`;

export const ORB_FRAG = /* glsl */ `
uniform float uAmp;
uniform vec2 uDir;
uniform vec3 uColor;
uniform float uTime;
varying vec2 vUv;
void main(){
  vec2 p = vUv;
  float x = dot(p, uDir);
  float y = dot(p, vec2(-uDir.y, uDir.x));
  float r2 = x * x + y * y;
  float core = exp(-r2 * 160.0);
  float halo = exp(-r2 * 14.0);
  float tail = step(x, 0.0) * exp(-y * y * 700.0) * exp(x * 3.2);
  float star = (exp(-abs(y) * 55.0) * exp(-abs(x) * 5.0) + exp(-abs(x) * 55.0) * exp(-abs(y) * 5.0)) * 0.45;
  float flick = 0.9 + 0.1 * sin(uTime * 40.0);
  vec3 col = vec3(1.0) * core * 2.6 + uColor * (halo * 0.9 + tail * 1.3 + star) * flick;
  gl_FragColor = vec4(col * uAmp, 1.0);
  #include <colorspace_fragment>
}
`;

/* ───────────────────────── shock ring ───────────────────────── */
export const RING_VERT = /* glsl */ `
varying vec2 vUv;
uniform float uSize;
uniform vec3 uPos;
void main(){
  vUv = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(uPos + vec3(position.xy * uSize, 0.0), 1.0);
}
`;

export const RING_FRAG = /* glsl */ `
uniform float uAge;
uniform vec3 uColor;
varying vec2 vUv;
void main(){
  float r = length(vUv);
  float e = 1.0 - pow(1.0 - uAge, 3.0);
  float R = 0.08 + e * 0.9;
  float w = 0.02 + 0.05 * (1.0 - uAge);
  float ring = exp(-pow((r - R) / w, 2.0));
  float R2 = 0.06 + e * 0.62;
  float ring2 = exp(-pow((r - R2) / (w * 0.6), 2.0)) * 0.6;
  float fade = pow(1.0 - uAge, 1.4);
  vec3 col = uColor * (ring + ring2) * fade * 1.4 + vec3(1.0) * ring * fade * 0.5;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;
