import * as THREE from 'three';
import { createPlayerRig, disposeRig } from './PlayerModel.js';
import { createGameRig } from './characters/gamePlayer.js';
import { resolveBody, rng } from './Body.js';
import { resolveKit } from './Uniforms.js';
import { Animator } from './Animator.js';
import { FIELD, PROFILES, GRAVITY, SKIN_TONES } from './constants.js';
import { placeholderName } from './names.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const _t = new THREE.Vector2();
const _d = new THREE.Vector2();
const _w = new THREE.Vector3();
const _axis = new THREE.Vector3();

/**
 * A single simulated athlete.
 *
 * Physical body: a mass on a 2D plane (pos/vel in yards), a steering force
 * limit (strength/agility), and a balance model — an inverted pendulum whose
 * lean is kicked by collision impulses and pulled by tacklers. If lean
 * exceeds the balance threshold, he topples (falling → down → rising).
 *
 * Brain: an `intent` your sim sets via the command methods below. The intent
 * only produces a *desired velocity / facing*; the physics decides what
 * actually happens.
 */
export class Player {
  constructor(engine, o) {
    this.engine = engine;
    this.id = ++Player._nextId;
    this.team = o.team;             // 'home' | 'away'
    this.teamData = o.teamData;
    this.number = o.number ?? 0;
    this.position = o.position || 'WR';
    // body: from the sim's height/weight (rolled from the position if missing).
    // `body` can also be a previously resolved body to rebuild a player exactly.
    this.body = o.body?.p ? o.body : resolveBody({
      seed: o.seed, position: this.position, heightIn: o.heightIn, weightLb: o.weightLb,
      archetype: o.archetype, overrides: o.body,
    });
    const rand = rng(this.body.seed ^ 0x5bd1e995);
    this.name = o.name || placeholderName(rand);
    const prof = { ...PROFILES[this.position], ...(o.ratings || {}) };
    this.r = prof;

    // --- physical body -------------------------------------------------------
    this.mass = o.ratings?.mass ?? this.body.weightLb * 0.4536;
    this.radius = 0.3 + 0.12 * clamp((this.body.weightLb - 180) / 150, 0, 1);
    this.maxSpeed = prof.speed;
    this.maxForce = this.mass * (6.5 + 2.5 * prof.agility) * (0.75 + 0.25 * prof.strength);
    this.turnRate = 6 + 5 * prof.agility;
    this.pos = new THREE.Vector2(o.x || 0, o.z || 0);
    this.vel = new THREE.Vector2();
    this.prevVel = new THREE.Vector2();
    this.accel = new THREE.Vector2();
    this.accelLocal = 0;
    this.desiredVel = new THREE.Vector2();
    this.facing = o.facing ?? 0;
    this.desiredFacing = this.facing;
    this.speedScale = 1;              // e.g. fatigue hook

    // balance / fall
    this.state = 'up';                // up | falling | down | rising
    this.lean = new THREE.Vector2();  // radians, world-space lean vector
    this.leanVel = new THREE.Vector2();
    this.fallDir = new THREE.Vector2(1, 0);
    this.fallAngle = 0;
    this.fallVel = 0;
    this.downTime = 0;
    this.riseT = 0; this.riseDur = 0.9;
    this.stayDown = false;
    this.diving = false;
    this.riseDelay = 1.2;
    this.wrapLoad = 0;

    // contact bookkeeping (filled by Physics)
    this.contacts = new Map();        // other -> { t, n }
    this.grips = new Map();           // carrier this player is wrapping -> grip strength
    this.engagedWith = null;
    this.engageT = 0;
    this.ripSide = 1;

    // brain / animation flags
    this.intent = { type: 'idle' };
    this.upper = null;                // 'block' | 'brace' | 'qbHold' | null
    this.action = null;               // { type:'throw'|'handoff'|'celebrate', t, dur, ... }
    this.crouch = 0;
    this.hasBall = false;
    this.lookAt = null;               // THREE.Vector3 | null
    this.reachTarget = null;          // THREE.Vector3 | null
    this.catchCooldown = 0;
    this.userData = {};               // free for your sim

    this._skin = o.skin || SKIN_TONES[(rand() * SKIN_TONES.length) | 0];
    this.kit = resolveKit(o.teamData, o.uniform);
    const build = engine.playerModel === 'classic' ? createPlayerRig : createGameRig;   // 'classic' = the previous code-built players
    this.rig = build({ body: this.body, kit: this.kit, skin: this._skin, number: this.number, name: this.name });
    this.rig.root.userData.player = this;
    engine.scene.add(this.rig.root);
    this.anim = new Animator(this);
    this.syncVisual();
  }

  // =========================================================================
  // COMMAND API — call these from your coach/sim layer
  // =========================================================================
  /** Instantly place the player (formation setup, replays). */
  teleport(x, z, facing = this.facing) {
    this.pos.set(x, z); this.vel.set(0, 0); this.facing = this.desiredFacing = facing;
    this.state = 'up'; this.lean.set(0, 0); this.leanVel.set(0, 0); this.fallAngle = 0;
    this.diving = false; this.action = null; this.grips.clear();
    return this;
  }
  idle(facing) { return this._set({ type: 'idle', facing }); }
  /** Hold a pre-snap stance. kind: '3pt' | 'center' | '2pt' | 'wr' | 'lb' | 'qb' */
  stance(kind, facing) { return this._set({ type: 'stance', kind, facing, x: this.pos.x, z: this.pos.y }); }
  /** Move to a point. opts: { speed: 0..1, face: radians, arrive: yards } */
  moveTo(x, z, opts = {}) { return this._set({ type: 'moveTo', x, z, speed: opts.speed ?? 1, face: opts.face, arrive: opts.arrive ?? 1.5 }); }
  /** Run a route: array of [x,z] world points. opts: { speed, settle: bool (sit down at end) } */
  runRoute(points, opts = {}) { return this._set({ type: 'route', points: points.map(p => new THREE.Vector2(p[0], p[1])), idx: 0, speed: opts.speed ?? 1, settle: !!opts.settle }); }
  /**
   * Block. opts: { target: Player, protect: Player|[x,z] (pass pro anchor),
   *   drive: [dx,dz] (run-block push direction), zone: [x,z] (area to pick up rushers), radius }
   */
  block(opts = {}) { return this._set({ type: 'block', target: opts.target || null, protect: opts.protect || null, drive: opts.drive ? new THREE.Vector2(...opts.drive).normalize() : null, zone: opts.zone ? new THREE.Vector2(...opts.zone) : this.pos.clone(), radius: opts.radius ?? 5 }); }
  /** Rush a target (default: whoever holds the ball). */
  rush(target = null) { return this._set({ type: 'rush', target }); }
  /** Pursue and tackle (default: ball carrier). */
  pursue(target = null) { return this._set({ type: 'pursue', target }); }
  /** Man coverage. opts: { cushion, dir: +1/-1 direction the offense attacks } */
  cover(target, opts = {}) { return this._set({ type: 'cover', target, cushion: opts.cushion ?? 2.0, dir: opts.dir ?? 1 }); }
  /** Zone drop to a spot. opts: { dir, radius } */
  zone(x, z, opts = {}) { return this._set({ type: 'zone', spot: new THREE.Vector2(x, z), dir: opts.dir ?? 1, radius: opts.radius ?? 7 }); }
  /** Ball-carrier AI. opts: { dir: +1/-1, lane: z, losX } */
  carry(opts = {}) { return this._set({ type: 'carry', dir: opts.dir ?? 1, lane: opts.lane ?? null, losX: opts.losX ?? this.pos.x }); }
  /** Go get the ball (in air: catch point; loose: scoop). */
  playBall() { return this._set({ type: 'playBall' }); }
  recover() { return this._set({ type: 'recover' }); }
  celebrate(dur = 3) { this.action = { type: 'celebrate', t: 0, dur }; return this._set({ type: 'idle' }); }

  /** Throw to a Player (led automatically) or a point [x,z]. opts: { speed, loft } */
  throwTo(target, opts = {}) {
    if (!this.hasBall || this.state !== 'up') return false;
    this.action = { type: 'throw', t: 0, dur: 0.62, release: 0.34, released: false, target, opts };
    return true;
  }
  handoffTo(target) {
    if (!this.hasBall) return false;
    this.action = { type: 'handoff', t: 0, dur: 1.2, target };
    return true;
  }
  /** Deliberate dive (tackle attempt, lunge for a ball). dir: Vector2 or [x,z]. */
  dive(dir) {
    if (this.state !== 'up') return;
    const d = Array.isArray(dir) ? new THREE.Vector2(dir[0], dir[1]) : dir.clone();
    if (d.lengthSq() < 1e-6) d.set(Math.sin(this.facing), Math.cos(this.facing));
    d.normalize();
    this.diving = true;
    this.state = 'falling';
    this.fallDir.copy(d);
    this.fallAngle = 0.4; this.fallVel = 2.8;
    this.riseDelay = 0.8 + Math.random() * 1.2;
    this.vel.addScaledVector(d, 3.2);
    const sp = this.vel.length(), cap = this.maxSpeed + 2.5;
    if (sp > cap) this.vel.multiplyScalar(cap / sp);
    this.facing = Math.atan2(d.x, d.y);
  }

  _set(intent) { this.intent = intent; return this; }

  // =========================================================================
  // BRAIN → desired velocity (called every physics step)
  // =========================================================================
  think(dt) {
    const e = this.engine, ball = e.ball, it = this.intent;
    this.desiredVel.set(0, 0);
    this.upper = null; this.crouch = 0; this.lookAt = null; this.reachTarget = null;
    this.catchCooldown = Math.max(0, this.catchCooldown - dt);
    if (this.action) {
      this.action.t += dt;
      this._runAction(dt);
      if (this.action && this.action.t >= this.action.dur) this.action = null;
    }
    if (this.state !== 'up') return;

    const vmax = this.maxSpeed * this.speedScale;
    let face = null;

    switch (it.type) {
      case 'idle':
        if (it.facing != null) face = it.facing;
        break;
      case 'stance':
        this._arrive(it.x, it.z, 0.4, 0.3);
        face = it.facing ?? this.facing;
        break;
      case 'moveTo': {
        const d = this._arrive(it.x, it.z, vmax * it.speed, it.arrive);
        face = d < 0.4 && it.face != null ? it.face : null;
        break;
      }
      case 'route': {
        const pt = it.points[it.idx];
        if (pt) {
          _d.subVectors(pt, this.pos);
          if (_d.length() < 0.9) it.idx++;
          this._seekDir(_d, vmax * it.speed);
        } else if (it.settle) {
          // sit down in the hole facing the QB
          this.vel.length() > 0.3 && this.desiredVel.set(0, 0);
          const c = ball.carrierPos();
          if (c) face = Math.atan2(c.x - this.pos.x, c.y - this.pos.y);
        } else {
          // continue on last heading
          const n = it.points.length;
          const a = n > 1 ? it.points[n - 2] : this.pos;
          _d.subVectors(it.points[n - 1], a);
          if (_d.lengthSq() < 1e-4) _d.set(Math.sin(this.facing), Math.cos(this.facing));
          this._seekDir(_d, vmax * it.speed);
        }
        if (ball.state === 'air') this.lookAt = ball.pos;
        break;
      }
      case 'block': face = this._block(it, vmax); break;
      case 'rush': face = this._rush(it, vmax, dt); break;
      case 'pursue': face = this._pursue(it, vmax, dt); break;
      case 'cover': face = this._cover(it, vmax); break;
      case 'zone': face = this._zone(it, vmax); break;
      case 'carry': face = this._carry(it, vmax); break;
      case 'playBall': face = this._playBall(vmax); break;
      case 'recover': {
        if (ball.state === 'loose') this._arrive(ball.pos.x, ball.pos.z, vmax, 0.2);
        this.lookAt = ball.pos;
        break;
      }
    }

    // Ball-in-air awareness: reach for catchable balls
    if (ball.state === 'air' && this.catchCooldown <= 0 && !this.hasBall) {
      const dx = ball.pos.x - this.pos.x, dz = ball.pos.z - this.pos.y;
      const dh = Math.hypot(dx, dz);
      const closing = (ball.vel.x * -dx + ball.vel.z * -dz) > 0;
      if (dh < 3.2 && closing && ball.pos.y < 3.5 && it.type !== 'block' && it.type !== 'rush') this.reachTarget = ball.pos;
      if (it.type === 'route' || it.type === 'cover' || it.type === 'zone' || it.type === 'playBall') this.lookAt = ball.pos;
    }

    // facing: toward explicit face, else toward movement
    if (face != null) this.desiredFacing = face;
    else if (this.desiredVel.lengthSq() > 0.5) this.desiredFacing = Math.atan2(this.desiredVel.x, this.desiredVel.y);
    if (this.action && this.action.type === 'throw' && this.action.aim) this.desiredFacing = this.action.aim;
  }

  _arrive(x, z, speed, radius = 1.5) {
    _d.set(x - this.pos.x, z - this.pos.y);
    const dist = _d.length();
    if (dist < 0.08) return dist;
    const s = Math.min(speed, speed * dist / radius, dist * 4);
    this.desiredVel.copy(_d).multiplyScalar(s / dist);
    return dist;
  }

  _seekDir(dir, speed) {
    const l = dir.length();
    if (l > 1e-5) this.desiredVel.copy(dir).multiplyScalar(speed / l);
  }

  _opponents() { return this.engine.players.filter(p => p.team !== this.team); }

  _block(it, vmax) {
    const e = this.engine;
    let t = it.target;
    if (!t || t.state === 'down' || t.pos.distanceTo(this.pos) > it.radius + 3) {
      // auto-pick the most threatening un-blocked rusher in my area
      let best = null, bs = Infinity;
      for (const o of this._opponents()) {
        if (o.state === 'down') continue;
        const d = o.pos.distanceTo(it.zone || this.pos);
        if (d > it.radius) continue;
        let blockers = 0;
        for (const p of e.players) if (p !== this && p.team === this.team && p.intent.type === 'block' && p.intent.target === o) blockers++;
        const score = d + blockers * 2.5 + (o.intent.type === 'rush' || o.intent.type === 'pursue' ? 0 : 2);
        if (score < bs) { bs = score; best = o; }
      }
      it.target = t = best;
    }
    const c = e.ball.carrierPos();
    if (!t) {
      // nobody to block: hold ground / climb toward the zone
      if (it.zone) this._arrive(it.zone.x, it.zone.y, vmax * 0.5, 1);
      this.crouch = 0.6;
      return c ? Math.atan2(-(c.x - this.pos.x), -(c.y - this.pos.y)) : null;
    }
    const rr = this.radius + t.radius - 0.12;
    if (it.drive) {
      // run block: get to the near side of the defender and push him along `drive`
      _t.copy(t.pos).addScaledVector(it.drive, -rr + 0.9);
    } else {
      // pass pro: stay between rusher and the protected point
      const prot = it.protect ? (it.protect.pos || new THREE.Vector2(it.protect[0], it.protect[1])) : (c || this.pos);
      _d.subVectors(prot, t.pos);
      if (_d.lengthSq() < 1e-4) _d.set(1, 0);
      _d.normalize();
      _t.copy(t.pos).addScaledVector(_d, rr);
    }
    _d.subVectors(_t, this.pos);
    const dist = _d.length();
    const s = Math.min(vmax, 1.2 + dist * 6);
    if (dist > 1e-4) this.desiredVel.copy(_d).multiplyScalar(s / dist);
    const dToT = this.pos.distanceTo(t.pos);
    this.crouch = dToT < 3 ? 0.75 : 0.4;
    if (dToT < 2.2) this.upper = 'block';
    return Math.atan2(t.pos.x - this.pos.x, t.pos.y - this.pos.y);
  }

  _rush(it, vmax, dt) {
    const e = this.engine;
    const t = it.target || e.ball.carrier;
    if (!t || t === this || t.team === this.team) {
      const bp = e.ball.pos; this._arrive(bp.x, bp.z, vmax, 0.5); return null;
    }
    _d.subVectors(t.pos, this.pos);
    const dist = _d.length() || 1;
    _d.divideScalar(dist);
    // engaged with a blocker? → hand fight + rip/swim move around him
    let blocker = null;
    for (const [o, c] of this.contacts) if (o.team !== this.team && o.intent.type === 'block' && e.time - c.t < 0.12) { blocker = o; break; }
    if (blocker) {
      if (this.engagedWith !== blocker) { this.engagedWith = blocker; this.engageT = 0; this.ripSide = Math.random() < 0.5 ? 1 : -1; }
      this.engageT += dt;
      if (Math.random() < dt * 0.4) this.ripSide *= -1; // counter move
      const rip = (0.35 + 0.65 * this.r.passRush) * Math.min(1, this.engageT * 1.5);
      this.desiredVel.set(_d.x + -_d.y * this.ripSide * rip * 1.4, _d.y + _d.x * this.ripSide * rip * 1.4).normalize().multiplyScalar(vmax);
      this.upper = 'block'; this.crouch = 0.7;
    } else {
      this.engagedWith = null;
      _t.copy(t.pos).addScaledVector(t.vel, Math.min(dist / vmax, 0.8) * 0.6);
      this._arrive(_t.x, _t.y, vmax, 0.2);
      this.crouch = dist < 4 ? 0.3 : 0.15;
      if (dist < 3) this.upper = 'brace';
      this._maybeDive(t, dist, dt);
    }
    return Math.atan2(t.pos.x - this.pos.x, t.pos.y - this.pos.y);
  }

  _pursue(it, vmax, dt) {
    const e = this.engine;
    const t = it.target || e.ball.carrier;
    if (!t || t.team === this.team) {
      if (e.ball.state === 'loose') { this._arrive(e.ball.pos.x, e.ball.pos.z, vmax, 0.2); }
      return null;
    }
    _d.subVectors(t.pos, this.pos);
    const dist = _d.length();
    // interception course: lead the carrier by our closing time
    const T = clamp(dist / Math.max(vmax, 1), 0, 1.3);
    _t.copy(t.pos).addScaledVector(t.vel, T * 0.85);
    this._arrive(_t.x, _t.y, vmax, 0.2);
    if (dist < 3.2) this.upper = 'brace';
    this.crouch = dist < 4 ? 0.25 : 0;
    this._maybeDive(t, dist, dt);
    return null;
  }

  _maybeDive(t, dist, dt) {
    if (!t.hasBall || t.state !== 'up') return;
    if (dist > 2.4 || dist < 0.9) return;
    // only dive if he's getting away from us (we can't close by running)
    _d.subVectors(t.pos, this.pos).normalize();
    const closing = this.vel.dot(_d) - t.vel.dot(_d);
    if (closing > 3.5) return;
    if (Math.random() < dt * 2.5 * this.r.tackle) {
      _t.copy(t.pos).addScaledVector(t.vel, 0.22).sub(this.pos);
      this.dive(_t);
    }
  }

  _cover(it, vmax) {
    const e = this.engine;
    const t = it.target;
    if (!t) return null;
    if (e.ball.state === 'air' && e.ball.landing) {
      const L = e.ball.landing;
      if (L.point.distanceTo(this.pos) < 12) return this._playBall(vmax);
    }
    const dir = it.dir;
    // cushion shrinks as the receiver closes
    const rel = (this.pos.x - t.pos.x) * dir;
    const cushion = clamp(it.cushion, 0.8, 6);
    const inside = -Math.sign(t.pos.y) * 0.7;
    _t.set(t.pos.x + dir * cushion, t.pos.y + inside);
    _t.addScaledVector(t.vel, 0.25);
    this._arrive(_t.x, _t.y, vmax * 0.98, 0.5);
    if (rel > 1.2) return Math.atan2(-dir * 1, 0) ; // backpedal facing the LOS
    return null;
  }

  _zone(it, vmax) {
    const e = this.engine;
    if (e.ball.state === 'air' && e.ball.landing && e.ball.landing.point.distanceTo(this.pos) < 14) return this._playBall(vmax);
    let threat = null, bd = it.radius;
    for (const o of this._opponents()) {
      if (o.intent.type !== 'route' && o.intent.type !== 'carry') continue;
      const d = o.pos.distanceTo(it.spot);
      if (d < bd) { bd = d; threat = o; }
    }
    if (threat) _t.lerpVectors(it.spot, threat.pos, 0.6); else _t.copy(it.spot);
    this._arrive(_t.x, _t.y, vmax * 0.9, 1.0);
    const c = e.ball.carrierPos();
    return c ? Math.atan2(c.x - this.pos.x, c.y - this.pos.y) : Math.atan2(-it.dir, 0);
  }

  _playBall(vmax) {
    const b = this.engine.ball;
    if (b.state === 'air' && b.landing) {
      const p = b.landing.point;
      this._arrive(p.x, p.y, vmax, 0.4);
      this.lookAt = b.pos;
      return null;
    }
    if (b.state === 'loose') { this._arrive(b.pos.x, b.pos.z, vmax, 0.2); this.lookAt = b.pos; }
    return null;
  }

  _carry(it, vmax) {
    const e = this.engine;
    const dir = it.dir;
    const want = new THREE.Vector2(dir, 0);
    // follow the called lane until past the line
    if (it.lane != null && (this.pos.x - it.losX) * dir < 1.5) want.y = clamp((it.lane - this.pos.y) * 0.5, -1.2, 1.2);
    // vision: slide away from defenders in front, ignore those behind
    for (const o of this._opponents()) {
      if (o.state === 'down') continue;
      _d.subVectors(this.pos, o.pos);
      const dist = _d.length();
      if (dist > 7 || dist < 1e-3) continue;
      const ahead = (o.pos.x - this.pos.x) * dir > -1.0;
      const w = (1 - dist / 7) ** 2 * (ahead ? 2.2 : 0.6);
      const sideSign = Math.sign(_d.y) || (this.id % 2 ? 1 : -1);
      want.y += sideSign * w * 1.4;
      want.x -= dir * w * (ahead ? 0.35 : -0.2);
    }
    // stay in bounds
    const edge = FIELD.HALF_WID - 2.5;
    if (Math.abs(this.pos.y) > edge) want.y -= Math.sign(this.pos.y) * (Math.abs(this.pos.y) - edge) * 0.8;
    if (want.x * dir < 0.25) want.x = dir * 0.25;
    want.normalize().multiplyScalar(vmax);
    this.desiredVel.copy(want);
    return null;
  }

  _runAction(dt) {
    const a = this.action, e = this.engine;
    if (a.type === 'throw') {
      const tgtPos = a.target && a.target.pos ? a.target.pos : (a.target ? _t.set(a.target[0], a.target[1]) : null);
      if (tgtPos) a.aim = Math.atan2(tgtPos.x - this.pos.x, tgtPos.y - this.pos.y);
      if (!a.released && a.t >= a.release && this.hasBall) {
        a.released = true;
        e.ball.throwFrom(this, a.target, a.opts);
      }
    } else if (a.type === 'handoff') {
      const t = a.target;
      if (!this.hasBall || !t) { this.action = null; return; }
      if (t.pos.distanceTo(this.pos) < 1.15 && t.state === 'up') {
        e.ball.attach(t);
        e.emit('handoff', { from: this, to: t });
        a.dur = a.t + 0.25;
      }
    }
  }

  // =========================================================================
  // BODY (called by Physics)
  // =========================================================================
  applySteering(dt) {
    if (this.state === 'up') {
      _d.subVectors(this.desiredVel, this.vel).multiplyScalar(this.mass * 7);
      // a player who is stumbling (big lean) can't push as hard
      const leanPenalty = 1 - clamp(this.lean.length() / 0.6, 0, 0.7);
      const fmax = this.maxForce * leanPenalty;
      const f = _d.length();
      if (f > fmax) _d.multiplyScalar(fmax / f);
      this.vel.addScaledVector(_d, dt / this.mass);
      // stumble: step under the lean to try and recover
      this.vel.addScaledVector(this.lean, dt * 9);
      // turning
      const da = angDiff(this.facing, this.desiredFacing);
      const maxTurn = this.turnRate * dt * (1 - 0.06 * this.vel.length() / 2);
      this.facing += clamp(da, -Math.max(maxTurn, 0.02), Math.max(maxTurn, 0.02));
    } else {
      // on the ground / in the air: friction only
      const fr = this.state === 'falling' ? (this.diving ? 0.6 : 1.4) : 6;
      this.vel.multiplyScalar(Math.exp(-dt * fr));
    }
  }

  integrate(dt) {
    this.pos.addScaledVector(this.vel, dt);
  }

  /** Balance / topple simulation. */
  updateBalance(dt) {
    this.accel.subVectors(this.vel, this.prevVel).divideScalar(dt);
    this.prevVel.copy(this.vel);
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    this.accelLocal += ((this.accel.x * fx + this.accel.y * fz) - this.accelLocal) * Math.min(1, dt * 8);

    if (this.state === 'up') {
      // being wrapped up: grip from tacklers weakens balance and drags you
      let wrap = 0;
      for (const p of this.engine.players) {
        const g = p.grips.get(this);
        if (g) {
          wrap += g;
          // tackler drives through the carrier (lean away from him) and his
          // relative momentum twists the carrier down
          _t.subVectors(this.pos, p.pos).normalize();
          this.leanVel.addScaledVector(_t, dt * 0.55 * g * p.r.tackle);
          this.leanVel.x += (p.vel.x - this.vel.x) * dt * 0.1 * g;
          this.leanVel.y += (p.vel.y - this.vel.y) * dt * 0.1 * g;
        }
      }
      this.wrapLoad = wrap;
      const k = 32 * this.r.balance / (1 + 1.6 * wrap);   // recovery stiffness
      const g = 15;                                         // gravity term (pendulum)
      // desired lean from acceleration (lean into accel/turns)
      const tx = clamp(this.accel.x * 0.012, -0.18, 0.18), tz = clamp(this.accel.y * 0.012, -0.18, 0.18);
      const ax = -k * (this.lean.x - tx) - 8 * this.leanVel.x + g * this.lean.x;
      const az = -k * (this.lean.y - tz) - 8 * this.leanVel.y + g * this.lean.y;
      this.leanVel.x += ax * dt; this.leanVel.y += az * dt;
      this.lean.addScaledVector(this.leanVel, dt);
      if (wrap > 0) this.vel.multiplyScalar(Math.exp(-dt * 1.2 * wrap));
      const L = this.lean.length();
      if (L > 0.58) this._startFall(this.lean, Math.max(this.leanVel.dot(_t.copy(this.lean).normalize()), 0.6), L);
    } else if (this.state === 'falling') {
      this.fallVel += 16 * Math.sin(this.fallAngle) * dt;
      this.fallAngle += this.fallVel * dt;
      if (this.fallAngle >= 1.5) {
        this.fallAngle = 1.5;
        this.vel.multiplyScalar(this.diving ? 0.55 : 0.45);
        this.state = 'down'; this.downTime = 0; this.fallVel = 0;
        this.engine._onPlayerGrounded(this);
      }
    } else if (this.state === 'down') {
      this.downTime += dt;
      if (!this.stayDown && this.downTime > this.riseDelay) { this.state = 'rising'; this.riseT = 0; }
    } else if (this.state === 'rising') {
      this.riseT += dt;
      this.fallAngle = 1.5 * (1 - Math.min(1, (this.riseT / this.riseDur) * 1.6));
      if (this.riseT >= this.riseDur) {
        this.state = 'up'; this.fallAngle = 0; this.lean.set(0, 0); this.leanVel.set(0, 0); this.diving = false;
      }
    }
  }

  _startFall(dirVec, angVel, angle) {
    this.state = 'falling';
    this.fallDir.copy(dirVec).normalize();
    this.fallAngle = angle; this.fallVel = angVel;
    this.riseDelay = 0.9 + Math.random() * 1.6;
    this.engine.emit('fall', { player: this });
  }

  /** Apply an instantaneous impulse at chest height (kg·yd/s, world XZ). */
  applyHit(ix, iz, mult = 1) {
    if (this.state !== 'up') return;
    const s = 0.0042 * mult / this.r.balance;
    this.leanVel.x += ix * s; this.leanVel.y += iz * s;
  }

  // =========================================================================
  // VISUAL
  // =========================================================================
  syncVisual() {
    const rig = this.rig;
    rig.root.position.set(this.pos.x, this.anim ? this.anim.lift : 0, this.pos.y);
    rig.yaw.rotation.y = this.facing;
    let ang, dx, dz;
    if (this.state === 'up') { ang = this.lean.length(); dx = this.lean.x; dz = this.lean.y; }
    else { ang = this.fallAngle; dx = this.fallDir.x; dz = this.fallDir.y; }
    if (ang > 1e-4) {
      const l = Math.hypot(dx, dz) || 1;
      _axis.set(dz / l, 0, -dx / l); // up × dir → tips +Y toward dir
      rig.tilt.quaternion.setFromAxisAngle(_axis, ang);
    } else rig.tilt.quaternion.identity();
  }

  /** World position of a hand (after animation). */
  handWorld(side = 'R', out = new THREE.Vector3()) {
    return this.rig.bones['hand' + side].getWorldPosition(out);
  }

  get isUp() { return this.state === 'up'; }

  dispose() {
    this.engine.scene.remove(this.rig.root);
    this.rig.disposed = true;
    disposeRig(this.rig);
  }
}
Player._nextId = 0;
