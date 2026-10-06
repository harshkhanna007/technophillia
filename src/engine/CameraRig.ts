import * as THREE from 'three';

export interface Framing {
  fx: number;
  fy: number;
  dist: number;
}

/** Slow, damped, cinematic camera: focus + distance with pointer parallax and a soft impact kick. */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly focus = new THREE.Vector3();
  dist = 36;
  readonly tFocus = new THREE.Vector3();
  tDist = 36;
  readonly follow = new THREE.Vector3();
  followAmt = 0;
  followTarget = 0;
  /** the auto-framing the engine asked for; user zoom/pan are layered on top of it */
  private base: Framing = { fx: 0, fy: 0, dist: 36 };
  /** multiplier on the auto distance (wheel / pinch), 1 = what the engine framed */
  userZoom = 1;
  readonly pan = new THREE.Vector2();
  /** hard limits for the user's own zoom and pan */
  minDist = 5.5;
  maxDist = 120;
  private bounds = { x0: -1e3, x1: 1e3, y0: -1e3, y1: 1e3 };
  readonly pointer = new THREE.Vector2();
  readonly pTarget = new THREE.Vector2();
  rate = 1.25;
  reduced = false;
  private kick = 0;
  private kickV = 0;
  private roll = 0;
  private rollV = 0;
  private tanH: number;
  private look = new THREE.Vector3();

  constructor(fov: number, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.5, 400);
    this.tanH = Math.tan((fov * Math.PI) / 360);
    this.camera.position.set(0, 0, this.dist);
  }

  get aspect() {
    return this.camera.aspect;
  }

  setAspect(a: number) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  /** distance needed to see a world-space rectangle (z≈0) with padding */
  fit(minX: number, maxX: number, minY: number, maxY: number, padX: number, padY = padX): Framing {
    const hh = (maxY - minY) / 2 + padY;
    const hw = (maxX - minX) / 2 + padX;
    const dist = Math.max(hh / this.tanH, hw / (this.tanH * this.camera.aspect));
    return { fx: (minX + maxX) / 2, fy: (minY + maxY) / 2, dist };
  }

  halfView(dist: number) {
    const hh = dist * this.tanH;
    return { hw: hh * this.camera.aspect, hh };
  }

  setTarget(f: Framing, rate = 1.25) {
    this.base = f;
    this.rate = rate;
    this.applyTarget();
  }

  snap(f: Framing) {
    this.base = f;
    this.userZoom = 1;
    this.pan.set(0, 0);
    this.applyTarget();
    this.focus.copy(this.tFocus);
    this.dist = this.tDist;
  }

  /** the world rectangle the user may pan within (the whole tree plus a margin) */
  setBounds(x0: number, x1: number, y0: number, y1: number) {
    this.bounds = { x0, x1, y0, y1 };
    this.applyTarget();
  }

  /** back to the auto camera: called whenever the story moves to a new level */
  resetView() {
    this.userZoom = 1;
    this.pan.set(0, 0);
    this.applyTarget();
  }

  get userAdjusted() {
    return Math.abs(this.userZoom - 1) > 0.02 || this.pan.lengthSq() > 0.01;
  }

  private applyTarget() {
    const b = this.bounds;
    const fx = Math.max(b.x0, Math.min(b.x1, this.base.fx + this.pan.x));
    const fy = Math.max(b.y0, Math.min(b.y1, this.base.fy + this.pan.y));
    this.pan.set(fx - this.base.fx, fy - this.base.fy);
    this.tFocus.set(fx, fy, 0);
    this.tDist = Math.max(this.minDist, Math.min(this.maxDist, this.base.dist * this.userZoom));
  }

  /** zoom by `factor` (<1 = in) keeping the world point (wx, wy) under the pointer */
  zoomAbout(factor: number, wx: number, wy: number) {
    const oldD = this.tDist;
    const wantD = Math.max(this.minDist, Math.min(this.maxDist, oldD * factor));
    const ratio = wantD / oldD;
    this.userZoom = wantD / this.base.dist;
    this.pan.set(wx + (this.tFocus.x - wx) * ratio - this.base.fx, wy + (this.tFocus.y - wy) * ratio - this.base.fy);
    this.applyTarget();
  }

  /** shift the camera by a world-space delta */
  panBy(dx: number, dy: number) {
    this.pan.x += dx;
    this.pan.y += dy;
    this.applyTarget();
  }

  impulse(v: number) {
    this.kickV += v;
  }

  /** a short rotational shudder, the weight of something landing */
  shake(v: number) {
    this.rollV += v;
  }

  update(dt: number, time: number) {
    const k = 1 - Math.exp(-dt * this.rate);
    this.followAmt += (this.followTarget - this.followAmt) * (1 - Math.exp(-dt * 2.2));
    const dx = this.tFocus.x + (this.follow.x - this.tFocus.x) * this.followAmt;
    const dy = this.tFocus.y + (this.follow.y - this.tFocus.y) * this.followAmt;
    this.focus.x += (dx - this.focus.x) * k;
    this.focus.y += (dy - this.focus.y) * k;
    this.dist += (this.tDist - this.dist) * (1 - Math.exp(-dt * this.rate * 0.85));

    // soft spring for impact kick (push-in then settle)
    this.kickV += (-this.kick * 38 - this.kickV * 7) * dt;
    this.kick += this.kickV * dt;
    this.rollV += (-this.roll * 55 - this.rollV * 6.5) * dt;
    this.roll += this.rollV * dt;

    this.pointer.x += (this.pTarget.x - this.pointer.x) * (1 - Math.exp(-dt * 2.4));
    this.pointer.y += (this.pTarget.y - this.pointer.y) * (1 - Math.exp(-dt * 2.4));
    const par = this.reduced ? 0 : 0.016 * this.dist;
    const sway = this.reduced ? 0 : 0.0045 * this.dist;
    const px = this.pointer.x * par + Math.sin(time * 0.11) * sway;
    const py = this.pointer.y * par + Math.cos(time * 0.087) * sway * 0.8;

    this.camera.position.set(this.focus.x + px, this.focus.y + py, this.dist + this.kick);
    this.look.set(this.focus.x - px * 0.4, this.focus.y - py * 0.4, 0);
    this.camera.lookAt(this.look);
    if (!this.reduced) this.camera.rotateZ(-this.pointer.x * 0.006 + this.roll);
  }
}
