import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { getMatch, createMatch, joinMatch, submitMove, offerDraw, acceptDraw, resign, enqueueMatchTask, getMatchStatePayload } from './matchManager';
import { EVENTS, type CreateMatchPayload, type JoinMatchPayload, type SubmitMovePayload } from './protocol';

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

function broadcastMatchState(matchId: string): void {
  const match = getMatch(matchId);
  if (!match) return;
  io.to(matchId).emit(EVENTS.MATCH_STATE, getMatchStatePayload(match));
}

function emitError(socket: import('socket.io').Socket, message: string): void {
  socket.emit(EVENTS.ERROR, { message });
}

io.on('connection', socket => {
  socket.on(EVENTS.CREATE_MATCH, async (payload: CreateMatchPayload = {}) => {
    const match = createMatch(payload.timeControlMs);
    const seated = joinMatch(match.matchId, socket.id);
    socket.join(match.matchId);
    socket.data.matchId = match.matchId;
    socket.data.color = seated.color;
    broadcastMatchState(match.matchId);
  });

  socket.on(EVENTS.JOIN_MATCH, async (payload: JoinMatchPayload) => {
    try {
      const seated = joinMatch(payload.matchId, socket.id);
      const { match } = seated;
      socket.join(match.matchId);
      socket.data.matchId = match.matchId;
      socket.data.color = seated.color;
      broadcastMatchState(match.matchId);
    } catch (error) {
      emitError(socket, (error as Error).message);
    }
  });

  socket.on(EVENTS.SUBMIT_MOVE, async (payload: SubmitMovePayload) => {
    try {
      await enqueueMatchTask(payload.matchId, () => {
        submitMove(payload.matchId, socket.id, payload.from, payload.to);
        broadcastMatchState(payload.matchId);
      });
    } catch (error) {
      emitError(socket, (error as Error).message);
      broadcastMatchState(payload.matchId);
    }
  });

  socket.on(EVENTS.OFFER_DRAW, async ({ matchId }: { matchId: string }) => {
    try {
      offerDraw(matchId, socket.id);
      broadcastMatchState(matchId);
    } catch (error) {
      emitError(socket, (error as Error).message);
    }
  });

  socket.on(EVENTS.ACCEPT_DRAW, async ({ matchId }: { matchId: string }) => {
    try {
      acceptDraw(matchId, socket.id);
      broadcastMatchState(matchId);
    } catch (error) {
      emitError(socket, (error as Error).message);
    }
  });

  socket.on(EVENTS.RESIGN, async ({ matchId }: { matchId: string }) => {
    try {
      resign(matchId, socket.id);
      broadcastMatchState(matchId);
    } catch (error) {
      emitError(socket, (error as Error).message);
    }
  });

  socket.on('disconnect', () => {
    const matchId = socket.data.matchId as string | undefined;
    if (!matchId) return;
    const match = getMatch(matchId);
    if (!match) return;
    if (match.clients.white === socket.id) match.clients.white = null;
    if (match.clients.black === socket.id) match.clients.black = null;
  });
});

const port = Number(process.env.PORT ?? 3000);
httpServer.listen(port, () => {
  console.log(`Socket.io server listening on ${port}`);
});
