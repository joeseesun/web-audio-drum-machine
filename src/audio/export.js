/* =============================================================================
 *  export.js — offline bounce to a 16-bit PCM WAV file
 *
 *  We do NOT record the live output. Instead we rebuild the identical graph
 *  inside an OfflineAudioContext and re-run the same scheduler math against it.
 *  Benefits:
 *    - Renders far faster than realtime (a 4-bar loop takes milliseconds).
 *    - Bit-identical to playback because the voices are the same pure functions.
 *    - Deterministic: no dropped buffers, no CPU-starved glitches in the file.
 * ========================================================================== */

import { TRACKS, STEPS, VELOCITY, isAudible, stepDuration, swingSeconds } from './engine';
import { VOICES } from './voices';
import { buildMasterBus } from './master';

const SAMPLE_RATE = 44100;
/** Room for the crash / open hat to decay naturally instead of being chopped. */
const TAIL_SECONDS = 2.5;
const PRE_ROLL = 0.02;

/** Interleave + quantise an AudioBuffer into a RIFF/WAVE blob. */
export function encodeWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = frames * blockAlign;

  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeAscii = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Render `bars` repetitions of the pattern and return a WAV blob.
 * Setting `mute`/`solo` before calling means the export honours your mix.
 */
export async function renderPatternToWav({ pattern, bpm, swing, volume, mute, solo, bars = 2 }) {
  const step = stepDuration(bpm);
  const swingOffset = swingSeconds(swing, bpm);
  const totalSteps = STEPS * Math.max(1, Math.min(64, bars));
  const duration = PRE_ROLL + totalSteps * step + TAIL_SECONDS;
  const frames = Math.ceil(duration * SAMPLE_RATE);

  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineCtx) throw new Error('OfflineAudioContext is not supported in this browser.');

  const ctx = new OfflineCtx(2, frames, SAMPLE_RATE);

  // Mirror of the live master bus — literally the same function.
  const { masterGain } = buildMasterBus(ctx, volume);

  const trackGains = {};
  for (const track of TRACKS) {
    const gain = ctx.createGain();
    gain.gain.value = isAudible(track.id, mute, solo) ? 1 : 0;

    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = track.pan;
      gain.connect(panner);
      panner.connect(masterGain);
    } else {
      gain.connect(masterGain);
    }
    trackGains[track.id] = gain;
  }

  // Same grid math as the live scheduler: even steps on-grid, odd steps late.
  for (let i = 0; i < totalSteps; i++) {
    const stepIndex = i % STEPS;
    const time = PRE_ROLL + i * step + (stepIndex % 2 === 1 ? swingOffset : 0);

    for (const track of TRACKS) {
      const value = pattern[track.id][stepIndex];
      if (!value) continue;
      const velocity = (value === 2 ? VELOCITY.accent : VELOCITY.normal) * track.gain;
      VOICES[track.id](ctx, trackGains[track.id], time, velocity);
    }
  }

  const rendered = await ctx.startRendering();
  return encodeWav(rendered);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
