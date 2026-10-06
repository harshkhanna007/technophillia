/* All GLSL lives here. Colours are treated as linear; the composer / colorspace chunk handles output. */

export const HALO = '5.0';

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
  // light-wire profile: hair-thin hot core, saturated halo, very wide soft aura
  float core = exp(-d * d * 34.0);
  float halo = exp(-d * d * 4.2);
  float aura = exp(-d * d * 1.3);
  float prof = (core + halo * 0.24 + aura * 0.08) * (1.0 - smoothstep(0.45, 1.0, d));
  vec3 col;
  if (uGhost > 0.5) {
    float reveal = smoothstep(t, t + 0.012, uProgress);
    if (reveal < 0.003) discard;
    float ph = fract(u * 2.4 - uTime * 0.1);
    float dash = smoothstep(0.1, 0.3, ph) * (1.0 - smoothstep(0.55, 0.8, ph));
    float head = exp(-max(uProgress - t, 0.0) * 24.0);
    float I = (core * 0.8 + halo * 0.14) * (1.0 - smoothstep(0.45, 1.0, d)) * reveal * (0.055 + 0.15 * dash + head * 0.9);
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
    vec3 hot = mix(uAccent, vec3(1.0), 0.78);
    float rest = (0.065 + 0.4 * bright) * uDim * uBoost;
    col = base * rest;
    col = mix(col, hot * rest * 1.5, core * 0.38);
    col += hot * (energy * 2.2 + bead * 1.0 * bright * uDim);
    col += base * energy * 1.1;
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
  float blink = 1.0;
  if (shape < 0.5) {
    d = length(p) - r * 0.55;
  } else if (shape < 1.5) {
    d = abs(length(p) - r * 0.95) - r * 0.13;
  } else if (shape < 2.5) {
    d = length(p) - r * 0.5;
    blink = 0.5 + 0.5 * sin(uTime * (1.6 + seed * 4.0) + seed * 40.0);
  } else if (shape < 3.5) {
    float box = sdBox(p, sz);
    float outline = abs(box) - 0.011;
    float die = sdBox(p, sz * 0.52) - 0.004;
    float px = (fract((p.x / (2.0 * sz.x)) * 4.0 + 0.5) - 0.5) * (sz.x * 0.5);
    float pins = sdBox(vec2(px, abs(p.y) - sz.y - 0.02), vec2(0.011, 0.028));
    pins = max(pins, abs(p.x) - sz.x * 0.92);
    float led = length(p - vec2(sz.x * 0.62, 0.0)) - sz.y * 0.22;
    d = min(min(outline, pins), min(die, led));
    blink = 0.65 + 0.35 * sin(uTime * 2.0 + seed * 30.0) * step(0.0, -led + 0.02);
  } else if (shape < 4.5) {
    vec2 q = vec2(p.x + p.y, p.x - p.y) * 0.7071;
    d = sdBox(q, vec2(r * 0.55));
  } else if (shape < 5.5) {
    d = abs(sdHex(p, r * 0.95)) - r * 0.1;
    d = min(d, length(p) - r * 0.2);
  } else if (shape < 6.5) {
    d = abs(sdBox(p, vec2(r * 0.85))) - r * 0.14;
    d = min(d, length(p) - r * 0.2);
  } else if (shape < 7.5) {
    d = sdTri(p * vec2(1.0, -1.0), r * 0.7);
  } else if (shape < 8.5) {
    d = min(sdBox(p, vec2(r * 0.9, r * 0.16)), sdBox(p, vec2(r * 0.16, r * 0.9)));
  } else {
    d = min(abs(length(p) - r * 0.95) - r * 0.11, length(p) - r * 0.32);
  }
  float ew = max(fwidth(d), 1e-4);
  float a = 1.0 - smoothstep(-ew, ew, d);
  vec2 qe = abs(p) / vExt;
  float fadeEdge = 1.0 - smoothstep(0.35, 1.0, max(qe.x, qe.y));
  float glow = exp(-max(d, 0.0) / (r * 0.8 + 0.006)) * 0.55 * fadeEdge;
  vec3 tone = mix(mix(uColA, uColB, fract(seed * 7.3)), uAccent, vMeta.w);
  vec3 hot = mix(uAccent, vec3(1.0), 0.8);
  float I = (a * (0.6 + 0.6 * vMeta.y) + glow * 0.6) * blink * uDim * uBoost;
  vec3 col = mix(tone, hot, a * 0.3) * I + hot * flash * (a * 2.6 + glow * 1.0);
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
  float vis = vState.x;
  float act = vState.y;
  float hov = vState.z;
  float flare = min(vState.w, 1.3);
  float seed = vInfo.y;
  float breathe = 0.5 + 0.5 * sin(uTime * 1.4 + seed * 6.28);

  // luminous bead
  float coreR = mix(0.085, 0.17, act) * (1.0 + 0.55 * hov);
  float core = smoothstep(coreR, coreR * 0.3, r);
  float coreGlow = exp(-r * r * mix(64.0, 28.0, act));

  // one hairline ring, breathing while waiting
  float ringR = mix(0.4, 0.33, act) * (1.0 + 0.18 * hov + 0.045 * breathe * (1.0 - act));
  float ring = exp(-pow((r - ringR) / (0.016 + 0.01 * hov), 2.0)) * (0.3 + 0.4 * hov + 0.45 * act);

  // two orbiting arcs
  float spin = (0.3 + 1.0 * hov + 0.3 * act) * (mod(floor(seed * 10.0), 2.0) * 2.0 - 1.0);
  float arcMask = smoothstep(0.55, 0.92, cos(ang - uTime * spin + seed * 6.0)) + smoothstep(0.55, 0.92, cos(ang - uTime * spin + seed * 6.0 + 3.14159));
  float arcs = exp(-pow((r - 0.66) / 0.011, 2.0)) * arcMask * (0.22 + 0.55 * hov + 0.35 * act);

  float halo = exp(-r * r * 7.5) * (0.1 + 0.4 * act + 0.32 * hov + flare * 0.7);

  vec3 hot = mix(vAccent, vec3(1.0), 0.82);
  vec3 col = vColA * (ring + arcs + halo * 0.85 + coreGlow * 0.45);
  col += mix(vColA, hot, 0.55) * core * (0.85 + act * 0.6);
  col += hot * (coreGlow * (act * 1.3 + hov * 0.5) + flare * exp(-r * r * 18.0) * 1.2);
  col *= 1.0 - smoothstep(1.4, 2.3, r);
  gl_FragColor = vec4(col * vis, 1.0);
  #include <colorspace_fragment>
}
`;

/* ───────────────────────── seed: an armillary of light ───────────────────────── */
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
uniform float uScale;
uniform vec2 uDirs[8];
uniform int uDirCount;
varying vec2 vP;
const float TAU = 6.28318530718;
vec2 rot(vec2 p, float a){ float c = cos(a); float s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }

// tilted orbit: returns hairline intensity, depth (-1 behind .. 1 in front)
float orbit(vec2 p, float R, float tilt, float rotA, float w, out float depth){
  vec2 q = rot(p, -rotA);
  float ct = cos(tilt);
  q.y /= ct;
  float d = abs(length(q) - R) * mix(1.0, ct, 0.6);
  depth = q.y / R;
  return exp(-pow(d / w, 2.0));
}

vec2 orbitPoint(float R, float tilt, float rotA, float t){
  vec2 b = vec2(cos(t), sin(t) * cos(tilt)) * R;
  return rot(b, rotA);
}

void main(){
  float T = uTime;
  float ap = 0.45 + 0.55 * uAppear;
  float breathe = 1.0 + 0.035 * sin(T * 1.6);
  vec2 p = vP / (ap * breathe * uScale);
  float r = length(p);
  float a = atan(p.y, p.x);
  vec3 col = vec3(0.0);

  // atmosphere
  col += uColB * exp(-r * r * 12.0) * 0.17 + uColA * exp(-r * 3.4) * 0.04 * (1.0 + uEnergy);

  // the seed itself: white-hot kernel wrapped in a living plasma
  float core = exp(-r * r * 260.0);
  float swirl = 0.5 + 0.5 * sin(a * 3.0 + T * 0.8 + sin(r * 34.0 - T * 1.7) * 1.7);
  col += uHot * core * (2.1 + uEnergy * 1.6 + uHover * 0.7);
  col += mix(uColA, uColB, swirl) * exp(-r * r * 75.0) * (0.75 + 0.35 * swirl);

  // glass shell with a chromatic fringe
  for (int c = 0; c < 3; c++) {
    float rr = 0.122 + float(c) * 0.0065;
    float ring = exp(-pow((r - rr) / 0.0045, 2.0));
    vec3 tint = c == 0 ? vec3(1.0, 0.32, 0.62) : (c == 1 ? vec3(0.3, 1.0, 0.82) : vec3(0.38, 0.55, 1.0));
    col += tint * ring * 0.55;
  }

  // three precessing orbits, each with a bead of light
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float R = 0.3 + 0.16 * fk;
    float tilt = 1.18 - 0.22 * fk + 0.14 * sin(T * 0.2 + fk * 1.3);
    float rotA = T * (0.085 + 0.035 * fk) * (mod(fk, 2.0) * 2.0 - 1.0) + fk * 1.7;
    float depth;
    float o = orbit(p, R, tilt, rotA, 0.0042 + 0.0008 * fk, depth);
    float vis = 0.3 + 0.7 * smoothstep(-0.6, 0.8, depth);
    col += mix(uColA, uColB, fk / 2.0) * o * vis * (0.95 + uEnergy);
    float tb = T * (0.65 + 0.24 * fk) + fk * 2.1;
    vec2 bp = orbitPoint(R, tilt, rotA, tb);
    float bead = exp(-dot(p - bp, p - bp) * 1500.0);
    col += uHot * bead * (0.5 + 1.0 * smoothstep(-0.5, 0.9, sin(tb))) * 1.5;
  }

  // one sprout per branch direction, ending in a bead where the trace takes over
  for (int i = 0; i < 8; i++) {
    if (i >= uDirCount) break;
    vec2 dir = uDirs[i];
    float along = dot(p, dir);
    float perp = dot(p, vec2(-dir.y, dir.x));
    float w = 0.0042 + 0.003 * smoothstep(0.1, 0.5, along);
    float spike = exp(-pow(perp / w, 2.0)) * smoothstep(0.17, 0.25, along) * (1.0 - smoothstep(0.5, 0.62, along));
    float flow = pow(smoothstep(0.8, 1.0, fract(along * 2.2 - T * 0.55 + float(i) * 0.21)), 2.0);
    col += mix(uColA, uHot, 0.35) * spike * (0.35 + flow * 1.7 + uEnergy * 0.9);
    vec2 tip = dir * 0.6;
    col += uHot * exp(-dot(p - tip, p - tip) * 2800.0) * (0.75 + 0.25 * sin(T * 2.0 + float(i)));
  }

  // fine measuring scale and a ring of dust
  col += uColA * exp(-pow((r - 0.84) / 0.0028, 2.0)) * step(0.7, fract(a / TAU * 60.0)) * 0.14;
  col += uColB * exp(-pow((r - 0.93) / 0.004, 2.0)) * step(0.82, fract(a / TAU * 48.0 + T * 0.012)) * 0.3;

  // breathing wave and ignition flare
  float pr = fract(T * 0.16);
  col += uColA * exp(-pow((r - (0.2 + pr * 0.78)) / 0.009, 2.0)) * (1.0 - pr) * 0.3;
  float fl = clamp(uFlare, 0.0, 1.0);
  col += uHot * exp(-pow((r - (0.15 + fl * 0.95)) / (0.02 + 0.04 * fl), 2.0)) * (1.0 - fl) * step(0.0001, uFlare) * 1.6;

  col *= (1.0 - smoothstep(0.8, 1.0, length(vP) / uExtent)) * uAppear;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/* ───────────────────────── background: pure black, light fog, circuitry revealed by light ───────────────────────── */
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
uniform vec3 uLightCol[8];
uniform vec2 uFocus;
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
  float lw = 0.011;
  float line = smoothstep(lw + 0.01, lw, d) * step(0.5, deg);
  float nd = abs(length(f) - 0.075) - 0.008;
  float node = ((deg > 0.5 && deg < 1.5) || deg > 2.5) ? smoothstep(0.011, 0.0, nd) : 0.0;
  float phase = hash21(id + salt) * 10.0 - uTime * 0.3;
  float flow = smoothstep(0.88, 1.0, fract(phase));
  return vec3(line, node, flow);
}
void main(){
  float L = 0.0;
  vec3 fogCol = vec3(0.0);
  vec3 latCol = vec3(0.0);
  for (int i = 0; i < LIGHTS; i++) {
    vec4 l = uLights[i];
    vec2 dd = vWorld - l.xy;
    float d2 = dot(dd, dd);
    float g = exp(-d2 / (l.z * l.z));
    float f = exp(-d2 / (l.z * l.z * 2.4));
    L += l.w * g;
    latCol += uLightCol[i] * l.w * g;
    fogCol += uLightCol[i] * l.w * f;
  }
  vec3 tint = L > 0.001 ? latCol / L : vec3(0.3, 0.4, 0.7);
  vec3 c1 = circuit(vWorld, 0.78, 0.0);
  vec3 c2 = circuit(vWorld + 13.7, 0.27, 5.0);
  float deep = smoothstep(0.25, 1.1, L);
  float pat = (c1.x * 0.55 + c1.y * 1.0 + c1.z * c1.x * 1.5) + 0.8 * deep * (c2.x * 0.45 + c2.y * 0.8 + c2.z * c2.x * 1.1);
  vec2 df = vWorld - uFocus;
  float focusFade = exp(-dot(df, df) / (28.0 * 28.0));
  // true black away from light; circuitry and fog only exist where something illuminates them
  // darker overall: circuitry and haze exist only inside pools of light, and brighten steeply toward their source
  float lit = pow(clamp(L, 0.0, 3.0), 1.3);
  vec3 col = tint * (lit * 0.115) * pat * focusFade * uReveal + fogCol * 0.011 * focusFade * uReveal;
  gl_FragColor = vec4(col, 1.0);
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
uniform vec4 uLights[8];
uniform vec3 uLightCol[8];
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
  // dust catches light: it only really exists near the scene's emitters
  float lit = 0.0;
  vec3 litCol = vec3(0.0);
  for (int i = 0; i < LIGHTS; i++) {
    vec4 l = uLights[i];
    vec2 dd = p.xy - l.xy;
    float g = exp(-dot(dd, dd) / (l.z * l.z * 0.9)) * l.w;
    lit += g;
    litCol += uLightCol[i] * g;
  }
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = -mv.z;
  float size = (0.5 + aSeed.w * 1.9) * (1.0 + uActivity * 0.8) * (1.0 + lit * 0.7);
  gl_PointSize = size * uPx * (22.0 / max(depth, 1.0));
  float edge = 1.0 - pow(length(rel.xy / (uBox.xy * 0.5)), 3.0);
  float tw = 0.5 + 0.5 * sin(uTime * (0.5 + aSeed.w * 1.8) + aSeed.x * 60.0);
  vAlpha = clamp(edge, 0.0, 1.0) * tw * (0.25 + aSeed.w * 0.6) * (0.4 + uActivity * 1.2 + lit * 3.0);
  vTone = mix(vec3(0.62, 0.8, 1.0), vec3(0.9, 0.78, 1.0), fract(aSeed.x * 5.0));
  vTone = mix(vTone, litCol / max(lit, 0.001), clamp(lit * 1.4, 0.0, 0.85));
}
`;

export const PARTICLE_FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vTone;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float r = dot(c, c) * 4.0;
  float a = exp(-r * 6.0) * vAlpha;
  gl_FragColor = vec4(vTone * a * 0.55, 1.0);
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
  float core = exp(-r2 * 170.0);
  float halo = exp(-r2 * 13.0);
  float tail = step(x, 0.0) * exp(-y * y * 800.0) * exp(x * 3.0);
  float star = (exp(-abs(y) * 60.0) * exp(-abs(x) * 5.0) + exp(-abs(x) * 60.0) * exp(-abs(y) * 5.0)) * 0.5;
  float streak = exp(-abs(y) * 120.0) * exp(-abs(x) * 1.6) * 0.25;
  float flick = 0.92 + 0.08 * sin(uTime * 40.0);
  vec3 col = vec3(1.0) * core * 2.8 + uColor * (halo * 0.95 + tail * 1.4 + star + streak) * flick;
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
  float w = 0.014 + 0.04 * (1.0 - uAge);
  float ring = exp(-pow((r - R) / w, 2.0));
  float R2 = 0.06 + e * 0.62;
  float ring2 = exp(-pow((r - R2) / (w * 0.6), 2.0)) * 0.6;
  float fade = pow(1.0 - uAge, 1.4);
  vec3 col = uColor * (ring + ring2) * fade * 1.5 + vec3(1.0) * ring * fade * 0.55;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;
