import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Rig } from './cat.js';
import { clamp, lerp, damp, dampAngle, terrainHeight, townMask, roadMask } from './noise.js';

// Two-legged characters built from real models (Tom, Ronaldo, Messi) and the
// goats that roam the meadows.

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
// Goats: graze in the meadows, trot away from cats.
// ---------------------------------------------------------------------------
const GOAT_ROLES = ['body', 'neck', 'fl_upper', 'fl_lower', 'fr_upper', 'fr_lower', 'bl_upper', 'bl_lower', 'br_upper', 'br_lower'];
const _v = new THREE.Vector3();

export class Goats {
  constructor(scene, src, count = 4) {
    this.list = [];
    this.H = src.meta.H;
    for (let i = 0; i < count; i++) {
      const space = new THREE.Group();
      const model = SkeletonUtils.clone(src.object);
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
      });
      space.add(model);
      scene.add(space);
      const roles = Object.fromEntries(GOAT_ROLES.map((r) => [r, r]));
      this.list.push({
        g: space, poser: new Poser(space, model, roles), pos: new THREE.Vector3(1e6, 0, 0),
        heading: Math.random() * 6.28, speed: 0, state: 'gone', timer: Math.random() * 3, phase: Math.random() * 6, graze: 0, bleatT: 3,
      });
    }
  }

  spawn(m, cat, ctx) {
    for (let tries = 0; tries < 16; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = 18 + Math.random() * 30;
      const x = cat.x + Math.cos(a) * d;
      const z = cat.z + Math.sin(a) * d;
      if (townMask(x, z) > 0.05 || roadMask(x, z, true)) continue;
      _v.set(x, 0, z);
      ctx.props.collide(_v, 0.5, -1e3);
      if (Math.abs(_v.x - x) > 0.01 || Math.abs(_v.z - z) > 0.01) continue;
      m.pos.set(x, terrainHeight(x, z), z);
      m.state = 'graze';
      m.timer = 2 + Math.random() * 4;
      m.g.visible = true;
      return;
    }
  }

  update(dt, time, player, ctx) {
    const cat = player.pos;
    const fast = player.speed > player.cfg.walk + 0.4;
    for (const m of this.list) {
      if (m.state === 'gone') {
        m.g.visible = false;
        m.timer -= dt;
        if (m.timer < 0) this.spawn(m, cat, ctx);
        continue;
      }
      const dx = m.pos.x - cat.x, dz = m.pos.z - cat.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 90) { m.state = 'gone'; m.timer = 1; continue; }
      const alert = player.sleeping ? 2 : fast ? 9 : player.flying && cat.y - m.pos.y > 4 ? 0 : 5.5;
      if (dist < alert && m.state !== 'flee') {
        m.state = 'flee';
        if (ctx.onAlert) ctx.onAlert(m, this.H);
        if (ctx.sound) ctx.sound.bleat();
      }
      m.timer -= dt;
      let target = 0;
      if (m.state === 'flee') {
        m.heading = dampAngle(m.heading, Math.atan2(dx, dz) + Math.sin(time * 2 + m.phase) * 0.4, 5, dt);
        target = 4.3;
        if (dist > 16) { m.state = 'walk'; m.timer = 2; }
      } else if (m.state === 'walk') {
        target = 1.0;
        m.heading += Math.sin(time * 0.7 + m.phase) * dt * 0.8;
        if (m.timer < 0) { m.state = 'graze'; m.timer = 3 + Math.random() * 5; }
      } else if (m.timer < 0) {
        m.state = 'walk';
        m.timer = 2 + Math.random() * 4;
        m.heading += (Math.random() - 0.5) * 2;
      }
      m.speed = damp(m.speed, target, 4, dt);
      m.pos.x += Math.sin(m.heading) * m.speed * dt;
      m.pos.z += Math.cos(m.heading) * m.speed * dt;
      // goats stay out of town
      if (townMask(m.pos.x, m.pos.z) > 0.3) m.heading += dt * 3;
      ctx.props.collide(m.pos, 0.45, m.pos.y);
      m.pos.y = terrainHeight(m.pos.x, m.pos.z);

      // animation
      const run = clamp(m.speed / 4.3, 0, 1);
      const move = clamp(m.speed / 1.0, 0, 1);
      m.phase += dt * m.speed * (run > 0.5 ? 3.2 : 4.5);
      const amp = lerp(0.35, 0.55, run) * move;
      const P = m.poser;
      const legs = [['fl', 0], ['fr', Math.PI], ['bl', Math.PI], ['br', 0]];
      for (const [n, off] of legs) {
        const ph = m.phase + off + (run > 0.5 && n[0] === 'b' ? 0.6 : 0);
        P.pose(`${n}_upper`, -Math.sin(ph) * amp);
        P.pose(`${n}_lower`, Math.max(0, Math.cos(ph)) * amp * 1.2 * (n[0] === 'f' ? 1 : -0.6));
      }
      m.graze = damp(m.graze, m.state === 'graze' ? 1 : 0, 3, dt);
      P.pose('neck', m.graze * 0.95 + Math.sin(time * 6 + m.phase) * 0.06 * m.graze - run * 0.15, 0, 0);
      m.g.position.set(m.pos.x, m.pos.y + Math.abs(Math.sin(m.phase)) * 0.06 * run, m.pos.z);
      m.g.rotation.y = m.heading;
    }
  }

  tryCatch(point, reach) {
    for (const m of this.list) {
      if (m.state === 'gone') continue;
      if (Math.hypot(m.pos.x - point.x, m.pos.z - point.z) < reach + 0.35 && Math.abs(m.pos.y - point.y) < 1.6) {
        m.state = 'gone';
        m.timer = 6 + Math.random() * 6;
        m.g.visible = false;
        return m;
      }
    }
    return null;
  }

  nearest(pos) {
    let best = null, bd = Infinity;
    for (const m of this.list) {
      if (m.state === 'gone') continue;
      const d = Math.hypot(m.pos.x - pos.x, m.pos.z - pos.z);
      if (d < bd) { bd = d; best = m; }
    }
    return best ? { mouse: best, dist: bd } : null;
  }
}
