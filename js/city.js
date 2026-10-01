import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CITY, terrainHeight } from './noise.js';

// The "Cartoon City" block (ithappy, converted from its Godot demo scene by
// a script: models/city/city.json lists every piece and where it goes).
// Pieces are instanced per model, so 330 placements cost ~one draw call per
// model part. Buildings, cars and props become colliders; sidewalks and car
// roofs can be stood on.

const BASE = 'models/city/';
const SOLID = /^(eco_|regular_|car_\d+$|van$|futuristic_car_1$|bus_stop|fountain|trash_can|traffic_light|spotlight|signboard|billboard_\dx1_0\d$)/;
const STEP = /^set_b_tiles/;

export class City {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.colliders = [];
    this.nightLights = [];
    this.ready = false;
  }

  async load() {
    const data = await (await fetch(BASE + 'city.json')).json();
    const tl = new THREE.TextureLoader();
    const texCache = {};
    const tex = (name) => {
      if (!texCache[name]) {
        const t = tl.load(BASE + name);
        t.colorSpace = THREE.SRGBColorSpace;
        t.flipY = false;
        t.anisotropy = 4;
        texCache[name] = t;
      }
      return texCache[name];
    };
    const materials = {};
    const material = (name, hasColor) => {
      const key = name + (hasColor ? '+vc' : '');
      if (materials[key]) return materials[key];
      const d = data.materials[name.toLowerCase()];
      if (!d) return null;
      const m = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setRGB(d.color[0], d.color[1], d.color[2], THREE.SRGBColorSpace),
        roughness: d.rough,
        metalness: d.metal * 0.5,
        side: THREE.DoubleSide,
        vertexColors: d.vc && hasColor,
      });
      if (d.map) m.map = tex(d.map);
      if (d.alpha) {
        m.transparent = true;
        m.opacity = d.color[3] ?? 1;
        m.depthWrite = d.color[3] >= 1;
        if (name.toLowerCase() !== 'glass') m.alphaTest = 0.4;
      }
      if (d.emissive) {
        m.emissive = new THREE.Color(d.emissive[0], d.emissive[1], d.emissive[2]);
        m.emissiveIntensity = d.emissive[0] > 0.9 ? 0.9 : 0.45;
        if (d.emissiveMap && m.map) m.emissiveMap = m.map;
      }
      materials[key] = m;
      return m;
    };

    const byModel = {};
    for (const p of data.placements) (byModel[p.g] = byModel[p.g] || []).push(p.m);
    const loader = new GLTFLoader();
    const names = Object.keys(byModel);
    const gltfs = await Promise.all(names.map((n) => loader.loadAsync(BASE + n + '.glb')));

    // the pack's road surface sits 0.1 below its origin: lift it just above our ground
    const y0 = terrainHeight(CITY.c[0], CITY.c[1]) + 0.13;
    this.group.position.set(CITY.c[0], y0, CITY.c[1]);
    const M = new THREE.Matrix4();
    const local = new THREE.Matrix4();
    const box = new THREE.Box3();
    names.forEach((name, gi) => {
      const root = gltfs[gi].scene;
      root.updateMatrixWorld(true);
      const list = byModel[name];
      const parts = [];
      root.traverse((o) => { if (o.isMesh) parts.push(o); });
      const night = name.endsWith('_night_light');
      for (const part of parts) {
        const mat = material(part.material.name, !!part.geometry.attributes.color) || part.material;
        const inst = new THREE.InstancedMesh(part.geometry, mat, list.length);
        list.forEach((m, i) => {
          M.set(...m).multiply(local.copy(part.matrixWorld));
          inst.setMatrixAt(i, M);
        });
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        inst.castShadow = SOLID.test(name);
        inst.receiveShadow = true;
        this.group.add(inst);
        if (night) this.nightLights.push(inst);
      }
      // colliders from each placement's bounds
      const solid = SOLID.test(name);
      const step = STEP.test(name);
      if (!solid && !step && !/^palm/.test(name)) return;
      const geoBox = new THREE.Box3();
      for (const part of parts) {
        part.geometry.computeBoundingBox();
        geoBox.union(part.geometry.boundingBox.clone().applyMatrix4(part.matrixWorld));
      }
      for (const m of list) {
        M.set(...m);
        box.copy(geoBox).applyMatrix4(M);
        if (/^palm/.test(name)) {
          const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
          box.min.set(cx - 0.35, box.min.y, cz - 0.35);
          box.max.set(cx + 0.35, 99, cz + 0.35);
        }
        this.colliders.push({
          x0: box.min.x + CITY.c[0], x1: box.max.x + CITY.c[0],
          z0: box.min.z + CITY.c[1], z1: box.max.z + CITY.c[1],
          top: y0 + box.max.y, step,
        });
      }
    });
    this.scene.add(this.group);
    this.ready = true;
  }

  update(night) {
    for (const m of this.nightLights) m.visible = night > 0.35;
  }
}
