import * as THREE from 'three';

// People built from a character turnaround sheet (front / side / back views
// in one picture) when there is no 3D file. The body is lofted from simple
// cross-sections measured on the sheet, in the sheet's own pixel units, and
// every triangle is textured by projecting the view it faces: front-facing
// triangles take the front picture, back-facing ones the back picture and
// the flanks the side picture. Low-poly flat shading matches the sheets.
//
// Model space while building: x = character's left (pixels from the front
// view's centre line), y = pixels above the feet, z = forward.

const sgnpow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);

class Builder {
  constructor(sheet, prep) {
    this.sheet = sheet;
    this.isBg = prep.isBg;
    this.moved = prep.moved;
    this.texW = prep.width;
    this.pos = [];
    this.uv = [];
    this.part = [];
    this.parts = [];
  }

  // where model point (x, y, z) lands on the sheet in a given view
  project(view, x, y, z) {
    const v = this.sheet.views[view];
    const s = v.s || 1;
    const px = view === 'front' ? v.cx + x * s : view === 'back' ? v.cx - x * s : v.cx - z * s;
    return [px, v.foot - y * s];
  }

  uvAt(px, py) {
    return [px / this.texW, 1 - py / this.sheet.h];
  }

  tri(P, a, b, c, out) {
    // keep the winding facing away from the inside point
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const mid = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);
    if (n.dot(mid.clone().sub(out)) < 0) { const t = b; b = c; c = t; n.negate(); }
    n.normalize();
    let view;
    if (P.views) view = P.views;
    else if (Math.abs(n.z) >= Math.abs(n.x) * (P.bias || 0.9) || n.y > 0.75) view = n.z >= -0.2 || n.y > 0.75 ? 'front' : 'back';
    else view = 'side';
    const [cx, cy] = this.project(view, mid.x, mid.y, mid.z);
    let solid = P.solid;
    for (const m of P.mask || []) if (m[0] === view && cx > m[1] && cx < m[3] && cy > m[2] && cy < m[4]) solid = m[5];
    // a triangle that reaches past the figure into the backdrop gets the part's plain colour
    if (!solid && P.fill && (this.isBg(cx, cy) || [a, b, c].some((q) => this.isBg(...this.project(view, q.x, q.y, q.z))))) solid = P.below && cy > P.below[2] ? P.below : P.fill;
    // parts drawn over an inpainted area read the untouched copy kept beside the sheet
    let shift = 0;
    if (P.keep && view === 'front') for (const m of this.moved) if (cx > m.x0 && cx < m.x1 && cy > m.y0 && cy < m.y1) shift = m.shift;
    for (const p of [a, b, c]) {
      this.pos.push(p.x, p.y, p.z);
      const [px, py] = this.project(view, p.x, p.y, p.z);
      this.uv.push(...(solid ? this.uvAt(...solid) : this.uvAt(px + shift, py)));
      this.part.push(this.parts.length);
    }
  }

  quadStrip(P, ringA, ringB, inside, wrap) {
    const n = ringA.length;
    for (let i = 0; i < (wrap ? n : n - 1); i++) {
      const j = (i + 1) % n;
      this.tri(P, ringA[i], ringB[i], ringB[j], inside);
      this.tri(P, ringA[i], ringB[j], ringA[j], inside);
    }
  }

  cap(P, ring, centre, dir) {
    const out = centre.clone().addScaledVector(dir, -1);
    for (let i = 0; i < ring.length; i++) this.tri(P, centre, ring[i], ring[(i + 1) % ring.length], out);
  }

  // vertical loft: rows of [py, halfWidth, zFront, zBack, xCentre]
  rows(P) {
    const foot = this.sheet.views.front.foot;
    const N = P.segs || 12;
    const a0 = P.arc ? P.arc[0] : 0, a1 = P.arc ? P.arc[1] : Math.PI * 2;
    const wrap = !P.arc;
    const count = wrap ? N : N + 1;
    const rings = P.rows.map(([py, hw, zf, zb, cx = 0]) => {
      const ring = [];
      for (let i = 0; i < count; i++) {
        const t = a0 + ((a1 - a0) * i) / N;
        const s = Math.sin(t), c = Math.cos(t);
        const x = cx + hw * sgnpow(s, P.box || 0.8);
        const z = (c >= 0 ? zf : -zb) * sgnpow(c, P.box || 0.8);
        ring.push(new THREE.Vector3(x, foot - py, z));
      }
      ring.centre = new THREE.Vector3(cx, foot - py, (zf + zb) / 2 * (P.arc ? 0 : 1));
      return ring;
    });
    for (let r = 0; r < rings.length - 1; r++) {
      const inside = rings[r].centre.clone().add(rings[r + 1].centre).multiplyScalar(0.5);
      this.quadStrip(P, rings[r], rings[r + 1], inside, wrap);
    }
    if (wrap && P.capTop !== false) this.cap(P, rings[0], rings[0].centre, new THREE.Vector3(0, 1, 0));
    if (wrap && P.capBottom !== false) this.cap(P, rings.at(-1), rings.at(-1).centre, new THREE.Vector3(0, -1, 0));
    this.parts.push(P);
  }

  // tube along a path of [x, py, z, rx, ry] (ry defaults to rx)
  limb(P) {
    const foot = this.sheet.views.front.foot;
    const N = P.segs || 8;
    const pts = P.path.map(([x, py, z]) => new THREE.Vector3(x, foot - py, z));
    const rings = pts.map((p, k) => {
      const t = new THREE.Vector3().subVectors(pts[Math.min(k + 1, pts.length - 1)], pts[Math.max(k - 1, 0)]).normalize();
      const ref = Math.abs(t.z) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
      const u = new THREE.Vector3().crossVectors(t, ref).normalize();
      const v = new THREE.Vector3().crossVectors(u, t).normalize();
      const rx = P.path[k][3], ry = P.path[k][4] ?? rx;
      const ring = [];
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 + (P.twist || 0);
        ring.push(p.clone().addScaledVector(u, Math.cos(a) * rx).addScaledVector(v, Math.sin(a) * ry));
      }
      ring.t = t;
      return ring;
    });
    for (let r = 0; r < rings.length - 1; r++) {
      const inside = pts[r].clone().add(pts[r + 1]).multiplyScalar(0.5);
      this.quadStrip(P, rings[r], rings[r + 1], inside, true);
    }
    this.cap(P, rings[0], pts[0], rings[0].t.clone().negate());
    this.cap(P, rings.at(-1), pts.at(-1), rings.at(-1).t);
    this.parts.push(P);
  }
}

// Prepares the sheet: finds the backdrop and paints over areas of the front
// view that the pose covers (clasped hands in front of the chest), keeping an
// untouched copy of them beside the sheet for the parts that need it.
function prepare(img, inpaint = []) {
  const w = img.width, h = img.height;
  const pad = 40;
  const extra = inpaint.reduce((s, [x0, , x1]) => s + x1 - x0 + pad * 2 + 4, 0);
  const cv = document.createElement('canvas');
  cv.width = w + extra; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, w, h).data;
  const moved = [];
  let off = w;
  for (const [x0, y0, x1, y1] of inpaint) {
    const bw = x1 - x0 + pad * 2, bh = y1 - y0 + pad * 2;
    ctx.drawImage(img, x0 - pad, y0 - pad, bw, bh, off, y0 - pad, bw, bh);
    moved.push({ x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad, shift: off - (x0 - pad) });
    off += bw + 4;
    // Coons-style fill from the box's four edges
    const fill = ctx.createImageData(x1 - x0, y1 - y0);
    const px = (x, y, k) => d[(y * w + x) * 4 + k];
    for (let y = y0; y < y1; y++) {
      const v = (y - y0 + 0.5) / (y1 - y0);
      for (let x = x0; x < x1; x++) {
        const u = (x - x0 + 0.5) / (x1 - x0);
        const o = ((y - y0) * (x1 - x0) + (x - x0)) * 4;
        for (let k = 0; k < 3; k++) {
          const hz = px(x0 - 1, y, k) * (1 - u) + px(x1, y, k) * u;
          const vt = px(x, y0 - 1, k) * (1 - v) + px(x, y1, k) * v;
          fill.data[o + k] = (hz + vt) / 2;
        }
        fill.data[o + 3] = 255;
      }
    }
    ctx.putImageData(fill, x0, y0);
  }
  return { canvas: cv, width: cv.width, moved, isBg: backdrop(d, w, h) };
}

// Flood-fill the pale, colourless backdrop in from the picture's edges, so
// light parts enclosed by the figure (a white shirt) still count as figure.
function backdrop(d, w, h) {
  const pale = (i) => { const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]; return Math.min(r, g, b) > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 45; };
  const bg = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop();
    if (bg[i] || !pale(i)) continue;
    bg[i] = 1;
    const x = i % w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (i >= w) stack.push(i - w);
    if (i < w * (h - 1)) stack.push(i + w);
  }
  // anti-aliased edge pixels are neither: stay a few pixels clear of the backdrop
  const at = (x, y) => x < 0 || y < 0 || x >= w || y >= h || bg[y * w + x] === 1;
  return (px, py) => {
    const x = Math.round(px), y = Math.round(py);
    return at(x, y) || at(x - 4, y) || at(x + 4, y) || at(x, y - 4) || at(x, y + 4);
  };
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
function segDist(p, a, b) {
  _a.subVectors(b, a);
  const t = THREE.MathUtils.clamp(_b.subVectors(p, a).dot(_a) / Math.max(_a.lengthSq(), 1e-9), 0, 1);
  return _c.copy(a).addScaledVector(_a, t).distanceTo(p);
}

// spec: { sheet: {w, h, views}, H, joints: {name: [parent, at[x,py,z], end[x,py,z]]}, parts: [...] }
export function buildSheetPerson(spec, image) {
  const prep = prepare(image, spec.inpaint);
  const texture = new THREE.CanvasTexture(prep.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const B = new Builder(spec.sheet, prep);
  for (const P of spec.parts) (P.path ? B.limb(P) : B.rows(P));
  const foot = spec.sheet.views.front.foot;
  const top = spec.top;
  const k = spec.H / (foot - top);
  const J = {};
  for (const [n, [parent, at, end]] of Object.entries(spec.joints)) {
    J[n] = { parent, at: new THREE.Vector3(at[0], foot - at[1], at[2]), end: new THREE.Vector3(end[0], foot - end[1], end[2]) };
  }
  const names = Object.keys(J);
  const index = Object.fromEntries(names.map((n, i) => [n, i]));

  const count = B.pos.length / 3;
  const si = new Uint16Array(count * 4);
  const sw = new Float32Array(count * 4);
  const p = new THREE.Vector3();
  const falloff = 12;
  for (let i = 0; i < count; i++) {
    p.set(B.pos[i * 3], B.pos[i * 3 + 1], B.pos[i * 3 + 2]);
    const P = B.parts[B.part[i]];
    let w = P.weights ? P.weights(p, foot) : null;
    if (!w) {
      let b1 = null, b2 = null, d1 = Infinity, d2 = Infinity;
      for (const n of P.bones) {
        const d = segDist(p, J[n].at, J[n].end);
        if (d < d1) { d2 = d1; b2 = b1; d1 = d; b1 = n; } else if (d < d2) { d2 = d; b2 = n; }
      }
      const w1 = 1 / Math.pow(d1 + falloff, 4), w2 = b2 ? 1 / Math.pow(d2 + falloff, 4) : 0;
      w = [[b1, w1], ...(b2 ? [[b2, w2]] : [])];
    }
    const total = w.reduce((s, e) => s + e[1], 0);
    w.slice(0, 4).forEach(([n, v], j) => { si[i * 4 + j] = index[n]; sw[i * 4 + j] = v / total; });
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(B.pos.map((v) => v * k), 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geo.computeVertexNormals();

  const bones = {};
  const list = names.map((n) => { const b = new THREE.Bone(); b.name = n; bones[n] = b; return b; });
  const group = new THREE.Group();
  for (const n of names) {
    const { parent, at } = J[n];
    if (parent) {
      bones[parent].add(bones[n]);
      bones[n].position.copy(at).sub(J[parent].at).multiplyScalar(k);
    } else {
      bones[n].position.copy(at).multiplyScalar(k);
      group.add(bones[n]);
    }
  }
  group.updateMatrixWorld(true);
  const material = new THREE.MeshStandardMaterial({
    map: texture, flatShading: true, roughness: 0.9, side: THREE.DoubleSide,
    emissive: '#ffffff', emissiveMap: texture, emissiveIntensity: 0.18,
  });
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.name = spec.name;
  group.add(mesh);
  mesh.bind(new THREE.Skeleton(list), new THREE.Matrix4());
  return { object: group, bones, meta: { H: spec.H, armRest: 0 }, after: spec.skirt ? skirtFollow : null };
}

// The ao dai's front and back panels hang from the hips and are pushed by
// whichever thigh swings into them.
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _d = new THREE.Vector3();
function thighSwing(hips, thigh) {
  hips.getWorldQuaternion(_q1).invert();
  thigh.getWorldQuaternion(_q2).premultiply(_q1);
  _d.set(0, -1, 0).applyQuaternion(_q2);
  return Math.atan2(_d.z, -_d.y);
}
function skirtFollow(model) {
  let b = model.userData.skirtBones;
  if (!b) {
    b = {};
    model.traverse((o) => { if (o.isBone) b[o.name] = o; });
    model.userData.skirtBones = b;
  }
  const l = thighSwing(b.hips, b.l_thigh), r = thighSwing(b.hips, b.r_thigh);
  b.skirtF.rotation.x = -Math.max(l, r, 0) * 0.9;
  b.skirtB.rotation.x = -Math.min(l, r, 0) * 0.9;
}

// ---------------------------------------------------------------------------
// The two sheets
// ---------------------------------------------------------------------------
const smooth = (t) => { t = THREE.MathUtils.clamp(t, 0, 1); return t * t * (3 - 2 * t); };

const legBones = (s) => [`${s}_thigh`, `${s}_shin`, `${s}_foot`];

// Truong Giang: yellow dragon ao dai, hands clasped in front
export const TRUONG_GIANG = {
  name: 'TruongGiang',
  H: 2.2,
  top: 112,
  sheet: { w: 1493, h: 2000, views: { front: { cx: 306, foot: 1905 }, side: { cx: 783, foot: 1893 }, back: { cx: 1210, foot: 1898 } } },
  skirt: true,
  inpaint: [[189, 668, 376, 896]],
  joints: {
    hips: [null, [0, 1060, -10], [0, 900, -10]],
    spine: ['hips', [0, 900, -10], [0, 700, -10]],
    chest: ['spine', [0, 700, -10], [0, 450, -10]],
    neck: ['chest', [0, 450, -5], [0, 395, 0]],
    head: ['neck', [0, 395, 10], [0, 120, 10]],
    l_arm: ['chest', [200, 500, -15], [250, 785, 10]],
    r_arm: ['chest', [-200, 500, -15], [-245, 790, 10]],
    skirtF: ['hips', [0, 1000, 20], [0, 1510, 100]],
    skirtB: ['hips', [0, 1000, -40], [0, 1510, -120]],
    l_thigh: ['hips', [112, 1070, -30], [112, 1430, -35]],
    l_shin: ['l_thigh', [112, 1430, -35], [113, 1790, -40]],
    l_foot: ['l_shin', [113, 1790, -40], [135, 1880, 130]],
    r_thigh: ['hips', [-110, 1070, -30], [-110, 1430, -35]],
    r_shin: ['r_thigh', [-110, 1430, -35], [-112, 1790, -40]],
    r_foot: ['r_shin', [-112, 1790, -40], [-135, 1880, 130]],
  },
  parts: [
    { bones: ['head', 'neck'], segs: 12, box: 0.75, fill: [300, 140], below: [250, 300, 215], rows: [
      [115, 30, 50, -20, -4], [125, 52, 86, -49, -4], [150, 79, 109, -85, -9], [175, 100, 110, -102, -3], [200, 109, 107, -110],
      [225, 112, 117, -117], [250, 109, 120, -117], [275, 104, 118, -115], [300, 104, 124, -106], [325, 100, 122, -96],
      [350, 86, 112, -82], [375, 74, 100, -70], [392, 55, 80, -60]] },
    // stand-up collar
    { bones: ['neck', 'chest'], segs: 10, fill: [450, 1450], rows: [[385, 62, 58, -78], [420, 76, 62, -86], [448, 84, 64, -92]] },
    { bones: ['chest', 'spine', 'hips'], segs: 14, box: 0.7, fill: [450, 1450],
      mask: [['side', 598, 650, 672, 880, [450, 1450]]],
      rows: [[445, 86, 64, -96], [475, 165, 72, -112], [510, 192, 85, -126], [600, 195, 95, -136], [650, 194, 98, -134], [700, 192, 100, -132], [750, 189, 104, -128],
        [800, 186, 108, -125], [850, 178, 114, -122], [900, 172, 120, -119], [1000, 183, 126, -128], [1040, 186, 126, -129]] },
    // ao dai panels, open at the sides
    { segs: 10, arc: [-Math.PI / 2, Math.PI / 2], box: 0.7, fill: [450, 1450], weights: panel('skirtF'),
      rows: [[1000, 183, 126, 0], [1100, 194, 129, 0], [1200, 202, 131, 0], [1300, 210, 133, 0], [1400, 220, 135, 0], [1505, 226, 137, 0]] },
    { segs: 10, arc: [Math.PI / 2, Math.PI * 1.5], box: 0.7, fill: [450, 1450], weights: panel('skirtB'),
      rows: [[1000, 183, 0, -128], [1100, 194, 0, -131], [1200, 202, 0, -132], [1300, 210, 0, -130], [1400, 220, 0, -129], [1500, 224, 0, -126]] },
    // trousers
    ...[[1, 112], [-1, -110]].map(([s, x]) => ({ bones: legBones(s > 0 ? 'l' : 'r'), segs: 8, solid: [200, 1650],
      path: [[x, 1050, -30, 82, 78], [x, 1300, -32, 68, 66], [x + s * 2, 1550, -38, 60, 63], [x + s * 3, 1700, -40, 50, 56], [x + s * 4, 1800, -42, 44, 48]] })),
    // shoes
    ...[[1, 'l'], [-1, 'r']].map(([s, n]) => ({ bones: [`${n}_foot`, `${n}_shin`], segs: 8, fill: [160, 1870],
      path: [[s * 118, 1845, -105, 40, 38], [s * 124, 1850, -60, 52, 46], [s * 132, 1858, 40, 56, 42], [s * 140, 1870, 120, 44, 28], [s * 143, 1878, 150, 22, 16]] })),
    // arms, kept in the clasped pose of the picture
    { bones: ['r_arm'], views: 'front', keep: true, segs: 8, fill: [450, 1450], path: [[-186, 525, -15, 40], [-212, 585, -12, 54], [-240, 790, 10, 52], [-170, 850, 90, 50], [-120, 852, 125, 48]] },
    { bones: ['r_arm'], views: 'front', keep: true, segs: 8, fill: [280, 840], path: [[-125, 845, 132, 42, 40], [-60, 838, 155, 48, 44], [10, 830, 160, 40, 36], [40, 828, 150, 22, 22]] },
    { bones: ['l_arm'], views: 'front', keep: true, segs: 8, fill: [450, 1450], path: [[186, 525, -15, 40], [212, 585, -12, 54], [250, 780, 10, 52], [170, 790, 95, 50], [95, 782, 128, 48]] },
    { bones: ['l_arm'], views: 'front', keep: true, segs: 8, fill: [280, 840], path: [[95, 780, 132, 42, 40], [40, 760, 155, 48, 44], [-20, 725, 165, 44, 40], [-55, 705, 160, 26, 24]] },
  ],
};

function panel(bone) {
  return (p, foot) => {
    const t = smooth(((foot - p.y) - 1000) / 220);
    return [['hips', 1 - t + 1e-4], [bone, t + 1e-4]];
  };
}

// Dam Vinh Hung: red suit, bow tie, arms open to the audience
export const DAM_VINH_HUNG = {
  name: 'DamVinhHung',
  H: 2.1,
  top: 528,
  sheet: { w: 1116, h: 2000, views: { front: { cx: 283, foot: 1490 }, side: { cx: 635, foot: 1502, s: 1.03 }, back: { cx: 923, foot: 1510, s: 1.036 } } },
  joints: {
    hips: [null, [0, 1060, -5], [0, 960, -5]],
    spine: ['hips', [0, 960, -5], [0, 830, -5]],
    chest: ['spine', [0, 830, -5], [0, 690, -5]],
    neck: ['chest', [0, 690, -5], [0, 655, 0]],
    head: ['neck', [0, 655, 5], [0, 530, 5]],
    l_arm: ['chest', [97, 725, -5], [167, 875, 15]],
    r_arm: ['chest', [-93, 725, -5], [-165, 870, 15]],
    l_thigh: ['hips', [55, 1085, -5], [72, 1270, -10]],
    l_shin: ['l_thigh', [72, 1270, -10], [88, 1445, -20]],
    l_foot: ['l_shin', [88, 1445, -20], [100, 1480, 85]],
    r_thigh: ['hips', [-54, 1085, -5], [-66, 1270, -10]],
    r_shin: ['r_thigh', [-66, 1270, -10], [-80, 1445, -20]],
    r_foot: ['r_shin', [-80, 1445, -20], [-98, 1480, 85]],
  },
  parts: [
    { bones: ['head', 'neck'], segs: 12, box: 0.75, bias: 0.35, fill: [278, 545], below: [255, 600, 585], rows: [
      [530, 18, 40, -10, -8], [540, 34, 78, -40, -11], [555, 44, 84, -45, -6], [570, 46, 79, -47, -7], [585, 47, 76, -46, -6],
      [600, 48, 77, -42, -4], [615, 49, 80, -38, -4], [630, 46, 72, -34, -3], [645, 39, 66, -33, -2], [660, 28, 50, -30, -1]] },
    { bones: ['neck', 'chest'], segs: 10, fill: [262, 760], rows: [[652, 26, 34, -30], [675, 32, 40, -36], [695, 48, 48, -46]] },
    { bones: ['chest', 'spine', 'hips'], segs: 14, box: 0.7,
      fill: [640, 900], mask: [['side', 585, 990, 670, 1115, [640, 900]]],
      rows: [[690, 48, 48, -46], [705, 92, 56, -64], [725, 116, 68, -78], [800, 111, 82, -80], [900, 104, 86, -78],
        [1000, 106, 88, -80], [1060, 112, 86, -77], [1092, 117, 84, -75]] },
    ...[[1, 'l', 55, 72, 88], [-1, 'r', -54, -66, -80]].map(([s, n, x0, x1, x2]) => ({ bones: legBones(n), segs: 8, fill: [640, 900],
      path: [[x0, 1070, -5, 50, 52], [x1 * 0.55 + x0 * 0.45, 1180, -6, 44, 46], [x1, 1270, -10, 38, 42], [(x1 + x2) / 2, 1360, -14, 33, 38], [x2, 1440, -20, 28, 34]] })),
    ...[[1, 'l', 90], [-1, 'r', -84]].map(([s, n, x]) => ({ bones: [`${n}_foot`, `${n}_shin`], segs: 8, fill: [190, 1465],
      path: [[x, 1465, -50, 28, 22], [x + s * 3, 1468, -20, 36, 26], [x + s * 8, 1472, 45, 38, 22], [x + s * 11, 1478, 80, 26, 14], [x + s * 12, 1481, 92, 12, 8]] })),
    { bones: ['r_arm'], views: 'front', segs: 8, fill: [640, 900], path: [[-94, 738, -5, 30], [-116, 778, -2, 37], [-165, 870, 12, 33], [-192, 848, 35, 28], [-212, 828, 52, 24]] },
    { bones: ['r_arm'], views: 'front', segs: 6, fill: [40, 800], twist: 0.3, path: [[-212, 830, 54, 24, 12], [-238, 806, 60, 30, 10], [-262, 792, 64, 26, 8], [-276, 786, 66, 12, 5]] },
    { bones: ['l_arm'], views: 'front', segs: 8, fill: [640, 900], path: [[96, 738, -5, 30], [118, 778, -2, 37], [167, 875, 12, 33], [190, 860, 35, 28], [208, 840, 52, 24]] },
    { bones: ['l_arm'], views: 'front', segs: 6, fill: [40, 800], twist: 0.3, path: [[208, 842, 54, 24, 12], [235, 812, 60, 30, 10], [256, 796, 64, 26, 8], [268, 788, 66, 12, 5]] },
  ],
};
