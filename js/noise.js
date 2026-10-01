// Shared terrain height + noise helpers. The terrain height is a sum of
// rotated sine waves so the exact same function can run in JS (physics,
// prop placement) and in GLSL (terrain mesh, grass blades).

const WAVES = [
  // angle (rad), wavelength, amplitude, phase
  [0.35, 310, 6.0, 0.0],
  [2.05, 190, 3.6, 1.7],
  [4.20, 120, 2.0, 0.4],
  [1.15, 74, 1.0, 2.9],
  [5.40, 43, 0.45, 5.1],
  [3.30, 23, 0.16, 0.8],
].map(([a, wl, amp, ph]) => {
  const k = (Math.PI * 2) / wl;
  return { kx: Math.cos(a) * k, kz: Math.sin(a) * k, amp, ph };
});

function rawHeight(x, z) {
  let h = 0;
  for (const w of WAVES) h += w.amp * Math.sin(x * w.kx + z * w.kz + w.ph);
  return h;
}

// Towns sit on a regular lattice so the GPU can find them without lookups.
// Each town is a flattened square with a street grid; highways run along the
// lattice lines and connect every town to its neighbours.
export const TOWN = {
  S: 320, // lattice spacing
  O: [0, 72], // lattice offset: the first town lies just ahead of the spawn point
  R: 60, // half size of the flat town square
  B: 30, // blend distance back into the hills
  grid: 40, // street spacing
  road: 4, // road half width
  walk: 1.4, // sidewalk width
};

export function townCenter(x, z, out = [0, 0]) {
  out[0] = Math.round((x - TOWN.O[0]) / TOWN.S) * TOWN.S + TOWN.O[0];
  out[1] = Math.round((z - TOWN.O[1]) / TOWN.S) * TOWN.S + TOWN.O[1];
  return out;
}

const _tc = [0, 0];
export function townMask(x, z) {
  townCenter(x, z, _tc);
  const d = Math.max(Math.abs(x - _tc[0]), Math.abs(z - _tc[1]));
  return 1 - smoothstep(TOWN.R, TOWN.R + TOWN.B, d);
}

// 0..1: 1 on asphalt, includes the sidewalk band when `withWalk` is set.
export function roadMask(x, z, withWalk = false) {
  townCenter(x, z, _tc);
  const lx = x - _tc[0];
  const lz = z - _tc[1];
  const half = TOWN.road + (withWalk ? TOWN.walk : 0);
  const g = TOWN.grid;
  const inTown = Math.max(Math.abs(lx), Math.abs(lz)) < TOWN.R + 2;
  const gx = Math.abs(((((lx + g / 2) % g) + g) % g) - g / 2);
  const gz = Math.abs(((((lz + g / 2) % g) + g) % g) - g / 2);
  const town = inTown && Math.min(gx, gz) < half ? 1 : 0;
  const hw = Math.min(Math.abs(lx), Math.abs(lz)) < half - 0.8 ? 1 : 0;
  return Math.max(town, hw);
}

export function terrainHeight(x, z) {
  const h = rawHeight(x, z);
  const m = townMask(x, z);
  if (m <= 0) return h;
  townCenter(x, z, _tc);
  return h + (rawHeight(_tc[0], _tc[1]) - h) * m;
}

export function terrainNormal(x, z, out) {
  const e = 0.5;
  const hx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const hz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  out.set(-hx, 2 * e, -hz).normalize();
  return out;
}

const f = (n) => n.toFixed(7);

export const TERRAIN_GLSL = /* glsl */ `
float terrainRaw(vec2 p) {
  float h = 0.0;
${WAVES.map((w) => `  h += ${f(w.amp)} * sin(p.x * ${f(w.kx)} + p.y * ${f(w.kz)} + ${f(w.ph)});`).join('\n')}
  return h;
}
const float TOWN_S = ${f(TOWN.S)};
const vec2 TOWN_O = vec2(${f(TOWN.O[0])}, ${f(TOWN.O[1])});
const float TOWN_R = ${f(TOWN.R)};
const float TOWN_B = ${f(TOWN.B)};
const float TOWN_G = ${f(TOWN.grid)};
const float ROAD_W = ${f(TOWN.road)};
const float WALK_W = ${f(TOWN.walk)};
vec2 townCenter(vec2 p) { return floor((p - TOWN_O) / TOWN_S + 0.5) * TOWN_S + TOWN_O; }
float townMask(vec2 p) {
  vec2 l = abs(p - townCenter(p));
  return 1.0 - smoothstep(TOWN_R, TOWN_R + TOWN_B, max(l.x, l.y));
}
// x: asphalt, y: asphalt + sidewalk, z: distance to the nearest road centre line
vec3 roadInfo(vec2 p) {
  vec2 l = p - townCenter(p);
  float inTown = step(max(abs(l.x), abs(l.y)), TOWN_R + 2.0);
  vec2 g = abs(mod(l + TOWN_G * 0.5, TOWN_G) - TOWN_G * 0.5);
  float d = min(mix(1e3, min(g.x, g.y), inTown), min(abs(l.x), abs(l.y)) + 0.8);
  return vec3(1.0 - smoothstep(ROAD_W - 0.15, ROAD_W + 0.15, d), 1.0 - smoothstep(ROAD_W + WALK_W - 0.1, ROAD_W + WALK_W + 0.1, d), d);
}
float terrainH(vec2 p) {
  float h = terrainRaw(p);
  return mix(h, terrainRaw(townCenter(p)), townMask(p));
}
`;

export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`;

// Small deterministic RNG (mulberry32).
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x, z) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
export function dampAngle(a, b, rate, dt) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-rate * dt));
}
