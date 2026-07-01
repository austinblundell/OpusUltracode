/**
 * Audio.js — Fully procedural WebAudio SFX + crowd ambience.
 *
 * No external files. Every sound is synthesized at runtime from oscillators
 * and a single shared white-noise buffer. The AudioContext is created lazily
 * on the first user gesture (resume()) to respect browser autoplay policy.
 *
 * All public methods are safe no-ops before resume() has run — each guards on
 * the presence of an AudioContext, so callers never have to check state.
 */

// A short reusable white-noise buffer. Built once, reused by every noise voice.
const NOISE_SECONDS = 2.0;

export class AudioManager {
  constructor() {
    // Lazy: nothing audible or heavyweight is created until resume().
    this.ctx = null;
    this.master = null;       // master gain (user volume)
    this.comp = null;         // gentle bus compressor
    this._noise = null;       // shared AudioBuffer of white noise
    this._masterVolume = 0.9;

    // Ambience state.
    this._amb = null;         // { src, gain, filter, lfo, ... } or null
    this._ambTimer = null;    // setTimeout handle for random swells
    this._excitement = 0.0;   // 0..1 target crowd energy
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Create + resume the AudioContext. Call from a user-gesture handler. */
  resume() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return; // no WebAudio available — stay a silent no-op.
      const ctx = new AC();
      this.ctx = ctx;

      // Master chain: voices -> compressor -> master gain -> destination.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 26;
      comp.ratio.value = 3.2;
      comp.attack.value = 0.004;
      comp.release.value = 0.22;

      const master = ctx.createGain();
      master.gain.value = this._masterVolume;

      comp.connect(master);
      master.connect(ctx.destination);

      this.comp = comp;
      this.master = master;

      // Build the shared noise buffer once.
      this._noise = this._buildNoiseBuffer();
    }
    // Resume (may be suspended by autoplay policy). Ignore the promise.
    if (this.ctx.state === 'suspended') {
      const p = this.ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  }

  /** Set the user-facing master volume (0..1+). */
  setMasterVolume(v) {
    this._masterVolume = Math.max(0, v);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this._masterVolume, t, 0.02);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  _buildNoiseBuffer() {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * NOISE_SECONDS);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** A one-shot noise source reading from the shared buffer. */
  _noiseSource(loop = false) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = loop;
    return src;
  }

  /** Auto-disconnect a node (and optional extras) when a source ends. */
  _disposeOnEnd(src, ...nodes) {
    src.onended = () => {
      try { src.disconnect(); } catch (e) { /* already gone */ }
      for (const n of nodes) { try { n.disconnect(); } catch (e) { /* */ } }
    };
  }

  // -------------------------------------------------------------------------
  // One-shot SFX
  // -------------------------------------------------------------------------

  /** Short low woody thud — dribble/ball-floor contact. */
  bounce(vol = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    vol = Math.max(0, Math.min(1.4, vol));

    // Filtered noise burst — the "thwack" of contact.
    const src = this._noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.setValueAtTime(1400, t);
    bp.frequency.exponentialRampToValueAtTime(220, t + 0.09);
    bp.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.5 * vol, t + 0.004);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.10);
    src.connect(bp); bp.connect(ng); ng.connect(this.comp);
    src.start(t); src.stop(t + 0.12);
    this._disposeOnEnd(src, bp, ng);

    // Low sine pluck — the woody body. Pitch rises slightly with vol.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f0 = 150 + 60 * vol;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.13);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.6 * vol, t + 0.006);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(og); og.connect(this.comp);
    osc.start(t); osc.stop(t + 0.18);
    this._disposeOnEnd(osc, og);
  }

  /** Lighter, quicker version of bounce — quick tight dribbles. */
  dribbleTick(vol = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    vol = Math.max(0, Math.min(1.4, vol));

    const src = this._noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(400, t + 0.05);
    bp.Q.value = 1.1;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.32 * vol, t + 0.003);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    src.connect(bp); bp.connect(ng); ng.connect(this.comp);
    src.start(t); src.stop(t + 0.07);
    this._disposeOnEnd(src, bp, ng);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f0 = 230 + 70 * vol;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + 0.07);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.34 * vol, t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(og); og.connect(this.comp);
    osc.start(t); osc.stop(t + 0.10);
    this._disposeOnEnd(osc, og);
  }

  /** Net swish — noise through a bandpass sweeping downward. */
  swish() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const src = this._noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(6000, t);
    bp.frequency.exponentialRampToValueAtTime(1500, t + 0.24);
    bp.Q.value = 1.4;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 800;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.14);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);

    src.connect(bp); bp.connect(hp); hp.connect(g); g.connect(this.comp);
    src.start(t); src.stop(t + 0.32);
    this._disposeOnEnd(src, bp, hp, g);
  }

  /** Metallic rim clang — a couple detuned high partials, fast decay. */
  rim(strength = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    strength = Math.max(0.2, Math.min(1.5, strength));
    const dur = 0.16 + 0.12 * strength;

    const partials = [1, 1.51, 2.34, 3.07]; // inharmonic → metallic
    const base = 620 + 90 * strength;
    for (let i = 0; i < partials.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      const f = base * partials[i];
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 0.94, t + dur);
      const g = ctx.createGain();
      const amp = (0.22 * strength) / (i + 1);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(amp, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur * (1 - i * 0.14));
      osc.connect(g); g.connect(this.comp);
      osc.start(t); osc.stop(t + dur + 0.02);
      this._disposeOnEnd(osc, g);
    }

    // A tiny noise "tick" at the strike for bite.
    const src = this._noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    bp.Q.value = 2.0;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.18 * strength, t + 0.002);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(bp); bp.connect(ng); ng.connect(this.comp);
    src.start(t); src.stop(t + 0.06);
    this._disposeOnEnd(src, bp, ng);
  }

  /** Dull wooden/glass thunk — ball off the backboard. */
  backboard() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Low body.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.14);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.5, t + 0.005);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(og); og.connect(this.comp);
    osc.start(t); osc.stop(t + 0.20);
    this._disposeOnEnd(osc, og);

    // Glassy "knock" — short filtered noise.
    const src = this._noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(300, t + 0.09);
    bp.Q.value = 0.6;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.4, t + 0.003);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.10);
    src.connect(bp); bp.connect(ng); ng.connect(this.comp);
    src.start(t); src.stop(t + 0.12);
    this._disposeOnEnd(src, bp, ng);
  }

  /** Referee whistle — high oscillators with a fast trill/vibrato. */
  whistle() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 0.5;

    // Vibrato/trill LFO modulating both partials.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 22; // fast trill
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 110; // Hz of pitch wobble
    lfo.connect(lfoGain);
    lfo.start(t); lfo.stop(t + dur + 0.05);
    this._disposeOnEnd(lfo, lfoGain);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42, t + 0.02);
    g.gain.setValueAtTime(0.42, t + dur - 0.09);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.comp);

    // Two slightly detuned partials → that "pea whistle" beat.
    const freqs = [2600, 3300];
    for (let i = 0; i < freqs.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freqs[i];
      lfoGain.connect(osc.frequency);
      const og = ctx.createGain();
      og.gain.value = i === 0 ? 0.7 : 0.4;
      osc.connect(og); og.connect(g);
      osc.start(t); osc.stop(t + dur + 0.02);
      this._disposeOnEnd(osc, og);
    }

    // Airy noise underneath.
    const src = this._noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2800;
    bp.Q.value = 3.0;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.10, t + 0.02);
    ng.gain.setValueAtTime(0.10, t + dur - 0.09);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(ng); ng.connect(this.comp);
    src.start(t); src.stop(t + dur + 0.02);
    this._disposeOnEnd(src, bp, ng);
  }

  /** Harsh low square-wave horn (~1s) — end of quarter. */
  buzzer() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 1.0;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.015);
    g.gain.setValueAtTime(0.5, t + dur - 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // Tame the buzz a little so it isn't purely harsh.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    g.connect(lp); lp.connect(this.comp);

    // Two detuned square waves → dissonant klaxon.
    const freqs = [110, 111.6];
    for (let i = 0; i < freqs.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freqs[i];
      const og = ctx.createGain();
      og.gain.value = 0.5;
      osc.connect(og); og.connect(g);
      osc.start(t); osc.stop(t + dur + 0.02);
      this._disposeOnEnd(osc, og);
    }
  }

  /** Quick swoosh — a pass through the air. */
  pass() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const src = this._noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1200, t);
    bp.frequency.exponentialRampToValueAtTime(3200, t + 0.06);
    bp.frequency.exponentialRampToValueAtTime(1000, t + 0.16);
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(bp); bp.connect(g); g.connect(this.comp);
    src.start(t); src.stop(t + 0.20);
    this._disposeOnEnd(src, bp, g);
  }

  /** Crowd cheer — a filtered noise swell scaled by intensity (0..1+). */
  cheer(intensity = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    intensity = Math.max(0, Math.min(1.5, intensity));
    const dur = 1.1 + 0.8 * intensity;
    const peak = 0.22 + 0.4 * intensity;

    const src = this._noiseSource(true);
    // Random start offset so repeated cheers don't sound identical.
    src.playbackRate.value = 0.9 + Math.random() * 0.2;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.exponentialRampToValueAtTime(1400 + 900 * intensity, t + dur * 0.35);
    bp.frequency.exponentialRampToValueAtTime(900, t + dur);
    bp.Q.value = 0.7;

    // A little high shimmer for excitement.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 500;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.18 + 0.15 * (1 - intensity));
    g.gain.setValueAtTime(peak, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(bp); bp.connect(hp); hp.connect(g); g.connect(this.comp);
    src.start(t); src.stop(t + dur + 0.05);
    this._disposeOnEnd(src, bp, hp, g);
  }

  // -------------------------------------------------------------------------
  // Continuous crowd ambience
  // -------------------------------------------------------------------------

  /** Start the continuous low crowd-murmur bed. Idempotent. */
  startAmbience() {
    if (!this.ctx || this._amb) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Looping filtered noise = the murmur bed.
    const src = this._noiseSource(true);
    src.playbackRate.value = 0.85;

    // Low-mid band shaped to sound like a distant crowd.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.Q.value = 0.4;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 120;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.06, t + 1.2); // gentle fade-in base

    // Slow LFO gently wobbling the bed level (breathing crowd).
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    lfo.start(t);

    src.connect(hp); hp.connect(lp); lp.connect(gain); gain.connect(this.comp);
    src.start(t);

    this._amb = { src, lp, hp, gain, lfo, lfoGain, baseLevel: 0.06 };

    // Schedule occasional random swells (like scattered reactions).
    this._scheduleSwell();
    // Apply whatever excitement was requested before start.
    this.setExcitement(this._excitement);
  }

  _scheduleSwell() {
    if (!this.ctx || !this._amb) return;
    // More excitement → more frequent swells.
    const gap = 2500 + Math.random() * 5000 * (1 - this._excitement * 0.6);
    this._ambTimer = setTimeout(() => {
      if (this.ctx && this._amb) {
        // Layer a soft cheer-like swell into the bed.
        this._swell();
        this._scheduleSwell();
      }
    }, gap);
  }

  _swell() {
    if (!this.ctx || !this._amb) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const amt = 0.02 + 0.06 * this._excitement;
    const dur = 1.4 + Math.random() * 1.6;
    // Briefly lift the bed gain, then settle back.
    const g = this._amb.gain.gain;
    const target = this._amb.baseLevel + amt;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, this._amb.baseLevel), t);
    g.linearRampToValueAtTime(target, t + dur * 0.4);
    g.linearRampToValueAtTime(this._amb.baseLevel, t + dur);
  }

  /** Raise ambience level/brightness with crowd energy (0..1). */
  setExcitement(level) {
    this._excitement = Math.max(0, Math.min(1, level || 0));
    if (!this.ctx || !this._amb) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    // Base level rises with excitement.
    const base = 0.05 + 0.10 * this._excitement;
    this._amb.baseLevel = base;
    this._amb.gain.gain.setTargetAtTime(base, t, 0.6);
    // Brighter (more open lowpass) when excited.
    const cutoff = 800 + 1600 * this._excitement;
    this._amb.lp.frequency.setTargetAtTime(cutoff, t, 0.6);
  }

  /** Fade out and tear down the ambience bed. */
  stopAmbience() {
    if (!this.ctx || !this._amb) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const amb = this._amb;

    if (this._ambTimer) { clearTimeout(this._ambTimer); this._ambTimer = null; }

    amb.gain.gain.cancelScheduledValues(t);
    amb.gain.gain.setValueAtTime(Math.max(0.0001, amb.gain.gain.value), t);
    amb.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);

    const stopAt = t + 1.0;
    try { amb.src.stop(stopAt); } catch (e) { /* */ }
    try { amb.lfo.stop(stopAt); } catch (e) { /* */ }
    amb.src.onended = () => {
      try { amb.src.disconnect(); } catch (e) { /* */ }
      try { amb.hp.disconnect(); } catch (e) { /* */ }
      try { amb.lp.disconnect(); } catch (e) { /* */ }
      try { amb.gain.disconnect(); } catch (e) { /* */ }
      try { amb.lfo.disconnect(); } catch (e) { /* */ }
      try { amb.lfoGain.disconnect(); } catch (e) { /* */ }
    };

    this._amb = null;
  }
}
