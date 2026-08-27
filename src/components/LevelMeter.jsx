import React, { useEffect, useRef } from 'react';
import { engine } from '../audio/engine';

/**
 * Master output meter. Reads the analyser every frame and mutates the DOM
 * directly — routing this through React state would re-render the whole grid
 * 60 times a second for no reason.
 */
export default function LevelMeter({ active }) {
  const barRef = useRef(null);
  const peakRef = useRef(null);
  const valueRef = useRef(0);
  const peakRefValue = useRef(0);

  useEffect(() => {
    let raf;
    const loop = () => {
      const level = active ? engine.getLevel() : 0;
      // Fast attack, slow release — reads like a hardware VU.
      const current = valueRef.current;
      valueRef.current = level > current ? level : current * 0.86 + level * 0.14;

      if (barRef.current) {
        barRef.current.style.transform = `scaleX(${Math.min(1, valueRef.current * 2.6)})`;
      }

      if (valueRef.current > peakRefValue.current) {
        peakRefValue.current = valueRef.current;
      } else {
        peakRefValue.current *= 0.985;
      }
      if (peakRef.current) {
        peakRef.current.style.left = `${Math.min(100, peakRefValue.current * 260)}%`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return (
    <div className="meter" aria-hidden="true">
      <div className="meter-track">
        <div className="meter-fill" ref={barRef} />
        <div className="meter-peak" ref={peakRef} />
      </div>
      <span className="meter-label">OUT</span>
    </div>
  );
}
