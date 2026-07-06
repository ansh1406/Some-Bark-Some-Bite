export const EVENTS = {
  CREATE_MATCH: 'CREATE_MATCH',
  JOIN_MATCH: 'JOIN_MATCH',
  MATCH_STATE: 'MATCH_STATE',
  SUBMIT_MOVE: 'SUBMIT_MOVE',
  OFFER_DRAW: 'OFFER_DRAW',
  ACCEPT_DRAW: 'ACCEPT_DRAW',
  RESIGN: 'RESIGN',
  ERROR: 'ERROR'
} as const;

export interface CreateMatchPayload {
  timeControlMs?: number;
}

export interface JoinMatchPayload {
  matchId: string;
}

export interface SubmitMovePayload {
  matchId: string;
  from: [number, number];
  to: [number, number];
}

export interface MatchStatePayload {
  matchId: string;
  status: 'IN_PROGRESS' | 'WHITE_WINS' | 'BLACK_WINS' | 'DRAW' | 'TIMEOUT';
  activeColor: 'White' | 'Black';
  board: Array<Array<unknown>>;
  clocks: {
    whiteMs: number;
    blackMs: number;
    lastTimestamp: number;
  };
  uiState: {
    offsidePieceIds: string[];
    provocationTargets: Array<{ square: [number, number]; threatenedBy: string }>;
    validMoves: Record<string, Array<[number, number]>>;
    drawOfferedBy: 'White' | 'Black' | null;
  };
  moveHistory: unknown[];
}
