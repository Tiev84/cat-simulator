import * as THREE from 'three';

// Automatic rigging for static models (no skeleton in the file).
// The meshes are baked into one object space, landmarks (crotch, hands,
// shoulders, legs...) are found from the vertices, a skeleton is placed on
// them and every vertex is weighted to its two nearest bone segments, limited
// to the body region it belongs to (a leg vertex never follows an arm).
// Bones keep identity orientation, so posing in cat space is direct.

function bake(object, height) {
  object.updateMatrixWorld(true);
  const parts = [];
  object.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    parts.push({ geo: g, material: o.material, name: o.name });
  });
  const box = new THREE.Box3();
  for (const p of parts) {
    p.geo.computeBoundingBox();
    box.union(p.geo.boundingBox);
  }
  const s = height / (box.max.y - box.min.y);
  const m = new THREE.Matrix4()
    .makeScale(s, s, s)
    .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
  for (const p of parts) p.geo.applyMatrix4(m);
  return parts;
}

function points(parts, cap = 80000) {
  let total = 0;
  for (const p of parts) total += p.geo.attributes.position.count;
  const step = Math.max(1, Math.floor(total / cap));
  const out = [];
  for (const p of parts) {
    const a = p.geo.attributes.position;
    for (let i = 0; i < a.count; i += step) out.push(new THREE.Vector3(a.getX(i), a.getY(i), a.getZ(i)));
  }
  return out;
}

const mean = (arr) => arr.reduce((s, v) => s + v, 0) / Math.max(1, arr.length);

function segDist(p, a, b) {
  const ab = _ab.subVectors(b, a);
  const t = THREE.MathUtils.clamp(_ap.subVectors(p, a).dot(ab) / Math.max(ab.lengthSq(), 1e-9), 0, 1);
  return _c.copy(a).addScaledVector(ab, t).distanceTo(p);
}
const _ab = new THREE.Vector3(), _ap = new THREE.Vector3(), _c = new THREE.Vector3();

// Build bones from a joint table and skin every part.
// joints: name -> { at: Vector3, parent: name|null, end: Vector3 }
// region(p) -> list of allowed bone names for that vertex
function skin(parts, joints, region, falloff) {
  const names = Object.keys(joints);
  const bones = {};
  const list = [];
  for (const n of names) {
    const b = new THREE.Bone();
    b.name = n;
    bones[n] = b;
    list.push(b);
  }
  let rootName = null;
  for (const n of names) {
    const J = joints[n];
    const b = bones[n];
    if (J.parent) {
      bones[J.parent].add(b);
      b.position.copy(J.at).sub(joints[J.parent].at);
    } else {
      b.position.copy(J.at);
      rootName = n;
    }
  }
  const group = new THREE.Group();
  group.add(bones[rootName]);
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);
  const index = Object.fromEntries(names.map((n, i) => [n, i]));
  const p = new THREE.Vector3();
  for (const part of parts) {
    const pos = part.geo.attributes.position;
    const si = new Uint16Array(pos.count * 4);
    const sw = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      const allowed = region(p);
      let b1 = -1, b2 = -1, d1 = Infinity, d2 = Infinity;
      for (const n of allowed) {
        const J = joints[n];
        const d = segDist(p, J.at, J.end);
        if (d < d1) { d2 = d1; b2 = b1; d1 = d; b1 = index[n]; } else if (d < d2) { d2 = d; b2 = index[n]; }
      }
      let w1 = 1 / Math.pow(d1 + falloff, 4);
      let w2 = b2 >= 0 ? 1 / Math.pow(d2 + falloff, 4) : 0;
      const t = w1 + w2;
      si[i * 4] = Math.max(0, b1);
      si[i * 4 + 1] = Math.max(0, b2);
      sw[i * 4] = w1 / t;
      sw[i * 4 + 1] = w2 / t;
    }
    part.geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    part.geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    const mesh = new THREE.SkinnedMesh(part.geo, part.material);
    mesh.name = part.name;
    group.add(mesh);
    mesh.bind(skeleton, new THREE.Matrix4());
  }
  return { object: group, bones };
}

// ---------------------------------------------------------------------------
// Humanoids in T or A pose (Tom, Messi)
// ---------------------------------------------------------------------------
export function rigHumanoid(object, height) {
  const parts = bake(object, height);
  const P = points(parts);
  const H = height;
  // crotch: lowest point on the centre line above the feet
  let crotch = H * 0.6;
  for (const v of P) if (Math.abs(v.x) < H * 0.02 && v.y > H * 0.08 && v.y < crotch) crotch = v.y;
  // hands: the extreme left / right points
  let maxX = -Infinity, minX = Infinity;
  for (const v of P) { if (v.x > maxX) maxX = v.x; if (v.x < minX) minX = v.x; }
  const handL = new THREE.Vector3(), handR = new THREE.Vector3();
  const hl = P.filter((v) => v.x > maxX - H * 0.04);
  const hr = P.filter((v) => v.x < minX + H * 0.04);
  handL.set(mean(hl.map((v) => v.x)), mean(hl.map((v) => v.y)), mean(hl.map((v) => v.z)));
  handR.set(mean(hr.map((v) => v.x)), mean(hr.map((v) => v.y)), mean(hr.map((v) => v.z)));
  const tPose = handL.y > crotch + 0.5 * (H - crotch);
  const shoulderY = tPose ? handL.y + H * 0.01 : crotch + 0.66 * (H - crotch);
  let shoulderX;
  let torsoEdge;
  if (tPose) {
    const band = P.filter((v) => Math.abs(v.y - (crotch + 0.8 * (shoulderY - crotch))) < H * 0.02);
    shoulderX = Math.max(H * 0.04, Math.max(...band.map((v) => Math.abs(v.x))) * 0.82);
    torsoEdge = shoulderX * 0.85;
  } else {
    // arms hang beside the body: find the gap between torso and arm at the waist
    const by = crotch + 0.35 * (shoulderY - crotch);
    const xs = P.filter((v) => Math.abs(v.y - by) < H * 0.02).map((v) => Math.abs(v.x)).sort((a, b) => a - b);
    let best = 0;
    torsoEdge = H * 0.1;
    for (let i = 1; i < xs.length; i++) {
      const gap = xs[i] - xs[i - 1];
      if (xs[i - 1] > H * 0.04 && gap > best) { best = gap; torsoEdge = (xs[i] + xs[i - 1]) / 2; }
    }
    shoulderX = torsoEdge * 1.12;
  }
  const neckY = shoulderY + (tPose ? H * 0.015 : H * 0.045);
  const legBand = P.filter((v) => v.y > crotch * 0.35 && v.y < crotch * 0.65);
  const hipX = Math.max(H * 0.03, mean(legBand.map((v) => Math.abs(v.x))));
  const legZ = mean(legBand.map((v) => v.z));
  const kneeY = crotch * 0.5;
  const ankleY = H * 0.06;
  const toeZ = Math.max(...P.filter((v) => v.y < H * 0.05).map((v) => v.z));
  const torsoZ = mean(P.filter((v) => Math.abs(v.y - (crotch + shoulderY) / 2) < H * 0.03 && Math.abs(v.x) < shoulderX).map((v) => v.z));

  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const sL = V(shoulderX, shoulderY, torsoZ), sR = V(-shoulderX, shoulderY, torsoZ);
  const eL = sL.clone().lerp(handL, 0.48), eR = sR.clone().lerp(handR, 0.48);
  const wL = sL.clone().lerp(handL, 0.86), wR = sR.clone().lerp(handR, 0.86);
  const joints = {
    hips: { at: V(0, crotch + H * 0.05, torsoZ), parent: null, end: V(0, crotch + 0.3 * (shoulderY - crotch), torsoZ) },
    spine: { at: V(0, crotch + 0.3 * (shoulderY - crotch), torsoZ), parent: 'hips', end: V(0, crotch + 0.72 * (shoulderY - crotch), torsoZ) },
    chest: { at: V(0, crotch + 0.72 * (shoulderY - crotch), torsoZ), parent: 'spine', end: V(0, neckY, torsoZ) },
    neck: { at: V(0, neckY, torsoZ), parent: 'chest', end: V(0, neckY + H * 0.05, torsoZ) },
    head: { at: V(0, neckY + H * 0.05, torsoZ), parent: 'neck', end: V(0, H, torsoZ) },
    l_upperArm: { at: sL, parent: 'chest', end: eL },
    l_foreArm: { at: eL, parent: 'l_upperArm', end: wL },
    l_hand: { at: wL, parent: 'l_foreArm', end: handL },
    r_upperArm: { at: sR, parent: 'chest', end: eR },
    r_foreArm: { at: eR, parent: 'r_upperArm', end: wR },
    r_hand: { at: wR, parent: 'r_foreArm', end: handR },
    l_thigh: { at: V(hipX, crotch + H * 0.02, legZ), parent: 'hips', end: V(hipX, kneeY, legZ) },
    l_shin: { at: V(hipX, kneeY, legZ), parent: 'l_thigh', end: V(hipX, ankleY, legZ) },
    l_foot: { at: V(hipX, ankleY, legZ), parent: 'l_shin', end: V(hipX, H * 0.02, toeZ) },
    r_thigh: { at: V(-hipX, crotch + H * 0.02, legZ), parent: 'hips', end: V(-hipX, kneeY, legZ) },
    r_shin: { at: V(-hipX, kneeY, legZ), parent: 'r_thigh', end: V(-hipX, ankleY, legZ) },
    r_foot: { at: V(-hipX, ankleY, legZ), parent: 'r_shin', end: V(-hipX, H * 0.02, toeZ) },
  };
  const torso = ['hips', 'spine', 'chest', 'neck', 'head'];
  const region = (v) => {
    const side = v.x >= 0 ? 'l' : 'r';
    if (v.y > neckY + H * 0.01) return ['head', 'neck'];
    if (v.y < crotch + H * 0.03) {
      const leg = [`${side}_thigh`, `${side}_shin`, `${side}_foot`];
      return v.y > crotch - H * 0.06 ? [...leg, 'hips'] : leg;
    }
    const armX = tPose || v.y > shoulderY - H * 0.07 ? shoulderX * 0.85 : torsoEdge;
    if (Math.abs(v.x) > armX && v.y > crotch + H * 0.08) {
      const arm = [`${side}_upperArm`, `${side}_foreArm`, `${side}_hand`];
      return Math.abs(v.x) < shoulderX * 1.2 ? [...arm, 'chest'] : arm;
    }
    return torso;
  };
  const rig = skin(parts, joints, region, H * 0.01);
  const armRest = Math.atan2(handL.y - shoulderY, handL.x - shoulderX);
  return { ...rig, meta: { H, crotch, shoulderY, shoulderX, neckY, armRest, tPose, depth: torsoZ, armLen: sL.distanceTo(handL) } };
}

// ---------------------------------------------------------------------------
// Four-legged animals standing still (the goat)
// ---------------------------------------------------------------------------
export function rigQuadruped(object, height) {
  const parts = bake(object, height);
  const P = points(parts);
  const H = height;
  let minZ = Infinity, maxZ = -Infinity, maxX = 0;
  for (const v of P) { minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z); maxX = Math.max(maxX, Math.abs(v.x)); }
  // belly: lowest point along the middle of the body
  let belly = H;
  for (const v of P) if (Math.abs(v.x) < maxX * 0.15 && v.z > minZ + (maxZ - minZ) * 0.3 && v.z < minZ + (maxZ - minZ) * 0.7 && v.y < belly) belly = v.y;
  const low = P.filter((v) => v.y < belly * 0.5);
  const zMid = mean(low.map((v) => v.z));
  const legs = {};
  for (const [name, sx, front] of [['fl', 1, true], ['fr', -1, true], ['bl', 1, false], ['br', -1, false]]) {
    const q = low.filter((v) => Math.sign(v.x || 1) === sx && (v.z > zMid) === front);
    legs[name] = new THREE.Vector3(mean(q.map((v) => v.x)), 0, mean(q.map((v) => v.z)));
  }
  const frontZ = (legs.fl.z + legs.fr.z) / 2;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const neckZ = frontZ + (maxZ - frontZ) * 0.15;
  const joints = {
    body: { at: V(0, belly + H * 0.15, zMid), parent: null, end: V(0, belly + H * 0.15, neckZ) },
    neck: { at: V(0, belly + H * 0.28, neckZ), parent: 'body', end: V(0, H * 0.85, maxZ - (maxZ - frontZ) * 0.15) },
  };
  for (const [name, c] of Object.entries(legs)) {
    joints[`${name}_upper`] = { at: V(c.x, belly + H * 0.04, c.z), parent: 'body', end: V(c.x, belly * 0.5, c.z) };
    joints[`${name}_lower`] = { at: V(c.x, belly * 0.5, c.z), parent: `${name}_upper`, end: V(c.x, 0, c.z) };
  }
  const region = (v) => {
    if (v.y < belly + H * 0.02) {
      const front = v.z > zMid;
      const name = (front ? 'f' : 'b') + (v.x >= 0 ? 'l' : 'r');
      const leg = [`${name}_upper`, `${name}_lower`];
      return v.y > belly - H * 0.06 ? [...leg, 'body'] : leg;
    }
    if (v.z > neckZ - (maxZ - minZ) * 0.05 && v.y > belly + H * 0.08) return ['neck', 'body'];
    return ['body'];
  };
  const rig = skin(parts, joints, region, H * 0.02);
  return { ...rig, meta: { H, belly, length: maxZ - minZ } };
}
