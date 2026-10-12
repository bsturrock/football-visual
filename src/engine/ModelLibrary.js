import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STAND_PELVIS } from './PlayerModel.js';

// ---------------------------------------------------------------------------
// Stylized GLB player models (Meshy → Mixamo → tools/blender/stylize.py).
//
//  • Each source GLB has one primitive per *region material* (jersey, pants,
//    stripe, socks, band, helmet, mask, facehole, skin, gloves, wrist, cleats).
//  • For every (model, team, kit, skin tone) we bake ONE merged, vertex-coloured
//    skinned geometry → each player is a single draw call with a matte,
//    flat-shaded material, and team colours are just a different variant.
//  • Players are driven by the engine's procedural proxy skeleton; the
//    Retargeter copies its joint orientations onto the Mixamo bones.
// ---------------------------------------------------------------------------

export const MODEL_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0,
});

/** Region colours for a team kit. kit: 'line' | 'skill' | 'qb' */
export function kitColors(team, kit, skin) {
  const P = team.primary, W = '#f2f4f7';
  return {
    jersey: P, pants: team.pants || W, stripe: team.stripe || P, socks: P, band: '#f2f4f7',
    helmet: team.helmet || '#f2f3f6',
    mask: kit === 'skill' ? (team.facemaskSkill || P) : (team.facemask || '#f2f3f6'),
    facehole: '#18213a', skin,
    gloves: kit === 'line' ? '#2a2e38' : kit === 'skill' ? P : skin,
    wrist: P, cleats: kit === 'line' ? '#262a35' : P,
  };
}

const regionOf = (mat) => (mat?.name || '').replace(/\.\d+$/, '');

export class ModelLibrary {
  constructor() {
    this.src = {};
    this.variants = new Map();
  }

  /** urls: { line: 'assets/lineman_styl.glb', skill: 'assets/wr_styl.glb' } */
  async load(urls) {
    const loader = new GLTFLoader();
    await Promise.all(Object.entries(urls).map(async ([key, url]) => {
      const gltf = await loader.loadAsync(url);
      const scene = gltf.scene;
      scene.updateMatrixWorld(true);
      const meshes = [];
      scene.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
      if (!meshes.length) throw new Error(`${url}: no skinned mesh`);
      const bones = {};
      meshes[0].skeleton.bones.forEach(b => { bones[b.name.replace('mixamorig:', '').replace('mixamorig', '')] = b; });
      // rest-pose bounds from the bind geometry
      const box = new THREE.Box3();
      const v = new THREE.Vector3();
      for (const m of meshes) {
        const p = m.geometry.attributes.position;
        for (let i = 0; i < p.count; i += 3) { v.fromBufferAttribute(p, i); m.applyBoneTransform(i, v); v.applyMatrix4(m.matrixWorld); box.expandByPoint(v); }
      }
      const hips = bones.Hips.getWorldPosition(new THREE.Vector3());
      this.src[key] = { scene, meshes, bones, box, height: box.max.y - box.min.y, hipY: hips.y - box.min.y, minY: box.min.y };
    }));
    return this;
  }

  /** Merged, vertex-coloured skinned geometry for a colour set (cached). */
  geometry(key, colors) {
    const id = key + '|' + Object.values(colors).join(',');
    let g = this.variants.get(id);
    if (g) return g;
    const src = this.src[key];
    const parts = [];
    const c = new THREE.Color();
    for (const m of src.meshes) {
      const groups = m.geometry.groups.length ? m.geometry.groups : [{ start: 0, count: (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count), materialIndex: 0 }];
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const gr of groups) {
        let geo = m.geometry.clone();
        if (geo.index) {
          const idx = Array.from(geo.index.array).slice(gr.start, gr.start + gr.count);
          geo.setIndex(idx);
          geo = geo.toNonIndexed();
        }
        for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'skinIndex', 'skinWeight'].includes(k)) geo.deleteAttribute(k);
        geo.clearGroups();
        c.set(colors[regionOf(mats[gr.materialIndex])] || '#ff00ff');
        const n = geo.attributes.position.count;
        const arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
        geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        // normalise attribute types so mergeGeometries accepts them
        for (const k of ['skinIndex', 'skinWeight']) {
          const a = geo.attributes[k];
          if (k === 'skinWeight' && !(a.array instanceof Float32Array)) {
            const f = new Float32Array(a.count * 4);
            for (let i = 0; i < a.count; i++) for (let j = 0; j < 4; j++) f[i * 4 + j] = a.getComponent(i, j);
            geo.setAttribute(k, new THREE.BufferAttribute(f, 4));
          }
          if (k === 'skinIndex' && !(a.array instanceof Uint16Array)) {
            const u = new Uint16Array(a.count * 4);
            for (let i = 0; i < a.count; i++) for (let j = 0; j < 4; j++) u[i * 4 + j] = a.getComponent(i, j);
            geo.setAttribute(k, new THREE.BufferAttribute(u, 4));
          }
        }
        parts.push(geo);
      }
    }
    g = mergeGeometries(parts, false);
    parts.forEach(p => p.dispose());
    this.variants.set(id, g);
    return g;
  }

  /** New skinned instance: { root, mesh, bones, src } — one draw call. */
  instantiate(key, colors) {
    const src = this.src[key];
    const root = cloneSkinned(src.scene);
    const meshes = [];
    root.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
    const mesh = meshes[0];
    for (const m of meshes.slice(1)) m.parent.remove(m);
    mesh.geometry = this.geometry(key, colors);
    mesh.material = MODEL_MATERIAL;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    const bones = {};
    mesh.skeleton.bones.forEach(b => { bones[b.name.replace('mixamorig:', '').replace('mixamorig', '')] = b; });
    return { root, mesh, bones, src };
  }
}

// proxy joint → Mixamo bones (parents first)
const MAP = [
  ['pelvis', 'Hips'], ['spine', 'Spine'], ['spine', 'Spine1'], ['chest', 'Spine2'], ['neck', 'Neck'], ['head', 'Head'],
  ['chest', 'LeftShoulder'], ['shL', 'LeftArm'], ['elL', 'LeftForeArm'], ['handL', 'LeftHand'],
  ['chest', 'RightShoulder'], ['shR', 'RightArm'], ['elR', 'RightForeArm'], ['handR', 'RightHand'],
  ['hipL', 'LeftUpLeg'], ['knL', 'LeftLeg'], ['ankL', 'LeftFoot'], ['ankL', 'LeftToeBase'],
  ['hipR', 'RightUpLeg'], ['knR', 'RightLeg'], ['ankR', 'RightFoot'], ['ankR', 'RightToeBase'],
];
// limb joints whose bind orientation is aimed along the model's own segments
const AIM = [
  ['shL', 'LeftArm', 'LeftForeArm'], ['elL', 'LeftForeArm', 'LeftHand'],
  ['shR', 'RightArm', 'RightForeArm'], ['elR', 'RightForeArm', 'RightHand'],
  ['hipL', 'LeftUpLeg', 'LeftLeg'], ['knL', 'LeftLeg', 'LeftFoot'],
  ['hipR', 'RightUpLeg', 'RightLeg'], ['knR', 'RightLeg', 'RightFoot'],
];

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qp = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Drives a Mixamo-rigged instance from the engine's procedural proxy rig.
 * World-space retarget: bone.world = proxy.world × bindOffset.
 */
export class Retargeter {
  /**
   * @param rig      proxy rig from createPlayerRig (meshes removed)
   * @param inst     ModelLibrary.instantiate() result
   * @param height   target standing height in yards
   * @param widthMul horizontal scale multiplier
   */
  constructor(rig, inst, height, widthMul = 1) {
    this.rig = rig; this.inst = inst;
    const src = inst.src;
    const s = height / src.height;
    inst.root.scale.set(s * widthMul, s, s * widthMul);
    inst.root.position.set(0, -src.minY * s, 0);
    rig.yaw.add(inst.root);
    // pelvis height ratio (model hip height vs proxy pelvis height)
    this.k = (src.hipY * s) / (STAND_PELVIS * rig.scale);
    this.pairs = MAP.filter(([, b]) => inst.bones[b]).map(([p, b]) => ({ p: rig.bones[p], b: inst.bones[b], off: new THREE.Quaternion(), name: b }));
    this._bind();
  }

  _bind() {
    const rig = this.rig, B = this.inst.bones;
    for (const k in rig.bones) rig.bones[k].rotation.set(0, 0, 0);
    rig.bones.pelvis.position.y = STAND_PELVIS;
    const saveTilt = rig.tilt.quaternion.clone(), saveYaw = rig.yaw.rotation.y, savePos = rig.root.position.clone();
    rig.tilt.quaternion.identity(); rig.yaw.rotation.y = 0;
    rig.root.updateMatrixWorld(true);
    // aim proxy limb joints along the model's bind-pose segments (T-pose)
    for (const [pj, b0, b1] of AIM) {
      if (!B[b0] || !B[b1]) continue;
      const j = rig.bones[pj];
      B[b0].getWorldPosition(_a); B[b1].getWorldPosition(_b);
      _d.subVectors(_b, _a).normalize();
      j.getWorldQuaternion(_q);
      _v.copy(DOWN).applyQuaternion(_q);            // current joint "bone" direction
      _q2.setFromUnitVectors(_v, _d).multiply(_q);  // desired world orientation
      j.parent.getWorldQuaternion(_qp).invert();
      j.quaternion.copy(_qp.multiply(_q2));
      j.updateMatrixWorld(true);
    }
    rig.root.updateMatrixWorld(true);
    for (const pr of this.pairs) {
      pr.p.getWorldQuaternion(_q).invert();
      pr.b.getWorldQuaternion(_q2);
      pr.off.copy(_q.multiply(_q2));
    }
    this.hipRest = B.Hips.position.clone();
    for (const k in rig.bones) rig.bones[k].rotation.set(0, 0, 0);
    rig.tilt.quaternion.copy(saveTilt); rig.yaw.rotation.y = saveYaw; rig.root.position.copy(savePos);
    rig.root.updateMatrixWorld(true);
  }

  /** Call after the proxy rig's world matrices are current. */
  update() {
    const rig = this.rig, hips = this.inst.bones.Hips;
    // hips translation: proxy pelvis (in yaw space), vertical scaled to the model's leg length
    rig.bones.pelvis.getWorldPosition(_v);
    rig.yaw.worldToLocal(_v);
    _v.y *= this.k;
    rig.yaw.localToWorld(_v);
    hips.parent.worldToLocal(_v);
    hips.position.copy(_v);
    hips.updateMatrixWorld();
    for (const pr of this.pairs) {
      pr.p.getWorldQuaternion(_q).multiply(pr.off);
      pr.b.parent.getWorldQuaternion(_qp).invert();
      pr.b.quaternion.copy(_qp.multiply(_q));
      pr.b.updateMatrixWorld(true);
    }
  }

  /** Bake the current pose into a static vertex-coloured geometry (root-local). */
  bake() {
    const mesh = this.inst.mesh;
    this.rig.root.updateMatrixWorld(true);
    this.update();
    mesh.skeleton.update();
    const inv = new THREE.Matrix4().copy(this.rig.root.matrixWorld).invert();
    const m = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    const src = mesh.geometry;
    const pos = src.attributes.position;
    const out = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i);
      mesh.applyBoneTransform(i, _v);
      _v.applyMatrix4(m);
      out[i * 3] = _v.x; out[i * 3 + 1] = _v.y; out[i * 3 + 2] = _v.z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(out, 3));
    g.setAttribute('color', src.attributes.color.clone());
    g.computeVertexNormals();
    return g;
  }
}
