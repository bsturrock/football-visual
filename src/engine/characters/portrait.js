import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Player-card portraits. Same rig, same saved identity as on the field; a fixed
// head-and-shoulders camera and studio lighting so every card is framed alike.
//
//   const canvas = renderPortrait(renderer, rig, { size: 256, angle: 0.35 })
//
// The rig is posed at rest (arms down), rendered alone into an offscreen target and
// returned as a 2D canvas (safe to keep / draw into a card). The rig is put back where it was.
// ---------------------------------------------------------------------------

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight('#f4f7ff', '#8a8f9a', 1.9));
const key = new THREE.DirectionalLight('#fff6ea', 2.2);
key.position.set(1.5, 2.5, 3); scene.add(key);
const rim = new THREE.DirectionalLight('#dfe8ff', 0.8);
rim.position.set(-2, 1.5, -2); scene.add(rim);
const camera = new THREE.PerspectiveCamera(24, 1, 0.05, 50);
const _v = new THREE.Vector3();

export function renderPortrait(renderer, rig, { size = 256, angle = 0.35, background = '#d9dee6' } = {}) {
  // rest pose
  for (const b of Object.values(rig.bones)) b.rotation.set(0, 0, 0);
  const L = rig.leg;
  rig.bones.pelvis.position.y = L.FOOT_H + L.SHIN + L.THIGH - L.HIP_Y;
  rig.tilt.quaternion.identity();

  const parent = rig.root.parent, saved = rig.root.matrix.clone();
  const [px, py, pz] = rig.root.position.toArray();
  scene.add(rig.root);
  rig.root.position.set(0, 0, 0);
  rig.root.rotation.set(0, 0, 0);
  rig.root.updateMatrixWorld(true);

  // frame: head pivot (works for any height / body / unit scale)
  rig.bones.head.getWorldPosition(_v);
  const s = rig.root.scale.y;                          // metres → scene units if the rig is scaled (yards)
  // the head pivot is at the base of the head; frame from the top of the pads to above the hair
  const target = _v.clone().add(new THREE.Vector3(0, 0.10 * s, 0));
  const dist = 1.5 * s;
  camera.position.set(target.x + Math.sin(angle) * dist, target.y + 0.06 * s, target.z + Math.cos(angle) * dist);
  camera.lookAt(target.x, target.y - 0.02 * s, target.z);
  camera.aspect = 1; camera.updateProjectionMatrix();
  scene.background = new THREE.Color(background);

  const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4, colorSpace: THREE.SRGBColorSpace });
  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  const px8 = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, px8);
  renderer.setRenderTarget(prevTarget);
  rt.dispose();

  // back where it came from
  if (parent) parent.add(rig.root); else scene.remove(rig.root);
  rig.root.position.set(px, py, pz);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) img.data.set(px8.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4); // flip Y
  ctx.putImageData(img, 0, 0);
  return canvas;
}
