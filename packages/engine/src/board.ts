import { Board, Piece } from './types';

function makeId(prefix: string, x: number, y: number): string {
  return `${prefix}-${x}-${y}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function initEmptyBoard(): Board {
  const rows = 12;
  const cols = 8;
  const board: Board = [];
  for (let y = 0; y < rows; y++) {
    const row: Array<Piece | null> = [];
    for (let x = 0; x < cols; x++) {
      row.push(null);
    }
    board.push(row);
  }
  return board;
}

export function sampleSetup(): Board {
  const board = initEmptyBoard();
  const whiteBackRank = ['Rook', 'Knight', 'Bishop', 'Queen', 'King', 'Bishop', 'Knight', 'Rook'];
  const blackBackRank = ['Rook', 'Knight', 'Bishop', 'Queen', 'King', 'Bishop', 'Knight', 'Rook'];

  for (let x = 0; x < 8; x++) {
    board[2][x] = { id: makeId('white-major', x, 2), type: whiteBackRank[x], color: 'White', hasMoved: false };
    board[3][x] = { id: makeId('white-pawn', x, 3), type: 'Pawn', color: 'White', hasMoved: false };
    board[8][x] = { id: makeId('black-pawn', x, 8), type: 'Pawn', color: 'Black', hasMoved: false };
    board[9][x] = { id: makeId('black-major', x, 9), type: blackBackRank[x], color: 'Black', hasMoved: false };
  }
  return board;
}

export function cloneBoard(board: Board): Board {
  return board.map(row => row.map(cell => (cell ? { ...cell } : null)));
}
