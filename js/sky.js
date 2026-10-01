import * as THREE from 'three';
import { NOISE_GLSL, rng, smoothstep, damp, lerp } from './noise.js';

// Palette keyed by sun elevation in degrees.
const KEYS = [
  { e: -90, zen: '#02050f', hor: '#0b1529', sun: '#ff6a3a', sunI: 0, hemiI: 0.55 },
  { e: -14, zen: '#040a1a', hor: '#12203d', sun: '#ff6a3a', sunI: 0, hemiI: 0.58 },
  { e: -6, zen: '#141f44', hor: '#55405f', sun: '#ff6a3a', sunI: 0, hemiI: 0.6 },
  { e: -1, zen: '#2b3b70', hor: '#d0785c', sun: '#ff6a3a', sunI: 0.25, hemiI: 0.55 },
  { e: 4, zen: '#4b67a2', hor: '#f2a06c', sun: '#ff9050', sunI: 1.6, hemiI: 0.72 },
  { e: 10, zen: '#6a8cc0', hor: '#f0c393', sun: '#ffb877', sunI: 2.3, hemiI: 0.85 },
  { e: 22, zen: '#5c8fcf', hor: '#e9dcc4', sun: '#ffe4c0', sunI: 2.8, hemiI: 1.0 },
  { e: 90, zen: '#4682d0', hor: '#d3dfe2', sun: '#fff4e4', sunI: 3.0, hemiI: 1.05 },
].map((k) => ({ ...k, zen: new THREE.Color(k.zen), hor: new THREE.Color(k.hor), sun: new THREE.Color(k.sun) }));

export const TIME_PRESETS = { morning: 7.6, noon: 12.5, golden: 17.0, sunset: 18.05, night: 23.0 };

const WEATHER = {
  clear: { cloud: 0.12, rain: 0, fogNear: 30, fogFar: 260, wind: 0.55 },
  cloudy: { cloud: 0.7, rain: 0, fogNear: 22, fogFar: 200, wind: 0.85 },
  rain: { cloud: 1.0, rain: 1, fogNear: 8, fogFar: 120, wind: 1.25 },
};

const _c = new THREE.Color();
const grey = new THREE.Color();

function samplePalette(elev, out) {
  let i = 0;
  while (i < KEYS.length - 2 && elev > KEYS[i + 1].e) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = THREE.MathUtils.clamp((elev - a.e) / (b.e - a.e), 0, 1);
  out.zen.copy(a.zen).lerp(b.zen, t);
  out.hor.copy(a.hor).lerp(b.hor, t);
  out.sun.copy(a.sun).lerp(b.sun, t);
  out.sunI = lerp(a.sunI, b.sunI, t);
  out.hemiI = lerp(a.hemiI, b.hemiI, t);
  return out;
}

function desaturate(color, amount, darken) {
  const l = color.r * 0.3 + color.g * 0.59 + color.b * 0.11;
  grey.setRGB(l, l, l);
  color.lerp(grey, amount).multiplyScalar(darken);
}

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.hours = TIME_PRESETS.morning;
    this.timeMode = 'cycle';
    this.dayLength = 720; // seconds for a full 24h cycle
    this.weather = 'clear';
    this.cloud = WEATHER.clear.cloud;
    this.rain = 0;
    this.wind = WEATHER.clear.wind;
    this.fogNear = WEATHER.clear.fogNear;
    this.fogFar = WEATHER.clear.fogFar;
    this.flash = 0;
    this.nextLightning = 8;
    this.pal = { zen: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color(), sunI: 0, hemiI: 0 };
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3();
    this.sunColorScaled = new THREE.Color();
    this.night = 0;
    this.sunElev = 0;

    scene.fog = new THREE.Fog(0xffffff, this.fogNear, this.fogFar);

    // Sky dome
    this.skyUniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunDir: { value: this.sunDir },
      uMoonDir: { value: this.moonDir },
      uSunColor: { value: new THREE.Color() },
      uNight: { value: 0 },
      uCloud: { value: 0 },
      uTime: { value: 0 },
      uFlash: { value: 0 },
    };
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith, uHorizon, uSunDir, uMoonDir, uSunColor;
        uniform float uNight, uCloud, uTime, uFlash;
        varying vec3 vDir;
        ${NOISE_GLSL}
        float hash13(vec3 p3) {
          p3 = fract(p3 * 0.1031);
          p3 += dot(p3, p3.zyx + 31.32);
          return fract((p3.x + p3.y) * p3.z);
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
          return v;
        }
        void main() {
          vec3 d = normalize(vDir);
          float y = d.y;
          float t = pow(clamp(y, 0.0, 1.0), 0.42);
          vec3 col = mix(uHorizon, uZenith, t);
          col = mix(col, uHorizon * 0.92, smoothstep(0.0, -0.2, y));

          float sd = max(dot(d, uSunDir), 0.0);
          col += uSunColor * (pow(sd, 6.0) * 0.28 + pow(sd, 48.0) * 0.55) * (1.0 - uCloud * 0.75);
          col += uSunColor * smoothstep(0.9993, 0.9997, sd) * 6.0 * (1.0 - uCloud * 0.9);

          // stars
          if (y > 0.0 && uNight > 0.01) {
            vec3 sp = d * 220.0;
            vec3 cell = floor(sp);
            float h = hash13(cell);
            vec3 f = fract(sp) - 0.5;
            float star = step(0.9965, h) * smoothstep(0.35, 0.0, length(f));
            star *= 0.6 + 0.4 * sin(uTime * (2.0 + h * 6.0) + h * 80.0);
            col += vec3(0.85, 0.9, 1.0) * star * uNight * smoothstep(0.0, 0.25, y) * (1.0 - uCloud * 0.9) * 1.6;
          }
          // moon
          float md = dot(d, uMoonDir);
          col += vec3(0.85, 0.9, 1.0) * smoothstep(0.99935, 0.9997, md) * uNight * 2.2 * (1.0 - uCloud * 0.8);
          col += vec3(0.25, 0.32, 0.5) * pow(max(md, 0.0), 30.0) * uNight * 0.35;

          // clouds painted on the dome
          if (y > 0.0) {
            vec2 uv = d.xz / (y + 0.12) * 1.4 + vec2(uTime * 0.006, uTime * 0.002);
            float n = fbm(uv);
            float cover = mix(0.72, 0.38, uCloud);
            float c = smoothstep(cover, cover + 0.22, n) * smoothstep(0.0, 0.18, y);
            vec3 cloudCol = mix(uHorizon * 1.05, vec3(1.0), 0.35) * (1.0 - uCloud * 0.35);
            cloudCol += uSunColor * pow(sd, 4.0) * 0.4;
            col = mix(col, cloudCol, c * (0.55 + 0.35 * uCloud));
          }
          col += vec3(0.6, 0.65, 0.8) * uFlash;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), skyMat);
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    // Lights
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x3a3a18, 1);
    scene.add(this.hemi);
    this.dir = new THREE.DirectionalLight(0xffffff, 2);
    this.dir.castShadow = true;
    this.dir.shadow.bias = -0.0004;
    this.dir.shadow.normalBias = 0.03;
    const sc = this.dir.shadow.camera;
    sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 120;
    scene.add(this.dir);
    scene.add(this.dir.target);

    this.clouds = new CloudLayer(scene);
  }

  setShadowQuality(size, extent) {
    this.dir.castShadow = size > 0;
    if (size > 0) {
      this.dir.shadow.mapSize.set(size, size);
      const sc = this.dir.shadow.camera;
      sc.left = -extent; sc.right = extent; sc.top = extent; sc.bottom = -extent;
      sc.updateProjectionMatrix();
      if (this.dir.shadow.map) { this.dir.shadow.map.dispose(); this.dir.shadow.map = null; }
    }
  }

  setTimeMode(mode) {
    this.timeMode = mode;
    if (mode !== 'cycle') this.targetHours = TIME_PRESETS[mode];
  }

  setWeather(w) { this.weather = w; }

  update(dt, time, focus) {
    // time of day
    if (this.timeMode === 'cycle') {
      this.hours = (this.hours + (dt * 24) / this.dayLength) % 24;
    } else {
      let d = this.targetHours - this.hours;
      if (d > 12) d -= 24;
      if (d < -12) d += 24;
      this.hours = (this.hours + d * (1 - Math.exp(-2.2 * dt)) + 24) % 24;
    }
    const a = ((this.hours - 6) / 24) * Math.PI * 2;
    this.sunDir.set(-Math.cos(a), Math.sin(a) * 0.86, -0.42).normalize();
    this.moonDir.set(Math.cos(a) * 0.9, -Math.sin(a) * 0.8, 0.5).normalize();
    this.sunElev = THREE.MathUtils.radToDeg(Math.asin(this.sunDir.y));
    this.night = 1 - smoothstep(-10, -1, this.sunElev);

    // weather blend
    const W = WEATHER[this.weather];
    this.cloud = damp(this.cloud, W.cloud, 0.6, dt);
    this.rain = damp(this.rain, W.rain, 0.6, dt);
    this.wind = damp(this.wind, W.wind, 0.6, dt);
    this.fogNear = damp(this.fogNear, W.fogNear, 0.6, dt);
    this.fogFar = damp(this.fogFar, W.fogFar, 0.6, dt);

    // lightning during rain
    this.flash = Math.max(0, this.flash - dt * 3.5);
    this.thunder = false;
    if (this.rain > 0.8) {
      this.nextLightning -= dt;
      if (this.nextLightning < 0) {
        this.flash = 1;
        this.thunder = true;
        this.nextLightning = 9 + Math.random() * 18;
      }
    }

    const p = samplePalette(this.sunElev, this.pal);
    const overcast = this.cloud;
    const desat = overcast * 0.55 + this.rain * 0.25;
    const darken = 1 - overcast * 0.18 - this.rain * 0.35;
    desaturate(p.zen, desat, darken);
    desaturate(p.hor, desat, darken);

    const u = this.skyUniforms;
    u.uZenith.value.copy(p.zen);
    u.uHorizon.value.copy(p.hor);
    u.uSunColor.value.copy(p.sun);
    u.uNight.value = this.night;
    u.uCloud.value = overcast;
    u.uTime.value = time;
    u.uFlash.value = this.flash * 0.5;
    this.sky.position.copy(focus.camera);

    this.scene.fog.color.copy(p.hor);
    this.scene.fog.near = this.fogNear;
    this.scene.fog.far = this.fogFar;

    // lights
    const sunI = p.sunI * (1 - overcast * 0.55) * (1 - this.rain * 0.55);
    const moonI = this.night * 0.95 * (1 - overcast * 0.6);
    const useSun = sunI >= moonI;
    this.lightDir.copy(useSun ? this.sunDir : this.moonDir);
    this.dir.intensity = Math.max(sunI, moonI) + this.flash * 2.5;
    this.dir.color.copy(useSun ? p.sun : _c.set('#9fb4e6'));
    this.dir.position.copy(focus.player).addScaledVector(this.lightDir, 50);
    this.dir.target.position.copy(focus.player);

    this.hemi.intensity = p.hemiI * (1 + overcast * 0.3) * (1 - this.rain * 0.1) + this.flash;
    this.hemi.color.copy(p.zen).lerp(p.hor, 0.4).multiplyScalar(1.15).lerp(_c.set('#41548a'), this.night * 0.85);
    this.hemi.groundColor.set('#4a4826').multiplyScalar(0.45 + 0.55 * (1 - this.night));

    this.sunColorScaled.copy(p.sun).multiplyScalar(sunI * 0.35);
    this.sunVisible = useSun ? 1 : 0;

    this.clouds.update(dt, time, focus.camera, p, this.cloud, this.rain, this.wind, this.night);
  }
}

// Low-poly puffy clouds drifting high above the meadow.
class CloudLayer {
  constructor(scene) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    this.mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, fog: false, transparent: true, opacity: 0.95 });
    this.maxClouds = 46;
    const puffs = 6;
    this.mesh = new THREE.InstancedMesh(geo, this.mat, this.maxClouds * puffs);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -500;
    scene.add(this.mesh);
    const r = rng(1234);
    this.clouds = [];
    for (let i = 0; i < this.maxClouds; i++) {
      const c = { x: (r() - 0.5) * 900, z: (r() - 0.5) * 900, y: 70 + r() * 40, s: 9 + r() * 14, puffs: [], show: r() };
      for (let j = 0; j < puffs; j++) {
        c.puffs.push({ dx: (r() - 0.5) * 2.6, dy: (r() - 0.3) * 0.6, dz: (r() - 0.5) * 1.2, s: 0.55 + r() * 0.7, rot: r() * 6 });
      }
      this.clouds.push(c);
    }
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.v = new THREE.Vector3();
    this.sv = new THREE.Vector3();
    this.drift = 0;
  }

  update(dt, time, cam, pal, cloud, rain, wind, night) {
    this.drift += dt * (1.5 + wind * 3);
    const span = 900;
    let n = 0;
    for (const c of this.clouds) {
      const visible = c.show < 0.2 + cloud * 0.8;
      if (!visible) continue;
      const wx = ((((c.x + this.drift - cam.x) % span) + span * 1.5) % span) - span / 2 + cam.x;
      const wz = ((((c.z - cam.z) % span) + span * 1.5) % span) - span / 2 + cam.z;
      const scale = c.s * (0.8 + cloud * 0.5);
      for (const p of c.puffs) {
        this.v.set(wx + p.dx * scale, c.y + p.dy * scale - rain * 12, wz + p.dz * scale);
        this.e.set(0, p.rot, 0);
        this.q.setFromEuler(this.e);
        this.sv.set(p.s * scale, p.s * scale * 0.55, p.s * scale);
        this.m.compose(this.v, this.q, this.sv);
        this.mesh.setMatrixAt(n++, this.m);
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    const base = _c.copy(pal.hor).lerp(grey.set(1, 1, 1), 0.55 - night * 0.4);
    this.mat.color.copy(base).multiplyScalar((1 - rain * 0.3) * (1 - night * 0.75));
    this.mat.emissive.copy(pal.hor).multiplyScalar(0.25);
  }
}
