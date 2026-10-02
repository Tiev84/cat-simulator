import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Rig } from './cat.js';
import { clamp, lerp, damp, dampAngle, terrainHeight } from './noise.js';

// Two-legged characters built from real models: Tom (playable) and the
// Ronaldo / Messi NPCs that walk around the starting city.

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Quaternion();
const _r = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const _ax = new THREE.Vector3(), _ay = new THREE.Vector3(), _az = new THREE.Vector3();

// Rotates bones about the character's own axes (relative to `space`), using
// the live parent orientation, so any rig convention works and nested
// rotations (bent elbow on a lowered arm) stay correct.
class Poser {
  constructor(space, model, roles) {
    this.space = space;
    this.roles = {};
    const byName = {};
    model.traverse((o) => {
      if (o.isBone) (byName[o.name] = byName[o.name] || []).push(o);
    });
    for (const [role, names] of Object.entries(roles)) {
      const list = [];
      for (const n of [].concat(names)) if (byName[n]) list.push(...byName[n]);
      this.roles[role] = list.map((b) => ({ bone: b, rest: b.quaternion.clone() }));
    }
  }

  pose(role, x = 0, y = 0, z = 0) {
    const list = this.roles[role];
    if (!list) return;
    this.space.getWorldQuaternion(_r).invert();
    for (const { bone, rest } of list) {
      bone.parent.updateWorldMatrix(true, false);
      bone.parent.getWorldQuaternion(_p);
      _p.premultiply(_r).invert();
      _ax.copy(X).applyQuaternion(_p);
      _ay.copy(Y).applyQuaternion(_p);
      _az.copy(Z).applyQuaternion(_p);
      _q.setFromAxisAngle(_ay, y);
      if (x) _q.multiply(_q2.setFromAxisAngle(_ax, x));
      if (z) _q.multiply(_q2.setFromAxisAngle(_az, z));
      bone.quaternion.copy(_q).multiply(rest);
      bone.updateMatrixWorld(true);
    }
  }

  reset() {
    for (const list of Object.values(this.roles)) for (const { bone, rest } of list) bone.quaternion.copy(rest);
  }
}

const AUTO_ROLES = {
  hips: 'hips', spine: 'spine', chest: 'chest', neck: 'neck', head: 'head',
  l_upperArm: 'l_upperArm', l_foreArm: 'l_foreArm', r_upperArm: 'r_upperArm', r_foreArm: 'r_foreArm',
  l_thigh: 'l_thigh', l_shin: 'l_shin', l_foot: 'l_foot', r_thigh: 'r_thigh', r_shin: 'r_shin', r_foot: 'r_foot',
};
export const RPM_ROLES = {
  hips: 'Hips', spine: 'Spine', chest: ['Spine1', 'Spine2'], neck: 'Neck', head: 'Head',
  l_upperArm: 'LeftArm', l_foreArm: 'LeftForeArm', r_upperArm: 'RightArm', r_foreArm: 'RightForeArm',
  l_thigh: 'LeftUpLeg', l_shin: 'LeftLeg', l_foot: 'LeftFoot', r_thigh: 'RightUpLeg', r_shin: 'RightLeg', r_foot: 'RightFoot',
};

// src: { object, meta: { H, armRest, shoulderY, shoulderX, depth }, roles }
export class HumanRig extends Rig {
  constructor(skin, src, opts) {
    super(skin);
    const H = (this.H = src.meta.H);
    this.opts = opts;
    this.armRest = src.meta.armRest || 0;
    const model = SkeletonUtils.clone(src.object);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
    });
    // body pivot at the hips
    const hipY = (this.hipY = src.meta.crotch + H * 0.04);
    const body = new THREE.Group();
    body.position.set(0, hipY, 0);
    const inner = new THREE.Group();
    inner.position.set(0, -hipY, 0);
    body.add(inner);
    inner.add(model);
    this.root.add(body);
    this.body = body;
    this.poser = new Poser(body, model, src.roles || AUTO_ROLES);
    this.headPivot = new THREE.Object3D();
    this.headPivot.position.set(0, H * 0.9, 0);
    inner.add(this.headPivot);
    this.wingMount = new THREE.Group();
    if (opts.cape) this.wingMount.position.set(0, src.meta.shoulderY, (src.meta.depth || 0) - H * 0.02);
    else this.wingMount.position.set(0, src.meta.shoulderY - H * 0.04, (src.meta.depth || 0) - H * 0.06);
    inner.add(this.wingMount);
    this.eyes = [];
    this.ears = [];
    this.jaw = null;
    this.spinAngle = 0;
    this.cfg = {
      walk: opts.walk, run: opts.run, jump: opts.jump, radius: opts.radius,
      camH: H * 0.82, wingScale: opts.wingScale, halfWidth: src.meta.shoulderX, thumbK: H * 0.8,
    };
    this.celebrate = opts.celebrate;
  }

  // arm: angle from horizontal (negative = down), swing about the sideways
  // axis (negative = forward), elbow bend (negative = forearm forward)
  arm(s, angle, swing, elbow, elbowZ = 0) {
    const side = s > 0 ? 'l' : 'r';
    this.poser.pose(`${side}_upperArm`, swing, 0, s * (angle - this.armRest));
    this.poser.pose(`${side}_foreArm`, elbow, 0, s * elbowZ);
  }

  update(dt, st) {
    const t = st.time;
    const P = this.poser;
    const H = this.H;
    this.idle(dt, st);
    const C = this.cfg;
    const walkN = clamp(st.speed / C.walk, 0, 1);
    const runN = clamp((st.speed - C.walk) / (C.run - C.walk), 0, 1);
    const groundW = clamp(1 - st.airW - st.flyW, 0, 1);
    const move = walkN * groundW * (1 - st.sleepW);
    const stride = lerp(1.0, 1.7, runN) * (H / 1.6);
    if (move > 0.01) this.phase += dt * (st.speed / stride) * Math.PI * 2;
    const amp = lerp(0.45, 0.9, runN) * move;
    const pw = st.pounceW || 0;
    const cape = this.opts.cape;
    // celebration: one shot after tapping E, looping while E is held
    const ct = st.meowT;
    const cel = this.celebrate ? Math.max(st.groomW, ct < 1.7 ? 1 : 0) : 0;
    const celT = st.groomW > 0.5 ? (t % 1.7) : ct;
    const sneak = this.opts.hold === 'sneak' ? st.groomW : 0;

    // body
    const bob = (Math.cos(this.phase * 2) * 0.5 + 0.5) * 0.02 * H * move;
    let jumpUp = 0;
    this.spinAngle = 0;
    if (this.celebrate === 'siu' && cel && celT < 0.55) {
      const k = celT / 0.55;
      jumpUp = Math.sin(Math.PI * k) * H * 0.22;
      this.spinAngle = Math.PI * 2 * (k * k * (3 - 2 * k));
    }
    this.body.position.y = lerp(this.hipY + bob - sneak * H * 0.05 + jumpUp, this.hipY * 0.25, st.sleepW);
    let bx = st.slope * 0.3 * groundW;
    bx = lerp(bx, cape ? 0.3 + clamp(-st.vy * 0.05, -0.3, 0.3) : 1.3 + clamp(-st.vy * 0.06, -0.4, 0.4), st.flyW);
    bx = lerp(bx, 0.9, pw);
    bx = lerp(bx, -0.15, st.sleepW);
    this.body.rotation.x = bx;
    this.body.rotation.z = clamp(-st.turn * 0.05, -0.12, 0.12);
    const chestX = runN * 0.15 * move + sneak * 0.45 - (this.celebrate === 'siu' ? cel * 0.15 : 0);
    P.pose('spine', chestX * 0.5, Math.sin(this.phase) * 0.08 * move, 0);
    P.pose('chest', chestX * 0.5, Math.sin(this.phase) * 0.06 * move, 0);

    // legs
    let spread = 0;
    if (this.celebrate === 'siu' && cel) spread = celT > 0.55 ? 0.28 : 0;
    for (const [i, s] of [[0, 1], [1, -1]]) {
      const side = s > 0 ? 'l' : 'r';
      const ph = this.phase + i * Math.PI;
      let th = -Math.sin(ph) * amp;
      let kn = Math.max(0, Math.cos(ph)) * lerp(0.7, 1.4, runN) * move + 0.04;
      th = lerp(th, -0.8, st.airW);
      kn = lerp(kn, 1.3, st.airW);
      th = lerp(th, cape ? 0.25 : 0.08 + Math.sin(t * 2 + i) * 0.08, st.flyW);
      kn = lerp(kn, cape ? 0.4 : 0.15, st.flyW);
      th = lerp(th, 0.35, pw);
      kn = lerp(kn, 0.2, pw);
      th = lerp(th, -0.55, sneak);
      kn = lerp(kn, 0.95, sneak);
      th = lerp(th, -1.5, st.sleepW);
      kn = lerp(kn, 0.05, st.sleepW);
      P.pose(`${side}_thigh`, th, 0, s * spread * cel);
      P.pose(`${side}_shin`, kn);
      P.pose(`${side}_foot`, -kn * 0.3);
    }

    // arms
    const flapA = st.wingFlap || 0;
    for (const [i, s] of [[0, 1], [1, -1]]) {
      const ph = this.phase + (i === 0 ? Math.PI : 0);
      let ang = -1.3;
      let sw = Math.sin(ph) * lerp(0.4, 0.9, runN) * move;
      let el = -0.2 - runN * 1.0 * move;
      ang = lerp(ang, -0.5, st.airW);
      if (cape) {
        ang = lerp(ang, flapA, st.flyW);
        sw = lerp(sw, 0, st.flyW);
        el = lerp(el, 0, st.flyW);
      } else {
        sw = lerp(sw, i === 1 ? -2.9 : 0.1, st.flyW);
        ang = lerp(ang, i === 1 ? -1.4 : -1.35, st.flyW);
        el = lerp(el, 0, st.flyW);
      }
      sw = lerp(sw, -2.5, pw);
      el = lerp(el, -0.1, pw);
      sw = lerp(sw, -0.9, sneak);
      ang = lerp(ang, -1.0, sneak);
      el = lerp(el, -1.7, sneak);
      sw = lerp(sw, -0.4, st.sleepW);
      el = lerp(el, -0.3, st.sleepW);
      if (cel) {
        if (this.celebrate === 'siu') {
          // jump with arms up, then the SIUUU landing: arms down and out
          const up = celT < 0.55;
          ang = lerp(ang, up ? 0.9 : -0.75, cel);
          sw = lerp(sw, up ? 0 : 0.35, cel);
          el = lerp(el, 0, cel);
        } else if (this.celebrate === 'bobo') {
          // ¿Qué mirás, bobo?: one arm pointing, the other on the hip
          ang = lerp(ang, i === 1 ? -0.25 : -0.9, cel);
          sw = lerp(sw, i === 1 ? -1.2 : 0.3, cel);
          el = lerp(el, i === 1 ? -0.1 : -1.4, cel);
        }
      }
      this.arm(s, ang, sw, el);
    }

    // head
    const freeLook = (1 - move) * (1 - st.sleepW) * (1 - st.groomW);
    let hx = this.lookPitch * freeLook - st.meowW * 0.25 - sneak * 0.35;
    hx = lerp(hx, cape ? -0.25 : -1.0, st.flyW);
    hx = lerp(hx, 0.4, st.sleepW);
    if (cel) hx = lerp(hx, this.celebrate === 'siu' ? -0.3 : 0.15, cel);
    P.pose('neck', hx * 0.4, this.lookYaw * freeLook * 0.4, 0);
    P.pose('head', hx * 0.6, this.lookYaw * freeLook * 0.6, this.celebrate === 'bobo' ? cel * 0.25 : st.sleepW * 0.2);
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.isMesh) [].concat(o.material).forEach((m) => m.dispose && m.dispose());
    });
    super.dispose();
  }
}

// ---------------------------------------------------------------------------
// Motion capture for people: Mixamo clips (Idle / Walk / Run from three.js's
// Soldier) are played on a hidden source skeleton; every frame each bone's
// rotation relative to the T-pose is copied onto the character's matching
// bone, relative to that character's own T-pose. This works across rigs
// whatever their bone axes (Ronaldo's Ready Player Me rig, Messi's auto-rig).
// ---------------------------------------------------------------------------
const MOCAP = [
  // role, source bone, Ready Player Me bone, auto-rig bone
  ['hips', 'Hips', 'Hips', 'hips'],
  ['spine', 'Spine', 'Spine', 'spine'],
  ['spine1', 'Spine1', 'Spine1', null],
  ['chest', 'Spine2', 'Spine2', 'chest'],
  ['neck', 'Neck', 'Neck', 'neck'],
  ['head', 'Head', 'Head', 'head'],
  ['l_shoulder', 'LeftShoulder', 'LeftShoulder', null],
  ['l_upperArm', 'LeftArm', 'LeftArm', 'l_upperArm'],
  ['l_foreArm', 'LeftForeArm', 'LeftForeArm', 'l_foreArm'],
  ['l_hand', 'LeftHand', 'LeftHand', 'l_hand'],
  ['r_shoulder', 'RightShoulder', 'RightShoulder', null],
  ['r_upperArm', 'RightArm', 'RightArm', 'r_upperArm'],
  ['r_foreArm', 'RightForeArm', 'RightForeArm', 'r_foreArm'],
  ['r_hand', 'RightHand', 'RightHand', 'r_hand'],
  ['l_thigh', 'LeftUpLeg', 'LeftUpLeg', 'l_thigh'],
  ['l_shin', 'LeftLeg', 'LeftLeg', 'l_shin'],
  ['l_foot', 'LeftFoot', 'LeftFoot', 'l_foot'],
  ['l_toe', 'LeftToeBase', 'LeftToeBase', null],
  ['r_thigh', 'RightUpLeg', 'RightUpLeg', 'r_thigh'],
  ['r_shin', 'RightLeg', 'RightLeg', 'r_shin'],
  ['r_foot', 'RightFoot', 'RightFoot', 'r_foot'],
  ['r_toe', 'RightToeBase', 'RightToeBase', null],
];

const _w = new THREE.Quaternion();
const _d = new THREE.Quaternion();
const _inv = new THREE.Quaternion();
const _vec = new THREE.Vector3();

function relQuat(obj, root, out) {
  root.getWorldQuaternion(_inv).invert();
  obj.getWorldQuaternion(out);
  return out.premultiply(_inv);
}

class Mocap {
  // target: model root; rpm: bone naming; armRest: angle of the arms in the
  // model's rest pose (0 = T-pose) so A-pose models are lifted to a T first.
  constructor(soldier, target, rpm, armRest = 0) {
    this.src = SkeletonUtils.clone(soldier.scene);
    this.mixer = new THREE.AnimationMixer(this.src);
    const clip = (n) => soldier.animations.find((a) => a.name === n);
    this.actions = {};
    for (const n of ['Idle', 'Walk', 'Run']) {
      const a = this.mixer.clipAction(clip(n));
      a.play();
      a.setEffectiveWeight(n === 'Idle' ? 1 : 0);
      this.actions[n] = a;
    }
    const srcBones = {};
    this.src.traverse((o) => { if (o.isBone) srcBones[o.name.replace('mixamorig', '')] = o; });
    const tgtBones = {};
    target.traverse((o) => { if (o.isBone) (tgtBones[o.name] = tgtBones[o.name] || []).push(o); });
    this.target = target;

    // source T-pose
    const tpose = this.mixer.clipAction(clip('TPose'));
    for (const a of Object.values(this.actions)) a.setEffectiveWeight(0);
    tpose.play();
    this.mixer.update(0);
    this.src.updateMatrixWorld(true);
    // lift A-pose arms to a T before measuring the target rest pose
    if (armRest) {
      for (const [n, s] of [['l_upperArm', 1], ['r_upperArm', -1]]) {
        for (const b of tgtBones[n] || []) b.quaternion.multiply(_d.setFromAxisAngle(Z, -s * armRest));
      }
    }
    target.updateMatrixWorld(true);
    this.links = [];
    for (const [, s, r, a] of MOCAP) {
      const tName = rpm ? r : a;
      if (!tName || !srcBones[s] || !tgtBones[tName]) continue;
      this.links.push({
        src: srcBones[s],
        srcRest: relQuat(srcBones[s], this.src, new THREE.Quaternion()).invert(),
        tgt: tgtBones[tName].map((b) => ({ b, rest: relQuat(b, target, new THREE.Quaternion()) })),
        depth: (() => { let d = 0, p = tgtBones[tName][0]; while (p.parent) { d++; p = p.parent; } return d; })(),
      });
    }
    this.links.sort((a, b) => a.depth - b.depth);
    // source and target may face opposite ways: compare where "left" is
    const sl = srcBones.LeftArm.getWorldPosition(new THREE.Vector3()).x;
    const tl = (tgtBones[rpm ? 'LeftArm' : 'l_upperArm'] || tgtBones.l_thigh)[0].getWorldPosition(new THREE.Vector3()).x;
    this.flip = Math.sign(sl) !== Math.sign(tl) ? new THREE.Quaternion().setFromAxisAngle(Y, Math.PI) : null;
    tpose.stop();
    this.hips = srcBones.Hips;
    this.hipsRestY = this.hips.getWorldPosition(new THREE.Vector3()).y;
    for (const a of Object.values(this.actions)) a.play();
    this.weights = { Idle: 1, Walk: 0, Run: 0 };
    this.bob = 0;
  }

  // blend toward the clip for this speed, then copy the pose across
  update(dt, speed, walkSpeed, runSpeed) {
    const run = clamp((speed - walkSpeed) / (runSpeed - walkSpeed), 0, 1);
    const walk = clamp(speed / walkSpeed, 0, 1) * (1 - run);
    const target = { Idle: 1 - clamp(speed / walkSpeed, 0, 1), Walk: walk, Run: run };
    for (const n of Object.keys(this.actions)) {
      this.weights[n] = damp(this.weights[n], target[n], 8, dt);
      this.actions[n].setEffectiveWeight(this.weights[n]);
    }
    // keep footsteps in time with the ground speed
    this.actions.Walk.timeScale = speed > 0.1 ? clamp(speed / walkSpeed, 0.6, 1.6) : 1;
    this.actions.Run.timeScale = speed > 0.1 ? clamp(speed / runSpeed, 0.7, 1.4) : 1;
    this.mixer.update(dt);
    this.src.updateMatrixWorld(true);
    for (const L of this.links) {
      relQuat(L.src, this.src, _d).multiply(L.srcRest);
      if (this.flip) _d.premultiply(this.flip).multiply(_inv.copy(this.flip).invert());
      for (const t of L.tgt) {
        _w.copy(_d).multiply(t.rest);
        relQuat(t.b.parent, this.target, _q).invert();
        t.b.quaternion.copy(_q).multiply(_w);
        t.b.updateMatrixWorld(true);
      }
    }
    this.bob = this.hips.getWorldPosition(_vec).y - this.hipsRestY;
  }
}

// ---------------------------------------------------------------------------
// Ronaldo, Messi, Truong Giang and Dam Vinh Hung stroll around the starting city. A pounce makes them
// react with their catchphrase.
// ---------------------------------------------------------------------------
export class CityPeople {
  constructor(scene, defs, soldier, area, towns) {
    this.area = area;
    this.towns = towns;
    this.list = defs.map((d, i) => {
      const group = new THREE.Group();
      const model = SkeletonUtils.clone(d.src.object);
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
      });
      group.add(model);
      scene.add(group);
      const mocap = new Mocap(soldier, model, !!d.rpm, d.rpm ? 0 : d.src.meta.armRest);
      const H = d.src.meta.H;
      const p = { ...d, group, model, mocap, H, pos: new THREE.Vector3(), heading: Math.random() * 6.28, speed: 0, goal: null, state: 'idle', timer: 1 + i, react: 0, stuck: 0, spin: 0 };
      this.pick(p, true);
      p.pos.copy(p.goal);
      this.pick(p);
      return p;
    });
  }

  free(x, z) {
    for (const c of this.towns.extra) if (!c.step && x > c.x0 - 0.8 && x < c.x1 + 0.8 && z > c.z0 - 0.8 && z < c.z1 + 0.8) return false;
    return true;
  }

  pick(p, anywhere) {
    const A = this.area;
    for (let i = 0; i < 40; i++) {
      const x = A.x + (Math.random() - 0.5) * A.w;
      const z = A.z + (Math.random() - 0.5) * A.d;
      if (this.free(x, z)) { p.goal = new THREE.Vector3(x, 0, z); return; }
    }
    if (anywhere) p.goal = new THREE.Vector3(A.x, 0, A.z);
  }

  update(dt, time, player, ctx) {
    for (const p of this.list) {
      const toCat = Math.atan2(player.pos.x - p.pos.x, player.pos.z - p.pos.z);
      let target = 0;
      if (p.react > 0) {
        p.react -= dt;
        p.heading = dampAngle(p.heading, toCat, 6, dt);
      } else if (p.state === 'idle') {
        p.timer -= dt;
        if (p.timer < 0) { p.state = 'walk'; this.pick(p); }
      } else {
        const dx = p.goal.x - p.pos.x, dz = p.goal.z - p.pos.z;
        const dist = Math.hypot(dx, dz);
        p.heading = dampAngle(p.heading, Math.atan2(dx, dz), 3, dt);
        target = p.walk;
        if (dist < 1) { p.state = 'idle'; p.timer = 2 + Math.random() * 5; }
      }
      p.speed = damp(p.speed, target, 4, dt);
      const ox = p.pos.x, oz = p.pos.z;
      p.pos.x += Math.sin(p.heading) * p.speed * dt;
      p.pos.z += Math.cos(p.heading) * p.speed * dt;
      const top = this.towns.collide(p.pos, 0.45, p.pos.y);
      if (p.speed > 0.5 && Math.hypot(p.pos.x - ox, p.pos.z - oz) < p.speed * dt * 0.3) {
        p.stuck += dt;
        if (p.stuck > 1) { p.stuck = 0; this.pick(p); }
      } else p.stuck = 0;
      p.pos.y = Math.max(terrainHeight(p.pos.x, p.pos.z), top);

      p.mocap.update(dt, p.speed, p.walk, p.walk * 2.6);
      if (p.src.after) p.src.after(p.model);
      // Ronaldo's reaction: SIUUU jump with a full turn
      let hop = 0;
      if (p.react > 0 && p.celebrate === 'siu') {
        const k = clamp((2.2 - p.react) / 0.6, 0, 1);
        hop = Math.sin(Math.PI * k) * p.H * 0.18;
        p.spin = Math.PI * 2 * k * k * (3 - 2 * k);
      } else p.spin = 0;
      p.group.position.set(p.pos.x, p.pos.y + p.mocap.bob * 0 + hop, p.pos.z);
      p.group.rotation.y = p.heading + p.spin;
    }
  }

  // a pounce that lands on someone: they react and say their line
  tryCatch(point, reach) {
    for (const p of this.list) {
      if (p.react > 0) continue;
      if (Math.hypot(p.pos.x - point.x, p.pos.z - point.z) < reach + 0.4 && Math.abs(p.pos.y - point.y) < p.H) {
        p.react = p.talk || 2.2;
        p.state = 'idle';
        p.timer = p.react + 0.3;
        return p;
      }
    }
    return null;
  }
}
