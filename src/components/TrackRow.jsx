import React from 'react';

/**
 * One instrument lane.
 * Rendered with `display: contents` so all cells across all lanes share the
 * parent grid — that's what keeps the 16 columns perfectly aligned and lets
 * the playhead overlay span every row from a single element.
 */
export default function TrackRow({
  track,
  steps,
  currentStep,
  muted,
  soloed,
  onToggle,
  onPaint,
  onAccent,
  onMute,
  onSolo,
  onAudition,
}) {
  const dimmed = muted && !soloed;
  // Lights the LED on the step where this track actually fires.
  const hit = currentStep >= 0 && steps[currentStep] > 0;

  return (
    <div className="track-row" style={{ '--track-color': track.color }}>
      <div className={`track-head ${dimmed ? 'dimmed' : ''} ${hit ? 'hit' : ''}`}>
        <button
          type="button"
          className="track-name"
          onClick={() => onAudition(track.id)}
          title={`Audition ${track.name}`}
        >
          <span className="track-dot" />
          <span className="track-text">
            <span className="track-abbr">{track.abbr}</span>
            <span className="track-full">{track.name}</span>
          </span>
        </button>
        <div className="track-toggles">
          <button
            type="button"
            className={`toggle mute ${muted ? 'on' : ''}`}
            onClick={() => onMute(track.id)}
            title="Mute"
            aria-pressed={muted}
          >
            M
          </button>
          <button
            type="button"
            className={`toggle solo ${soloed ? 'on' : ''}`}
            onClick={() => onSolo(track.id)}
            title="Solo"
            aria-pressed={soloed}
          >
            S
          </button>
        </div>
      </div>

      {steps.map((value, index) => (
        <div key={index} className={`cell-slot ${index % 4 === 0 ? 'downbeat' : ''}`}>
          <button
            type="button"
            className={[
              'step',
              value === 2 ? 'accent' : value === 1 ? 'on' : '',
              index === currentStep ? 'playing' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-label={`${track.name} step ${index + 1}`}
            aria-pressed={value > 0}
            onMouseDown={(e) => {
              if (e.button === 2) return; // right-click handled by contextmenu
              e.preventDefault();
              onToggle(track.id, index, false, e);
            }}
            onMouseEnter={(e) => onPaint(track.id, index, e)}
            onContextMenu={(e) => {
              e.preventDefault();
              onAccent(track.id, index);
            }}
          >
            <span className="step-inner" />
          </button>
        </div>
      ))}
    </div>
  );
}
