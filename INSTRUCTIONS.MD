# INSTRUCTIONS.MD — AI Agent Orchestration Roadmap

This document serves as the high-level master instruction set for an autonomous development agent. It defines the project's workspace topology, implementation dependencies, chronological milestones, and state-integration points. 

Do not write code or logic directly from this file; refer to the respective sub-specifications linked in the workspace directory map.

---

## 1. Workspace Directory Map & File Dependencies

The agent must treat the following files as the absolute, immutable source of truth for their respective domain boundaries:

* **`/docs/game.md`**: Defines core rules, $12 \times 8$ board geography, the offside calculation algorithm, provocation rules, and pawn promotion grace periods.
* **`/docs/localMultiplayer.md`**: Defines client-side state schema, IndexedDB/localStorage serialization, board flipping logic, and the local undo stack.
* **`/docs/onlineMultiplayer.md`**: Defines the server-side in-memory map, the WebSocket messaging protocol, the timestamp-delta clock system, and the structure of the authoritative "God Payload".
* **`/docs/ui.md`**: Defines the screen views (Home/Lobby vs. Arena), the layout constraints, and the CSS visual mapping states for the "Bark" and "Bite" states.

---

## 2. Chronological Implementation Phases

The agent must execute development linearly through these 4 phases. Do not advance to a subsequent phase until all validation criteria of the current phase are satisfied.

### Phase 1: Headless Core Game Engine
* **Objective:** Build a pure, headless JavaScript/TypeScript simulation engine running entirely in isolation.
* **Primary Source:** `/docs/game.md`
* **Execution Steps:**
    1. Initialize the $12 \times 8$ matrix grid with pieces configured exactly to the coordinates in Section 1.3 of `game.md`.
    2. Implement the mathematical matrix translations for standard pieces stretched across 12 ranks.
    3. Write the global `isOffside` calculation loop, integrating the check overrides for `gracePeriodPieces`.
    4. Implement move validation arrays that filter out captures for any piece flagged `isOffside == true`, unless it matches an entry in `provocationTargets`.
* **Validation Gate:** Write unit tests demonstrating that an offside Queen cannot capture a stationary piece, but immediately gains capture permission if an enemy piece moves directly into its threat field.

### Phase 2: Local Multiplayer & View Layer
* **Objective:** Build the frontend client interface, attach it to the headless engine from Phase 1, and enable offline pass-and-play functionality.
* **Primary Sources:** `/docs/localMultiplayer.md` and `/docs/ui.md`
* **Execution Steps:**
    1. Render the HTML5 Canvas or CSS Grid representing the board layout mapped out in `ui.md`.
    2. Bind the UI to state-driven properties: dim pieces found in `offsidePieceIds` (opacity 0.5) and add pulsing red borders to squares found in `provocationTargets`.
    3. Implement the client-side clock loop (`setInterval` ticking down the active color's remaining time).
    4. Implement the turn-completion hook: switch the active color, save the current state snapshot to `localStorage` under `local_session`, and rotate the board wrapper element $180^\circ$ (while counter-rotating the piece elements).
    5. Implement the `Undo Move` button, which pops the last state snapshot from `moveHistory` and re-hydrates the active local engine.
* **Validation Gate:** Confirm via browser testing that refreshing the page mid-game perfectly preserves the board orientation, pieces, provocation markers, and exact remaining clock milliseconds.

### Phase 3: Server Architecture & WebSocket Protocol
* **Objective:** Implement the headless server environment to host remote matches without databases or persistent authorization.
* **Primary Source:** `/docs/onlineMultiplayer.md`
* **Execution Steps:**
    1. Spin up a WebSocket server (e.g., using `ws` or `socket.io` in Node.js/TypeScript).
    2. Instantiate the global in-memory match container: `const activeMatches = new Map<string, MatchState>();`.
    3. Implement the lobby creation and join protocols using 6-digit random numerical strings as keys.
    4. Migrate the Phase 1 Headless Core Game Engine to run natively inside the server instance.
    5. Implement the Server-Side Clock Algorithm (calculating elapsed delta timestamps upon receiving a `SUBMIT_MOVE` event).
* **Validation Gate:** Ensure that if a client sends an illegal move execution payload via WebSockets, the server engine catches the validation failure, rejects the move, and does not alter the match state map.

### Phase 4: Full Online Client Integration
* **Objective:** Modify the frontend client to run in a "dumb client" configuration when an online lobby is joined.
* **Primary Sources:** `/docs/onlineMultiplayer.md` and `/docs/ui.md`
* **Execution Steps:**
    1. Implement a client network manager that completely bypasses local move generation when a 6-digit game ID is active.
    2. Map all UI click interactions to emit a uniform `SUBMIT_MOVE` payload to the server.
    3. Set up a global WebSocket listener on the client that intercepts the server's incoming `MATCH_STATE` broadcast (the "God Payload").
    4. Bind the client renderer directly to the properties inside the God Payload: parse `uiState.validMoves` to show placement dots, parse `uiState.offsidePieceIds` to dim assets, and redraw the grid instantly.
    5. Implement the network disconnection overlay; if the socket drops, display a reconnect window that auto-emits `JOIN_MATCH` using the cached 6-digit code upon re-establishing a socket connection.
* **Validation Gate:** Simulate a match between two separate browser windows using a single 6-digit room code. Confirm that moves made in Window A update Window B instantly, and that neither window performs any internal chess calculation.

---

## 3. State Interlocking & Resolution Protocol

When compiling the runtime state, the agent must ensure that local variables map seamlessly into the server's structural outputs. The client UI must consume state attributes with strict functional uniformity, regardless of whether the game data was pulled from local storage or received via a WebSocket broadcast:

[State Engine Framework]
│
├─► Local Mode  ──► Reads JSON from Browser Storage -> Hydrates Local View
└─► Online Mode ──► Receives "God Payload" via WS   -> Overwrites Local View
│
▼
┌────────────────────────┐
│  Unified UI Renderer   │
├────────────────────────┤
│ • Check validMoves map │
│ • Pulse provocations   │
│ • Dim offside pieces   │
└────────────────────────┘