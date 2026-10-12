import * as THREE from 'three';

const _n = new THREE.Vector2();
const _r = new THREE.Vector2();

/**
 * Player-vs-player physics.
 *  • Bodies are discs with mass; steering forces are capped by strength, so
 *    blocking is a genuine push battle resolved by the contact solver.
 *  • Every approaching contact produces an impulse j = −(1+e)·vₙ / (1/mA+1/mB).
 *    That impulse kicks each player's balance pendulum — big hits topple,
 *    glancing ones stagger.
 *  • Tacklers who make contact with the ball carrier establish a *grip*:
 *    velocity coupling + balance load. Carriers can break grips based on
 *    strength/balance vs. tackling.
 *  • Upright players running through bodies on the ground can trip.
 */
export class Physics {
  constructor(engine) {
    this.engine = engine;
    this.restitution = 0.12;
    this.tripCooldown = new Map();
  }

  step(dt) {
    const P = this.engine.players;
    for (const p of P) p.think(dt);
    for (const p of P) p.applySteering(dt);
    for (const p of P) p.integrate(dt);
    for (let it = 0; it < 2; it++) {
      for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) this._pair(P[i], P[j], dt, it === 0);
    }
    this._grips(dt);
    for (const p of P) p.updateBalance(dt);
  }

  _lying(p) { return p.state === 'down' || p.state === 'rising' || (p.state === 'falling' && p.fallAngle > 1.15); }

  _pair(a, b, dt, doImpulse) {
    const aL = this._lying(a), bL = this._lying(b);
    if (aL && bL) return;
    _n.subVectors(b.pos, a.pos);
    let dist = _n.length();
    if (aL || bL) {
      if (!doImpulse) return;
      const runner = aL ? b : a, body = aL ? a : b;
      if (runner.state !== 'up') return;
      if (dist > runner.radius + 0.5) return;
      const sp = runner.vel.length();
      const key = runner.id * 1000 + body.id;
      const last = this.tripCooldown.get(key) || -10;
      if (sp > 3 && this.engine.time - last > 0.6) {
        this.tripCooldown.set(key, this.engine.time);
        // stepping on / over a body: pitch forward a bit
        const k = runner.mass * sp * (0.15 + Math.random() * 0.35);
        _r.copy(runner.vel).normalize();
        runner.applyHit(_r.x * k, _r.y * k, 0.8 / Math.max(0.6, runner.r.agility));
        runner.vel.multiplyScalar(0.85);
      }
      return;
    }
    const rr = a.radius + b.radius;
    if (dist >= rr) return;
    if (dist < 1e-5) { _n.set(1, 0); dist = 1e-5; } else _n.divideScalar(dist);
    const ia = 1 / a.mass, ib = 1 / b.mass;
    const pen = rr - dist;
    const corr = (pen * 0.85) / (ia + ib);
    a.pos.addScaledVector(_n, -corr * ia);
    b.pos.addScaledVector(_n, corr * ib);

    const t = this.engine.time;
    let ca = a.contacts.get(b); if (!ca) { ca = { t, start: t }; a.contacts.set(b, ca); } else if (t - ca.t > 0.2) ca.start = t; ca.t = t;
    let cb = b.contacts.get(a); if (!cb) { cb = { t, start: t }; b.contacts.set(a, cb); } else if (t - cb.t > 0.2) cb.start = t; cb.t = t;

    if (!doImpulse) return;
    const vn = (b.vel.x - a.vel.x) * _n.x + (b.vel.y - a.vel.y) * _n.y;
    if (vn >= 0) return;
    const j = (-(1 + this.restitution) * vn) / (ia + ib);
    a.vel.addScaledVector(_n, -j * ia);
    b.vel.addScaledVector(_n, j * ib);
    this._hit(a, b, _n.x, _n.y, j);
  }

  /** Role-aware response to an impulse j along n (a → b). */
  _hit(a, b, nx, ny, j) {
    const ma = this._mult(b, a), mb = this._mult(a, b);
    a.applyHit(-nx * j, -ny * j, ma);
    b.applyHit(nx * j, ny * j, mb);
    this._tryGrip(b, a, j); this._tryGrip(a, b, j);
    this._tryFumble(b, a, -nx, -ny, j * ma);
    this._tryFumble(a, b, nx, ny, j * mb);
    if (j > 380) this.engine.emit('hit', { a, b, impulse: j });
  }

  _isTackler(att, vic) {
    return vic.hasBall && att.team !== vic.team &&
      (att.diving || att.intent.type === 'pursue' || att.intent.type === 'rush' || att.intent.type === 'cover' || att.intent.type === 'zone' || att.intent.type === 'playBall');
  }

  _mult(att, vic) {
    if (this._isTackler(att, vic)) return (att.diving ? 1.35 : 1.0) * att.r.tackle * 1.15 * (0.85 + 0.3 * Math.random());
    if (att.intent.type === 'block' && att.intent.target === vic) return 0.42 * att.r.block * (att.intent.drive ? 1.2 : 1);
    if (vic.intent.type === 'block') return 0.35;
    if (vic.intent.type === 'rush' && att.intent.type === 'block') return 0.4;
    return 0.6;
  }

  _tryGrip(att, vic, j) {
    if (!this._isTackler(att, vic)) return;
    if (att.state !== 'up' && !att.diving) return;
    const g = (0.55 + 0.6 * att.r.tackle) * (0.7 + Math.random() * 0.6) * (att.diving ? 1.25 : 1);
    att.grips.set(vic, Math.max(att.grips.get(vic) || 0, g));
    this.engine.emit('contact', { tackler: att, carrier: vic, impulse: j });
  }

  _tryFumble(att, vic, dx, dy, power) {
    if (!vic.hasBall || att.team === vic.team || !this.engine.ball.live) return;
    if (power < 520) return;
    const chance = 0.16 * (1 - vic.r.security) * Math.min(2.5, 0.5 + (power - 520) / 300);
    if (Math.random() < chance) this.engine.ball.fumble(vic, new THREE.Vector2(dx, dy));
  }

  _grips(dt) {
    const P = this.engine.players;
    for (const p of P) {
      if (!p.grips.size) continue;
      for (const [c, g] of p.grips) {
        const dist = p.pos.distanceTo(c.pos);
        const reach = p.radius + c.radius + (p.state === 'up' ? 0.3 : 0.55);
        if (!c.hasBall || c.state !== 'up' || dist > reach || (p.state === 'down' && p.downTime > 0.6)) {
          p.grips.delete(c);
          continue;
        }
        // carrier tries to rip free (strength × balance vs. tackling × grip)
        const breakRate = Math.max(0, c.r.strength * c.r.balance * 1.25 - p.r.tackle * g * 0.75) * 1.6;
        if (Math.random() < breakRate * dt) {
          p.grips.delete(c);
          _r.subVectors(p.pos, c.pos).normalize();
          p.applyHit(_r.x * 260, _r.y * 260, 1);
          this.engine.emit('brokenTackle', { tackler: p, carrier: c });
          continue;
        }
        // velocity coupling: the pair moves together
        const k = Math.min(1, dt * 5 * g);
        const mt = p.mass + c.mass;
        _r.subVectors(c.vel, p.vel).multiplyScalar(k);
        if (p.state === 'up' || p.diving) p.vel.addScaledVector(_r, c.mass / mt);
        c.vel.addScaledVector(_r, -p.mass / mt);
        // a tackler hanging on from the ground drags the carrier down
        if (p.state !== 'up') {
          _r.subVectors(p.pos, c.pos).normalize();
          c.leanVel.addScaledVector(_r, dt * 2.2 * g);
        }
      }
    }
    // prune stale contacts
    const t = this.engine.time;
    for (const p of P) for (const [o, c] of p.contacts) if (t - c.t > 1) p.contacts.delete(o);
  }
}
