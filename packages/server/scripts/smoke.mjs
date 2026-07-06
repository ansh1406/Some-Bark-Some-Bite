import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { createMatch, joinMatch, submitMove, getActiveMatches, getMatchStatePayload } = require('../dist/matchManager.js');

const match = createMatch(120000);
assert.equal(match.matchId.length, 6);

const seatedWhite = joinMatch(match.matchId, 'socket-white');
const seatedBlack = joinMatch(match.matchId, 'socket-black');
assert.equal(seatedWhite.color, 'White');
assert.equal(seatedBlack.color, 'Black');

const before = JSON.stringify(getActiveMatches().get(match.matchId).engineState);
assert.throws(() => submitMove(match.matchId, 'socket-white', [0, 3], [0, 6]));
const after = JSON.stringify(getActiveMatches().get(match.matchId).engineState);
assert.equal(after, before);

const payload = getMatchStatePayload(match);
assert.equal(payload.matchId, match.matchId);
assert.equal(payload.status, 'IN_PROGRESS');
assert.equal(payload.uiState.drawOfferedBy, null);
assert.ok(Array.isArray(payload.moveHistory));

console.log('server smoke test passed');
