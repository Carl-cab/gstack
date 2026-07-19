/* Nightfall Woods — procedural audio.
 * Everything is synthesized with the Web Audio API so the game ships with
 * zero binary sound files and still works offline. Exposes window.SFX.
 * Must be started from a user gesture (SFX.init() is called on "Play").
 */
'use strict';

const SFX = (() => {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let started = false;

  // ambient/loop nodes we keep references to so we can modulate/stop them
  let fireGain, fireFilter, fireSrc;
  let windGain, windSrc;
  let threatOsc, threatGain;   // low drone that swells when the creature chases
  let muted = false;

  function makeNoiseBuffer() {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function init() {
    if (started) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);
    noiseBuf = makeNoiseBuffer();
    started = true;
    startAmbient();
  }

  function now() { return ctx.currentTime; }

  // --- continuous ambient beds -------------------------------------------
  function startAmbient() {
    if (!ctx) return;
    // wind: low-passed noise, gently wavering
    windSrc = ctx.createBufferSource();
    windSrc.buffer = noiseBuf; windSrc.loop = true;
    const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 380;
    windGain = ctx.createGain(); windGain.gain.value = 0.05;
    windSrc.connect(wf); wf.connect(windGain); windGain.connect(master);
    windSrc.start();
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.03;
    lfo.connect(lfoG); lfoG.connect(windGain.gain); lfo.start();

    // fire: band-passed noise with crackle bursts; volume set by proximity
    fireSrc = ctx.createBufferSource();
    fireSrc.buffer = noiseBuf; fireSrc.loop = true;
    fireFilter = ctx.createBiquadFilter(); fireFilter.type = 'bandpass';
    fireFilter.frequency.value = 700; fireFilter.Q.value = 0.6;
    fireGain = ctx.createGain(); fireGain.gain.value = 0.0;
    fireSrc.connect(fireFilter); fireFilter.connect(fireGain); fireGain.connect(master);
    fireSrc.start();

    // threat drone (silent until the creature chases)
    threatOsc = ctx.createOscillator(); threatOsc.type = 'sawtooth';
    threatOsc.frequency.value = 55;
    threatGain = ctx.createGain(); threatGain.gain.value = 0.0;
    const tf = ctx.createBiquadFilter(); tf.type = 'lowpass'; tf.frequency.value = 180;
    threatOsc.connect(tf); tf.connect(threatGain); threatGain.connect(master);
    threatOsc.start();
  }

  // set fire loudness 0..1 (game passes proximity * fuel)
  function setFire(level) {
    if (!fireGain) return;
    fireGain.gain.setTargetAtTime(0.28 * Math.max(0, Math.min(1, level)), now(), 0.3);
    // random crackle pops when close
    if (level > 0.35 && Math.random() < 0.08) crackle();
  }
  function crackle() {
    if (!ctx) return;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1500;
    const g = ctx.createGain();
    const t = now();
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + 0.07);
  }

  // threat 0..1: creature proximity while chasing
  function setThreat(level) {
    if (!threatGain) return;
    threatGain.gain.setTargetAtTime(0.16 * Math.max(0, Math.min(1, level)), now(), 0.2);
    if (threatOsc) threatOsc.frequency.setTargetAtTime(50 + level * 30, now(), 0.3);
  }

  // --- one-shot helpers ---------------------------------------------------
  function tone({ type = 'sine', freq = 440, to = null, dur = 0.15, vol = 0.2, delay = 0 }) {
    if (!ctx) return;
    const o = ctx.createOscillator(); o.type = type;
    const g = ctx.createGain();
    const t = now() + delay;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noiseHit({ dur = 0.12, vol = 0.25, hp = 200, lp = 6000 }) {
    if (!ctx) return;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f1 = ctx.createBiquadFilter(); f1.type = 'highpass'; f1.frequency.value = hp;
    const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = lp;
    const g = ctx.createGain();
    const t = now();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f1); f1.connect(f2); f2.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.02);
  }

  // named effects
  const step = () => noiseHit({ dur: 0.08, vol: 0.10, hp: 120, lp: 900 });
  const chop = () => { noiseHit({ dur: 0.14, vol: 0.3, hp: 150, lp: 2500 }); tone({ type: 'square', freq: 140, to: 70, dur: 0.12, vol: 0.12 }); };
  const drink = () => tone({ type: 'sine', freq: 300, to: 600, dur: 0.25, vol: 0.15 });
  const heal = () => { tone({ type: 'sine', freq: 520, dur: 0.14, vol: 0.16 }); tone({ type: 'sine', freq: 780, dur: 0.18, vol: 0.16, delay: 0.12 }); };
  const click = () => tone({ type: 'square', freq: 660, dur: 0.05, vol: 0.08 });
  const craft = () => { tone({ type: 'triangle', freq: 400, dur: 0.08, vol: 0.14 }); tone({ type: 'triangle', freq: 600, dur: 0.1, vol: 0.14, delay: 0.07 }); };
  const hurt = () => noiseHit({ dur: 0.2, vol: 0.3, hp: 80, lp: 1200 });
  const stinger = () => { tone({ type: 'sawtooth', freq: 300, to: 80, dur: 0.5, vol: 0.28 }); noiseHit({ dur: 0.4, vol: 0.2, hp: 60, lp: 800 }); };
  const roar = () => tone({ type: 'sawtooth', freq: 120, to: 55, dur: 0.6, vol: 0.3 });
  function win() { [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.3, vol: 0.2, delay: i * 0.14 })); }
  function lose() { [330, 262, 196, 130].forEach((f, i) => tone({ type: 'sawtooth', freq: f, dur: 0.4, vol: 0.2, delay: i * 0.18 })); }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, now(), 0.05);
  }
  function isMuted() { return muted; }
  function suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); }
  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

  return { init, setFire, setThreat, step, chop, drink, heal, click, craft, hurt,
           stinger, roar, win, lose, setMuted, isMuted, suspend, resume,
           get ready() { return started; } };
})();

window.SFX = SFX;
