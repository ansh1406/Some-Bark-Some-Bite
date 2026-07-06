import { newGame, type EngineState } from '@sbsb/engine';

export const LOCAL_SESSION_KEY = 'local_session';

export type LocalStatus = 'IN_PROGRESS' | 'WHITE_WINS' | 'BLACK_WINS' | 'DRAW';

export interface LocalSession {
  game: EngineState;
  clocks: {
    whiteRemainingMs: number | null;
    blackRemainingMs: number | null;
    lastTick: number;
  };
  status: LocalStatus;
  timeControlMs: number | null;
  reviewIndex: number;
}

export function createLocalSession(timeControlMs: number | null): LocalSession {
  const now = Date.now();
  return {
    game: newGame(),
    clocks: {
      whiteRemainingMs: timeControlMs,
      blackRemainingMs: timeControlMs,
      lastTick: now
    },
    status: 'IN_PROGRESS',
    timeControlMs,
    reviewIndex: 0
  };
}

export function loadLocalSession(): LocalSession | null {
  try {
    const raw = localStorage.getItem(LOCAL_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalSession;
    if (!parsed?.game || !parsed?.clocks) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveLocalSession(session: LocalSession): void {
  localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(session));
}

export function clearLocalSession(): void {
  localStorage.removeItem(LOCAL_SESSION_KEY);
}
