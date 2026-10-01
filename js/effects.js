import * as THREE from 'three';
import { terrainHeight, rng, lerp, damp, clamp } from './noise.js';

// Rain streaks that wrap around the camera.
export class Rain {
  constructor(scene, count = 9000) {
    const box = (this.box = 36);
    const H = (this.H = 22);
    const r = rng(77);
    const base = new Float32Array(count * 2 * 3);
    const end = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = r() * box, y = r() * H, z = r() * box;
      base.set([x, y, z, x, y, z], i * 6);
      end[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(base, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.uniforms = { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: box }, uH: { value: H }, uAlpha: { value: 0 }, uWind: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float uTime, uBox, uH, uWind;
        uniform vec3 uCenter;
        attribute float aEnd;
        varying float vA;
        void main() {
          vec3 p = position;
          float speed = 16.0 + fract(p.x * 13.7) * 6.0;
          p.y = mod(p.y - uTime * speed, uH);
          vec3 w;
          w.xz = uCenter.xz + mod(p.xz - uCenter.xz + uBox * 0.5 + vec2(uWind * uTime * 2.0, 0.0), uBox) - uBox * 0.5;
          w.y = uCenter.y - uH * 0.35 + p.y;
          w += vec3(-uWind * 0.06, 0.45, 0.0) * aEnd;
          vA = mix(0.0, 1.0, aEnd);
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAlpha;
        varying float vA;
        void main() { gl_FragColor = vec4(0.72, 0.78, 0.88, uAlpha * (0.25 + 0.35 * vA)); }`,
    });
    this.mesh = new THREE.LineSegments(g, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(time, cam, env) {
    this.uniforms.uTime.value = time;
    this.uniforms.uCenter.value.copy(cam);
    this.uniforms.uAlpha.value = env.rain * (1 - env.night * 0.5);
    this.uniforms.uWind.value = env.wind;
    this.mesh.visible = env.rain > 0.02;
  }
}

// Pollen in the day, fireflies at night.
export class Motes {
  constructor(scene, count = 420) {
    const r = rng(9);
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos.set([r() * 40, r() * 3.2, r() * 40], i * 3);
      seed[i] = r();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.uniforms = {
      uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uNight: { value: 0 }, uAlpha: { value: 1 }, uPx: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uTime, uNight, uPx;
        uniform vec3 uCenter;
        attribute float aSeed;
        varying float vBlink;
        varying float vSeed;
        ${'' /* terrain height is approximated by the camera focus height */}
        void main() {
          vec3 p = position;
          float t = uTime * (0.25 + aSeed * 0.3);
          p.x += sin(t + aSeed * 40.0) * 1.6;
          p.z += cos(t * 0.8 + aSeed * 23.0) * 1.6;
          p.y += sin(t * 1.3 + aSeed * 11.0) * 0.4;
          vec3 w;
          w.xz = uCenter.xz + mod(p.xz - uCenter.xz + 20.0, 40.0) - 20.0;
          w.y = uCenter.y + p.y - 0.4;
          vec4 mv = viewMatrix * vec4(w, 1.0);
          gl_Position = projectionMatrix * mv;
          float blink = 0.5 + 0.5 * sin(uTime * (1.5 + aSeed * 2.5) + aSeed * 30.0);
          vBlink = mix(0.55, blink * blink, uNight);
          vSeed = aSeed;
          float size = mix(2.0, 7.0, uNight) * (0.6 + aSeed * 0.8);
          gl_PointSize = size * uPx * (14.0 / max(-mv.z, 0.5));
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight, uAlpha;
        varying float vBlink;
        varying float vSeed;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          vec3 day = vec3(1.0, 0.97, 0.85) * 0.55;
          vec3 night = vec3(0.75, 1.0, 0.35) * 2.2;
          vec3 c = mix(day, night, uNight);
          float alpha = a * vBlink * uAlpha * mix(0.45, 1.0, uNight) * step(mix(0.55, 0.0, uNight), vSeed);
          gl_FragColor = vec4(c * alpha, alpha);
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(time, focus, env, pixelRatio) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uCenter.value.set(focus.x, terrainHeight(focus.x, focus.z), focus.z);
    u.uNight.value = clamp(env.night * 1.2 - 0.1, 0, 1);
    u.uAlpha.value = 1 - env.rain * 0.85;
    u.uPx.value = pixelRatio;
  }
}

// A handful of butterflies that flutter near the cat and scatter when it pounces.
export class Butterflies {
  constructor(scene, count = 9) {
    this.list = [];
    const colors = ['#ff9a2e', '#ffffff', '#7fb2ff', '#ffe066', '#ff7aa8', '#c8a2ff'];
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.11, 0, 0.06, 0.09, 0, -0.07, 0, 0, 0, 0.09, 0, -0.07, 0.04, 0, -0.1], 3));
    wingGeo.computeVertexNormals();
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide, roughness: 0.6, emissive: colors[i % colors.length], emissiveIntensity: 0.15 });
      const g = new THREE.Group();
      const l = new THREE.Mesh(wingGeo, mat);
      const r = new THREE.Mesh(wingGeo, mat);
      r.scale.x = -1;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.006, 0.09, 4).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#222' }));
      g.add(l, r, body);
      g.scale.setScalar(1.3);
      scene.add(g);
      this.list.push({ g, l, r, home: new THREE.Vector3(), pos: new THREE.Vector3(1e6, 0, 0), vel: new THREE.Vector3(), phase: Math.random() * 6, t: 0, flee: 0 });
    }
    this.vis = 1;
  }

  update(dt, time, cat, catSpeed, env, flowers) {
    const target = clamp(1 - env.night * 1.5 - env.rain, 0, 1);
    this.vis = damp(this.vis, target, 1.5, dt);
    for (const b of this.list) {
      const dx = b.pos.x - cat.x;
      const dz = b.pos.z - cat.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 30 * 30) {
        // respawn near the cat, preferably over a flower patch
        let hx = cat.x + (Math.random() - 0.5) * 30;
        let hz = cat.z + (Math.random() - 0.5) * 30;
        if (flowers.length && Math.random() < 0.7) {
          const f = flowers[Math.floor(Math.random() * flowers.length)];
          if ((f.x - cat.x) ** 2 + (f.z - cat.z) ** 2 < 25 * 25) { hx = f.x; hz = f.z; }
        }
        b.home.set(hx, 0, hz);
        b.pos.set(hx + (Math.random() - 0.5) * 3, terrainHeight(hx, hz) + 0.8, hz + (Math.random() - 0.5) * 3);
      }
      b.t -= dt;
      if (b.t < 0) {
        b.t = 0.4 + Math.random() * 1.2;
        b.vel.set((Math.random() - 0.5) * 1.6, (Math.random() - 0.45) * 0.8, (Math.random() - 0.5) * 1.6);
        const hx = b.home.x - b.pos.x, hz = b.home.z - b.pos.z;
        b.vel.x += hx * 0.25;
        b.vel.z += hz * 0.25;
      }
      if (d2 < 1.6 && catSpeed > 0.5) {
        b.flee = 1.5;
        b.vel.set(dx, 1.5, dz).normalize().multiplyScalar(3);
      }
      b.flee = Math.max(0, b.flee - dt);
      b.pos.addScaledVector(b.vel, dt);
      const gy = terrainHeight(b.pos.x, b.pos.z);
      const minY = gy + 0.45, maxY = gy + (b.flee > 0 ? 4 : 1.6);
      if (b.pos.y < minY) { b.pos.y = minY; b.vel.y = Math.abs(b.vel.y); }
      if (b.pos.y > maxY) b.vel.y = -Math.abs(b.vel.y) * 0.5;
      b.phase += dt * 22;
      const flap = Math.sin(b.phase) * 1.1;
      b.l.rotation.z = flap;
      b.r.rotation.z = -flap;
      b.g.position.copy(b.pos);
      b.g.position.y += Math.sin(b.phase * 0.5) * 0.03;
      b.g.rotation.y = Math.atan2(b.vel.x, b.vel.z);
      b.g.visible = this.vis > 0.05;
      b.g.scale.setScalar(1.3 * this.vis);
    }
  }
}

// Floating "Meow!" and "z" sprites.
export class FloatText {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.cache = {};
  }

  texture(text, color) {
    const key = text + color;
    if (this.cache[key]) return this.cache[key];
    const c = document.createElement('canvas');
    const font = '600 64px Inter, system-ui, sans-serif';
    const probe = c.getContext('2d');
    probe.font = font;
    // wide enough for long lines like "¿Qué mirás, bobo?"
    c.width = Math.max(256, Math.ceil(probe.measureText(text).width / 64) * 64 + 64);
    c.height = 128;
    const g = c.getContext('2d');
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 10;
    g.strokeStyle = 'rgba(20,24,16,0.55)';
    g.strokeText(text, c.width / 2, 64);
    g.fillStyle = color;
    g.fillText(text, c.width / 2, 64);
    const t = new THREE.CanvasTexture(c);
    t.userData.aspect = c.width / c.height;
    t.colorSpace = THREE.SRGBColorSpace;
    this.cache[key] = t;
    return t;
  }

  spawn(text, pos, { color = '#fff6e0', size = 0.5, life = 1.4, rise = 0.6, drift = 0 } = {}) {
    const map = this.texture(text, color);
    const mat = new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, fog: false });
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    const aspect = (map.userData.aspect || 2) / 2;
    s.scale.set(size * aspect, size * 0.5, 1);
    s.renderOrder = 10;
    this.scene.add(s);
    this.items.push({ s, life, age: 0, rise, drift, size, aspect });
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      const k = it.age / it.life;
      it.s.position.y += it.rise * dt;
      it.s.position.x += Math.sin(it.age * 3) * it.drift * dt;
      it.s.material.opacity = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.6) / 0.4);
      const sc = it.size * lerp(0.7, 1.1, Math.min(1, k * 4));
      it.s.scale.set(sc * (it.aspect || 1), sc * 0.5, 1);
      if (k >= 1) {
        this.scene.remove(it.s);
        it.s.material.dispose();
        this.items.splice(i, 1);
      }
    }
  }
}
