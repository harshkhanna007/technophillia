'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { categories, meta } from '@/data/tree';
import type { Engine, EngineState } from '@/engine/Engine';
import Hud from './Hud';

/**
 * Mounts the imperative three.js engine. React only renders the thin HUD; the tree, camera,
 * labels and energy are all driven inside the engine (no per-frame React work).
 */
export default function Experience() {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [state, setState] = useState<EngineState | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let off: (() => void) | undefined;
    (async () => {
      try {
        const { Engine } = await import('@/engine/Engine');
        if (cancelled || !hostRef.current) return;
        const engine = new Engine(hostRef.current, categories);
        engineRef.current = engine;
        if (process.env.NODE_ENV !== 'production') (window as unknown as { __tp?: Engine }).__tp = engine;
        off = engine.onState(setState);
      } catch (err) {
        console.error('[technophilia] could not start the experience', err);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      off?.();
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, []);

  const home = useCallback(() => engineRef.current?.home(), []);
  const select = useCallback((id: string) => engineRef.current?.select(id), []);
  const mute = useCallback(() => engineRef.current?.toggleMute(), []);

  return (
    <main>
      <h1 className="sr">{meta.wordmark} — an interactive digital seed that grows into six technological branches</h1>
      <div ref={hostRef} className="host" />
      {failed ? (
        <div className="fallback" role="alert">
          <p>
            THIS EXPERIENCE NEEDS WEBGL.
            <br />
            TRY A RECENT CHROME, EDGE, FIREFOX OR SAFARI WITH HARDWARE ACCELERATION ENABLED.
          </p>
        </div>
      ) : (
        <Hud state={state} meta={meta} onHome={home} onSelect={select} onMute={mute} />
      )}
      <noscript>
        <p className="fallback">THIS EXPERIENCE REQUIRES JAVASCRIPT.</p>
      </noscript>
    </main>
  );
}
