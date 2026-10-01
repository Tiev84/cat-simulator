import * as THREE from 'three';
import { clamp, lerp, damp, smoothstep, NOISE_GLSL } from './noise.js';

// ---------------------------------------------------------------------------
// Skins: colour + body type. Patterns (tabby stripes, white bibs, socks) are
// painted per vertex at build time and resolved crisply in the fragment
// shader, so every cat stays fully procedural and low-poly.
// ---------------------------------------------------------------------------
export const SKINS = [
  {
    id: 'ginger', name: 'Ginger', badge: 'DEFAULT', kind: 'quad', shape: 'kitten',
    desc: 'A curious orange tabby kitten, tail held high.',
    base: '#dc8a3c', dark: '#b2601f', white: '#f5ddb4', stripes: 0.85, stripeFreq: 36, shade: 0.14,
    whites: { chest: 1, muzzle: 1, belly: 1 }, eye: '#a8a33c', nose: '#d68e86', ear: '#eaa59c', meow: 1.3,
  },
  {
    id: 'midnight', name: 'Midnight', badge: 'GENERATED', kind: 'quad', shape: 'kitten',
    desc: 'Black from ears to tail. Eyes glow at night.',
    base: '#19191c', dark: '#101012', white: '#19191c', stripes: 0, shade: 0.05, roughness: 0.5,
    whites: {}, eye: '#cdbf3e', nose: '#2c2426', ear: '#4b3537', meow: 1.15, glowEyes: 1,
  },
  {
    id: 'tuxedo', name: 'Tuxedo', badge: 'GENERATED', kind: 'quad', shape: 'kitten',
    desc: 'Formal black coat, white bib and four white socks.',
    base: '#161618', dark: '#101012', white: '#f1f0ec', stripes: 0, shade: 0.05, roughness: 0.6,
    whites: { chest: 1.05, muzzle: 1, belly: 1, socks: 0.075 }, eye: '#d3a63a', nose: '#e59ba1', ear: '#e7a7a6', meow: 1.2,
  },
  {
    id: 'chonky', name: 'Chonky', badge: 'CHONK', kind: 'quad', shape: 'chonk',
    desc: 'A round grey tabby. Short legs, big heart, slower pace.',
    base: '#7a736c', dark: '#4a443e', white: '#e6e0d6', stripes: 0.8, stripeFreq: 30, shade: 0.12,
    whites: { socks: 0.04, muzzle: 0.75, chest: 0.55 }, eye: '#7b98a0', nose: '#b98a80', ear: '#c99a92', meow: 0.8,
  },
  {
    id: 'buff', name: 'Buff', badge: 'MEME', kind: 'biped', shape: 'buff',
    desc: 'Walks on two legs. Never skips arm day. Hold E to flex.',
    base: '#ecdcc3', dark: '#d8c3a0', white: '#f7eedf', stripes: 0, shade: 0.1,
    whites: { muzzle: 1 }, eye: '#3e2c22', nose: '#e2a29d', ear: '#eab0a8', meow: 0.62,
  },
  {
    id: 'maxwell', name: 'Maxwell', badge: 'MEME', kind: 'loaf',
    desc: 'A low-poly black-and-white loaf. Hold E to spin.',
    base: '#141415', dark: '#101011', white: '#efefec', stripes: 0, shade: 0.04, roughness: 0.65, flat: true,
    whites: { chest: 1, muzzle: 1 }, eye: '#b7c46c', nose: '#1f1a1b', ear: '#3a2b2c', meow: 1.0, whisker: '#ffffff',
  },
  {
    id: 'oiia', name: 'OIIA Cat', badge: 'UNLOCK', kind: 'quad', shape: 'oiia', hold: 'spin', unlock: 15,
    desc: 'The spinning meme cat. Hold E: oiia oiia!',
    base: '#7f776d', dark: '#4a443d', white: '#ebe5da', stripes: 0.85, stripeFreq: 32, shade: 0.12,
    whites: { socks: 0.045, muzzle: 0.8, chest: 0.6 }, eye: '#6b8791', nose: '#c08f86', ear: '#cfa098', meow: 1.05,
  },
  {
    id: 'tom', name: 'Tom', badge: 'UNLOCK', kind: 'biped', shape: 'tom', unlock: 10,
    desc: 'The classic cartoon cat. Hold E to sneak; wings become his bat cape.',
    base: '#7fa3d3', dark: '#769bcb', white: '#f3f4f7', stripes: 0, shade: 0.06, toon: true,
    whites: { chest: 1, muzzle: 1, paws: 1, socks: 0.11 }, eye: '#f3ec9a', iris: '#2fb54a', nose: '#1d1c22', ear: '#e9849f', meow: 0.9, whisker: '#25262c',
  },
];

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
// Smooth by default; Maxwell passes low segment counts on purpose.
const ellip = (rx, ry, rz, ws = 20, hs = 14) => new THREE.SphereGeometry(1, ws, hs).scale(rx, ry, rz);
const cylDown = (rTop, rBot, h, seg = 12) => new THREE.CylinderGeometry(rTop, rBot, h, seg, 1).translate(0, -h / 2, 0);
const cylUp = (rBot, rTop, h, seg = 12) => new THREE.CylinderGeometry(rTop, rBot, h, seg, 1).translate(0, h / 2, 0);

const cr = (p0, p1, p2, p3, t) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

// A smooth closed tube through stations [x, y, z, rx, ry] (Catmull-Rom
// resampled). rx runs along the cat's left-right axis, ry perpendicular to it
// and to the spine. Used for torsos and legs so they read as one body.
function loft(pts, seg = 18, sub = 4) {
  const P = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < sub; k++) P.push(p1.map((_, j) => cr(p0[j], p1[j], p2[j], p3[j], k / sub)));
  }
  P.push(pts[pts.length - 1]);
  const pos = [];
  const idx = [];
  const T = new THREE.Vector3(), S = new THREE.Vector3(), N = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0);
  const frame = (i) => {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
    T.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    S.copy(X).addScaledVector(T, -X.dot(T));
    if (S.lengthSq() < 1e-6) S.set(0, 0, 1);
    S.normalize();
    N.crossVectors(T, S).normalize();
  };
  for (let i = 0; i < P.length; i++) {
    frame(i);
    const [x, y, z, rx, ry] = P[i];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      pos.push(x + S.x * c * rx + N.x * sn * ry, y + S.y * c * rx + N.y * sn * ry, z + S.z * c * rx + N.z * sn * ry);
    }
  }
  const rings = P.length;
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = (i + 1) * seg + j, d = (i + 1) * seg + ((j + 1) % seg);
      idx.push(a, b, c, b, d, c);
    }
  }
  // round caps
  frame(0);
  const p0 = P[0];
  const cap0 = Math.min(p0[3], p0[4]) * 0.8;
  pos.push(p0[0] - T.x * cap0, p0[1] - T.y * cap0, p0[2] - T.z * cap0);
  frame(rings - 1);
  const pn = P[rings - 1];
  const cap1 = Math.min(pn[3], pn[4]) * 0.8;
  pos.push(pn[0] + T.x * cap1, pn[1] + T.y * cap1, pn[2] + T.z * cap1);
  const s0 = rings * seg, s1 = s0 + 1;
  for (let j = 0; j < seg; j++) {
    idx.push((j + 1) % seg, j, s0);
    const l = (rings - 1) * seg;
    idx.push(l + j, l + ((j + 1) % seg), s1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A joint: a group at a cat-space point whose inner child cancels the
// offset, so everything added to `inner` can use cat-space coordinates.
function pivot(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const inner = new THREE.Group();
  inner.position.set(-x, -y, -z);
  g.add(inner);
  parent.add(g);
  return [g, inner];
}

function fur(parent, geo, mats, part, x, y, z, extra = {}) {
  const m = new THREE.Mesh(geo, mats.fur);
  m.position.set(x, y, z);
  m.userData = { fur: true, part, ...extra };
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function plain(parent, geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
function furMaterial(skin) {
  const u = {
    uBase: { value: new THREE.Color(skin.base) },
    uDark: { value: new THREE.Color(skin.dark) },
    uWhite: { value: new THREE.Color(skin.white) },
    uStripes: { value: skin.stripes || 0 },
    uShade: { value: skin.shade ?? 0.1 },
  };
  // Fur: soft sheen at grazing angles, fine strand noise and soft-edged
  // markings. Maxwell keeps his faceted meme look; Tom gets a clean toon coat.
  u.uFur = { value: skin.flat ? 0 : skin.toon ? 0.12 : 1 };
  u.uGlow = { value: skin.toon ? 0.28 : 0 };
  const base = new THREE.Color(skin.base);
  const m = new THREE.MeshPhysicalMaterial({
    flatShading: !!skin.flat,
    roughness: skin.roughness ?? (skin.toon ? 0.6 : 0.88),
    metalness: 0,
    sheen: skin.flat ? 0 : skin.toon ? 0.3 : 1,
    sheenRoughness: 0.5,
    sheenColor: base.clone().lerp(new THREE.Color('#ffffff'), 0.45),
  });
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aPat;\nvarying vec4 vPat;\nvarying vec3 vFurP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPat = aPat;\nvFurP = position;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uGlow;')
      .replace('#include <common>', `#include <common>\nuniform vec3 uBase, uDark, uWhite;\nuniform float uStripes, uShade, uFur, uGlow;\nvarying vec4 vPat;\nvarying vec3 vFurP;\n${NOISE_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `float wob = (vnoise(vFurP.xy * 38.0 + vFurP.z * 17.0) - 0.5) * 1.4 * uFur;
        float st = sin(vPat.x + wob) * 0.5 + 0.5;
        float stripe = smoothstep(mix(0.62, 0.52, uFur), mix(0.74, 0.82, uFur), st) * vPat.y * uStripes;
        vec3 c = mix(uBase, uDark, stripe);
        c *= 1.0 - clamp(vPat.w, -1.0, 1.0) * uShade;
        float edge = mix(0.05, 0.1, uFur);
        float wh = smoothstep(-edge, edge, vPat.z + (vnoise(vFurP.xz * 70.0) - 0.5) * 0.08 * uFur);
        c = mix(c, uWhite, wh);
        float strand = vnoise(vec2((vFurP.x + vFurP.z) * 110.0, vFurP.y * 320.0));
        c *= mix(1.0, 0.84 + 0.28 * strand, uFur);
        diffuseColor.rgb = c;`
      );
  };
  return m;
}

function makeMats(skin) {
  return {
    fur: furMaterial(skin),
    eye: new THREE.MeshPhysicalMaterial({ color: skin.eye, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05, emissive: new THREE.Color(skin.eye), emissiveIntensity: 0 }),
    iris: new THREE.MeshPhysicalMaterial({ color: skin.iris || skin.eye, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 }),
    brow: new THREE.MeshStandardMaterial({ color: '#23262e', roughness: 0.6 }),
    pupil: new THREE.MeshStandardMaterial({ color: '#040404', roughness: 0.1 }),
    glint: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    nose: new THREE.MeshPhysicalMaterial({ color: skin.nose, roughness: 0.45, clearcoat: 0.4, flatShading: !!skin.flat }),
    inner: new THREE.MeshStandardMaterial({ color: skin.ear, roughness: 0.8, flatShading: !!skin.flat, side: THREE.DoubleSide }),
    mouth: new THREE.MeshStandardMaterial({ color: '#5a2228', roughness: 0.6 }),
    whisker: new THREE.LineBasicMaterial({ color: skin.whisker || '#eeeeee', transparent: true, opacity: 0.75 }),
  };
}

// ---------------------------------------------------------------------------
// Pattern painting
// ---------------------------------------------------------------------------
function ellSDF(p, e, scale = 1) {
  const dx = (p.x - e.c[0]) / (e.r[0] * scale);
  const dy = (p.y - e.c[1]) / (e.r[1] * scale);
  const dz = (p.z - e.c[2]) / (e.r[2] * scale);
  return 1 - Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function patternAt(p, ud, ly, skin, L) {
  const F = skin.stripeFreq || 34;
  let sc = 0, sm = 0, sh = 0;
  switch (ud.part) {
    case 'body':
      sc = p.z * F + Math.sin(p.y * 14 + p.x * 6) * 0.9;
      sm = smoothstep(L.bodyY - L.bodyH * 0.35, L.bodyY + L.bodyH * 0.55, p.y);
      sh = (p.y - L.bodyY) / L.bodyH;
      break;
    case 'leg':
      sc = p.y * F * 1.25 + p.x * 3;
      sm = 0.6;
      break;
    case 'tail': {
      const u = ud.u0 + (ly / ud.len) * (ud.u1 - ud.u0);
      sc = u * Math.PI * 2 * ud.rings;
      sm = 1;
      break;
    }
    case 'head':
      sc = p.x * F * 1.7 + Math.abs(p.x) * 6;
      sm = smoothstep(L.headY + L.headR * 0.05, L.headY + L.headR * 0.6, p.y) * smoothstep(L.headZ - L.headR * 0.3, L.headZ + L.headR * 0.5, p.z);
      sh = (p.y - L.headY) / L.headR * 0.5;
      break;
    case 'ear':
      sc = 0; sm = 0; sh = 0.4;
      break;
    case 'paw':
      sc = p.y * F * 1.25; sm = 0.6;
      break;
    default:
      break;
  }
  const W = skin.whites || {};
  let w = -1;
  if (W.chest && L.chest) w = Math.max(w, ellSDF(p, L.chest, W.chest));
  if (W.belly && L.belly) w = Math.max(w, ellSDF(p, L.belly, W.belly));
  if (W.muzzle && L.muzzle) w = Math.max(w, ellSDF(p, L.muzzle, W.muzzle));
  if (W.muzzle && ud.part === 'muzzle') w = Math.max(w, W.muzzle >= 1 ? 1 : 0.02);
  if (W.socks && ud.part === 'leg') w = Math.max(w, (W.socks - p.y) * 18);
  if (ud.part === 'paw') w = W.paws ? 1 : W.socks ? Math.max(w, (W.socks - p.y) * 18) : w;
  if (ud.part === 'ear') w = Math.min(w, -1);
  return [sc, sm, w, sh];
}

function paint(root, skin, L) {
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.userData.fur) return;
    const g = o.geometry;
    const pos = g.attributes.position;
    const pat = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const ly = pos.getY(i);
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      pat.set(patternAt(v, o.userData, ly, skin, L), i * 4);
    }
    g.setAttribute('aPat', new THREE.BufferAttribute(pat, 4));
  });
}

// ---------------------------------------------------------------------------
// Head (shared by all body types). Coordinates are cat-space.
// ---------------------------------------------------------------------------
function whiskers(parent, mats, pts) {
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  parent.add(new THREE.LineSegments(wg, mats.whisker));
}

function buildHead(parent, mats, H) {
  if (H.style === 'toon') return buildToonHead(parent, mats, H);
  if (H.style === 'low') return buildLowHead(parent, mats, H);
  const [cx, cy, cz] = H.c;
  const r = H.r;
  const cheek = H.cheek || 1;
  // skull, cheek ruff, brow ridges and nose bridge blend into one head
  fur(parent, ellip(r, r * 0.86, r * 0.92, 26, 18), mats, 'head', cx, cy, cz);
  for (const s of [-1, 1]) {
    fur(parent, ellip(r * 0.5 * cheek, r * 0.42, r * 0.5, 18, 14), mats, 'head', cx + s * r * 0.4 * cheek, cy - r * 0.28, cz + r * 0.2);
    fur(parent, ellip(r * 0.26, r * 0.11, r * 0.2, 14, 10), mats, 'head', cx + s * r * 0.35, cy + r * 0.24, cz + r * 0.64);
  }
  fur(parent, ellip(r * 0.17, r * 0.15, r * 0.34, 14, 10), mats, 'head', cx, cy - r * 0.02, cz + r * 0.62);
  // whisker pads, chin, nose
  for (const s of [-1, 1]) fur(parent, ellip(r * 0.2, r * 0.17, r * 0.18, 16, 12), mats, 'muzzle', cx + s * r * 0.14, cy - r * 0.3, cz + r * 0.82);
  plain(parent, ellip(r * 0.17, r * 0.09, r * 0.16, 12, 8), mats.mouth, cx, cy - r * 0.44, cz + r * 0.76);
  const [jaw, jawIn] = pivot(parent, cx, cy - r * 0.4, cz + r * 0.5);
  fur(jawIn, ellip(r * 0.19, r * 0.1, r * 0.22, 14, 10), mats, 'muzzle', cx, cy - r * 0.47, cz + r * 0.74);
  plain(parent, ellip(r * 0.1, r * 0.065, r * 0.07, 12, 8), mats.nose, cx, cy - r * 0.13, cz + r * 0.99);

  // almond eyes set into the skull under the brow
  const eyes = [];
  const e = H.eye;
  for (const s of [-1, 1]) {
    const eg = new THREE.Group();
    eg.position.set(cx + s * r * 0.36, cy + r * 0.08, cz + r * 0.72);
    eg.rotation.y = s * 0.35;
    eg.add(new THREE.Mesh(ellip(e, e * 0.82, e * 0.55, 18, 14), mats.eye));
    const pu = new THREE.Mesh(ellip(e * 0.22, e * 0.72, e * 0.2, 12, 10), mats.pupil);
    pu.position.z = e * 0.42;
    eg.add(pu);
    const gl = new THREE.Mesh(new THREE.SphereGeometry(e * 0.11, 8, 6), mats.glint);
    gl.position.set(e * 0.3, e * 0.3, e * 0.5);
    eg.add(gl);
    parent.add(eg);
    eyes.push(eg);
  }

  const ears = [];
  const E = H.ear;
  for (const s of [-1, 1]) {
    const eg = new THREE.Group();
    eg.position.set(cx + s * r * 0.5, cy + r * 0.56, cz - r * 0.04);
    eg.rotation.set(-0.12, -s * 0.2, -s * 0.28);
    const outer = new THREE.Mesh(new THREE.ConeGeometry(E * 0.5, E, 18, 3).translate(0, E * 0.5, 0).scale(1, 1, 0.42), mats.fur);
    outer.userData = { fur: true, part: 'ear' };
    outer.castShadow = true;
    eg.add(outer);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(E * 0.36, E * 0.78, 18, 2).translate(0, E * 0.42, 0).scale(1, 1, 0.22), mats.inner);
    inner.position.z = E * 0.11;
    eg.add(inner);
    parent.add(eg);
    ears.push(eg);
  }

  const wp = [];
  const wl = H.whisker || r * 1.2;
  for (const s of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const x0 = cx + s * r * 0.24, y0 = cy - r * 0.27 - k * r * 0.045, z0 = cz + r * 0.92;
      wp.push(x0, y0, z0, x0 + s * wl, y0 + (0.5 - k * 0.45) * r * 0.4, z0 - r * 0.3);
    }
  }
  whiskers(parent, mats, wp);
  return { jaw, eyes, ears };
}

// Maxwell's faceted meme head (kept low-poly on purpose).
function buildLowHead(parent, mats, H) {
  const [cx, cy, cz] = H.c;
  const r = H.r;
  const [ws, hs] = H.segs || [8, 6];
  const cheek = H.cheek || 1;
  fur(parent, ellip(r, r * 0.86, r * 0.9, ws, hs), mats, 'head', cx, cy, cz);
  for (const s of [-1, 1]) fur(parent, ellip(r * 0.5 * cheek, r * 0.46, r * 0.5, ws - 2, hs - 2), mats, 'head', cx + s * r * 0.42 * cheek, cy - r * 0.3, cz + r * 0.24);
  fur(parent, ellip(r * 0.4, r * 0.27, r * 0.3, 8, 6), mats, 'muzzle', cx, cy - r * 0.3, cz + r * 0.72);
  plain(parent, ellip(r * 0.2, r * 0.1, r * 0.18, 6, 4), mats.mouth, cx, cy - r * 0.45, cz + r * 0.74);
  const [jaw, jawIn] = pivot(parent, cx, cy - r * 0.42, cz + r * 0.45);
  fur(jawIn, ellip(r * 0.26, r * 0.1, r * 0.3, 7, 5), mats, 'muzzle', cx, cy - r * 0.5, cz + r * 0.68);
  plain(parent, ellip(r * 0.12, r * 0.075, r * 0.08, 6, 4), mats.nose, cx, cy - r * 0.07, cz + r * 0.98);
  const eyes = [];
  const e = H.eye;
  for (const s of [-1, 1]) {
    const eg = new THREE.Group();
    eg.position.set(cx + s * r * 0.4, cy + r * 0.1, cz + r * 0.74);
    eg.rotation.y = s * 0.32;
    eg.add(new THREE.Mesh(ellip(e, e, e * 0.5, 10, 8), mats.eye));
    const pu = new THREE.Mesh(ellip(e * 0.3, e * 0.82, e * 0.26, 8, 6), mats.pupil);
    pu.position.z = e * 0.36;
    eg.add(pu);
    const gl = new THREE.Mesh(new THREE.SphereGeometry(e * 0.17, 6, 4), mats.glint);
    gl.position.set(e * 0.32, e * 0.38, e * 0.5);
    eg.add(gl);
    parent.add(eg);
    eyes.push(eg);
  }
  const ears = [];
  const E = H.ear;
  for (const s of [-1, 1]) {
    const eg = new THREE.Group();
    eg.position.set(cx + s * r * 0.5, cy + r * 0.58, cz - r * 0.05);
    eg.rotation.set(-0.1, -s * 0.15, -s * 0.3);
    const outer = new THREE.Mesh(new THREE.ConeGeometry(E * 0.55, E, 4, 1).rotateY(Math.PI / 4).translate(0, E * 0.5, 0).scale(1, 1, 0.5), mats.fur);
    outer.userData = { fur: true, part: 'ear' };
    eg.add(outer);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(E * 0.38, E * 0.75, 4, 1).rotateY(Math.PI / 4).translate(0, E * 0.4, 0).scale(1, 1, 0.25), mats.inner);
    inner.position.z = E * 0.13;
    eg.add(inner);
    parent.add(eg);
    ears.push(eg);
  }
  const wp = [];
  const wl = H.whisker || r * 1.2;
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const x0 = cx + s * r * 0.3, y0 = cy - r * 0.28 - k * r * 0.06, z0 = cz + r * 0.9;
      wp.push(x0, y0, z0, x0 + s * wl, y0 + (0.6 - k * 0.6) * r * 0.35, z0 - r * 0.25);
    }
  }
  whiskers(parent, mats, wp);
  return { jaw, eyes, ears };
}

// Tom: big cartoon eyes with green irises, white muzzle, brows and a hair tuft.
function buildToonHead(parent, mats, H) {
  const [cx, cy, cz] = H.c;
  const r = H.r;
  fur(parent, ellip(r * 1.04, r * 0.9, r * 0.88, 28, 20), mats, 'head', cx, cy, cz);
  for (const s of [-1, 1]) {
    fur(parent, ellip(r * 0.46, r * 0.36, r * 0.42, 18, 14), mats, 'head', cx + s * r * 0.55, cy - r * 0.26, cz + r * 0.12);
    // spiky cheek tufts
    for (let k = 0; k < 2; k++) {
      const tuft = fur(parent, new THREE.ConeGeometry(r * 0.11, r * 0.34, 10).translate(0, r * 0.17, 0), mats, 'head', cx + s * r * 0.9, cy - r * (0.22 + k * 0.17), cz + r * 0.05);
      tuft.rotation.z = -s * (1.35 + k * 0.35);
    }
  }
  // white muzzle that wraps the lower face, chin and a smile line
  fur(parent, ellip(r * 0.52, r * 0.36, r * 0.4, 22, 16), mats, 'muzzle', cx, cy - r * 0.34, cz + r * 0.56);
  plain(parent, ellip(r * 0.2, r * 0.09, r * 0.16, 12, 8), mats.mouth, cx, cy - r * 0.5, cz + r * 0.78);
  const [jaw, jawIn] = pivot(parent, cx, cy - r * 0.46, cz + r * 0.5);
  fur(jawIn, ellip(r * 0.3, r * 0.13, r * 0.26, 16, 12), mats, 'muzzle', cx, cy - r * 0.56, cz + r * 0.66);
  const smile = new THREE.Mesh(new THREE.TorusGeometry(r * 0.2, r * 0.016, 6, 16, Math.PI * 0.8).rotateZ(Math.PI * 1.1), mats.brow);
  smile.position.set(cx, cy - r * 0.32, cz + r * 0.93);
  smile.rotation.x = -0.25;
  parent.add(smile);
  plain(parent, ellip(r * 0.11, r * 0.075, r * 0.08, 14, 10), mats.nose, cx, cy - r * 0.17, cz + r * 0.95);

  const eyes = [];
  const e = H.eye;
  for (const s of [-1, 1]) {
    const eg = new THREE.Group();
    eg.position.set(cx + s * e * 0.92, cy + r * 0.12, cz + r * 0.8);
    eg.rotation.y = s * 0.18;
    eg.add(new THREE.Mesh(ellip(e, e * 1.22, e * 0.5, 22, 16), mats.eye));
    const iris = new THREE.Mesh(ellip(e * 0.46, e * 0.5, e * 0.2, 16, 12), mats.iris);
    iris.position.set(-s * e * 0.12, -e * 0.08, e * 0.42);
    eg.add(iris);
    const pu = new THREE.Mesh(ellip(e * 0.24, e * 0.28, e * 0.12, 12, 10), mats.pupil);
    pu.position.set(-s * e * 0.12, -e * 0.08, e * 0.56);
    eg.add(pu);
    const gl = new THREE.Mesh(new THREE.SphereGeometry(e * 0.09, 8, 6), mats.glint);
    gl.position.set(-s * e * 0.02, e * 0.08, e * 0.6);
    eg.add(gl);
    parent.add(eg);
    eyes.push(eg);
    const brow = new THREE.Mesh(new THREE.TorusGeometry(e * 1.0, r * 0.022, 6, 14, Math.PI * 0.55), mats.brow);
    brow.position.set(cx + s * e * 0.95, cy + r * 0.12 + e * 0.5, cz + r * 0.83);
    brow.rotation.set(-0.35, 0, Math.PI / 2 - Math.PI * 0.275 + s * 0.12);
    parent.add(brow);
  }
  // hair tuft on top
  for (let k = -1; k <= 1; k++) {
    const t = fur(parent, new THREE.ConeGeometry(r * 0.09, r * 0.5, 10).translate(0, r * 0.25, 0), mats, 'head', cx + k * r * 0.07, cy + r * 0.78, cz - r * 0.05);
    t.rotation.set(-0.5 - Math.abs(k) * 0.2, 0, -k * 0.45);
  }

  const ears = [];
  const E = H.ear;
  for (const s of [-1, 1]) {
    const eg = new THREE.Group();
    eg.position.set(cx + s * r * 0.62, cy + r * 0.5, cz - r * 0.06);
    eg.rotation.set(-0.08, -s * 0.25, -s * 0.42);
    const outer = new THREE.Mesh(new THREE.ConeGeometry(E * 0.55, E, 18, 3).translate(0, E * 0.5, 0).scale(1, 1, 0.4), mats.fur);
    outer.userData = { fur: true, part: 'ear' };
    outer.castShadow = true;
    eg.add(outer);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(E * 0.42, E * 0.8, 18, 2).translate(0, E * 0.43, 0).scale(1, 1, 0.2), mats.inner);
    inner.position.z = E * 0.12;
    eg.add(inner);
    parent.add(eg);
    ears.push(eg);
  }
  const wp = [];
  const wl = H.whisker || r * 1.4;
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const x0 = cx + s * r * 0.32, y0 = cy - r * 0.28 - k * r * 0.07, z0 = cz + r * 0.86;
      wp.push(x0, y0, z0, x0 + s * wl, y0 + (0.7 - k * 0.7) * r * 0.45, z0 - r * 0.2);
    }
  }
  whiskers(parent, mats, wp);
  return { jaw, eyes, ears };
}

// ---------------------------------------------------------------------------
// Base rig with shared idle behaviour
// ---------------------------------------------------------------------------
class Rig {
  constructor(skin) {
    this.skin = skin;
    this.mats = makeMats(skin);
    this.root = new THREE.Group();
    this.phase = 0;
    this.blinkT = 1 + Math.random() * 3;
    this.blink = 1;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.lookTarget = [0, 0];
    this.lookT = 2;
    this.earT = 1.5;
    this.earFlick = 0;
  }

  idle(dt, st) {
    this.blinkT -= dt;
    if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 4;
    const closing = this.blinkT < 0.13;
    const open = closing ? 0.1 : 1;
    this.blink = lerp(open, 0.08, st.sleepW);
    for (const e of this.eyes) e.scale.y = this.blink;
    this.lookT -= dt;
    if (this.lookT < 0) {
      this.lookT = 2 + Math.random() * 4;
      this.lookTarget = Math.random() < 0.4 ? [0, 0] : [(Math.random() - 0.5) * 1.3, (Math.random() - 0.5) * 0.4];
    }
    this.lookYaw = damp(this.lookYaw, this.lookTarget[0], 3, dt);
    this.lookPitch = damp(this.lookPitch, this.lookTarget[1], 3, dt);
    this.earT -= dt;
    if (this.earT < 0) {
      this.earT = 1.5 + Math.random() * 4;
      this.earFlick = 1;
      this.earSide = Math.random() < 0.5 ? 0 : 1;
    }
    this.earFlick = Math.max(0, this.earFlick - dt * 6);
    this.ears.forEach((ear, i) => {
      const f = i === this.earSide ? Math.sin(this.earFlick * Math.PI) * 0.35 : 0;
      ear.rotation.x = -0.1 - st.meowW * 0.35 + f + st.sleepW * 0.25;
    });
    this.mats.eye.emissiveIntensity = (this.skin.toon ? 0.35 : 0) + (this.skin.glowEyes ? 1.6 : 0.5) * st.night * (1 - st.sleepW);
    if (this.skin.toon) this.mats.iris.emissiveIntensity = 0;
    if (this.jaw) this.jaw.rotation.x = st.meowW * 0.55;
  }

  headWorld(out) {
    return this.headPivot.getWorldPosition(out);
  }

  dispose() {
    this.root.traverse((o) => o.geometry && o.geometry.dispose());
    Object.values(this.mats).forEach((m) => m.dispose());
  }
}

// ---------------------------------------------------------------------------
// Four-legged cats (kitten / chonk)
// ---------------------------------------------------------------------------
const SHAPES = {
  kitten: {
    bodyY: 0.4, bodyR: [0.14, 0.145, 0.33], taper: 0.08, legTop: 0.37, upper: 0.17, lower: 0.165,
    legR: 0.042, pawR: 0.048, legX: 0.08, frontZ: 0.2, backZ: -0.21, thigh: 1.0,
    head: { pivot: [0, 0.5, 0.28], off: [0, 0.1, 0.1], r: 0.13, eye: 0.033, ear: 0.12, cheek: 1.0, whisker: 0.17 },
    neck: [0.075, 0.09, 0.1],
    tail: { base: [0, 0.46, -0.31], segs: 8, len: 0.6, r0: 0.034, r1: 0.018, x0: -0.55, dx: 0.07, rings: 7 },
    walk: 1.9, run: 4.6, stride: [0.95, 1.6], camH: 0.45, radius: 0.28, wing: { pos: [0, 0.53, 0.1], scale: 0.9 }, jump: 4.6,
  },
  chonk: {
    bodyY: 0.33, bodyR: [0.25, 0.22, 0.33], taper: 0.04, tuck: 0.15, legTop: 0.215, upper: 0.1, lower: 0.09,
    legR: 0.05, pawR: 0.055, legX: 0.14, frontZ: 0.19, backZ: -0.19, thigh: 1.2,
    head: { pivot: [0, 0.44, 0.27], off: [0, 0.1, 0.11], r: 0.185, eye: 0.047, ear: 0.11, cheek: 1.25, whisker: 0.2 },
    neck: [0.13, 0.13, 0.11],
    tail: { base: [0, 0.36, -0.3], segs: 6, len: 0.36, r0: 0.05, r1: 0.03, x0: -1.75, dx: 0.1, rings: 5 },
    walk: 1.45, run: 3.3, stride: [0.7, 1.1], camH: 0.48, radius: 0.34, wing: { pos: [0, 0.53, 0.05], scale: 1.05 }, jump: 3.6,
  },
  // the OIIA cat: a round tabby on slim legs, big head
  oiia: {
    bodyY: 0.39, bodyR: [0.22, 0.2, 0.33], taper: 0.06, tuck: 0.3, legTop: 0.29, upper: 0.14, lower: 0.13,
    legR: 0.042, pawR: 0.05, legX: 0.12, frontZ: 0.2, backZ: -0.2, thigh: 1.1,
    head: { pivot: [0, 0.5, 0.29], off: [0, 0.1, 0.1], r: 0.165, eye: 0.04, ear: 0.13, cheek: 1.15, whisker: 0.2 },
    neck: [0.11, 0.12, 0.11],
    tail: { base: [0, 0.42, -0.31], segs: 7, len: 0.42, r0: 0.042, r1: 0.024, x0: -1.9, dx: 0.12, rings: 6 },
    walk: 1.7, run: 4.0, stride: [0.85, 1.35], camH: 0.5, radius: 0.32, wing: { pos: [0, 0.57, 0.06], scale: 1.0 }, jump: 4.0,
  },
};

const WALK_OFF = [0.25, 0.75, 0.0, 0.5]; // FL FR BL BR
const RUN_OFF = [0.0, 0.12, 0.5, 0.62];

class QuadRig extends Rig {
  constructor(skin) {
    super(skin);
    const S = (this.S = SHAPES[skin.shape]);
    this.cfg = { walk: S.walk, run: S.run, jump: S.jump, camH: S.camH, radius: S.radius, wingScale: S.wing.scale };
    const M = this.mats;
    const [rx, ry, rz] = S.bodyR;
    const [body, bodyIn] = pivot(this.root, 0, S.legTop, S.backZ);
    this.body = body;
    this.bodyBase = body.position.clone();

    // one continuous torso that flows into the neck
    const hp = S.head.pivot;
    const hc = [hp[0] + S.head.off[0], hp[1] + S.head.off[1], hp[2] + S.head.off[2]];
    const Y = S.bodyY;
    const tuck = S.tuck ?? 1;
    fur(bodyIn, loft([
      [0, Y + ry * 0.12, -rz * 1.1, rx * 0.3, ry * 0.32],
      [0, Y + ry * 0.04, -rz * 0.97, rx * 0.74, ry * 0.76],
      [0, Y, -rz * 0.7, rx * 0.98, ry * 0.97],
      [0, Y + ry * 0.04 * tuck, -rz * 0.36, rx * 0.93, ry * (1 - 0.1 * tuck)],
      [0, Y + ry * 0.1 * tuck, 0, rx * (1 - 0.1 * tuck), ry * (1 - 0.2 * tuck)],
      [0, Y + ry * 0.04, rz * 0.34, rx * 0.96, ry * 0.95],
      [0, Y - ry * 0.02, rz * 0.62, rx, ry * 1.02],
      [0, Y + ry * 0.2, rz * 0.86, rx * 0.8, ry * 0.84],
      [0, lerp(Y + ry * 0.3, hc[1], 0.5), lerp(rz, hc[2], 0.35), S.neck[0] * 1.1, S.neck[1] * 1.1],
      [0, hc[1] - S.head.r * 0.25, hc[2] - S.head.r * 0.35, S.neck[0], S.neck[1]],
    ], 24, 5), M, 'body', 0, 0, 0);

    // head
    const [head, headIn] = pivot(bodyIn, ...hp);
    this.headPivot = head;
    Object.assign(this, buildHead(headIn, M, { ...S.head, c: hc }));

    // legs: FL FR BL BR — shoulder/thigh, forearm/shin, paw with toes
    this.legs = [];
    const spots = [
      [-S.legX, S.frontZ, false], [S.legX, S.frontZ, false],
      [-S.legX, S.backZ, true], [S.legX, S.backZ, true],
    ];
    for (const [x, z, back] of spots) {
      const r = S.legR;
      const th = S.thigh;
      const kneeY = S.legTop - S.upper;
      const [upper, upIn] = pivot(bodyIn, x, S.legTop, z);
      if (back) {
        fur(upIn, loft([
          [x, S.legTop + r * 1.3, z + r * 0.5, r * 2.0 * th, r * 2.5 * th],
          [x, S.legTop - S.upper * 0.25, z + r * 0.35, r * 1.85 * th, r * 2.3 * th],
          [x, S.legTop - S.upper * 0.7, z, r * 1.1, r * 1.25],
          [x, kneeY, z, r * 0.82, r * 0.88],
        ], 16, 4), M, 'leg', 0, 0, 0);
      } else {
        fur(upIn, loft([
          [x, S.legTop + r * 1.3, z, r * 1.45, r * 1.75],
          [x, S.legTop - S.upper * 0.3, z, r * 1.12, r * 1.3],
          [x, kneeY, z, r * 0.86, r * 0.9],
        ], 16, 4), M, 'leg', 0, 0, 0);
      }
      const [knee, knIn] = pivot(upIn, x, kneeY, z);
      fur(knIn, loft([
        [x, kneeY + r * 0.3, z, r * 0.86, r * 0.9],
        [x, kneeY - S.lower * 0.5, z, r * 0.72, r * 0.78],
        [x, kneeY - S.lower + S.pawR * 0.3, z + 0.004, r * 0.72, r * 0.76],
      ], 14, 4), M, 'leg', 0, 0, 0);
      const py = kneeY - S.lower;
      fur(knIn, ellip(S.pawR, S.pawR * 0.6, S.pawR * 1.2, 18, 12), M, 'leg', x, py, z + S.pawR * 0.3);
      for (const tx of [-1, 0, 1]) fur(knIn, ellip(S.pawR * 0.36, S.pawR * 0.34, S.pawR * 0.4, 10, 8), M, 'leg', x + tx * S.pawR * 0.5, py - S.pawR * 0.12, z + S.pawR * 1.2);
      this.legs.push({ upper, knee, back });
    }

    // tail chain
    const T = S.tail;
    this.tail = [];
    let parent = bodyIn;
    const segLen = T.len / T.segs;
    for (let i = 0; i < T.segs; i++) {
      const g = new THREE.Group();
      if (i === 0) g.position.set(...T.base);
      else g.position.set(0, segLen, 0);
      g.rotation.x = i === 0 ? T.x0 : T.dx;
      const r0 = lerp(T.r0, T.r1, i / T.segs);
      const r1 = lerp(T.r0, T.r1, (i + 1) / T.segs);
      const ud = { u0: i / T.segs, u1: (i + 1) / T.segs, len: segLen * 1.08, rings: T.rings };
      fur(g, cylUp(r0, r1 * (i === T.segs - 1 ? 0.6 : 1), segLen * 1.08, 12), M, 'tail', 0, 0, 0, ud);
      fur(g, ellip(r0, r0, r0, 12, 8), M, 'tail', 0, 0, 0, { ...ud, len: 1e3 });
      if (i === T.segs - 1) fur(g, ellip(r1 * 0.75, r1 * 1.1, r1 * 0.75, 12, 8), M, 'tail', 0, segLen * 1.05, 0, { ...ud, u0: ud.u1, len: 1e3 });
      parent.add(g);
      parent = g;
      this.tail.push(g);
    }

    this.wingMount = new THREE.Group();
    this.wingMount.position.set(...S.wing.pos);
    bodyIn.add(this.wingMount);
    this.cfg.halfWidth = rx;

    const headY = hc[1], headZ = hc[2], hr = S.head.r;
    paint(this.root, skin, {
      bodyY: S.bodyY, bodyH: ry, headY, headZ, headR: hr,
      chest: { c: [0, S.bodyY + ry * 0.05, rz * 0.95], r: [rx * 0.72, ry * 1.15, rz * 0.42] },
      belly: { c: [0, S.bodyY - ry * 0.85, 0], r: [rx * 0.7, ry * 0.45, rz * 0.8] },
      muzzle: { c: [0, headY - hr * 0.42, headZ + hr * 0.62], r: [hr * 0.55, hr * 0.42, hr * 0.5] },
    });
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  update(dt, st) {
    const S = this.S;
    const t = st.time;
    // spin cats use "hold E" to whirl instead of grooming
    const sw = this.skin.hold === 'spin' ? st.groomW : 0;
    if (sw) st = { ...st, groomW: 0 };
    this.idle(dt, st);
    if (sw > 0.05) this.spinAngle = (this.spinAngle || 0) + dt * (15 + Math.sin(t * 1.9) * 6) * sw;
    else if (this.spinAngle) this.spinAngle = damp(this.spinAngle, Math.round(this.spinAngle / (Math.PI * 2)) * Math.PI * 2, 6, dt);
    const walkN = clamp(st.speed / S.walk, 0, 1);
    const runN = clamp((st.speed - S.walk) / (S.run - S.walk), 0, 1);
    const groundW = clamp(1 - st.airW - st.flyW, 0, 1);
    const move = walkN * groundW * (1 - st.sleepW) * (1 - st.sitW);
    const stride = lerp(S.stride[0], S.stride[1], runN);
    if (move > 0.01) this.phase += dt * (st.speed / stride) * Math.PI * 2;
    const amp = lerp(0.42, 0.75, runN) * move;
    const knee = lerp(0.6, 1.0, runN) * move;
    const sitPitch = -0.62;
    const lick = Math.max(0, Math.sin(t * 9));

    this.legs.forEach((leg, i) => {
      const front = !leg.back;
      const ph = this.phase + lerp(WALK_OFF[i], RUN_OFF[i], runN) * Math.PI * 2;
      let up = -Math.sin(ph) * amp;
      let kn = Math.max(0, Math.cos(ph)) * knee + (leg.back ? -0.05 : 0.04) * groundW;
      up = lerp(up, front ? -0.55 : 0.6, st.airW);
      kn = lerp(kn, front ? 0.35 : 0.3, st.airW);
      up = lerp(up, front ? -0.1 : 0.95, st.flyW);
      kn = lerp(kn, front ? 1.6 : 0.35, st.flyW);
      up = lerp(up, front ? -1.35 : 0.95, st.pounceW || 0);
      kn = lerp(kn, front ? 0.1 : 0.2, st.pounceW || 0);
      if (front) {
        const groomPaw = i === 1 ? st.groomW : 0;
        up = lerp(up, lerp(-sitPitch, -1.25, groomPaw), st.sitW);
        kn = lerp(kn, lerp(0.02, 2.2 + lick * 0.15, groomPaw), st.sitW);
        up = lerp(up, 1.2, st.sleepW);
        kn = lerp(kn, -2.4, st.sleepW);
      } else {
        up = lerp(up, -1.0, st.sitW);
        kn = lerp(kn, 2.35, st.sitW);
        up = lerp(up, -1.3, st.sleepW);
        kn = lerp(kn, 2.5, st.sleepW);
      }
      leg.upper.rotation.x = up;
      leg.knee.rotation.x = kn;
      // OIIA loaf: legs tuck away completely while spinning
      leg.upper.scale.setScalar(sw > 0.001 ? Math.max(0.001, 1 - sw * 1.05) : 1);
    });

    // body
    const bob = -Math.abs(Math.sin(this.phase)) * 0.014 * move;
    const sitDrop = (S.legTop - 0.13 * (S.legTop / 0.37)) * st.sitW;
    const sleepDrop = Math.max((S.bodyY - S.bodyR[1] - 0.025) * st.sleepW, (S.bodyY - S.bodyR[1] * 0.95) * sw);
    const breathe = Math.sin(t * (st.sleepW > 0.5 ? 1.6 : 2.4)) * 0.006;
    const hop = 0;
    this.body.position.set(0, this.bodyBase.y + bob - sitDrop * (1 - st.sleepW) - sleepDrop + breathe + hop, this.bodyBase.z);
    let pitch = st.slope * groundW * (1 - st.sleepW);
    pitch += clamp(-st.vy * 0.05, -0.35, 0.35) * st.airW;
    pitch += (clamp(-st.vy * 0.08, -0.5, 0.5) + 0.05 * st.speed / S.run) * st.flyW;
    pitch = lerp(pitch, sitPitch, st.sitW * (1 - st.sleepW));
    pitch = lerp(pitch, 0.12, st.pounceW || 0);
    this.body.rotation.x = pitch;
    this.body.rotation.z = clamp(-st.turn * 0.06, -0.15, 0.15) * (1 - st.sleepW);

    // head
    const freeLook = (1 - move) * (1 - st.sleepW) * (1 - st.groomW);
    let hx = this.lookPitch * freeLook - pitch * 0.6 - st.meowW * 0.4 + Math.abs(Math.sin(this.phase)) * 0.04 * move;
    hx = lerp(hx, 0.45, st.sleepW);
    hx += st.groomW * (0.42 + lick * 0.1);
    let hy = this.lookYaw * freeLook + st.turn * 0.12 * (1 - st.sleepW);
    hy = lerp(hy, 0.35, st.sleepW) - st.groomW * 0.32;
    hx -= sw * (0.18 + Math.sin(t * 7) * 0.08);
    this.headPivot.rotation.set(hx, hy, st.sleepW * 0.25 + st.groomW * 0.15);
    if (this.jaw) this.jaw.rotation.x = st.meowW * 0.55 + st.groomW * lick * 0.18 + sw * (0.25 + Math.abs(Math.sin(t * 13)) * 0.3);

    // tail
    const n = this.tail.length;
    const T = S.tail;
    this.tail.forEach((seg, i) => {
      const k = (i + 1) / n;
      const sway = Math.sin(t * lerp(1.3, 3.2, move) - i * 0.5) * lerp(0.1, 0.18, move) * k;
      let rx = i === 0 ? T.x0 : T.dx;
      rx = lerp(rx, i === 0 ? -1.45 : 0.02 + Math.sin(t * 6 - i) * 0.05, st.flyW);
      rx = lerp(rx, i === 0 ? T.x0 - 0.5 : T.dx * 0.6, st.sitW * (1 - st.sleepW));
      rx = lerp(rx, i === 0 ? -1.62 : 0, st.sleepW);
      rx = lerp(rx, i === 0 ? -1.62 : 0, sw);
      seg.rotation.x = rx;
      seg.rotation.z = lerp(sway, i === 0 ? 0 : 0.36, Math.max(st.sleepW, sw));
    });
  }
}

// ---------------------------------------------------------------------------
// Two-legged cats: Buff (flexes) and Tom (sneaks, flies with a bat cape).
// ---------------------------------------------------------------------------
const BIPEDS = {
  buff: {
    scale: 1.12, hipY: 0.52,
    cfg: { walk: 2.0, run: 5.4, jump: 4.8, camH: 1.1, radius: 0.34, wingScale: 1.15, thumbK: 1.8, halfWidth: 0.16 },
    pelvis: [0.16, 0.11, 0.12],
    torso: { y: 0.82, ry: 0.26, w0: 0.14, w1: 0.27, pow: 2, z0: 0.12, z1: 0.155 },
    pecs: true, traps: [0.15, 0.085, 0.1], delts: [0.11, 0.1, 0.105], shoulderX: 0.27, shoulderY: 1.0,
    armX: 0.29, upper: [0.078, 0.064], bicep: [0.09, 0.1, 0.088], fore: [0.068, 0.05], foreBulge: [0.07, 0.085, 0.07], hand: [0.058, 0.06, 0.058],
    legX: 0.1, thigh: [0.085, 0.064], thighBulge: [0.098, 0.13, 0.1], shin: [0.058, 0.045], foot: [0.055, 0.035, 0.085],
    headPivot: [0, 1.1, 0], head: { c: [0, 1.22, 0.04], r: 0.15, eye: 0.033, ear: 0.12, cheek: 1.05, whisker: 0.19 },
    tail: { base: [0, 0.56, -0.11], segs: 5, len: 0.32, r0: 0.04, r1: 0.025, x0: -2.5, dx: 0.14 },
    wing: [0, 1.0, -0.12], fly: 'superman', hold: 'flex',
  },
  tom: {
    scale: 1.05, hipY: 0.52,
    cfg: { walk: 2.0, run: 5.0, jump: 4.6, camH: 1.05, radius: 0.3, wingScale: 1, thumbK: 1.75, halfWidth: 0.14 },
    pelvis: [0.13, 0.1, 0.11],
    torso: { y: 0.74, ry: 0.31, w0: 0.168, w1: 0.105, pow: 1, z0: 0.155, z1: 0.095 },
    pecs: false, traps: null, delts: [0.047, 0.05, 0.046], shoulderX: 0.125, shoulderY: 0.955,
    armX: 0.125, upper: [0.04, 0.036], bicep: null, fore: [0.036, 0.034], foreBulge: null, hand: [0.06, 0.062, 0.036], glove: true,
    legX: 0.085, thigh: [0.058, 0.05], thighBulge: [0.07, 0.11, 0.075], shin: [0.05, 0.046], foot: [0.075, 0.045, 0.135], toonFeet: true,
    headPivot: [0, 1.03, 0], head: { c: [0, 1.22, 0.05], r: 0.19, eye: 0.062, ear: 0.17, cheek: 1.3, whisker: 0.27, style: 'toon' },
    tail: { base: [0, 0.5, -0.12], segs: 10, len: 0.85, r0: 0.034, r1: 0.022, x0: -2.4, dx: 0.17 },
    wing: [0, 0.96, -0.02], fly: 'cape', hold: 'sneak',
    belly: { c: [0, 0.71, 0.13], r: [0.12, 0.29, 0.1] },
  },
};

class BipedRig extends Rig {
  constructor(skin) {
    super(skin);
    const M = this.mats;
    const B = (this.B = BIPEDS[skin.shape || 'buff']);
    this.cfg = { ...B.cfg };
    const hipY = (this.hipY = B.hipY);
    const [body, bodyIn] = pivot(this.root, 0, hipY, 0);
    this.body = body;
    fur(bodyIn, ellip(...B.pelvis, 10, 8), M, 'body', 0, 0.56, 0);

    const [chest, chestIn] = pivot(bodyIn, 0, 0.6, 0);
    this.chest = chest;
    const T = B.torso;
    const tg = new THREE.SphereGeometry(1, 26, 20);
    const p = tg.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = (y + 1) / 2;
      p.setXYZ(i, x * lerp(T.w0, T.w1, Math.pow(k, T.pow)), y * T.ry, z * lerp(T.z0, T.z1, k));
    }
    tg.computeVertexNormals();
    fur(chestIn, tg, M, 'body', 0, T.y, 0);
    if (B.pecs) {
      for (const s of [-1, 1]) fur(chestIn, ellip(0.115, 0.085, 0.07, 8, 6), M, 'body', s * 0.09, 0.93, 0.09);
      for (const s of [-1, 1]) fur(chestIn, ellip(0.045, 0.035, 0.03, 6, 4), M, 'body', s * 0.045, 0.75, 0.115);
    }
    if (B.traps) fur(chestIn, ellip(...B.traps, 8, 6), M, 'body', 0, 1.06, -0.015);
    if (B.delts) for (const s of [-1, 1]) fur(chestIn, ellip(...B.delts, 16, 12), M, 'body', s * B.shoulderX, B.shoulderY, 0);

    this.arms = [];
    this.biceps = [];
    const sy = B.shoulderY, ey = sy - 0.22, hy = ey - 0.215;
    for (const s of [-1, 1]) {
      const ax = s * B.armX;
      const [arm, armIn] = pivot(chestIn, ax, sy, 0);
      fur(armIn, cylDown(...B.upper, 0.22), M, 'leg', ax, sy, 0);
      if (B.bicep) {
        this.biceps.push(fur(armIn, ellip(...B.bicep, 8, 6), M, 'leg', ax, sy - 0.11, 0.03));
        fur(armIn, ellip(0.075, 0.09, 0.07, 8, 6), M, 'leg', ax, sy - 0.1, -0.03);
      }
      const [elbow, elIn] = pivot(armIn, ax, ey, 0);
      fur(elIn, cylDown(...B.fore, 0.2), M, 'leg', ax, ey, 0);
      if (B.foreBulge) fur(elIn, ellip(...B.foreBulge, 8, 6), M, 'leg', ax, ey - 0.06, 0.01);
      if (B.glove) {
        // cartoon glove: palm, thumb and three chunky fingers
        fur(elIn, ellip(...B.hand, 18, 14), M, 'paw', ax, hy + 0.01, 0.005);
        fur(elIn, ellip(0.02, 0.034, 0.02, 12, 10), M, 'paw', ax - s * 0.045, hy + 0.0, 0.03);
        for (const k of [-1, 0, 1]) fur(elIn, ellip(0.019, 0.04, 0.02, 12, 10), M, 'paw', ax + k * 0.026 * s, hy - 0.06, 0.005);
      } else {
        fur(elIn, ellip(...B.hand, 14, 10), M, 'paw', ax, hy, 0.005);
      }
      this.arms.push({ arm, elbow, s });
    }

    const hc = B.head.c;
    const [head, headIn] = pivot(chestIn, ...B.headPivot);
    this.headPivot = head;
    Object.assign(this, buildHead(headIn, M, { ...B.head }));

    this.legs = [];
    for (const s of [-1, 1]) {
      const lx = s * B.legX;
      const [thigh, thIn] = pivot(bodyIn, lx, hipY, 0);
      fur(thIn, cylDown(...B.thigh, 0.25), M, 'leg', lx, hipY, 0);
      fur(thIn, ellip(...B.thighBulge, 8, 6), M, 'leg', lx, hipY - 0.09, 0.015);
      const [knee, knIn] = pivot(thIn, lx, hipY - 0.25, 0);
      fur(knIn, cylDown(...B.shin, 0.23), M, 'leg', lx, hipY - 0.25, 0);
      const fy = Math.max(0.035, B.foot[1]);
      fur(knIn, ellip(...B.foot, 18, 12), M, 'paw', lx, fy, B.foot[2] * 0.35);
      if (B.toonFeet) for (const k of [-1, 0, 1]) fur(knIn, ellip(0.028, 0.03, 0.03, 12, 8), M, 'paw', lx + k * 0.04, fy - 0.005, B.foot[2] * 1.2);
      this.legs.push({ thigh, knee });
    }

    this.tail = [];
    let parent = bodyIn;
    const TL = B.tail;
    const segLen = TL.len / TL.segs;
    for (let i = 0; i < TL.segs; i++) {
      const g = new THREE.Group();
      if (i === 0) g.position.set(...TL.base);
      else g.position.set(0, segLen, 0);
      g.rotation.x = i === 0 ? TL.x0 : TL.dx;
      fur(g, cylUp(lerp(TL.r0, TL.r1, i / TL.segs), lerp(TL.r0, TL.r1, (i + 1) / TL.segs), segLen * 1.08, 6), M, 'tail', 0, 0, 0, { u0: i / TL.segs, u1: (i + 1) / TL.segs, len: segLen, rings: 0 });
      parent.add(g);
      parent = g;
      this.tail.push(g);
    }

    this.wingMount = new THREE.Group();
    this.wingMount.position.set(...B.wing);
    chestIn.add(this.wingMount);

    const hr = B.head.r;
    paint(this.root, skin, {
      bodyY: T.y, bodyH: T.ry, headY: hc[1], headZ: hc[2], headR: hr,
      chest: B.belly,
      muzzle: { c: [0, hc[1] - hr * 0.42, hc[2] + hr * 0.62], r: [hr * 0.6, hr * 0.42, hr * 0.5] },
    });
    this.root.scale.setScalar(B.scale);
  }

  update(dt, st) {
    const t = st.time;
    const B = this.B;
    this.idle(dt, st);
    const C = this.cfg;
    const walkN = clamp(st.speed / C.walk, 0, 1);
    const runN = clamp((st.speed - C.walk) / (C.run - C.walk), 0, 1);
    const groundW = clamp(1 - st.airW - st.flyW, 0, 1);
    const move = walkN * groundW * (1 - st.sleepW);
    const stride = lerp(1.05, 1.9, runN);
    if (move > 0.01) this.phase += dt * (st.speed / stride) * Math.PI * 2;
    const amp = lerp(0.5, 0.95, runN) * move;
    const hold = st.groomW;
    const flex = B.hold === 'flex' ? hold : 0;
    const sneak = B.hold === 'sneak' ? hold : 0;
    const cape = B.fly === 'cape';
    const pw = st.pounceW || 0;

    this.legs.forEach((leg, i) => {
      const ph = this.phase + i * Math.PI;
      let th = -Math.sin(ph) * amp;
      let kn = Math.max(0, Math.cos(ph)) * lerp(0.7, 1.4, runN) * move + 0.05;
      th = lerp(th, -0.75, st.airW);
      kn = lerp(kn, 1.3, st.airW);
      th = lerp(th, cape ? 0.25 + Math.sin(t * 2 + i) * 0.1 : 0.1 + Math.sin(t * 2 + i) * 0.08, st.flyW);
      kn = lerp(kn, cape ? 0.4 : 0.15, st.flyW);
      th = lerp(th, -0.55, sneak);
      kn = lerp(kn, 0.95, sneak);
      th = lerp(th, -1.5, st.sleepW);
      kn = lerp(kn, 0.06, st.sleepW);
      leg.thigh.rotation.x = th;
      leg.knee.rotation.x = kn;
    });

    const pump = 1 + Math.sin(t * 7) * 0.07 * flex;
    const flapA = st.wingFlap || 0;
    this.arms.forEach(({ arm, elbow, s }, i) => {
      const ph = this.phase + (i === 0 ? Math.PI : 0);
      let ax = Math.sin(ph) * lerp(0.4, 0.9, runN) * move;
      let az = s * (B.pecs ? 0.24 : 0.12);
      let ex = -0.25 - runN * 0.9 * move;
      let ez = 0;
      ax = lerp(ax, -0.3, st.airW);
      az = lerp(az, s * 0.7, st.airW);
      if (cape) {
        ax = lerp(ax, 0, st.flyW);
        az = lerp(az, s * (Math.PI / 2 - 0.08 + flapA), st.flyW);
      } else {
        ax = lerp(ax, i === 1 ? -3.0 : 0.05, st.flyW);
        az = lerp(az, s * 0.12, st.flyW);
      }
      ex = lerp(ex, 0, st.flyW);
      ax = lerp(ax, -0.5, st.sleepW);
      ex = lerp(ex, -0.4, st.sleepW);
      ax = lerp(ax, -1.45, pw);
      az = lerp(az, s * 0.15, pw);
      ex = lerp(ex, -0.25, pw);
      ax = lerp(ax, -0.9, sneak);
      az = lerp(az, s * 0.3, sneak);
      ex = lerp(ex, -1.7, sneak);
      ax = lerp(ax, 0, flex);
      az = lerp(az, s * 1.42, flex);
      ex = lerp(ex, 0, flex);
      ez = lerp(ez, s * 1.7, flex);
      arm.rotation.set(ax, 0, az);
      elbow.rotation.set(ex, 0, ez);
      if (this.biceps[i]) this.biceps[i].scale.setScalar(lerp(1, 1.25, flex) * pump);
    });

    const bob = (Math.cos(this.phase * 2) * 0.5 + 0.5) * 0.025 * move;
    this.body.position.y = lerp(this.hipY + bob - sneak * 0.07, 0.1, st.sleepW);
    let bx = st.slope * 0.3 * groundW;
    bx = lerp(bx, cape ? 0.35 + clamp(-st.vy * 0.05, -0.3, 0.3) : 1.35 + clamp(-st.vy * 0.06, -0.4, 0.4), st.flyW);
    bx = lerp(bx, -0.12, st.sleepW);
    this.body.rotation.x = bx;
    this.body.rotation.z = clamp(-st.turn * 0.05, -0.12, 0.12);
    this.chest.rotation.set(runN * 0.2 * move - flex * 0.12 - st.sleepW * 0.1 + sneak * 0.45 + pw * 0.35, Math.sin(this.phase) * 0.12 * move, 0);

    const freeLook = (1 - move) * (1 - st.sleepW) * (1 - hold);
    let hx = this.lookPitch * freeLook - st.meowW * 0.4 - flex * 0.12 - sneak * 0.4;
    hx = lerp(hx, cape ? -0.3 : -1.15, st.flyW);
    hx = lerp(hx, 0.5, st.sleepW);
    this.headPivot.rotation.set(hx, this.lookYaw * freeLook, st.sleepW * 0.2);

    this.tail.forEach((seg, i) => {
      seg.rotation.z = Math.sin(t * 2 - i * 0.6) * 0.15 * ((i + 1) / this.tail.length);
    });
  }
}

// ---------------------------------------------------------------------------
// Maxwell: a low-poly loaf on tiny scurrying paws.
// ---------------------------------------------------------------------------
class LoafRig extends Rig {
  constructor(skin) {
    super(skin);
    const M = this.mats;
    this.cfg = { walk: 1.6, run: 3.8, jump: 3.9, camH: 0.36, radius: 0.33, wingScale: 1.0 };
    const body = new THREE.Group();
    this.root.add(body);
    this.body = body;
    const bg = new THREE.IcosahedronGeometry(1, 1);
    const p = bg.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i);
      if (y < -0.55) y = -0.55 - (y + 0.55) * 0.25;
      p.setY(i, y);
    }
    bg.scale(0.3, 0.27, 0.42);
    bg.computeVertexNormals();
    fur(body, bg, M, 'body', 0, 0.25, -0.05);

    const hc = [0, 0.34, 0.25];
    const [head, headIn] = pivot(body, 0, 0.27, 0.17);
    this.headPivot = head;
    Object.assign(this, buildHead(headIn, M, { c: hc, r: 0.19, eye: 0.046, ear: 0.13, cheek: 1.3, whisker: 0.32, segs: [8, 6], style: 'low' }));

    this.paws = [];
    const spots = [[-0.13, 0.2], [0.13, 0.2], [-0.13, -0.22], [0.13, -0.22]];
    for (const [x, z] of spots) {
      const [paw, pawIn] = pivot(body, x, 0.08, z);
      fur(pawIn, ellip(0.055, 0.035, 0.07, 7, 5), M, 'leg', x, 0.03, z + 0.03);
      this.paws.push(paw);
    }
    this.legs = [];
    this.wingMount = new THREE.Group();
    this.wingMount.position.set(0, 0.5, -0.02);
    body.add(this.wingMount);
    this.cfg.halfWidth = 0.27;
    this.spin = 0;

    paint(this.root, skin, {
      bodyY: 0.25, bodyH: 0.27, headY: hc[1], headZ: hc[2], headR: 0.19,
      chest: { c: [0, 0.19, 0.3], r: [0.15, 0.15, 0.13] },
      muzzle: { c: [0, hc[1] - 0.08, hc[2] + 0.12], r: [0.12, 0.09, 0.12] },
    });
  }

  update(dt, st) {
    const t = st.time;
    this.idle(dt, st);
    const C = this.cfg;
    const groundW = clamp(1 - st.airW - st.flyW, 0, 1);
    const move = clamp(st.speed / C.walk, 0, 1) * groundW * (1 - st.sleepW);
    if (move > 0.01) this.phase += dt * (st.speed / 0.42) * Math.PI * 2;
    this.paws.forEach((paw, i) => {
      const off = i === 0 || i === 3 ? 0 : Math.PI;
      let x = Math.sin(this.phase + off) * 0.9 * move;
      x = lerp(x, 0.9, st.flyW);
      paw.rotation.x = x;
    });
    const squash = clamp(st.vy * 0.035, -0.14, 0.18) * st.airW;
    const breathe = Math.sin(t * 1.7) * 0.012;
    const sy = 1 + squash - st.sleepW * 0.07 + breathe;
    const pz = 1 + (st.pounceW || 0) * 0.3;
    this.body.scale.set(1 - squash * 0.5, sy / Math.sqrt(pz), (1 - squash * 0.5) * pz);
    this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.025 * move;
    this.body.rotation.z = Math.sin(this.phase) * 0.08 * move;
    let bx = st.slope * 0.5 * groundW;
    bx += clamp(-st.vy * 0.06, -0.45, 0.45) * st.flyW;
    this.body.rotation.x = bx;
    if (st.groomW > 0.05) this.spin += dt * 11 * st.groomW;
    else this.spin = damp(this.spin, Math.round(this.spin / (Math.PI * 2)) * Math.PI * 2, 6, dt);
    this.body.rotation.y = this.spin;
    const freeLook = (1 - move) * (1 - st.sleepW) * (1 - st.groomW);
    this.headPivot.rotation.set(this.lookPitch * freeLook * 0.6 - st.meowW * 0.3 + st.sleepW * 0.25, this.lookYaw * freeLook * 0.5, 0);
  }
}

export function createCat(skin) {
  if (skin.kind === 'biped') return new BipedRig(skin);
  if (skin.kind === 'loaf') return new LoafRig(skin);
  return new QuadRig(skin);
}
