/* Preset patterns.
 * Notation is 16 characters per track: '-' = silent, 'x' = hit, 'X' = accent. */
import { TRACK_IDS, STEPS } from './engine';

export const PRESETS = [
  {
    name: 'Four on the Floor',
    pattern: {
      kick:  'X---X---X---X---',
      snare: '----x-------x---',
      hhc:   'x-x-x-x-x-x-x-x',
      hho:   '----x-------x---',
      clap:  '----X-------X---',
      tom:   '----------------',
      rim:   '----------------',
      crash: 'X---------------',
    },
  },
  {
    name: 'Boom Bap',
    pattern: {
      kick:  'X-----x---x-x---',
      snare: '----X-------X--x',
      hhc:   'x-x-x-x-x-x-x-x',
      hho:   '----------x-----',
      clap:  '----x-------x---',
      tom:   '--------------x-',
      rim:   '--x-------------',
      crash: 'X---------------',
    },
  },
  {
    name: 'Rock',
    pattern: {
      kick:  'X---x---X---x---',
      snare: '----X-------X---',
      hhc:   'x-x-x-x-x-x-x-x',
      hho:   '----------------',
      clap:  '----------------',
      tom:   '-------------x-x',
      rim:   '----------------',
      crash: 'X---------------',
    },
  },
  {
    name: 'Breakbeat',
    pattern: {
      kick:  'X-------x-X-----',
      snare: '----X---x---X-x-',
      hhc:   'x-x-x-x-x-x-x-x',
      hho:   '------x---------',
      clap:  '----------------',
      tom:   '--------x---x---',
      rim:   '----------------',
      crash: 'X---------------',
    },
  },
  {
    name: 'Trap',
    pattern: {
      kick:  'X-----x-----x---',
      snare: '--------X-------',
      hhc:   'x-xxx-xxx-xxx-x-',
      hho:   '---------------x',
      clap:  '--------X-------',
      tom:   '----------------',
      rim:   '----------------',
      crash: 'X---------------',
    },
  },
];

/** Turn the ASCII preset into the engine's numeric grid (0 / 1 / 2). */
export function parsePreset(preset) {
  const out = {};
  for (const id of TRACK_IDS) {
    const row = preset.pattern[id] ?? '';
    out[id] = Array.from({ length: STEPS }, (_, i) => {
      const ch = row[i] ?? '-';
      return ch === 'X' ? 2 : ch === 'x' ? 1 : 0;
    });
  }
  return out;
}

export function emptyGrid() {
  return Object.fromEntries(TRACK_IDS.map((id) => [id, new Array(STEPS).fill(0)]));
}
