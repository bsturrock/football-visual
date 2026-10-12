import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---------------------------------------------------------------------------
// Milestone 6: the exact Meshy helmet on the procedural player.
//
//   const asset = await loadHelmet()              // once; geometry shared by every player
//   attachHelmet(rig, asset, kit)                 // mounts on the head bone, hides hair
//   setHelmet(rig, false)                         // helmet off (sideline, portraits), hair back
//
// Geometry: assets/characters/helmet_regions.glb, built by tools/blueprint/build_helmet.py from
// assets/meshy/source/new-base-helmet.glb with IDENTICAL vertices / triangles / UVs. Approved material
// changes only: matte (was metallic), the painted texture became a 512² region map (shell / stripe /
// inner) recoloured per team here, and the white facemask bars are their own primitive with the
// team's facemask colour.
//
// Fit (rigid transform only): uniform scale and position measured on the medium player in the Meshy
// frame (metres); the helmet then follows the head's own scale for every body.
// ---------------------------------------------------------------------------

export const HELMET_URL = new URL('../../../assets/characters/helmet_regions.glb', import.meta.url).href;

/** Mount in the Meshy T-pose frame: helmet-local origin goes to CENTRE, scaled uniformly by SCALE. */
// 0.455 / +3 mm: smallest fit with no head or hair-less skull vertex outside the shell for 200 generated players
// (tools: /tmp penetration test, see M1_REPORT.md Milestone 6); the Meshy helmet's dome is slightly asymmetric
export const HELMET_FIT = { scale: 0.455, centre: [0, 1.6685, 0.0] };
const HEAD_BONE = [0, 1.54, -0.01];          // medium head pivot (mediumPlayer JOINTS.head)
const INNER = '#1c2130';                     // pocket interior: dark, so the face reads through the mask

let cache = null;
export async function loadHelmet(url = HELMET_URL) {
  if (cache) return cache;
  const gltf = await new GLTFLoader().loadAsync(url);
  const parts = {};
  gltf.scene.traverse(o => { if (o.isMesh) parts[o.material.name] = o; });
  const body = parts.body.geometry, mask = parts.mask.geometry;
  const map = parts.body.material.map.image;                       // the region map (PNG)
  const cv = document.createElement('canvas'); cv.width = map.width; cv.height = map.height;
  const ctx = cv.getContext('2d'); ctx.drawImage(map, 0, 0);
  const regions = ctx.getImageData(0, 0, cv.width, cv.height);
  cache = { body, mask, regions, materials: new Map() };
  return cache;
}

const hex = (c) => new THREE.Color(c);
/** Team materials, cached per colour set: shell/stripe/inner come from the region map, mask is flat. */
function helmetMaterials(asset, kit) {
  const key = [kit.helmet, kit.helmetStripe, kit.mask].join('|');
  if (asset.materials.has(key)) return asset.materials.get(key);
  const { width, height, data } = asset.regions;
  const out = new ImageData(width, height);
  const shell = hex(kit.helmet).convertLinearToSRGB(), stripe = hex(kit.helmetStripe).convertLinearToSRGB(), inner = hex(INNER).convertLinearToSRGB();
  for (let i = 0; i < data.length; i += 4) {
    // palette: shell 255,255,255 · stripe 0,0,255 · inner 128,128,128
    const c = data[i + 2] > 200 && data[i] < 60 ? stripe : data[i] > 190 ? shell : inner;
    out.data[i] = c.r * 255; out.data[i + 1] = c.g * 255; out.data[i + 2] = c.b * 255; out.data[i + 3] = 255;
  }
  const cv = document.createElement('canvas'); cv.width = width; cv.height = height;
  cv.getContext('2d').putImageData(out, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false;     // glTF UV convention
  tex.anisotropy = 4;
  const m = {
    body: new THREE.MeshStandardMaterial({ map: tex, flatShading: true, roughness: 0.7, metalness: 0, side: THREE.DoubleSide }),
    mask: new THREE.MeshStandardMaterial({ color: kit.mask, flatShading: true, roughness: 0.7, metalness: 0, side: THREE.DoubleSide }),
  };
  asset.materials.set(key, m);
  return m;
}

/**
 * Mount the helmet on a rig from createMediumPlayer. The rig's head bone carries the head geometry
 * scaled by the body's head factor about the head pivot, so the same rigid fit works for every body.
 */
export function attachHelmet(rig, asset, kit) {
  if (rig.helmet) rig.bones.head.remove(rig.helmet);
  const m = helmetMaterials(asset, kit);
  const g = new THREE.Group(); g.name = 'helmet';
  for (const [geo, mat] of [[asset.body, m.body], [asset.mask, m.mask]]) {
    const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; g.add(mesh);
  }
  const hs = rig.headScale ?? 1;
  const [cx, cy, cz] = HELMET_FIT.centre;
  g.position.set((cx - HEAD_BONE[0]) * hs, (cy - HEAD_BONE[1]) * hs, (cz - HEAD_BONE[2]) * hs);
  g.scale.setScalar(HELMET_FIT.scale * hs);
  rig.bones.head.add(g);
  rig.helmet = g;
  setHelmet(rig, true);
  return g;
}

/** Helmet on/off; hair is hidden while the helmet is on (it would poke through the shell). */
export function setHelmet(rig, on) {
  if (rig.helmet) rig.helmet.visible = on;
  rig.hair.visible = !on || !rig.helmet;
}
