import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { damp, lerp, clamp } from './noise.js';

export const WINGS = [
  { id: 'angel', name: 'Cánh thiên thần', badge: 'DEFAULT', desc: 'Cánh lông vũ trắng, vỗ nhanh nhẹn.', colors: ['#efe9dd', '#f8f5ee', '#ffffff'], freq: 2.4, rough: 0.8 },
  { id: 'angel-soft', name: 'Cánh thiên thần (êm)', badge: '', desc: 'Cùng bộ lông vũ, vỗ chậm và nhẹ hơn.', colors: ['#efe9dd', '#f8f5ee', '#ffffff'], freq: 1.35, amp: 0.8, rough: 0.8 },
  { id: 'raven', name: 'Cánh quạ', badge: 'GENERATED', desc: 'Lông đen ánh xanh lạnh lẽo.', colors: ['#262b42', '#151a2a', '#0a0c15'], freq: 2.0, rough: 0.32, metal: 0.4, env: 0.9 },
  { id: 'demon', name: 'Cánh quỷ', badge: 'GENERATED', desc: 'Đỏ thẫm chuyển sang đen, vỗ nặng và chậm.', colors: ['#a8121c', '#4c070c', '#120304'], freq: 1.05, amp: 1.1, rough: 0.55, length: 1.15 },
  { id: 'golden', name: 'Cánh vàng', badge: 'GENERATED', desc: 'Lông vũ vàng óng ánh.', colors: ['#ffd978', '#e6aa3a', '#b47c1e'], freq: 1.9, rough: 0.3, metal: 0.85, env: 1.2, glow: 0.03 },
  { id: 'phoenix', name: 'Cánh phượng hoàng', badge: 'GENERATED', desc: 'Lửa từ gốc tới ngọn, phát sáng trong đêm.', colors: ['#ffeb8f', '#ff8a1c', '#d5230b'], freq: 1.6, rough: 0.6, glow: 0.45 },
  { id: 'helicopter', kind: 'rotor', name: 'Cánh quạt trực thăng', badge: 'UNLOCK', unlock: 5, desc: 'Quạt quay vù vù rồi cất cánh. Helicopter, helicopter!' },
];

// Tom ignores the wing choice: he always flies with his bat cape.
export const CAPE = { id: 'cape', kind: 'cape', name: 'Bat cape', freq: 1.25 };

export function createWings(spec) {
  if (spec.kind === 'rotor') return new Rotor(spec);
  if (spec.kind === 'cape') return new Cape(spec);
  return new Wings(spec);
}

let envTexture = null;
const smoothstep01 = (t) => t * t * (3 - 2 * t);
export function setWingEnvironment(tex) {
  envTexture = tex;
}
export function getWingEnvironment() {
  return envTexture;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

function grad(colors, t) {
  const c = new THREE.Color();
  if (t < 0.5) return c.copy(new THREE.Color(colors[0])).lerp(new THREE.Color(colors[1]), t * 2);
  return c.copy(new THREE.Color(colors[1])).lerp(new THREE.Color(colors[2]), (t - 0.5) * 2);
}

// One feather: a faceted leaf pointing along -z from its root.
function feather(len, width, colors, tipBias) {
  const v = [
    [0, 0, 0],
    [width * 0.5, 0.004, -len * 0.25],
    [width * 0.38, 0.006, -len * 0.78],
    [0, 0.002, -len],
    [-width * 0.38, 0.006, -len * 0.78],
    [-width * 0.5, 0.004, -len * 0.25],
    [0, 0.012, -len * 0.5],
  ];
  const tris = [[0, 1, 6], [1, 2, 6], [2, 3, 6], [3, 4, 6], [4, 5, 6], [5, 0, 6]];
  const pos = [];
  const col = [];
  for (const tri of tris) {
    for (const i of tri) {
      pos.push(...v[i]);
      const t = clamp(-v[i][2] / len * 0.7 + tipBias, 0, 1);
      const c = grad(colors, t);
      col.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function place(geo, x, y, z, ry, rx = 0) {
  _e.set(rx, ry, 0);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _m.compose(_p, _q, _s);
  return geo.applyMatrix4(_m);
}

function bone(len, r, color) {
  const g = new THREE.CylinderGeometry(r, r * 0.7, len, 5, 1).rotateZ(-Math.PI / 2).translate(len / 2, 0, 0).toNonIndexed();
  const c = new THREE.Color(color);
  const col = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

function buildSegments(spec) {
  const C = spec.colors;
  const L = spec.length || 1;
  const Li = 0.4;
  const Lo = 0.46;
  const inner = [bone(Li, 0.022, C[0])];
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    inner.push(place(feather(lerp(0.36, 0.42, t) * L, 0.11, C, 0.25), 0.04 + t * (Li - 0.04), -0.004 * i, -0.01, -0.06 * t));
  }
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    inner.push(place(feather(0.2 * L, 0.1, C, 0.0), 0.03 + t * (Li - 0.02), 0.014, 0.03, -0.05 * t, -0.05));
  }
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    inner.push(place(feather(0.1, 0.08, C, -0.2), 0.02 + t * Li, 0.026, 0.045, 0, -0.08));
  }
  const outer = [bone(Lo, 0.017, C[0])];
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    outer.push(place(feather(lerp(0.44, 0.62, t) * L, lerp(0.11, 0.09, t), C, 0.4), t * Lo, -0.004 * i, -0.005, lerp(-0.08, -1.05, t * t)));
  }
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    outer.push(place(feather(0.18 * L, 0.09, C, 0.05), t * (Lo - 0.04), 0.014, 0.025, lerp(-0.05, -0.6, t * t), -0.05));
  }
  return { inner: mergeGeometries(inner), outer: mergeGeometries(outer), Li };
}

export class Wings {
  constructor(spec) {
    this.spec = spec;
    const { inner, outer, Li } = buildSegments(spec);
    this.glow = { value: 0 };
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      flatShading: true,
      roughness: spec.rough ?? 0.8,
      metalness: spec.metal ?? 0,
    });
    if (spec.env && envTexture) {
      mat.envMap = envTexture;
      mat.envMapIntensity = spec.env;
    }
    mat.onBeforeCompile = (s) => {
      s.uniforms.uGlow = this.glow;
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uGlow;');
    };
    this.material = mat;
    this.group = new THREE.Group();
    this.sides = [];
    for (const s of [1, -1]) {
      const side = new THREE.Group();
      side.position.x = s * 0.05;
      side.scale.x = s;
      const flap = new THREE.Group();
      const sweep = new THREE.Group();
      const roll = new THREE.Group();
      flap.add(sweep);
      sweep.add(roll);
      const innerMesh = new THREE.Mesh(inner, mat);
      innerMesh.castShadow = true;
      roll.add(innerMesh);
      const elbow = new THREE.Group();
      elbow.position.x = Li;
      const outerMesh = new THREE.Mesh(outer, mat);
      outerMesh.castShadow = true;
      elbow.add(outerMesh);
      roll.add(elbow);
      side.add(flap);
      this.group.add(side);
      this.sides.push({ side, flap, sweep, roll, elbow, s });
    }
    this.phase = 0;
    this.open = 0;
    this.lastSin = 0;
    this.onFlap = null;
  }

  // st: { flyW, vy, speed, time, night }
  update(dt, st) {
    const spec = this.spec;
    this.open = damp(this.open, st.flyW > 0.5 ? 1 : st.pose === 'spread' ? 1 : 0, 5, dt);
    const o = this.open;
    const climbing = clamp(st.vy / 3, -1, 1);
    const glide = clamp(st.speed / 6, 0, 1) * (climbing < 0 ? 0.6 : 0.2);
    const freq = spec.freq * (1 + Math.max(0, climbing) * 0.35);
    this.phase += dt * freq * Math.PI * 2 * (o > 0.05 ? 1 : 0.15);
    const amp = (spec.amp || 0.95) * 0.75 * (1 - glide) * o;
    const sn = Math.sin(this.phase);
    if (o > 0.5 && this.lastSin > 0 && sn <= 0 && this.onFlap) this.onFlap(spec.freq);
    this.lastSin = sn;
    const breathe = Math.sin(st.time * 1.5) * 0.03;
    this.flapAngle = sn * amp;
    // Folded: the wing bone runs back along the spine and the feathers hang
    // down over the flank, like a bird at rest. Open: spread and flapping.
    const hw = st.halfWidth || 0.14;
    for (const side of this.sides) {
      side.side.position.set(side.s * lerp(hw * 0.75, 0.05, o), lerp(-0.02, 0, o), lerp(0.06, 0, o));
      side.flap.rotation.z = lerp(0.12 + breathe * 0.5, 0.15 + sn * amp, o);
      side.flap.rotation.x = lerp(0, 0.05, o);
      side.sweep.rotation.y = lerp(1.5, 0.12 + Math.cos(this.phase) * 0.12 * o, o);
      side.roll.rotation.x = lerp(-1.15, 0, o);
      side.elbow.rotation.y = lerp(0.12, 0, o);
      side.elbow.rotation.z = lerp(0, Math.sin(this.phase - 0.8) * amp * 0.55, o);
    }
    // F toggles the wings: they unfold out of the back and vanish when put away
    const grow = smoothstep01(o);
    this.group.visible = grow > 0.01;
    this.group.scale.setScalar(Math.max(0.001, grow) * (st.scale || 1));
    this.glow.value = (spec.glow || 0) * (0.5 + st.night * 1.6);
  }

  // Pose for menu thumbnails.
  prime() {
    this.open = 1;
    this.phase = 0.35;
  }

  dispose() {
    this.group.traverse((o) => o.geometry && o.geometry.dispose());
    this.material.dispose();
  }
}

function colorize(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const col = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

// Helicopter rotor: a mast on the cat's back with three spinning blades.
export class Rotor {
  constructor(spec) {
    this.spec = spec;
    this.isRotor = true;
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.45, metalness: 0.3 });
    this.group = new THREE.Group();
    const mast = mergeGeometries([
      colorize(new THREE.CylinderGeometry(0.07, 0.09, 0.05, 8).translate(0, 0.025, 0), '#3a3e45'),
      colorize(new THREE.CylinderGeometry(0.022, 0.026, 0.3, 6).translate(0, 0.17, 0), '#9aa1aa'),
      colorize(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 8).translate(0, 0.33, 0), '#3a3e45'),
    ]);
    const m = new THREE.Mesh(mast, this.material);
    m.castShadow = true;
    this.group.add(m);
    const blades = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const bl = mergeGeometries([
        colorize(new THREE.BoxGeometry(0.78, 0.014, 0.075).translate(0.43, 0, 0), '#2d3036'),
        colorize(new THREE.BoxGeometry(0.1, 0.016, 0.077).translate(0.79, 0, 0), '#f2c230'),
      ]);
      bl.rotateX(0.06).rotateY(a);
      blades.push(bl);
    }
    this.blades = new THREE.Mesh(mergeGeometries(blades), this.material);
    this.blades.position.y = 0.34;
    this.blades.castShadow = true;
    this.group.add(this.blades);
    this.discMat = new THREE.MeshBasicMaterial({ color: '#d7dbe0', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(0.86, 40).rotateX(-Math.PI / 2), this.discMat);
    this.disc.position.y = 0.34;
    this.group.add(this.disc);
    this.omega = 0;
    this.angle = 0;
    this.flapAngle = 0;
    this.onFlap = null;
  }

  update(dt, st) {
    const target = st.flyW > 0.4 ? 30 : 0;
    this.open = damp(this.open || 0, st.flyW > 0.4 || st.pose === 'spread' ? 1 : 0, 5, dt);
    const grow = smoothstep01(this.open);
    this.group.visible = grow > 0.01;
    this.omega = damp(this.omega, target, target > 0 ? 2.2 : 0.7, dt);
    if (this.omega < 0.4 && target === 0) {
      const snap = Math.round(this.angle / ((Math.PI * 2) / 3)) * ((Math.PI * 2) / 3) + Math.PI / 2;
      this.angle = damp(this.angle, snap, 2, dt);
    } else {
      this.angle += this.omega * dt;
    }
    this.blades.rotation.y = this.angle;
    this.discMat.opacity = clamp((this.omega - 12) / 16, 0, 1) * 0.22;
    this.disc.visible = this.discMat.opacity > 0.01;
    this.group.scale.setScalar(Math.max(0.001, grow) * (st.scale || 1));
  }

  prime() {
    this.open = 1;
    this.omega = 30;
    this.angle = 0.5;
  }

  dispose() {
    this.group.traverse((o) => o.geometry && o.geometry.dispose());
    this.material.dispose();
    this.discMat.dispose();
  }
}

// Tom's bat cape: a scalloped membrane fanned out under each arm.
export class Cape {
  constructor(spec) {
    this.spec = spec;
    this.isCape = true;
    const R = 0.62;
    const ribs = 5;
    const a0 = 0.02, a1 = -1.72;
    const pts = [];
    for (let k = 0; k <= ribs * 2; k++) {
      const a = lerp(a0, a1, k / (ribs * 2));
      const r = k % 2 === 0 ? R : R * 0.83;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    const pos = [];
    const col = [];
    const cIn = new THREE.Color('#93439a');
    const cOut = new THREE.Color('#c86fca');
    for (let k = 0; k < pts.length - 1; k++) {
      pos.push(0, 0, 0, pts[k][0], pts[k][1], 0, pts[k + 1][0], pts[k + 1][1], 0);
      col.push(cIn.r, cIn.g, cIn.b, cOut.r, cOut.g, cOut.b, cOut.r, cOut.g, cOut.b);
    }
    const membrane = new THREE.BufferGeometry();
    membrane.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    membrane.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    membrane.computeVertexNormals();
    const parts = [membrane];
    for (let k = 0; k <= ribs * 2; k += 2) {
      const [x, y] = pts[k];
      const len = Math.hypot(x, y);
      const g = colorize(new THREE.BoxGeometry(len, 0.012, 0.012).translate(len / 2, 0, 0).rotateZ(Math.atan2(y, x)), '#6a2770');
      g.computeVertexNormals();
      parts.push(g);
    }
    const cuff = colorize(new THREE.CylinderGeometry(0.028, 0.028, R * 0.98, 6).rotateZ(Math.PI / 2).translate(R * 0.5, 0.005, 0), '#f3efe7');
    cuff.computeVertexNormals();
    parts.push(cuff);
    const geo = mergeGeometries(parts.map((g) => { g.deleteAttribute('normal'); return g; }));
    geo.computeVertexNormals();
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true, roughness: 0.75 });
    this.group = new THREE.Group();
    this.sides = [];
    for (const s of [1, -1]) {
      const side = new THREE.Group();
      side.position.x = s * 0.16;
      side.scale.x = s;
      const flap = new THREE.Group();
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.castShadow = true;
      flap.add(mesh);
      side.add(flap);
      this.group.add(side);
      this.sides.push(flap);
    }
    this.phase = 0;
    this.open = 0;
    this.flapAngle = 0;
    this.lastSin = 0;
    this.onFlap = null;
  }

  update(dt, st) {
    this.open = damp(this.open, st.flyW > 0.5 || st.pose === 'spread' ? 1 : 0, 6, dt);
    const o = this.open;
    this.phase += dt * this.spec.freq * Math.PI * 2 * (1 + Math.max(0, st.vy) * 0.08);
    const sn = Math.sin(this.phase);
    if (o > 0.5 && this.lastSin > 0 && sn <= 0 && this.onFlap) this.onFlap(this.spec.freq);
    this.lastSin = sn;
    this.flapAngle = (0.05 + sn * 0.42) * o;
    for (const f of this.sides) f.rotation.z = this.flapAngle;
    this.group.visible = o > 0.03;
    this.group.scale.set(o, o, 1).multiplyScalar(st.scale || 1);
  }

  prime() {
    this.open = 1;
    this.phase = 0.4;
  }

  dispose() {
    this.group.traverse((o) => o.geometry && o.geometry.dispose());
    this.material.dispose();
  }
}
