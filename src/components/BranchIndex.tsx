'use client';

import { useEffect, useRef } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import type { BranchIndexItem } from '@/engine/types';

interface Props {
  items: BranchIndexItem[];
  /** the branch you are inside right now (the first node of the path) */
  activeId: string | null;
  show: boolean;
  /** a row was chosen: go to that branch (the pane then closes) */
  onJump(c: number): void;
  /** Escape was pressed inside the pane */
  onClose(): void;
  onPeek(id: string | null, viaKey?: boolean, at?: { x: number; y: number }): void;
}

type Vars = CSSProperties & Record<`--${string}`, string | number>;

/**
 * The index: six colour keys in one small pane of glass, like the legend on a map. Each row is a branch with its
 * number key and its name. The branch you are in is lit, a finished one glows, and the sheen on the glass follows the
 * pointer. Clicking a row (or pressing its number) goes to that branch.
 *
 * Keyboard: Tab opens and closes the pane (the HUD handles that key). Opening moves focus onto the branch you are in,
 * the arrows (or Home and End) move between rows with a roving tabindex, Enter or Space goes there, Escape closes. On
 * closing, focus returns to where it was, unless a branch was chosen, so the arrows then steer the tree again.
 */
export default function BranchIndex({ items, activeId, show, onJump, onClose, onPeek }: Props) {
  const ref = useRef<HTMLElement>(null);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const prev = useRef<Element | null>(null);
  const jumped = useRef(false);
  const current = Math.max(
    0,
    items.findIndex((b) => b.id === activeId),
  );

  // the reflection is moved with two custom properties, so the pointer never re-renders anything
  const sheen = (e: PointerEvent<HTMLElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
  };

  // opening takes focus into the pane; closing gives it back
  useEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    if (show) {
      prev.current = document.activeElement;
      jumped.current = false;
      rows.current[current]?.focus({ preventScroll: true });
      return;
    }
    if (nav.contains(document.activeElement)) {
      const back = prev.current;
      if (!jumped.current && back instanceof HTMLElement && back.isConnected && back !== document.body) back.focus({ preventScroll: true });
      else (document.activeElement as HTMLElement | null)?.blur();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the open state decides; `current` is read at the moment of opening
  }, [show]);

  const move = (to: number) => {
    const n = items.length;
    rows.current[((to % n) + n) % n]?.focus({ preventScroll: true });
  };

  const keys = (e: KeyboardEvent<HTMLElement>) => {
    const at = rows.current.findIndex((r) => r === document.activeElement);
    const k = e.key;
    let handled = true;
    if (k === 'ArrowDown' || k === 'ArrowRight') move(at + 1);
    else if (k === 'ArrowUp' || k === 'ArrowLeft') move(at - 1);
    else if (k === 'Home') move(0);
    else if (k === 'End') move(items.length - 1);
    else if (k === 'Escape' || k === 'Backspace') onClose();
    else handled = false;
    // a handled key must not also steer the tree behind the pane
    if (handled) e.preventDefault();
  };

  return (
    <nav ref={ref} className="index" data-show={show ? 1 : 0} aria-label="Branches" aria-hidden={!show} onPointerMove={sheen} onKeyDown={keys}>
      <p className="index__head">Index</p>
      <ol className="index__list">
        {items.map((b, i) => {
          const vars: Vars = { '--a': b.a, '--b': b.b };
          return (
            <li key={b.id}>
              <button
                ref={(el) => {
                  rows.current[i] = el;
                }}
                type="button"
                className="index__row"
                style={vars}
                data-active={b.id === activeId ? 1 : 0}
                data-done={b.done ? 1 : 0}
                data-fresh={b.opened === 0 ? 1 : 0}
                tabIndex={show && i === current ? 0 : -1}
                aria-current={b.id === activeId ? 'true' : undefined}
                aria-label={`${b.title}. Key ${i + 1}`}
                onClick={() => {
                  jumped.current = true;
                  onJump(i);
                }}
                onPointerEnter={() => onPeek(b.id)}
                onPointerLeave={() => onPeek(null)}
                onFocus={(e) => {
                  const k = e.currentTarget.querySelector('.index__chip')?.getBoundingClientRect();
                  onPeek(b.id, e.currentTarget.matches(':focus-visible'), k ? { x: k.left + k.width / 2, y: k.top + k.height / 2 } : undefined);
                }}
                onBlur={() => onPeek(null)}
              >
                <span className="index__chip" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="index__name">{b.title.toLowerCase()}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
