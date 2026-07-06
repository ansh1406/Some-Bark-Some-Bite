export type Color = 'White' | 'Black';

export type Coord = [number, number];

export type GameStatus = 'IN_PROGRESS' | 'CHECK' | 'CHECKMATE' | 'STALEMATE';

export interface Piece {
  id: string;
  type: string;
  color: Color;
  hasMoved?: boolean;
}

export type Board = Array<Array<Piece | null>>; // board[y][x], y=0..11, x=0..7

export interface ProvocationTarget {
  pieceId: string;
  targetSquare: Coord;
  expirationTurn: number;
}

export interface GracePeriodPiece {
  pieceId: string;
  expirationTurn: number;
}

export interface CastlingRights {
  white: { kingSide: boolean; queenSide: boolean };
  black: { kingSide: boolean; queenSide: boolean };
}

export interface EngineState {
  board: Board;
  activeColor: Color;
  turnCounter: number;
  ply: number;
  enPassantTarget: Coord | null;
  castlingRights: CastlingRights;
  offsidePieceIds: string[];
  provocationTargets: ProvocationTarget[];
  gracePeriodPieces: GracePeriodPiece[];
  moveHistory: EngineState[];
  gameStatus: GameStatus;
}

export interface GodPayload {
  matchId: string;
  status?: 'IN_PROGRESS' | 'WHITE_WINS' | 'BLACK_WINS' | 'DRAW' | 'TIMEOUT';
  activeColor: Color;
  board: Board;
  clocks?: {
    whiteMs: number;
    blackMs: number;
    lastTimestamp: number;
  };
  uiState: {
    offsidePieceIds: string[];
    provocationTargets: Array<{ square: Coord; threatenedBy: string }>;
    validMoves: { [pieceId: string]: Coord[] };
    drawOfferedBy?: Color | null;
  };
  moveHistory?: EngineState[];
}
