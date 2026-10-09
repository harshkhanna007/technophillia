'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { FinaleState } from '@/engine/types';

interface Props {
  finale: FinaleState | null;
}

type Vars = CSSProperties & Record<`--${string}`, string | number>;

/**
 * The caption that names a finale: a branch completed, or the whole tree. It rests at the top of the stage, in the
 * colours of the branch that just finished, and leaves on its own once the engine clears it.
 */
export default function FinaleCaption({ finale }: Props) {
  const [shown, setShown] = useState(finale);
  if (finale && finale !== shown) setShown(finale);

  // mount hidden, show two frames later, so the entrance really transitions
  const [lit, setLit] = useState(0);
  useEffect(() => {
    if (!finale) return;
    let b = 0;
    const a = requestAnimationFrame(() => {
      b = requestAnimationFrame(() => setLit(finale.seq));
    });
    return () => {
      cancelAnimationFrame(a);
      cancelAnimationFrame(b);
    };
  }, [finale]);

  if (!shown) return null;
  const vars: Vars = { '--c': shown.colors.a, '--c2': shown.colors.accent, '--c3': shown.colors.b, '--d': '0.15s' };
  const line = (i: number): Vars => ({ '--i': i });

  return (
    <div className="finale" data-show={finale && lit === finale.seq ? 1 : 0} data-kind={shown.kind} role="status" aria-live="polite" aria-hidden={!finale} style={vars}>
      <p className="finale__kick rv" style={line(0)}>
        {shown.kind === 'tree' ? 'Every branch complete' : 'Branch complete'}
      </p>
      <p className="finale__title rv" style={line(1)}>
        {shown.title}
      </p>
      <p className="finale__sub rv" style={line(2)}>
        {shown.sub}
      </p>
    </div>
  );
}
