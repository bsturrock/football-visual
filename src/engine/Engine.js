import * as THREE from 'three';
import { FIELD, PHYS_DT } from './constants.js';
import { buildField } from './Field.js';
import { buildStadium } from './Stadium.js';
import { Player } from './Player.js';
import { Ball } from './Ball.js';
import { Physics } from './Physics.js';
import { HUD } from './HUD.js';

export const DEFAULT_TEAMS = {
  home: { name: 'Riverdale', primary: '#1f56d8', secondary: '#173f9e', hud: '#2a62e0', hudDark: '#1a49c4', endzone: '#1d4fc4', helmet: '#f2f3f6', facemask: '#f2f3f6', pants: '#f4f6f9', logoBase: '#4b6fae' },
  away: { name: 'Stonefield', primary: '#d42a2f', secondary: '#9e1b20', hud: '#c9262b', hudDark: '#a81c21', endzone: '#b8242a', helmet: '#f2f3f6', facemask: '#f2f3f6', pants: '#f4f6f9' },
};

const _v3 = new THREE.Vector3();
const _v3b = new THREE.Vector3();

/**
 * FootballEngine — visual + physical layer only. No rules, no play-calling.
 *
 *   const engine = new FootballEngine(document.body, { teams });
 *   const qb = engine.addPlayer({ team:'home', position:'QB', number:7, x:-5, z:0 });
 *   engine.on('down', e => ...);
 *
 * Events: snap, throw, catch, deflection, incomplete, handoff, fumble, recover,
 *         contact, hit, brokenTackle, fall, down, outOfBounds, goalLine, whistle
 */
export class FootballEngine {
  constructor(container, opts = {}) {
    this.container = container;
    this.teams = { home: { ...DEFAULT_TEAMS.home, ...(opts.teams?.home || {}) }, away: { ...DEFAULT_TEAMS.away, ...(opts.teams?.away || {}) } };
    this.time = 0;
    this.timeScale = 1;
    this.paused = false;
    this.players = [];
    this.listeners = {};
    this.autoDeadBall = opts.autoDeadBall ?? true; // engine marks ball dead on down / OOB / incomplete
    this.onUpdate = null;

    // --- renderer ------------------------------------------------------------
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserveDrawingBuffer }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.05;
    container.appendChild(r.domElement);
    r.domElement.style.display = 'block';

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color('#a9b3bf');
    scene.fog = new THREE.Fog('#a9b3bf', 160, 320);

    this.camera = new THREE.PerspectiveCamera(33, 16 / 9, 0.5, 600);

    // --- lights ----------------------------------------------------------------
    scene.add(new THREE.HemisphereLight('#f2f6ff', '#6d8a58', 1.7));
    const sun = (this.sun = new THREE.DirectionalLight('#fffaf0', 2.5));
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const sc = sun.shadow.camera;
    sc.left = -55; sc.right = 55; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 220;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
    scene.add(sun, sun.target);
    this.sunOffset = new THREE.Vector3(-45, 70, 22);

    // --- world -----------------------------------------------------------------
    scene.add(buildField(this));
    scene.add(buildStadium(this));
    this.ball = new Ball(this);
    this.physics = new Physics(this);
    this.hud = opts.hud === false ? null : new HUD(container, this.teams);
    this.cam = new CameraDirector(this);

    this._acc = 0;
    this._last = performance.now();
    this._lastGoalSide = new Map();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    if (opts.autoStart !== false) this.start();
  }

  // ---------------------------------------------------------------- players
  addPlayer(o) {
    const p = new Player(this, { ...o, teamData: this.teams[o.team] });
    this.players.push(p);
    return p;
  }
  removePlayer(p) { const i = this.players.indexOf(p); if (i >= 0) this.players.splice(i, 1); p.dispose(); }
  clearPlayers() { for (const p of [...this.players]) this.removePlayer(p); }
  teamPlayers(team) { return this.players.filter(p => p.team === team); }

  // ---------------------------------------------------------------- events
  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); return () => this.off(evt, fn); }
  off(evt, fn) { const l = this.listeners[evt]; if (l) this.listeners[evt] = l.filter(f => f !== fn); }
  emit(evt, data = {}) { for (const fn of this.listeners[evt] || []) fn(data); for (const fn of this.listeners['*'] || []) fn(evt, data); }

  /** Shotgun / pistol snap: a real short flight to the receiver. */
  snap(center, receiver) { this.ball.snap(center, receiver); this._lastGoalSide.clear(); }
  /** Under-center snap: hand straight to the QB. */
  snapUnderCenter(qb) { this.ball.give(qb); this._lastGoalSide.clear(); this.emit('snap', { receiver: qb }); }
  /** End the play (your sim decides why). */
  whistle(reason = 'whistle') {
    if (!this.ball.live) return;
    this.ball.live = false;
    this.emit('whistle', { reason });
  }

  // ---------------------------------------------------------------- loop
  start() {
    if (this._raf) return;
    const loop = () => { this._raf = requestAnimationFrame(loop); this.frame(); };
    this._last = performance.now();
    loop();
  }
  stop() { cancelAnimationFrame(this._raf); this._raf = null; }

  frame() {
    const now = performance.now();
    let dt = Math.min(0.1, (now - this._last) / 1000);
    this._last = now;
    this.update(dt);
    this.render();
  }

  update(realDt) {
    if (this.paused) realDt = 0;
    const dt = realDt * this.timeScale;
    this._acc += dt;
    let steps = 0;
    while (this._acc >= PHYS_DT && steps < 24) {
      this._fixedStep(PHYS_DT);
      this._acc -= PHYS_DT; steps++;
    }
    if (steps >= 24) this._acc = 0;
    if (this.onUpdate) this.onUpdate(dt);
    for (const p of this.players) { p.anim.update(dt); p.syncVisual(); }
    this.scene.updateMatrixWorld();
    this.ball.sync();
    this.cam.update(realDt);
    if (this._crowdTime) this._crowdTime.value += realDt;
    // shadow frustum follows the action
    const f = this.cam.focus;
    this.sun.target.position.set(f.x, 0, f.z * 0.3);
    this.sun.position.copy(this.sun.target.position).add(this.sunOffset);
  }

  render() { this.renderer.render(this.scene, this.camera); }

  resize() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _fixedStep(dt) {
    this.time += dt;
    this.physics.step(dt);
    this.ball.step(dt);
    this._resolveCatches();
    this._resolveLooseBall(dt);
    this._liveBallChecks();
  }

  // ---------------------------------------------------------------- ball/player interactions
  _resolveCatches() {
    const b = this.ball;
    if (b.state !== 'air') return;
    const cands = [];
    for (const p of this.players) {
      if (b.attempted.has(p) || p.catchCooldown > 0) continue;
      const canAct = p.state === 'up' || (p.state === 'falling' && p.fallAngle < 1.1);
      if (!canAct) continue;
      const dh = Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.y);
      const reach = (p.diving ? 1.15 : 0.78) * p.rig.scale;
      const top = p.diving ? 1.3 : 2.55 * p.rig.scale;
      if (dh < reach && b.pos.y > 0.2 && b.pos.y < top) cands.push([dh, p]);
    }
    if (!cands.length) return;
    cands.sort((x, y) => x[0] - y[0]);
    for (const [dh, p] of cands) {
      b.attempted.add(p);
      if (b.isSnap) {
        if (Math.random() < 0.985 || p === b.target) { b.attach(p); this.emit('catch', { player: p, snap: true }); return; }
        continue;
      }
      const offense = b.thrower ? p.team === b.thrower.team : true;
      const speed = b.vel.length();
      let contest = 0;
      for (const o of this.players) if (o.team !== p.team && o.state === 'up' && o.pos.distanceTo(p.pos) < 1.4) contest++;
      const fx = Math.sin(p.facing), fz = Math.cos(p.facing);
      const overShoulder = (b.vel.x * fx + b.vel.z * fz) / Math.max(speed, 1e-3) > 0.3 ? 0.08 : 0;
      const awkward = (b.pos.y > 2.2 || b.pos.y < 0.5 ? 0.12 : 0) + (dh / 0.78) * 0.15 + overShoulder + (p.diving ? 0.12 : 0);
      const speedPen = Math.min(0.25, Math.max(0, (speed - 18) / 30));
      const base = p.r.hands * (1 - awkward - speedPen);
      const pCatch = offense ? base * (1 - 0.3 * Math.min(contest, 2)) : base * 0.42;
      const pTip = offense ? 0.5 : 0.62;
      const roll = Math.random();
      if (roll < pCatch) {
        b.attach(p);
        this.emit('catch', { player: p, intercepted: !offense, contested: contest > 0 });
        return;
      } else if (roll < pCatch + (1 - pCatch) * pTip) {
        // ball deflects off hands / pads — stays live in the air
        const g = () => (Math.random() - 0.5) * 2;
        b.vel.set(b.vel.x * (0.1 + Math.random() * 0.3) + g() * 2.5, Math.abs(b.vel.y) * 0.25 + 1 + Math.random() * 3, b.vel.z * (0.1 + Math.random() * 0.3) + g() * 2.5);
        p.catchCooldown = 0.35;
        b.landing = b.computeLanding();
        this.emit('deflection', { player: p, offense });
        return;
      }
    }
  }

  _resolveLooseBall(dt) {
    const b = this.ball;
    if (b.state !== 'loose' || b.isPass) return;
    if (b.pos.y > 0.7) return;
    for (const p of this.players) {
      if (p.state !== 'up' && !(p.state === 'falling' && p.diving)) continue;
      const d = Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.y);
      if (d < 0.75 && Math.random() < dt * 9 * (0.4 + p.r.hands)) {
        b.attach(p);
        this.emit('recover', { player: p });
        return;
      }
    }
  }

  _onBallGround() {
    const b = this.ball;
    if (b.isPass && b.live) {
      this.emit('incomplete', { thrower: b.thrower, target: b.target });
      if (this.autoDeadBall) this.whistle('incomplete');
    }
    if (b.isSnap && b.live) this.emit('fumble', { player: b.thrower, snap: true });
    b.isSnap = false;
  }

  _onPlayerGrounded(p) { /* hook: knee-down is detected in _liveBallChecks */ }

  _liveBallChecks() {
    const b = this.ball;
    if (!b.live) return;
    const c = b.carrier;
    if (c) {
      if ((c.state === 'falling' && c.fallAngle > 0.95) || c.state === 'down') {
        const tacklers = this.players.filter(o => o.team !== c.team && (o.grips.has(c) || (c.contacts.get(o) && this.time - c.contacts.get(o).t < 0.5)));
        this.emit('down', { carrier: c, spot: c.pos.clone(), tacklers });
        if (this.autoDeadBall) this.whistle('down');
        return;
      }
      if (Math.abs(c.pos.y) > FIELD.HALF_WID || Math.abs(c.pos.x) > FIELD.HALF_LEN) {
        this.emit('outOfBounds', { carrier: c, spot: c.pos.clone() });
        if (this.autoDeadBall) this.whistle('outOfBounds');
        return;
      }
      for (const side of [-1, 1]) {
        const now = Math.sign(c.pos.x - side * FIELD.GOAL);
        const key = c.id * 10 + side;
        const prev = this._lastGoalSide.get(key);
        if (prev != null && prev !== now) this.emit('goalLine', { carrier: c, side, entering: now === side });
        this._lastGoalSide.set(key, now);
      }
    } else if (b.state === 'loose') {
      if (Math.abs(b.pos.z) > FIELD.HALF_WID || Math.abs(b.pos.x) > FIELD.HALF_LEN) {
        this.emit('outOfBounds', { carrier: null, spot: new THREE.Vector2(b.pos.x, b.pos.z) });
        if (this.autoDeadBall) this.whistle('outOfBounds');
      }
    }
  }
}

/**
 * Camera director. Modes:
 *   'broadcast' – elevated sideline (reference image framing)
 *   'high'      – higher all-22 style
 *   'endzone'   – behind the offense
 *   'field'     – low on-field follow cam
 */
export class CameraDirector {
  constructor(engine) {
    this.e = engine;
    this.mode = 'broadcast';
    this.focus = new THREE.Vector3(0, 0, 0);
    this.target = new THREE.Vector3();
    this.pos = new THREE.Vector3(0, 14, 39);
    this.look = new THREE.Vector3(0, 0, -7.5);
    this.offenseDir = 1;
    this.shake = 0;
    engine.on('hit', ({ impulse }) => { this.shake = Math.min(0.35, this.shake + impulse / 4000); });
  }

  setMode(m) { this.mode = m; }

  update(dt) {
    if (this.mode === 'manual') return;
    const b = this.e.ball;
    const fx = THREE.MathUtils.clamp(b.pos.x, -48, 48);
    this.target.set(fx, 0, THREE.MathUtils.clamp(b.pos.z, -12, 12));
    const k = 1 - Math.exp(-dt * (b.state === 'air' ? 2.2 : 1.6));
    this.focus.lerp(this.target, k);
    const f = this.focus;
    const d = this.offenseDir;
    switch (this.mode) {
      case 'high': _v3.set(f.x, 42, 62); _v3b.set(f.x, 0, -2); break;
      case 'endzone': _v3.set(f.x - d * 24, 13, f.z * 0.4); _v3b.set(f.x + d * 14, 0, f.z * 0.6); break;
      case 'field': _v3.set(f.x - d * 9, 3.2, f.z + 9); _v3b.set(f.x + d * 4, 1.2, f.z); break;
      case 'broadcast':
      default: _v3.set(f.x, 14, 39 + f.z * 0.15); _v3b.set(f.x, 0, -7.5 + f.z * 0.25); break;
    }
    const kp = 1 - Math.exp(-dt * 3);
    this.pos.lerp(_v3, kp);
    this.look.lerp(_v3b, kp);
    const cam = this.e.camera;
    cam.position.copy(this.pos);
    if (this.shake > 0.001) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-dt * 6);
    }
    cam.lookAt(this.look);
  }
}
