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
    // a solid living bough: steady body plus a slow swell of light travelling toward the bud
    float sheen = pow(0.5 + 0.5 * sin(u * 0.5 - uTime * 0.85 + seed * 6.0), 3.0);
    float head = exp(-max(uProgress - t, 0.0) * 24.0);
    float body = 0.2 + 0.62 * sheen;
    float I = (core * 0.85 + halo * 0.4 + aura * 0.2) * (1.0 - smoothstep(0.45, 1.0, d)) * reveal * (body + head * 1.1);
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

  // a hairline tick ring just outside the main ring, like a dial
  float tickMask = step(0.55, fract(ang / 6.2831853 * 48.0 + 0.5));
  float ticks = exp(-pow((r - 0.52) / 0.007, 2.0)) * tickMask * (0.12 + 0.4 * hov + 0.25 * act);
  // anamorphic streak: a thin blade of light through the bead
  float streak = exp(-abs(q.y) * mix(52.0, 30.0, hov)) * exp(-abs(q.x) * 1.5) * (0.1 + 0.55 * hov + 0.5 * act + flare * 1.1);

  vec3 hot = mix(vAccent, vec3(1.0), 0.82);
  vec3 col = vColA * (ring + arcs + ticks + halo * 0.85 + coreGlow * 0.45);
  col += mix(vColA, hot, 0.55) * core * (0.85 + act * 0.6);
  col += hot * (coreGlow * (act * 1.3 + hov * 0.5) + flare * exp(-r * r * 18.0) * 1.2);
  col += mix(vColA, hot, 0.5) * streak;
  col *= 1.0 - smoothstep(1.4, 2.3, r);
  gl_FragColor = vec4(col * vis, 1.0);
  #include <colorspace_fragment>
}
`;

/* ───────────────────────── leaves: glass leaves that unfurl on the nodes and along the twigs ───────────────────────── */
/* Every leaf is one quad. In leaf space u runs base→tip (0..1 leaf lengths) and v runs across; the quad also covers the short
   stalk back to wherever the leaf is anchored. The fragment shader is shared: node sprigs and twig foliage differ only in how
   their vertex shader decides where a leaf stands. */
const LEAF_VARYINGS = /* glsl */ `
varying vec2 vP;
varying vec4 vShape; // length (world), half width, curl, stalk (in leaf lengths)
varying vec4 vState; // vis, act, hover, flare
varying vec3 vColA;
varying vec3 vAccent;
varying float vSeed;
`;

const LEAF_PLACE = /* glsl */ `
vec2 leafPlace(vec2 corner, vec2 anchor, float ang, float len, float stem) {
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 nrm = vec2(-dir.y, dir.x);
  vec2 c = corner * 0.5 + 0.5;
  float u = mix(-stem / len - 0.06, 1.2, c.x);
  float v = (c.y - 0.5) * 1.6;
  vP = vec2(u, v);
  return anchor + dir * (stem + u * len) + nrm * (v * len);
}
`;

/* a sprig on a node: one instance per node, one quad per leaf (aLeaf), everything else derived from the spec + the node's seed */
export const LEAF_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iColA;
attribute vec3 iAccent;
attribute vec4 iInfo;  // heading, scale, seed, -
attribute vec4 iState; // vis, act, hover, flare
attribute float aLeaf;
uniform float uTime;
uniform float uSway;
uniform vec4 uSpecA[3]; // angle off the heading, length, half width, curl
uniform vec4 uSpecB[3]; // stalk length, unfurl delay
${LEAF_VARYINGS}
${GLSL_COMMON}
${LEAF_PLACE}
void main(){
  int k = int(aLeaf + 0.5);
  vec4 A = uSpecA[k];
  vec4 B = uSpecB[k];
  float vis = iState.x;
  float act = iState.y;
  float hov = iState.z;
  float seed = fract(iInfo.z + float(k) * 0.3819);
  float j1 = hash11(iInfo.z * 97.0 + float(k) * 13.0);
  float j2 = hash11(iInfo.z * 41.0 + float(k) * 29.0 + 5.0);
  // the smallest leaf takes whichever side the node's seed gives it
  float flip = k == 2 ? (j2 > 0.5 ? 1.0 : -1.0) : 1.0;

  // unfurl: staggered, quick ease-out with a hair of overshoot
  float open = smoothstep(B.y, B.y + 0.6, vis);
  float grow = (1.0 - pow(1.0 - open, 3.0)) * (1.0 + 0.08 * sin(open * 3.14159));
  float sc = iInfo.y * (1.0 + 0.14 * act + 0.07 * hov);
  float len = max(A.y * sc * (0.86 + 0.28 * j1) * grow, 0.0005);
  float hw = A.z * (0.9 + 0.2 * j2);
  float curl = A.w * flip * (0.8 + 0.4 * j1);

  // leaves start folded along the heading and fan open; hovering opens them a little wider
  float fan = A.x * flip * (0.3 + 0.7 * open) * (1.0 + 0.12 * hov + 0.06 * act) * (0.94 + 0.12 * j2);
  float sway = uSway * sin(uTime * 0.8 + seed * 6.2831) * (0.045 + 0.03 * hov);
  float ang = iInfo.x + fan + sway;
  float stem = B.x * sc * (0.55 + 0.45 * grow);

  vec2 wp = leafPlace(position.xy, iPos.xy, ang, len, stem);
  vShape = vec4(len, hw, curl, stem / len);
  vState = iState;
  vColA = iColA;
  vAccent = iAccent;
  vSeed = seed;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, iPos.z, 1.0);
  if (vis < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

/* foliage on the twigs: one instance per leaf. A leaf unfurls as its twig's growth front passes, then rides a breeze that ripples across the canopy */
export const FOLIAGE_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iColA;
attribute vec3 iAccent;
attribute vec4 iLeaf;  // fan off the twig's tangent, length, half width, curl
attribute vec4 iMeta;  // appear (fraction along the twig), seed, tangent angle, stalk
attribute vec4 iState; // twig progress, glow
uniform float uTime;
uniform float uSway;
${LEAF_VARYINGS}
${LEAF_PLACE}
void main(){
  float prog = iState.x;
  float glow = iState.y;
  float open = smoothstep(iMeta.x, iMeta.x + 0.14, prog);
  float grow = (1.0 - pow(1.0 - open, 3.0)) * (1.0 + 0.1 * sin(open * 3.14159));
  float len = max(iLeaf.y * grow * (1.0 + 0.1 * glow), 0.0005);
  float fan = iLeaf.x * (0.28 + 0.72 * open) * (1.0 + 0.1 * glow);
  float breeze = uSway * (sin(uTime * 1.05 - iPos.x * 0.42 - iPos.y * 0.26 + iMeta.y * 6.2831) * 0.075 + sin(uTime * 2.3 + iMeta.y * 17.0) * 0.02);
  float ang = iMeta.z + fan + breeze;
  float stem = iMeta.w * (0.5 + 0.5 * grow);

  vec2 wp = leafPlace(position.xy, iPos.xy, ang, len, stem);
  vShape = vec4(len, iLeaf.z, iLeaf.w, stem / len);
  vState = vec4(open * 0.85, 0.0, glow, 0.0);
  vColA = iColA;
  vAccent = iAccent;
  vSeed = iMeta.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, iPos.z, 1.0);
  if (open < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const LEAF_FRAG = /* glsl */ `
uniform float uTime;
${LEAF_VARYINGS}
void main(){
  float u = vP.x;
  float v = vP.y;
  float len = vShape.x;
  float hw = vShape.y;
  float curl = vShape.z;
  float stemU = vShape.w;
  float vis = vState.x;
  float act = vState.y;
  float hov = vState.z;
  float flare = min(vState.w, 1.3);

  // outline: an exact lens drawn out to a point at the tip, widest a little nearer the base; the midline arcs gently
  float uc = clamp(u, 0.0, 1.0);
  float qy = v - curl * uc * uc;
  float tw = u > 0.0 ? pow(u, 0.82) : u;
  float vr = 0.5 * (hw + 0.25 / hw);
  float vd = 0.5 * (0.25 / hw - hw);
  vec2 q = abs(vec2(qy, tw - 0.5));
  float dv = ((q.y - 0.5) * vd > q.x * 0.5) ? length(q - vec2(0.0, 0.5)) : length(q - vec2(-vd, 0.0)) - vr;
  float dw = dv * len; // distance to the rim, in world units
  float tc = pow(max(uc, 0.003), 0.82) - 0.5;
  float h = max(sqrt(max(vr * vr - tc * tc, 0.0)) - vd, 0.0);

  // line weights follow the screen: never thinner than a pixel, and fine detail fades out as the leaf shrinks
  float px = max(fwidth(dw), 1e-4);
  float sizePx = len / px;
  float inside = 1.0 - smoothstep(-px, px, dw);
  float hl = max(h * len, 1e-4);
  float across = abs(qy) * len;

  float edge = exp(-pow(dw / max(0.0072, px * 0.75), 2.0));
  float halo = exp(-pow(dw / max(0.032, px * 2.2), 2.0)) * 0.16;
  // a glassy body: lit along the midrib, thinning to the rim and toward the tip
  float depthIn = clamp(-dw / hl, 0.0, 1.0);
  float fill = inside * (0.045 + 0.13 * pow(depthIn, 1.5)) * (1.0 - 0.45 * uc);
  float rib = exp(-pow(across / max(0.0048, px * 0.7), 2.0)) * inside * smoothstep(0.0, 0.06, uc) * (1.0 - smoothstep(0.55, 0.96, uc)) * smoothstep(7.0, 16.0, sizePx);
  float stalk = exp(-pow(abs(v) * len / max(0.0052, px * 0.7), 2.0)) * (1.0 - smoothstep(0.0, 0.03, u)) * smoothstep(-stemU, -stemU * 0.55, u);

  // side veins sweep from the rib toward the tip
  float fx = fract((uc - abs(qy) * 1.35) * 5.0);
  float dl = min(fx, 1.0 - fx) / 5.0 * 0.8 * len;
  float vein = exp(-pow(dl / max(0.0032, px * 0.7), 2.0)) * inside * smoothstep(0.12, 0.3, uc) * (1.0 - smoothstep(0.55, 0.92, uc)) * (1.0 - smoothstep(h * 0.55, h * 0.9, abs(qy))) * smoothstep(34.0, 70.0, sizePx);

  // a slow swell of light travels the midrib to the tip, then the tip glints
  float pu = fract(uTime * 0.14 + vSeed) * 1.5 - 0.25;
  float pulse = exp(-pow((uc - pu) / 0.11, 2.0)) * inside * exp(-pow(across / max(hl * 0.9, 1e-3), 2.0)) * smoothstep(8.0, 20.0, sizePx);
  vec2 pt = vec2(u - 1.0, qy) * len;
  float tipD = dot(pt, pt);
  float spark = exp(-tipD / max(0.00035, px * px * 2.5)) * (0.55 + 0.45 * sin(uTime * 1.9 + vSeed * 40.0));
  float tipGlow = exp(-tipD / max(0.004, px * px * 14.0)) * 0.35;

  vec3 hot = mix(vAccent, vec3(1.0), 0.72);
  vec3 warm = mix(vColA, hot, 0.5);
  vec3 col = vColA * (edge * 0.8 + halo + fill + vein * 0.42);
  col += warm * (rib * 0.7 + stalk * 0.55 + tipGlow);
  col += hot * (pulse * 0.4 + spark * 0.85);
  col *= vis * (0.75 + 0.3 * act + 0.5 * hov) + flare * 0.45;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/* ───────────────────────── seed: an almond of light, cracking open into a shoot and roots ───────────────────────── */
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
uniform float uSprout;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uHot;
uniform float uExtent;
uniform float uScale;
varying vec2 vP;
const float TAU = 6.28318530718;

// almond (vesica piscis): half height 0.27, half width 0.125
float sdSeed(vec2 p){
  p = abs(p);
  const float R = 0.3542;
  const float D = 0.2292;
  const float B = 0.27;
  return ((p.y - B) * D > p.x * B) ? length(p - vec2(0.0, B)) : length(p - vec2(-D, 0.0)) - R;
}

void main(){
  float T = uTime;
  float ap = 0.45 + 0.55 * uAppear;
  float breathe = 1.0 + 0.035 * sin(T * 1.6);
  vec2 p = vP / (ap * breathe * uScale);
  float r = length(p);
  float sp = clamp(uSprout, 0.0, 1.0);
  vec3 col = vec3(0.0);

  // atmosphere
  col += uColB * exp(-r * r * 12.0) * 0.17 + uColA * exp(-r * 3.4) * 0.04 * (1.0 + uEnergy);

  // the seed itself: white-hot kernel wrapped in a living plasma, held inside the almond
  vec2 q = vec2(p.x * 1.9, p.y);
  float rq = length(q);
  float aq = atan(q.y, q.x);
  float sd = sdSeed(p);
  float inside = 1.0 - smoothstep(-0.012, 0.004, sd);
  float core = exp(-rq * rq * 260.0);
  float swirl = 0.5 + 0.5 * sin(aq * 3.0 + T * 0.8 + sin(rq * 34.0 - T * 1.7) * 1.7);
  col += uHot * core * (2.1 + uEnergy * 1.6 + uHover * 0.7);
  col += mix(uColA, uColB, swirl) * exp(-rq * rq * 38.0) * (0.75 + 0.35 * swirl) * (0.5 + 0.5 * inside);

  // glass shell with a chromatic fringe
  for (int c = 0; c < 3; c++) {
    float ring = exp(-pow((sd - float(c) * 0.0065) / 0.0045, 2.0));
    vec3 tint = c == 0 ? vec3(1.0, 0.32, 0.62) : (c == 1 ? vec3(0.3, 1.0, 0.82) : vec3(0.38, 0.55, 1.0));
    col += tint * ring * 0.55;
  }

  // the seam: a hairline that splits open from the tip as the seed germinates
  float jag = 0.011 * sin(p.y * 62.0 + 1.0) + 0.006 * sin(p.y * 131.0 + 2.0);
  float crackTop = 0.262;
  float crackLen = 0.1 + 0.46 * sp;
  float cm = smoothstep(crackTop - crackLen, crackTop - crackLen + 0.05, p.y) * (1.0 - smoothstep(crackTop, crackTop + 0.01, p.y));
  float cd = abs(p.x - jag);
  col += uHot * exp(-pow(cd / 0.0042, 2.0)) * cm * inside * (0.5 + 1.2 * sp + uEnergy);
  col += uColA * exp(-pow(cd / 0.03, 2.0)) * cm * inside * 0.28 * (0.3 + sp);

  // the shoot: climbs out of the tip, ending in a bead where the stem takes over
  float tipY = 0.27 + 0.33 * sp;
  float along = p.y - 0.27;
  float sway = 0.01 * sin(p.y * 16.0 - T * 0.7) * smoothstep(0.27, 0.45, p.y) * (1.0 - smoothstep(0.5, 0.6, p.y));
  float sw = 0.0042 + 0.003 * smoothstep(0.0, 0.33, along);
  float shoot = exp(-pow((p.x - sway) / sw, 2.0)) * smoothstep(0.0, 0.03, along) * (1.0 - smoothstep(tipY - 0.02, tipY, p.y));
  float flow = pow(smoothstep(0.8, 1.0, fract(along * 5.0 - T * 0.9)), 2.0);
  col += mix(uColA, uHot, 0.35) * shoot * (0.35 + flow * 1.7 + uEnergy * 0.9);
  vec2 tip = vec2(0.01 * sin(tipY * 16.0 - T * 0.7) * smoothstep(0.27, 0.45, tipY) * (1.0 - smoothstep(0.5, 0.6, tipY)), tipY);
  col += uHot * exp(-dot(p - tip, p - tip) * 2800.0) * (0.75 + 0.25 * sin(T * 2.0)) * smoothstep(0.05, 0.4, sp);

  // two seed leaves unfurl from the stem
  float leaf = smoothstep(0.3, 0.9, sp);
  for (int s = 0; s < 2; s++) {
    float sg = s == 0 ? 1.0 : -1.0;
    vec2 c = vec2(sg * 0.075, 0.345);
    vec2 v = p - c;
    float ang = atan(v.y, v.x * sg);
    float dl = abs(length(v) - 0.075);
    float unfurl = smoothstep(3.1416 * (1.0 - leaf) - 0.15, 3.1416 * (1.0 - leaf), ang);
    float line = exp(-pow(dl / 0.0034, 2.0)) * step(0.0, v.y) * unfurl * smoothstep(0.12, 0.4, ang);
    col += mix(uColA, uHot, 0.3) * line * (0.6 + 0.4 * sin(T * 1.5 + sg)) * leaf;
    vec2 lt = c + vec2(sg * cos(0.3), sin(0.3)) * 0.075;
    col += uHot * exp(-dot(p - lt, p - lt) * 3200.0) * leaf * 0.8;
  }

  // roots feel their way down, sap flowing back up toward the seed
  float ty = -p.y - 0.27;
  float rootsAmt = smoothstep(0.0, 1.0, sp * 1.15);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float dirn = fi - 2.0;
    float len = (0.62 - abs(dirn) * 0.07) * rootsAmt;
    float xr = dirn * 0.12 * pow(max(ty, 0.0), 0.9) + 0.012 * sin(ty * 22.0 + fi * 2.0);
    float wr = 0.0036 * (1.0 - 0.6 * clamp(ty / 0.6, 0.0, 1.0)) + 0.0006;
    float m = step(0.0, ty) * (1.0 - smoothstep(len - 0.03, len, ty));
    float rl = exp(-pow((p.x - xr) / wr, 2.0)) * m;
    float sap = pow(smoothstep(0.8, 1.0, fract(ty * 3.2 + T * 0.5 + fi * 0.31)), 2.0);
    col += mix(uColA, uColB, 0.5) * rl * (0.22 + sap * 1.0 + uEnergy * 0.4);
  }

  // fine measuring scale along the ground, and a line of dust beneath it
  float gx = 1.0 - smoothstep(0.55, 1.5, abs(p.x));
  col += uColA * exp(-pow((p.y + 0.31) / 0.0028, 2.0)) * (0.05 + step(0.7, fract(p.x * 30.0)) * 0.14) * gx;
  col += uColB * exp(-pow((p.y + 0.37) / 0.004, 2.0)) * step(0.82, fract(p.x * 24.0 + T * 0.012)) * 0.3 * gx;

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
  vec3 col = tint * (lit * 0.085) * pat * focusFade * uReveal + fogCol * 0.03 * focusFade * uReveal;
  // keep the spill saturated: it is coloured light on black, never grey haze
  float lum = dot(col, vec3(0.333));
  col = max(mix(vec3(lum), col, 1.55), 0.0);
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

/* ───────────────────────── signature moments: what each branch plays when one of its nodes opens ───────────────────────── */
/* One quad, one fragment shader, six short films. `uAge` runs 0→1 over the moment; the beats are mirrored in signature.ts so the sound
   lands on them. Everything is drawn in the same hairline-neon language as the rest of the tree (additive, palette-tinted, pixel-aware line
   weights) so it blooms with the scene instead of sitting on top of it. `uCalm` removes flicker and glitch for reduced motion. */
export const MOMENT_VERT = /* glsl */ `
uniform float uSize;
uniform vec3 uPos;
varying vec2 vP;
void main(){
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(uPos + vec3(position.xy * uSize, 0.0), 1.0);
}
`;

export const MOMENT_FRAG = /* glsl */ `
uniform float uAge;
uniform float uStyle;
uniform float uSeed;
uniform float uPower;
uniform float uCalm;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uAccent;
varying vec2 vP;
${GLSL_COMMON}

const float PI = 3.14159265;
const float TAU = 6.28318531;

float easeOut(float x){ x = clamp(x, 0.0, 1.0); return 1.0 - pow(1.0 - x, 3.0); }
float easeIn(float x){ x = clamp(x, 0.0, 1.0); return x * x * x; }
float backOut(float x){ x = clamp(x, 0.0, 1.0); float y = x - 1.0; return 1.0 + 2.70158 * y * y * y + 1.70158 * y * y; }
float glow(float d, float w){ float x = d / w; return exp(-x * x); }
vec2 dir(float a){ return vec2(cos(a), sin(a)); }
mat2 rot2(float a){ float c = cos(a); float s = sin(a); return mat2(c, -s, s, c); }
float segH(vec2 p, vec2 a, vec2 b, out float h){
  vec2 pa = p - a;
  vec2 ba = b - a;
  h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}
float seg(vec2 p, vec2 a, vec2 b){ float h; return segH(p, a, b, h); }
float sdDiamond(vec2 p, float r){ return (abs(p.x) + abs(p.y)) * 0.70710678 - r; }
/* the same exact lens the leaves are drawn with, so petals and leaves are one family */
float sdLens(vec2 p, float hw){
  float tw = p.x > 0.0 ? pow(p.x, 0.8) : p.x;
  float vr = 0.5 * (hw + 0.25 / hw);
  float vd = 0.5 * (0.25 / hw - hw);
  vec2 q = abs(vec2(p.y, tw - 0.5));
  return ((q.y - 0.5) * vd > q.x * 0.5) ? length(q - vec2(0.0, 0.5)) : length(q - vec2(-vd, 0.0)) - vr;
}

/* ── AI · a signal crosses a four-layer net ── */
int layerCount(int l){ return l == 0 ? 3 : (l == 3 ? 2 : 4); }
vec2 netPos(int l, int i){
  int n = layerCount(l);
  float fl = float(l);
  float fi = float(i);
  float x = mix(-0.74, 0.74, fl / 3.0);
  float y = n > 1 ? (fi / float(n - 1) - 0.5) * 0.86 : 0.0;
  float jx = hash21(vec2(fl * 7.0 + 1.0, fi * 3.0 + uSeed * 9.0)) - 0.5;
  float jy = hash21(vec2(fi + 4.0, fl * 5.0 + uSeed * 6.0)) - 0.5;
  return vec2(x + jx * 0.06, y + jy * 0.06);
}
vec3 neural(vec2 p, float t, float lw, vec3 base, vec3 alt, vec3 hot){
  float net = 0.0;
  float packets = 0.0;
  for (int l = 0; l < 3; l++) {
    int na = layerCount(l);
    int nb = layerCount(l + 1);
    float t0 = 0.06 + float(l) * 0.2;
    for (int i = 0; i < 4; i++) {
      if (i >= na) break;
      vec2 a = netPos(l, i);
      for (int j = 0; j < 4; j++) {
        if (j >= nb) break;
        vec2 b = netPos(l + 1, j);
        float h;
        float d = segH(p, a, b, h);
        float ts = t0 + 0.04 * hash21(vec2(float(i) + float(l) * 3.0, float(j)));
        float u = (t - ts) / 0.2;
        float lit = smoothstep(ts, ts + 0.2, t);
        net += glow(d, lw) * (0.1 + 0.2 * lit);
        if (u > 0.0 && u < 1.0) packets += glow(d, lw * 1.8) * exp(-pow((h - u) / 0.09, 2.0)) * (1.0 - 0.4 * smoothstep(0.7, 1.0, u));
      }
    }
  }
  float halo = 0.0;
  float ringsum = 0.0;
  float core = 0.0;
  for (int l = 0; l < 4; l++) {
    int n = layerCount(l);
    float ta = 0.04 + float(l) * 0.2;
    float act = step(ta, t) * exp(-max(t - ta, 0.0) * 3.4);
    float pop = backOut((t - float(l) * 0.015) / 0.12);
    for (int i = 0; i < 4; i++) {
      if (i >= n) break;
      float d = length(p - netPos(l, i));
      core += smoothstep(0.034 * pop, 0.024 * pop, d);
      halo += exp(-pow(d / (0.06 + 0.05 * act), 2.0)) * (0.2 + 1.3 * act);
      ringsum += glow(abs(d - 0.062 * pop), lw) * (0.35 + 0.8 * act);
    }
  }
  // the verdict: a ring leaves the output layer
  float since = max(t - 0.66, 0.0);
  float verdict = glow(abs(length(p - vec2(0.74, 0.0)) - since * 1.1), lw * 1.5) * exp(-since * 5.0) * step(0.66, t);
  return base * (net * 0.9 + halo * 0.8 + ringsum) + alt * verdict * 0.9 + mix(base, hot, 0.35) * (packets * 0.6 + core * 0.8) + hot * verdict * 0.4;
}

/* ── Robotics · a servo arm sweeps its dial, ratcheting, then locks ── */
float ratchet(float x){
  float f = x * 10.0;
  return (floor(f) + smoothstep(0.55, 0.95, fract(f))) / 10.0;
}
vec3 mech(vec2 p, float t, float lw, vec3 base, vec3 alt, vec3 hot){
  float r = length(p);
  float a = atan(p.y, p.x);
  float start = 3.4;
  float armA = start - 3.8 * backOut((t - 0.08) / 0.5);
  // the dial: a ring and 48 ticks that light as the arm passes them
  float dial = glow(abs(r - 0.74), lw) * 0.55;
  float cell = a / TAU * 48.0 + 0.5;
  float idx = floor(cell);
  float major = step(mod(idx + 48.0, 6.0), 0.5);
  float dTick = abs(fract(cell) - 0.5) * TAU / 48.0 * r;
  float band = smoothstep(mix(0.69, 0.65, major) - 0.01, mix(0.69, 0.65, major), r) * (1.0 - smoothstep(0.79, 0.8, r));
  float rel = mod(start - a, TAU);
  float swept = step(rel, start - armA);
  float near = exp(-abs(rel - (start - armA)) * 9.0);
  float ticks = glow(dTick, lw * 0.9) * band * (mix(0.22, 0.9, swept) + near * 1.4);
  // a toothed gear that advances one notch at a time
  float rotG = ratchet(clamp((t - 0.08) / 0.5, 0.0, 1.0)) * TAU * 0.6;
  float R = 0.34 + 0.055 * smoothstep(-0.25, 0.25, sin(10.0 * (a - rotG)));
  float gear = glow(abs(r - R) * 0.8, lw * 1.2) * 0.8 + glow(abs(r - 0.13), lw) * 0.6;
  float holes = 0.0;
  for (int k = 0; k < 5; k++) holes += glow(abs(length(p - 0.22 * dir(rotG + float(k) * TAU / 5.0)) - 0.038), lw);
  // the arm
  vec2 tip = 0.71 * dir(armA);
  float arm = glow(seg(p, vec2(0.0), tip), lw * 2.2);
  float cap = smoothstep(0.04, 0.026, length(p - tip)) + smoothstep(0.07, 0.055, r) * 0.8;
  // brackets close in and lock
  float c = mix(0.98, 0.86, easeOut((t - 0.42) / 0.2));
  vec2 q = abs(p);
  float brk = glow(min(seg(q, vec2(c), vec2(c - 0.17, c)), seg(q, vec2(c), vec2(c, c - 0.17))), lw * 1.3) * smoothstep(0.38, 0.5, t);
  float lock = exp(-abs(t - 0.6) * 16.0) * step(0.58, t);
  float since = max(t - 0.6, 0.0);
  float pulse = glow(abs(r - (0.74 + since * 0.9)), lw * 1.6) * exp(-since * 7.0) * step(0.6, t);
  return base * (dial + ticks * 0.9 + gear + holes * 0.5 + brk * (0.8 + 1.6 * lock)) + alt * pulse + hot * (arm * 1.2 + cap + near * band * 0.8 + lock * brk * 1.4 + pulse * 0.5);
}

/* ── Quantum · a cloud of possible states flickers, then collapses to one ── */
vec3 quantum(vec2 p, float t, float lw, vec3 base, vec3 alt, vec3 hot){
  float tc = 0.56;
  float pre = 1.0 - smoothstep(tc - 0.03, tc, t);
  float pull = easeIn((t - (tc - 0.14)) / 0.14);
  float r = length(p);
  float flick = floor(t * 22.0);
  float wave = pow(0.5 + 0.5 * cos(r * 30.0 - t * 16.0), 5.0) * exp(-r * 2.4) * pre * smoothstep(0.0, 0.1, t);
  float states = 0.0;
  float dots = 0.0;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float h1 = hash11(fi * 3.7 + uSeed * 11.0);
    float h2 = hash11(fi * 5.3 + 2.0 + uSeed * 7.0);
    float ang = h1 * TAU + t * (0.5 + h2) * (h1 > 0.5 ? 1.0 : -1.0);
    vec2 pos = dir(ang) * (0.22 + 0.5 * h2) * (1.0 - pull);
    float on = mix(step(0.38, hash11(fi * 1.9 + flick * 7.13 + uSeed)), 0.75, uCalm);
    float d = length(p - pos);
    states += (glow(abs(d - 0.07), lw) * 0.9 + exp(-pow(d / 0.05, 2.0)) * 0.6) * on;
  }
  for (int i = 0; i < 36; i++) {
    float fi = float(i);
    float h1 = hash11(fi * 2.3 + uSeed * 5.0 + 9.0);
    float h2 = hash11(fi * 4.9 + 1.0);
    vec2 pos = dir(h1 * TAU) * sqrt(h2) * 0.85 * (1.0 - pull);
    float on = mix(step(0.5, hash11(fi + flick * 3.7)), 0.7, uCalm);
    dots += exp(-pow(length(p - pos) / 0.012, 2.0)) * on;
  }
  float since = max(t - tc, 0.0);
  float after = step(tc, t);
  float shock = glow(abs(r - since * 1.7), lw * 1.8 + since * 0.02) * exp(-since * 5.0) * after;
  float shock2 = glow(abs(r - since * 0.9), lw) * exp(-since * 3.5) * after;
  float flash = exp(-since * 9.0) * after;
  float surv = after * smoothstep(0.0, 0.08, since);
  float survRing = glow(abs(r - 0.09), lw) * surv;
  float survDot = smoothstep(0.035, 0.02, r) * surv;
  // measurement crosshair
  vec2 q = abs(p);
  float xhair = (glow(q.y, lw) * step(q.x, 0.2) * step(0.12, q.x) + glow(q.x, lw) * step(q.y, 0.2) * step(0.12, q.y)) * surv * 0.7;
  float core = exp(-r * r * 260.0) * (flash * 3.0 + surv * 0.6);
  return alt * (wave * 0.5 + shock2 * 0.6) + base * (states * 0.9 * pre + dots * 0.5 * pre + survRing * 0.9 + xhair) + hot * (shock * 1.2 + core + survDot);
}

/* ── Sustainability · a flower blooms ── */
vec2 petals(vec2 p, float t, float n, float rot, float L, float hw, float start, float stagger, float lw){
  float r = length(p);
  float a = atan(p.y, p.x) - rot;
  float sa = TAU / n;
  float sector = floor((a + sa * 0.5) / sa);
  float aa = a - sector * sa;
  vec2 q = r * vec2(cos(aa), sin(aa));
  float open = backOut((t - start - stagger * mod(sector + n, n)) / 0.34);
  float len = max(L * open, 0.001);
  vec2 lp = vec2((q.x - 0.06) / len, q.y / len);
  float d = sdLens(lp, hw) * len;
  float inside = 1.0 - smoothstep(-lw * 0.8, lw * 0.8, d);
  float depthIn = clamp(-d / max(hw * len * 0.9, 1e-4), 0.0, 1.0);
  float fill = inside * (0.06 + 0.22 * pow(depthIn, 1.4)) * (1.0 - 0.35 * clamp(lp.x, 0.0, 1.0));
  float vein = glow(abs(lp.y) * len, lw * 0.8) * inside * smoothstep(0.0, 0.1, lp.x) * (1.0 - smoothstep(0.5, 0.9, lp.x)) * 0.5;
  vec2 tp = vec2(lp.x - 1.0, lp.y) * len;
  float tip = exp(-dot(tp, tp) / 0.0008) * step(0.4, open) * step(0.001, len);
  float live = step(0.0005, open);
  return vec2((glow(d, lw * 1.1) * 0.85 + fill + vein) * live, tip);
}
vec3 bloom(vec2 p, float t, float lw, vec3 base, vec3 alt, vec3 hot){
  float spin = t * 0.15;
  vec2 petalsOuter = petals(p, t, 7.0, spin, 0.62, 0.26, 0.06, 0.035, lw);
  vec2 petalsInner = petals(p, t, 7.0, spin + TAU / 14.0, 0.4, 0.28, 0.2, 0.03, lw);
  float r = length(p);
  float seeds = 0.0;
  for (int i = 0; i < 21; i++) {
    float fi = float(i);
    float on = backOut((t - 0.34 - fi * 0.012) / 0.15);
    vec2 c = dir(fi * 2.39996 + t * 0.5) * 0.036 * sqrt(fi + 0.6) * on;
    seeds += exp(-pow(length(p - c) / 0.012, 2.0)) * on;
  }
  float heart = exp(-r * r * 700.0) * smoothstep(0.3, 0.5, t);
  float pollen = 0.0;
  for (int i = 0; i < 22; i++) {
    float fi = float(i);
    float h1 = hash11(fi * 2.3 + uSeed * 5.0);
    float h2 = hash11(fi * 4.1 + 3.0);
    float life = clamp((t - 0.38 - h1 * 0.25) / 0.55, 0.0, 1.0);
    vec2 pos = dir(h2 * TAU + life * 1.2) * (0.12 + 0.75 * easeOut(life) * (0.5 + 0.5 * h1)) + vec2(0.0, 0.25 * life * life);
    pollen += exp(-pow(length(p - pos) / 0.013, 2.0)) * sin(life * PI) * (0.5 + 0.5 * sin(t * 14.0 + fi * 3.0));
  }
  float since = max(t - 0.5, 0.0);
  float dew = glow(abs(r - (0.3 + since * 0.9)), lw * 1.4) * exp(-since * 4.0) * step(0.5, t);
  return base * (petalsOuter.x + petalsInner.x * 0.9) + mix(base, alt, 0.35) * dew + hot * (petalsOuter.y * 0.5 + petalsInner.y * 0.4 + seeds * 0.8 + heart * 1.1 + pollen * 0.8);
}

/* ── Innovation · shards fly in and snap into a prototype ── */
vec3 spark(vec2 p0, float t, float lw, vec3 base, vec3 alt, vec3 hot){
  float g = (1.0 - smoothstep(0.0, 0.5, t)) * (1.0 - uCalm);
  float tick = floor(t * 28.0);
  float bandY = floor((p0.y + 1.0) * 12.0);
  float jit = step(0.78, hash11(bandY * 1.7 + tick * 3.1 + uSeed * 5.0));
  vec2 p = p0 + vec2((hash11(bandY + tick * 2.3) - 0.5) * 0.3 * g * jit, 0.0);
  float shards = 0.0;
  float trails = 0.0;
  float landing = 0.0;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float h1 = hash11(fi * 3.1 + uSeed * 13.0);
    float h2 = hash11(fi * 7.7 + 1.0 + uSeed);
    float a0 = h1 * TAU;
    vec2 from = dir(a0) * (0.9 + 0.12 * h2);
    float aT = fi / 12.0 * TAU + 0.26;
    vec2 to = dir(aT) * (0.4 / cos(mod(aT, 1.0471976) - 0.5235988));
    float tl = 0.28 + 0.2 * h2;
    float u = easeIn((t - 0.04) / (tl - 0.04));
    vec2 pos = mix(from, to, u) + dir(a0 + 1.5) * 0.05 * sin(u * 9.0 + fi) * (1.0 - u);
    vec2 pos0 = mix(from, to, easeIn((t - 0.09) / (tl - 0.04)));
    float landed = step(tl, t);
    vec2 q = rot2((1.0 - u) * 14.0 * (h1 - 0.5)) * (p - pos);
    float kind = mod(fi, 3.0);
    float d = kind < 0.5 ? sdTri(q, 0.05) : (kind < 1.5 ? sdDiamond(q, 0.05) : min(sdBox(q, vec2(0.05, 0.012)), sdBox(q, vec2(0.012, 0.05))));
    float on = step(0.04, t);
    shards += (glow(max(d, 0.0), 0.012) * 0.8 + (1.0 - smoothstep(-0.003, 0.003, d)) * 0.7) * on * (1.0 - landed * 0.88);
    trails += glow(seg(p, pos0, pos), lw * 1.2) * 0.55 * (1.0 - landed) * on;
    landing += exp(-dot(p - to, p - to) / 0.0016) * landed * exp(-(t - tl) * 14.0);
  }
  float ts = 0.62;
  float built = smoothstep(0.3, ts, t);
  float flash = exp(-abs(t - ts) * 16.0) * step(ts - 0.04, t);
  float after = smoothstep(ts - 0.02, ts + 0.04, t);
  float hex = glow(abs(sdHex(p, 0.4)), lw * 1.4) * (0.15 + 0.7 * built + 2.2 * flash);
  // a hair of colour split while it is still glitching
  float split = glow(abs(sdHex(p + vec2(0.012 * g, 0.0), 0.4)), lw * 1.4) * (0.15 + 0.7 * built) * g;
  float innerHex = glow(abs(sdHex(rot2(t * 0.9) * p, 0.22)), lw) * after * 0.8;
  float hub = (1.0 - smoothstep(-0.004, 0.004, sdHex(p, 0.1))) * after * 0.3;
  float spokes = 0.0;
  float verts = 0.0;
  for (int k = 0; k < 6; k++) {
    vec2 v = dir(float(k) * 1.0471976) * 0.4619;
    spokes += glow(seg(p, v * 0.22, v), lw) * 0.35;
    verts += exp(-dot(p - v, p - v) / 0.0009);
  }
  float scan = glow(abs(fract(p.y * 18.0 - t * 3.0) - 0.5), 0.02) * g * 0.12;
  return base * (hex + innerHex + spokes * after + trails + scan) + alt * split + mix(base, hot, 0.5) * (shards * 0.9 + landing * 1.4) + mix(base, hot, 0.3) * hub * 1.3 + hot * (verts * after * (0.4 + flash * 1.6) + flash * hex * 0.4);
}

/* ── Future skills · satellites connect to a hub, then the ring closes ── */
vec2 satPos(int i){
  float fi = float(i);
  float ang = fi * TAU / 6.0 + (hash11(fi * 4.1 + uSeed * 9.0) - 0.5) * 0.35 + 0.3;
  return dir(ang) * (0.5 + 0.2 * hash11(fi * 2.7 + 5.0 + uSeed));
}
vec3 constellation(vec2 p, float t, float lw, vec3 base, vec3 alt, vec3 hot){
  float r = length(p);
  float a = atan(p.y, p.x);
  float links = 0.0;
  float packets = 0.0;
  float nodes = 0.0;
  float glowSat = 0.0;
  float ringLinks = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float h1 = hash11(fi * 4.1 + uSeed * 9.0);
    vec2 pos = satPos(i);
    float t0 = 0.1 + 0.06 * fi;
    float u = easeOut((t - t0) / 0.3);
    float h;
    float d = segH(p, vec2(0.0), pos * u, h);
    links += glow(d, lw) * 0.4 * step(0.001, u);
    float flow = fract((t - t0 - 0.1) * 1.4 + h1);
    packets += glow(d, lw * 1.8) * exp(-pow((h - flow) / 0.07, 2.0)) * smoothstep(0.55, 0.8, u) * (1.0 - smoothstep(0.85, 1.0, t));
    float pop = backOut((t - t0 - 0.24) / 0.16);
    vec2 sp = p - pos;
    nodes += glow(abs(sdHex(sp, 0.05 * max(pop, 0.0))), lw) * step(0.001, pop);
    glowSat += exp(-dot(sp, sp) / 0.0016) * pop * (0.5 + exp(-max(t - t0 - 0.3, 0.0) * 6.0) * 1.5);
    float v = easeOut((t - 0.52 - 0.04 * fi) / 0.22);
    float h2;
    float d2 = segH(p, pos, mix(pos, satPos(int(mod(fi + 1.0, 6.0))), v), h2);
    ringLinks += glow(d2, lw * 0.9) * step(0.5, fract(h2 * 7.0 - t * 1.5)) * step(0.001, v);
  }
  float orbit = glow(abs(r - 0.6), lw * 0.8) * step(0.5, fract(a / TAU * 9.0 + t * 0.25)) * 0.18;
  float da = abs(mod(a - (t - 0.7) * 5.0 + PI, TAU) - PI);
  float sweep = glow(abs(r - 0.6), lw * 1.4) * exp(-da * da * 3.0) * step(0.7, t);
  float hubGlow = exp(-r * r * 420.0) * smoothstep(0.0, 0.1, t);
  float beat = fract(t * 1.1);
  float pulse = glow(abs(r - beat * 0.5), lw) * (1.0 - beat) * 0.5 * smoothstep(0.1, 0.3, t);
  return base * (links + nodes * 0.9 + ringLinks * 0.6 + orbit + pulse) + alt * sweep + mix(base, hot, 0.35) * (packets * 0.6 + glowSat * 0.5) + hot * (hubGlow * 0.55 + sweep * 0.4);
}

void main(){
  float t = clamp(uAge, 0.0, 1.0);
  float px = max(fwidth(vP.x), 1e-4);
  float lw = max(0.0042, px * 0.8);
  vec3 base = uColA;
  vec3 alt = uColB;
  vec3 hot = mix(uAccent, vec3(1.0), 0.7);
  vec3 col;
  if (uStyle < 0.5) col = neural(vP, t, lw, base, alt, hot);
  else if (uStyle < 1.5) col = mech(vP, t, lw, base, alt, hot);
  else if (uStyle < 2.5) col = bloom(vP, t, lw, base, alt, hot);
  else if (uStyle < 3.5) col = spark(vP, t, lw, base, alt, hot);
  else if (uStyle < 4.5) col = constellation(vP, t, lw, base, alt, hot);
  else col = quantum(vP, t, lw, base, alt, hot);
  float env = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.84, 1.0, t));
  float rim = 1.0 - smoothstep(0.88, 1.0, max(abs(vP.x), abs(vP.y)));
  gl_FragColor = vec4(col * env * rim * uPower, 1.0);
  #include <colorspace_fragment>
}
`;
