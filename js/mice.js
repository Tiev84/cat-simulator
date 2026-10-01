import * as THREE from 'three';
import { terrainHeight, townMask, townCenter, TOWN, clamp, damp, dampAngle } from './noise.js';

// Mice scurry around the meadow and the towns. They nibble, wander, and bolt
// when the cat gets close; a well-timed pounce catches them.

const COATS = ['#8e8b86', '#9b8a76', '#e9e5dc', '#6f6a64', '#b39f86'];
const _v = new THREE.Vector3();

function buildMouse(coat) {
  const fur = new THREE.MeshStandardMaterial({ color: coat, roughness: 0.9, flatShading: true });
  const pink = new THREE.MeshStandardMaterial({ color: '#e0a2a0', roughness: 0.7, flatShading: true });
  const black = new THREE.MeshStandardMaterial({ color: '#0b0b0c', roughness: 0.2 });
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, parent = g) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const body = add(new THREE.SphereGeometry(1, 8, 6).scale(0.075, 0.066, 0.12), fur, 0, 0.08, 0);
  const head = new THREE.Group();
  head.position.set(0, 0.09, 0.1);
  g.add(head);
  add(new THREE.SphereGeometry(1, 8, 6).scale(0.052, 0.048, 0.075), fur, 0, 0.005, 0.04, head);
  add(new THREE.SphereGeometry(0.014, 6, 4), pink, 0, 0.0, 0.112, head);
  for (const s of [-1, 1]) {
    const ear = add(new THREE.SphereGeometry(1, 8, 6).scale(0.036, 0.036, 0.01), pink, s * 0.042, 0.05, 0.0, head);
    ear.rotation.y = s * 0.4;
    add(new THREE.SphereGeometry(0.011, 6, 4), black, s * 0.027, 0.02, 0.085, head);
  }
  const legs = [];
  for (const [x, z] of [[-0.045, 0.06], [0.045, 0.06], [-0.045, -0.06], [0.045, -0.06]]) {
    legs.push(add(new THREE.SphereGeometry(1, 6, 4).scale(0.02, 0.016, 0.03), pink, x, 0.018, z));
  }
  const tail = [];
  let parent = g;
  for (let i = 0; i < 6; i++) {
    const seg = new THREE.Group();
    if (i === 0) seg.position.set(0, 0.07, -0.11);
    else seg.position.set(0, 0, -0.045);
    seg.rotation.x = i === 0 ? 0.25 : -0.08;
    add(new THREE.CylinderGeometry(0.009 - i * 0.001, 0.008 - i * 0.001, 0.05, 4).rotateX(Math.PI / 2).translate(0, 0, -0.022), pink, 0, 0, 0, seg);
    parent.add(seg);
    parent = seg;
    tail.push(seg);
  }
  g.scale.setScalar(1.7);
  return { group: g, body, head, legs, tail, mats: [fur, pink, black] };
}

export class Mice {
  constructor(scene, count = 9) {
    this.scene = scene;
    this.list = [];
    for (let i = 0; i < count; i++) {
      const m = buildMouse(COATS[i % COATS.length]);
      scene.add(m.group);
      this.list.push({
        ...m,
        pos: new THREE.Vector3(1e6, 0, 0),
        heading: Math.random() * 6.28,
        speed: 0,
        state: 'gone',
        timer: Math.random() * 2,
        phase: Math.random() * 6,
        squeakT: 0,
      });
    }
    this.push = Array.from({ length: 8 }, () => new THREE.Vector3());
  }

  spawn(m, cat, ctx) {
    for (let tries = 0; tries < 12; tries++) {
      let x, z;
      const [tx, tz] = townCenter(cat.x, cat.z);
      const nearTown = Math.hypot(tx - cat.x, tz - cat.z) < TOWN.R + 70;
      if (nearTown && Math.random() < 0.6) {
        x = tx + (Math.random() - 0.5) * TOWN.R * 2;
        z = tz + (Math.random() - 0.5) * TOWN.R * 2;
      } else {
        const a = Math.random() * Math.PI * 2;
        const d = 12 + Math.random() * 24;
        x = cat.x + Math.cos(a) * d;
        z = cat.z + Math.sin(a) * d;
      }
      const d2 = (x - cat.x) ** 2 + (z - cat.z) ** 2;
      if (d2 < 10 * 10 || d2 > 45 * 45) continue;
      _v.set(x, 0, z);
      ctx.towns.collide(_v, 0.2, -1e3);
      if (Math.abs(_v.x - x) > 0.01 || Math.abs(_v.z - z) > 0.01) continue;
      m.pos.set(x, terrainHeight(x, z), z);
      m.state = 'wander';
      m.timer = 1 + Math.random() * 3;
      m.heading = Math.random() * 6.28;
      m.group.visible = true;
      return;
    }
  }

  update(dt, time, player, ctx) {
    const cat = player.pos;
    const catFast = player.speed > player.cfg.walk + 0.4;
    let pi = 0;
    for (const m of this.list) {
      if (m.state === 'gone') {
        m.group.visible = false;
        m.timer -= dt;
        if (m.timer < 0) this.spawn(m, cat, ctx);
        continue;
      }
      const dx = m.pos.x - cat.x;
      const dz = m.pos.z - cat.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 70) {
        m.state = 'gone';
        m.timer = 0.5;
        continue;
      }
      const alert = player.sleeping ? 1.2 : catFast ? 7.5 : player.flying && cat.y - m.pos.y > 3 ? 0 : 4.2;
      if (dist < alert && m.state !== 'flee') {
        m.state = 'flee';
        m.timer = 0;
        if (ctx.onAlert) ctx.onAlert(m);
      }
      m.timer -= dt;
      let target = 0;
      if (m.state === 'flee') {
        const away = Math.atan2(dx, dz) + Math.sin(time * 5 + m.phase) * 0.6;
        m.heading = dampAngle(m.heading, away, 8, dt);
        target = 3.4;
        if (dist > 11) { m.state = 'wander'; m.timer = 1 + Math.random() * 2; }
        m.squeakT -= dt;
        if (m.squeakT < 0) {
          m.squeakT = 1.2 + Math.random() * 2;
          if (dist < 15 && ctx.sound) ctx.sound.squeak(0.5);
        }
      } else if (m.state === 'wander') {
        target = 0.9;
        m.heading += Math.sin(time * 1.3 + m.phase) * dt * 1.5;
        if (m.timer < 0) { m.state = 'idle'; m.timer = 1 + Math.random() * 2.5; }
      } else if (m.state === 'idle') {
        if (m.timer < 0) { m.state = 'wander'; m.timer = 1.5 + Math.random() * 3; m.heading += (Math.random() - 0.5) * 2.5; }
      }
      m.speed = damp(m.speed, target, 10, dt);
      const ox = m.pos.x, oz = m.pos.z;
      m.pos.x += Math.sin(m.heading) * m.speed * dt;
      m.pos.z += Math.cos(m.heading) * m.speed * dt;
      ctx.props.collide(m.pos, 0.15, m.pos.y);
      ctx.towns.collide(m.pos, 0.15, m.pos.y);
      // blocked: turn away from the obstacle
      const moved = Math.hypot(m.pos.x - ox, m.pos.z - oz);
      if (m.speed > 0.5 && moved < m.speed * dt * 0.3) m.heading += 1.6;
      m.pos.y = terrainHeight(m.pos.x, m.pos.z);

      // animation
      m.phase += dt * (6 + m.speed * 9);
      const run = clamp(m.speed / 3.4, 0, 1);
      m.legs.forEach((l, i) => { l.position.y = 0.018 + Math.max(0, Math.sin(m.phase + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0))) * 0.02 * (m.speed > 0.1 ? 1 : 0); });
      m.body.position.y = 0.08 + Math.abs(Math.sin(m.phase)) * 0.012 * run;
      m.head.rotation.x = m.state === 'idle' ? 0.35 + Math.sin(time * 9 + m.phase) * 0.12 : -0.1 * run;
      m.tail.forEach((t, i) => { t.rotation.y = Math.sin(time * (3 + run * 6) - i * 0.7 + m.phase) * 0.25; });
      m.group.position.copy(m.pos);
      m.group.rotation.y = m.heading;

      if (pi < this.push.length && dist < 40) this.push[pi++].set(m.pos.x, m.pos.z, 1);
    }
    for (; pi < this.push.length; pi++) this.push[pi].set(0, 0, 0);
  }

  // Catch any mouse within reach of the cat's paws.
  tryCatch(point, reach) {
    for (const m of this.list) {
      if (m.state === 'gone') continue;
      const d = Math.hypot(m.pos.x - point.x, m.pos.z - point.z);
      if (d < reach && Math.abs(m.pos.y - point.y) < 1.2) {
        m.state = 'gone';
        m.timer = 2 + Math.random() * 3;
        m.group.visible = false;
        return m;
      }
    }
    return null;
  }

  nearest(pos) {
    let best = null;
    let bd = Infinity;
    for (const m of this.list) {
      if (m.state === 'gone') continue;
      const d = Math.hypot(m.pos.x - pos.x, m.pos.z - pos.z);
      if (d < bd) { bd = d; best = m; }
    }
    return best ? { mouse: best, dist: bd } : null;
  }
}

export { townMask };
