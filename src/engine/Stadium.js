import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { prep, PLAYER_MATERIAL, createPlayerRig, bakeRig } from './PlayerModel.js';
import { Retargeter, kitColors } from './ModelLibrary.js';
import { FIELD, SKIN_TONES } from './constants.js';

// ---------------------------------------------------------------------------
// Stadium bowl: two-tier stands on all four sides, vomitories, aisles,
// ~20k instanced fans (GPU-animated), plus both team benches on the far
// sideline with baked low-poly players, coolers and benches.
// ---------------------------------------------------------------------------

const CONCRETE = '#8d949f', TREAD = '#a2a8b2', WALL = '#3d4553', DARK = '#1c2129', FASCIA = '#b9bec6';

function rand(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

/**
 * Build one side of stands in a local frame: x = along the stand,
 * z = outward (away from field), y = up. Returns { geos, seats }.
 */
function buildStandLocal(len, z0, opts) {
  const geos = [];
  const seats = [];
  const add = (w, h, d, x, y, z, color) => {
    const g = prep(new THREE.BoxGeometry(w, h, d), color);
    g.translate(x, y, z); geos.push(g);
  };
  const half = len / 2;
  // front wall
  add(len + 2, 1.8, 0.4, 0, 0.9, z0, WALL);
  add(len + 2, 0.15, 0.6, 0, 1.85, z0, FASCIA);

  const tiers = [
    { y0: 1.8, z: z0 + 0.6, rows: 20, depth: 0.9, rise: 0.45, vom: true },
    { y0: 13.6, z: z0 + 20.6, rows: 26, depth: 0.95, rise: 0.58, vom: false },
  ];
  const aisleEvery = opts.aisleEvery || 13;
  const vomEvery = opts.vomEvery || 30;
  const isAisle = x => {
    const m = ((x + half) % aisleEvery + aisleEvery) % aisleEvery;
    return m < 1.3;
  };
  const isVom = (x, row) => {
    if (row < 8 || row > 13) return false;
    const m = ((x + half + vomEvery / 2) % vomEvery + vomEvery) % vomEvery;
    return m > vomEvery / 2 - 2.3 && m < vomEvery / 2 + 2.3;
  };

  for (const [ti, t] of tiers.entries()) {
    for (let r = 0; r < t.rows; r++) {
      const y = t.y0 + r * t.rise;
      const z = t.z + r * t.depth;
      // riser + tread as one block down to the tier base
      add(len, t.rise, t.depth, 0, y + t.rise / 2, z + t.depth / 2, r % 2 ? CONCRETE : '#878e99');
      add(len, 0.04, t.depth * 0.35, 0, y + t.rise + 0.02, z + t.depth * 0.2, TREAD);
      for (let x = -half + 0.4; x < half - 0.3; x += 0.66) {
        if (isAisle(x)) continue;
        if (t.vom && isVom(x, r)) continue;
        if (Math.random() < 0.035) continue; // empty seats
        seats.push(x + rand(-0.06, 0.06), y + t.rise, z + t.depth * 0.55);
      }
    }
    // tier underside fill (so there are no holes from below/side)
    const topY = t.y0 + t.rows * t.rise, endZ = t.z + t.rows * t.depth;
    add(len, topY - t.y0, 0.3, 0, (t.y0 + topY) / 2, endZ + 0.15, CONCRETE);
    // aisles (light stair strips)
    for (let x = -half; x < half; x += aisleEvery) {
      for (let r = 0; r < t.rows; r++) {
        add(1.1, 0.06, t.depth, x + 0.65, t.y0 + (r + 1) * t.rise + 0.02, t.z + r * t.depth + t.depth / 2, '#c3c8cf');
      }
    }
    // vomitories (tunnel mouths) in the lower tier
    if (t.vom) {
      for (let x = -half + vomEvery / 2; x < half; x += vomEvery) {
        const yb = t.y0 + 8 * t.rise, zb = t.z + 8 * t.depth;
        add(4.4, 2.6, 4.6, x, yb + 1.3, zb + 2.3, DARK);
        add(0.3, 2.9, 4.8, x - 2.35, yb + 1.45, zb + 2.3, FASCIA);
        add(0.3, 2.9, 4.8, x + 2.35, yb + 1.45, zb + 2.3, FASCIA);
        add(5.0, 0.35, 0.4, x, yb + 2.75, zb + 0.1, FASCIA);
      }
    }
  }
  // concourse band between tiers: fascia + dark recess with light columns
  const cy = 1.8 + 20 * 0.45, cz = z0 + 0.6 + 20 * 0.9;
  add(len, 1.2, 0.5, 0, cy + 0.6, cz + 0.25, FASCIA);
  add(len, 3.0, 1.5, 0, cy + 2.6, cz + 1.5, DARK);
  for (let x = -half + 4; x < half; x += 10) add(0.8, 3.0, 0.8, x, cy + 2.6, cz + 0.9, '#9aa1ab');
  add(len, 0.6, 2.4, 0, cy + 4.3, cz + 1.2, FASCIA);
  // top / back wall + roof lip
  const topY = 13.6 + 26 * 0.58, backZ = z0 + 20.6 + 26 * 0.95;
  add(len, 4, 0.6, 0, topY + 2, backZ + 0.3, '#6f7782');
  add(len, 0.6, 6, 0, topY + 4.2, backZ - 2, '#5b636e');
  return { geos, seats };
}

function makeFanMaterial(timeUniform) {
  const m = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = timeUniform;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vec4 ip = instanceMatrix[3];
       float seed = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
       float excite = step(0.82, seed);
       float bob = sin(uTime * (3.0 + seed * 4.0) + seed * 40.0);
       transformed.y += (0.03 + excite * 0.12) * max(bob, 0.0);
       transformed.x += sin(uTime * 1.3 + seed * 20.0) * 0.02;`,
    );
  };
  return m;
}

export function buildStadium(engine) {
  const group = new THREE.Group();
  group.name = 'stadium';
  const standGeos = [];
  const seatWorld = [];
  const m4 = new THREE.Matrix4();
  const v = new THREE.Vector3();

  const sides = [
    { len: 150, z0: 40, place: (o) => { o.rotation.y = Math.PI; } },         // far (behind benches)
    { len: 150, z0: 40, place: (o) => { o.rotation.y = 0; } },               // near (behind camera)
    { len: 80, z0: 70, place: (o) => { o.rotation.y = Math.PI / 2; } },      // right end
    { len: 80, z0: 70, place: (o) => { o.rotation.y = -Math.PI / 2; } },     // left end
  ];
  for (const s of sides) {
    const { geos, seats } = buildStandLocal(s.len, s.z0, {});
    const o = new THREE.Object3D();
    s.place(o);
    o.updateMatrix();
    for (const g of geos) { g.applyMatrix4(o.matrix); standGeos.push(g); }
    for (let i = 0; i < seats.length; i += 3) {
      v.set(seats[i], seats[i + 1], seats[i + 2]).applyMatrix4(o.matrix);
      seatWorld.push(v.x, v.y, v.z, o.rotation.y);
    }
  }
  const stands = new THREE.Mesh(mergeGeometries(standGeos), PLAYER_MATERIAL);
  stands.receiveShadow = true;
  group.add(stands);
  standGeos.forEach(g => g.dispose());

  // --- crowd -----------------------------------------------------------------
  const timeU = { value: 0 };
  engine._crowdTime = timeU;
  const bodyGeo = mergeGeometries([
    new THREE.BoxGeometry(0.44, 0.52, 0.3).translate(0, 0.42, 0),
    new THREE.BoxGeometry(0.5, 0.12, 0.34).translate(0, 0.64, 0), // shoulders
  ].map(g => g.toNonIndexed()));
  const headGeo = new THREE.BoxGeometry(0.24, 0.26, 0.24).translate(0, 0.86, 0.02).toNonIndexed();
  const count = seatWorld.length / 4;
  const bodies = new THREE.InstancedMesh(bodyGeo, makeFanMaterial(timeU), count);
  const heads = new THREE.InstancedMesh(headGeo, makeFanMaterial(timeU), count);
  const home = engine.teams.home, away = engine.teams.away;
  const palette = [
    [home.primary, 0.22], [home.secondary || '#2048b8', 0.12], [away.primary, 0.22], [away.secondary || '#a81d24', 0.12],
    ['#eef0f4', 0.17], ['#c9ced6', 0.05], ['#3a3f4a', 0.06], ['#5d6573', 0.04],
  ];
  const cdf = []; let acc = 0; for (const [c, w] of palette) { acc += w; cdf.push([acc, new THREE.Color(c)]); }
  const pickColor = () => { const r = Math.random() * acc; return cdf.find(e => r <= e[0])[1]; };
  const skinCols = SKIN_TONES.map(c => new THREE.Color(c));
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    const x = seatWorld[i * 4], y = seatWorld[i * 4 + 1], z = seatWorld[i * 4 + 2], ry = seatWorld[i * 4 + 3];
    const standing = Math.random() < 0.3;
    q.setFromAxisAngle(up, ry + Math.PI + rand(-0.25, 0.25));
    const sc = rand(0.92, 1.08);
    s.set(sc, standing ? sc * 1.45 : sc, sc);
    m4.compose(v.set(x, y, z), q, s);
    bodies.setMatrixAt(i, m4);
    heads.setMatrixAt(i, m4);
    bodies.setColorAt(i, pickColor());
    heads.setColorAt(i, pick(skinCols));
  }
  bodies.frustumCulled = heads.frustumCulled = false;
  group.add(bodies, heads);

  // --- sideline: benches, coolers, baked players ------------------------------
  group.add(buildSideline(engine));
  return group;
}

function buildSideline(engine) {
  const g = new THREE.Group();
  const geos = [];
  const add = (w, h, d, x, y, z, color, ry = 0) => {
    const b = prep(new THREE.BoxGeometry(w, h, d), color);
    b.rotateY(ry); b.translate(x, y, z); geos.push(b);
  };
  const zB = -(FIELD.HALF_WID + 6);
  const sideX = { home: [-34, -4], away: [4, 34] };
  for (const key of ['home', 'away']) {
    const t = engine.teams[key];
    const [x0, x1] = sideX[key];
    // benches
    for (let x = x0 + 2; x < x1 - 2; x += 6) {
      add(5, 0.45, 0.6, x, 0.45, zB - 2.2, t.primary);
      add(5, 0.6, 0.12, x, 0.85, zB - 2.55, t.primary);
      add(0.15, 0.45, 0.5, x - 2.3, 0.22, zB - 2.2, '#2b303a');
      add(0.15, 0.45, 0.5, x + 2.3, 0.22, zB - 2.2, '#2b303a');
    }
    // coolers / tables / equipment trunks
    for (const cx of [x0 + 0.5, x0 + 1.4, x1 - 1.2]) {
      add(0.7, 0.65, 0.55, cx, 0.33, zB + 0.6, '#ef7b22');
      add(0.74, 0.12, 0.6, cx, 0.7, zB + 0.6, '#f4f5f7');
    }
    add(2.4, 0.08, 0.9, x0 + 1, 0.85, zB + 0.6, '#d9dce1');
    for (const lx of [-1.1, 1.1]) add(0.06, 0.85, 0.06, x0 + 1 + lx, 0.42, zB + 0.6, '#59606b');
    add(1.6, 0.9, 0.8, x1 - 3.5, 0.45, zB - 0.4, '#3a5a9a');
    add(1.6, 0.9, 0.8, x0 + 6, 0.45, zB - 0.8, '#5b616b');
  }
  // camera/media carts and bins near the wall
  for (let x = -60; x <= 60; x += 15) if (Math.abs(x) > 36) add(1.2, 1.0, 1.0, x, 0.5, zB - 1.5, '#4c535e');
  const statics = new THREE.Mesh(mergeGeometries(geos), PLAYER_MATERIAL);
  statics.castShadow = true; statics.receiveShadow = true;
  g.add(statics);

  g.add(buildBenchPlayers(engine));
  const dummy = new THREE.Object3D();
  for (const key of ['home', 'away']) {
    const [x0, x1] = sideX[key];
    // coaches / staff (plain figures)
    const staffGeo = mergeGeometries([
      prep(new THREE.BoxGeometry(0.45, 0.7, 0.3).translate(0, 1.15, 0), key === 'home' ? '#1d2a4d' : '#4a1a1f'),
      prep(new THREE.BoxGeometry(0.4, 0.8, 0.26).translate(0, 0.42, 0), '#3b3f48'),
      prep(new THREE.BoxGeometry(0.24, 0.26, 0.24).translate(0, 1.65, 0), '#c68b62'),
      prep(new THREE.BoxGeometry(0.27, 0.08, 0.27).translate(0, 1.8, 0.02), '#22252c'),
    ]);
    const staff = new THREE.InstancedMesh(staffGeo, PLAYER_MATERIAL, 5);
    for (let i = 0; i < 5; i++) {
      dummy.position.set(x0 + 2 + Math.random() * (x1 - x0 - 4), 0, zB + 3.2 + Math.random());
      dummy.rotation.set(0, rand(-0.4, 0.4), 0); dummy.updateMatrix();
      staff.setMatrixAt(i, dummy.matrix);
    }
    staff.castShadow = true;
    g.add(staff);
  }
  return g;
}

const SIDE_X = { home: [-34, -4], away: [4, 34] };

/** Sideline players: a few posed variants per team, baked and instanced. */
export function buildBenchPlayers(engine) {
  const group = new THREE.Group();
  group.name = 'benchPlayers';
  const zB = -(FIELD.HALF_WID + 6);
  const dummy = new THREE.Object3D();
  const rand = (a, b) => a + Math.random() * (b - a);
  for (const key of ['home', 'away']) {
    const t = engine.teams[key];
    const specs = [['line', 'line'], ['skill', 'skill'], ['big', 'line'], ['skill', 'skill'], ['qb', 'qb']];
    const variants = specs.map(([build, kit], i) => {
      const skin = SKIN_TONES[(i * 2 + (key === 'home' ? 1 : 3)) % SKIN_TONES.length];
      const rig = createPlayerRig({ team: t, build, skin });
      const b = rig.bones;
      const pose = () => {
        b.shL.rotation.set(0.05, 0, 0.18); b.shR.rotation.set(0.05, 0, -0.18); b.elL.rotation.x = -0.3; b.elR.rotation.x = -0.3;
        if (i % 2) { b.shL.rotation.z = 0.7; b.elL.rotation.x = -1.6; b.elL.rotation.y = 0.8; b.shR.rotation.z = -0.7; b.elR.rotation.x = -1.6; b.elR.rotation.y = -0.8; }
        b.hipL.rotation.z = 0.07; b.hipR.rotation.z = -0.07; b.ankL.rotation.z = -0.07; b.ankR.rotation.z = 0.07;
      };
      if (engine.models) {
        const inst = engine.models.instantiate(build === 'line' || build === 'big' ? 'line' : 'skill', kitColors(t, kit, skin));
        const rt = new Retargeter(rig, inst, { line: 2.16, big: 2.08, skill: 2.0, qb: 2.04 }[build], build === 'big' ? 0.9 : 1);
        pose();
        const geo = rt.bake();
        return { geo, mat: inst.mesh.material };
      }
      pose();
      const geo = bakeRig(rig);
      rig.meshes.forEach(m => m.geometry.dispose());
      return { geo, mat: PLAYER_MATERIAL };
    });
    const [x0, x1] = SIDE_X[key];
    const perVariant = 6;
    variants.forEach(({ geo, mat }, vi) => {
      const im = new THREE.InstancedMesh(geo, mat, perVariant);
      for (let i = 0; i < perVariant; i++) {
        dummy.position.set(x0 + 1 + Math.random() * (x1 - x0 - 2), 0, zB + 1.5 + Math.random() * 2.2 - (vi === 0 ? 0.6 : 0));
        dummy.rotation.set(0, rand(-0.5, 0.5) + (Math.random() < 0.15 ? Math.PI / 2 : 0), 0);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      }
      im.castShadow = true;
      group.add(im);
    });
  }
  return group;
}
