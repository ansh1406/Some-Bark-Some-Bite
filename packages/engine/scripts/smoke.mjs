import assert from 'node:assert/strict';
import engine from '../dist/index.js';

const {
  applyMove,
  generateLegalMoves,
  newGame,
  validateMove
} = engine;

const state = newGame();

assert.equal(state.board[2][0]?.type, 'Rook');
assert.equal(state.board[3][0]?.type, 'Pawn');
assert.equal(state.board[8][0]?.type, 'Pawn');
assert.equal(state.board[9][4]?.type, 'King');

assert.equal(validateMove(state, [0, 3], [0, 5]), true);
assert.ok(generateLegalMoves(state).some(move => move.from[0] === 0 && move.from[1] === 3 && move.to[0] === 0 && move.to[1] === 5));

const next = applyMove(state, [0, 3], [0, 5]);
assert.equal(next.activeColor, 'Black');
assert.equal(next.board[5][0]?.type, 'Pawn');
assert.equal(next.board[3][0], null);

console.log('engine smoke test passed');
