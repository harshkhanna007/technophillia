'use client';

import { answers } from '@/data/answers';
import { hooks } from '@/data/hooks';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { RevealState } from '@/engine/types';

export interface CardBox {
  side: 'l' | 'r' | 'b';
  w: number;
  h: number;
}

interface Props {
  reveal: RevealState | null;
  /** tells the engine where the card sits, so node labels keep clear of it */
  onBox(box: CardBox | null): void;
  /** the hook was chosen: open that node */
  onOpen(id: string): void;
  /** the pointer is resting on the hook: light that node in the scene (null when it leaves) */
  onPeek(id: string | null, viaKey?: boolean, at?: { x: number; y: number }): void;
}

/** keep a number with its unit, and a short acronym with its year, so a line never breaks between them */
const NBSP = '\u00a0';
const tie = (s: string) => s.replace(/(\d) (?=[A-Za-z%°])/g, `$1${NBSP}`).replace(/\b([A-Z]{2,}) (?=\d)/g, `$1${NBSP}`);

/** a CSS custom property is not part of CSSProperties */
type Vars = CSSProperties & Record<`--${string}`, string | number>;

/**
 * The card for the node you just opened: one number worth stopping for, why the node matters, and what is next.
 * It slides in as the node's own moment finishes (`reveal.delay`) and leaves the moment you move on. The last card
 * stays mounted while it fades, so the exit is a transition and not a cut.
 */
export default function RevealCard({ reveal, onBox, onOpen, onPeek }: Props) {
  const [shown, setShown] = useState(reveal);
  if (reveal && reveal !== shown) setShown(reveal);
  const ref = useRef<HTMLElement>(null);

  // a freshly mounted element starts in its final state and would not transition: it mounts hidden, and shows two frames later
  const [lit, setLit] = useState(0);
  useEffect(() => {
    if (!reveal) return;
    let b = 0;
    const a = requestAnimationFrame(() => {
      b = requestAnimationFrame(() => setLit(reveal.seq));
    });
    return () => {
      cancelAnimationFrame(a);
      cancelAnimationFrame(b);
    };
  }, [reveal]);

  useEffect(() => {
    const el = ref.current;
    if (!reveal || !el) return;
    const phone = window.matchMedia('(max-width: 700px)');
    const report = () => onBox({ side: phone.matches ? 'b' : reveal.side, w: el.offsetWidth, h: el.offsetHeight });
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    phone.addEventListener('change', report);
    return () => {
      ro.disconnect();
      phone.removeEventListener('change', report);
      onBox(null);
    };
  }, [reveal, onBox]);

  if (!shown) return null;
  const { fact, colors, hook } = shown;
  const vars: Vars = {
    '--c': colors.a,
    '--c2': colors.accent,
    '--c3': colors.b,
    '--d': `${shown.delay.toFixed(2)}s`,
    '--len': Math.max(4, fact.stat.value.length),
  };
  const line = (i: number): Vars => ({ '--i': i });

  return (
    <aside ref={ref} className="reveal" data-show={reveal && lit === reveal.seq ? 1 : 0} data-side={shown.side} aria-label={`About ${shown.title}`} aria-live="polite" aria-hidden={!reveal} style={vars}>
      <div className="reveal__body">
        <section className="reveal__block reveal__answer rv" style={line(0)} aria-label={`Answer: ${hooks[shown.id] ?? ''}`}>
          <h3 className="reveal__label">The answer</h3>
          <p className="reveal__text">{tie(answers[shown.id] ?? fact.why)}</p>
        </section>
        <div className="reveal__rule rv" style={line(1)} role="presentation" />
        <div className="reveal__head">
          <p className="reveal__value rv" style={line(2)}>
            {fact.stat.value}
          </p>
          <p className="reveal__caption rv" style={line(3)}>
            {tie(fact.stat.label)}
          </p>
        </div>
        {hook ? (
          <button
            type="button"
            className="reveal__block reveal__block--next reveal__hook rv"
            style={line(4)}
            aria-label={`Open ${hook.title}: ${hook.teaser}`}
            tabIndex={reveal ? 0 : -1}
            onClick={() => onOpen(hook.id)}
            onPointerEnter={() => onPeek(hook.id)}
            onPointerLeave={() => onPeek(null)}
            onFocus={(e) => {
              const b = e.currentTarget.querySelector('.reveal__go')?.getBoundingClientRect();
              onPeek(hook.id, e.currentTarget.matches(':focus-visible'), b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : undefined);
            }}
            onBlur={() => onPeek(null)}
          >
            <span className="reveal__hookBody">
              <span className="reveal__label">{hook.title}</span>
              <span className="reveal__text">{hook.teaser}</span>
            </span>
            <span className="reveal__go" aria-hidden="true">
              →
            </span>
          </button>
        ) : (
          <section className="reveal__block reveal__block--next rv" style={line(4)}>
            <h3 className="reveal__label">What’s next</h3>
            <p className="reveal__text">{tie(fact.next)}</p>
          </section>
        )}
        <p className="reveal__meta rv" style={line(5)}>
          {shown.opened} of {shown.total} opened
        </p>
      </div>
    </aside>
  );
}
