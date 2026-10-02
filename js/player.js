import * as THREE from 'three';
import { terrainHeight, clamp, damp, dampAngle, lerp, smoothstep } from './noise.js';

export class Input {
  constructor(dom) {
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.dragging = false;
    this.enabled = true;
    const typing = (e) => ['SELECT', 'INPUT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName);
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || (typing(e) && e.code !== 'Escape')) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      if (this.keys.has(e.code)) this.released.add(e.code);
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      for (const k of this.keys) this.released.add(k);
      this.keys.clear();
    });
    // Mouse look: click the game to lock the pointer, then the camera follows
    // the mouse and a left click pounces. Esc frees the cursor. Dragging still
    // works as a fallback (right button, or anywhere pointer lock is refused).
    this.dom = dom;
    this.clicked = false;
    this.lockFailed = false;
    dom.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      document.activeElement && document.activeElement.blur && document.activeElement.blur();
      if (e.button === 0 && this.locked) {
        this.clicked = true;
        return;
      }
      if (e.button === 0 && !this.locked && !this.lockFailed) {
        this.requestLock();
        return;
      }
      this.dragging = true;
      dom.setPointerCapture(e.pointerId);
    });
    document.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.dx += e.movementX;
        this.dy += e.movementY;
      } else if (this.dragging) {
        this.dx += e.movementX;
        this.dy += e.movementY;
      }
    });
    const up = () => (this.dragging = false);
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', up);
    document.addEventListener('pointerlockchange', () => {
      this.dragging = false;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.lockFailed = true;
      if (this.onLockChange) this.onLockChange(false);
    });
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.enabled) this.wheel += e.deltaY;
    }, { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get locked() {
    return document.pointerLockElement === this.dom;
  }

  requestLock() {
    try {
      const r = this.dom.requestPointerLock();
      if (r && r.catch) r.catch(() => { this.lockFailed = true; });
    } catch {
      this.lockFailed = true;
    }
  }

  releaseLock() {
    if (this.locked) document.exitPointerLock();
  }

  down(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  hit(code) {
    return this.pressed.has(code);
  }

  endFrame() {
    this.clicked = false;
    this.pressed.clear();
    this.released.clear();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
  }
}

export class Player {
  constructor() {
    this.pos = new THREE.Vector3(0, terrainHeight(0, 0), 0);
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.vy = 0;
    this.grounded = true;
    this.flying = false;
    this.sleeping = false;
    this.eHeld = 0;
    this.meowT = 99;
    this.idleT = 0;
    this.turn = 0;
    this.slope = 0;
    this.stepAcc = 0;
    this.speed = 0;
    this.pounceT = 0;
    this.pounceCD = 0;
    this.w = { airW: 0, flyW: 0, sleepW: 0, sitW: 0, groomW: 0, meowW: 0, pounceW: 0 };
  }

  setRig(rig) {
    this.rig = rig;
    this.cfg = rig.cfg;
  }

  update(dt, I, camYaw, ctx) {
    const C = this.cfg;
    const f = (I.down('KeyW', 'ArrowUp') ? 1 : 0) - (I.down('KeyS', 'ArrowDown') ? 1 : 0);
    const r = (I.down('KeyD', 'ArrowRight') ? 1 : 0) - (I.down('KeyA', 'ArrowLeft') ? 1 : 0);
    const shift = I.down('ShiftLeft', 'ShiftRight');
    const space = I.down('Space');
    let mx = -Math.sin(camYaw) * f + Math.cos(camYaw) * r;
    let mz = -Math.cos(camYaw) * f - Math.sin(camYaw) * r;
    const ml = Math.hypot(mx, mz);
    const wants = ml > 0;
    if (wants) { mx /= ml; mz /= ml; }

    if (I.hit('KeyF')) {
      this.flying = !this.flying;
      if (this.flying) {
        this.sleeping = false;
        this.vy = Math.max(this.vy, 3);
        this.grounded = false;
      }
    }
    if (I.hit('KeyZ') && !this.flying && this.grounded) this.sleeping = !this.sleeping;
    if (wants || I.hit('Space')) this.sleeping = false;

    if (I.down('KeyE')) this.eHeld += dt;
    if (I.released.has('KeyE')) {
      if (this.eHeld < 0.3) {
        this.meowT = 0;
        this.sleeping = false;
        ctx.onMeow && ctx.onMeow();
      }
      this.eHeld = 0;
    }
    // pounce
    this.pounceCD -= dt;
    this.pounceT -= dt;
    if (I.clicked && this.pounceCD <= 0) {
      this.sleeping = false;
      this.eHeld = 0;
      this.pounceT = 0.42;
      this.pounceCD = 0.65;
      if (this.grounded) {
        this.vy = C.jump * 0.62;
        this.grounded = false;
      }
      ctx.sound && ctx.sound.pounce();
    }
    const pouncing = this.pounceT > 0;
    const grooming = this.eHeld >= 0.3 && !this.flying && this.grounded && !wants && !this.sleeping;
    this.meowT += dt;

    // horizontal motion
    let target = 0;
    if (this.flying) target = wants ? 7.5 : 0;
    else if (!this.sleeping && !grooming) target = wants ? (shift ? C.run : C.walk) : 0;
    const rate = this.flying ? 2.5 : this.grounded ? 9 : 2;
    this.vel.x = damp(this.vel.x, mx * target, rate, dt);
    this.vel.z = damp(this.vel.z, mz * target, rate, dt);
    if (pouncing) {
      // lunge forward in the facing direction
      const lunge = Math.max(C.run * 1.1, 5);
      this.vel.x = Math.sin(this.heading) * lunge;
      this.vel.z = Math.cos(this.heading) * lunge;
    }
    this.speed = Math.hypot(this.vel.x, this.vel.z);

    const prevHeading = this.heading;
    if (wants && !this.sleeping) this.heading = dampAngle(this.heading, Math.atan2(mx, mz), this.flying ? 4 : 10, dt);
    let dh = this.heading - prevHeading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    this.turn = damp(this.turn, dh / Math.max(dt, 1e-3), 8, dt);

    // vertical motion
    if (this.flying) {
      const vt = (space ? 4.2 : 0) - (shift ? 4.2 : 0);
      this.vy = damp(this.vy, vt, 4, dt);
    } else {
      if (this.grounded && I.hit('Space') && !this.sleeping) {
        this.vy = C.jump;
        this.grounded = false;
        ctx.sound && ctx.sound.jump();
      }
      this.vy -= 13 * dt;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vy * dt;

    let rockTop = ctx.props ? ctx.props.collide(this.pos, C.radius * 0.8, this.pos.y) : -Infinity;
    if (ctx.towns) rockTop = Math.max(rockTop, ctx.towns.collide(this.pos, C.radius * 0.8, this.pos.y));
    const terrain = terrainHeight(this.pos.x, this.pos.z);
    const ground = Math.max(terrain, rockTop);
    if (this.pos.y <= ground) {
      if (!this.grounded && this.vy < -2.5) ctx.sound && ctx.sound.land();
      this.pos.y = ground;
      if (this.flying && shift) this.flying = false;
      if (this.flying) {
        this.vy = Math.max(0, this.vy);
        this.grounded = false;
      } else {
        this.vy = 0;
        this.grounded = true;
      }
    } else if (!this.flying) {
      if (this.grounded && this.pos.y - ground < 0.3 && this.vy <= 0) {
        this.pos.y = ground;
        this.vy = 0;
      } else {
        this.grounded = false;
      }
    }
    if (this.flying) this.pos.y = Math.min(this.pos.y, terrain + 70);

    // footsteps
    if (this.grounded && this.speed > 0.3) {
      this.stepAcc += this.speed * dt;
      const stride = this.speed > C.walk + 0.5 ? 0.55 : 0.4;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        ctx.sound && ctx.sound.step(this.speed > C.walk + 0.5 ? 1.4 : 1);
      }
    }

    // slope pitch along heading
    const hx = Math.sin(this.heading) * 0.35;
    const hz = Math.cos(this.heading) * 0.35;
    const dy = terrainHeight(this.pos.x + hx, this.pos.z + hz) - terrainHeight(this.pos.x - hx, this.pos.z - hz);
    this.slope = damp(this.slope, -Math.atan2(dy, 0.7), 8, dt);

    // posture weights
    const w = this.w;
    const still = !wants && this.grounded && !this.flying;
    this.idleT = still ? this.idleT + dt : 0;
    const autoSit = this.idleT > 7 && !this.sleeping;
    w.airW = damp(w.airW, !this.grounded && !this.flying ? 1 : 0, 12, dt);
    w.flyW = damp(w.flyW, this.flying ? 1 : 0, 5, dt);
    w.sleepW = damp(w.sleepW, this.sleeping ? 1 : 0, 2.5, dt);
    w.sitW = damp(w.sitW, (grooming || autoSit) && !this.sleeping && this.rig.skin.kind === 'quad' && !this.rig.skin.hold ? 1 : 0, 4, dt);
    w.groomW = damp(w.groomW, grooming ? 1 : 0, 6, dt);
    w.meowW = this.meowT < 0.65 ? Math.sin((this.meowT / 0.65) * Math.PI) : 0;
    w.pounceW = damp(w.pounceW, pouncing ? 1 : 0, 18, dt);
  }
}

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.yaw = Math.PI;
    this.pitch = 0.3;
    this.dist = 3.4;
    this.distTarget = 3.4;
    this.target = new THREE.Vector3();
    this.cine = false;
    this.cineT = 0;
    this.shot = 0;
    this.c = { yaw: 0, pitch: 0.2, dist: 4, h: 0.4 };
    this.tmp = new THREE.Vector3();
  }

  toggleCinematic(player) {
    this.cine = !this.cine;
    this.cineT = 0;
    this.shot = 0;
    this.c.yaw = this.yaw;
    this.c.pitch = this.pitch;
    this.c.dist = this.dist;
    this.cineYaw = player.heading + Math.PI;
  }

  update(dt, I, player, rig) {
    const camH = rig.cfg.camH;
    if (I.dx || I.dy) {
      const k = I.locked ? 0.0032 : 0.0055;
      this.yaw -= I.dx * k;
      this.pitch = clamp(this.pitch + I.dy * k * 0.75, 0.02, 1.3);
    }
    if (I.wheel) this.distTarget = clamp(this.distTarget * Math.exp(I.wheel * 0.0012), 1.2, 16);
    this.dist = damp(this.dist, this.distTarget * (1 + player.w.flyW * 0.5), 6, dt);

    const goal = this.tmp.copy(player.pos);
    goal.y += camH * lerp(1, 0.8, player.w.sleepW);
    // follow the cat tightly sideways (a lagging target made it judder
    // against the background); only height is smoothed
    this.target.x = goal.x;
    this.target.z = goal.z;
    this.target.y = damp(this.target.y, goal.y, 10, dt);

    let yaw = this.yaw, pitch = this.pitch, dist = this.dist, look = this.target;
    if (this.cine) {
      this.cineT += dt;
      if (this.cineT > 9) {
        this.cineT = 0;
        this.shot = (this.shot + 1) % 4;
        this.cineYaw = player.heading + Math.PI + (Math.random() - 0.5) * 1.5;
      }
      this.cineYaw += dt * [0.12, 0.03, 0.05, 0.02][this.shot];
      const shots = [
        { yaw: this.cineYaw, pitch: 0.14, dist: 3.6 },
        { yaw: player.heading + Math.PI / 2, pitch: -0.04, dist: 2.3 },
        { yaw: this.cineYaw, pitch: 0.55, dist: 9.5 },
        { yaw: player.heading + 0.5, pitch: 0.08, dist: 1.7 },
      ];
      const s = shots[this.shot];
      this.c.yaw = dampAngle(this.c.yaw, s.yaw, 0.9, dt);
      this.c.pitch = damp(this.c.pitch, s.pitch, 0.9, dt);
      this.c.dist = damp(this.c.dist, s.dist * camH / 0.45 * 0.9 + 0.3, 0.9, dt);
      yaw = this.c.yaw;
      pitch = this.c.pitch;
      dist = this.c.dist;
    }

    const cp = Math.cos(pitch);
    const pos = this.cam.position;
    pos.set(look.x + Math.sin(yaw) * cp * dist, look.y + Math.sin(pitch) * dist, look.z + Math.cos(yaw) * cp * dist);
    const floor = terrainHeight(pos.x, pos.z) + 0.5;
    if (pos.y < floor) pos.y = floor;
    this.cam.lookAt(look);
    this.viewYaw = Math.atan2(pos.x - look.x, pos.z - look.z);
  }

  // Movement is relative to what the player actually sees.
  get moveYaw() {
    return this.viewYaw ?? this.yaw;
  }
}

export { smoothstep };
