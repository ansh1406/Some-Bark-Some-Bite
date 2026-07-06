import {
  Board,
  CastlingRights,
  Color,
  Coord,
  EngineState,
  GracePeriodPiece,
  GodPayload,
  Piece,
  ProvocationTarget
} from './types';
import { cloneBoard, sampleSetup } from './board';

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

type MoveKind = 'move' | 'capture' | 'en-passant' | 'castle';

interface MoveOption {
  from: Coord;
  to: Coord;
  piece: Piece;
  kind: MoveKind;
}

const BOARD_WIDTH = 8;
const BOARD_HEIGHT = 12;

export function newGame(): EngineState {
  const state: EngineState = {
    board: sampleSetup(),
    activeColor: 'White',
    turnCounter: 1,
    ply: 0,
    enPassantTarget: null,
    castlingRights: defaultCastlingRights(),
    offsidePieceIds: [],
    provocationTargets: [],
    gracePeriodPieces: [],
    moveHistory: [],
    gameStatus: 'IN_PROGRESS'
  };

  state.offsidePieceIds = calculateOffsidePieceIds(state);
  return state;
}

export function defaultCastlingRights(): CastlingRights {
  return {
    white: { kingSide: true, queenSide: true },
    black: { kingSide: true, queenSide: true }
  };
}

export function inBounds([x, y]: Coord): boolean {
  return x >= 0 && x < BOARD_WIDTH && y >= 0 && y < BOARD_HEIGHT;
}

export function oppositeColor(color: Color): Color {
  return color === 'White' ? 'Black' : 'White';
}

export function getPiece(board: Board, coord: Coord): Piece | null {
  const [x, y] = coord;
  if (!inBounds(coord)) return null;
  return board[y][x];
}

export function setPiece(board: Board, coord: Coord, piece: Piece | null): void {
  const [x, y] = coord;
  board[y][x] = piece;
}

function coordKey([x, y]: Coord): string {
  return `${x},${y}`;
}

function cloneState(state: EngineState): EngineState {
  return {
    ...state,
    board: cloneBoard(state.board),
    enPassantTarget: state.enPassantTarget ? [...state.enPassantTarget] as Coord : null,
    castlingRights: JSON.parse(JSON.stringify(state.castlingRights)) as CastlingRights,
    offsidePieceIds: [...state.offsidePieceIds],
    provocationTargets: state.provocationTargets.map(target => ({ ...target, targetSquare: [...target.targetSquare] as Coord })),
    gracePeriodPieces: state.gracePeriodPieces.map(piece => ({ ...piece })),
    moveHistory: [],
    gameStatus: state.gameStatus
  };
}

/**
 * Find the King's coordinate for the given color
 */
function getKingCoordinate(state: EngineState, color: Color): Coord | null {
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      const piece = state.board[y][x];
      if (piece && piece.type === 'King' && piece.color === color) {
        return [x, y];
      }
    }
  }
  return null;
}

/**
 * Check if a King of the given color is currently in check
 */
export function isKingInCheck(state: EngineState, color: Color): boolean {
  const kingCoord = getKingCoordinate(state, color);
  if (!kingCoord) return false;

  const enemyColor = oppositeColor(color);
  const threatMap = getThreatMap(state.board, enemyColor, state);

  return threatMap.some(threat => coordKey(threat.square) === coordKey(kingCoord));
}

/**
 * Simulate a move and check if it would leave the moving player's King in check
 */
function wouldMoveLeaveKingInCheck(state: EngineState, move: MoveOption): boolean {
  const testState = cloneState(state);
  executeMove(testState, move);

  // After the move, check if the moving player's king would be in check
  return isKingInCheck(testState, move.piece.color);
}

/**
 * Detect if the current position is checkmate
 */
export function isCheckmate(state: EngineState): boolean {
  const legalMoves = generateLegalMovesWithoutCheckFilter(state);
  return isKingInCheck(state, state.activeColor) && legalMoves.length === 0;
}

/**
 * Detect if the current position is stalemate
 */
export function isStalemate(state: EngineState): boolean {
  const legalMoves = generateLegalMovesWithoutCheckFilter(state);
  return !isKingInCheck(state, state.activeColor) && legalMoves.length === 0;
}

export function validateMove(state: EngineState, from: Coord, to: Coord): boolean {
  return generateLegalMoves(state).some(move => coordKey(move.from) === coordKey(from) && coordKey(move.to) === coordKey(to));
}

export function applyMove(state: EngineState, from: Coord, to: Coord): EngineState {
  const legalMove = generateLegalMoves(state).find(move => coordKey(move.from) === coordKey(from) && coordKey(move.to) === coordKey(to));
  if (!legalMove) {
    throw new Error('Invalid move');
  }

  const next = cloneState(state);
  next.moveHistory = [...state.moveHistory, cloneState(state)];

  executeMove(next, legalMove);
  processTurnPipeline(next, legalMove);
  return next;
}

/**
 * Generate moves without filtering for check (used internally for check detection)
 */
function generateLegalMovesWithoutCheckFilter(state: EngineState): MoveOption[] {
  const offsideSet = new Set(state.offsidePieceIds);
  const provocationMap = buildProvocationMap(state.provocationTargets);
  const moves: MoveOption[] = [];

  forEachPiece(state.board, (piece, from) => {
    if (piece.color !== state.activeColor) return;
    const threats = generateThreatSquares(state.board, from, piece, state);
    const legalTargets = generatePieceTargets(state.board, from, piece, state);
    const provokedSquare = provocationMap.get(piece.id);

    for (const target of legalTargets) {
      const targetPiece = getPiece(state.board, target);
      const isCapture = !!targetPiece && targetPiece.color !== piece.color;
      const isEnPassant = piece.type === 'Pawn' && state.enPassantTarget !== null && coordKey(target) === coordKey(state.enPassantTarget) && !targetPiece;
      const isCastle = piece.type === 'King' && Math.abs(target[0] - from[0]) === 2;

      if (!validateGeometry(piece, from, target, state.board, state)) continue;
      if (!validatePath(piece, from, target, state.board, state)) continue;

      if (isCapture || isEnPassant) {
        const allowedProvokedCapture = provokedSquare !== undefined && coordKey(provokedSquare) === coordKey(target) && targetPiece !== null && targetPiece.color !== piece.color;
        if (offsideSet.has(piece.id) && !allowedProvokedCapture && !isKingCaptureException(state, piece, target)) {
          continue;
        }
      }

      if (isCastle && !canCastle(state, from, target)) {
        continue;
      }

      const kind: MoveKind = isCastle ? 'castle' : isEnPassant ? 'en-passant' : isCapture ? 'capture' : 'move';
      moves.push({ from, to: target, piece, kind });
    }

    // offside pieces can still move to empty squares within geometry
    if (offsideSet.has(piece.id)) {
      for (const target of threats) {
        if (!getPiece(state.board, target) && validateGeometry(piece, from, target, state.board, state) && validatePath(piece, from, target, state.board, state)) {
          moves.push({ from, to: target, piece, kind: 'move' });
        }
      }
    }
  });

  return dedupeMoves(moves);
}

/**
 * Generate legal moves, filtering out any moves that would leave the player's King in check
 */
export function generateLegalMoves(state: EngineState): MoveOption[] {
  const allMoves = generateLegalMovesWithoutCheckFilter(state);

  // Filter out moves that would leave our King in check
  return allMoves.filter(move => !wouldMoveLeaveKingInCheck(state, move));
}

export function buildGodPayload(matchId: string, state: EngineState): GodPayload {
  const validMoves = new Map<string, Coord[]>();
  for (const move of generateLegalMoves(state)) {
    const existing = validMoves.get(move.piece.id) ?? [];
    existing.push(move.to);
    validMoves.set(move.piece.id, existing);
  }

  return {
    matchId,
    activeColor: state.activeColor,
    board: state.board,
    uiState: {
      offsidePieceIds: [...state.offsidePieceIds],
      provocationTargets: state.provocationTargets.map(target => ({
        square: [...target.targetSquare] as Coord,
        threatenedBy: target.pieceId
      })),
      validMoves: Object.fromEntries(validMoves.entries()),
      drawOfferedBy: null
    }
    ,
    moveHistory: [...state.moveHistory]
  };
}

function processTurnPipeline(state: EngineState, move: MoveOption): void {
  const movedPiece = getPiece(state.board, move.to);
  if (movedPiece && movedPiece.type === 'Pawn') {
    handlePromotion(state, move.to, movedPiece);
  }

  evaluateProvocations(state, move);
  cleanupExpiredState(state);
  state.offsidePieceIds = calculateOffsidePieceIds(state);
  state.activeColor = oppositeColor(state.activeColor);
  if (state.activeColor === 'White') {
    state.turnCounter += 1;
  }
  state.ply += 1;

  // Update game status after the turn
  updateGameStatus(state);
}

/**
 * Update game status based on current board state
 */
function updateGameStatus(state: EngineState): void {
  if (isCheckmate(state)) {
    state.gameStatus = 'CHECKMATE';
  } else if (isStalemate(state)) {
    state.gameStatus = 'STALEMATE';
  } else if (isKingInCheck(state, state.activeColor)) {
    state.gameStatus = 'CHECK';
  } else {
    state.gameStatus = 'IN_PROGRESS';
  }
}

function executeMove(state: EngineState, move: MoveOption): void {
  const piece = getPiece(state.board, move.from);
  if (!piece) throw new Error('Missing moving piece');

  if (move.kind === 'castle') {
    executeCastle(state, move.from, move.to, piece);
    return;
  }

  if (move.kind === 'en-passant') {
    executeEnPassant(state, move.from, move.to, piece);
    return;
  }

  setPiece(state.board, move.from, null);
  setPiece(state.board, move.to, { ...piece, hasMoved: true });
  updateEnPassantTarget(state, move.from, move.to, piece);
  markCastlingRights(state, move.from, piece);
}

function executeCastle(state: EngineState, from: Coord, to: Coord, piece: Piece): void {
  const [fromX, fromY] = from;
  const [toX] = to;
  const rookFrom: Coord = toX > fromX ? [7, fromY] : [0, fromY];
  const rookTo: Coord = toX > fromX ? [5, fromY] : [3, fromY];
  const rook = getPiece(state.board, rookFrom);
  if (!rook) throw new Error('Missing rook for castling');
  setPiece(state.board, from, null);
  setPiece(state.board, rookFrom, null);
  setPiece(state.board, to, { ...piece, hasMoved: true });
  setPiece(state.board, rookTo, { ...rook, hasMoved: true });
  state.enPassantTarget = null;
  markCastlingRights(state, from, piece);
}

function executeEnPassant(state: EngineState, from: Coord, to: Coord, piece: Piece): void {
  const direction = piece.color === 'White' ? -1 : 1;
  const capturedCoord: Coord = [to[0], to[1] + direction];
  setPiece(state.board, from, null);
  setPiece(state.board, capturedCoord, null);
  setPiece(state.board, to, { ...piece, hasMoved: true });
  state.enPassantTarget = null;
  markCastlingRights(state, from, piece);
}

function handlePromotion(state: EngineState, coord: Coord, piece: Piece): void {
  const [_, y] = coord;
  const promoteWhite = piece.color === 'White' && y === 11;
  const promoteBlack = piece.color === 'Black' && y === 0;
  if (!promoteWhite && !promoteBlack) return;

  const promotedPiece: Piece = {
    id: makeId(`promo-${piece.color.toLowerCase()}`),
    type: 'Queen',
    color: piece.color,
    hasMoved: true
  };
  setPiece(state.board, coord, promotedPiece);
  state.gracePeriodPieces.push({ pieceId: promotedPiece.id, expirationTurn: state.turnCounter + 1 });
}

function evaluateProvocations(state: EngineState, move: MoveOption): void {
  const targetPiece = getPiece(state.board, move.to);
  if (!targetPiece) return;

  const movingColor = move.piece.color;
  const enemyColor = oppositeColor(movingColor);
  const enemyThreats = getThreatMap(state.board, enemyColor, state);

  for (const threat of enemyThreats) {
    if (coordKey(threat.square) === coordKey(move.to) && threat.pieceId !== targetPiece.id) {
      state.provocationTargets.push({
        pieceId: threat.pieceId,
        targetSquare: [...move.to] as Coord,
        expirationTurn: state.turnCounter + 1
      });
    }
  }
}

function cleanupExpiredState(state: EngineState): void {
  state.provocationTargets = state.provocationTargets.filter(target => target.expirationTurn > state.turnCounter);
  state.gracePeriodPieces = state.gracePeriodPieces.filter(piece => piece.expirationTurn > state.turnCounter);
}

function calculateOffsidePieceIds(state: EngineState): string[] {
  const ids: string[] = [];
  forEachPiece(state.board, (piece, coord) => {
    if (isOffsidePiece(state, piece, coord)) {
      ids.push(piece.id);
    }
  });
  return ids;
}

function isOffsidePiece(state: EngineState, piece: Piece, coord: Coord): boolean {
  if (state.gracePeriodPieces.some(grace => grace.pieceId === piece.id)) return false;
  const [, y] = coord;
  if (piece.color === 'White' && y <= 5) return false;
  if (piece.color === 'Black' && y >= 6) return false;

  const enemies = getPiecesByColor(state.board, oppositeColor(piece.color));
  if (piece.color === 'White') {
    return !enemies.some(enemy => {
      const enemyCoord = getPieceCoordinate(state.board, enemy);
      return enemyCoord !== null && enemyCoord[1] >= y;
    });
  }
  return !enemies.some(enemy => {
    const enemyCoord = getPieceCoordinate(state.board, enemy);
    return enemyCoord !== null && enemyCoord[1] <= y;
  });
}

export function isKingCaptureException(state: EngineState, piece: Piece, target: Coord): boolean {
  const targetPiece = getPiece(state.board, target);
  return Boolean(targetPiece && targetPiece.type === 'King' && targetPiece.color !== piece.color);
}

function buildProvocationMap(targets: ProvocationTarget[]): Map<string, Coord> {
  const map = new Map<string, Coord>();
  for (const target of targets) {
    map.set(target.pieceId, target.targetSquare);
  }
  return map;
}

function forEachPiece(board: Board, callback: (piece: Piece, coord: Coord) => void): void {
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      const piece = board[y][x];
      if (piece) callback(piece, [x, y]);
    }
  }
}

function getPiecesByColor(board: Board, color: Color): Piece[] {
  const pieces: Piece[] = [];
  forEachPiece(board, piece => {
    if (piece.color === color) pieces.push(piece);
  });
  return pieces;
}

function getPieceCoordinate(board: Board, piece: Piece): Coord | null {
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      if (board[y][x]?.id === piece.id) return [x, y];
    }
  }
  return null;
}

function dedupeMoves(moves: MoveOption[]): MoveOption[] {
  const seen = new Set<string>();
  const deduped: MoveOption[] = [];
  for (const move of moves) {
    const key = `${move.piece.id}:${coordKey(move.from)}:${coordKey(move.to)}:${move.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(move);
  }
  return deduped;
}

function validateGeometry(piece: Piece, from: Coord, to: Coord, board: Board, state: EngineState): boolean {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  switch (piece.type) {
    case 'King':
      return Math.max(absDx, absDy) <= 1 || (absDy === 0 && absDx === 2);
    case 'Queen':
      return absDx === absDy || dx === 0 || dy === 0;
    case 'Rook':
      return dx === 0 || dy === 0;
    case 'Bishop':
      return absDx === absDy;
    case 'Knight':
      return (absDx === 1 && absDy === 2) || (absDx === 2 && absDy === 1);
    case 'Pawn': {
      const forward = piece.color === 'White' ? 1 : -1;
      const startRank = piece.color === 'White' ? 3 : 8;
      return (
        (dx === 0 && dy === forward) ||
        (dx === 0 && dy === forward * 2 && from[1] === startRank) ||
        (absDx === 1 && dy === forward)
      );
    }
    default:
      return false;
  }
}

function validatePath(piece: Piece, from: Coord, to: Coord, board: Board, state: EngineState): boolean {
  const targetPiece = getPiece(board, to);
  if (piece.type === 'Pawn') {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const forward = piece.color === 'White' ? 1 : -1;
    if (dx === 0) {
      if (targetPiece) return false;
      if (Math.abs(dy) === 2) {
        const intermediate: Coord = [from[0], from[1] + forward];
        return !getPiece(board, intermediate);
      }
      return true;
    }

    if (Math.abs(dx) === 1 && dy === forward) {
      if (targetPiece) return targetPiece.color !== piece.color;
      return state.enPassantTarget !== null && coordKey(state.enPassantTarget) === coordKey(to);
    }
    return false;
  }

  if (piece.type === 'Knight' || piece.type === 'King') {
    return targetPiece ? targetPiece.color !== piece.color : true;
  }

  if (targetPiece && targetPiece.color === piece.color) return false;
  return isPathClear(board, from, to);
}

function isPathClear(board: Board, from: Coord, to: Coord): boolean {
  const dx = Math.sign(to[0] - from[0]);
  const dy = Math.sign(to[1] - from[1]);
  let x = from[0] + dx;
  let y = from[1] + dy;
  while (x !== to[0] || y !== to[1]) {
    if (getPiece(board, [x, y])) return false;
    x += dx;
    y += dy;
  }
  return true;
}

function generatePieceTargets(board: Board, from: Coord, piece: Piece, state: EngineState): Coord[] {
  const targets: Coord[] = [];
  const directions: Coord[] = [];
  const [x, y] = from;

  if (piece.type === 'King') {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const target: Coord = [x + dx, y + dy];
        if (inBounds(target)) targets.push(target);
      }
    }
    if (canCastle(state, from, [x + 2, y])) targets.push([x + 2, y]);
    if (canCastle(state, from, [x - 2, y])) targets.push([x - 2, y]);
    return targets;
  }

  if (piece.type === 'Knight') {
    const jumps: Coord[] = [
      [1, 2], [2, 1], [2, -1], [1, -2],
      [-1, -2], [-2, -1], [-2, 1], [-1, 2]
    ];
    for (const [dx, dy] of jumps) {
      const target: Coord = [x + dx, y + dy];
      if (inBounds(target)) targets.push(target);
    }
    return targets;
  }

  if (piece.type === 'Pawn') {
    const forward = piece.color === 'White' ? 1 : -1;
    const startRank = piece.color === 'White' ? 3 : 8;
    const one: Coord = [x, y + forward];
    if (inBounds(one)) targets.push(one);
    const two: Coord = [x, y + forward * 2];
    if (y === startRank && inBounds(two)) targets.push(two);
    const captures: Coord[] = [[x - 1, y + forward], [x + 1, y + forward]];
    for (const target of captures) if (inBounds(target)) targets.push(target);
    return targets;
  }

  if (piece.type === 'Bishop' || piece.type === 'Rook' || piece.type === 'Queen') {
    if (piece.type === 'Bishop' || piece.type === 'Queen') {
      directions.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
    }
    if (piece.type === 'Rook' || piece.type === 'Queen') {
      directions.push([1, 0], [-1, 0], [0, 1], [0, -1]);
    }

    for (const [dx, dy] of directions) {
      let cx = x + dx;
      let cy = y + dy;
      while (inBounds([cx, cy] as Coord)) {
        targets.push([cx, cy] as Coord);
        if (getPiece(board, [cx, cy] as Coord)) break;
        cx += dx;
        cy += dy;
      }
    }
  }

  return targets;
}

function generateThreatSquares(board: Board, from: Coord, piece: Piece, state: EngineState): Coord[] {
  if (piece.type === 'Pawn') {
    const forward = piece.color === 'White' ? 1 : -1;
    return [[from[0] - 1, from[1] + forward], [from[0] + 1, from[1] + forward]]
      .filter(square => inBounds(square as Coord)) as Coord[];
  }
  return generatePieceTargets(board, from, piece, state);
}

function getThreatMap(board: Board, color: Color, state: EngineState): Array<{ pieceId: string; square: Coord }> {
  const threats: Array<{ pieceId: string; square: Coord }> = [];
  forEachPiece(board, (piece, from) => {
    if (piece.color !== color) return;
    for (const square of generateThreatSquares(board, from, piece, state)) {
      threats.push({ pieceId: piece.id, square });
    }
  });
  return threats;
}

function canCastle(state: EngineState, from: Coord, to: Coord): boolean {
  const piece = getPiece(state.board, from);
  if (!piece || piece.type !== 'King' || piece.hasMoved) return false;
  const color = piece.color;
  const row = color === 'White' ? 2 : 9;
  if (from[1] !== row || to[1] !== row || Math.abs(to[0] - from[0]) !== 2) return false;
  const rights = state.castlingRights[color.toLowerCase() as 'white' | 'black'];
  const kingSide = to[0] > from[0];
  if (kingSide && !rights.kingSide) return false;
  if (!kingSide && !rights.queenSide) return false;
  const rookFrom: Coord = kingSide ? [7, row] : [0, row];
  const rook = getPiece(state.board, rookFrom);
  if (!rook || rook.type !== 'Rook' || rook.color !== color || rook.hasMoved) return false;
  const step = kingSide ? 1 : -1;
  for (let x = from[0] + step; x !== rookFrom[0]; x += step) {
    if (getPiece(state.board, [x, row])) return false;
  }
  const enemyThreats = new Set(getThreatMap(state.board, oppositeColor(color), state).map(threat => coordKey(threat.square)));
  const passSquares: Coord[] = [from, [from[0] + step, row], to];
  return passSquares.every(square => !enemyThreats.has(coordKey(square)));
}

function markCastlingRights(state: EngineState, from: Coord, piece: Piece): void {
  if (piece.type === 'King') {
    if (piece.color === 'White') {
      state.castlingRights.white.kingSide = false;
      state.castlingRights.white.queenSide = false;
    } else {
      state.castlingRights.black.kingSide = false;
      state.castlingRights.black.queenSide = false;
    }
  }

  if (piece.type === 'Rook') {
    if (piece.color === 'White' && from[1] === 2) {
      if (from[0] === 0) state.castlingRights.white.queenSide = false;
      if (from[0] === 7) state.castlingRights.white.kingSide = false;
    }
    if (piece.color === 'Black' && from[1] === 9) {
      if (from[0] === 0) state.castlingRights.black.queenSide = false;
      if (from[0] === 7) state.castlingRights.black.kingSide = false;
    }
  }
}

function updateEnPassantTarget(state: EngineState, from: Coord, to: Coord, piece: Piece): void {
  if (piece.type !== 'Pawn') {
    state.enPassantTarget = null;
    return;
  }

  const dy = to[1] - from[1];
  if (Math.abs(dy) === 2) {
    const skipped: Coord = [from[0], from[1] + dy / 2];
    state.enPassantTarget = skipped;
  } else {
    state.enPassantTarget = null;
  }
}

export function isOffsidePieceAt(state: EngineState, coord: Coord): boolean {
  const piece = getPiece(state.board, coord);
  if (!piece) return false;
  return isOffsidePiece(state, piece, coord);
}
