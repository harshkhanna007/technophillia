/**
 * What the visitor has opened, kept between visits so a finale is reachable across sessions.
 * Versioned and minimal: node ids and finished branches, nothing else. Storage can be blocked
 * (private windows, strict settings), so every access is guarded and the app works without it.
 */
const KEY = 'technophilia:v1:progress';

export interface Progress {
  /** ids of every node opened so far */
  visited: string[];
  /** category indices whose finale has already played */
  done: number[];
}

export function loadProgress(): Progress {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { visited: [], done: [] };
    const p = JSON.parse(raw) as Partial<Progress>;
    return {
      visited: Array.isArray(p.visited) ? p.visited.filter((v): v is string => typeof v === 'string') : [],
      done: Array.isArray(p.done) ? p.done.filter((v): v is number => Number.isInteger(v)) : [],
    };
  } catch {
    return { visited: [], done: [] };
  }
}

export function saveProgress(p: Progress) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage can be blocked or full; progress just will not persist */
  }
}
