import * as THREE from 'three';
import { TERRAIN_GLSL, NOISE_GLSL, rng } from './noise.js';

// GPU grass: one tapered blade geometry drawn tens of thousands of times.
// Instances live on a square patch that wraps around the player, so the
// meadow never ends. Wind, the cat brushing through, and backlit
// translucency are all done in the shader.
export class Grass {
  constructor({ patch, maxCount, height, width, segments = 4, seed = 1, ao = 0.4 }) {
    this.maxCount = maxCount;
    const pos = [];
    const idx = [];
    for (let i = 0; i < segments; i++) {
      const t = i / segments;
      pos.push(-0.5, t, 0, 0.5, t, 0);
    }
    pos.push(0, 1, 0);
    for (let i = 0; i < segments - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const last = (segments - 1) * 2;
    idx.push(last, last + 1, segments * 2);

    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));

    const r = rng(seed);
    const off = new Float32Array(maxCount * 4);
    const vr = new Float32Array(maxCount * 4);
    for (let i = 0; i < maxCount; i++) {
      off[i * 4] = r() * patch;
      off[i * 4 + 1] = r() * patch;
      off[i * 4 + 2] = r() * Math.PI * 2;
      off[i * 4 + 3] = 0.55 + r() * 0.9;
      vr[i * 4] = r();
      vr[i * 4 + 1] = 0.7 + r() * 0.6;
      vr[i * 4 + 2] = 0.05 + r() * 0.4;
      vr[i * 4 + 3] = r();
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 4));
    geo.setAttribute('aVar', new THREE.InstancedBufferAttribute(vr, 4));
    geo.instanceCount = maxCount;
    this.geometry = geo;

    this.uniforms = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector2() },
      uCat: { value: new THREE.Vector3(0, 0, 0) },
      uCatR: { value: 0.55 },
      uMice: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
      uWind: { value: 0.6 },
      uPatch: { value: patch },
      uH: { value: height },
      uW: { value: width },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(0, 0, 0) },
      uBase: { value: new THREE.Color(0.03, 0.06, 0.012) },
      uTip: { value: new THREE.Color(0.22, 0.36, 0.06) },
      uDry: { value: new THREE.Color(0.5, 0.42, 0.13) },
      uAO: { value: ao },
    };

    const mat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
    mat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, this.uniforms);
      s.vertexShader = s.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime, uCatR, uWind, uPatch, uH, uW;
          uniform vec2 uCenter;
          uniform vec3 uCat;
          uniform vec3 uMice[8];
          attribute vec4 aOffset;
          attribute vec4 aVar;
          varying float vGT;
          varying float vGVar;
          varying float vGDry;
          varying vec3 vGWorld;
          ${TERRAIN_GLSL}
          ${NOISE_GLSL}`
        )
        .replace(
          '#include <beginnormal_vertex>',
          `vec2 gBase = uCenter + mod(aOffset.xy - uCenter + uPatch * 0.5, uPatch) - uPatch * 0.5;
          float gDist = length(gBase - uCenter);
          float gFade = 1.0 - smoothstep(uPatch * 0.3, uPatch * 0.5, gDist);
          float gClump = vnoise(gBase * 0.13);
          float gH = uH * aOffset.w * gFade * (0.5 + 0.95 * gClump);
          gH *= (1.0 - roadInfo(gBase).y) * mix(1.0, 0.4, townMask(gBase)) * (1.0 - smoothstep(0.6, 0.95, cityMask(gBase)));
          // blades right in front of the lens shrink away so they never wall off the view
          float gCamNear = 1.0 - smoothstep(0.4, 2.2, length(gBase - cameraPosition.xz));
          float gCamLow = 1.0 - smoothstep(0.7, 1.3, cameraPosition.y - terrainH(gBase));
          gH *= 1.0 - gCamNear * gCamLow;
          float gT = position.y;
          float gW = uW * aVar.y * (1.0 - gT * 0.75);
          vec2 gDir = vec2(cos(aOffset.z), sin(aOffset.z));
          vec2 gSide = vec2(-gDir.y, gDir.x);
          float gGust = vnoise(gBase * 0.035 + vec2(uTime * 0.35, uTime * 0.12));
          float gWave = sin(uTime * 2.3 + dot(gBase, vec2(0.45, 0.22)) + aVar.x * 3.0);
          vec2 gBend = gDir * aVar.z + vec2(0.89, 0.45) * uWind * (0.12 + 0.75 * gGust + 0.16 * gWave);
          vec2 gToCat = gBase - uCat.xy;
          float gCd = length(gToCat);
          float gPush = (1.0 - smoothstep(0.1, uCatR, gCd)) * uCat.z;
          gBend += gToCat / (gCd + 0.001) * gPush * 1.8;
          for (int i = 0; i < 8; i++) {
            vec2 gToM = gBase - uMice[i].xy;
            float gMd = length(gToM);
            gBend += gToM / (gMd + 0.001) * (1.0 - smoothstep(0.05, 0.42, gMd)) * uMice[i].z * 1.6;
          }
          float gBL = length(gBend);
          if (gBL > 1.5) { gBend *= 1.5 / gBL; gBL = 1.5; }
          float gCurve = gT * gT;
          vec3 gPos;
          gPos.xz = gBase + gSide * position.x * gW + gBend * gCurve * gH;
          gPos.y = terrainH(gBase) - 0.03 + gT * gH * (1.0 - 0.33 * gBL * gCurve);
          vec3 objectNormal = normalize(mix(vec3(gDir.x, 0.0, gDir.y), vec3(0.0, 1.0, 0.0), 0.6));
          vGT = gT;
          vGVar = aVar.w;
          vGDry = smoothstep(0.55, 0.9, vnoise(gBase * 0.03 + 11.0));
          vGWorld = gPos;`
        )
        .replace('#include <begin_vertex>', 'vec3 transformed = gPos;');

      s.fragmentShader = s.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec3 uSunDir, uSunColor, uBase, uTip, uDry;
          uniform float uAO;
          varying float vGT;
          varying float vGVar;
          varying float vGDry;
          varying vec3 vGWorld;`
        )
        .replace(
          '#include <color_fragment>',
          `vec3 gCol = mix(uBase, uTip, smoothstep(0.0, 1.0, vGT));
          gCol = mix(gCol, mix(uBase * 1.6, uDry, vGT), vGDry * 0.7);
          gCol *= 0.78 + 0.44 * vGVar;
          gCol *= mix(uAO, 1.0, smoothstep(0.0, 0.55, vGT));
          diffuseColor.rgb = gCol;`
        )
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
        .replace(
          '#include <opaque_fragment>',
          `vec3 gV = normalize(vGWorld - cameraPosition);
          float gBack = pow(max(dot(gV, uSunDir), 0.0), 5.0);
          outgoingLight += uSunColor * diffuseColor.rgb * (gBack * 3.5 + 0.25) * smoothstep(0.15, 1.0, vGT);
          #include <opaque_fragment>`
        );
    };
    this.material = mat;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
  }

  setCount(n) {
    this.geometry.instanceCount = Math.min(n, this.maxCount);
  }

  update(time, center, cat, env) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uCenter.value.set(center.x, center.z);
    u.uCat.value.copy(cat);
    u.uWind.value = env.wind;
    u.uSunDir.value.copy(env.lightDir);
    u.uSunColor.value.copy(env.sunColorScaled);
    this.material.roughness = 0.7 - env.rain * 0.35;
  }
}
