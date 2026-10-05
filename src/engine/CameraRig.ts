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
  readonly pointer = new THREE.Vector2();
  readonly pTarget = new THREE.Vector2();
  rate = 1.25;
  reduced = false;
  private kick = 0;
  private kickV = 0;
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
    this.tFocus.set(f.fx, f.fy, 0);
    this.tDist = f.dist;
    this.rate = rate;
  }

  snap(f: Framing) {
    this.tFocus.set(f.fx, f.fy, 0);
    this.focus.copy(this.tFocus);
    this.tDist = this.dist = f.dist;
  }

  impulse(v: number) {
    this.kickV += v;
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

    this.pointer.x += (this.pTarget.x - this.pointer.x) * (1 - Math.exp(-dt * 2.4));
    this.pointer.y += (this.pTarget.y - this.pointer.y) * (1 - Math.exp(-dt * 2.4));
    const par = this.reduced ? 0 : 0.016 * this.dist;
    const sway = this.reduced ? 0 : 0.0045 * this.dist;
    const px = this.pointer.x * par + Math.sin(time * 0.11) * sway;
    const py = this.pointer.y * par + Math.cos(time * 0.087) * sway * 0.8;

    this.camera.position.set(this.focus.x + px, this.focus.y + py, this.dist + this.kick);
    this.look.set(this.focus.x - px * 0.4, this.focus.y - py * 0.4, 0);
    this.camera.lookAt(this.look);
    if (!this.reduced) this.camera.rotateZ(-this.pointer.x * 0.006);
  }
}
