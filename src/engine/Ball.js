import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { prep, PLAYER_MATERIAL } from './PlayerModel.js';
import { GRAVITY } from './constants.js';

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

/**
 * The football. States: 'dead' (spotted), 'held', 'air' (pass / snap),
 * 'loose' (fumble / tipped / bounced). Flight is ballistic with light drag;
 * a prolate-spheroid bounce randomises direction so loose balls are
 * genuinely unpredictable.
 */
export class Ball {
  constructor(engine) {
    this.engine = engine;
    const body = prep(new THREE.SphereGeometry(0.1, 8, 5).scale(1, 1, 1.75), '#7b3a1d');
    const laces = [prep(new THREE.BoxGeometry(0.018, 0.012, 0.12).translate(0, 0.098, 0), '#f5f5f5')];
    for (let i = -2; i <= 2; i++) laces.push(prep(new THREE.BoxGeometry(0.05, 0.012, 0.01).translate(0, 0.098, i * 0.025), '#f5f5f5'));
    this.mesh = new THREE.Mesh(mergeGeometries([body, ...laces]), PLAYER_MATERIAL);
    this.mesh.castShadow = true;
    engine.scene.add(this.mesh);

    this.state = 'dead';
    this.live = false;
    this.carrier = null;
    this.pos = new THREE.Vector3(0, 0.15, 0);
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.angVel = new THREE.Vector3();
    this.spin = 0;
    this.thrower = null;
    this.target = null;
    this.isPass = false;
    this.isSnap = false;
    this.attempted = new Set();
    this.landing = null; // { point: Vector2, t }
    this.airTime = 0;
    this.placeAt(0, 0);
  }

  carrierPos() { return this.carrier ? this.carrier.pos : null; }

  attach(p) {
    if (this.carrier) this.carrier.hasBall = false;
    this.carrier = p; p.hasBall = true;
    this.state = 'held';
    this.landing = null;
    this.vel.set(0, 0, 0);
  }

  release() {
    if (this.carrier) this.carrier.hasBall = false;
    this.carrier = null;
  }

  /** Spot the ball on the ground (dead ball). */
  placeAt(x, z) {
    this.release();
    this.state = 'dead';
    this.pos.set(x, 0.13, z);
    this.vel.set(0, 0, 0);
    this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    this.landing = null;
  }

  _launch(from, vel) {
    this.release();
    this.pos.copy(from);
    this.vel.copy(vel);
    this.state = 'air';
    this.airTime = 0;
    this.attempted.clear();
    this.spin = 0;
    this.landing = this.computeLanding();
  }

  /** Long snap from the center to a player (shotgun) — a real short flight. */
  snap(center, receiver) {
    const from = new THREE.Vector3(center.pos.x, 0.35, center.pos.y);
    const to = new THREE.Vector3(receiver.pos.x, 1.15, receiver.pos.y);
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    const T = Math.max(0.25, d / 13);
    const vel = new THREE.Vector3((to.x - from.x) / T, (to.y - from.y + 0.5 * GRAVITY * T * T) / T, (to.z - from.z) / T);
    this._launch(from, vel);
    this.isSnap = true; this.isPass = false;
    this.thrower = center; this.target = receiver;
    this.attempted.add(center);
    this.live = true;
    this.engine.emit('snap', { center, receiver });
  }

  /** Hand the ball straight to a player (under-center snap, kick returns, etc.). */
  give(p) { this.attach(p); this.live = true; this.isSnap = false; }

  /**
   * Forward pass. Leads moving receivers, with accuracy-based error.
   * opts: { speed, loft (0..1), error (extra spread, e.g. pressure) }
   */
  throwFrom(qb, target, opts = {}) {
    const from = qb.handWorld('R', new THREE.Vector3());
    from.y = Math.max(from.y, 1.9);
    const speed = opts.speed ?? (16.5 + 9 * qb.r.arm);
    const loft = opts.loft ?? 0.15;
    const aim = new THREE.Vector2();
    const isP = target && target.pos;
    if (isP) aim.copy(target.pos); else aim.set(target[0], target[1]);
    let T = 0.5;
    for (let i = 0; i < 5; i++) {
      const dist = Math.hypot(aim.x - from.x, aim.y - from.z);
      T = Math.max(0.35, (dist / speed) * (1 + loft + dist / 90));
      if (isP) aim.copy(target.pos).addScaledVector(target.vel, T * 0.92);
    }
    // accuracy error grows with distance and pressure
    const err = (1 - qb.r.accuracy) * 0.14 + (opts.error || 0);
    const ang = gauss() * err;
    const dx = aim.x - from.x, dz = aim.y - from.z;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const rx = dx * ca - dz * sa, rz = dx * sa + dz * ca;
    T *= 1 + gauss() * err * 0.5;
    const targetY = 1.35 + gauss() * err * 2;
    const vel = new THREE.Vector3(rx / T, (targetY - from.y + 0.5 * GRAVITY * T * T) / T, rz / T);
    this._launch(from, vel);
    this.isPass = true; this.isSnap = false;
    this.thrower = qb; this.target = isP ? target : null;
    this.attempted.add(qb);
    this.engine.emit('throw', { thrower: qb, target: this.target, flightTime: T });
  }

  /** Knock the ball loose. */
  fumble(p, dir) {
    const from = p.handWorld('R', new THREE.Vector3());
    this.release();
    this.pos.copy(from);
    this.vel.set(p.vel.x * 0.5 + dir.x * 3, 3 + Math.random() * 2.5, p.vel.y * 0.5 + dir.y * 3);
    this.angVel.set(gauss() * 12, gauss() * 12, gauss() * 12);
    this.state = 'loose';
    this.isPass = false; this.isSnap = false;
    this.attempted.clear();
    this.engine.emit('fumble', { player: p });
  }

  /** Where the ball will be when it descends to height h (default catch height). */
  computeLanding(h = 1.3) {
    const y0 = this.pos.y, vy = this.vel.y;
    const disc = vy * vy + 2 * GRAVITY * (y0 - h);
    let t;
    if (disc < 0 || (y0 < h && vy < 0)) {
      const d2 = vy * vy + 2 * GRAVITY * (y0 - 0.15);
      t = d2 > 0 ? (vy + Math.sqrt(d2)) / GRAVITY : 0;
    } else t = (vy + Math.sqrt(disc)) / GRAVITY;
    return { point: new THREE.Vector2(this.pos.x + this.vel.x * t, this.pos.z + this.vel.z * t), t };
  }

  step(dt) {
    if (this.state !== 'air' && this.state !== 'loose') return;
    this.vel.y -= GRAVITY * dt;
    this.vel.multiplyScalar(1 - 0.02 * dt);
    this.pos.addScaledVector(this.vel, dt);
    this.airTime += dt;

    if (this.state === 'air') {
      // spiral: long axis follows the velocity, rolling about it
      this.spin += dt * 28;
      _v.copy(this.vel).normalize();
      this.quat.setFromUnitVectors(Z_AXIS, _v);
      _q.setFromAxisAngle(Z_AXIS, this.spin);
      this.quat.multiply(_q);
      this.landing = this.computeLanding();
    } else {
      // tumble
      const w = this.angVel.length();
      if (w > 1e-4) { _q.setFromAxisAngle(_v.copy(this.angVel).divideScalar(w), w * dt); this.quat.premultiply(_q); }
    }

    if (this.pos.y < 0.13) {
      this.pos.y = 0.13;
      if (this.state === 'air') {
        this.state = 'loose';
        this.landing = null;
        this.engine._onBallGround();
      }
      if (Math.abs(this.vel.y) > 0.9) {
        // prolate bounce: unpredictable direction + energy
        this.vel.y = -this.vel.y * (0.25 + Math.random() * 0.4);
        const a = (Math.random() - 0.5) * 1.8, h = 0.35 + Math.random() * 0.45;
        const c = Math.cos(a), s = Math.sin(a);
        const vx = this.vel.x, vz = this.vel.z;
        this.vel.x = (vx * c - vz * s) * h; this.vel.z = (vx * s + vz * c) * h;
        this.angVel.set(gauss() * 15, gauss() * 15, gauss() * 15);
      } else {
        this.vel.y = 0;
        const f = Math.exp(-dt * 3);
        this.vel.x *= f; this.vel.z *= f; this.angVel.multiplyScalar(f);
        // settle lying on its side
        if (this.vel.lengthSq() < 0.05) {
          _v.set(0, 0, 1).applyQuaternion(this.quat); _v.y = 0;
          if (_v.lengthSq() > 1e-4) { _v.normalize(); _q.setFromUnitVectors(Z_AXIS, _v); this.quat.slerp(_q, Math.min(1, dt * 4)); }
        }
      }
    }
  }

  /** Visual sync. Held balls ride the carrier's right hand. */
  sync() {
    if (this.state === 'held' && this.carrier) {
      const p = this.carrier;
      const hand = p.rig.bones.handR;
      p.handWorld('R', this.pos);
      // align along the forearm, tucked into the hand
      hand.getWorldQuaternion(this.quat);
      _v.set(0, -0.08, 0.06).applyQuaternion(this.quat);
      this.pos.add(_v);
      _q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
      this.quat.multiply(_q);
    }
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.copy(this.quat);
  }
}
