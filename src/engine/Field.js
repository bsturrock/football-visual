import * as THREE from 'three';
import { FIELD } from './constants.js';
import { prep, PLAYER_MATERIAL } from './PlayerModel.js';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';

// Wolf head silhouette (facing right) in a 200×130 box — used on the field
// logo and the HUD so both match.
export const WOLF_OUTLINE = [
  [18, 72], [28, 48], [44, 32], [54, 4], [70, 28], [86, 22], [101, 2], [106, 30], [131, 40], [160, 52], [196, 62],
  [191, 73], [166, 78], [179, 89], [151, 95], [136, 108], [110, 118], [80, 124], [52, 116], [32, 102], [10, 98],
  [22, 87], [4, 81],
];
export const WOLF_DETAIL = {
  highlight: [[106, 30], [131, 40], [160, 52], [196, 62], [170, 64], [140, 58], [112, 50], [96, 40]],
  earL: [[54, 4], [62, 26], [48, 34]],
  earR: [[101, 2], [102, 28], [88, 24]],
  eye: [[128, 50], [148, 54], [133, 59]],
  mouth: [[166, 78], [150, 82], [136, 84], [151, 95], [179, 89]],
  cheek: [[110, 60], [140, 70], [136, 108], [110, 118], [96, 92]],
};

export function drawWolf(ctx, ox, oy, w, h, colors, mirror = false) {
  const sx = w / 200, sy = h / 130;
  const P = (pts) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const X = ox + (mirror ? (200 - x) : x) * sx, Y = oy + y * sy;
      i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
    });
    ctx.closePath();
  };
  ctx.lineJoin = 'round';
  P(WOLF_OUTLINE); ctx.fillStyle = colors.outline; ctx.lineWidth = Math.max(w, h) * 0.05; ctx.strokeStyle = colors.outline; ctx.stroke(); ctx.fill();
  P(WOLF_OUTLINE); ctx.fillStyle = colors.base; ctx.fill();
  P(WOLF_DETAIL.cheek); ctx.fillStyle = colors.shade; ctx.fill();
  P(WOLF_DETAIL.highlight); ctx.fillStyle = colors.light; ctx.fill();
  P(WOLF_DETAIL.earL); ctx.fillStyle = colors.outline; ctx.fill();
  P(WOLF_DETAIL.earR); ctx.fill();
  P(WOLF_DETAIL.mouth); ctx.fill();
  P(WOLF_DETAIL.eye); ctx.fillStyle = colors.eye; ctx.fill();
}

function makeFieldTexture(teams, renderer) {
  const W = 4096, H = 2048;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const sx = W / (FIELD.HALF_LEN * 2), sz = H / (FIELD.HALF_WID * 2);
  const X = x => (x + FIELD.HALF_LEN) * sx;
  const Z = z => (z + FIELD.HALF_WID) * sz;

  // grass with 5-yard mowing stripes
  ctx.fillStyle = '#4f9a3b'; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 20; i++) {
    const x0 = -50 + i * 5;
    ctx.fillStyle = i % 2 ? '#4c9638' : '#55a140';
    ctx.fillRect(X(x0), 0, 5 * sx + 1, H);
  }
  // subtle turf noise
  for (let i = 0; i < 60000; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.03)';
    ctx.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 5, 2 + Math.random() * 3);
  }

  // end zones
  const ez = [[-60, teams.home], [50, teams.away]];
  for (const [x0, t] of ez) {
    ctx.fillStyle = t.endzone || t.primary;
    ctx.globalAlpha = 0.92; ctx.fillRect(X(x0), 0, 10 * sx, H); ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(X(x0 + 5), Z(0));
    ctx.rotate(x0 < 0 ? -Math.PI / 2 : Math.PI / 2);
    ctx.scale(sz / 50, sx / 50);
    ctx.font = '900 300px "Oswald", "Arial Black", Impact, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 18; ctx.strokeStyle = 'rgba(10,15,30,0.55)';
    const label = t.name.toUpperCase();
    ctx.letterSpacing = '30px';
    ctx.strokeText(label, 0, 10);
    ctx.fillStyle = '#ffffff'; ctx.fillText(label, 0, 10);
    ctx.restore();
  }

  const line = (x0, z0, x1, z1, w) => {
    ctx.beginPath(); ctx.moveTo(X(x0), Z(z0)); ctx.lineTo(X(x1), Z(z1));
    ctx.lineWidth = w; ctx.stroke();
  };
  ctx.strokeStyle = 'rgba(255,255,255,0.96)';
  ctx.lineCap = 'butt';

  // yard lines
  for (let x = -50; x <= 50; x += 5) {
    const goal = Math.abs(x) === 50;
    line(x, -FIELD.HALF_WID, x, FIELD.HALF_WID, (goal ? 0.3 : 0.15) * sx);
  }
  // end lines
  line(-60, -FIELD.HALF_WID, -60, FIELD.HALF_WID, 0.2 * sx);
  line(60, -FIELD.HALF_WID, 60, FIELD.HALF_WID, 0.2 * sx);
  // hash marks
  for (let x = -49; x <= 49; x++) {
    if (x % 5 === 0) continue;
    for (const s of [-1, 1]) {
      line(x, s * (FIELD.HASH - 0.4), x, s * (FIELD.HASH + 0.4), 0.13 * sx);
      line(x, s * (FIELD.HALF_WID - 0.25), x, s * (FIELD.HALF_WID - 1.05), 0.13 * sx);
    }
  }
  // 2-pt / PAT marks
  for (const s of [-1, 1]) line(s * 47, -0.5, s * 47, 0.5, 0.15 * sx);

  // midfield logo
  ctx.save();
  ctx.globalAlpha = 0.9;
  const lw = 19, lh = 12.5; // yards
  ctx.translate(X(0), Z(0));
  ctx.scale(sx, sz);
  drawWolf(ctx, -lw / 2, -lh / 2 - 0.5, lw, lh, {
    outline: '#26365c', base: teams.home.logoBase || '#4b6fae', shade: '#34528c', light: '#b7c4dc', eye: '#ffffff',
  }, true);
  ctx.restore();

  // numbers (bottoms face their sideline) + direction arrows
  for (let x = -40; x <= 40; x += 10) {
    const yl = 50 - Math.abs(x);
    const txt = String(yl);
    for (const side of [1, -1]) {
      ctx.save();
      ctx.translate(X(x), Z(side * (FIELD.HALF_WID - 11)));
      if (side < 0) ctx.rotate(Math.PI);
      ctx.scale(sx / 50, sz / 50);
      ctx.font = '700 150px "Oswald", "Arial Black", Impact, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.textAlign = 'right'; ctx.fillText(txt[0], -18, 6);
      ctx.textAlign = 'left'; ctx.fillText(txt[1], 18, 6);
      // arrow pointing to the nearer goal
      if (yl !== 50) {
        const dir = (x < 0 ? -1 : 1) * side;
        const ax = dir * -120;
        ctx.beginPath();
        ctx.moveTo(ax + dir * -22, -38); ctx.lineTo(ax + dir * -22, -10); ctx.lineTo(ax + dir * -50, -24); ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

export function buildField(engine) {
  const g = new THREE.Group();
  g.name = 'field';
  const { teams, renderer } = engine;

  // surrounding turf
  const surround = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 160).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: '#4a9338' }),
  );
  surround.position.y = -0.01;
  surround.receiveShadow = true;
  g.add(surround);

  // playing surface
  const tex = makeFieldTexture(teams, renderer);
  const field = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD.HALF_LEN * 2, FIELD.HALF_WID * 2).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ map: tex }),
  );
  field.receiveShadow = true;
  g.add(field);

  // 6ft white boundary border
  const bw = 2.0;
  const borderMat = new THREE.MeshLambertMaterial({ color: '#f3f5f7' });
  const mk = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), borderMat);
    m.position.set(x, 0.004, z); m.receiveShadow = true; g.add(m);
  };
  mk(FIELD.HALF_LEN * 2 + bw * 2, bw, 0, -(FIELD.HALF_WID + bw / 2));
  mk(FIELD.HALF_LEN * 2 + bw * 2, bw, 0, FIELD.HALF_WID + bw / 2);
  mk(bw, FIELD.HALF_WID * 2, -(FIELD.HALF_LEN + bw / 2), 0);
  mk(bw, FIELD.HALF_WID * 2, FIELD.HALF_LEN + bw / 2, 0);
  // team-area / coaching-box line on the far side
  mk(70, 0.15, 0, -(FIELD.HALF_WID + bw + 4));

  // pylons + goalposts (static, merged)
  const geos = [];
  const add = (geo, color, x, y, z, ry = 0) => { geo = prep(geo, color); geo.rotateY(ry); geo.translate(x, y, z); geos.push(geo); };
  for (const x of [-60, -50, 50, 60]) for (const z of [-1, 1]) add(new THREE.BoxGeometry(0.13, 0.5, 0.13), '#ff6a13', x, 0.25, z * (FIELD.HALF_WID + 0.07));
  const yellow = '#f3d230';
  for (const s of [-1, 1]) {
    const ex = s * (FIELD.HALF_LEN + 0.3);
    add(new THREE.BoxGeometry(0.4, 1.8, 0.4), '#2f3a58', s * (FIELD.HALF_LEN + 2.2), 0.9, 0); // pad
    add(new THREE.CylinderGeometry(0.14, 0.14, 3.4, 6), yellow, s * (FIELD.HALF_LEN + 2.2), 1.7, 0);
    add(new THREE.BoxGeometry(1.9, 0.22, 0.22), yellow, s * (FIELD.HALF_LEN + 1.25), 3.35, 0);
    add(new THREE.BoxGeometry(0.2, 0.2, 6.17), yellow, ex, 3.35, 0);
    for (const z of [-3.08, 3.08]) add(new THREE.CylinderGeometry(0.08, 0.08, 9, 6), yellow, ex, 3.35 + 4.5, z);
  }
  const merged = new THREE.Mesh(mergeGeometries(geos), PLAYER_MATERIAL);
  merged.castShadow = true;
  g.add(merged);
  return g;
}
