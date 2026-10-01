import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Environment } from './sky.js';
import { Terrain } from './terrain.js';
import { Grass } from './grass.js';
import { Props } from './props.js';
import { SKINS, createCat } from './cat.js';
import { WINGS, CAPE, createWings, setWingEnvironment, getWingEnvironment } from './wings.js';
import { Towns } from './town.js';
import { Mice } from './mice.js';
import { Rain, Motes, Butterflies, FloatText } from './effects.js';
import { Sound } from './audio.js';
import { Input, Player, CameraRig } from './player.js';
import { terrainHeight, smoothstep } from './noise.js';

const $ = (id) => document.getElementById(id);
// Yield to the browser; the timeout keeps loading going in a background tab.
const frame = () => new Promise((r) => { requestAnimationFrame(() => r()); setTimeout(r, 60); });

const QUALITY = {
  low: { px: 0.75, shadow: 0, ext: 10, near: 45000, far: 25000 },
  medium: { px: 1, shadow: 1024, ext: 11, near: 90000, far: 50000 },
  high: { px: 1.5, shadow: 2048, ext: 14, near: 140000, far: 75000 },
  ultra: { px: 2, shadow: 4096, ext: 16, near: 200000, far: 110000 },
};
const MEOW_TEXT = { ginger: 'mew!', midnight: 'meow', tuxedo: 'meow!', chonky: 'mrrrp', buff: 'MEOW.', maxwell: 'meow?', tom: 'MEOWWW!', oiia: 'oiia!' };

// Catching mice unlocks these.
const REWARDS = [
  { at: 5, kind: 'wings', id: 'helicopter', name: 'Helicopter rotor', how: 'Press F to spin up and take off.' },
  { at: 10, kind: 'skin', id: 'tom', name: 'Tom', how: 'Wings on (F) and he flies with his bat cape.' },
  { at: 15, kind: 'skin', id: 'oiia', name: 'OIIA Cat', how: 'Hold E to spin round and round: oiia oiia!' },
];

// ---------------------------------------------------------------- settings
const SAVE_KEY = 'catsim.v1';
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; }
}
const settings = Object.assign({ quality: 'medium', weather: 'clear', time: 'cycle', sound: true, skin: 'ginger', wings: 'angel', mice: 0 }, loadSettings());
const unlocked = (item) => !item || !item.unlock || settings.mice >= item.unlock;
if (!unlocked(SKINS.find((s) => s.id === settings.skin))) settings.skin = 'ginger';
if (!unlocked(WINGS.find((w) => w.id === settings.wings))) settings.wings = 'angel';
if (!QUALITY[settings.quality]) settings.quality = 'medium';
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
}

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('stage').appendChild(renderer.domElement);

const pmrem = new THREE.PMREMGenerator(renderer);
setWingEnvironment(pmrem.fromScene(new RoomEnvironment(), 0.04).texture);

const input = new Input(renderer.domElement);
input.enabled = false;
const sound = new Sound();
sound.enabled = settings.sound;

let W = null; // the live world
let running = false;
let time = 0;

// ---------------------------------------------------------------- world
async function buildWorld(progress) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 1600);
  const env = new Environment(scene);
  progress(0.12, 'Shaping the hills…');
  await frame();
  const terrain = new Terrain(scene);
  progress(0.25, 'Growing grass…');
  await frame();
  const grassNear = new Grass({ patch: 28, maxCount: 200000, height: 0.4, width: 0.042, segments: 4, seed: 3 });
  const grassFar = new Grass({ patch: 90, maxCount: 110000, height: 0.45, width: 0.13, segments: 3, seed: 5, ao: 0.75 });
  scene.add(grassNear.mesh, grassFar.mesh);
  progress(0.4, 'Planting trees…');
  await frame();
  const props = new Props(scene);
  const rain = new Rain(scene);
  const motes = new Motes(scene);
  const butterflies = new Butterflies(scene);
  const text = new FloatText(scene);
  progress(0.5, 'Building the towns…');
  await frame();
  const towns = new Towns(scene);
  const mice = new Mice(scene);
  grassNear.uniforms.uMice.value = mice.push;
  grassFar.uniforms.uMice.value = mice.push;
  const player = new Player();
  const camRig = new CameraRig(camera);
  props.update(player.pos);
  towns.update(player.pos, 0);
  return { scene, camera, env, terrain, grassNear, grassFar, props, towns, mice, rain, motes, butterflies, text, player, camRig, zzzT: 0, catPush: new THREE.Vector3(), hintT: 0, wasFlying: false };
}

function applyQuality() {
  const q = QUALITY[settings.quality];
  renderer.setPixelRatio(Math.min(devicePixelRatio, q.px));
  if (!W) return;
  W.env.setShadowQuality(q.shadow, q.ext);
  W.grassNear.setCount(q.near);
  W.grassFar.setCount(q.far);
}

function applySettings() {
  applyQuality();
  if (W) {
    W.env.setWeather(settings.weather);
    W.env.setTimeMode(settings.time);
  }
  $('opt-quality').value = settings.quality;
  $('opt-weather').value = settings.weather;
  $('opt-time').value = settings.time;
  $('opt-sound').textContent = settings.sound ? 'On' : 'Off';
}

function setCharacter() {
  const skin = SKINS.find((s) => s.id === settings.skin);
  const spec = skin.shape === 'tom' ? CAPE : WINGS.find((w) => w.id === settings.wings);
  if (W.rig) {
    W.scene.remove(W.rig.root);
    W.rig.dispose();
    W.wings.dispose();
  }
  const rig = createCat(skin);
  const wings = createWings(spec);
  wings.onFlap = (f) => sound.flap(f);
  rig.wingMount.add(wings.group);
  W.scene.add(rig.root);
  W.player.setRig(rig);
  W.rig = rig;
  W.wings = wings;
  const hold = skin.hold || (skin.shape === 'tom' ? 'sneak' : skin.kind === 'biped' ? 'flex' : skin.kind === 'loaf' ? 'spin' : 'groom');
  $('e-label').textContent = `Meow (hold: ${hold})`;
}

// ---------------------------------------------------------------- menu
const thumbs = { renderer: null };
// A quiet meadow spot away from roads and towns for the menu pictures.
const TX = 30, TZ = -150;

function card(item, group, onPick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'card';
  b.dataset.id = item.id;
  const badge = item.badge ? `<span class="badge ${item.badge === 'DEFAULT' ? 'default' : ''}">${item.badge}</span>` : '';
  b.innerHTML = `<img class="thumb" alt="" /><span class="check"></span>
    ${item.unlock ? `<span class="lock">🔒 Catch ${item.unlock} mice</span>` : ''}
    <div class="meta"><div class="name">${item.name}${badge}</div><div class="desc">${item.desc}</div></div>`;
  b.addEventListener('click', () => {
    if (!unlocked(item)) {
      toast(`Catch ${item.unlock} mice to unlock ${item.name} (you have ${settings.mice})`);
      return;
    }
    onPick(item.id);
  });
  b.addEventListener('dblclick', () => enter());
  group.appendChild(b);
  return b;
}

function refreshLocks() {
  for (const el of document.querySelectorAll('.card')) {
    const item = SKINS.find((s) => s.id === el.dataset.id) || WINGS.find((w) => w.id === el.dataset.id);
    el.classList.toggle('locked', !unlocked(item));
  }
}

function markSelected() {
  refreshLocks();
  for (const el of document.querySelectorAll('#cat-grid .card')) el.classList.toggle('selected', el.dataset.id === settings.skin);
  for (const el of document.querySelectorAll('#wing-grid .card')) el.classList.toggle('selected', el.dataset.id === settings.wings);
}

function buildMenu() {
  const cg = $('cat-grid');
  const wg = $('wing-grid');
  SKINS.forEach((s) => card(s, cg, (id) => {
    const changed = id !== settings.skin;
    settings.skin = id;
    save();
    markSelected();
    if (changed) renderWingThumbs();
  }));
  WINGS.forEach((w) => card(w, wg, (id) => {
    settings.wings = id;
    save();
    markSelected();
  }));
  markSelected();
  $('enter').addEventListener('click', () => enter());
}

function thumbStage() {
  if (thumbs.renderer) return thumbs;
  const tr = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  tr.setPixelRatio(1);
  tr.setSize(420, 252);
  tr.outputColorSpace = THREE.SRGBColorSpace;
  tr.toneMapping = THREE.ACESFilmicToneMapping;
  tr.toneMappingExposure = 1.05;
  tr.shadowMap.enabled = true;
  tr.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#cdb994');
  scene.fog = new THREE.Fog('#cdb994', 3, 11);
  scene.add(new THREE.HemisphereLight('#d6dceb', '#4a4420', 1.1));
  const sun = new THREE.DirectionalLight('#ffd6a3', 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.5, far: 20 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const terrain = new Terrain(scene);
  terrain.update({ x: TX, z: TZ }, 0);
  const grass = new Grass({ patch: 10, maxCount: 26000, height: 0.36, width: 0.06, seed: 11 });
  scene.add(grass.mesh);
  const gy = terrainHeight(TX, TZ);
  grass.update(0, { x: TX, z: TZ }, new THREE.Vector3(TX, TZ, 1), {
    wind: 0.3, lightDir: new THREE.Vector3(2, 4, 3).normalize(), sunColorScaled: new THREE.Color('#ffd6a3').multiplyScalar(0.8), rain: 0,
  });
  grass.uniforms.uCatR.value = 0.5;
  const cam = new THREE.PerspectiveCamera(30, 420 / 252, 0.05, 40);
  const env = new THREE.PMREMGenerator(tr).fromScene(new RoomEnvironment(), 0.04).texture;
  Object.assign(thumbs, { renderer: tr, scene, sun, cam, gy, env });
  return thumbs;
}

const IDLE = { speed: 0, airW: 0, flyW: 0, sleepW: 0, sitW: 0, groomW: 0, meowW: 0, vy: 0, slope: 0, turn: 0, time: 0, night: 0 };

function snap(skin, wingSpec) {
  const T = thumbStage();
  const rig = createCat(skin);
  rig.blinkT = 5;
  rig.lookT = 9;
  rig.root.position.set(TX, T.gy, TZ);
  rig.root.rotation.y = wingSpec ? 0.35 : 0.25;
  let wings = null;
  if (wingSpec) {
    const mainEnv = getWingEnvironment();
    setWingEnvironment(T.env);
    wings = createWings(wingSpec);
    setWingEnvironment(mainEnv);
    wings.prime();
    rig.wingMount.add(wings.group);
    wings.update(0, { flyW: 1, vy: 0, speed: 0, time: 0, night: 0, scale: rig.cfg.wingScale, pose: 'spread' });
  }
  rig.update(0.016, { ...IDLE, flyW: 0 });
  T.scene.add(rig.root);
  const k = rig.cfg.thumbK || rig.cfg.camH / 0.45;
  const h = rig.cfg.camH;
  if (wingSpec) {
    T.cam.position.set(TX - 1.55 * k, T.gy + 2.0 * k, TZ - 2.3 * k);
    T.cam.lookAt(TX, T.gy + h * 0.95, TZ + 0.15);
    T.sun.position.set(TX - 1, T.gy + 4, TZ + 3);
  } else {
    T.cam.position.set(TX + 1.35 * k, T.gy + 0.55 * k, TZ + 1.95 * k);
    T.cam.lookAt(TX, T.gy + h * 0.8, TZ);
    T.sun.position.set(TX + 2.5, T.gy + 4, TZ + 3);
  }
  T.sun.target.position.set(TX, T.gy, TZ);
  T.renderer.render(T.scene, T.cam);
  const url = T.renderer.domElement.toDataURL('image/jpeg', 0.88);
  T.scene.remove(rig.root);
  rig.dispose();
  if (wings) wings.dispose();
  return url;
}

async function renderCatThumbs() {
  for (const s of SKINS) {
    await frame();
    const img = document.querySelector(`#cat-grid .card[data-id="${s.id}"] .thumb`);
    img.src = snap(s, null);
  }
}

let wingJob = 0;
async function renderWingThumbs() {
  const job = ++wingJob;
  let skin = SKINS.find((s) => s.id === settings.skin);
  if (skin.shape === 'tom') skin = SKINS[0];
  for (const w of WINGS) {
    await frame();
    if (job !== wingJob) return;
    const img = document.querySelector(`#wing-grid .card[data-id="${w.id}"] .thumb`);
    img.src = snap(skin, w);
  }
}

// ---------------------------------------------------------------- flow
let entering = false;
async function enter() {
  if (entering || $('menu').classList.contains('hidden')) return;
  entering = true;
  sound.init();
  sound.setEnabled(settings.sound);
  if (!W) {
    $('menu').classList.add('hidden');
    $('loading').classList.remove('hidden');
    const progress = (p, msg) => {
      $('load-bar').style.width = `${Math.round(p * 100)}%`;
      if (msg) $('load-text').textContent = msg;
    };
    W = await buildWorld(progress);
    applySettings();
    setCharacter();
    W.camRig.target.copy(W.player.pos);
    W.env.update(0, 0, { camera: W.camera.position, player: W.player.pos });
    progress(0.6, 'Compiling shaders…');
    await frame();
    try {
      await renderer.compileAsync(W.scene, W.camera);
    } catch {
      renderer.compile(W.scene, W.camera);
    }
    progress(1, 'Ready');
    await frame();
    $('loading').classList.add('hidden');
  } else {
    const r = W.rig;
    if (r.skin.id !== settings.skin || W.wings.spec.id !== settings.wings) setCharacter();
    $('menu').classList.add('hidden');
  }
  $('hud').classList.remove('hidden');
  input.enabled = true;
  running = true;
  entering = false;
  updateQuest();
  if (!questShown) {
    questShown = true;
    showQuest();
  }
}

// ---------------------------------------------------------------- quests
let questShown = false;

function nextReward() {
  return REWARDS.find((r) => settings.mice < r.at);
}

function updateQuest() {
  $('q-count').textContent = settings.mice;
  const next = nextReward();
  if (next) {
    const prev = REWARDS.filter((r) => r.at <= settings.mice).reduce((a, r) => Math.max(a, r.at), 0);
    $('q-goal').innerHTML = `Next: <b>${next.name}</b> at ${next.at} mice`;
    $('q-fill').style.width = `${((settings.mice - prev) / (next.at - prev)) * 100}%`;
  } else {
    $('q-goal').innerHTML = 'Everything unlocked — keep hunting!';
    $('q-fill').style.width = '100%';
  }
}

function modal(title, html, buttons) {
  input.releaseLock();
  input.enabled = false;
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = html;
  const row = $('modal-actions');
  row.innerHTML = '';
  for (const [label, fn, primary] of buttons) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = primary ? 'enter' : 'ghost';
    b.textContent = label;
    b.addEventListener('click', () => {
      $('modal').classList.add('hidden');
      input.enabled = true;
      fn && fn();
    });
    row.appendChild(b);
  }
  $('modal').classList.remove('hidden');
  row.firstChild && row.firstChild.focus();
}

function showQuest() {
  const items = REWARDS.map((r) => `<li class="${settings.mice >= r.at ? 'done' : ''}"><span>${settings.mice >= r.at ? '✓' : r.at}</span>
    <div><b>${r.name}</b><small>${r.kind === 'wings' ? 'New wings' : 'New cat'} · ${r.how}</small></div></li>`).join('');
  modal('Mouse hunt 🐭', `<p>Mice are hiding in the meadow and around town. <b>Left-click to pounce</b> — every mouse you catch is 1 point.</p>
    <ul class="rewards">${items}</ul>
    <p class="muted">Click the game to steer the camera with your mouse · Esc frees the cursor · Q shows this again.<br>You have caught <b>${settings.mice}</b> so far.</p>`,
  [['Start hunting', null, true]]);
}

function onCatch(m) {
  settings.mice += 1;
  save();
  sound.caught();
  const p = m.pos.clone();
  p.y += 0.6;
  W.text.spawn('+1 🐭', p, { size: 0.7, life: 1.4, rise: 0.6, color: '#ffe39a' });
  updateQuest();
  refreshLocks();
  const r = REWARDS.find((x) => x.at === settings.mice);
  if (r) {
    sound.unlock();
    setTimeout(() => {
      modal(`Unlocked: ${r.name}!`, `<p>You caught <b>${r.at}</b> mice. ${r.kind === 'wings' ? 'Your new wings are ready.' : 'A new cat joined the meadow.'}</p><p class="muted">${r.how}</p>`,
        [[`Use ${r.name} now`, () => {
          if (r.kind === 'wings') settings.wings = r.id;
          else settings.skin = r.id;
          save();
          setCharacter();
          markSelected();
          renderWingThumbs();
        }, true], ['Later', null, false]]);
    }, 500);
  } else {
    toast(nextReward() ? `${settings.mice} / ${nextReward().at} mice` : `${settings.mice} mice caught`);
  }
}

function openMenu() {
  input.releaseLock();
  input.enabled = false;
  $('menu').classList.add('overlay');
  $('menu').classList.remove('hidden');
  markSelected();
  renderWingThumbs();
}

// ---------------------------------------------------------------- HUD
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 1800);
}

$('opt-quality').addEventListener('change', (e) => { settings.quality = e.target.value; save(); applyQuality(); e.target.blur(); });
$('opt-weather').addEventListener('change', (e) => { settings.weather = e.target.value; save(); W && W.env.setWeather(settings.weather); e.target.blur(); });
$('opt-time').addEventListener('change', (e) => { settings.time = e.target.value; save(); W && W.env.setTimeMode(settings.time); e.target.blur(); });
$('opt-sound').addEventListener('click', (e) => {
  settings.sound = !settings.sound;
  save();
  sound.init();
  sound.setEnabled(settings.sound);
  e.target.textContent = settings.sound ? 'On' : 'Off';
  e.target.blur();
});
$('opt-skins').addEventListener('click', (e) => { e.target.blur(); openMenu(); });
$('share').addEventListener('click', async (e) => {
  e.target.blur();
  const url = location.href.split('#')[0];
  try {
    if (navigator.share) await navigator.share({ title: 'Cat Simulator', url });
    else { await navigator.clipboard.writeText(url); toast('Link copied'); }
  } catch { /* share cancelled */ }
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && !$('menu').classList.contains('hidden')) {
    e.preventDefault();
    enter();
  } else if (e.code === 'Escape' && !$('menu').classList.contains('hidden') && W) {
    enter();
  }
});

window.addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  if (W) {
    W.camera.aspect = innerWidth / innerHeight;
    W.camera.updateProjectionMatrix();
  }
});

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let fps = 60;
let debugOn = false;

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!W || !W.rig) return;
  step(dt);
  renderer.render(W.scene, W.camera);
  if (debugOn) showDebug();
  input.endFrame();
}

function step(dt) {
  time += dt;
  fps = fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
  const { scene, camera, env, player, camRig, rig, wings } = W;

  if (running && input.enabled) {
    if (input.hit('KeyQ')) showQuest();
    if (input.hit('KeyC')) {
      camRig.toggleCinematic(player);
      document.body.classList.toggle('cine', camRig.cine);
      document.body.classList.toggle('hide-ui', camRig.cine);
    }
    if (input.hit('Escape') && camRig.cine) {
      camRig.toggleCinematic(player);
      document.body.classList.remove('cine', 'hide-ui');
    }
    if (input.hit('KeyH')) document.body.classList.toggle('hide-ui');
    if (input.hit('F3')) {
      debugOn = !debugOn;
      $('debug').classList.toggle('hidden', !debugOn);
    }
  }

  player.update(dt, input, camRig.moveYaw, {
    props: W.props,
    towns: W.towns,
    sound,
    onMeow: () => {
      sound.meow(rig.skin.meow, rig.skin.id === 'tom' ? 'tom' : 'meow');
      const p = rig.headWorld(new THREE.Vector3());
      p.y += rig.cfg.camH * 0.55 + 0.12;
      W.text.spawn(MEOW_TEXT[rig.skin.id] || 'meow', p, { size: 0.55, life: 1.3, rise: 0.35 });
    },
  });
  rig.root.position.copy(player.pos);
  rig.root.rotation.y = player.heading + (rig.spinAngle || 0);
  wings.update(dt, { flyW: player.w.flyW, vy: player.vy, speed: player.speed, time, night: env.night, scale: rig.cfg.wingScale, halfWidth: rig.cfg.halfWidth });
  rig.update(dt, { ...player.w, speed: player.speed, vy: player.vy, slope: player.slope, turn: player.turn, time, night: env.night, wingFlap: wings.flapAngle || 0 });
  camRig.update(dt, input, player, rig);
  W.towns.fixCamera(camRig.target, camera.position);
  camera.lookAt(camRig.target);

  // helicopter: meme on take-off, rotor chop while spinning
  if (player.flying && !W.wasFlying && wings.isRotor) sound.helicopter();
  W.wasFlying = player.flying;
  sound.rotor(wings.isRotor ? wings.omega : 0);
  sound.oiia(rig.skin.hold === 'spin' && player.w.groomW > 0.5);

  // mice
  W.mice.update(dt, time, player, {
    props: W.props,
    towns: W.towns,
    sound,
    onAlert: (m) => {
      const p = m.pos.clone();
      p.y += 0.55;
      W.text.spawn('!', p, { size: 0.45, life: 0.8, rise: 0.4, color: '#fff2b0' });
    },
  });
  if (player.pounceT > 0) {
    const reach = new THREE.Vector3(Math.sin(player.heading), 0, Math.cos(player.heading)).multiplyScalar(rig.cfg.radius + 0.25).add(player.pos);
    const caught = W.mice.tryCatch(reach, 0.85);
    if (caught) onCatch(caught);
  }
  W.hintT -= dt;
  if (W.hintT < 0) {
    W.hintT = 0.25;
    const n = W.mice.nearest(player.pos);
    if (n) {
      const ang = Math.atan2(n.mouse.pos.x - player.pos.x, n.mouse.pos.z - player.pos.z);
      const rel = ang - (camRig.moveYaw + Math.PI);
      $('q-arrow').style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
      $('q-dist').textContent = `${Math.round(n.dist)} m`;
    }
  }

  env.update(dt, time, { camera: camera.position, player: player.pos });
  if (env.thunder) setTimeout(() => sound.thunder(), 400 + Math.random() * 1600);
  W.terrain.update(player.pos, env.rain);
  const g = terrainHeight(player.pos.x, player.pos.z);
  W.catPush.set(player.pos.x, player.pos.z, 1 - smoothstep(0.1, 0.8, player.pos.y - g));
  W.grassNear.uniforms.uCatR.value = rig.cfg.radius * 1.7;
  W.grassNear.update(time, player.pos, W.catPush, env);
  W.grassFar.update(time, player.pos, W.catPush, env);
  W.props.update(player.pos);
  W.towns.update(player.pos, env.night);
  W.rain.update(time, camera.position, env);
  W.motes.update(time, player.pos, env, renderer.getPixelRatio());
  W.butterflies.update(dt, time, player.pos, player.grounded ? player.speed : 3, env, W.props.flowerSpots);

  if (player.w.sleepW > 0.85) {
    W.zzzT -= dt;
    if (W.zzzT < 0) {
      W.zzzT = 1.3;
      const p = rig.headWorld(new THREE.Vector3());
      p.y += 0.2;
      p.x += 0.1;
      W.text.spawn('z', p, { size: 0.32, life: 2.4, rise: 0.28, drift: 0.15, color: '#e8f0ff' });
    }
  }
  W.text.update(dt);
  sound.update(dt, env, player);
  sound.purr(player.sleeping && player.w.sleepW > 0.6);

}

function showDebug() {
  const { env, player } = W;
  {
    const info = renderer.info.render;
    const h = env.hours;
    $('debug').textContent =
      `FPS      ${fps.toFixed(0)}\n` +
      `Calls    ${info.calls}\nTris     ${(info.triangles / 1000).toFixed(0)}k\n` +
      `Grass    ${(W.grassNear.geometry.instanceCount / 1000).toFixed(0)}k + ${(W.grassFar.geometry.instanceCount / 1000).toFixed(0)}k\n` +
      `Pos      ${player.pos.x.toFixed(1)}, ${player.pos.y.toFixed(1)}, ${player.pos.z.toFixed(1)}\n` +
      `Time     ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}  sun ${env.sunElev.toFixed(0)}°\n` +
      `Weather  ${settings.weather}  rain ${env.rain.toFixed(2)}\n` +
      `State    ${player.flying ? 'flying' : player.sleeping ? 'sleeping' : player.grounded ? 'ground' : 'air'}`;
  }
}

// ---------------------------------------------------------------- boot
buildMenu();
applySettings();
requestAnimationFrame(tick);
renderCatThumbs().then(renderWingThumbs);

// debugging hook: catsim.advance(seconds, keys) runs the simulation with
// fixed steps (useful when the tab is throttled in the background).
window.catsim = {
  get world() { return W; },
  settings,
  sound,
  advance(seconds, keys = []) {
    if (keys.includes('Click')) input.clicked = true;
    for (const k of keys) { input.keys.add(k); input.pressed.add(k); }
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) {
      step(1 / 60);
      input.pressed.clear();
      input.clicked = false;
    }
    if (keys.length) {
      for (const k of keys) { input.keys.delete(k); input.released.add(k); }
      step(1 / 60);
    }
    renderer.render(W.scene, W.camera);
    if (debugOn) showDebug();
    input.endFrame();
  },
};
