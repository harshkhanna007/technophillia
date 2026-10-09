'use client';

import { useEffect, useState } from 'react';
import type { EngineState } from '@/engine/Engine';
import type { ExperienceMeta } from '@/engine/types';
import BranchIndex from './BranchIndex';
import FinaleCaption from './FinaleCaption';
import RevealCard from './RevealCard';
import type { CardBox } from './RevealCard';

interface Props {
  state: EngineState | null;
  meta: ExperienceMeta;
  onHome(): void;
  onSelect(id: string): void;
  onBranch(c: number): void;
  onIndex(open: boolean): void;
  onMute(): void;
  onCardBox(box: CardBox | null): void;
  onPeek(id: string | null, viaKey?: boolean, at?: { x: number; y: number }): void;
}

/**
 * Deliberately tiny: a seed glyph that doubles as "home", a luminous breadcrumb trace, a sound switch.
 * Two quiet layers sit above the stage: the card for the node you just opened, and the caption of a finale.
 */
export default function Hud({ state, meta, onHome, onSelect, onBranch, onIndex, onMute, onCardBox, onPeek }: Props) {
  const path = state?.path ?? [];
  const depth = path.length;
  const muted = state?.muted ?? false;

  // Tab opens and closes the index; it starts closed, and stays out of the way until asked for
  const [indexOpen, setIndexOpen] = useState(false);
  const started = !!state?.started;
  useEffect(() => {
    const roomy = window.matchMedia('(min-width: 1200px) and (min-height: 760px)');
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || !roomy.matches || !started) return;
      e.preventDefault();
      setIndexOpen((o) => !o);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [started]);
  useEffect(() => onIndex(indexOpen && started), [indexOpen, started, onIndex]);
  return (
    <div className="hud">
      <div className="hud__top">
        <div className="mark">
          {meta.wordmark}
          <span className="mark__ver">7.0</span>
        </div>
        <BranchIndex items={state?.index ?? []} activeId={path[0]?.id ?? null} show={indexOpen && started} onJump={(c) => {
            setIndexOpen(false);
            onBranch(c);
          }} onClose={() => setIndexOpen(false)} onPeek={onPeek} />
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
          <span className="keys" data-show={state?.started ? 1 : 0}>
            Arrows move · Enter open · N P cards · Tab index · Esc back · + − zoom
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
      <RevealCard reveal={state?.reveal ?? null} onBox={onCardBox} onOpen={onSelect} onPeek={onPeek} />
      <FinaleCaption finale={state?.finale ?? null} />
    </div>
  );
}
