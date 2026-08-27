/* =============================================================================
 *  master.js — the shared master bus
 *
 *  The live player and the offline WAV renderer MUST run through an identical
 *  chain, otherwise "export" does not sound like "playback". Both call this one
 *  function, so there is exactly one definition of the master bus.
 *
 *  Signal flow:  tracks -> gain -> glue compressor -> soft limiter -> out
 *
 *  Why the limiter matters: accents push a single voice past unity gain, and
 *  eight voices landing on the same step stack further — worst case is roughly
 *  7x full scale. Without a ceiling the export clips, which is the nasty crackle
 *  of hard digital distortion rather than musical saturation.
 * ========================================================================== */

/**
 * Soft-knee transfer curve: unity below `threshold`, then a tanh knee that
 * approaches (but never reaches) `threshold + headroom`. Both the value and the
 * slope are continuous at the knee, so quiet material passes through completely
 * untouched — the curve only does work when asked to.
 */
export function softKneeCurve(threshold = 0.7, samples = 4096) {
  const curve = new Float32Array(samples);
  const headroom = 1 - threshold;
  const last = samples - 1;

  for (let i = 0; i < samples; i++) {
    const x = (i / last) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= threshold ? a : threshold + headroom * Math.tanh((a - threshold) / headroom);
    curve[i] = x < 0 ? -y : y;
  }
  return curve;
}

/** Same shape, but with an explicit output ceiling below full scale. */
export function clampCurve(knee, ceiling, samples = 4096) {
  const curve = new Float32Array(samples);
  const range = 1 - knee;
  const span = ceiling - knee;
  const last = samples - 1;

  for (let i = 0; i < samples; i++) {
    const x = (i / last) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + span * Math.tanh((a - knee) / range);
    curve[i] = x < 0 ? -y : y;
  }
  return curve;
}

/** Gentle bus compression: glues the kit together and tames accent spikes. */
export function createGlueCompressor(ctx) {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.knee.value = 24;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.16;
  return comp;
}

/**
 * True-peak safety net, in two stages — and the second stage is not optional.
 *
 * Stage 1 is a musical soft knee, oversampled so the harmonics it generates do
 * not alias back into the audible band.
 *
 * BUT: oversampling means up/down-sampling filters, and those filters ring past
 * the curve's ceiling — measured +12% at 2x, +14% at 4x. A limiter whose
 * ceiling depends on the implementation is not a limiter, so stage 1 alone
 * cannot be trusted to hold the line.
 *
 * Stage 2 therefore runs with oversampling OFF. No resampling filter, no ring:
 * the cap is exact in every browser, regardless of how stage 1 behaves.
 */
export function createLimiter(ctx, { threshold = 0.7, guardKnee = 0.9, ceiling = 0.99 } = {}) {
  const soft = ctx.createWaveShaper();
  soft.curve = softKneeCurve(threshold);
  soft.oversample = '2x';

  const guard = ctx.createWaveShaper();
  guard.curve = clampCurve(guardKnee, ceiling);
  guard.oversample = 'none';

  soft.connect(guard);
  return { input: soft, output: guard };
}

/**
 * Build the master bus and wire it to the context destination.
 * @returns {{ masterGain: GainNode, output: AudioNode }}
 *   Feed per-track nodes into `masterGain`; `output` is the post-limiter tap
 *   (connect an analyser to it for metering, then on to destination).
 */
export function buildMasterBus(ctx, volume) {
  const masterGain = ctx.createGain();
  masterGain.gain.value = volume;

  const comp = createGlueCompressor(ctx);
  const limiter = createLimiter(ctx);

  masterGain.connect(comp);
  comp.connect(limiter.input);
  limiter.output.connect(ctx.destination);

  return { masterGain, output: limiter.output };
}
