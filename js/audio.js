// Sounds are synthesized with Web Audio, except the optional clips in
// sounds/ (meow, Tom's scream, the helicopter and OIIA memes).

// Split a clip into its separate sounds (e.g. a file with four meows).
function segments(buf) {
  const d = buf.getChannelData(0);
  const sr = buf.sampleRate;
  const win = Math.floor(sr * 0.02);
  const env = [];
  for (let i = 0; i < d.length; i += win) {
    let m = 0;
    for (let j = i; j < Math.min(i + win, d.length); j++) m = Math.max(m, Math.abs(d[j]));
    env.push(m);
  }
  const peak = Math.max(...env);
  const segs = [];
  let start = -1;
  let gap = 0;
  env.forEach((v, k) => {
    if (v > peak * 0.08) {
      if (start < 0) start = k;
      gap = 0;
    } else if (start >= 0 && ++gap > 6) {
      segs.push([start, k - gap + 1]);
      start = -1;
      gap = 0;
    }
  });
  if (start >= 0) segs.push([start, env.length]);
  return segs
    .filter(([a, b]) => b - a >= 6)
    .map(([a, b]) => [Math.max(0, a * 0.02 - 0.03), Math.min(buf.duration, b * 0.02 + 0.1)]);
}
export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.birdT = 2;
    this.cricketT = 1;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.8 : 0;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.white = ctx.createBuffer(1, len, ctx.sampleRate);
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = this.white.getChannelData(0);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      w[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * w[i]) / 1.02;
      b[i] = last * 3.5;
    }

    this.wind = this.loop(this.brown, [['lowpass', 500, 0.7]]);
    this.rain = this.loop(this.white, [['highpass', 900, 0.5], ['lowpass', 7000, 0.5]]);
    this.flight = this.loop(this.white, [['bandpass', 700, 0.6]]);
    this.clip('oiia');
    this.clip('meow');
    this.clip('tom');
    this.clip('ronaldo');
    this.clip('messi');
    this.clip('truonggiang');
    this.clip('damvinhhung');
  }

  loop(buffer, filters) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    let node = src;
    const nodes = [];
    for (const [type, f, q] of filters) {
      const flt = ctx.createBiquadFilter();
      flt.type = type;
      flt.frequency.value = f;
      flt.Q.value = q;
      node.connect(flt);
      node = flt;
      nodes.push(flt);
    }
    const g = ctx.createGain();
    g.gain.value = 0;
    node.connect(g);
    g.connect(this.master);
    src.start(0, Math.random() * 1.5);
    return { gain: g, filters: nodes };
  }

  setEnabled(on) {
    this.enabled = on;
    if (!this.ctx) return;
    if (on && this.ctx.state === 'suspended') this.ctx.resume();
    this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.1);
  }

  ok() {
    return this.ctx && this.enabled;
  }

  update(dt, env, player) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const day = 1 - env.night;
    this.wind.gain.gain.setTargetAtTime(0.05 + env.wind * 0.07 + (player.flying ? 0.08 : 0), t, 0.5);
    this.wind.filters[0].frequency.setTargetAtTime(300 + env.wind * 300 + player.speed * 40, t, 0.5);
    this.rain.gain.gain.setTargetAtTime(env.rain * 0.22, t, 0.6);
    this.flight.gain.gain.setTargetAtTime(player.flying ? Math.min(0.12, player.speed * 0.02) : 0, t, 0.3);
    if (!this.enabled) return;
    this.birdT -= dt;
    if (this.birdT < 0) {
      this.birdT = 1.5 + Math.random() * 5;
      if (day > 0.6 && env.rain < 0.3) this.bird();
    }
    this.cricketT -= dt;
    if (this.cricketT < 0) {
      this.cricketT = 0.6 + Math.random() * 1.2;
      if (env.night > 0.5 && env.rain < 0.5) this.cricket();
    }
  }

  env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  // Plays a recorded meow when sounds/meow.mp3 (or tom.mp3 for Tom) exists:
  // one of the separate meows in the file, picked at random, pitched per cat.
  meow(pitch = 1, voice = 'meow') {
    if (!this.ok()) return;
    const buf = this.clip(voice) || this.clip('meow');
    if (buf) {
      // the meow file holds several meows: pick one; voice lines play whole
      const segs = voice === 'meow' && buf.segs && buf.segs.length ? buf.segs : [buf.trim || [0, buf.duration]];
      const [a, b] = segs[Math.floor(Math.random() * segs.length)];
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = voice !== 'meow' ? 1 : Math.sqrt(pitch) * (0.95 + Math.random() * 0.1);
      const g = this.ctx.createGain();
      g.gain.value = voice === 'meow' ? 1.4 : 1.6;
      src.connect(g).connect(this.master);
      if (this.voiceSrc) try { this.voiceSrc.stop(); } catch { /* ended */ }
      src.start(0, a, b - a);
      this.voiceSrc = src;
      return;
    }
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 0.55 + Math.random() * 0.2;
    const f0 = 520 * pitch * (0.92 + Math.random() * 0.16);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0 * 0.85, t);
    o.frequency.linearRampToValueAtTime(f0 * 1.25, t + dur * 0.3);
    o.frequency.linearRampToValueAtTime(f0 * 0.75, t + dur);
    const vib = ctx.createOscillator();
    vib.frequency.value = 6;
    const vibG = ctx.createGain();
    vibG.gain.value = f0 * 0.02;
    vib.connect(vibG).connect(o.frequency);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.Q.value = 5;
    f1.frequency.setValueAtTime(600 * pitch, t);
    f1.frequency.linearRampToValueAtTime(1300 * pitch, t + dur * 0.35);
    f1.frequency.linearRampToValueAtTime(700 * pitch, t + dur);
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.Q.value = 7;
    f2.frequency.value = 2600 * pitch;
    const g = ctx.createGain();
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    o.connect(f1).connect(g);
    o.connect(f2).connect(g2).connect(g);
    g.connect(this.master);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.06);
    g.gain.setValueAtTime(0.5, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.05);
    vib.stop(t + dur + 0.05);
  }

  purr(on) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (on && !this.purrNode) {
      const src = ctx.createBufferSource();
      src.buffer = this.brown;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 260;
      const am = ctx.createGain();
      am.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 24;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.5;
      lfo.connect(lfoG).connect(am.gain);
      const out = ctx.createGain();
      out.gain.value = 0;
      out.gain.setTargetAtTime(0.35, ctx.currentTime, 0.8);
      src.connect(lp).connect(am).connect(out).connect(this.master);
      src.start();
      lfo.start();
      this.purrNode = { src, lfo, out };
    } else if (!on && this.purrNode) {
      const p = this.purrNode;
      this.purrNode = null;
      p.out.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      setTimeout(() => { p.src.stop(); p.lfo.stop(); }, 1500);
    }
  }

  burst(type, freq, q, peak, a, d, buffer) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buffer || this.white;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    src.connect(f).connect(g).connect(this.master);
    this.env(g, t, a, peak, d);
    src.start(t, Math.random() * 1.5);
    src.stop(t + a + d + 0.05);
    return f;
  }

  step(vol = 1) {
    if (!this.ok()) return;
    this.burst('bandpass', 2500 + Math.random() * 1500, 0.8, 0.05 * vol, 0.01, 0.07);
  }

  flap(freq) {
    if (!this.ok()) return;
    const f = this.burst('lowpass', 900, 0.8, 0.18, 0.03, 0.22 + 0.2 / freq, this.brown);
    f.frequency.setTargetAtTime(250, this.ctx.currentTime, 0.12);
  }

  land() {
    if (!this.ok()) return;
    this.burst('lowpass', 300, 0.7, 0.35, 0.005, 0.18, this.brown);
    this.burst('bandpass', 2200, 0.7, 0.08, 0.005, 0.12);
  }

  jump() {
    if (!this.ok()) return;
    this.burst('bandpass', 1800, 1, 0.06, 0.01, 0.1);
  }

  thunder() {
    if (!this.ok()) return;
    const f = this.burst('lowpass', 420, 0.6, 0.9, 0.08, 3.2, this.brown);
    f.frequency.setTargetAtTime(90, this.ctx.currentTime + 0.3, 1.0);
  }

  squeak(vol = 1) {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const t = t0 + i * 0.09;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(2900 + Math.random() * 400, t);
      o.frequency.exponentialRampToValueAtTime(4300, t + 0.05);
      const g = ctx.createGain();
      o.connect(g).connect(this.master);
      this.env(g, t, 0.005, 0.06 * vol, 0.06);
      o.start(t);
      o.stop(t + 0.08);
    }
  }

  // goat "mehhh": a nasal buzzy vowel with a fast tremolo
  bleat() {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f0 = 330 + Math.random() * 80;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * 0.9, t + 0.6);
    const trem = ctx.createOscillator();
    trem.frequency.value = 11;
    const tremG = ctx.createGain();
    tremG.gain.value = 0.35;
    const amp = ctx.createGain();
    amp.gain.value = 0.6;
    trem.connect(tremG).connect(amp.gain);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 600;
    f1.Q.value = 4;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 1800;
    f2.Q.value = 6;
    const g = ctx.createGain();
    o.connect(amp);
    amp.connect(f1).connect(g);
    amp.connect(f2).connect(g);
    g.connect(this.master);
    this.env(g, t, 0.04, 0.35, 0.65);
    o.start(t);
    trem.start(t);
    o.stop(t + 0.8);
    trem.stop(t + 0.8);
  }

  // cardboard cannon: a deep thump with a crackle on top
  boom() {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.5);
    const g = ctx.createGain();
    o.connect(g).connect(this.master);
    this.env(g, t, 0.005, 0.9, 0.6);
    o.start(t);
    o.stop(t + 0.7);
    const f = this.burst('lowpass', 1800, 0.7, 0.55, 0.003, 0.5, this.brown);
    f.frequency.setTargetAtTime(200, t + 0.05, 0.15);
  }

  pounce() {
    if (!this.ok()) return;
    const f = this.burst('bandpass', 900, 0.9, 0.12, 0.02, 0.18);
    f.frequency.setTargetAtTime(2400, this.ctx.currentTime, 0.08);
  }

  chime(notes, step = 0.09, vol = 0.12, type = 'sine') {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    notes.forEach((f, i) => {
      const t = t0 + i * step;
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      o.connect(g).connect(this.master);
      this.env(g, t, 0.01, vol, 0.35);
      o.start(t);
      o.stop(t + 0.4);
    });
  }

  caught() {
    this.squeak(1);
    this.chime([880, 1320], 0.08, 0.1);
  }

  unlock() {
    this.chime([523, 659, 784, 1047, 1319], 0.11, 0.13, 'triangle');
  }

  // Continuous rotor chop; omega is the blade speed in rad/s.
  rotor(omega) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (!this.rotorNode && omega > 0.5) {
      const src = ctx.createBufferSource();
      src.buffer = this.brown;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 650;
      const am = ctx.createGain();
      am.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      const depth = ctx.createGain();
      depth.gain.value = 0.5;
      lfo.connect(depth).connect(am.gain);
      const out = ctx.createGain();
      out.gain.value = 0;
      src.connect(lp).connect(am).connect(out).connect(this.master);
      src.start();
      lfo.start();
      this.rotorNode = { src, lfo, out };
    }
    if (this.rotorNode) {
      const t = ctx.currentTime;
      this.rotorNode.lfo.frequency.setTargetAtTime(Math.max(1, (omega * 3) / (Math.PI * 2)), t, 0.05);
      this.rotorNode.out.gain.setTargetAtTime(Math.min(1, omega / 30) * 0.5, t, 0.1);
      if (omega < 0.3) {
        const n = this.rotorNode;
        this.rotorNode = null;
        n.out.gain.setTargetAtTime(0, t, 0.1);
        setTimeout(() => { n.src.stop(); n.lfo.stop(); }, 600);
      }
    }
  }

  // The "helicopter helicopter" meme. Drop your own clip at
  // sounds/helicopter.mp3 (or .m4a/.wav/.ogg) and it plays that; otherwise the
  // browser's voice says it.
  // Optional user-supplied clips in sounds/<name>.(mp3|m4a|wav|ogg).
  clip(name) {
    this.clips = this.clips || {};
    if (!(name in this.clips)) {
      this.clips[name] = null;
      (async () => {
        for (const ext of ['mp3', 'm4a', 'wav', 'ogg']) {
          try {
            const r = await fetch(`sounds/${name}.${ext}`);
            if (!r.ok) continue;
            const buf = await this.ctx.decodeAudioData(await r.arrayBuffer());
            // remember where the sound actually starts/ends so loops skip silence
            const d = buf.getChannelData(0);
            let a = 0, z = d.length - 1;
            while (a < z && Math.abs(d[a]) < 0.02) a++;
            while (z > a && Math.abs(d[z]) < 0.02) z--;
            buf.trim = [a / buf.sampleRate, (z + 1) / buf.sampleRate];
            buf.segs = segments(buf);
            this.clips[name] = buf;
            return;
          } catch { /* try the next format */ }
        }
      })();
    }
    return this.clips[name];
  }

  // "U I I A I" while the OIIA cat spins: loops sounds/oiia.mp3 if present,
  // otherwise a little vowel synthesizer sings it.
  oiia(on) {
    if (!this.ctx) return;
    on = on && this.enabled;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (!on) {
      if (this.oiiaNode) {
        const n = this.oiiaNode;
        this.oiiaNode = null;
        n.out.gain.setTargetAtTime(0, t, 0.05);
        setTimeout(() => n.stop(), 400);
      }
      return;
    }
    if (!this.oiiaNode) {
      const buf = this.clip('oiia');
      const out = ctx.createGain();
      out.gain.value = 0;
      out.gain.setTargetAtTime(buf ? 1.3 : 0.32, t, 0.03);
      out.connect(this.master);
      if (buf) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const [a0, a1] = buf.trim || [0, buf.duration];
        src.loopStart = a0;
        src.loopEnd = a1;
        src.connect(out);
        src.start(0, a0);
        this.oiiaNode = { out, stop: () => src.stop() };
      } else {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 600;
        const vib = ctx.createOscillator();
        vib.frequency.value = 7;
        const vibG = ctx.createGain();
        vibG.gain.value = 12;
        vib.connect(vibG).connect(osc.frequency);
        const env = ctx.createGain();
        env.gain.value = 0;
        const formants = [[1, 9], [0.55, 12], [0.25, 14]].map(([g, q]) => {
          const f = ctx.createBiquadFilter();
          f.type = 'bandpass';
          f.Q.value = q;
          const fg = ctx.createGain();
          fg.gain.value = g * 3;
          osc.connect(f).connect(fg).connect(env);
          return f;
        });
        env.connect(out);
        osc.start();
        vib.start();
        this.oiiaNode = { out, osc, env, formants, next: t + 0.02, stop: () => { osc.stop(); vib.stop(); } };
      }
    }
    const n = this.oiiaNode;
    if (!n.osc) return;
    // keep ~0.4 s of syllables scheduled ahead
    const V = { u: [300, 870, 2240, 540], i: [270, 2290, 3010, 700], a: [730, 1090, 2440, 610] };
    const phrases = [[['u', 0.13], ['i', 0.1], ['i', 0.1], ['a', 0.17], ['i', 0.15]], [['u', 0.13], ['i', 0.1], ['i', 0.1], ['i', 0.1], ['a', 0.17], ['i', 0.22]]];
    while (n.next < t + 0.4) {
      const phrase = phrases[(n.count = (n.count || 0) + 1) % 2];
      for (const [v, d] of phrase) {
        const [f1, f2, f3, p] = V[v];
        const s0 = n.next;
        n.osc.frequency.setTargetAtTime(p * (0.97 + Math.random() * 0.06), s0, 0.015);
        n.formants[0].frequency.setTargetAtTime(f1, s0, 0.02);
        n.formants[1].frequency.setTargetAtTime(f2, s0, 0.02);
        n.formants[2].frequency.setTargetAtTime(f3, s0, 0.02);
        n.env.gain.setValueAtTime(0.15, s0);
        n.env.gain.linearRampToValueAtTime(1, s0 + 0.025);
        n.env.gain.linearRampToValueAtTime(0.6, s0 + d);
        n.next += d;
      }
      n.env.gain.linearRampToValueAtTime(0.05, n.next + 0.05);
      n.next += 0.09;
    }
  }

  async helicopter() {
    if (!this.ok()) return;
    if (this.memeBuffer === undefined) {
      this.memeBuffer = null;
      for (const ext of ['mp3', 'm4a', 'wav', 'ogg']) {
        try {
          const r = await fetch(`sounds/helicopter.${ext}`);
          if (!r.ok) continue;
          this.memeBuffer = await this.ctx.decodeAudioData(await r.arrayBuffer());
          break;
        } catch { /* try the next format */ }
      }
    }
    if (this.memeBuffer) {
      // restart instead of stacking when F is pressed repeatedly
      if (this.memeSrc) try { this.memeSrc.stop(); } catch { /* already ended */ }
      const src = this.ctx.createBufferSource();
      src.buffer = this.memeBuffer;
      const g = this.ctx.createGain();
      g.gain.value = 0.9;
      src.connect(g).connect(this.master);
      src.start();
      this.memeSrc = src;
      return;
    }
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance('Helicopter, helicopter!');
      u.pitch = 0.3;
      u.rate = 0.8;
      const voices = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.startsWith('en'));
      if (voices.length) u.voice = voices.find((v) => /male|daniel|fred|alex/i.test(v.name)) || voices[0];
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    }
  }

  bird() {
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 2600 + Math.random() * 1600;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; pan.connect(this.master); }
    for (let i = 0; i < notes; i++) {
      const t = t0 + i * (0.09 + Math.random() * 0.06);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.3), t);
      o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.4), t + 0.06);
      const g = ctx.createGain();
      o.connect(g).connect(pan || this.master);
      this.env(g, t, 0.01, 0.035, 0.07);
      o.start(t);
      o.stop(t + 0.1);
    }
  }

  cricket() {
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const f = 4300 + Math.random() * 500;
    for (let i = 0; i < 3; i++) {
      const t = t0 + i * 0.07;
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      o.connect(g).connect(this.master);
      this.env(g, t, 0.005, 0.018, 0.04);
      o.start(t);
      o.stop(t + 0.06);
    }
  }
}
