// All sound is made here at runtime with Web Audio: layered gunshots, explosions, footsteps,
// ambience for each place, radio chatter blips and an adaptive score that builds as a fight
// heats up. No sound files. Sounds from somewhere in the world are panned and muffled with
// distance from the listener (the camera).

const TAU = Math.PI * 2;
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

// Chord progressions per score (MIDI root notes and minor/major triads), one chord per bar
const SCORES = {
  menu: { bpm: 84, chords: [[50, 'm'], [46, 'M'], [53, 'M'], [48, 'M']] },
  desert: { bpm: 100, chords: [[50, 'm'], [46, 'M'], [48, 'M'], [45, 'm']] },
  port: { bpm: 96, chords: [[48, 'm'], [44, 'M'], [51, 'M'], [46, 'M']] },
  snow: { bpm: 92, chords: [[52, 'm'], [48, 'M'], [43, 'M'], [50, 'M']] },
};
const triad = (root, q) => [root, root + (q === 'm' ? 3 : 4), root + 7];

export function createAudio(settings) {
  let ctx = null;
  let master, comp, sfxBus, musicBus, ambBus, uiBus, reverb, reverbSend, muffle, noise, brown;
  let listener = { x: 0, y: 0, z: 0, yaw: 0 };
  let voices = 0;
  let theme = 'desert';
  let musicState = 'off';
  let intensity = 0;
  let layers = null;
  let nextNote = 0;
  let step16 = 0;
  let bar = 0;
  let ambience = [];
  let heartbeatT = 0;
  let downed = false;
  let heliNode = null;

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC({ latencyHint: 'interactive' });
    master = ctx.createGain();
    muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 20000;
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    master.connect(comp).connect(ctx.destination);
    sfxBus = ctx.createGain();
    ambBus = ctx.createGain();
    musicBus = ctx.createGain();
    uiBus = ctx.createGain();
    sfxBus.connect(muffle);
    ambBus.connect(muffle);
    muffle.connect(master);
    musicBus.connect(master);
    uiBus.connect(master);
    reverb = ctx.createConvolver();
    reverb.buffer = impulse(2.2, 2.6);
    reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.5;
    reverbSend.connect(reverb).connect(muffle);

    // Two seconds of white noise and of brown noise, reused by every sound
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    brown = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < b.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      b[i] = last * 3.5;
    }
    applyVolumes();
    setInterval(schedule, 25);
  }

  function impulse(seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // A few early reflections, then a smooth tail
        const early = i < ctx.sampleRate * 0.08 && Math.random() < 0.004 ? 1 : 0;
        data[i] = ((Math.random() * 2 - 1) * 0.6 + early) * (1 - t) ** decay;
      }
    }
    return buf;
  }

  function applyVolumes() {
    if (!ctx) return;
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(settings.master, t, 0.05);
    sfxBus.gain.setTargetAtTime(settings.sfx, t, 0.05);
    ambBus.gain.setTargetAtTime(settings.sfx * 0.55, t, 0.05);
    uiBus.gain.setTargetAtTime(settings.sfx * 0.6, t, 0.05);
    musicBus.gain.setTargetAtTime(settings.music * 0.55, t, 0.05);
  }

  // ------------------------------------------------------------ building blocks

  /** A noise burst through a filter, with a sharp attack and an exponential fade. */
  function burst(dest, t, { dur, gain, type = 'bandpass', freq = 1000, freqEnd = 0, q = 0.8, attack = 0.001, buf = noise, rate = 1 }) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.loop = true; // long sounds wrap round the buffer rather than cutting off
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * Math.max(0, buf.duration - dur - 0.1));
    src.stop(t + dur + 0.05);
  }

  /** An oscillator with a pitch sweep and a fade. */
  function tone(dest, t, { type = 'sine', freq, freqEnd = 0, dur, gain, attack = 0.002, detune = 0 }) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /**
   * Where a sound goes: panned, quietened and dulled with distance when it has a place in the
   * world, with more reverb the further away it is. Returns null when it's too far to hear.
   */
  function voice(at, { range = 1, life = 2, bus = sfxBus, wet = 0.25 } = {}) {
    if (voices > 40) return null;
    const g = ctx.createGain();
    let gain = 1;
    let pan = 0;
    let cutoff = 18000;
    let send = wet;
    if (at) {
      const dx = at.x - listener.x;
      const dz = at.z - listener.z;
      const dy = (at.y ?? 1) - listener.y;
      const d = Math.hypot(dx, dy, dz);
      gain = 1 / (1 + (d / (14 * range)) ** 1.3);
      if (gain < 0.02) return null;
      // Positive pan = to the right: right of the listener's facing is +90° of yaw
      const ang = Math.atan2(dz, dx) - listener.yaw;
      pan = Math.max(-1, Math.min(1, Math.sin(ang) * Math.min(1, d / 3)));
      cutoff = Math.max(900, 18000 * Math.exp(-d / (55 * range)));
      send = Math.min(0.9, wet + d / 80);
    }
    g.gain.value = gain;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    const s = ctx.createGain();
    s.gain.value = send;
    g.connect(lp).connect(p).connect(bus);
    p.connect(s).connect(reverbSend);
    voices++;
    setTimeout(() => {
      voices--;
      g.disconnect();
      p.disconnect();
      s.disconnect();
    }, life * 1000);
    return g;
  }

  // ------------------------------------------------------------ weapons

  /** A gunshot in layers: the crack, the body, a low thump and a tail that rings off the world. */
  function gunshot(at, o) {
    const out = voice(at, { range: o.range ?? 1.6, life: 2, wet: o.wet ?? 0.2 });
    if (!out) return;
    const t = ctx.currentTime;
    const p = o.pitch * (0.94 + Math.random() * 0.12);
    burst(out, t, { dur: 0.03, gain: o.crack, type: 'highpass', freq: 3500 * p, q: 0.5 });
    burst(out, t, { dur: o.bodyDur, gain: o.body, type: 'bandpass', freq: o.bodyFreq * p, freqEnd: o.bodyFreq * 0.4 * p, q: 0.9 });
    tone(out, t, { freq: o.thump * p, freqEnd: o.thump * 0.35 * p, dur: o.thumpDur ?? 0.14, gain: o.thumpGain ?? 0.9 });
    burst(out, t + 0.01, { dur: o.tail, gain: o.tailGain ?? 0.25, type: 'lowpass', freq: 1400 * p, freqEnd: 200, q: 0.3, attack: 0.02 });
  }

  const GUNS = {
    rifle: { crack: 0.55, body: 0.9, bodyFreq: 1500, bodyDur: 0.09, thump: 130, tail: 0.45, pitch: 1 },
    pistol: { crack: 0.6, body: 0.75, bodyFreq: 2000, bodyDur: 0.07, thump: 170, tail: 0.32, pitch: 1.1, thumpGain: 0.6 },
    sniper: { crack: 0.9, body: 1, bodyFreq: 1000, bodyDur: 0.2, thump: 75, thumpDur: 0.32, thumpGain: 1.2, tail: 1.6, tailGain: 0.45, pitch: 0.95, range: 4, wet: 0.35 },
    rifleFar: { crack: 0.3, body: 0.7, bodyFreq: 1300, bodyDur: 0.09, thump: 120, tail: 0.4, pitch: 0.98 },
    pistolFar: { crack: 0.35, body: 0.6, bodyFreq: 1800, bodyDur: 0.07, thump: 160, tail: 0.3, pitch: 1.05, thumpGain: 0.5 },
    enemyRifle: { crack: 0.35, body: 0.75, bodyFreq: 1150, bodyDur: 0.1, thump: 110, tail: 0.5, pitch: 0.9 },
    shotgun: { crack: 0.5, body: 1, bodyFreq: 800, bodyDur: 0.16, thump: 85, thumpDur: 0.2, thumpGain: 1.1, tail: 0.7, tailGain: 0.35, pitch: 0.9 },
    sniperFar: { crack: 0.8, body: 0.9, bodyFreq: 900, bodyDur: 0.22, thump: 70, thumpDur: 0.3, thumpGain: 1.1, tail: 1.8, tailGain: 0.5, pitch: 0.9, range: 5, wet: 0.4 },
    lmg: { crack: 0.35, body: 0.85, bodyFreq: 950, bodyDur: 0.1, thump: 95, tail: 0.45, pitch: 0.85 },
    minigun: { crack: 0.25, body: 0.6, bodyFreq: 1300, bodyDur: 0.05, thump: 120, thumpDur: 0.06, tail: 0.25, pitch: 1.1 },
  };

  function explosion(at, big = 1) {
    const out = voice(at, { range: 5, life: 4, wet: 0.35 });
    if (!out) return;
    const t = ctx.currentTime;
    burst(out, t, { dur: 0.06, gain: 1, type: 'highpass', freq: 1200 });
    burst(out, t, { dur: 1.3 * big, gain: 1.2, type: 'lowpass', freq: 2400, freqEnd: 120, q: 0.5, attack: 0.004 });
    tone(out, t, { freq: 90, freqEnd: 28, dur: 0.9 * big, gain: 1.4 });
    burst(out, t + 0.04, { dur: 2.4 * big, gain: 0.6, type: 'lowpass', freq: 400, freqEnd: 60, q: 0.4, attack: 0.08, buf: brown });
    // Falling debris
    for (let i = 0; i < 8; i++) burst(out, t + 0.25 + Math.random() * 1.2, { dur: 0.04, gain: 0.12 * Math.random(), type: 'bandpass', freq: 2500 + Math.random() * 3000, q: 2 });
  }

  function clicks(dest, t, list) {
    for (const [dt, freq, gain, dur = 0.025] of list) burst(dest, t + dt, { dur, gain, type: 'bandpass', freq, q: 3 });
  }

  /** Brass bouncing on the ground after the player's shots. */
  function casing(at, delay = 0.35) {
    const out = voice(at, { range: 0.5, life: 1.5, wet: 0.05 });
    if (!out) return;
    const t = ctx.currentTime + delay + Math.random() * 0.1;
    const f = 4200 + Math.random() * 1500;
    tone(out, t, { type: 'triangle', freq: f, dur: 0.05, gain: 0.05 });
    tone(out, t + 0.09, { type: 'triangle', freq: f * 1.08, dur: 0.04, gain: 0.03 });
  }

  // ------------------------------------------------------------ everything the game asks for

  function sfx(name, at = null) {
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    if (GUNS[name]) {
      gunshot(at, GUNS[name]);
      if (name === 'rifle' || name === 'pistol' || name === 'sniper') casing(listener);
      return;
    }
    const near = (range = 1, wet = 0.15) => voice(at, { range, life: 3, wet });
    let out;
    switch (name) {
      case 'boom':
        explosion(at, 1);
        break;
      case 'bossDown':
        explosion(at, 1.5);
        stinger([38, 45, 50, 57], 2.5, 0.35);
        break;
      case 'reload':
        if ((out = near(0.5))) clicks(out, t, [[0.05, 1800, 0.35], [0.35, 1200, 0.3, 0.04], [0.85, 2200, 0.45], [1.25, 1500, 0.5, 0.035], [1.4, 2600, 0.35]]);
        break;
      case 'empty':
        if ((out = near(0.5))) clicks(out, t, [[0, 3200, 0.4, 0.015]]);
        break;
      case 'select':
        if ((out = near(0.5))) clicks(out, t, [[0, 900, 0.3, 0.06], [0.12, 2400, 0.35]]);
        break;
      case 'throw':
        if ((out = near(0.8))) {
          clicks(out, t, [[0, 3000, 0.25, 0.02]]);
          burst(out, t + 0.05, { dur: 0.35, gain: 0.3, type: 'bandpass', freq: 600, freqEnd: 1800, q: 1.5, attack: 0.1 });
        }
        break;
      case 'vault':
      case 'boost':
        if ((out = near(0.7))) {
          burst(out, t, { dur: 0.25, gain: 0.35, type: 'bandpass', freq: 500, freqEnd: 1400, q: 1, attack: 0.06 });
          burst(out, t + 0.28, { dur: 0.1, gain: 0.5, type: 'lowpass', freq: 400 });
        }
        break;
      case 'pickup':
        if ((out = near(0.5))) {
          clicks(out, t, [[0, 2000, 0.3], [0.08, 2800, 0.25]]);
          tone(out, t + 0.02, { type: 'triangle', freq: 1320, dur: 0.12, gain: 0.08 });
        }
        break;
      case 'plant':
        if ((out = near(0.8))) for (let i = 0; i < 4; i++) tone(out, t + i * 0.18, { type: 'square', freq: 1760, dur: 0.07, gain: 0.08 });
        break;
      case 'order':
        radio(t);
        break;
      case 'kill':
        tone(uiBus, t, { type: 'sine', freq: 180, freqEnd: 90, dur: 0.12, gain: 0.25 });
        burst(uiBus, t, { dur: 0.03, gain: 0.15, type: 'highpass', freq: 5000 });
        break;
      case 'down':
        tone(sfxBus, t, { type: 'sawtooth', freq: 110, freqEnd: 55, dur: 1.2, gain: 0.12 });
        break;
      case 'revive':
        tone(uiBus, t, { type: 'triangle', freq: 440, freqEnd: 880, dur: 0.5, gain: 0.15, attack: 0.05 });
        tone(uiBus, t + 0.15, { type: 'triangle', freq: 660, freqEnd: 1320, dur: 0.5, gain: 0.1, attack: 0.05 });
        break;
      case 'area':
        stinger([38, 45, 50], 2.2, 0.22);
        boomLow(t, 0.7);
        break;
      case 'clear':
        stinger([50, 57, 62, 66], 1.8, 0.18);
        break;
      case 'complete':
        stinger([50, 57, 62, 66, 69], 4, 0.25);
        setTimeout(() => stinger([55, 62, 67, 71], 4, 0.22), 900);
        break;
      case 'fail':
        stinger([38, 41, 45], 3, 0.25);
        tone(sfxBus, t, { type: 'sawtooth', freq: 98, freqEnd: 40, dur: 2.5, gain: 0.15 });
        break;
      case 'overkill':
        // A rising whoosh into a hit
        burst(sfxBus, t, { dur: 0.9, gain: 0.35, type: 'bandpass', freq: 300, freqEnd: 4000, q: 2, attack: 0.8 });
        setTimeout(() => boomLow(ctx.currentTime, 1), 820);
        break;
      default:
        break;
    }
  }

  function boomLow(t, k) {
    tone(sfxBus, t, { freq: 70, freqEnd: 32, dur: 1.4, gain: 0.8 * k });
    burst(sfxBus, t, { dur: 1.2, gain: 0.35 * k, type: 'lowpass', freq: 600, freqEnd: 80, buf: brown });
  }

  /** A held chord swelling in and out, for area banners and results. */
  function stinger(notes, dur, gain) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(3200, t + dur * 0.3);
    f.frequency.exponentialRampToValueAtTime(500, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(musicBus);
    g.connect(reverbSend);
    for (const n of notes) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.1);
      }
    }
    setTimeout(() => g.disconnect(), (dur + 0.5) * 1000);
  }

  /** Radio squelch around an order. */
  function radio(t) {
    burst(uiBus, t, { dur: 0.08, gain: 0.25, type: 'bandpass', freq: 2200, q: 1.5 });
    tone(uiBus, t + 0.02, { type: 'square', freq: 1200, dur: 0.05, gain: 0.05 });
    burst(uiBus, t + 0.4, { dur: 0.12, gain: 0.2, type: 'bandpass', freq: 2600, q: 1.5 });
  }

  // ------------------------------------------------------------ footsteps and near misses

  const SURFACE = {
    desert: { freq: 700, q: 0.7, gain: 0.28, dur: 0.09, grit: 3200 },
    port: { freq: 1500, q: 1.2, gain: 0.3, dur: 0.06, grit: 5200 },
    snow: { freq: 2600, q: 0.6, gain: 0.22, dur: 0.11, grit: 4200 },
  };

  function footstep(at, loud = 1) {
    if (!ctx || ctx.state !== 'running') return;
    const out = voice(at, { range: 0.45, life: 1, wet: 0.05 });
    if (!out) return;
    const s = SURFACE[theme] || SURFACE.desert;
    const t = ctx.currentTime;
    const k = 0.85 + Math.random() * 0.3;
    burst(out, t, { dur: s.dur, gain: s.gain * loud, type: 'bandpass', freq: s.freq * k, q: s.q });
    burst(out, t + 0.012, { dur: 0.03, gain: s.gain * 0.4 * loud, type: 'highpass', freq: s.grit * k });
    if (theme === 'snow') burst(out, t + 0.04, { dur: 0.05, gain: s.gain * 0.5 * loud, type: 'bandpass', freq: 3400 * k, q: 1 });
  }

  /** A bullet snapping past the listener's head. side: -1 left .. 1 right */
  function whiz(side) {
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, side));
    p.connect(sfxBus);
    burst(p, t, { dur: 0.14, gain: 0.35, type: 'bandpass', freq: 5000, freqEnd: 1400, q: 4, attack: 0.03 });
    burst(p, t + 0.05, { dur: 0.03, gain: 0.2, type: 'highpass', freq: 6000 });
    setTimeout(() => p.disconnect(), 600);
  }

  /** A bullet hitting something near the listener. */
  function impact(at, kind) {
    if (!ctx || ctx.state !== 'running') return;
    const out = voice(at, { range: 0.6, life: 1, wet: 0.1 });
    if (!out) return;
    const t = ctx.currentTime;
    if (kind === 'flesh') {
      burst(out, t, { dur: 0.07, gain: 0.35, type: 'lowpass', freq: 900 });
    } else if (theme === 'port' && Math.random() < 0.5) {
      tone(out, t, { type: 'triangle', freq: 2400 + Math.random() * 1200, freqEnd: 900, dur: 0.18, gain: 0.08 });
      burst(out, t, { dur: 0.05, gain: 0.25, type: 'highpass', freq: 3000 });
    } else {
      burst(out, t, { dur: 0.06, gain: 0.3, type: 'bandpass', freq: 1800, q: 0.8 });
      if (Math.random() < 0.12) tone(out, t, { type: 'sine', freq: 3000, freqEnd: 1200, dur: 0.3, gain: 0.05 });
    }
  }

  /** The player's own hits landing. */
  function hit(kill, head) {
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    if (kill) {
      tone(uiBus, t, { type: 'sine', freq: head ? 1400 : 950, dur: 0.09, gain: 0.12 });
      burst(uiBus, t, { dur: 0.05, gain: 0.25, type: 'bandpass', freq: 2600, q: 2 });
    } else burst(uiBus, t, { dur: 0.035, gain: 0.22, type: 'bandpass', freq: 3600, q: 3 });
  }

  /** Thumping heart while you're down. */
  function heartbeat(t) {
    tone(sfxBus, t, { freq: 60, freqEnd: 40, dur: 0.16, gain: 0.7 });
    tone(sfxBus, t + 0.22, { freq: 55, freqEnd: 38, dur: 0.18, gain: 0.5 });
  }

  // ------------------------------------------------------------ ambience

  function startAmbience() {
    for (const a of ambience) a.stop();
    ambience = [];
    if (!ctx) return;
    const loop = (buf, filterType, freq, gain, q = 0.5, lfoRate = 0.07, lfoDepth = 0.4) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      // A slow swell, like gusts or waves
      const lfo = ctx.createOscillator();
      lfo.frequency.value = lfoRate;
      const lg = ctx.createGain();
      lg.gain.value = gain * lfoDepth;
      lfo.connect(lg).connect(g.gain);
      const lf = ctx.createGain();
      lf.gain.value = freq * 0.3;
      lfo.connect(lf).connect(f.frequency);
      src.connect(f).connect(g).connect(ambBus);
      src.start();
      lfo.start();
      ambience.push({ stop: () => (src.stop(), lfo.stop(), g.disconnect()) });
    };
    if (theme === 'desert') {
      loop(brown, 'bandpass', 500, 0.35, 0.6, 0.06);
      loop(noise, 'highpass', 6000, 0.012, 0.5, 0.11, 0.8); // sand hiss
    } else if (theme === 'port') {
      loop(brown, 'lowpass', 300, 0.45, 0.5, 0.15, 0.7); // waves on the quay
      loop(noise, 'bandpass', 3800, 0.06, 0.3, 0.02, 0.15); // rain
      loop(noise, 'highpass', 8000, 0.025, 0.4, 0.03, 0.2);
    } else if (theme === 'snow') {
      loop(brown, 'bandpass', 700, 0.4, 1.2, 0.05, 0.6);
      loop(noise, 'bandpass', 1800, 0.03, 2, 0.08, 0.7); // whistling wind
    } else if (theme === 'menu') {
      loop(brown, 'lowpass', 220, 0.25, 0.4, 0.05, 0.5);
    }
  }

  // ------------------------------------------------------------ music

  function buildLayers() {
    const mk = () => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(musicBus);
      return g;
    };
    layers = { pad: mk(), bass: mk(), drums: mk(), arp: mk(), taiko: mk() };
    const padVerb = ctx.createGain();
    padVerb.gain.value = 0.6;
    layers.pad.connect(padVerb).connect(reverbSend);
    layers.arp.connect(padVerb);
  }

  /** How loud each layer should be for the current state. */
  function mix() {
    if (musicState === 'off') return { pad: 0, bass: 0, drums: 0, arp: 0, taiko: 0 };
    if (musicState === 'menu') return { pad: 0.5, bass: 0.15, drums: 0.0, arp: 0.35, taiko: 0.15 };
    if (musicState === 'down') return { pad: 0.55, bass: 0, drums: 0, arp: 0, taiko: 0 };
    const i = intensity;
    return {
      pad: 0.45,
      bass: i >= 1 ? 0.55 : 0.2,
      drums: i >= 2 ? 0.7 : i >= 1 ? 0.35 : 0,
      arp: i >= 1 ? 0.3 : 0.12,
      taiko: i >= 3 ? 0.9 : i >= 2 ? 0.3 : 0,
    };
  }

  function schedule() {
    if (!ctx || ctx.state !== 'running' || !layers) return;
    const now = ctx.currentTime;
    const m = mix();
    for (const k in m) layers[k].gain.setTargetAtTime(m[k], now, 0.8);
    if (downed && now > heartbeatT) {
      heartbeat(now + 0.05);
      heartbeatT = now + 0.9;
    }
    if (musicState === 'off') {
      nextNote = now + 0.1;
      return;
    }
    const score = SCORES[musicState === 'menu' ? 'menu' : theme] || SCORES.desert;
    const s16 = 60 / score.bpm / 4;
    if (nextNote < now - 0.2) nextNote = now + 0.05;
    while (nextNote < now + 0.15) {
      playStep(score, step16, nextNote, s16);
      nextNote += s16;
      step16 = (step16 + 1) % 16;
      if (step16 === 0) bar++;
    }
  }

  function playStep(score, s, t, s16) {
    const [root, q] = score.chords[bar % score.chords.length];
    const chord = triad(root, q);
    const hi = intensity;
    if (s === 0) padChord(chord, t, s16 * 16 + 0.4);
    // Bass: driving eighths, an octave jump on the off-beats in a big fight
    if (s % 2 === 0) {
      const n = root - 12 + (hi >= 2 && s % 8 === 6 ? 12 : 0);
      pluck(layers.bass, t, midi(n), s16 * 1.8, 'sawtooth', 380 + hi * 120, 0.22);
    }
    // Arpeggio over the chord
    if (musicState === 'menu' ? s % 4 === 0 : s % 2 === 1 || hi >= 2) {
      const n = chord[(s >> 1) % 3] + 12 + ((s >> 3) % 2) * 12;
      pluck(layers.arp, t, midi(n), s16 * 1.5, 'triangle', 2600, 0.09);
    }
    // Drums
    if (s === 0 || s === 8 || (hi >= 2 && (s === 10 || s === 3))) kick(layers.drums, t);
    if (s === 4 || s === 12) snare(layers.drums, t);
    if (s % 2 === 0 || hi >= 2) hat(layers.drums, t, s % 4 === 2 ? 0.08 : 0.04);
    if (s === 0 || s === 6 || s === 12 || (s === 14 && bar % 2)) taiko(layers.taiko, t, s === 0 ? 1 : 0.6);
  }

  function padChord(chord, t, dur) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500 + intensity * 350;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.08, t + 0.9);
    g.gain.setValueAtTime(0.08, t + dur - 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.6);
    f.connect(g).connect(layers.pad);
    for (const n of [...chord, chord[0] - 12]) {
      for (const det of [-9, 4]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.7);
      }
    }
    setTimeout(() => g.disconnect(), (t - ctx.currentTime + dur + 1.5) * 1000);
  }

  function pluck(dest, t, freq, dur, type, cutoff, gain) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(cutoff * 0.25, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  const kick = (d, t) => tone(d, t, { freq: 140, freqEnd: 42, dur: 0.28, gain: 0.7 });
  const snare = (d, t) => {
    burst(d, t, { dur: 0.16, gain: 0.32, type: 'bandpass', freq: 1800, q: 0.6 });
    tone(d, t, { type: 'triangle', freq: 220, freqEnd: 150, dur: 0.08, gain: 0.2 });
  };
  const hat = (d, t, g) => burst(d, t, { dur: 0.04, gain: g, type: 'highpass', freq: 7500 });
  const taiko = (d, t, k) => {
    tone(d, t, { freq: 95, freqEnd: 55, dur: 0.5, gain: 0.6 * k });
    burst(d, t, { dur: 0.25, gain: 0.25 * k, type: 'lowpass', freq: 500, buf: brown });
  };

  // ------------------------------------------------------------ public

  return {
    /** Must be called from a user gesture before anything is heard. */
    unlock() {
      init();
      if (ctx?.state === 'suspended') ctx.resume();
      if (ctx && !layers) buildLayers();
    },
    get ready() {
      return !!ctx && ctx.state === 'running';
    },
    applyVolumes,
    sfx,
    footstep,
    whiz,
    impact,
    hit,
    /** UI sounds: hover, select, back, buy, deny */
    ui(name) {
      if (!ctx || ctx.state !== 'running') return;
      const t = ctx.currentTime;
      if (name === 'hover') burst(uiBus, t, { dur: 0.025, gain: 0.12, type: 'bandpass', freq: 4200, q: 4 });
      if (name === 'select') {
        burst(uiBus, t, { dur: 0.04, gain: 0.25, type: 'bandpass', freq: 2400, q: 3 });
        tone(uiBus, t, { type: 'triangle', freq: 880, dur: 0.08, gain: 0.06 });
      }
      if (name === 'back') tone(uiBus, t, { type: 'triangle', freq: 520, freqEnd: 330, dur: 0.1, gain: 0.08 });
      if (name === 'buy') {
        tone(uiBus, t, { type: 'triangle', freq: 1046, dur: 0.12, gain: 0.1 });
        tone(uiBus, t + 0.08, { type: 'triangle', freq: 1568, dur: 0.18, gain: 0.1 });
        clicks(uiBus, t, [[0, 3000, 0.2], [0.05, 2200, 0.2]]);
      }
      if (name === 'deny') tone(uiBus, t, { type: 'square', freq: 160, dur: 0.18, gain: 0.06 });
      if (name === 'type') burst(uiBus, t, { dur: 0.015, gain: 0.06, type: 'bandpass', freq: 3000 + Math.random() * 1500, q: 5 });
    },
    setListener(x, y, z, yaw) {
      listener = { x, y, z, yaw };
    },
    setTheme(t) {
      if (t === theme && ambience.length) return;
      theme = t;
      if (ctx) {
        reverb.buffer = impulse(t === 'port' ? 2.8 : t === 'snow' ? 3.2 : 1.8, t === 'desert' ? 3.5 : 2.4);
        startAmbience();
      }
    },
    /** 'off' | 'menu' | 'mission' | 'down' */
    setMusic(state) {
      musicState = state;
    },
    /** 0 calm, 1 contact, 2 firefight, 3 boss or surrounded */
    setIntensity(i) {
      intensity = i;
    },
    /** 0..1: how muffled the world sounds (hurt, down). */
    setMuffle(k) {
      if (!ctx) return;
      muffle.frequency.setTargetAtTime(20000 * Math.pow(0.03, k), ctx.currentTime, 0.15);
    },
    setDowned(on) {
      downed = on;
    },
    /** The helicopter's rotor thump from a place in the world, or null to silence it. */
    heli(at) {
      if (!ctx || ctx.state !== 'running') return;
      if (!at) {
        if (heliNode) {
          heliNode.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
          const n = heliNode;
          setTimeout(() => n.stop(), 2000);
          heliNode = null;
        }
        return;
      }
      if (!heliNode) {
        const src = ctx.createBufferSource();
        src.buffer = brown;
        src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 900;
        const am = ctx.createGain();
        am.gain.value = 0.5;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 17; // blade passes per second
        const lg = ctx.createGain();
        lg.gain.value = 0.5;
        lfo.connect(lg).connect(am.gain);
        const gain = ctx.createGain();
        gain.gain.value = 0;
        const pan = ctx.createStereoPanner();
        src.connect(f).connect(am).connect(gain).connect(pan).connect(sfxBus);
        src.start();
        lfo.start();
        heliNode = { gain, pan, stop: () => (src.stop(), lfo.stop(), pan.disconnect()) };
      }
      const dx = at.x - listener.x;
      const dz = at.z - listener.z;
      const d = Math.hypot(dx, at.y - listener.y, dz);
      heliNode.gain.gain.setTargetAtTime(Math.min(1.2, 30 / (10 + d)), ctx.currentTime, 0.2);
      heliNode.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, Math.sin(Math.atan2(dz, dx) - listener.yaw))), ctx.currentTime, 0.2);
    },
  };
}
