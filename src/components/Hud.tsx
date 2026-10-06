'use client';

import type { EngineState } from '@/engine/Engine';
import type { ExperienceMeta } from '@/engine/types';

interface Props {
  state: EngineState | null;
  meta: ExperienceMeta;
  onHome(): void;
  onSelect(id: string): void;
  onMute(): void;
}

/** Deliberately tiny: a seed glyph that doubles as "home", a luminous breadcrumb trace, a sound switch. */
export default function Hud({ state, meta, onHome, onSelect, onMute }: Props) {
  const path = state?.path ?? [];
  const depth = path.length;
  const muted = state?.muted ?? false;
  return (
    <div className="hud">
      <div className="hud__top">
        <div className="mark">{meta.wordmark}</div>
      </div>
      <div className="hud__bottom">
        <div className="crumbs">
          <button type="button" className="crumbs__home" onClick={onHome} aria-label="Return to the seed" title="Return to the seed (Home)" />
          {path.map((p, i) => (
            <div key={p.id} className="crumb" data-last={i === depth - 1 ? 1 : 0}>
              <button type="button" onClick={() => onSelect(p.id)} tabIndex={i === depth - 1 ? -1 : 0}>
                {p.title}
              </button>
            </div>
          ))}
          <span className="hint" data-show={(state?.ready && !state.started) || (state?.intro && depth === 0 && !state.busy) ? 1 : 0}>
            {state?.started ? meta.hint : meta.seedHint}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <span className="keys" data-show={depth > 0 ? 1 : 0}>
            Esc retract · scroll zoom · F focus
          </span>
          <button type="button" className="sound" data-muted={muted ? 1 : 0} onClick={onMute} aria-pressed={!muted} aria-label={muted ? 'Unmute sound' : 'Mute sound'}>
            <span className="sound__bars" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className="sound__label">{muted ? 'Sound off' : 'Sound on'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
