import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { terrainHeight, rng, hash2, townMask, roadMask } from './noise.js';

// Trees, rocks, bushes and flowers placed deterministically per chunk so
// the world is the same every time you walk back to a spot.

function colored(geo, hex, jitter = 0, seed = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const r = rng(seed);
  for (let i = 0; i < n; i += 3) {
    const k = 1 + (r() - 0.5) * jitter;
    for (let j = 0; j < 3; j++) {
      col[(i + j) * 3] = c.r * k;
      col[(i + j) * 3 + 1] = c.g * k;
      col[(i + j) * 3 + 2] = c.b * k;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const key of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(key)) g.deleteAttribute(key);
  return g;
}

function jitterGeo(geo, amount, seed) {
  const r = rng(seed);
  const p = geo.attributes.position;
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!map.has(key)) map.set(key, [(r() - 0.5) * amount, (r() - 0.5) * amount, (r() - 0.5) * amount]);
    const d = map.get(key);
    p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  geo.computeVertexNormals();
  return geo;
}

export function roundTree() {
  const trunk = colored(new THREE.CylinderGeometry(0.16, 0.28, 3.4, 6).translate(0, 1.7, 0), '#3b2a1c', 0.2, 1);
  const c1 = jitterGeo(new THREE.IcosahedronGeometry(1.9, 0), 0.5, 2).scale(1.25, 0.72, 1.25).translate(0, 3.7, 0);
  const c2 = jitterGeo(new THREE.IcosahedronGeometry(1.3, 0), 0.4, 3).scale(1.2, 0.8, 1.2).translate(0.6, 4.4, -0.3);
  return mergeGeometries([trunk, colored(c1, '#3f4a1f', 0.25, 4), colored(c2, '#4a5524', 0.25, 5)]);
}

function pineTree() {
  const parts = [colored(new THREE.CylinderGeometry(0.14, 0.24, 2.2, 6).translate(0, 1.1, 0), '#3a281b', 0.2, 6)];
  const tiers = [
    [1.9, 2.4, 2.2],
    [1.5, 2.0, 3.4],
    [1.05, 1.7, 4.5],
    [0.6, 1.3, 5.4],
  ];
  tiers.forEach(([r, h, y], i) => parts.push(colored(new THREE.ConeGeometry(r, h, 7).translate(0, y, 0), i % 2 ? '#2b3d1e' : '#2f4321', 0.25, 7 + i)));
  return mergeGeometries(parts);
}

function birchTree() {
  const trunk = colored(new THREE.CylinderGeometry(0.11, 0.17, 4.2, 6).translate(0, 2.1, 0), '#c9c2b2', 0.15, 11);
  const c1 = jitterGeo(new THREE.IcosahedronGeometry(1.25, 0), 0.4, 12).scale(1, 1.35, 1).translate(0, 4.6, 0);
  const c2 = jitterGeo(new THREE.IcosahedronGeometry(0.9, 0), 0.3, 13).translate(-0.5, 3.8, 0.4);
  return mergeGeometries([trunk, colored(c1, '#6b7a2c', 0.25, 14), colored(c2, '#7a8530', 0.25, 15)]);
}

function rock() {
  return colored(jitterGeo(new THREE.DodecahedronGeometry(1, 0), 0.45, 21).scale(1, 0.62, 1), '#77736a', 0.3, 22);
}

function bush() {
  const a = jitterGeo(new THREE.IcosahedronGeometry(0.75, 0), 0.25, 31).scale(1.2, 0.75, 1.1).translate(0, 0.35, 0);
  const b = jitterGeo(new THREE.IcosahedronGeometry(0.5, 0), 0.2, 32).translate(0.55, 0.3, 0.2);
  return mergeGeometries([colored(a, '#34451c', 0.3, 33), colored(b, '#3e5021', 0.3, 34)]);
}

function flower() {
  const stem = colored(new THREE.CylinderGeometry(0.008, 0.01, 0.5, 3).translate(0, 0.25, 0), '#3d5a1c', 0, 41);
  const head = colored(new THREE.OctahedronGeometry(0.055, 0).scale(1.4, 0.5, 1.4).translate(0, 0.52, 0), '#ffffff', 0.15, 42);
  const eye = colored(new THREE.OctahedronGeometry(0.022, 0).translate(0, 0.545, 0), '#f2c230', 0, 43);
  return mergeGeometries([stem, head, eye]);
}

const TYPES = [
  { key: 'round', geo: roundTree, cap: 700, shadow: true, collide: 0.45 },
  { key: 'pine', geo: pineTree, cap: 500, shadow: true, collide: 0.4 },
  { key: 'birch', geo: birchTree, cap: 500, shadow: true, collide: 0.3 },
  { key: 'rock', geo: rock, cap: 900, shadow: true, collide: 0.85 },
  { key: 'bush', geo: bush, cap: 900, shadow: true, collide: 0 },
  { key: 'flower', geo: flower, cap: 9000, shadow: false, collide: 0 },
];

const FLOWER_COLORS = ['#ffffff', '#f7e27a', '#f2a3c4', '#b99cf0', '#ffffff', '#f6c75a', '#e8f0ff'];

export class Props {
  constructor(scene) {
    this.chunk = 48;
    this.radius = 3;
    this.meshes = {};
    this.colliders = [];
    this.flowerSpots = [];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92 });
    for (const t of TYPES) {
      const m = new THREE.InstancedMesh(t.geo(), mat, t.cap);
      m.castShadow = t.shadow;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(t.cap * 3), 3);
      scene.add(m);
      this.meshes[t.key] = m;
    }
    this.cx = null;
    this.cz = null;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  update(focus) {
    const cx = Math.floor(focus.x / this.chunk);
    const cz = Math.floor(focus.z / this.chunk);
    if (cx === this.cx && cz === this.cz) return;
    this.cx = cx;
    this.cz = cz;
    this.rebuild();
  }

  rebuild() {
    const counts = {};
    for (const t of TYPES) counts[t.key] = 0;
    this.colliders.length = 0;
    this.flowerSpots.length = 0;
    const put = (key, x, z, s, rotY, tilt, color, sink = 0.15) => {
      if (townMask(x, z) > 0.02 || roadMask(x, z, true)) return false;
      const mesh = this.meshes[key];
      const i = counts[key];
      if (i >= mesh.instanceMatrix.count) return;
      this._p.set(x, terrainHeight(x, z) - sink * s, z);
      this._e.set(tilt, rotY, tilt * 0.6);
      this._q.setFromEuler(this._e);
      this._s.set(s, s, s);
      this._m.compose(this._p, this._q, this._s);
      mesh.setMatrixAt(i, this._m);
      mesh.setColorAt(i, color);
      counts[key] = i + 1;
      return true;
    };
    const C = this.chunk;
    for (let dz = -this.radius; dz <= this.radius; dz++) {
      for (let dx = -this.radius; dx <= this.radius; dx++) {
        const gx = this.cx + dx;
        const gz = this.cz + dz;
        const r = rng(hash2(gx, gz));
        const x0 = gx * C;
        const z0 = gz * C;
        const near = Math.abs(dx) <= 1 && Math.abs(dz) <= 1;
        const forest = r();
        const trees = Math.floor(r() * 3 + (forest > 0.75 ? 6 : 0));
        for (let i = 0; i < trees; i++) {
          const x = x0 + r() * C;
          const z = z0 + r() * C;
          if (x * x + z * z < 64) continue;
          const kind = r();
          const key = kind < 0.5 ? 'round' : kind < 0.78 ? 'pine' : 'birch';
          const s = 0.8 + r() * 0.7;
          this._c.setScalar(0.85 + r() * 0.3);
          if (put(key, x, z, s, r() * 6.28, (r() - 0.5) * 0.08, this._c, 0.05)) this.colliders.push({ x, z, r: TYPES.find((t) => t.key === key).collide * s, h: 99 });
        }
        const rocks = Math.floor(r() * 4);
        for (let i = 0; i < rocks; i++) {
          const x = x0 + r() * C;
          const z = z0 + r() * C;
          if (x * x + z * z < 16) continue;
          const s = 0.25 + r() * r() * 1.6;
          this._c.setScalar(0.8 + r() * 0.35);
          if (put('rock', x, z, s, r() * 6.28, (r() - 0.5) * 0.4, this._c, 0.25)) this.colliders.push({ x, z, r: 0.85 * s, h: 0.62 * s * 0.75 });
        }
        const bushes = Math.floor(r() * 4);
        for (let i = 0; i < bushes; i++) {
          const x = x0 + r() * C;
          const z = z0 + r() * C;
          this._c.setScalar(0.8 + r() * 0.4);
          put('bush', x, z, 0.6 + r() * 0.8, r() * 6.28, 0, this._c, 0.1);
        }
        // flower patches
        const patches = Math.floor(r() * 3) + (near ? 2 : 1);
        for (let p = 0; p < patches; p++) {
          const px = x0 + r() * C;
          const pz = z0 + r() * C;
          const col = FLOWER_COLORS[Math.floor(r() * FLOWER_COLORS.length)];
          const n = 20 + Math.floor(r() * 50);
          const spread = 2 + r() * 5;
          this.flowerSpots.push({ x: px, z: pz });
          for (let i = 0; i < n; i++) {
            const a = r() * 6.28;
            const d = Math.sqrt(r()) * spread;
            this._c.set(col).multiplyScalar(0.85 + r() * 0.3);
            put('flower', px + Math.cos(a) * d, pz + Math.sin(a) * d, 0.7 + r() * 0.6, r() * 6.28, (r() - 0.5) * 0.3, this._c, 0.0);
          }
        }
      }
    }
    for (const t of TYPES) {
      const m = this.meshes[t.key];
      m.count = counts[t.key];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  // Push a circle (x,z,radius) out of solid props. Returns the height of a
  // rock top the cat may stand on, or -Infinity.
  collide(pos, radius, feetY) {
    let top = -Infinity;
    for (const c of this.colliders) {
      const dx = pos.x - c.x;
      const dz = pos.z - c.z;
      const rr = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      const ground = terrainHeight(c.x, c.z);
      const rockTop = ground + c.h;
      if (c.h < 50 && feetY > rockTop - 0.12) {
        if (d2 < (c.r * 0.8) ** 2) top = Math.max(top, rockTop);
        continue;
      }
      const d = Math.sqrt(d2) || 0.001;
      pos.x = c.x + (dx / d) * rr;
      pos.z = c.z + (dz / d) * rr;
    }
    return top;
  }
}
