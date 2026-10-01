import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TOWN, CITY, terrainHeight, rng, hash2, townCenter } from './noise.js';
import { roundTree } from './props.js';

// Little towns: houses, street lamps and parked cars laid out on the street
// grid that terrain.js paints. Everything is instanced; only towns near the
// player are populated.

function vc(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const col = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}
const box = (w, h, d, x, y, z, hex) => vc(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);

function tri(a, b, c, hex) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
  g.computeVertexNormals();
  return vc(g, hex);
}

const TEMPLATES = [
  { w: 9, d: 7.5, h: 5.2, floors: 1, roofH: 3.4 },
  { w: 10, d: 8, h: 8.4, floors: 2, roofH: 3.8 },
  { w: 13, d: 7.5, h: 5.0, floors: 1, roofH: 3.0 },
  { w: 6.5, d: 6, h: 4.4, floors: 1, roofH: 2.6 },
];

function houseGeometries(T) {
  const { w, d, h, roofH } = T;
  const body = [box(w, h, d, 0, h / 2, 0, '#ffffff'), box(w + 0.3, 0.6, d + 0.3, 0, 0.3, 0, '#c9c2b6')];
  // gable ends
  for (const s of [-1, 1]) {
    const x = (s * w) / 2;
    body.push(s > 0 ? tri([x, h, d / 2], [x, h, -d / 2], [x, h + roofH, 0], '#ffffff') : tri([x, h, -d / 2], [x, h, d / 2], [x, h + roofH, 0], '#ffffff'));
  }
  const doorX = w > 11 ? -w * 0.25 : 0;
  body.push(box(1.5, 2.6, 0.2, doorX, 1.3 + 0.3, d / 2 + 0.05, '#5b3b27'));
  body.push(box(2.4, 0.3, 1.2, doorX, 0.15, d / 2 + 0.6, '#9c978e'));
  body.push(box(0.9, 2.4, 0.9, w * 0.25, h + roofH * 0.6, -d * 0.18, '#a0604c'));

  const win = [];
  const frames = [];
  for (let f = 0; f < T.floors; f++) {
    const y = 0.6 + f * 3.2 + 1.9;
    const xs = [];
    for (let x = -w / 2 + 1.8; x <= w / 2 - 1.7; x += 2.6) if (Math.abs(x - doorX) > 1.8 || f > 0) xs.push(x);
    for (const x of xs) {
      for (const s of [-1, 1]) {
        win.push(box(1.3, 1.4, 0.14, x, y, s * (d / 2 + 0.04), '#2c3a4c'));
        frames.push(box(1.6, 1.7, 0.08, x, y, s * (d / 2 + 0.01), '#f4f1ea'));
      }
    }
    for (const s of [-1, 1]) {
      win.push(box(0.14, 1.4, 1.3, s * (w / 2 + 0.04), y, 0, '#2c3a4c'));
      frames.push(box(0.08, 1.7, 1.6, s * (w / 2 + 0.01), y, 0, '#f4f1ea'));
    }
  }
  body.push(...frames);

  const o = 0.7;
  const x0 = -w / 2 - o, x1 = w / 2 + o, z0 = -d / 2 - o, z1 = d / 2 + o;
  const yE = h - o * (roofH / (d / 2)), yR = h + roofH;
  const slope = (za) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      x0, yE, za, x1, yE, za, x1, yR, 0,
      x0, yE, za, x1, yR, 0, x0, yR, 0,
    ], 3));
    if (za < 0) g.scale(1, 1, 1);
    g.computeVertexNormals();
    return vc(g, '#ffffff');
  };
  const roof = mergeGeometries([slope(z1), slope(z0), box(w + o * 2 + 0.2, 0.35, 0.5, 0, yR, 0, '#dddddd')]);
  return { body: mergeGeometries(body), windows: mergeGeometries(win), roof };
}

function lampGeometries() {
  const pole = mergeGeometries([
    vc(new THREE.CylinderGeometry(0.11, 0.15, 5, 6).translate(0, 2.5, 0), '#33363b'),
    box(0.12, 0.12, 1.3, 0, 4.9, 0.6, '#33363b'),
    vc(new THREE.CylinderGeometry(0.3, 0.35, 0.4, 6).translate(0, 0.2, 0), '#33363b'),
  ]);
  const head = vc(new THREE.CylinderGeometry(0.22, 0.4, 0.45, 6).translate(0, 4.75, 1.2), '#fff2c8');
  return { pole, head };
}

function carGeometry() {
  const wheels = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      wheels.push(vc(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 8).rotateZ(Math.PI / 2).translate(sx * 0.85, 0.42, sz * 1.35), '#1d1e21'));
    }
  }
  return mergeGeometries([
    box(1.9, 0.75, 4.3, 0, 0.8, 0, '#ffffff'),
    box(1.7, 0.7, 2.2, 0, 1.5, -0.2, '#ffffff'),
    box(1.72, 0.55, 2.05, 0, 1.52, -0.2, '#2b3542'),
    box(1.6, 0.18, 0.1, 0, 0.9, 2.16, '#fff3c4'),
    box(1.6, 0.18, 0.1, 0, 0.9, -2.16, '#c2403a'),
    ...wheels,
  ]);
}

const WALLS = ['#f2e6d0', '#e9d4c0', '#d6e1e8', '#f1dcc6', '#e3e8d2', '#f3d8d0', '#ddd6ea', '#fff4e2', '#cfe3d9'];
const ROOFS = ['#a8463a', '#7c4b36', '#4e5e72', '#5e6f44', '#8c3b3b', '#6c5a4e', '#3f4a59'];
const CARS = ['#c8423a', '#3c6fb4', '#e6c34a', '#f1f1ee', '#4b8a5a', '#2d2f33', '#e48a3c', '#8fb4d9'];

export class Towns {
  constructor(scene) {
    this.scene = scene;
    this.key = '';
    this.colliders = [];
    this.extra = []; // colliders from the city block
    this.lamps = [];
    this.wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, side: THREE.DoubleSide });
    this.roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, side: THREE.DoubleSide });
    this.glassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.1, emissive: new THREE.Color('#ffc46b'), emissiveIntensity: 0 });
    this.lampMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: new THREE.Color('#ffd98a'), emissiveIntensity: 0 });
    this.solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7 });
    const inst = (geo, mat, cap, shadow = true) => {
      const m = new THREE.InstancedMesh(geo, mat, cap);
      m.castShadow = shadow;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      scene.add(m);
      return m;
    };
    this.houses = TEMPLATES.map((T) => {
      const g = houseGeometries(T);
      return { T, body: inst(g.body, this.wallMat, 120), windows: inst(g.windows, this.glassMat, 120, false), roof: inst(g.roof, this.roofMat, 120) };
    });
    const lg = lampGeometries();
    this.lampPole = inst(lg.pole, this.solidMat, 300);
    this.lampHead = inst(lg.head, this.lampMat, 300, false);
    this.cars = inst(carGeometry(), this.solidMat, 160);
    this.trees = inst(roundTree(), this.solidMat, 200);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  update(focus, night) {
    const S = TOWN.S;
    const [nx, nz] = townCenter(focus.x, focus.z);
    const list = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = nx + dx * S, cz = nz + dz * S;
        // the first town is the Cartoon City block (city.js)
        if (cx === CITY.c[0] && cz === CITY.c[1]) continue;
        if (Math.hypot(cx - focus.x, cz - focus.z) < 290) list.push([cx, cz]);
      }
    }
    const key = list.map((c) => c.join(',')).join(';');
    if (key !== this.key) {
      this.key = key;
      this.rebuild(list);
    }
    this.glassMat.emissiveIntensity = night * 1.2;
    this.lampMat.emissiveIntensity = 0.1 + night * 2.5;
  }

  rebuild(list) {
    const counts = new Map();
    const put = (mesh, x, y, z, rotY, scale, color) => {
      const i = counts.get(mesh) || 0;
      if (i >= mesh.instanceMatrix.count) return;
      this._p.set(x, y, z);
      this._e.set(0, rotY, 0);
      this._q.setFromEuler(this._e);
      this._s.set(scale, scale, scale);
      this._m.compose(this._p, this._q, this._s);
      mesh.setMatrixAt(i, this._m);
      if (color) mesh.setColorAt(i, color);
      counts.set(mesh, i + 1);
    };
    this.colliders.length = 0;
    const R = TOWN.R, G = TOWN.grid;
    const lines = [];
    for (let v = -Math.floor(R / G) * G; v <= R; v += G) if (Math.abs(v) < R) lines.push(v);
    const edges = [-R, ...lines, R];
    const margin = (v) => (lines.includes(v) ? TOWN.road + TOWN.walk + 1.2 : 1.5);

    for (const [cx, cz] of list) {
      const r = rng(hash2(Math.round(cx / 10), Math.round(cz / 10)) + 17);
      const y0 = terrainHeight(cx, cz);
      // houses, block by block
      for (let bx = 0; bx < edges.length - 1; bx++) {
        for (let bz = 0; bz < edges.length - 1; bz++) {
          const ax = edges[bx] + margin(edges[bx]), bxx = edges[bx + 1] - margin(edges[bx + 1]);
          const az = edges[bz] + margin(edges[bz]), bzz = edges[bz + 1] - margin(edges[bz + 1]);
          const W = bxx - ax, D = bzz - az;
          const nX = W > 20 ? 2 : 1, nZ = D > 20 ? 2 : 1;
          for (let i = 0; i < nX; i++) {
            for (let j = 0; j < nZ; j++) {
              const c0x = ax + (W / nX) * i, c1x = c0x + W / nX;
              const c0z = az + (D / nZ) * j, c1z = c0z + D / nZ;
              const ccx = (c0x + c1x) / 2, ccz = (c0z + c1z) / 2;
              const cw = c1x - c0x, cd = c1z - c0z;
              // face the closest street
              const sides = [];
              if (lines.includes(edges[bx]) && i === 0) sides.push([c0x - edges[bx], -Math.PI / 2, -1, 0]);
              if (lines.includes(edges[bx + 1]) && i === nX - 1) sides.push([edges[bx + 1] - c1x, Math.PI / 2, 1, 0]);
              if (lines.includes(edges[bz]) && j === 0) sides.push([c0z - edges[bz], Math.PI, 0, -1]);
              if (lines.includes(edges[bz + 1]) && j === nZ - 1) sides.push([edges[bz + 1] - c1z, 0, 0, 1]);
              if (!sides.length) sides.push([0, 0, 0, 1]);
              sides.sort((a, b) => a[0] - b[0]);
              const [, rotY, fx, fz] = sides[0];
              const sideways = fx !== 0;
              const fitW = sideways ? cd : cw;
              const fitD = sideways ? cw : cd;
              const ok = this.houses.filter((h) => h.T.w + 1.6 <= fitW && h.T.d + 2.8 <= fitD);
              const wx = cx + ccx, wz = cz + ccz;
              if (!ok.length || r() < 0.12) {
                this._c.setScalar(0.85 + r() * 0.3);
                put(this.trees, wx + (r() - 0.5) * 3, y0, wz + (r() - 0.5) * 3, r() * 6, 0.7 + r() * 0.3, this._c);
                this.colliders.push({ x0: wx - 0.4, x1: wx + 0.4, z0: wz - 0.4, z1: wz + 0.4, top: 99 });
                continue;
              }
              const h = ok[Math.floor(r() * ok.length)];
              const s = 0.92 + r() * 0.12;
              // push the house toward its street, leave a back garden
              const push = Math.max(0, (fitD - h.T.d * s) / 2 - 1.4);
              const hx = wx + fx * push, hz = wz + fz * push;
              put(h.body, hx, y0, hz, rotY, s, this._c.set(WALLS[Math.floor(r() * WALLS.length)]));
              put(h.windows, hx, y0, hz, rotY, s, this._c.set('#ffffff'));
              put(h.roof, hx, y0, hz, rotY, s, this._c.set(ROOFS[Math.floor(r() * ROOFS.length)]));
              const hw = ((sideways ? h.T.d : h.T.w) * s) / 2 + 0.3;
              const hd = ((sideways ? h.T.w : h.T.d) * s) / 2 + 0.3;
              this.colliders.push({ x0: hx - hw, x1: hx + hw, z0: hz - hd, z1: hz + hd, top: y0 + (h.T.h + h.T.roofH) * s });
              if (r() < 0.55) {
                const tx = hx - fx * (hd + 2.5) + (fx === 0 ? (r() - 0.5) * hw : 0);
                const tz = hz - fz * (hd + 2.5) + (fz === 0 ? 0 : 0) + (fz === 0 ? (r() - 0.5) * hd : 0);
                this._c.setScalar(0.85 + r() * 0.3);
                put(this.trees, tx, y0, tz, r() * 6, 0.55 + r() * 0.3, this._c);
              }
            }
          }
        }
      }
      // street lamps and parked cars along every street
      for (const v of lines) {
        for (let u = -R + 8; u <= R - 8; u += 16) {
          if (lines.some((l) => Math.abs(u - l) < 8)) continue;
          for (const side of [-1, 1]) {
            const off = side * (TOWN.road + TOWN.walk * 0.6);
            // street along z at x = v
            const lx = cx + v + off, lz = cz + u + side * 4;
            put(this.lampPole, lx, y0, lz, side > 0 ? -Math.PI / 2 : Math.PI / 2, 1);
            put(this.lampHead, lx, y0, lz, side > 0 ? -Math.PI / 2 : Math.PI / 2, 1);
            this.colliders.push({ x0: lx - 0.2, x1: lx + 0.2, z0: lz - 0.2, z1: lz + 0.2, top: 99 });
            // street along x at z = v
            const mx = cx + u - side * 4, mz = cz + v + off;
            put(this.lampPole, mx, y0, mz, side > 0 ? Math.PI : 0, 1);
            put(this.lampHead, mx, y0, mz, side > 0 ? Math.PI : 0, 1);
            this.colliders.push({ x0: mx - 0.2, x1: mx + 0.2, z0: mz - 0.2, z1: mz + 0.2, top: 99 });
            if (r() < 0.35) {
              const px = cx + v + side * (TOWN.road - 1.3), pz = cz + u + 8 * (r() - 0.5);
              put(this.cars, px, y0, pz, side > 0 ? 0 : Math.PI, 1, this._c.set(CARS[Math.floor(r() * CARS.length)]));
              this.colliders.push({ x0: px - 1.05, x1: px + 1.05, z0: pz - 2.25, z1: pz + 2.25, top: y0 + 1.9 });
            }
            if (r() < 0.35) {
              const qx = cx + u + 8 * (r() - 0.5), qz = cz + v + side * (TOWN.road - 1.3);
              put(this.cars, qx, y0, qz, side > 0 ? Math.PI / 2 : -Math.PI / 2, 1, this._c.set(CARS[Math.floor(r() * CARS.length)]));
              this.colliders.push({ x0: qx - 2.25, x1: qx + 2.25, z0: qz - 1.05, z1: qz + 1.05, top: y0 + 1.9 });
            }
          }
        }
      }
    }
    const all = [this.lampPole, this.lampHead, this.cars, this.trees];
    for (const h of this.houses) all.push(h.body, h.windows, h.roof);
    for (const m of all) {
      m.count = counts.get(m) || 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  // Push a circle out of houses, cars and lamps. Returns the roof/car top the
  // cat may stand on, or -Infinity.
  collide(pos, radius, feetY) {
    let top = -Infinity;
    for (const list of [this.colliders, this.extra]) {
      for (const c of list) {
        if (pos.x < c.x0 - radius || pos.x > c.x1 + radius || pos.z < c.z0 - radius || pos.z > c.z1 + radius) continue;
        const inside = pos.x > c.x0 && pos.x < c.x1 && pos.z > c.z0 && pos.z < c.z1;
        // sidewalks and kerbs: always walk up onto them
        if (c.step || feetY > c.top - 0.15) {
          if (inside && c.top < 50) top = Math.max(top, c.top);
          continue;
        }
        const px = Math.max(c.x0, Math.min(pos.x, c.x1));
        const pz = Math.max(c.z0, Math.min(pos.z, c.z1));
        const dx = pos.x - px, dz = pos.z - pz;
        const d = Math.hypot(dx, dz);
        if (d > 0.0001) {
          if (d < radius) {
            pos.x = px + (dx / d) * radius;
            pos.z = pz + (dz / d) * radius;
          }
        } else {
          // centre is inside the box: leave by the nearest face
          const opts = [[pos.x - c.x0, -1, 0], [c.x1 - pos.x, 1, 0], [pos.z - c.z0, 0, -1], [c.z1 - pos.z, 0, 1]].sort((a, b) => a[0] - b[0]);
          const [, sx, sz] = opts[0];
          if (sx < 0) pos.x = c.x0 - radius;
          if (sx > 0) pos.x = c.x1 + radius;
          if (sz < 0) pos.z = c.z0 - radius;
          if (sz > 0) pos.z = c.z1 + radius;
        }
      }
    }
    return top;
  }

  // Keep the camera out of buildings by pulling it toward the target.
  fixCamera(target, cam) {
    const hit = (c, p) => !c.step && c.top < 50 && p.y < c.top && p.x > c.x0 - 0.3 && p.x < c.x1 + 0.3 && p.z > c.z0 - 0.3 && p.z < c.z1 + 0.3;
    const inside = (p) => this.colliders.some((c) => hit(c, p)) || this.extra.some((c) => hit(c, p));
    if (!inside(cam)) return;
    const start = cam.clone();
    for (let t = 0.95; t > 0.05; t -= 0.05) {
      cam.lerpVectors(target, start, t);
      if (!inside(cam)) return;
    }
  }
}
