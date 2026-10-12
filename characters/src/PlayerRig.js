import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { bodyScales, mapPoint, reshape } from './BodyCustomizer.js';

// ---------------------------------------------------------------------------
// Rigged base player driven by the game's procedural Animator.
//
//  • The GLB (tools/rig_base.py) has bones named after the Animator's joints,
//    bound in the T-pose.
//  • Each player gets its own reshaped geometry (BodyCustomizer) and its own
//    skeleton whose joints are moved by the SAME mapping, then re-bound, so
//    mesh and rig stay aligned for every height / weight.
//  • The Animator drives an invisible "proxy" joint hierarchy in its own
//    convention (rest = arms hanging down, legs straight). Each frame the proxy's
//    world rotations are copied onto the bones through per-bone bind offsets:
//        bone.world = proxy.world × offset
//    which absorbs the T-pose vs arms-down difference and any bone roll.
//
// Units: metres. The rig faces +Z, +X is the player's left.
// ---------------------------------------------------------------------------

const JOINTS = ['pelvis', 'spine', 'chest', 'neck', 'head',
  'shL', 'elL', 'handL', 'shR', 'elR', 'handR', 'hipL', 'knL', 'ankL', 'hipR', 'knR', 'ankR'];
const PARENT = {
  spine: 'pelvis', chest: 'spine', neck: 'chest', head: 'neck',
  shL: 'chest', elL: 'shL', handL: 'elL', shR: 'chest', elR: 'shR', handR: 'elR',
  hipL: 'pelvis', knL: 'hipL', ankL: 'knL', hipR: 'pelvis', knR: 'hipR', ankR: 'knR',
};
// limb joints: proxy segment points "down" and is aimed at the model's child joint at bind time
const AIM = { shL: 'elL', elL: 'handL', shR: 'elR', elR: 'handR', hipL: 'knL', knL: 'ankL', hipR: 'knR', knR: 'ankR' };
const LIMB_CHILD = new Set(['elL', 'handL', 'elR', 'handR', 'knL', 'ankL', 'knR', 'ankR']);

const DOWN = new THREE.Vector3(0, -1, 0);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qp = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3();

export class PlayerRigFactory {
  /**
   * @param gltf        loaded GLTF of base-medium-rigged.glb (body, no helmet)
   * @param helmetGltf  loaded GLTF of helmet.glb (origin at the head joint)
   */
  constructor(gltf, helmetGltf) {
    this.gltf = gltf;
    this.helmet = helmetGltf?.scene || null;
    if (this.helmet) this.helmet.traverse(o => { if (o.isMesh) { o.castShadow = true; o.material = new THREE.MeshStandardMaterial({ map: o.material.map, flatShading: true, roughness: 0.95, metalness: 0 }); } });
    let mesh;
    gltf.scene.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
    this.mesh = mesh;
    this.baseGeometry = mesh.geometry;
    gltf.scene.updateMatrixWorld(true);
    // rest (bind) world positions of every joint in the base player
    this.rest = {};
    for (const b of mesh.skeleton.bones) this.rest[b.name] = b.getWorldPosition(new THREE.Vector3());
  }

  /**
   * Build one player.
   * @returns {{ root, tilt, yaw, bones, leg, model, mesh, update() }}
   *   `bones` / `leg` / root / tilt / yaw follow the game rig interface, so the
   *   engine's Animator can drive it directly; call update() after animating.
   */
  create(body, material, opts = {}) {
    const S = bodyScales(body);

    // --- model: clone, reshape geometry, move joints with the same mapping, re-bind
    const model = cloneSkinned(this.gltf.scene);
    let mesh;
    model.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
    mesh.geometry = reshape(this.baseGeometry, body, S);
    mesh.material = material;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    const B = {};
    for (const b of mesh.skeleton.bones) B[b.name] = b;
    model.updateMatrixWorld(true);
    const target = {};
    for (const name of JOINTS) target[name] = mapPoint(S, ...this.rest[name].toArray(), new THREE.Vector3());
    for (const name of JOINTS) {                       // parents first (JOINTS is ordered)
      const b = B[name];
      b.position.copy(b.parent.worldToLocal(target[name].clone()));
      b.updateMatrixWorld(true);
    }
    mesh.skeleton.calculateInverses();
    mesh.bind(mesh.skeleton, mesh.matrixWorld);

    // --- proxy rig in the Animator's convention, built from the reshaped joints
    const root = new THREE.Group();
    const tilt = new THREE.Group(); tilt.name = 'tilt'; root.add(tilt);
    const yaw = new THREE.Group(); yaw.name = 'yaw'; tilt.add(yaw);
    const P = {};
    for (const name of JOINTS) {
      const j = new THREE.Group(); j.name = name; P[name] = j;
      const parent = PARENT[name] ? P[PARENT[name]] : yaw;
      parent.add(j);
      if (name === 'pelvis') j.position.copy(target.pelvis);
      else if (LIMB_CHILD.has(name)) j.position.set(0, -target[name].distanceTo(target[PARENT[name]]), 0);
      else j.position.subVectors(target[name], target[PARENT[name]]);
    }
    const leg = {
      HIP_Y: target.hipL.y - target.pelvis.y,
      THIGH: target.knL.distanceTo(target.hipL),
      SHIN: target.ankL.distanceTo(target.knL),
      FOOT_H: target.ankL.y,
    };
    yaw.add(model);

    // --- helmet + placeholder head, rigidly attached to the head bone (they never scale with weight)
    const headRest = new THREE.Matrix4().copy(B.head.matrixWorld).invert();
    const attach = (obj, offset) => {
      obj.applyMatrix4(new THREE.Matrix4().multiplyMatrices(headRest, new THREE.Matrix4().makeTranslation(target.head.x + offset.x, target.head.y + offset.y, target.head.z + offset.z)));
      B.head.add(obj);
      return obj;
    };
    const helmet = this.helmet ? attach(this.helmet.clone(), new THREE.Vector3()) : null;
    const head = attach(placeholderHead(opts.skin || '#c68b62'), new THREE.Vector3(0, 0.1, 0.01));
    // the placeholder head is only shown with the helmet off (it must never poke through the shell)
    const setHelmet = (on) => { if (helmet) helmet.visible = on; head.visible = !on || !helmet; };
    setHelmet(opts.helmet !== false);

    const rig = { root, tilt, yaw, bones: P, leg, model, mesh, helmet, head, body, scales: S, pairs: [], update: null };
    rig.setHelmet = setHelmet;
    const bindPose = Object.values(B).map(b => [b, b.position.clone(), b.quaternion.clone()]);
    this._bind(rig, B, target);
    rig.update = () => this._update(rig, B);
    /** Show the exact bind (T) pose. */
    rig.showBindPose = () => { for (const [b, p, q] of bindPose) { b.position.copy(p); b.quaternion.copy(q); } };
    return rig;
  }

  /** Aim the proxy limbs at the model's T-pose segments, then store bone = proxy × offset. */
  _bind(rig, B, target) {
    const P = rig.bones;
    rig.root.updateMatrixWorld(true);
    for (const [j, child] of Object.entries(AIM)) {
      _d.subVectors(target[child], target[j]).normalize();
      P[j].getWorldQuaternion(_q);
      _v.copy(DOWN).applyQuaternion(_q);
      _q2.setFromUnitVectors(_v, _d).multiply(_q);
      P[j].parent.getWorldQuaternion(_qp).invert();
      P[j].quaternion.copy(_qp.multiply(_q2));
      P[j].updateMatrixWorld(true);
    }
    rig.root.updateMatrixWorld(true);
    rig.pairs = JOINTS.map(name => {
      P[name].getWorldQuaternion(_q).invert();
      B[name].getWorldQuaternion(_q2);
      return { p: P[name], b: B[name], off: _q.multiply(_q2).clone() };
    });
    for (const name of JOINTS) P[name].rotation.set(0, 0, 0);
    rig.root.updateMatrixWorld(true);
  }

  _update(rig, B) {
    rig.root.updateMatrixWorld(true);
    // pelvis translation (crouch / bounce) follows the proxy
    rig.bones.pelvis.getWorldPosition(_v);
    B.pelvis.parent.worldToLocal(_v);
    B.pelvis.position.copy(_v);
    for (const pr of rig.pairs) {
      pr.p.getWorldQuaternion(_q).multiply(pr.off);
      pr.b.parent.getWorldQuaternion(_qp).invert();
      pr.b.quaternion.copy(_qp.multiply(_q));
      pr.b.updateMatrixWorld(true);
    }
  }
}

/** Simple boxy head shown with the helmet off (placeholder until seeded faces/hair). */
function placeholderHead(skin) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: skin, flatShading: true, roughness: 0.95 });
  const dark = new THREE.MeshStandardMaterial({ color: '#1d1f26', flatShading: true, roughness: 0.95 });
  const add = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; g.add(b); };
  add(0.2, 0.24, 0.22, 0, 0, 0, mat);                 // head
  add(0.21, 0.07, 0.2, 0, 0.11, -0.012, dark);        // short hair
  for (const s of [-1, 1]) add(0.035, 0.022, 0.01, s * 0.048, 0.025, 0.111, dark);   // eyes
  add(0.06, 0.012, 0.01, 0, -0.055, 0.111, dark);     // mouth
  add(0.11, 0.08, 0.13, 0, -0.14, 0, mat);            // neck
  return g;
}
