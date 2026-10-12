import * as THREE from 'three';
import { FIELD } from '../engine/constants.js';

// ===========================================================================
// DEMO SIM — a deliberately small CPU-vs-CPU play driver that exercises the
// engine API. Replace it with your coach/sim layer: everything here goes
// through the public engine/Player commands and engine events.
// ===========================================================================

const OFFENSE = [
  // role, position, dx (behind LOS = negative), z, stance
  ['C', 'OL', -0.55, 0, 'center'], ['LG', 'OL', -0.75, -1.35, '3pt'], ['RG', 'OL', -0.75, 1.35, '3pt'],
  ['LT', 'OL', -0.95, -2.7, '3pt'], ['RT', 'OL', -0.95, 2.7, '3pt'], ['TE', 'TE', -1.0, 4.1, '3pt'],
  ['QB', 'QB', -5.0, 0, 'qb'], ['RB', 'RB', -5.2, -1.5, '2pt'],
  ['X', 'WR', -0.8, -19, 'wr'], ['Z', 'WR', -1.2, 17, 'wr'], ['SL', 'WR', -1.4, -11, 'wr'],
];
const DEFENSE = [
  ['DE1', 'DL', 0.95, -3.5, '3pt'], ['DT1', 'DL', 0.95, -1.05, '3pt'], ['DT2', 'DL', 0.95, 1.1, '3pt'], ['DE2', 'DL', 0.95, 3.7, '3pt'],
  ['WLB', 'LB', 4.6, -4.2, 'lb'], ['MLB', 'LB', 4.3, 0.2, 'lb'], ['SLB', 'LB', 4.6, 4.4, 'lb'],
  ['CB1', 'CB', 6.5, -19, '2pt'], ['CB2', 'CB', 6.5, 17, '2pt'],
  ['FS', 'S', 12.5, -7, '2pt'], ['SS', 'S', 10.5, 8, '2pt'],
];
const NUMBERS = { C: 62, LG: 66, RG: 71, LT: 74, RT: 77, TE: 88, QB: 7, RB: 28, X: 11, Z: 84, SL: 17,
  DE1: 91, DT1: 97, DT2: 93, DE2: 99, WLB: 52, MLB: 54, SLB: 56, CB1: 24, CB2: 21, FS: 31, SS: 33 };

const ROUTES = {
  go: [[0, 0], [30, 0]], slant: [[2.5, 0], [11, -7]], out: [[6, 0], [6.5, 7]], curl: [[10, 0], [8.5, -1.5]],
  post: [[10, 0], [28, -9]], corner: [[10, 0], [22, 9]], drag: [[1.5, 0], [4, -16]], dig: [[11, 0], [12, -12]],
  flat: [[1.5, 2.5], [3, 11]], seam: [[22, 0]], hitch: [[6, 0], [5, 0]],
};

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[(Math.random() * a.length) | 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class DemoSim {
  constructor(engine) {
    this.e = engine;
    this.units = { home: { off: {}, def: {} }, away: { off: {}, def: {} } };
    for (const team of ['home', 'away']) {
      for (const [role, pos] of OFFENSE) this.units[team].off[role] = this._spawn(team, pos, role);
      for (const [role, pos] of DEFENSE) this.units[team].def[role] = this._spawn(team, pos, role);
    }
    this.g = { poss: 'home', los: -12, ballZ: 0, down: 1, toGo: 10, quarter: 2, clock: 4 * 60 + 27, score: { home: 14, away: 7 } };
    this.phase = 'setup';
    this.phaseT = 0;
    this.playT = 0;
    this._wire();
    this._activate();
    this._formation(true);
    engine.onUpdate = dt => this.tick(dt);
    this._hud();
  }

  _spawn(team, position, role) {
    const p = this.e.addPlayer({ team, position, number: NUMBERS[role] });
    p.userData.role = role;
    p.rig.root.visible = false;
    return p;
  }

  get dir() { return this.g.poss === 'home' ? 1 : -1; }
  get off() { return this.units[this.g.poss].off; }
  get def() { return this.units[this.g.poss === 'home' ? 'away' : 'home'].def; }

  _activate() {
    const active = [...Object.values(this.off), ...Object.values(this.def)];
    for (const team of ['home', 'away']) for (const u of ['off', 'def']) for (const p of Object.values(this.units[team][u])) p.rig.root.visible = false;
    this.e.players.length = 0;
    for (const p of active) { p.rig.root.visible = true; this.e.players.push(p); }
    this.e.cam.offenseDir = this.dir;
  }

  // ------------------------------------------------------------------ setup
  _spots() {
    const d = this.dir, los = this.g.los, bz = this.g.ballZ;
    const out = [];
    for (const [role, , dx, z, st] of OFFENSE) {
      const wide = Math.abs(z) > 8;
      const zz = wide ? clamp(z + bz * 0.3, -FIELD.HALF_WID + 3, FIELD.HALF_WID - 3) : bz + z;
      out.push([this.off[role], los + d * dx, zz, st, d]);
    }
    for (const [role, , dx, z, st] of DEFENSE) {
      let zz = Math.abs(z) > 8 ? clamp(z + bz * 0.3, -FIELD.HALF_WID + 3, FIELD.HALF_WID - 3) : bz + z;
      out.push([this.def[role], los + d * dx, zz, st, -d]);
    }
    return out;
  }

  _formation(instant) {
    this.e.ball.placeAt(this.g.los, this.g.ballZ);
    for (const [p, x, z, st, d] of this._spots()) {
      const face = Math.atan2(d, 0);
      p.stayDown = false;
      p.userData.spot = [x, z, st, face];
      if (instant) { p.teleport(x, z, face); p.stance(st, face); }
      else p.moveTo(x, z, { speed: 0.55, face, arrive: 2 });
    }
  }

  // ------------------------------------------------------------------ events
  _wire() {
    const e = this.e;
    e.on('catch', ({ player, snap, intercepted }) => {
      if (snap) return;
      if (intercepted) this.e.hud?.toast('Intercepted!');
      this._ballChangedHands(player);
    });
    e.on('handoff', ({ to }) => this._ballChangedHands(to));
    e.on('recover', ({ player }) => { this.e.hud?.toast('Fumble recovered'); this._ballChangedHands(player); });
    e.on('fumble', ({ snap }) => {
      this.e.hud?.toast(snap ? 'Bad snap!' : 'Fumble!');
      for (const p of e.players) if (p.state === 'up' && p.pos.distanceTo(new THREE.Vector2(e.ball.pos.x, e.ball.pos.z)) < 12) p.recover();
    });
    e.on('goalLine', ({ carrier, side, entering }) => {
      if (!entering || !e.ball.live) return;
      const attackDir = carrier.team === 'home' ? 1 : -1;
      if (side === attackDir) { this.result = { type: 'td', team: carrier.team }; e.whistle('touchdown'); }
    });
    e.on('whistle', ({ reason }) => this._deadBall(reason));
    e.on('brokenTackle', () => this.e.hud?.toast('Broken tackle!', 1200));
  }

  _ballChangedHands(p) {
    const d = this.dir;
    const offTeam = this.g.poss;
    const carrierDir = p.team === 'home' ? 1 : -1;
    p.carry({ dir: carrierDir, lane: p.userData.lane ?? null, losX: this.g.los });
    if (p.userData.role === 'QB' && p.team === offTeam && !this.handedOff && this.call.type === 'pass') { p.upper = 'qbHold'; }
    for (const o of this.e.players) {
      if (o === p) continue;
      if (o.team !== p.team) {
        if (o.userData.role.startsWith('D') && o.intent.type === 'rush') o.rush(p); else o.pursue(p);
      } else if (o.intent.type !== 'block' || !o.intent.drive) {
        o.block({ protect: p, zone: [p.pos.x + carrierDir * 4, p.pos.y], radius: 9 });
      }
    }
    if (p.userData.role === 'QB' && p.team === offTeam && this.call.type === 'pass' && !this.handedOff) {
      // QB keeps it: restore pass logic (he only carries if he scrambles)
      p.moveTo(this.g.los - d * 7.5, this.g.ballZ, { speed: 0.7, face: Math.atan2(d, 0) });
      this._passDefense(); this._passOffense();
    }
  }

  // ------------------------------------------------------------------ play call
  _callPlay() {
    const g = this.g, d = this.dir;
    const yardsToGoal = 50 - g.los * d;
    if (g.down === 4) {
      if (yardsToGoal <= 33) { this._special('fg', yardsToGoal); return false; }
      if (g.toGo > 2 || yardsToGoal > 55) { this._special('punt', yardsToGoal); return false; }
    }
    const r = Math.random();
    const passBias = g.toGo > 7 ? 0.68 : 0.45;
    if (r < passBias) this.call = { type: 'pass', deep: Math.random() < 0.35 };
    else this.call = { type: 'run', outside: Math.random() < 0.4, side: Math.random() < 0.5 ? -1 : 1 };
    this.defCall = { man: Math.random() < 0.55, blitz: Math.random() < 0.2 };
    return true;
  }

  _snap() {
    const off = this.off, d = this.dir, los = this.g.los;
    this.playT = 0; this.handedOff = false; this.thrown = false; this.result = null;
    this.e.snap(off.C, off.QB);
    const wrs = ['X', 'Z', 'SL'];

    if (this.call.type === 'run') {
      const lane = this.g.ballZ + (this.call.outside ? this.call.side * 6.5 : this.call.side * 1.6);
      off.RB.userData.lane = lane;
      for (const r of ['C', 'LG', 'RG', 'LT', 'RT', 'TE']) off[r].block({ drive: [d, this.call.outside ? this.call.side * 0.45 : 0], zone: [off[r].pos.x + d * 2, off[r].pos.y], radius: 4 });
      for (const r of wrs) off[r].block({ zone: [off[r].pos.x + d * 6, off[r].pos.y], radius: 8 });
      // RB takes the mesh path toward the lane
      off.RB.moveTo(los - d * 3.6, (off.RB.pos.y + lane) / 2, { speed: 0.75 });
    } else {
      this._passOffense(true);
    }
    // defense
    const def = this.def;
    for (const r of ['DE1', 'DT1', 'DT2', 'DE2']) def[r].rush(off.QB);
    this._passDefense(true);
  }

  _passOffense(initial) {
    const off = this.off, d = this.dir, los = this.g.los;
    if (!initial) return;
    const deep = this.call.deep;
    const routeSets = deep ? [['go', 'post', 'dig'], ['corner', 'go', 'seam'], ['post', 'dig', 'go']] : [['slant', 'out', 'drag'], ['curl', 'hitch', 'slant'], ['out', 'curl', 'dig']];
    const set = pick(routeSets);
    ['X', 'Z', 'SL'].forEach((r, i) => this._route(off[r], set[i]));
    this._route(off.TE, deep ? 'seam' : pick(['flat', 'curl', 'drag']));
    if (Math.random() < 0.5) this._route(off.RB, 'flat'); else off.RB.block({ protect: off.QB, zone: [los - d * 4, this.g.ballZ], radius: 5 });
    for (const r of ['C', 'LG', 'RG', 'LT', 'RT']) off[r].block({ protect: off.QB, zone: [off[r].pos.x - d * 1.5, off[r].pos.y], radius: 3.5 });
    this.readT = rnd(1.7, deep ? 3.0 : 2.3);
  }

  _route(p, name) {
    const d = this.dir, s = Math.sign(p.pos.y) || 1;
    const pts = ROUTES[name].map(([fx, lz]) => [p.pos.x + d * fx, clamp(p.pos.y + lz * s, -FIELD.HALF_WID + 1, FIELD.HALF_WID - 1)]);
    p.runRoute(pts, { settle: name === 'curl' || name === 'hitch' });
  }

  _passDefense(initial) {
    if (!initial) return;
    const def = this.def, off = this.off, d = this.dir, los = this.g.los;
    if (this.defCall.man) {
      def.CB1.cover(off.X, { dir: d, cushion: 3 });
      def.CB2.cover(off.Z, { dir: d, cushion: 3 });
      def.SS.cover(off.SL, { dir: d, cushion: 4 });
      def.SLB.cover(off.TE, { dir: d, cushion: 1.5 });
      def.FS.zone(los + d * 18, this.g.ballZ * 0.5, { dir: d, radius: 14 });
      def.WLB.cover(off.RB, { dir: d, cushion: 1.5 });
    } else {
      def.CB1.zone(los + d * 14, -17, { dir: d });
      def.CB2.zone(los + d * 14, 17, { dir: d });
      def.FS.zone(los + d * 20, -6, { dir: d, radius: 12 });
      def.SS.zone(los + d * 20, 6, { dir: d, radius: 12 });
      def.WLB.zone(los + d * 7, -9, { dir: d });
      def.SLB.zone(los + d * 7, 9, { dir: d });
    }
    if (this.defCall.blitz) def.MLB.rush(off.QB); else def.MLB.zone(los + d * 6, this.g.ballZ, { dir: d });
  }

  _special(kind, ytg) {
    const g = this.g;
    if (kind === 'fg') {
      const dist = ytg + 17;
      const good = Math.random() < clamp(1.25 - dist / 60, 0.25, 0.97);
      this.e.hud?.toast(good ? `${dist} yd field goal is GOOD` : `${dist} yd field goal NO GOOD`);
      if (good) { g.score[g.poss] += 3; this._turnover(-25 * (g.poss === 'home' ? -1 : 1)); }
      else this._turnover(g.los);
    } else {
      const d = this.dir;
      let spot = g.los + d * rnd(36, 48);
      if (spot * d > 50) spot = d * 30; // touchback
      this.e.hud?.toast('Punt');
      this._turnover(spot);
    }
    this.phase = 'dead'; this.phaseT = 0.6;
  }

  _turnover(spotX) {
    const g = this.g;
    g.poss = g.poss === 'home' ? 'away' : 'home';
    g.los = clamp(spotX, -49, 49); g.down = 1; g.toGo = 10;
    this.pendingActivate = true;
  }

  // ------------------------------------------------------------------ dead ball / rules
  _deadBall(reason) {
    const g = this.g, e = this.e, d = this.dir;
    for (const p of e.players) if (p.state === 'up' || p.state === 'falling') p.idle();
    const c = e.ball.carrier;
    let msg = '';
    if (reason === 'touchdown' && this.result) {
      g.score[this.result.team] += 7;
      msg = 'TOUCHDOWN!';
      if (c) c.celebrate(3);
      for (const p of e.players) if (p.team === this.result.team && p.state === 'up' && Math.random() < 0.5) p.celebrate(2.5);
      g.poss = this.result.team; // the scoring team kicks off
      this._turnover(this.result.team === 'home' ? 25 : -25);
    } else if (reason === 'incomplete') {
      msg = 'Incomplete';
      this._advanceDown(0);
    } else if (c) {
      const spotX = c.pos.x, spotZ = c.pos.y;
      const cTeam = c.team;
      if (cTeam === g.poss) {
        if (spotX * d < -FIELD.GOAL) { // safety
          g.score[g.poss === 'home' ? 'away' : 'home'] += 2; msg = 'SAFETY'; this._turnover(d * -30);
        } else {
          const gain = (spotX - g.los) * d;
          msg = gain >= 0.5 ? `Gain of ${Math.round(gain)}` : gain <= -0.5 ? `Loss of ${Math.round(-gain)}` : 'No gain';
          if (reason === 'outOfBounds') msg += ' · out of bounds';
          g.los = clamp(spotX, -49.5, 49.5);
          g.ballZ = clamp(spotZ, -FIELD.HASH, FIELD.HASH);
          this._advanceDown(gain);
        }
      } else {
        msg = 'Turnover';
        g.ballZ = clamp(spotZ, -FIELD.HASH, FIELD.HASH);
        this._turnover(spotX);
      }
    } else {
      msg = 'Dead ball';
      this._advanceDown(0);
    }
    this.e.hud?.toast(msg);
    this.lastReason = reason;
    this.phase = 'dead'; this.phaseT = 0;
    this._hud();
  }

  _advanceDown(gain) {
    const g = this.g;
    if (gain >= g.toGo) { g.down = 1; g.toGo = Math.min(10, 50 - g.los * this.dir); this.e.hud && setTimeout(() => this.e.hud.toast('First down'), 900); }
    else {
      g.down++; g.toGo -= gain;
      if (g.down > 4) { this.e.hud && setTimeout(() => this.e.hud.toast('Turnover on downs'), 900); this._turnover(g.los); }
    }
  }

  // ------------------------------------------------------------------ per-frame
  tick(dt) {
    const e = this.e;
    this.phaseT += dt;
    if (this.phase === 'live') {
      this.playT += dt;
      this.g.clock -= dt;
      this._liveLogic(dt);
    } else if (this.phase === 'dead') {
      if (this.phaseT > 2.8) {
        this.g.clock -= this.lastReason === 'incomplete' || this.lastReason === 'outOfBounds' ? 6 : 24;
        if (this.g.clock <= 0) { this.g.quarter++; this.g.clock = 15 * 60; if (this.g.quarter > 4) { this.g.quarter = 1; this.g.score = { home: 0, away: 0 }; } }
        if (this.pendingActivate) { this.pendingActivate = false; this._activate(); this._formation(true); }
        else this._formation(false);
        this.phase = 'setup'; this.phaseT = 0;
        this._hud();
      }
    } else if (this.phase === 'setup') {
      // walk to spots, settle into stance when there
      let all = true;
      for (const p of e.players) {
        const [x, z, st, face] = p.userData.spot;
        if (p.state !== 'up') { all = false; continue; }
        const dd = Math.hypot(p.pos.x - x, p.pos.y - z);
        if (dd < 0.35 && p.intent.type !== 'stance') p.stance(st, face);
        if (dd > 0.35) { all = false; if (p.intent.type !== 'moveTo') p.moveTo(x, z, { speed: 0.55, face, arrive: 2 }); }
      }
      if (this.phaseT > 6) { for (const p of e.players) { const [x, z, st, face] = p.userData.spot; p.teleport(x, z, face); p.stance(st, face); } all = true; }
      if (all && this.phaseT > 1) { this.phase = 'presnap'; this.phaseT = 0; }
    } else if (this.phase === 'presnap') {
      if (this.phaseT > 1.3) {
        if (this._callPlay()) { this._snap(); this.phase = 'live'; this.phaseT = 0; }
        this._hud();
      }
    }
  }

  _liveLogic(dt) {
    const e = this.e, off = this.off, qb = off.QB, d = this.dir;
    if (!e.ball.live) return;
    if (this.call.type === 'run' && !this.handedOff && qb.hasBall && this.playT > 0.35) {
      this.handedOff = true;
      qb.handoffTo(off.RB);
      off.RB.moveTo(qb.pos.x + d * 0.3, qb.pos.y + Math.sign(off.RB.userData.lane - qb.pos.y || 1) * 0.5, { speed: 0.8, arrive: 0.5 });
    }
    if (this.call.type === 'run' && qb.hasBall && this.playT > 2.2) { qb.carry({ dir: d }); this._ballChangedHands(qb); this.call.type = 'scramble'; }

    if (this.call.type === 'pass' && qb.hasBall && !this.thrown && qb.state === 'up') {
      qb.upper = 'qbHold';
      if (qb.intent.type !== 'moveTo' || this.playT < 0.6) qb.moveTo(this.g.los - d * 7.5, this.g.ballZ, { speed: 0.75, face: Math.atan2(d, 0) });
      let pressure = 0;
      for (const o of e.players) if (o.team !== qb.team && o.state === 'up') pressure = Math.max(pressure, 1 - o.pos.distanceTo(qb.pos) / 3);
      if (this.playT > this.readT || (pressure > 0.35 && this.playT > 1.0)) {
        const t = this._pickReceiver();
        if (t && (t.open > 1.6 || this.playT > this.readT + 1.2 || pressure > 0.5)) {
          qb.throwTo(t.p, { error: pressure * 0.06, loft: this.call.deep ? 0.3 : 0.1 });
          this.thrown = true;
        } else if (this.playT > this.readT + 2.2) {
          this.call.type = 'scramble'; this._ballChangedHands(qb);
        }
      }
    }
  }

  _pickReceiver() {
    const e = this.e, off = this.off, d = this.dir;
    let best = null;
    for (const r of ['X', 'Z', 'SL', 'TE', 'RB']) {
      const p = off[r];
      if (p.intent.type !== 'route' || p.state !== 'up') continue;
      const fut = p.pos.clone().addScaledVector(p.vel, 0.8);
      let open = 99;
      for (const o of e.players) if (o.team !== p.team && o.state === 'up') open = Math.min(open, o.pos.distanceTo(fut));
      const depth = (fut.x - this.g.los) * d;
      const score = Math.min(open, 6) + (this.call.deep ? depth * 0.08 : -Math.abs(depth - 8) * 0.06) - (depth < 0 ? 1 : 0);
      if (!best || score > best.score) best = { p, open, score };
    }
    return best;
  }

  _hud() {
    const g = this.g;
    this.e.hud?.set({
      home: { score: g.score.home, timeouts: 2 }, away: { score: g.score.away, timeouts: 2 },
      quarter: g.quarter, clock: g.clock, down: g.down, distance: g.toGo,
      goalToGo: 50 - g.los * this.dir <= g.toGo, possession: g.poss,
    });
    // clock only re-renders every frame while live
    if (!this._clockTimer) this._clockTimer = setInterval(() => this.e.hud?.set({ clock: this.g.clock }), 250);
  }
}
