import React from 'react';

/** Labelled horizontal fader used for BPM / swing / master volume. */
export default function Slider({ label, value, min, max, step = 1, unit = '', onChange, format }) {
  const display = format ? format(value) : `${value}${unit}`;
  const percent = ((value - min) / (max - min)) * 100;

  return (
    <div className="slider" style={{ '--fill': `${percent}%` }}>
      <div className="slider-head">
        <span className="slider-label">{label}</span>
        <span className="slider-value">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
