import * as THREE from 'three';
import { TERRAIN_GLSL, NOISE_GLSL } from './noise.js';

// An endless rolling meadow: a grid that follows the player in whole-cell
// steps, displaced on the GPU by the shared terrain height function.
export class Terrain {
  constructor(scene) {
    const size = 640;
    const segs = 320;
    this.step = size / segs;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    this.uniforms = { uOffset: { value: new THREE.Vector2() }, uWet: { value: 0 } };
    this.material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, flatShading: true });
    this.material.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, this.uniforms);
      s.vertexShader = s.vertexShader
        .replace('#include <common>', `#include <common>\nuniform vec2 uOffset;\nvarying vec3 vTerrainP;\n${TERRAIN_GLSL}`)
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = vec3(position.x + uOffset.x, 0.0, position.z + uOffset.y);
           transformed.y = terrainH(transformed.xz);
           vTerrainP = transformed;`
        );
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform float uWet;\nvarying vec3 vTerrainP;\n${NOISE_GLSL}\n${TERRAIN_GLSL}`)
        .replace(
          '#include <color_fragment>',
          `float n1 = vnoise(vTerrainP.xz * 0.03);
           float n2 = vnoise(vTerrainP.xz * 0.17 + 7.3);
           vec3 cDark = vec3(0.09, 0.15, 0.035);
           vec3 cMid = vec3(0.17, 0.25, 0.055);
           vec3 cDry = vec3(0.36, 0.31, 0.11);
           vec3 cDirt = vec3(0.19, 0.13, 0.07);
           vec3 col = mix(cDark, cMid, n2);
           col = mix(col, cDry, smoothstep(0.55, 0.85, n1) * 0.65);
           col = mix(col, cDirt, smoothstep(0.72, 0.9, n2 * 0.6 + n1 * 0.5) * 0.55);
           // towns: mown lawns, sidewalks, asphalt with a centre line
           float tm = townMask(vTerrainP.xz);
           vec3 ri = roadInfo(vTerrainP.xz);
           col = mix(col, vec3(0.13, 0.22, 0.05) * (0.9 + 0.2 * n2), smoothstep(0.3, 0.9, tm));
           vec3 walk = mix(vec3(0.24, 0.19, 0.12), vec3(0.34, 0.33, 0.31), step(0.5, tm));
           col = mix(col, walk, ri.y);
           vec3 asphalt = vec3(0.085, 0.087, 0.092) * (0.85 + 0.3 * n2);
           asphalt = mix(asphalt, vec3(0.62, 0.62, 0.6), (1.0 - smoothstep(0.08, 0.14, abs(ri.z - ROAD_W + 0.45))) * 0.8);
           asphalt = mix(asphalt, vec3(0.75, 0.66, 0.32), 1.0 - smoothstep(0.08, 0.14, ri.z));
           col = mix(col, asphalt, ri.x);
           col *= 1.0 - uWet * 0.3;
           diffuseColor.rgb = col;`
        );
    };
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
  }

  update(focus, wet) {
    const s = this.step;
    this.uniforms.uOffset.value.set(Math.round(focus.x / s) * s, Math.round(focus.z / s) * s);
    this.uniforms.uWet.value = wet;
  }
}
