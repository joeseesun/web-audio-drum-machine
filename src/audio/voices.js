/* =============================================================================
 *  voices.js — 100% algorithmic drum synthesis. No samples, no files.
 *
 *  Every voice shares one contract:
 *
 *      voice(ctx, destination, startTime, velocity)
 *
 *  Because nothing here touches `ctx.currentTime` or any global state, the exact
 *  same functions render correctly in BOTH:
 *    - the live `AudioContext`   (realtime playback)
 *    - an `OfflineAudioContext`  (faster-than-realtime WAV bounce)
 *
 *  That symmetry is what makes "what you hear is what you export" true.
 * ========================================================================== */

/** Minimum value for exponential ramps (they cannot reach or cross zero). */
const MIN = 0.0001;

/* ---------------------------------------------------------------------------
 *  Shared building blocks
 * ------------------------------------------------------------------------- */

/** One noise buffer per context, cached so we never regenerate 2s of white noise per hit. */
const noiseCache = new WeakMap();

export function getNoiseBuffer(ctx) {
  let buffer = noiseCache.get(ctx);
  if (buffer) return buffer;

  const length = Math.floor(ctx.sampleRate * 2);
  buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

  noiseCache.set(ctx, buffer);
  return buffer;
}

/**
 * A looping white-noise source.
 * Starts at a random offset in the buffer so repeated hits never sound
 * like the exact same "sample" — which is the #1 giveaway of cheap noise hats.
 */
function noiseSource(ctx, time, duration) {
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  src.loop = true;
  src.start(time, Math.random() * 1.5);
  src.stop(time + duration);
  return src;
}

/** Classic percussive AD envelope: near-instant attack + exponential decay. */
function decayEnv(gainNode, time, peak, attack, decay) {
  const g = gainNode.gain;
  const p = Math.max(peak, MIN);
  g.setValueAtTime(MIN, time);
  g.exponentialRampToValueAtTime(p, time + attack);
  g.exponentialRampToValueAtTime(MIN, time + attack + decay);
}

function biquad(ctx, type, frequency, Q = 1, gain = 0) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = Q;
  if (gain) f.gain.value = gain;
  return f;
}

/**
 * The TR-808 cymbal trick: six detuned square waves at inharmonic ratios,
 * slammed through a highpass + bandpass so only their upper harmonics survive.
 * That's how you get metal out of oscillators that are under 400 Hz.
 */
const METAL_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];

function metalCluster(ctx, dest, time, opts) {
  const { base = 40, decay = 0.2, hp = 7000, bp = 10000, q = 0.6, peak = 1 } = opts;

  const highpass = biquad(ctx, 'highpass', hp, 0.5);
  const bandpass = biquad(ctx, 'bandpass', bp, q);
  const out = ctx.createGain();
  decayEnv(out, time, peak, 0.002, decay);

  highpass.connect(bandpass).connect(out).connect(dest);

  for (const ratio of METAL_RATIOS) {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = base * ratio;
    osc.connect(highpass);
    osc.start(time);
    osc.stop(time + decay + 0.05);
  }
  return out;
}

/* ---------------------------------------------------------------------------
 *  The eight voices
 * ------------------------------------------------------------------------- */

/** Deep sine kick with a pitch drop and a beater click for definition on small speakers. */
export function kick(ctx, dest, time, velocity = 1) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(185, time);
  osc.frequency.exponentialRampToValueAtTime(48, time + 0.09);
  osc.frequency.exponentialRampToValueAtTime(36, time + 0.45);

  const bodyGain = ctx.createGain();
  decayEnv(bodyGain, time, 1.0 * velocity, 0.004, 0.42);
  osc.connect(bodyGain).connect(dest);
  osc.start(time);
  osc.stop(time + 0.5);

  const click = noiseSource(ctx, time, 0.03);
  const clickGain = ctx.createGain();
  decayEnv(clickGain, time, 0.3 * velocity, 0.001, 0.018);
  click.connect(biquad(ctx, 'bandpass', 1900, 0.8)).connect(clickGain).connect(dest);
}

/** Noise crack + two tuned triangles for the "shell" — the classic layered snare. */
export function snare(ctx, dest, time, velocity = 1) {
  const noise = noiseSource(ctx, time, 0.3);
  const noiseGain = ctx.createGain();
  decayEnv(noiseGain, time, 0.7 * velocity, 0.002, 0.17);
  noise
    .connect(biquad(ctx, 'highpass', 1200, 0.7))
    .connect(biquad(ctx, 'bandpass', 3200, 0.4))
    .connect(noiseGain)
    .connect(dest);

  [180, 278].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.82, time + 0.11);

    const g = ctx.createGain();
    decayEnv(g, time, (i === 0 ? 0.4 : 0.22) * velocity, 0.002, 0.1);
    osc.connect(g).connect(dest);
    osc.start(time);
    osc.stop(time + 0.2);
  });
}

export function hatClosed(ctx, dest, time, velocity = 1) {
  metalCluster(ctx, dest, time, {
    decay: 0.055,
    hp: 8200,
    bp: 11000,
    q: 0.7,
    peak: 0.55 * velocity,
  });

  const noise = noiseSource(ctx, time, 0.05);
  const g = ctx.createGain();
  decayEnv(g, time, 0.22 * velocity, 0.001, 0.028);
  noise.connect(biquad(ctx, 'highpass', 9000, 0.7)).connect(g).connect(dest);
}

export function hatOpen(ctx, dest, time, velocity = 1) {
  metalCluster(ctx, dest, time, {
    decay: 0.42,
    hp: 7000,
    bp: 9000,
    q: 0.5,
    peak: 0.5 * velocity,
  });

  const noise = noiseSource(ctx, time, 0.5);
  const g = ctx.createGain();
  decayEnv(g, time, 0.2 * velocity, 0.001, 0.4);
  noise.connect(biquad(ctx, 'highpass', 7500, 0.6)).connect(g).connect(dest);
}

/** Three tightly-spaced bursts (the "hand slaps") plus a longer reverb-ish tail. */
export function clap(ctx, dest, time, velocity = 1) {
  const bandpass = biquad(ctx, 'bandpass', 1050, 1.1);
  const highpass = biquad(ctx, 'highpass', 600, 0.7);
  bandpass.connect(highpass).connect(dest);

  [0, 0.011, 0.022].forEach((offset, i) => {
    const t = time + offset;
    const noise = noiseSource(ctx, t, 0.03);
    const g = ctx.createGain();
    decayEnv(g, t, (0.85 - i * 0.14) * velocity, 0.001, 0.016);
    noise.connect(g).connect(bandpass);
  });

  const tailTime = time + 0.03;
  const tail = noiseSource(ctx, tailTime, 0.3);
  const tailGain = ctx.createGain();
  decayEnv(tailGain, tailTime, 0.42 * velocity, 0.002, 0.16);
  tail.connect(tailGain).connect(bandpass);
}

export function tom(ctx, dest, time, velocity = 1) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(330, time);
  osc.frequency.exponentialRampToValueAtTime(115, time + 0.18);
  osc.frequency.exponentialRampToValueAtTime(85, time + 0.4);

  const g = ctx.createGain();
  decayEnv(g, time, 0.9 * velocity, 0.003, 0.36);
  osc.connect(g).connect(dest);
  osc.start(time);
  osc.stop(time + 0.45);

  const noise = noiseSource(ctx, time, 0.03);
  const noiseGain = ctx.createGain();
  decayEnv(noiseGain, time, 0.18 * velocity, 0.001, 0.02);
  noise.connect(biquad(ctx, 'bandpass', 1200, 0.7)).connect(noiseGain).connect(dest);
}

/** Short, bright, high-Q — the "stick hitting the rim" sound. */
export function rimshot(ctx, dest, time, velocity = 1) {
  const noise = noiseSource(ctx, time, 0.06);
  const noiseGain = ctx.createGain();
  decayEnv(noiseGain, time, 0.85 * velocity, 0.001, 0.032);
  noise
    .connect(biquad(ctx, 'bandpass', 2400, 5))
    .connect(biquad(ctx, 'highpass', 1200, 0.7))
    .connect(noiseGain)
    .connect(dest);

  [
    [1670, 0.4],
    [450, 0.3],
  ].forEach(([freq, amp]) => {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.6, time + 0.03);
    const g = ctx.createGain();
    decayEnv(g, time, amp * velocity, 0.001, 0.028);
    osc.connect(g).connect(dest);
    osc.start(time);
    osc.stop(time + 0.08);
  });
}

/** Two-stage decay (fast initial crash, slow shimmer) — a single ramp sounds fake. */
export function crash(ctx, dest, time, velocity = 1) {
  const noise = noiseSource(ctx, time, 1.9);
  const g = ctx.createGain();
  g.gain.setValueAtTime(MIN, time);
  g.gain.exponentialRampToValueAtTime(0.75 * velocity, time + 0.004);
  g.gain.exponentialRampToValueAtTime(0.28 * velocity, time + 0.25);
  g.gain.exponentialRampToValueAtTime(MIN, time + 1.75);

  noise
    .connect(biquad(ctx, 'highpass', 4500, 0.4))
    .connect(biquad(ctx, 'peaking', 9000, 0.8, 4))
    .connect(g)
    .connect(dest);

  metalCluster(ctx, dest, time, {
    decay: 1.2,
    hp: 6000,
    bp: 8200,
    q: 0.4,
    peak: 0.22 * velocity,
  });
}

/*
 * Keys MUST match the track ids in engine.js — both the live scheduler and the
 * offline renderer look voices up by `VOICES[track.id]`.
 */
export const VOICES = {
  kick,
  snare,
  hhc: hatClosed,
  hho: hatOpen,
  clap,
  tom,
  rim: rimshot,
  crash,
};
