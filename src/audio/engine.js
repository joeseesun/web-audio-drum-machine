/* =============================================================================
 *  engine.js — audio graph + lookahead scheduler
 *
 *  THE TIMING PROBLEM
 *  ------------------
 *  A naive drum machine calls `setInterval(playNote, stepDuration)`. JavaScript
 *  timers are not realtime: they are throttled, coalesced, delayed by GC, by
 *  layout, by background-tab policy. Every callback lands a few ms late, and the
 *  error accumulates — audible drift within seconds.
 *
 *  THE FIX (Chris Wilson's "A Tale of Two Clocks")
 *  -----------------------------------------------
 *  1. A dumb, imprecise timer (here a Web Worker, so it survives tab throttling)
 *     periodically "wakes up" the scheduler. Its accuracy is irrelevant.
 *  2. The scheduler looks ahead ~120 ms and converts each future note into an
 *     absolute `audioContext.currentTime` offset, handing it to the audio
 *     hardware clock. Once scheduled, notes fire with sample accuracy — the JS
 *     main thread could freeze for 100 ms and the groove would not move.
 *
 *  Swing is applied to the *intervals*, not by shifting notes off-grid, so the
 *  bar length stays constant no matter how hard you swing it.
 * ========================================================================== */

import { VOICES } from './voices';
import { buildMasterBus } from './master';

export const STEPS = 16;

/** How far ahead of `currentTime` we schedule notes (seconds). */
const SCHEDULE_AHEAD = 0.12;
/** How often the clock worker pokes the scheduler (ms). */
const TICK_INTERVAL = 20;
/** A tiny pre-roll so the very first hit isn't scheduled in the past. */
const PRE_ROLL = 0.06;
/** Max swing shift, as a fraction of one step. 0.45 ≈ a hard shuffle. */
const SWING_DEPTH = 0.45;

export const TRACKS = [
  { id: 'kick',  name: 'Kick',           abbr: 'KICK',  gain: 1.00, pan:  0.00, color: '#ff6b6b' },
  { id: 'snare', name: 'Snare',          abbr: 'SNR',   gain: 0.80, pan:  0.06, color: '#ffa94d' },
  { id: 'hhc',   name: 'Hi-Hat Closed',  abbr: 'HH·C',  gain: 0.42, pan: -0.28, color: '#ffe066' },
  { id: 'hho',   name: 'Hi-Hat Open',    abbr: 'HH·O',  gain: 0.40, pan: -0.20, color: '#a9e34b' },
  { id: 'clap',  name: 'Clap',           abbr: 'CLAP',  gain: 0.62, pan:  0.28, color: '#38d9a9' },
  { id: 'tom',   name: 'Tom',            abbr: 'TOM',   gain: 0.74, pan: -0.12, color: '#4dabf7' },
  { id: 'rim',   name: 'Rimshot',        abbr: 'RIM',   gain: 0.55, pan:  0.38, color: '#b197fc' },
  { id: 'crash', name: 'Crash',          abbr: 'CRSH',  gain: 0.45, pan: -0.38, color: '#f783ac' },
];

export const TRACK_IDS = TRACKS.map((t) => t.id);

export function emptyPattern() {
  return Object.fromEntries(TRACK_IDS.map((id) => [id, new Array(STEPS).fill(0)]));
}

/**
 * `0` = silent, `1` = normal hit, `2` = accent.
 * Accents drive velocity, not volume, so they interact with the compressor
 * the way a real drummer hitting harder would.
 */
export const VELOCITY = { normal: 1.0, accent: 1.38 };

/** Mute/solo resolution: solo is a bus-wide override, mute is per-track. */
export function isAudible(id, mute, solo) {
  const anySolo = Object.values(solo).some(Boolean);
  return anySolo ? !!solo[id] : !mute[id];
}

export function stepDuration(bpm) {
  return 60 / bpm / 4; // 16th notes
}

export function swingSeconds(swingPercent, bpm) {
  return (swingPercent / 100) * SWING_DEPTH * stepDuration(bpm);
}

/* ---------------------------------------------------------------------------
 *  Clock worker
 *
 *  Built from a Blob so there is no separate asset to ship or configure.
 *  A Worker matters here: `setInterval` on the main thread is throttled to
 *  ~1 Hz when the tab is hidden, which would stall scheduling and leave
 *  audible gaps. Worker timers are not throttled the same way.
 * ------------------------------------------------------------------------- */
const WORKER_SOURCE = `
let timer = null;
let interval = ${TICK_INTERVAL};
self.onmessage = (e) => {
  const msg = e.data;
  if (msg === 'start') {
    if (timer !== null) clearInterval(timer);
    timer = setInterval(() => self.postMessage('tick'), interval);
  } else if (msg === 'stop') {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }
};
`;

function createClockWorker() {
  try {
    const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    return worker;
  } catch {
    // Extremely old browsers: fall back to a main-thread interval. Timing of
    // *notes* is still sample-accurate; only the wake-up cadence degrades.
    let timer = null;
    return {
      postMessage: (msg) => {
        if (msg === 'start') {
          if (timer) clearInterval(timer);
          timer = setInterval(() => this.onmessage?.({ data: 'tick' }), TICK_INTERVAL);
        } else if (msg === 'stop') {
          clearInterval(timer);
          timer = null;
        }
      },
      onmessage: null,
      terminate: () => clearInterval(timer),
    };
  }
}

/* ---------------------------------------------------------------------------
 *  Engine
 * ------------------------------------------------------------------------- */
export class DrumEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.analyser = null;
    this.trackGains = {};

    this.pattern = emptyPattern();
    this.mute = Object.fromEntries(TRACK_IDS.map((id) => [id, false]));
    this.solo = Object.fromEntries(TRACK_IDS.map((id) => [id, false]));

    this.bpm = 120;
    this.swing = 0;
    this.volume = 0.8;

    this.isPlaying = false;
    this.currentStep = 0;
    this.nextNoteTime = 0;

    // Notes already handed to the audio clock, waiting to become visible.
    this.scheduledQueue = [];
    this.displayStep = -1;

    this.worker = null;
    this.rafId = null;
    this.onStepChange = null;
  }

  /* ---------------- graph ---------------- */

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('Web Audio API is not supported in this browser.');

    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;

    // Master bus: gain -> glue compressor -> limiter -> analyser -> speakers.
    // Shared with the offline renderer so exports null against playback.
    const bus = buildMasterBus(ctx, this.volume);
    this.masterGain = bus.masterGain;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.75;
    bus.output.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    for (const track of TRACKS) {
      const gain = ctx.createGain();
      gain.gain.value = isAudible(track.id, this.mute, this.solo) ? 1 : 0;

      if (typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.value = track.pan;
        gain.connect(panner);
        panner.connect(this.masterGain);
      } else {
        gain.connect(this.masterGain);
      }
      this.trackGains[track.id] = gain;
    }

    this.worker = createClockWorker();
    this.worker.onmessage = () => this.scheduler();
  }

  async ensureRunning() {
    this.init();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  /* ---------------- scheduling ---------------- */

  scheduler() {
    if (!this.isPlaying) return;
    const horizon = this.ctx.currentTime + SCHEDULE_AHEAD;

    while (this.nextNoteTime < horizon) {
      this.scheduleStep(this.currentStep, this.nextNoteTime);
      this.scheduledQueue.push({ step: this.currentStep, time: this.nextNoteTime });
      this.advance();
    }
  }

  scheduleStep(step, time) {
    for (const track of TRACKS) {
      const value = this.pattern[track.id][step];
      if (!value) continue;
      const velocity = (value === 2 ? VELOCITY.accent : VELOCITY.normal) * track.gain;
      VOICES[track.id](this.ctx, this.trackGains[track.id], time, velocity);
    }
  }

  /**
   * Swing lives in the intervals: an even step waits a little longer, the odd
   * step after it waits a little less, so odd (offbeat) steps land late while
   * every even step — and the bar length — stays exactly on the grid.
   */
  advance() {
    const step = stepDuration(this.bpm);
    const swing = swingSeconds(this.swing, this.bpm);
    this.nextNoteTime += this.currentStep % 2 === 0 ? step + swing : step - swing;
    this.currentStep = (this.currentStep + 1) % STEPS;
  }

  /* ---------------- transport ---------------- */

  async start() {
    if (this.isPlaying) return;
    await this.ensureRunning();

    this.isPlaying = true;
    this.currentStep = 0;
    this.displayStep = -1;
    this.scheduledQueue = [];
    this.nextNoteTime = this.ctx.currentTime + PRE_ROLL;

    this.worker.postMessage('start');
    this.scheduler(); // fill the lookahead window immediately
    this.startUiClock();
  }

  stop() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this.worker.postMessage('stop');
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.scheduledQueue = [];
    this.displayStep = -1;
    this.currentStep = 0;
    this.onStepChange?.(-1);
  }

  /**
   * Visual only. Instructions were sent to the audio clock up to 120 ms ago;
   * here we just reveal them at the moment they actually sound, so the
   * playhead is sample-locked to what you hear instead of to rAF's frame rate.
   */
  startUiClock() {
    const tick = () => {
      if (!this.isPlaying) return;
      const now = this.ctx.currentTime;

      while (this.scheduledQueue.length && this.scheduledQueue[0].time <= now) {
        const entry = this.scheduledQueue.shift();
        if (entry.step !== this.displayStep) {
          this.displayStep = entry.step;
          this.onStepChange?.(entry.step);
        }
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  /* ---------------- parameters ---------------- */

  setPattern(pattern) {
    this.pattern = pattern;
  }

  setBpm(bpm) {
    this.bpm = bpm;
  }

  setSwing(swing) {
    this.swing = swing;
  }

  setVolume(volume) {
    this.volume = volume;
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.01);
    }
  }

  setMute(mute) {
    this.mute = mute;
    this.applyTrackGains();
  }

  setSolo(solo) {
    this.solo = solo;
    this.applyTrackGains();
  }

  applyTrackGains() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const track of TRACKS) {
      const target = isAudible(track.id, this.mute, this.solo) ? 1 : 0;
      // Short ramp instead of a jump — an instant 1 -> 0 click is audible.
      this.trackGains[track.id].gain.setTargetAtTime(target, now, 0.008);
    }
  }

  /** One-shot audition used when the user clicks a step while stopped. */
  async audition(trackId, accented = false) {
    await this.ensureRunning();
    const track = TRACKS.find((t) => t.id === trackId);
    if (!track) return;
    const velocity = (accented ? VELOCITY.accent : VELOCITY.normal) * track.gain;
    VOICES[trackId](this.ctx, this.trackGains[trackId], this.ctx.currentTime + 0.01, velocity);
  }

  getLevel() {
    if (!this.analyser) return 0;
    const buf = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / buf.length);
  }

  dispose() {
    this.stop();
    this.worker?.terminate?.();
    this.ctx?.close?.();
    this.ctx = null;
  }
}

export const engine = new DrumEngine();
