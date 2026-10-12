import * as THREE from 'three';
import { LEG } from './PlayerModel.js';

// ---------------------------------------------------------------------------
// Procedural animator. Every frame it builds a target pose from the player's
// *physical* state (velocity, acceleration, lean, fall angle) plus the active
// intent / upper-body action, then critically-damps each joint toward it.
// Nothing is a canned clip: run cadence comes from distance travelled, lean
// comes from the balance simulation, falls come from the topple simulation.
// ---------------------------------------------------------------------------

const JOINTS = ['pelvis', 'spine', 'chest', 'neck', 'head', 'shL', 'elL', 'handL', 'shR', 'elR', 'handR',
  'hipL', 'knL', 'ankL', 'hipR', 'knR', 'ankR'];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const DOWN = new THREE.Vector3(0, -1, 0);

// Throw keyframes: [t, shR.x, shR.z, elR.x, chest.y, shL.x, shL.z, elL.x, spine.x]
const THROW_KEYS = [
  [0.00, -0.55, 0.25, -1.6, 0.0, -0.55, -0.25, -1.5, 0.25],
  [0.40, -2.05, -0.95, -1.75, -0.8, -1.25, 0.35, -0.45, 0.1],
  [0.55, -2.65, -0.25, -0.45, 0.15, -0.6, 0.6, -0.4, 0.3],
  [1.00, -0.9, 0.5, -0.35, 0.5, -0.2, 0.35, -0.5, 0.45],
];

export class Animator {
  constructor(player) {
    this.p = player;
    this.b = player.rig.bones;
    this.T = {};
    for (const j of JOINTS) this.T[j] = new THREE.Vector3();
    this.phase = Math.random() * Math.PI * 2;
    this.pelvisY = 1.0;
    this.bob = 0;
    this.time = Math.random() * 10;
    this.ikL = new THREE.Vector3(); this.ikR = new THREE.Vector3();
    this.lift = 0;
  }

  _zero() { for (const j of JOINTS) this.T[j].set(0, 0, 0); }

  update(dt) {
    const p = this.p, T = this.T;
    this.time += dt;
    this._zero();

    const speed = p.vel.length();
    const fx = Math.sin(p.facing), fz = Math.cos(p.facing);
    const fwd = speed > 0.05 ? (p.vel.x * fx + p.vel.y * fz) / speed : 1;
    const lat = speed > 0.05 ? (p.vel.x * fz - p.vel.y * fx) / speed : 0; // + = moving to player's left

    // stride-locked phase (prevents foot skating)
    const step = 0.75 + 0.13 * speed;
    const dir = fwd < -0.35 ? -1 : 1;
    this.phase += dir * (speed * dt / (2 * step)) * Math.PI * 2;
    const ph = this.phase;

    let rate = 16;
    let liftTarget = 0;

    if (p.state === 'falling' || p.state === 'down') {
      this._fallPose(p, fx, fz);
      rate = p.state === 'falling' ? 14 : 6;
      liftTarget = 0.16 * Math.sin(Math.min(p.fallAngle, Math.PI / 2));
    } else if (p.state === 'rising') {
      this._risePose(p);
      rate = 10;
      liftTarget = 0.16 * Math.sin(Math.min(p.fallAngle, Math.PI / 2));
    } else if (p.intent.type === 'stance' && speed < 0.6) {
      this._stance(p.intent.kind || '2pt');
      rate = 8;
    } else {
      const crouch = p.crouch || 0;
      this._locomotion(speed, ph, fwd, lat, crouch, p);
    }

    // upper body overlay (only while on feet)
    if (p.state === 'up') this._upper(p, dt);
    else if (p.hasBall) this._carryArm();

    // head look-at (yaw only, relative to body)
    if (p.lookAt && p.state === 'up') {
      const dx = p.lookAt.x - p.pos.x, dz = p.lookAt.z - p.pos.y;
      let a = Math.atan2(dx, dz) - p.facing;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      T.neck.y += clamp(a, -1.1, 1.1) * 0.6;
      T.head.y += clamp(a, -1.1, 1.1) * 0.4;
    }

    // ---- blend toward target -------------------------------------------------
    const k = 1 - Math.exp(-dt * rate);
    const kFast = 1 - Math.exp(-dt * 30);
    const b = this.b;
    for (const j of JOINTS) {
      if (j === 'pelvis') continue;
      const kk = (p.action && p.action.type === 'throw' && (j === 'shR' || j === 'elR' || j === 'chest')) ? kFast : k;
      const r = b[j].rotation, t = T[j];
      r.x += (t.x - r.x) * kk; r.y += (t.y - r.y) * kk; r.z += (t.z - r.z) * kk;
    }
    b.pelvis.rotation.y += (T.pelvis.y - b.pelvis.rotation.y) * k;
    b.pelvis.rotation.z += (T.pelvis.z - b.pelvis.rotation.z) * k;

    // ---- solve pelvis height so the planted foot touches the ground --------
    const legH = (hip, kn) => {
      const a = hip.rotation.x, c = Math.cos(hip.rotation.z);
      return (-LEG.HIP_Y) + (LEG.THIGH * Math.cos(a) + LEG.SHIN * Math.cos(a + kn.rotation.x)) * c + LEG.FOOT_H;
    };
    const hL = legH(b.hipL, b.knL), hR = legH(b.hipR, b.knR);
    const targetY = Math.max(hL, hR) + T.pelvis.x; // T.pelvis.x used as additive vertical offset
    this.pelvisY += (targetY - this.pelvisY) * (1 - Math.exp(-dt * 25));
    b.pelvis.position.y = this.pelvisY;
    this.lift += (liftTarget - this.lift) * (1 - Math.exp(-dt * 10));
  }

  // -------------------------------------------------------------------------
  _locomotion(speed, ph, fwd, lat, crouch, p) {
    const T = this.T;
    const amp = clamp(speed / 9, 0, 1) * 0.85 + (speed > 0.25 ? 0.15 : 0) * clamp(speed / 1.2, 0, 1);
    const s = Math.sin(ph), c = Math.cos(ph);
    const shuffle = speed < 5.5 && Math.abs(lat) > 0.7 ? clamp((Math.abs(lat) - 0.7) / 0.3, 0, 1) : 0;
    const fa = 1 - shuffle * 0.75;

    T.hipL.x = -s * 0.85 * amp * fa - 0.12 * amp - 0.55 * crouch;
    T.hipR.x = s * 0.85 * amp * fa - 0.12 * amp - 0.55 * crouch;
    T.knL.x = 0.12 + amp * (0.25 + 1.3 * Math.max(0, c)) * fa + 0.95 * crouch;
    T.knR.x = 0.12 + amp * (0.25 + 1.3 * Math.max(0, -c)) * fa + 0.95 * crouch;
    // lateral shuffle: alternate abduction
    const side = Math.sign(lat) || 1;
    T.hipL.z = 0.06 + shuffle * (0.22 + 0.18 * s * side);
    T.hipR.z = -0.06 - shuffle * (0.22 - 0.18 * s * side);
    T.ankL.x = -(T.hipL.x + T.knL.x) + 0.35 * amp * Math.max(0, c);
    T.ankR.x = -(T.hipR.x + T.knR.x) + 0.35 * amp * Math.max(0, -c);

    // arms counter-swing
    T.shL.x = s * 0.95 * amp - 0.1; T.shR.x = -s * 0.95 * amp - 0.1;
    T.shL.z = 0.1 + 0.05 * amp; T.shR.z = -0.1 - 0.05 * amp;
    T.elL.x = -0.35 - 1.05 * amp; T.elR.x = -0.35 - 1.05 * amp;

    // torso: lean from speed + physical acceleration
    const acc = p.accelLocal; // forward accel
    T.spine.x = 0.06 + 0.22 * amp + 0.4 * crouch + clamp(acc * 0.025, -0.15, 0.3) + (fwd < -0.35 ? 0.15 : 0);
    T.chest.y = s * 0.16 * amp;
    T.pelvis.y = -s * 0.12 * amp;
    T.neck.x = -T.spine.x * 0.7;
    T.pelvis.x = Math.abs(c) * 0.035 * amp; // run bounce

    // idle breathing / weight shift
    if (speed < 0.3 && crouch < 0.1) {
      const br = Math.sin(this.time * 2.1);
      T.chest.x = br * 0.02;
      T.hipL.x -= 0.06; T.knL.x += 0.12; T.hipR.x -= 0.06; T.knR.x += 0.12;
      T.ankL.x = -(T.hipL.x + T.knL.x); T.ankR.x = -(T.hipR.x + T.knR.x);
      T.shL.z = 0.16; T.shR.z = -0.16; T.elL.x = -0.3; T.elR.x = -0.3;
      T.shL.x = 0.05; T.shR.x = 0.05;
    }
  }

  _stance(kind) {
    const T = this.T;
    switch (kind) {
      case '3pt':
      case 'center':
        T.spine.x = 1.12; T.chest.x = 0.18; T.neck.x = -1.05; T.head.x = -0.2;
        T.hipL.x = -1.3; T.knL.x = 1.95; T.hipR.x = -0.95; T.knR.x = 1.8;
        T.hipL.z = 0.16; T.hipR.z = -0.16;
        T.shR.x = -1.38; T.elR.x = -0.05;
        if (kind === 'center') { T.shL.x = -1.38; T.elL.x = -0.05; }
        else { T.shL.x = -0.75; T.elL.x = -0.95; T.shL.z = 0.1; }
        break;
      case 'qb':
        T.spine.x = 0.28; T.neck.x = -0.25;
        T.hipL.x = -0.38; T.knL.x = 0.6; T.hipR.x = -0.38; T.knR.x = 0.6;
        T.hipL.z = 0.1; T.hipR.z = -0.1;
        T.shL.x = -0.6; T.elL.x = -1.2; T.shR.x = -0.6; T.elR.x = -1.2;
        T.shL.z = -0.15; T.shR.z = 0.15;
        break;
      case 'wr': // staggered receiver stance
        T.spine.x = 0.55; T.neck.x = -0.55;
        T.hipL.x = -0.85; T.knL.x = 1.0; T.hipR.x = -0.2; T.knR.x = 0.55;
        T.shL.x = 0.35; T.elL.x = -0.8; T.shR.x = -0.7; T.elR.x = -0.9;
        break;
      case 'lb':
      case '2pt':
      default:
        T.spine.x = 0.58; T.neck.x = -0.6;
        T.hipL.x = -0.72; T.knL.x = 1.05; T.hipR.x = -0.62; T.knR.x = 1.0;
        T.hipL.z = 0.18; T.hipR.z = -0.18;
        T.shL.x = -0.55; T.elL.x = -0.75; T.shR.x = -0.55; T.elR.x = -0.75;
        T.shL.z = 0.12; T.shR.z = -0.12;
        break;
    }
    T.ankL.x = -(T.hipL.x + T.knL.x); T.ankR.x = -(T.hipR.x + T.knR.x);
    T.chest.x += Math.sin(this.time * 2.3) * 0.015;
  }

  _fallPose(p, fx, fz) {
    const T = this.T;
    const fwd = p.fallDir.x * fx + p.fallDir.y * fz; // + = falling face-first
    const ground = p.state === 'down' ? 1 : smooth(clamp(p.fallAngle / 1.5, 0, 1));
    const t = this.time;
    if (fwd > -0.2) {
      // face-first / dive: arms reach out, legs trail
      T.shL.x = lerp(-1.8, -2.7, ground); T.shR.x = lerp(-1.8, -2.7, ground);
      T.shL.z = 0.35; T.shR.z = -0.35;
      T.elL.x = -0.4; T.elR.x = -0.4;
      T.spine.x = lerp(0.3, -0.1, ground); T.neck.x = lerp(-0.4, -0.9, ground);
      T.hipL.x = lerp(-0.4, 0.15, ground); T.knL.x = lerp(0.7, 0.5, ground);
      T.hipR.x = lerp(-0.1, 0.2, ground); T.knR.x = lerp(0.9, 0.9, ground);
    } else {
      // knocked backward: arms flail, hips flex
      T.shL.x = -0.9 + Math.sin(t * 9) * 0.3 * (1 - ground); T.shR.x = -0.7 + Math.cos(t * 8) * 0.3 * (1 - ground);
      T.shL.z = 1.1; T.shR.z = -1.1;
      T.elL.x = -0.6; T.elR.x = -0.6;
      T.spine.x = 0.45; T.neck.x = 0.4;
      T.hipL.x = -1.1; T.knL.x = 1.1; T.hipR.x = -0.8; T.knR.x = 0.6;
    }
    // sideways falls: splay
    T.hipL.z = 0.15; T.hipR.z = -0.15;
    T.ankL.x = 0.4; T.ankR.x = 0.4;
    T.pelvis.x = 0;
  }

  _risePose(p) {
    const T = this.T;
    const u = clamp(p.riseT / p.riseDur, 0, 1);
    const kneel = Math.sin(u * Math.PI); // in the middle of getting up = deep kneel
    T.spine.x = 0.9 * kneel + 0.1; T.neck.x = -0.5 * kneel;
    T.hipL.x = -1.5 * kneel - 0.05; T.knL.x = 2.1 * kneel + 0.1;
    T.hipR.x = -0.4 * kneel; T.knR.x = 1.9 * kneel + 0.1;
    T.ankL.x = -(T.hipL.x + T.knL.x); T.ankR.x = 0.6 * kneel;
    T.shL.x = -0.6 * kneel; T.elL.x = -0.3; T.shR.x = -0.6 * kneel; T.elR.x = -0.3;
    if (p.hasBall) this._carryArm();
  }

  _carryArm() {
    const T = this.T;
    T.shR.x = -0.4; T.shR.z = 0.32; T.shR.y = 0.2; T.elR.x = -1.95; T.handR.x = 0.2;
  }

  _upper(p, dt) {
    const T = this.T;
    const a = p.action;
    if (a && a.type === 'throw') {
      const u = clamp(a.t / a.dur, 0, 1);
      let i = 0;
      while (i < THROW_KEYS.length - 2 && u > THROW_KEYS[i + 1][0]) i++;
      const k0 = THROW_KEYS[i], k1 = THROW_KEYS[i + 1];
      const w = smooth(clamp((u - k0[0]) / (k1[0] - k0[0]), 0, 1));
      T.shR.x = lerp(k0[1], k1[1], w); T.shR.z = lerp(k0[2], k1[2], w); T.elR.x = lerp(k0[3], k1[3], w);
      T.chest.y = lerp(k0[4], k1[4], w);
      T.shL.x = lerp(k0[5], k1[5], w); T.shL.z = lerp(k0[6], k1[6], w); T.elL.x = lerp(k0[7], k1[7], w);
      T.spine.x = lerp(k0[8], k1[8], w);
      T.shR.y = 0; T.shL.y = 0;
      return;
    }
    if (a && a.type === 'handoff') {
      T.shR.x = -0.9; T.shR.z = -0.25; T.elR.x = -0.5; T.chest.y = -0.3;
      T.shL.x = -0.5; T.elL.x = -1.2;
      return;
    }
    if (a && a.type === 'celebrate') {
      const t = a.t;
      T.shL.x = -2.8 + Math.sin(t * 11) * 0.35; T.shR.x = -2.8 + Math.cos(t * 11) * 0.35;
      T.shL.z = 0.35; T.shR.z = -0.35; T.elL.x = -0.4; T.elR.x = -0.4;
      T.pelvis.x += Math.abs(Math.sin(t * 6.5)) * 0.22;
      T.knL.x += 0.3; T.knR.x += 0.3; T.hipL.x -= 0.15; T.hipR.x -= 0.15;
      if (p.hasBall) { T.shR.x = -2.9; T.elR.x = -0.2; }
      return;
    }
    // reaching for a ball in the air (two-hand IK toward the ball)
    if (p.reachTarget) {
      this._ikArm('L', p.reachTarget, 0.12);
      this._ikArm('R', p.reachTarget, -0.12);
      return;
    }
    if (p.hasBall) {
      if (p.upper === 'qbHold') {
        T.shL.x = -0.65; T.shL.z = -0.3; T.elL.x = -1.5;
        T.shR.x = -0.55; T.shR.z = 0.3; T.elR.x = -1.6; T.shR.y = 0;
      } else this._carryArm();
      return;
    }
    if (p.upper === 'block') {
      T.shL.x = -1.35; T.shR.x = -1.35; T.elL.x = -0.55; T.elR.x = -0.55;
      T.shL.z = -0.12; T.shR.z = 0.12; T.handL.x = -0.4; T.handR.x = -0.4;
      T.spine.x += 0.1;
      return;
    }
    if (p.upper === 'brace') {
      T.shL.x = -1.5; T.shR.x = -1.5; T.elL.x = -0.7; T.elR.x = -0.7;
      T.shL.z = 0.45; T.shR.z = -0.45;
      return;
    }
  }

  /** Aim an arm at a world point by rotating the shoulder (simple 1-bone IK). */
  _ikArm(side, worldPt, spread) {
    const sh = this.b['sh' + side];
    const chest = this.b.chest;
    _v.copy(worldPt);
    chest.worldToLocal(_v);
    _v.sub(sh.position);
    if (_v.lengthSq() < 1e-4) return;
    _v.normalize();
    _q.setFromUnitVectors(DOWN, _v);
    _e.setFromQuaternion(_q, 'XYZ');
    const T = this.T;
    T['sh' + side].set(_e.x, _e.y, _e.z + spread);
    T['el' + side].x = -0.25;
    T['hand' + side].x = -0.3;
  }
}
