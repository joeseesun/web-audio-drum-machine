/* Smoke test: render the pattern offline and assert the audio is real.
   Run: npm run verify                                                       */

import { OfflineAudioContext } from 'node-web-audio-api';
import { writeFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.OfflineAudioContext = OfflineAudioContext;
globalThis.Blob = globalThis.Blob ?? class {};

/* The voices start white noise at a random buffer offset so repeated hits do
 * not sound like an identical sample. That randomness makes two renders of the
 * same pattern differ, which would make peak comparisons meaningless here — so
 * we pin Math.random to a seeded PRNG and get bit-reproducible bounces. */
let seed = 0x2f6e2b1;
Math.random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const { renderPatternToWav } = await import('../src/audio/export.js');
const { parsePreset, PRESETS } = await import('../src/audio/presets.js');
const { TRACKS, emptyPattern } = await import('../src/audio/engine.js');

const SR = 44100;
const noMute = {};
const noSolo = {};

/* ---------------- helpers ---------------- */

/** Decode our own 16-bit stereo WAV into a mono (max-of-channels) float array. */
function decodeMono(bytes) {
  const frames = (bytes.length - 44) / 4;
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const o = 44 + i * 4;
    const l = (((bytes[o + 1] << 8) | bytes[o]) << 16 >> 16) / 32768;
    const r = (((bytes[o + 3] << 8) | bytes[o + 2]) << 16 >> 16) / 32768;
    out[i] = Math.max(Math.abs(l), Math.abs(r));
  }
  return out;
}

/**
 * Rising-edge onset detection with hysteresis + a refractory period.
 * The refractory window is what makes this usable on sustained voices: a kick's
 * 48 Hz sine re-crosses any threshold several times per hit, so a naive
 * detector reports ~10 "onsets" for a single stroke.
 */
function detectOnsets(samples, { threshold = 0.05, refractory = 0.05 } = {}) {
  const refractoryFrames = Math.floor(refractory * SR);
  const releaseLevel = threshold * 0.4;
  const onsets = [];
  let armed = true;
  let last = -Infinity;

  for (let i = 0; i < samples.length; i++) {
    const a = samples[i];
    if (a > threshold && armed && i - last > refractoryFrames) {
      onsets.push(i / SR);
      last = i;
      armed = false;
    } else if (a < releaseLevel) {
      armed = true;
    }
  }
  return onsets;
}

const peakOf = (samples) => samples.reduce((m, v) => Math.max(m, v), 0);
const rmsOf = (samples) => Math.sqrt(samples.reduce((s, v) => s + v * v, 0) / samples.length);
const dbfs = (v) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : '-inf');

const renderWav = (opts) =>
  renderPatternToWav({ bpm: 120, swing: 0, volume: 0.8, mute: noMute, solo: noSolo, bars: 1, ...opts });

const render = async (opts) => decodeMono(new Uint8Array(await (await renderWav(opts)).arrayBuffer()));

let failures = 0;
const check = (label, cond, info) => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${label.padEnd(34)}${info ?? ''}`);
  if (!cond) failures++;
};

/* ---------------- 1. voices ---------------- */

console.log('\n[1] Every voice synthesises audible output');
for (const track of TRACKS) {
  const pattern = emptyPattern();
  pattern[track.id][0] = 2; // accent on step 1 only
  const samples = await render({ pattern });
  const peak = peakOf(samples);
  check(track.name, peak > 0.02 && rmsOf(samples) > 0.0005,
    `peak ${dbfs(peak)} dBFS   rms ${dbfs(rmsOf(samples))} dBFS`);
}

/* ---------------- 2. WAV container ---------------- */

console.log('\n[2] Presets render, WAV container is valid');
for (const preset of PRESETS) {
  const blob = await renderWav({ pattern: parsePreset(preset) });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o, n) => String.fromCharCode(...bytes.slice(o, o + n));
  const ok =
    tag(0, 4) === 'RIFF' && tag(8, 4) === 'WAVE' &&
    dv.getUint16(22, true) === 2 && dv.getUint32(24, true) === SR &&
    dv.getUint16(34, true) === 16 && dv.getUint32(40, true) === bytes.length - 44;
  check(preset.name, ok, `${(bytes.length / 1024).toFixed(0)} KB   2ch / ${SR} Hz / 16-bit`);
}

/* ---------------- 3. scheduler grid ---------------- */

console.log('\n[3] Scheduler grid — onsets land exactly where the math says');
{
  // Rimshot on every step: a ~35 ms transient, far shorter than the 125 ms step,
  // so detected onsets map 1:1 onto scheduled times.
  const pattern = emptyPattern();
  pattern.rim = new Array(16).fill(1);

  const onsets = detectOnsets(await render({ pattern }), { threshold: 0.03 });
  const gaps = onsets.slice(1).map((t, i) => t - onsets[i]);
  const expected = 0.125; // 60 / 120bpm / 4
  const maxErr = gaps.reduce((m, v) => Math.max(m, Math.abs(v - expected)), 0);

  check('16 onsets detected', onsets.length === 16, `got ${onsets.length}`);
  check('spacing = 125.000 ms @ 120 BPM', onsets.length === 16 && maxErr < 0.0005,
    `max error ${(maxErr * 1e6).toFixed(1)} us`);

  const fast = detectOnsets(await render({ pattern, bpm: 200 }), { threshold: 0.03 });
  const slow = detectOnsets(await render({ pattern, bpm: 60 }), { threshold: 0.03 });
  check('200 BPM => 75 ms steps', Math.abs(fast[1] - fast[0] - 0.075) < 0.0005,
    `${((fast[1] - fast[0]) * 1000).toFixed(3)} ms`);
  check('60 BPM => 250 ms steps', Math.abs(slow[1] - slow[0] - 0.25) < 0.0005,
    `${((slow[1] - slow[0]) * 1000).toFixed(3)} ms`);

  const twoBars = detectOnsets(await render({ pattern, bars: 2 }), { threshold: 0.03 });
  check('2 bars => 32 onsets', twoBars.length === 32, `got ${twoBars.length}`);
}

/* ---------------- 4. swing ---------------- */

console.log('\n[4] Swing — delays offbeats, preserves bar length');
{
  const pattern = emptyPattern();
  pattern.rim = new Array(16).fill(1);
  const grid = async (swing) =>
    (await detectOnsets(await render({ pattern, swing }), { threshold: 0.03 })).map((t) => t - 0.02);

  const straight = await grid(0);
  const swung = await grid(100);
  const step = 0.125;
  const expectShift = 0.45 * step; // SWING_DEPTH * step

  const shifted = straight.map((t, i) => swung[i] - t);
  const evenDrift = Math.max(...shifted.filter((_, i) => i % 2 === 0).map(Math.abs));
  const oddShift = shifted.filter((_, i) => i % 2 === 1);

  check('16 onsets in both renders', straight.length === 16 && swung.length === 16,
    `${straight.length} / ${swung.length}`);
  check('even steps stay on the grid', evenDrift < 0.0005, `drift ${(evenDrift * 1e6).toFixed(1)} us`);
  check(`odd steps delayed by ${(expectShift * 1000).toFixed(1)} ms`,
    oddShift.length === 8 && oddShift.every((d) => Math.abs(d - expectShift) < 0.0005),
    `measured +${(oddShift[0] * 1000).toFixed(3)} ms`);

  /* Bar length must be measured bar-start to bar-start: the 16th step is an
     offbeat, so it is *supposed* to be late. The thing that must not move is
     where the next bar begins. */
  const straightBars = detectOnsets(await render({ pattern, swing: 0, bars: 2 }), { threshold: 0.03 });
  const swungBars = detectOnsets(await render({ pattern, swing: 100, bars: 2 }), { threshold: 0.03 });
  const lenStraight = straightBars[16] - straightBars[0];
  const lenSwung = swungBars[16] - swungBars[0];
  check('bar length unchanged', Math.abs(lenSwung - lenStraight) < 0.0005,
    `${lenStraight.toFixed(5)}s -> ${lenSwung.toFixed(5)}s`);

  const mid = await grid(50);
  const midShift = mid[1] - straight[1];
  check('swing 50% is half of swing 100%', Math.abs(midShift - expectShift / 2) < 0.0005,
    `+${(midShift * 1000).toFixed(3)} ms`);
}

/* ---------------- 5. mute / solo ---------------- */

console.log('\n[5] Mute / solo gating');
{
  const pattern = parsePreset(PRESETS[0]);
  const full = peakOf(await render({ pattern }));
  const allMuted = peakOf(await render({
    pattern, mute: Object.fromEntries(TRACKS.map((t) => [t.id, true])),
  }));
  const soloKick = peakOf(await render({ pattern, solo: { kick: true } }));

  check('full mix has signal', full > 0.3, `peak ${full.toFixed(4)}`);
  check('full mix never clips', full < 0.999, `peak ${full.toFixed(4)} < 1.0 (limiter ceiling)`);
  check('all muted = digital silence', allMuted < 1e-5, `peak ${allMuted.toExponential(2)}`);
  check('solo kick gates other tracks', soloKick > 0.05 && soloKick < full,
    `${soloKick.toFixed(3)} vs full ${full.toFixed(3)}`);
}

/* ---------------- 6. master bus ---------------- */

console.log('\n[6] Master bus — limiter holds the ceiling without colouring the mix');
{
  const { softKneeCurve, clampCurve } = await import('../src/audio/master.js');
  const KNEE = 0.7;
  const CEILING = 0.99;

  // The design property: unity gain below the knee, so quiet material is
  // bit-for-bit untouched. (Checked on the curve directly — through the whole
  // bus the *compressor's* 24 dB soft knee also acts, which is expected.)
  const curve = softKneeCurve(KNEE);
  const N = curve.length - 1;
  let worstUnity = 0;
  for (let i = 0; i <= N; i++) {
    const x = (i / N) * 2 - 1;
    if (Math.abs(x) <= KNEE) worstUnity = Math.max(worstUnity, Math.abs(curve[i] - x));
  }
  check('unity below the knee', worstUnity < 1e-6, `max deviation ${worstUnity.toExponential(1)}`);

  // Ceiling is a hard guarantee at every input level, including > 1.0.
  const clamp = clampCurve(0.9, CEILING);
  let worstOver = 0;
  let maxOut = 0;
  for (let i = 0; i <= N; i++) {
    maxOut = Math.max(maxOut, Math.abs(clamp[i]));
    worstOver = Math.max(worstOver, Math.abs(clamp[i]) - CEILING);
  }
  check('ceiling never exceeded', worstOver <= 0, `max output ${maxOut.toFixed(4)} <= ${CEILING}`);

  // Slope continuity at the knee — a discontinuity here is what makes cheap
  // limiters "click" as a signal crosses the threshold.
  const idxAt = (x) => Math.round(((x + 1) / 2) * N);
  const d = (i) => (curve[i + 1] - curve[i - 1]) / (4 / N);
  const slopeErr = Math.abs(d(idxAt(KNEE)) - 1);
  check('slope continuous at the knee', slopeErr < 0.01, `slope ${d(idxAt(KNEE)).toFixed(4)} (want 1.0000)`);

  // End to end: worst case is every voice accented on every single step.
  const dense = Object.fromEntries(TRACKS.map((t) => [t.id, new Array(16).fill(2)]));
  const loud = peakOf(await render({ pattern: dense, volume: 1.0 }));
  check('max-density mix stays under 1.0', loud < 0.999, `peak ${loud.toFixed(4)}`);

  // And the bus stays monotonic: more volume in, more level out.
  const pattern = parsePreset(PRESETS[0]);
  const levels = [];
  for (const v of [0.1, 0.3, 0.6, 1.0]) levels.push(peakOf(await render({ pattern, volume: v })));
  const monotonic = levels.every((v, i) => i === 0 || v > levels[i - 1]);
  check('bus output is monotonic in volume', monotonic,
    levels.map((v) => v.toFixed(3)).join(' < '));
}

/* ---------------- 7. reference file ---------------- */

console.log('\n[7] Write a reference bounce');
{
  const blob = await renderWav({
    pattern: parsePreset(PRESETS[0]), bpm: 120, swing: 18, bars: 2,
  });
  const buf = Buffer.from(await blob.arrayBuffer());
  writeFileSync('/tmp/dr808-reference.wav', buf);
  check('/tmp/dr808-reference.wav', buf.length > 100000,
    `${(buf.length / 1048576).toFixed(2)} MB   2 bars @ 120 BPM = 8.0 s`);
}

console.log(`\n${failures === 0 ? '*** ALL CHECKS PASSED ***' : `*** ${failures} CHECK(S) FAILED ***`}\n`);
process.exit(failures === 0 ? 0 : 1);
