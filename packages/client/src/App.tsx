import { useEffect, useMemo, useRef, useState } from 'react';
import { applyMove, generateLegalMoves, type Board, type Color, type Coord, type EngineState, type Piece } from '@sbsb/engine';
import { io, type Socket } from 'socket.io-client';
import { EVENTS, type MatchStatePayload } from './protocol';
import { clearLocalSession, createLocalSession, loadLocalSession, saveLocalSession, type LocalSession } from './storage';

type Screen = 'home' | 'local' | 'online';
type OnlineRole = 'White' | 'Black' | null;

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

const LOCAL_CONTROLS = [
  { label: 'Unlimited', value: null },
  { label: '5 minutes', value: 5 * 60 * 1000 },
  { label: '10 minutes', value: 10 * 60 * 1000 }
];

const ONLINE_CONTROLS = [
  { label: '5 minutes', value: 5 * 60 * 1000 },
  { label: '10 minutes', value: 10 * 60 * 1000 },
  { label: '15 minutes', value: 15 * 60 * 1000 }
];

const PIECES: Record<Color, Record<string, string>> = {
  White: { King: '♔', Queen: '♕', Rook: '♖', Bishop: '♗', Knight: '♘', Pawn: '♙' },
  Black: { King: '♚', Queen: '♛', Rook: '♜', Bishop: '♝', Knight: '♞', Pawn: '♟' }
};

function formatClock(value: number | null | undefined): string {
  if (value === null || value === undefined) return '∞';
  const safe = Math.max(0, Math.floor(value));
  const minutes = Math.floor(safe / 60000).toString().padStart(2, '0');
  const seconds = Math.floor((safe % 60000) / 1000).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function getOnlineClockValues(state: MatchStatePayload | null, now: number): { white: number | null; black: number | null } {
  if (!state) {
    return { white: null, black: null };
  }

  if (state.status !== 'IN_PROGRESS') {
    return { white: state.clocks.whiteMs, black: state.clocks.blackMs };
  }

  const elapsed = Math.max(0, now - state.clocks.lastTimestamp);
  if (state.activeColor === 'White') {
    return {
      white: Math.max(0, state.clocks.whiteMs - elapsed),
      black: state.clocks.blackMs
    };
  }

  return {
    white: state.clocks.whiteMs,
    black: Math.max(0, state.clocks.blackMs - elapsed)
  };
}

function coordKey([x, y]: Coord): string {
  return `${x},${y}`;
}

function pieceLabel(piece: Piece | null): string {
  if (!piece) return '';
  return PIECES[piece.color][piece.type] ?? piece.type[0];
}

function opponent(color: Color): Color {
  return color === 'White' ? 'Black' : 'White';
}

function getVisibleLocalGame(session: LocalSession): EngineState {
  if (session.reviewIndex >= session.game.moveHistory.length) return session.game;
  return session.game.moveHistory[session.reviewIndex];
}

function isAtLatestState(session: LocalSession): boolean {
  return session.reviewIndex >= session.game.moveHistory.length;
}

function buildMoveMap(state: EngineState): Record<string, Coord[]> {
  const grouped = new Map<string, Coord[]>();
  for (const move of generateLegalMoves(state)) {
    const current = grouped.get(move.piece.id) ?? [];
    current.push(move.to);
    grouped.set(move.piece.id, current);
  }
  return Object.fromEntries(grouped.entries());
}

function getSquarePiece(board: Board, coord: Coord): Piece | null {
  return board[coord[1]]?.[coord[0]] ?? null;
}

function isOffside(state: { offsidePieceIds: string[] }, piece: Piece | null): boolean {
  return Boolean(piece && state.offsidePieceIds.includes(piece.id));
}

function GameBoard({
  board,
  activeColor,
  offsidePieceIds,
  provocationTargets,
  moveMap,
  selected,
  interactive,
  onSquareClick
}: {
  board: Board;
  activeColor: Color;
  offsidePieceIds: string[];
  provocationTargets: Array<{ square: Coord; threatenedBy: string }>;
  moveMap: Record<string, Coord[]>;
  selected: Coord | null;
  interactive: boolean;
  onSquareClick: (coord: Coord) => void;
}): JSX.Element {
  const selectedPiece = selected ? getSquarePiece(board, selected) : null;
  const selectedMoves = selectedPiece ? moveMap[selectedPiece.id] ?? [] : [];
  const selectedMoveKeys = new Set(selectedMoves.map(coordKey));
  const provocationKeys = new Set(provocationTargets.map(target => coordKey(target.square)));
  const rows = Array.from({ length: 12 }, (_, index) => 11 - index);
  const cols = Array.from({ length: 8 }, (_, index) => index);

  return (
    <div className="board-shell">
      <div className="board" role="grid" aria-label="Game board">
        {rows.map(y =>
          cols.map(x => {
            const square = [x, y] as Coord;
            const piece = getSquarePiece(board, square);
            const squareKey = coordKey(square);
            const target = selectedMoveKeys.has(squareKey);
            const selectedSquare = selected ? coordKey(selected) === squareKey : false;
            const provoked = provocationKeys.has(squareKey);
            const offside = isOffside({ offsidePieceIds }, piece);
            const isCaptureTarget = target && Boolean(piece);

            return (
              <button
                key={squareKey}
                type="button"
                className={[
                  'square',
                  (x + y) % 2 === 0 ? 'light' : 'dark',
                  selectedSquare ? 'selected' : '',
                  target ? 'target' : '',
                  provoked ? 'provoked' : '',
                  offside ? 'offside' : ''
                ].join(' ')}
                onClick={() => {
                  if (interactive) onSquareClick(square);
                }}
                aria-label={`Square ${x + 1}, ${y + 1}`}
              >
                {target && !piece ? <span className="move-dot" /> : null}
                {isCaptureTarget ? <span className="capture-ring" /> : null}
                {piece ? <span className={`piece piece-${piece.color.toLowerCase()}`}>{pieceLabel(piece)}</span> : null}
                {isCaptureTarget ? <span className="capture-glow" /> : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function Clock({ label, value, active, danger }: { label: string; value: number | null; active: boolean; danger: boolean }): JSX.Element {
  return (
    <div className={`clock ${active ? 'active' : ''} ${danger ? 'danger' : ''}`}>
      <span className="clock-label">{label}</span>
      <span className="clock-value">{formatClock(value)}</span>
    </div>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case 'IN_PROGRESS':
      return 'In progress';
    case 'WHITE_WINS':
      return 'White wins';
    case 'BLACK_WINS':
      return 'Black wins';
    case 'DRAW':
      return 'Draw';
    case 'TIMEOUT':
      return 'Timeout';
    default:
      return status;
  }
}

function winnerText(status: string): string {
  if (status === 'WHITE_WINS') return 'White wins';
  if (status === 'BLACK_WINS') return 'Black wins';
  if (status === 'DRAW') return 'Draw';
  if (status === 'TIMEOUT') return 'Timeout';
  return 'In progress';
}

export default function App(): JSX.Element {
  const [localSession, setLocalSession] = useState<LocalSession | null>(() => loadLocalSession());
  const [screen, setScreen] = useState<Screen>(() => (loadLocalSession() ? 'local' : 'home'));
  const [localTimeControl, setLocalTimeControl] = useState<number | null>(5 * 60 * 1000);
  const [onlineTimeControl, setOnlineTimeControl] = useState<number>(5 * 60 * 1000);
  const [matchInput, setMatchInput] = useState('');
  const [onlineState, setOnlineState] = useState<MatchStatePayload | null>(null);
  const [onlineClockNow, setOnlineClockNow] = useState(() => Date.now());
  const [onlineRole, setOnlineRole] = useState<OnlineRole>(null);
  const [selected, setSelected] = useState<Coord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [socketStatus, setSocketStatus] = useState<'idle' | 'connecting' | 'connected'>('idle');
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (localSession) {
      saveLocalSession(localSession);
    }
  }, [localSession]);

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (screen !== 'online' || !onlineState || onlineState.status !== 'IN_PROGRESS') return;

    setOnlineClockNow(Date.now());
    const timer = window.setInterval(() => {
      setOnlineClockNow(Date.now());
    }, 100);

    return () => window.clearInterval(timer);
  }, [screen, onlineState?.matchId, onlineState?.status, onlineState?.clocks.lastTimestamp, onlineState?.clocks.whiteMs, onlineState?.clocks.blackMs]);

  useEffect(() => {
    if (screen !== 'local' || !localSession || localSession.status !== 'IN_PROGRESS') return;

    const timer = window.setInterval(() => {
      setLocalSession(current => {
        if (!current || current.status !== 'IN_PROGRESS') return current;

        const now = Date.now();
        const elapsed = now - current.clocks.lastTick;
        const activeKey = current.game.activeColor === 'White' ? 'whiteRemainingMs' : 'blackRemainingMs';
        const currentValue = current.clocks[activeKey];
        const nextValue = currentValue === null ? null : Math.max(0, currentValue - elapsed);
        const nextStatus = nextValue !== null && nextValue <= 0 ? (current.game.activeColor === 'White' ? 'BLACK_WINS' : 'WHITE_WINS') : current.status;
        const nextSession: LocalSession = {
          ...current,
          clocks: {
            ...current.clocks,
            [activeKey]: nextValue,
            lastTick: now
          },
          status: nextStatus,
          reviewIndex: current.game.moveHistory.length
        };

        saveLocalSession(nextSession);
        return nextSession;
      });
    }, 100);

    return () => window.clearInterval(timer);
  }, [screen, localSession?.status]);

  const localGame = useMemo(() => (localSession ? getVisibleLocalGame(localSession) : null), [localSession]);
  const localMoveMap = useMemo(() => (localGame ? buildMoveMap(localGame) : {}), [localGame]);
  const localInteractive = Boolean(localSession && localSession.status === 'IN_PROGRESS' && isAtLatestState(localSession));

  const onlineGame = onlineState;
  const onlineMoveMap = onlineState?.uiState.validMoves ?? {};
  const onlineInteractive = Boolean(onlineState && onlineState.status === 'IN_PROGRESS');
  const onlineClocks = useMemo(() => getOnlineClockValues(onlineState, onlineClockNow), [onlineState, onlineClockNow]);

  function connectSocket(): Socket {
    if (socketRef.current) return socketRef.current;

    const socket = io(BACKEND_URL, { autoConnect: true, transports: ['websocket'] });
    socketRef.current = socket;
    setSocketStatus('connecting');

    socket.on('connect', () => setSocketStatus('connected'));
    socket.on(EVENTS.ERROR, ({ message }: { message: string }) => setError(message));
    socket.on(EVENTS.MATCH_STATE, (payload: MatchStatePayload) => {
      setOnlineState(payload);
      setError(null);
      setSocketStatus('connected');
      setScreen('online');
    });
    socket.on('disconnect', () => setSocketStatus('idle'));

    return socket;
  }

  function startLocalGame(): void {
    const session = createLocalSession(localTimeControl);
    clearLocalSession();
    saveLocalSession(session);
    setLocalSession(session);
    setScreen('local');
    setSelected(null);
    setError(null);
  }

  function resumeLocalGame(): void {
    if (!localSession) return;
    setScreen('local');
    setSelected(null);
  }

  function createOnlineMatch(): void {
    const socket = connectSocket();
    setOnlineRole('White');
    setOnlineState(null);
    setError(null);
    setScreen('online');
    socket.emit(EVENTS.CREATE_MATCH, { timeControlMs: onlineTimeControl });
  }

  function joinOnlineMatch(): void {
    const matchId = matchInput.trim();
    if (matchId.length !== 6) {
      setError('Enter a 6-digit match id.');
      return;
    }

    const socket = connectSocket();
    setOnlineRole('Black');
    setOnlineState(null);
    setError(null);
    setScreen('online');
    socket.emit(EVENTS.JOIN_MATCH, { matchId });
  }

  function playLocalMove(from: Coord, to: Coord): void {
    if (!localSession || localSession.status !== 'IN_PROGRESS') return;

    try {
      const nextGame = applyMove(localSession.game, from, to);
      const now = Date.now();
      const elapsed = now - localSession.clocks.lastTick;
      const activeKey = localSession.game.activeColor === 'White' ? 'whiteRemainingMs' : 'blackRemainingMs';
      const currentValue = localSession.clocks[activeKey];
      const nextValue = currentValue === null ? null : Math.max(0, currentValue - elapsed);
      const nextStatus = nextValue !== null && nextValue <= 0 ? (localSession.game.activeColor === 'White' ? 'BLACK_WINS' : 'WHITE_WINS') : localSession.status;
      const nextSession: LocalSession = {
        ...localSession,
        game: nextGame,
        clocks: {
          ...localSession.clocks,
          [activeKey]: nextValue,
          lastTick: now
        },
        status: nextStatus,
        reviewIndex: nextGame.moveHistory.length
      };

      setLocalSession(nextSession);
      setSelected(null);
      saveLocalSession(nextSession);
    } catch (exception) {
      setError((exception as Error).message);
    }
  }

  function submitOnlineMove(from: Coord, to: Coord): void {
    if (!onlineState) return;
    connectSocket().emit(EVENTS.SUBMIT_MOVE, { matchId: onlineState.matchId, from, to });
    setSelected(null);
  }

  function handleSelection(board: Board, activeColor: Color, moveMap: Record<string, Coord[]>, coord: Coord, submit: (from: Coord, to: Coord) => void): void {
    const clickedPiece = getSquarePiece(board, coord);

    if (selected) {
      if (coordKey(selected) === coordKey(coord)) {
        setSelected(null);
        return;
      }

      const selectedPiece = getSquarePiece(board, selected);
      if (selectedPiece && selectedPiece.color === activeColor) {
        const legalTargets = moveMap[selectedPiece.id] ?? [];
        if (legalTargets.some(target => coordKey(target) === coordKey(coord))) {
          submit(selected, coord);
          return;
        }
      }
    }

    if (clickedPiece && clickedPiece.color === activeColor) {
      setSelected(coord);
      return;
    }

    setSelected(null);
  }

  function undoLocalMove(): void {
    if (!localSession || localSession.status !== 'IN_PROGRESS' || localSession.game.moveHistory.length === 0) return;

    const previous = localSession.game.moveHistory[localSession.game.moveHistory.length - 1];
    const nextSession: LocalSession = {
      ...localSession,
      game: previous,
      reviewIndex: previous.moveHistory.length,
      clocks: {
        ...localSession.clocks,
        lastTick: Date.now()
      }
    };

    setLocalSession(nextSession);
    setSelected(null);
    saveLocalSession(nextSession);
  }

  function exitToMenu(): void {
    setSelected(null);
    setError(null);
    if (screen === 'local') {
      clearLocalSession();
      setLocalSession(null);
    }
    setScreen('home');
  }

  function showHelp(): void {
    const popup = document.getElementById('messagePopup');
    if (popup) {
      popup.style.display = 'block';
    }
  }
  function closeHelpPopup(): void {
    const popup = document.getElementById('messagePopup');
    if (popup) {
      popup.style.display = 'none';
    }
  }

  const activeColor = screen === 'local' ? localGame?.activeColor ?? 'White' : onlineGame?.activeColor ?? 'White';
  const currentBoard = screen === 'local' ? localGame?.board ?? null : onlineGame?.board ?? null;
  const currentMoveMap = screen === 'local' ? localMoveMap : onlineMoveMap;
  const currentOffside = screen === 'local' ? localGame?.offsidePieceIds ?? [] : onlineGame?.uiState.offsidePieceIds ?? [];
  const currentProvocations = screen === 'local' ? localGame?.provocationTargets.map(target => ({ square: target.targetSquare, threatenedBy: target.pieceId })) ?? [] : onlineGame?.uiState.provocationTargets ?? [];
  const currentStatus = screen === 'local' ? localSession?.status ?? 'IN_PROGRESS' : onlineGame?.status ?? 'IN_PROGRESS';
  const whiteClock = screen === 'local' ? localSession?.clocks.whiteRemainingMs ?? null : onlineGame?.clocks.whiteMs ?? null;
  const blackClock = screen === 'local' ? localSession?.clocks.blackRemainingMs ?? null : onlineGame?.clocks.blackMs ?? null;
  const drawOfferedBy = screen === 'online' ? onlineGame?.uiState.drawOfferedBy ?? null : null;
  const reviewMode = Boolean(screen === 'local' && localSession && localSession.status !== 'IN_PROGRESS');
  const renderedWhiteClock = screen === 'local' ? whiteClock : onlineClocks.white;
  const renderedBlackClock = screen === 'local' ? blackClock : onlineClocks.black;

  return (
    <div className="app-shell">
      <div id="messagePopup" className="floating-popup">
        <button id="closePopupBtn" className="close-btn" onClick={closeHelpPopup}>&times;</button>
        <h2>How to Play "Some Bark, Some Bite"</h2>

<p>Welcome to a chess variant where spatial control meets the offside trap. All standard rules of chess apply (how pieces move, check/checkmate, castling, en passant), but with a massive twist to the board and how capturing works. </p>

<h3>1. The Expanded Board</h3>

<p> <b>The Grid:</b> The board is standard width (8 squares) but heavily stretched vertically (12 squares).<br></br><br></br>
 <b>Starting Positions:</b> White's army starts on Ranks 3 and 4. Black's army starts on Ranks 9 and 10.<br></br><br></br>
 <b>The Safe Zones:</b> This setup leaves 4 empty rows in the middle of the board for battle, and 2 empty rows *behind* each player's starting army.</p>

<h3>2. The "Offside" Rule</h3>

<p>The board is divided perfectly in half (Ranks 1–6 belong to White; Ranks 7–12 belong to Black). You can never be offside in your own half.</p>

<p>If you push a piece into enemy territory, it becomes <b>Offside</b> if:<br></br>

 There are no enemy pieces on its current row.<br></br> 
 AND there are no enemy pieces <u>behind</u> it (deeper into the opponent's territory).<br></br>
 Note: The enemy King counts as a defender! If the enemy King is on his back row, your attacking pieces are kept safely onside.</p>

<h3>3. All Bark, No Bite (Offside Restrictions)</h3>

<p>When a piece is offside, it becomes a "ghost" regarding captures, but a physical wall regarding threats.</p>

<p><b>The Bark:</b> Offside pieces move normally. They still control the squares they look at. They can put the King in check, deliver checkmate, and pin enemy pieces.</p>
<p><b>The No-Bite:</b> An offside piece <b>cannot capture</b> any enemy piece. You can look at them, but you cannot touch them.</p>

<h3>4. The Provocation Rule (When offside pieces CAN bite)</h3>

<p>You cannot use an offside piece to hunt down stationary enemies. However, if your opponent makes a mistake, your offside piece will bite back.</p>

<p> If your opponent deliberately moves one of their pieces onto a square controlled by your offside piece, you are allowed to capture that specific piece on your <b>immediate next turn</b>.</p>
<p> If you choose not to capture it right away, the window closes, and your piece goes back to being strictly offside.</p>

<h3>5. Pawn Promotion & The Grace Period</h3>

<p><b>The Journey:</b> Pawns promote just like normal, but they must march all the way to the absolute furthest edge of the 12-rank board. You are fully allowed to march an offside pawn forward to promote.</p>
<p><b>The Grace Period:</b> Because promoting takes so much effort, a newly promoted piece (like a Queen) is granted a "Grace Period." For one full turn cycle, the new piece is completely immune to the offside rules. It can capture freely anywhere on the board before the offside trap finally catches up to it. </p>
      </div>
      <header className="topbar">
        <div>
          <h1>Some Bark , Some Bite</h1>
        </div>
        <div className="status-pill"> <span className='help' onClick={showHelp}>!</span></div>
      </header>

      {screen === 'home' ? (
        <main className="home-grid">
          <section className="panel card">
            <h2>Local Play</h2>
            <label className="field">
              <select value={localTimeControl ?? 'unlimited'} onChange={event => setLocalTimeControl(event.target.value === 'unlimited' ? null : Number(event.target.value))}>
                {LOCAL_CONTROLS.map(option => (
                  <option key={option.label} value={option.value ?? 'unlimited'}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" onClick={startLocalGame}>Start Local Game</button>
            {localSession ? <button onClick={resumeLocalGame}>Resume Local Game</button> : null}
          </section>

          <section className="panel card">
            <h2>Host Online</h2>
            <label className="field">
              <select value={onlineTimeControl} onChange={event => setOnlineTimeControl(Number(event.target.value))}>
                {ONLINE_CONTROLS.map(option => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" onClick={createOnlineMatch}>Create Lobby</button>
          </section>

          <section className="panel card">
            <h2>Join Online</h2>
            <label className="field">
              <input value={matchInput} onChange={event => setMatchInput(event.target.value)} placeholder="000000" maxLength={6} inputMode="numeric" />
            </label>
            <button className="primary" onClick={joinOnlineMatch}>Join Game</button>
          </section>
        </main>
      ) : (
        <main className="game-layout">
          <section className="arena">
            <div className="clock-stack">
              <Clock label="Black" value={renderedBlackClock} active={activeColor === 'Black'} danger={Boolean(renderedBlackClock !== null && renderedBlackClock < 30000)} />
            </div>

            {currentBoard ? (
              <GameBoard
                board={currentBoard}
                activeColor={activeColor}
                offsidePieceIds={currentOffside}
                provocationTargets={currentProvocations}
                moveMap={currentMoveMap}
                selected={selected}
                interactive={screen === 'local' ? localInteractive : onlineInteractive}
                onSquareClick={coord => {
                  if (screen === 'local' && localGame) {
                    handleSelection(localGame.board, localGame.activeColor, localMoveMap, coord, playLocalMove);
                  }
                  if (screen === 'online' && onlineGame) {
                    handleSelection(onlineGame.board, onlineGame.activeColor, onlineMoveMap, coord, submitOnlineMove);
                  }
                }}
              />
            ) : null}

            <div className="clock-stack">
              <Clock label="White" value={renderedWhiteClock} active={activeColor === 'White'} danger={Boolean(renderedWhiteClock !== null && renderedWhiteClock < 30000)} />
            </div>
          </section>

          <aside className="sidebar panel">
            <div className="section-block">
              <p className="helper">{screen === 'local' ? 'Local Match' : `Match ${onlineGame?.matchId ?? 'pending'}`}</p>
              {screen === 'online' && onlineRole ? <p className="helper">Seat: {onlineRole}</p> : null}
            </div>

            <div className="section-block controls">
              <button onClick={undoLocalMove} disabled={screen !== 'local' || !localSession || localSession.status !== 'IN_PROGRESS' || localSession.game.moveHistory.length === 0}>
                {"\u21A9"}
              </button>
              <button onClick={() => onlineGame && connectSocket().emit(EVENTS.OFFER_DRAW, { matchId: onlineGame.matchId })} disabled={screen !== 'online' || !onlineGame || onlineGame.status !== 'IN_PROGRESS'}>
                Offer Draw
              </button>
              <button onClick={() => onlineGame && connectSocket().emit(EVENTS.RESIGN, { matchId: onlineGame.matchId })} disabled={screen !== 'online' || !onlineGame || onlineGame.status !== 'IN_PROGRESS'}>
                Resign
              </button>
              <button onClick={exitToMenu}>Exit to Menu</button>
            </div>

            <div className="section-block">
              <h3>Status</h3>
              <p className="helper">{drawOfferedBy ? `Draw offered by ${drawOfferedBy}` : 'No draw offer pending.'}</p>
              {reviewMode ? <p className="helper">Review mode is active.</p> : null}
              {screen === 'local' && localSession && localSession.status !== 'IN_PROGRESS' ? (
                <p className="helper">{winnerText(localSession.status)}.</p>
              ) : null}
              {error ? <p className="error">{error}</p> : null}
            </div>

            {screen === 'local' && localSession && localSession.status !== 'IN_PROGRESS' ? (
              <div className="section-block controls">
                <button
                  disabled={localSession.reviewIndex <= 0}
                  onClick={() => {
                    const nextIndex = Math.max(0, localSession.reviewIndex - 1);
                    setLocalSession({ ...localSession, reviewIndex: nextIndex });
                    setSelected(null);
                  }}
                >
                  Previous Move
                </button>
                <button
                  disabled={localSession.reviewIndex >= localSession.game.moveHistory.length}
                  onClick={() => {
                    const nextIndex = Math.min(localSession.game.moveHistory.length, localSession.reviewIndex + 1);
                    setLocalSession({ ...localSession, reviewIndex: nextIndex });
                    setSelected(null);
                  }}
                >
                  Next Move
                </button>
              </div>
            ) : null}
          </aside>
        </main>
      )}
    </div>
  );
}
