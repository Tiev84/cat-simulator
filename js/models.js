import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Rig, createCat, WALK_OFF, RUN_OFF } from './cat.js';
import { rigHumanoid } from './autorig.js';
import { HumanRig, CityPeople, RPM_ROLES } from './people.js';
import { CITY } from './noise.js';
import { clamp, lerp, damp } from './noise.js';

// Real 3D cat models (models/). A rigged ginger-and-white cat drives the
// four-legged skins (recoloured per skin, bones animated procedurally); the
// OIIA and Maxwell meme scans are used as they are. Buff and Tom stay
// procedural. If the models fail to load the game falls back to cat.js.

const A = { ready: false };
let loading = null;

export function loadCatModels() {
  if (loading) return loading;
  // FBX files point at texture paths from the artist's machine: skip those,
  // the right textures are applied by hand below.
  const manager = new THREE.LoadingManager();
  const blank = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  manager.setURLModifier((url) => (/\.(png|jpe?g|tga|tif|bmp)$/i.test(url) && !url.includes('models/') ? blank : url));
  const g = new GLTFLoader(manager);
  const f = new FBXLoader(manager);
  const tl = new THREE.TextureLoader();
  const tex = async (u) => {
    const t = await tl.loadAsync(u);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const R = 'models/ronaldo/';
  const ronTex = ['AvatarBodyMale_Color_1K', 'AvatarHeadMale_Color_1K', 't-shirt_Hakari_Color_1K', 'shorts_Getar_Color_1K', 'sneakers_AZAT_Color_1K', 'AvatarTeeth_Color_1K', 'AvatarEyes_Color_512'];
  loading = Promise.all([
    g.loadAsync('models/cat.glb'),
    f.loadAsync('models/oiia.fbx'),
    f.loadAsync('models/maxwell.fbx'),
    tex('models/oiia.jpg'),
    tex('models/maxwell.jpg'),
    tex('models/maxwell_whiskers.png'),
    new OBJLoader(manager).loadAsync('models/tom.obj'),
    tex('models/tom.png'),
    g.loadAsync('models/messi.glb'),
    g.loadAsync('models/tank.glb'),
    tex('models/tank_box.jpg'),
    tex('models/tank_cat.jpg'),
    f.loadAsync(R + 'ronaldo.fbx'),
    Promise.all(ronTex.map((n) => tex(R + n + '.jpg'))),
  ]).then(([cat, oiia, mx, oiiaTex, mxTex, mxWh, tomObj, tomTex, messi, tank, tankBox, tankCat, ron, ronMaps]) => {
    Object.assign(A, { cat, oiia, oiiaTex, mx, mxTex, mxWh, tank, tankBox, tankCat });
    // Tom (static T-pose game model) and Messi get a skeleton generated here
    tomObj.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshStandardMaterial({ map: tomTex, roughness: 0.7 }); });
    A.tom = rigHumanoid(tomObj, 1.4);
    messi.scene.traverse((o) => { if (o.isMesh) { o.material.roughness = 0.75; o.material.metalness = 0; } });
    A.messi = rigHumanoid(messi.scene, 2.2);
    A.ronaldo = prepRonaldo(ron, Object.fromEntries(ronTex.map((n, i) => [n, ronMaps[i]])));
    A.ready = true;
  });
  // motion-capture clips (Idle / Walk / Run) from three.js's Soldier example
  A.soldierLoading = g.loadAsync(SOLDIER).then((s) => { A.soldier = s; }).catch((e) => console.warn('Mocap clips unavailable', e));
  return loading;
}

const SOLDIER = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/models/gltf/Soldier.glb';

// Ronaldo and Messi walk around the starting city as NPCs.
export async function createPeople(scene, towns) {
  await A.soldierLoading;
  if (!A.soldier || !A.ronaldo || !A.messi) return null;
  return new CityPeople(scene, [
    { name: 'Ronaldo', src: A.ronaldo, rpm: true, voice: 'ronaldo', line: 'SIUUU!', celebrate: 'siu', walk: 1.6 },
    { name: 'Messi', src: A.messi, rpm: false, voice: 'messi', line: '¿Qué mirás, bobo?', walk: 1.5 },
  ], A.soldier, { x: CITY.c[0], z: CITY.c[1], w: 110, d: 140 }, towns);
}

// Ronaldo comes rigged (Ready Player Me skeleton); give him his textures and
// measure the landmarks the human rig needs.
function prepRonaldo(ron, maps) {
  const pick = {
    AvatarBody: 'AvatarBodyMale_Color_1K', AvatarHead: 'AvatarHeadMale_Color_1K', outfit_top: 't-shirt_Hakari_Color_1K',
    outfit_bottom: 'shorts_Getar_Color_1K', outfit_shoes: 'sneakers_AZAT_Color_1K', AvatarTeethLower: 'AvatarTeeth_Color_1K',
    AvatarTeethUpper: 'AvatarTeeth_Color_1K', AvatarLeftEyeball: 'AvatarEyes_Color_512', AvatarRightEyeball: 'AvatarEyes_Color_512',
  };
  ron.traverse((o) => {
    if (!o.isMesh) return;
    if (/Cornea/.test(o.name)) { o.visible = false; return; }
    const map = maps[pick[o.name]];
    o.material = map
      ? new THREE.MeshStandardMaterial({ map, roughness: 0.75 })
      : new THREE.MeshStandardMaterial({ color: '#1a1410', roughness: 0.9 });
  });
  const H = 2.2;
  const group = new THREE.Group();
  group.add(ron);
  ron.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(ron);
  const s = H / (box.max.y - box.min.y);
  ron.scale.multiplyScalar(s);
  ron.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
  group.updateMatrixWorld(true);
  const bone = (n) => { let b = null; ron.traverse((o) => { if (!b && o.isBone && o.name === n) b = o; }); return b.getWorldPosition(new THREE.Vector3()); };
  const up = bone('LeftUpLeg'), arm = bone('LeftArm'), hand = bone('LeftHand');
  return {
    object: group,
    roles: RPM_ROLES,
    meta: { H, crotch: up.y - H * 0.02, shoulderY: arm.y, shoulderX: Math.abs(arm.x), armRest: Math.atan2(hand.y - arm.y, Math.abs(hand.x) - Math.abs(arm.x)), depth: 0, armLen: hand.distanceTo(arm) },
  };
}



export function createRig(skin) {
  if (A.ready && skin.id === 'tom') return new HumanRig(skin, A.tom, { walk: 2.0, run: 5.0, jump: 4.6, radius: 0.3, wingScale: A.tom.meta.armLen / 0.62, cape: true, hold: 'sneak' });
  if (A.ready) {
    if (LOOKS[skin.id]) return new ModelQuadRig(skin);
    if (skin.id === 'oiia') return new OiiaRig(skin);
    if (skin.id === 'maxwell') return new MaxwellRig(skin);
    if (skin.id === 'tank') return new TankRig(skin);
  }
  return createCat(skin);
}

// ---------------------------------------------------------------------------
// Recolouring the ginger-and-white texture: saturated pixels are the coat,
// pale unsaturated pixels the white fur. The coat keeps its stripe detail.
// ---------------------------------------------------------------------------
const LOOKS = {
  ginger: { recolor: 0 },
  midnight: { recolor: 1, fur: '#17171a', white: '#1d1d21', whiteMix: 1 },
  tuxedo: { recolor: 1, fur: '#141416', whiteMix: 0 },
  chonky: { recolor: 1, fur: '#8b8173', whiteMix: 0.15, white: '#e6ddd0', widen: 1.35, tall: 1.05, scale: 1.08, chonk: true },
};

function recolored(mat, look) {
  const m = mat.clone();
  // the scan's metal/roughness map reads as dark metal without reflections
  m.metalness = 0;
  m.metalnessMap = null;
  m.roughness = 0.82;
  m.roughnessMap = null;
  if (!look.recolor) return m;
  const u = {
    uFur: { value: new THREE.Color(look.fur) },
    uWhite: { value: new THREE.Color(look.white || '#ffffff') },
    uWhiteMix: { value: look.whiteMix || 0 },
  };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uFur, uWhite;\nuniform float uWhiteMix;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec3 tc = diffuseColor.rgb;
        float lum = dot(tc, vec3(0.2126, 0.7152, 0.0722));
        float mx = max(tc.r, max(tc.g, tc.b));
        float mn = min(tc.r, min(tc.g, tc.b));
        float sat = (mx - mn) / max(mx, 1e-4);
        float whiteM = smoothstep(0.42, 0.18, sat) * smoothstep(0.12, 0.35, lum);
        vec3 fur = uFur * clamp(lum / 0.22, 0.25, 1.9);
        vec3 white = mix(tc, uWhite * clamp(lum / 0.7, 0.4, 1.2), uWhiteMix);
        diffuseColor.rgb = mix(fur, white, whiteM);`
      );
  };
  m.customProgramCacheKey = () => 'recolor';
  return m;
}

// ---------------------------------------------------------------------------
// Bone posing in cat space: each bone gets the cat's X/Y/Z axes expressed in
// its parent's rest frame, so a rotation "about the cat's sideways axis"
// means the same thing for every bone whatever the rig's local axes are.
// ---------------------------------------------------------------------------
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Quaternion();

class Bones {
  constructor(model) {
    this.b = {};
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      if (!o.isBone) return;
      const name = o.name.replace('Wolf_', '').replace('SHJnt', '');
      o.parent.getWorldQuaternion(_p);
      _p.invert();
      this.b[name] = {
        bone: o,
        rest: o.quaternion.clone(),
        restPos: o.position.clone(),
        ax: new THREE.Vector3(1, 0, 0).applyQuaternion(_p).normalize(),
        ay: new THREE.Vector3(0, 1, 0).applyQuaternion(_p).normalize(),
        az: new THREE.Vector3(0, 0, 1).applyQuaternion(_p).normalize(),
      };
    });
  }

  pose(name, x = 0, y = 0, z = 0) {
    const b = this.b[name];
    if (!b) return;
    _q.setFromAxisAngle(b.ay, y);
    if (x) _q.multiply(_q2.setFromAxisAngle(b.ax, x));
    if (z) _q.multiply(_q2.setFromAxisAngle(b.az, z));
    b.bone.quaternion.copy(_q).multiply(b.rest);
  }

  world(name, out) {
    return this.b[name].bone.getWorldPosition(out);
  }
}

const LEGS = [
  { side: 'l', front: true },
  { side: 'r', front: true },
  { side: 'l', front: false },
  { side: 'r', front: false },
];

class ModelQuadRig extends Rig {
  constructor(skin) {
    super(skin);
    const look = (this.look = LOOKS[skin.id]);
    const chonk = !!look.chonk;
    this.S = chonk
      ? { walk: 1.45, run: 3.3, stride: [0.7, 1.1], jump: 3.6, radius: 0.34 }
      : { walk: 1.9, run: 4.6, stride: [0.95, 1.6], jump: 4.6, radius: 0.28 };
    const k = 1.2 * (look.scale || 1);
    const widen = look.widen || 1;
    const tall = look.tall || 1;

    const model = SkeletonUtils.clone(A.cat.scene);
    this.bones = new Bones(model);
    const v = new THREE.Vector3();
    const hip = this.bones.world('ROOT', new THREE.Vector3());
    const back = this.bones.world('Spine_03', new THREE.Vector3());

    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      o.material = o.material.name === 'cat diffuse' ? recolored(o.material, look) : o.material.clone();
      if (o.material.name === 'eye') this.eyeMesh = o;
    });
    this.matsList = [];
    model.traverse((o) => { if (o.isMesh) this.matsList.push(o.material); });
    model.scale.set(k * widen, k * tall, k);

    // body pivot at the hips (pitching for sit/jump/fly happens here)
    const hy = hip.y * k * tall, hz = hip.z * k;
    const body = new THREE.Group();
    body.position.set(0, hy, hz);
    const inner = new THREE.Group();
    inner.position.set(0, -hy, -hz);
    body.add(inner);
    inner.add(model);
    this.root.add(body);
    this.body = body;
    this.bodyBase = body.position.clone();
    this.hipY = hy;

    this.headPivot = this.bones.b.Neck_Top.bone;
    this.eyes = [];
    this.ears = [];
    this.jaw = null;
    this.wingMount = new THREE.Group();
    this.wingMount.position.set(0, (back.y + 0.075) * k * tall, back.z * k);
    inner.add(this.wingMount);
    this.cfg = {
      walk: this.S.walk, run: this.S.run, jump: this.S.jump, radius: this.S.radius,
      camH: 0.4 * k * tall, wingScale: chonk ? 0.85 : 0.72, halfWidth: 0.075 * k * widen, thumbK: 0.78,
    };
    this.tailBones = ['Tail_01_02', 'Tail_01_03', 'Tail_01_04', 'Tail_01_05'];
    this.spin = 0;
    v.set(0, 0, 0);
  }

  update(dt, st) {
    const S = this.S;
    const B = this.bones;
    const t = st.time;
    this.idle(dt, st);
    const walkN = clamp(st.speed / S.walk, 0, 1);
    const runN = clamp((st.speed - S.walk) / (S.run - S.walk), 0, 1);
    const groundW = clamp(1 - st.airW - st.flyW, 0, 1);
    const move = walkN * groundW * (1 - st.sleepW) * (1 - st.sitW);
    const stride = lerp(S.stride[0], S.stride[1], runN);
    if (move > 0.01) this.phase += dt * (st.speed / stride) * Math.PI * 2;
    const amp = lerp(0.4, 0.72, runN) * move;
    const knee = lerp(0.55, 0.95, runN) * move;
    const pw = st.pounceW || 0;
    const lick = Math.max(0, Math.sin(t * 9));
    const sitPitch = -0.62;

    LEGS.forEach((L, i) => {
      const ph = this.phase + lerp(WALK_OFF[i], RUN_OFF[i], runN) * Math.PI * 2;
      // the scan's lower back is skinned to the hind hips: swing them gently
      // and let the knees carry the stride, so the back doesn't buckle
      const swing = -Math.sin(ph) * amp;
      let up = swing * (L.front ? 0.7 : 0.4);
      const kneeSwing = L.front ? 0 : swing * 0.55;
      let kn = Math.max(0, Math.cos(ph)) * knee;
      up = lerp(up, L.front ? -0.55 : 0.6, st.airW);
      kn = lerp(kn, L.front ? 0.4 : 0.35, st.airW);
      up = lerp(up, L.front ? -0.2 : 0.9, st.flyW);
      kn = lerp(kn, L.front ? 1.4 : 0.5, st.flyW);
      up = lerp(up, L.front ? -1.25 : 0.9, pw);
      kn = lerp(kn, L.front ? 0.1 : 0.2, pw);
      if (L.front) {
        const groomPaw = L.side === 'r' ? st.groomW : 0;
        up = lerp(up, lerp(-sitPitch, -1.2, groomPaw), st.sitW);
        kn = lerp(kn, lerp(0, 1.9 + lick * 0.15, groomPaw), st.sitW);
        up = lerp(up, -1.1, st.sleepW);
        kn = lerp(kn, 0.2, st.sleepW);
        B.pose(`${L.side}_FrontLeg_Hip`, up);
        B.pose(`${L.side}_FrontLeg_Knee`, -kn * 0.35);
        B.pose(`${L.side}_FrontLeg_Ankle`, kn * 0.9);
      } else {
        up = lerp(up, -0.9, st.sitW);
        kn = lerp(kn, 2.0, st.sitW);
        up = lerp(up, -1.1, st.sleepW);
        kn = lerp(kn, 2.2, st.sleepW);
        B.pose(`${L.side}_HindLeg_Hip`, up);
        B.pose(`${L.side}_HindLeg_Knee1`, -kn * 0.45 + kneeSwing * (1 - st.sitW) * (1 - st.sleepW));
        B.pose(`${L.side}_HindLeg_Knee2`, kn * 0.85);
      }
    });

    // body: bob, sit / sleep drops, pitch about the hips
    const bob = -Math.abs(Math.sin(this.phase)) * 0.012 * move;
    const sitDrop = this.hipY * 0.55 * st.sitW;
    const sleepDrop = this.hipY * 0.62 * st.sleepW;
    const breathe = Math.sin(t * (st.sleepW > 0.5 ? 1.6 : 2.4)) * 0.004;
    this.body.position.set(0, this.bodyBase.y + bob - sitDrop * (1 - st.sleepW) - sleepDrop + breathe, this.bodyBase.z);
    let pitch = st.slope * groundW * (1 - st.sleepW);
    pitch += clamp(-st.vy * 0.05, -0.35, 0.35) * st.airW;
    pitch += (clamp(-st.vy * 0.08, -0.5, 0.5) + 0.05 * st.speed / S.run) * st.flyW;
    pitch = lerp(pitch, sitPitch, st.sitW * (1 - st.sleepW));
    pitch = lerp(pitch, 0.12, pw);
    this.body.rotation.x = pitch;
    this.body.rotation.z = clamp(-st.turn * 0.06, -0.15, 0.15) * (1 - st.sleepW);
    const bend = clamp(st.turn * 0.08, -0.25, 0.25);
    B.pose('Spine_02', 0, bend * 0.5);
    B.pose('Spine_03', 0, bend * 0.5);

    // head and neck
    const freeLook = (1 - move) * (1 - st.sleepW) * (1 - st.groomW);
    let hx = this.lookPitch * freeLook - pitch * 0.6 - st.meowW * 0.35 + Math.abs(Math.sin(this.phase)) * 0.04 * move;
    hx = lerp(hx, 0.55, st.sleepW);
    hx += st.groomW * (0.5 + lick * 0.1);
    let hy = this.lookYaw * freeLook + st.turn * 0.12 * (1 - st.sleepW);
    hy = lerp(hy, 0.6, st.sleepW) - st.groomW * 0.35;
    const tilt = st.sleepW * 0.25 + st.groomW * 0.15;
    B.pose('Neck_01', hx * 0.35, hy * 0.45);
    B.pose('Neck_02', hx * 0.3, hy * 0.35);
    B.pose('Neck_Top', hx * 0.35, hy * 0.2, tilt);
    B.pose('Head_Jaw', st.meowW * 0.45 + st.groomW * lick * 0.15);
    if (this.eyeMesh) this.eyeMesh.visible = st.sleepW < 0.6;

    // tail: held up while walking, streams behind in flight, curls when asleep
    this.tailBones.forEach((name, i) => {
      const kk = (i + 1) / this.tailBones.length;
      const sway = Math.sin(t * lerp(1.3, 3.2, move) - i * 0.6) * lerp(0.12, 0.2, move) * kk;
      let lift = i === 0 ? 0.75 : 0.18;
      lift = lerp(lift, i === 0 ? 0.1 : 0.02, st.flyW);
      lift = lerp(lift, i === 0 ? -0.15 : 0.0, st.sitW * (1 - st.sleepW));
      lift = lerp(lift, i === 0 ? -0.35 : 0.0, st.sleepW);
      const curl = lerp(sway, i === 0 ? 0.3 : 0.45, st.sleepW);
      B.pose(name, lift, curl);
    });
  }

  dispose() {
    for (const m of this.matsList) m.dispose();
    super.dispose();
  }
}

// ---------------------------------------------------------------------------
// Meme scans without a usable skeleton: they waddle as a whole. OIIA melts
// into its loaf morph and spins; Maxwell spins and plays his dance.
// ---------------------------------------------------------------------------
function normalized(obj, length) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const s = length / size.z;
  obj.scale.multiplyScalar(s);
  obj.updateMatrixWorld(true);
  box.setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.x -= c.x;
  obj.position.z -= c.z;
  obj.position.y -= box.min.y;
  box.setFromObject(obj);
  return box;
}

class MemeRig extends Rig {
  setup(model, length, cfg) {
    const body = new THREE.Group();
    this.root.add(body);
    this.body = body;
    body.add(model);
    const box = normalized(model, length);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
    });
    const h = box.max.y;
    this.headPivot = new THREE.Object3D();
    this.headPivot.position.set(0, h * 0.85, box.max.z * 0.6);
    body.add(this.headPivot);
    this.wingMount = new THREE.Group();
    this.wingMount.position.set(0, h * 0.92, -0.02);
    body.add(this.wingMount);
    this.eyes = [];
    this.ears = [];
    this.jaw = null;
    this.spinAngle = 0;
    this.cfg = { ...cfg, camH: h * 0.8, halfWidth: (box.max.x - box.min.x) * 0.45 };
  }

  waddle(dt, st, spinW) {
    const C = this.cfg;
    const t = st.time;
    this.idle(dt, st);
    const groundW = clamp(1 - st.airW - st.flyW, 0, 1);
    const move = clamp(st.speed / C.walk, 0, 1) * groundW * (1 - st.sleepW);
    if (move > 0.01) this.phase += dt * (st.speed / 0.42) * Math.PI * 2;
    const squash = clamp(st.vy * 0.035, -0.14, 0.18) * st.airW;
    const pz = 1 + (st.pounceW || 0) * 0.25;
    const breathe = Math.sin(t * 1.7) * 0.012;
    const sy = (1 + squash - st.sleepW * 0.08 + breathe) / Math.sqrt(pz);
    this.body.scale.set(1 - squash * 0.5, sy, (1 - squash * 0.5) * pz);
    this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.03 * move;
    this.body.rotation.z = Math.sin(this.phase) * 0.09 * move;
    let bx = st.slope * 0.5 * groundW + Math.sin(this.phase * 2) * 0.03 * move;
    bx += clamp(-st.vy * 0.06, -0.45, 0.45) * st.flyW;
    this.body.rotation.x = bx;
    if (spinW > 0.05) this.spinAngle += dt * (15 + Math.sin(t * 1.9) * 6) * spinW;
    else this.spinAngle = damp(this.spinAngle, Math.round(this.spinAngle / (Math.PI * 2)) * Math.PI * 2, 6, dt);
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.isMesh) [].concat(o.material).forEach((m) => m.dispose());
    });
    super.dispose();
  }
}

class OiiaRig extends MemeRig {
  constructor(skin) {
    super(skin);
    const model = A.oiia.clone(true);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.material = new THREE.MeshStandardMaterial({ map: A.oiiaTex, roughness: 0.92 });
      this.mesh = o;
    });
    this.setup(model, 0.9, { walk: 1.7, run: 4.0, jump: 4.0, radius: 0.32, wingScale: 1.0, thumbK: 0.72 });
    this.loaf = 0;
  }

  update(dt, st) {
    const spinW = st.groomW;
    this.waddle(dt, { ...st, groomW: 0 }, spinW);
    // the scan's morph target is the legless loaf from the meme
    this.loaf = damp(this.loaf, spinW > 0.3 || st.sleepW > 0.5 ? 1 : 0, 10, dt);
    if (this.mesh && this.mesh.morphTargetInfluences) this.mesh.morphTargetInfluences[0] = this.loaf;
  }
}

class MaxwellRig extends MemeRig {
  constructor(skin) {
    super(skin);
    const model = SkeletonUtils.clone(A.mx);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.material = [].concat(o.material).map((m) =>
        m.name.startsWith('whisk')
          ? new THREE.MeshStandardMaterial({ map: A.mxWh, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.6 })
          : new THREE.MeshStandardMaterial({ map: A.mxTex, roughness: 0.8 })
      );
    });
    this.setup(model, 0.82, { walk: 1.6, run: 3.8, jump: 3.9, radius: 0.33, wingScale: 1.0, thumbK: 0.8 });
    this.mixer = new THREE.AnimationMixer(model);
    this.dance = this.mixer.clipAction(A.mx.animations[0]);
    this.dance.play();
    this.dance.paused = true;
  }

  update(dt, st) {
    const spinW = st.groomW;
    this.waddle(dt, { ...st, groomW: 0 }, spinW);
    // the original dance plays while he spins
    this.dance.paused = spinW < 0.3;
    if (!this.dance.paused) this.mixer.update(dt);
  }
}

// The cardboard tank cat (converted from a Blender file). Holding E fires the
// cannon: the rig raises `fired` and main.js adds the bang and the flash.
class TankRig extends MemeRig {
  constructor(skin) {
    super(skin);
    for (const t of [A.tankBox, A.tankCat]) t.flipY = false;
    const model = A.tank.scene.clone(true);
    model.traverse((o) => {
      if (!o.isMesh) return;
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      o.material = new THREE.MeshStandardMaterial({ map: o.material.name === 'cat' ? A.tankCat : A.tankBox, roughness: 0.92, side: THREE.DoubleSide });
    });
    // drop the display banner; the cannon points along +X: turn it to face forward
    const turn = new THREE.Group();
    model.rotation.y = -Math.PI / 2;
    turn.add(model);
    const banner = [];
    model.traverse((o) => { if (o.name.includes('Cylinder')) banner.push(o); });
    banner.forEach((o) => o.removeFromParent());
    this.setup(turn, 1.5, { walk: 1.6, run: 3.6, jump: 2.6, radius: 0.55, wingScale: 1.3, thumbK: 1.05 });
    const box = new THREE.Box3().setFromObject(this.body);
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, box.max.y * 0.6, box.max.z + 0.05);
    this.body.add(this.muzzle);
    this.fireT = 0;
    this.recoil = 0;
    this.fired = false;
  }

  update(dt, st) {
    const hold = st.groomW;
    // a tank doesn't waddle: tread rumble and a gentle sway only
    this.waddle(dt, { ...st, groomW: 0 }, 0);
    this.body.rotation.z *= 0.3;
    this.body.position.y = Math.abs(Math.sin(this.phase * 2)) * 0.012 * clamp(st.speed / 1.6, 0, 1);
    this.fired = false;
    this.fireT -= dt;
    if (hold > 0.5 && this.fireT <= 0) {
      this.fireT = 0.9;
      this.recoil = 1;
      this.fired = true;
    }
    this.recoil = Math.max(0, this.recoil - dt * 4);
    this.body.rotation.x -= this.recoil * 0.12;
    this.body.position.z = -this.recoil * 0.12;
  }

  muzzleWorld(out) {
    return this.muzzle.getWorldPosition(out);
  }
}
