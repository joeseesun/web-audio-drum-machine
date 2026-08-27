import React, { useCallback, useEffect, useRef, useState } from 'react';
import { engine, TRACKS, STEPS } from './audio/engine';
import { PRESETS, parsePreset, emptyGrid } from './audio/presets';
import { renderPatternToWav, downloadBlob } from './audio/export';
import Slider from './components/Slider';
import TrackRow from './components/TrackRow';
import LevelMeter from './components/LevelMeter';
import SiteChrome, { SiteFooter } from './components/SiteChrome';

function setCell(pattern, trackId, index, value) {
  return {
    ...pattern,
    [trackId]: pattern[trackId].map((v, i) => (i === index ? value : v)),
  };
}

export default function App() {
  const [pattern, setPattern] = useState(() => parsePreset(PRESETS[0]));
  const [bpm, setBpm] = useState(120);
  const [swing, setSwing] = useState(18);
  const [volume, setVolume] = useState(0.8);
  const [mute, setMute] = useState({});
  const [solo, setSolo] = useState({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [bars, setBars] = useState(2);
  const [presetName, setPresetName] = useState(PRESETS[0].name);
  const [status, setStatus] = useState('');
  const [exporting, setExporting] = useState(false);

  // Mirror of `pattern` for event handlers, so mousedown/mouseenter never
  // read stale state during a fast drag across the grid.
  const patternRef = useRef(pattern);
  const paintRef = useRef(null); // value being drag-painted, or null
  const playingRef = useRef(false);

  const applyPattern = useCallback((next) => {
    patternRef.current = next;
    setPattern(next);
  }, []);

  /* ---------------- engine wiring ---------------- */

  useEffect(() => {
    engine.onStepChange = setCurrentStep;
    return () => {
      engine.stop();
      engine.onStepChange = null;
    };
  }, []);

  useEffect(() => engine.setPattern(pattern), [pattern]);
  useEffect(() => engine.setBpm(bpm), [bpm]);
  useEffect(() => engine.setSwing(swing), [swing]);
  useEffect(() => engine.setVolume(volume), [volume]);
  useEffect(() => engine.setMute(mute), [mute]);
  useEffect(() => engine.setSolo(solo), [solo]);
  useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);

  /* ---------------- transport ---------------- */

  const togglePlay = useCallback(async () => {
    if (isPlaying) {
      engine.stop();
      setIsPlaying(false);
    } else {
      await engine.start();
      setIsPlaying(true);
    }
  }, [isPlaying]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.code !== 'Space') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlay]);

  /* ---------------- grid editing ---------------- */

  useEffect(() => {
    const endPaint = () => {
      paintRef.current = null;
    };
    window.addEventListener('mouseup', endPaint);
    return () => window.removeEventListener('mouseup', endPaint);
  }, []);

  const handleToggle = useCallback(
    (trackId, index) => {
      const current = patternRef.current[trackId][index];
      const next = current ? 0 : 1;
      applyPattern(setCell(patternRef.current, trackId, index, next));
      paintRef.current = next; // drag continues painting this value
      if (next === 1) engine.audition(trackId);
    },
    [applyPattern]
  );

  const handlePaint = useCallback(
    (trackId, index) => {
      const value = paintRef.current;
      if (value === null) return;
      if (patternRef.current[trackId][index] === value) return;
      applyPattern(setCell(patternRef.current, trackId, index, value));
    },
    [applyPattern]
  );

  const handleAccent = useCallback(
    (trackId, index) => {
      const current = patternRef.current[trackId][index];
      if (!current) return;
      applyPattern(setCell(patternRef.current, trackId, index, current === 2 ? 1 : 2));
    },
    [applyPattern]
  );

  const toggleMute = useCallback((id) => setMute((m) => ({ ...m, [id]: !m[id] })), []);
  const toggleSolo = useCallback((id) => setSolo((s) => ({ ...s, [id]: !s[id] })), []);

  /* ---------------- patterns ---------------- */

  const loadPreset = (name) => {
    const preset = PRESETS.find((p) => p.name === name);
    if (!preset) return;
    applyPattern(parsePreset(preset));
    setPresetName(name);
    setStatus(`Loaded "${name}"`);
  };

  const clearAll = () => {
    applyPattern(emptyGrid());
    setPresetName('Custom');
    setStatus('Cleared');
  };

  const randomize = () => {
    const density = {
      kick: 0.3, snare: 0.16, hhc: 0.55, hho: 0.08,
      clap: 0.14, tom: 0.08, rim: 0.1, crash: 0.04,
    };
    const next = {};
    for (const track of TRACKS) {
      next[track.id] = Array.from({ length: STEPS }, (_, i) => {
        // Nudge odds toward downbeats so random patterns still groove.
        const weight = i % 4 === 0 ? 1.9 : i % 2 === 0 ? 1.2 : 0.75;
        if (Math.random() > density[track.id] * weight) return 0;
        return Math.random() < 0.22 ? 2 : 1;
      });
    }
    applyPattern(next);
    setPresetName('Custom');
    setStatus('Randomized');
  };

  /* ---------------- export ---------------- */

  const handleExport = async () => {
    setExporting(true);
    setStatus('Rendering offline…');
    try {
      const blob = await renderPatternToWav({
        pattern: patternRef.current,
        bpm,
        swing,
        volume,
        mute,
        solo,
        bars,
      });
      const seconds = (STEPS * bars * (60 / bpm / 4)).toFixed(1);
      downloadBlob(blob, `drum-machine_${bpm}bpm_${bars}bars.wav`);
      setStatus(`Exported ${bars} bar${bars > 1 ? 's' : ''} · ${seconds}s · ${(blob.size / 1048576).toFixed(2)} MB WAV`);
    } catch (err) {
      setStatus(`Export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(''), 4000);
    return () => clearTimeout(t);
  }, [status]);

  /* ---------------- render ---------------- */

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">DR<span>808</span></div>
          <div className="brand-text">
            <strong>Web Audio Drum Machine</strong>
            <span>8 tracks · 16 steps · pure synthesis</span>
          </div>
        </div>

        <div className="transport">
          <button
            type="button"
            className={`play-btn ${isPlaying ? 'playing' : ''}`}
            onClick={togglePlay}
            aria-label={isPlaying ? 'Stop' : 'Play'}
          >
            {isPlaying ? (
              <svg viewBox="0 0 24 24" width="22" height="22"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5.5v13l11-6.5z"/></svg>
            )}
            <span>{isPlaying ? 'STOP' : 'PLAY'}</span>
          </button>

          <div className="tempo-readout">
            <span className="tempo-value">{bpm}</span>
            <span className="tempo-unit">BPM</span>
          </div>

          <LevelMeter active={isPlaying} />
        </div>

        <SiteChrome />
      </header>

      <main className="console">
        <section className="panel sequencer">
          <div className="sequencer-head">
            <h2>Step Sequencer</h2>
            <div className="legend">
              <span><i className="chip on" /> Hit</span>
              <span><i className="chip accent" /> Accent <em>(right-click)</em></span>
              <span><i className="chip drag" /> Drag to paint</span>
            </div>
          </div>

          {/* On narrow screens this scrolls sideways instead of squeezing 16
              steps into 8px-wide slivers — a step you cannot hit is not a step. */}
          <div className="grid-scroll">
            <div className="grid" onContextMenu={(e) => e.preventDefault()}>
            <div className="grid-header">
              <div className="corner">TRACK</div>
              {Array.from({ length: STEPS }, (_, i) => (
                <div
                  key={i}
                  className={[
                    'step-num',
                    i % 4 === 0 ? 'downbeat' : '',
                    i === currentStep ? 'active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {i + 1}
                </div>
              ))}
            </div>

            {TRACKS.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                steps={pattern[track.id]}
                currentStep={currentStep}
                muted={!!mute[track.id]}
                soloed={!!solo[track.id]}
                onToggle={handleToggle}
                onPaint={handlePaint}
                onAccent={handleAccent}
                onMute={toggleMute}
                onSolo={toggleSolo}
                onAudition={(id) => engine.audition(id)}
              />
            ))}

            {/* Single element spanning every row = the scanning playhead.
                It is absolutely positioned but still placed by grid-column /
                grid-row, so it is out of flow (it cannot displace the 153
                auto-placed cells) yet lines up exactly with its column.
                Both edges must be explicit — a bare `gridColumn: N` leaves the
                end line `auto`, which stretches the containing block to the
                grid's padding edge instead of the single column. */}
            {currentStep >= 0 && (
              <div
                className="playhead"
                style={{
                  gridColumn: `${currentStep + 2} / span 1`,
                  gridRow: `1 / span ${TRACKS.length + 1}`,
                }}
              />
            )}
            </div>
          </div>
        </section>

        <aside className="panel controls">
          <h2>Controls</h2>

          <Slider label="Tempo" value={bpm} min={60} max={200} step={1} unit=" BPM" onChange={setBpm} />
          <Slider
            label="Swing"
            value={swing}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={setSwing}
            format={(v) => (v === 0 ? 'Off' : `${v}%`)}
          />
          <Slider
            label="Master"
            value={Math.round(volume * 100)}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={(v) => setVolume(v / 100)}
          />

          <div className="divider" />

          <div className="field">
            <label htmlFor="preset">Pattern</label>
            <select id="preset" value={presetName} onChange={(e) => loadPreset(e.target.value)}>
              {presetName === 'Custom' && <option value="Custom">Custom</option>}
              {PRESETS.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="btn-row">
            <button type="button" className="ghost" onClick={randomize}>Randomize</button>
            <button type="button" className="ghost" onClick={clearAll}>Clear</button>
          </div>

          <div className="divider" />

          <h2>Export</h2>
          <div className="field">
            <label htmlFor="bars">Loop length</label>
            <select id="bars" value={bars} onChange={(e) => setBars(Number(e.target.value))}>
              {[1, 2, 4, 8, 16].map((n) => (
                <option key={n} value={n}>{n} bar{n > 1 ? 's' : ''}</option>
              ))}
            </select>
          </div>

          <button type="button" className="export-btn" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Rendering…' : 'Record loop → WAV'}
          </button>
          <p className="hint">
            Bounced offline through the same synth graph — sample-accurate, honours mute / solo / swing.
          </p>

          <div className={`status ${exporting ? 'busy' : ''}`}>{status || 'Ready'}</div>
        </aside>
      </main>

      <SiteFooter />

      <footer className="footer">
        <span><kbd>Space</kbd> play / stop</span>
        <span><kbd>Click</kbd> toggle step</span>
        <span><kbd>Right-click</kbd> accent</span>
        <span><kbd>Drag</kbd> paint</span>
      </footer>
    </div>
  );
}
