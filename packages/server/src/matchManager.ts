import {
  applyMove,
  buildGodPayload,
  generateLegalMoves,
  newGame,
  type Color,
  type Coord,
  type EngineState
} from '@sbsb/engine';
import type { MatchStatePayload } from './protocol';

export interface MatchState {
  matchId: string;
  status: 'IN_PROGRESS' | 'WHITE_WINS' | 'BLACK_WINS' | 'DRAW' | 'TIMEOUT';
  clients: {
    white: string | null;
    black: string | null;
  };
  engineState: EngineState;
  clocks: {
    whiteRemainingMs: number;
    blackRemainingMs: number;
    lastMoveTimestamp: number;
  };
  drawOfferedBy: Color | null;
}

const activeMatches = new Map<string, MatchState>();
const matchQueues = new Map<string, Promise<void>>();

function now(): number {
  return Date.now();
}

function generateMatchId(): string {
  let matchId = '';
  do {
    matchId = Math.floor(100000 + Math.random() * 900000).toString();
  } while (activeMatches.has(matchId));
  return matchId;
}

export function getActiveMatches(): Map<string, MatchState> {
  return activeMatches;
}

export function createMatch(timeControlMs = 300000): MatchState {
  const matchId = generateMatchId();
  const match: MatchState = {
    matchId,
    status: 'IN_PROGRESS',
    clients: { white: null, black: null },
    engineState: newGame(),
    clocks: {
      whiteRemainingMs: timeControlMs,
      blackRemainingMs: timeControlMs,
      lastMoveTimestamp: now()
    },
    drawOfferedBy: null
  };

  activeMatches.set(matchId, match);
  return match;
}

export function getMatch(matchId: string): MatchState | undefined {
  return activeMatches.get(matchId);
}

export function joinMatch(matchId: string, socketId: string): { match: MatchState; color: Color } {
  const match = activeMatches.get(matchId);
  if (!match) {
    throw new Error('Match not found');
  }

  if (match.clients.white === socketId) return { match, color: 'White' };
  if (match.clients.black === socketId) return { match, color: 'Black' };

  if (!match.clients.white) {
    match.clients.white = socketId;
    return { match, color: 'White' };
  }

  if (!match.clients.black) {
    match.clients.black = socketId;
    return { match, color: 'Black' };
  }

  throw new Error('Match is full');
}

export function enqueueMatchTask(matchId: string, task: () => Promise<void> | void): Promise<void> {
  const previous = matchQueues.get(matchId) ?? Promise.resolve();
  const next = previous.then(() => task());
  matchQueues.set(matchId, next.catch(() => undefined));
  return next;
}

export function getPlayerColor(match: MatchState, socketId: string): Color | null {
  if (match.clients.white === socketId) return 'White';
  if (match.clients.black === socketId) return 'Black';
  return null;
}

export function submitMove(matchId: string, socketId: string, from: Coord, to: Coord): MatchState {
  const match = activeMatches.get(matchId);
  if (!match) {
    throw new Error('Match not found');
  }
  if (match.status !== 'IN_PROGRESS') {
    throw new Error('Match is not active');
  }

  const color = getPlayerColor(match, socketId);
  if (!color) {
    throw new Error('Socket is not seated in this match');
  }
  if (match.engineState.activeColor !== color) {
    throw new Error('Not your turn');
  }

  const elapsed = now() - match.clocks.lastMoveTimestamp;
  const remainingKey = color === 'White' ? 'whiteRemainingMs' : 'blackRemainingMs';
  const nextRemaining = match.clocks[remainingKey] - elapsed;
  if (nextRemaining <= 0) {
    match.clocks[remainingKey] = 0;
    match.status = color === 'White' ? 'BLACK_WINS' : 'WHITE_WINS';
    match.clocks.lastMoveTimestamp = now();
    throw new Error('Timeout');
  }

  const nextState = applyMove(match.engineState, from, to);
  match.engineState = nextState;
  match.clocks[remainingKey] = nextRemaining;
  match.clocks.lastMoveTimestamp = now();
  match.drawOfferedBy = null;
  return match;
}

export function offerDraw(matchId: string, socketId: string): MatchState {
  const match = activeMatches.get(matchId);
  if (!match) throw new Error('Match not found');
  const color = getPlayerColor(match, socketId);
  if (!color) throw new Error('Socket is not seated in this match');
  match.drawOfferedBy = color;
  return match;
}

export function acceptDraw(matchId: string, socketId: string): MatchState {
  const match = activeMatches.get(matchId);
  if (!match) throw new Error('Match not found');
  const color = getPlayerColor(match, socketId);
  if (!color) throw new Error('Socket is not seated in this match');
  if (!match.drawOfferedBy || match.drawOfferedBy === color) {
    throw new Error('No opposing draw offer to accept');
  }
  match.status = 'DRAW';
  match.drawOfferedBy = null;
  return match;
}

export function resign(matchId: string, socketId: string): MatchState {
  const match = activeMatches.get(matchId);
  if (!match) throw new Error('Match not found');
  const color = getPlayerColor(match, socketId);
  if (!color) throw new Error('Socket is not seated in this match');
  match.status = color === 'White' ? 'BLACK_WINS' : 'WHITE_WINS';
  return match;
}

function toValidMoves(state: EngineState): Record<string, Array<[number, number]>> {
  const legalMoves = generateLegalMoves(state);
  const grouped = new Map<string, Array<[number, number]>>();

  for (const move of legalMoves) {
    const current = grouped.get(move.piece.id) ?? [];
    current.push(move.to);
    grouped.set(move.piece.id, current);
  }

  return Object.fromEntries(grouped.entries());
}

export function getMatchStatePayload(match: MatchState): MatchStatePayload {
  const god = buildGodPayload(match.matchId, match.engineState);
  return {
    matchId: match.matchId,
    status: match.status,
    activeColor: match.engineState.activeColor,
    board: match.engineState.board,
    clocks: {
      whiteMs: match.clocks.whiteRemainingMs,
      blackMs: match.clocks.blackRemainingMs,
      lastTimestamp: match.clocks.lastMoveTimestamp
    },
    uiState: {
      offsidePieceIds: god.uiState.offsidePieceIds,
      provocationTargets: match.engineState.provocationTargets.map(target => ({
        square: target.targetSquare,
        threatenedBy: target.pieceId
      })),
      validMoves: toValidMoves(match.engineState),
      drawOfferedBy: match.drawOfferedBy
    },
    moveHistory: match.engineState.moveHistory
  };
}
