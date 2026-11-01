// Copied from CelluloseServer's src/protocol.ts. Keep the two in sync.

/** strongest500: most land at generation 500 wins. ctf: a rival's land over your flag knocks you out; last one standing wins. */
export type Mode = "strongest500" | "ctf";

/** Public matchmaking: ranked moves your rating (signed in only); classic is the same game with nothing at stake (guests too). */
export type MatchKind = "classic" | "ranked";

/** setup: the opening placement window; placing: the window every GRANT_EVERY generations; running: the simulation; over: the game has ended. */
export type Phase = "setup" | "placing" | "running" | "over";

/** What a player can ask to do to the board. The server checks it against the true board before applying it. */
export type GameAction =
  | { type: "place"; row: number; col: number }
  | { type: "remove"; row: number; col: number }
  /** Done placing for this phase; the phase ends early once every connected player is ready. */
  | { type: "ready" };

/** Every reply to a request; `reason` says why it was refused. */
export type Result<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

/** `id` is public (find yourself in the lobby with it); `token` is secret (it proves it's you on a rejoin). */
export type JoinReply = Result<{ roomId: string; id: string; seat: number; token: string }>;

/** `seat` is the board seat while a game runs, otherwise the place in the join order. */
export type LobbyMember = { id: string; seat: number; name: string; color: number; connected: boolean; host: boolean };

export type LobbyState = {
  roomId: string;
  status: "lobby" | "playing";
  mode: Mode;
  /** friends: made by a host, joined by code. classic/ranked: made by matchmaking, with no host, no bots, and nobody else can join. */
  kind: "friends" | MatchKind;
  members: LobbyMember[];
  /** Bots that will fill the remaining seats when the game starts. */
  bots: number;
  maxPlayers: number;
};

export type PlayerState = {
  seat: number;
  name: string;
  color: number;
  isBot: boolean;
  connected: boolean;
  ready: boolean;
  resources: number;
  land: number;
  alive: number;
  /** ctf only: the generation this player's flag was taken, or null while it stands. */
  capturedAt: number | null;
};

export type GameState = {
  roomId: string;
  /** Increases with every broadcast, so clients can drop stale or out-of-order states. */
  version: number;
  mode: Mode;
  tiles: number;
  generation: number;
  finalGeneration: number;
  phase: Phase;
  /** ms left in a setup/placing phase; 0 otherwise. */
  phaseLeftMs: number;
  /** tiles * tiles characters, row by row: "." for a dead tile, otherwise the seat number ("0".."3") of its live cell. */
  cells: string;
  /** Same layout: whose territory each tile is in. */
  territory: string;
  /** ctf only: each seat's flag tile. */
  flags: { seat: number; row: number; col: number }[];
  players: PlayerState[];
  /** Once the game is over: seats from first to last. Ties share a place. */
  standings?: { seat: number; land: number; place: number }[];
};

/**
 * What changed since the broadcast numbered `base`. Apply it only to the state whose version is exactly `base`;
 * after a gap, ask for a full state with game:sync. Phase changes and the end of the game always come as a
 * full game:state, so a delta never carries flags or standings.
 */
export type GameDelta = {
  roomId: string;
  version: number;
  base: number;
  generation: number;
  phase: Phase;
  phaseLeftMs: number;
  /**
   * The changed tiles, 3 base64url digits each (A-Z a-z 0-9 - _ are 0..63): two for the tile index
   * (high * 64 + low), then one for (owner + 1) + 5 * (territory + 1), where -1 means none.
   */
  changes: string;
  /** Only when something other than land or live cells changed for a player. Land and live cells follow from the board. */
  players?: PlayerState[];
};

const DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * The state after `delta`, or null if it doesn't follow on from `state` (a broadcast was missed; ask for
 * game:sync). Land and live cells are recounted from the board, since deltas don't carry them.
 */
export function applyDelta(state: GameState, delta: GameDelta): GameState | null {
  if (delta.roomId !== state.roomId || delta.base !== state.version) return null;
  const cells = state.cells.split("");
  const territory = state.territory.split("");
  const { changes } = delta;
  for (let k = 0; k + 2 < changes.length; k += 3) {
    const i = DIGITS.indexOf(changes[k]) * 64 + DIGITS.indexOf(changes[k + 1]);
    const v = DIGITS.indexOf(changes[k + 2]);
    const owner = (v % 5) - 1;
    const land = Math.floor(v / 5) - 1;
    cells[i] = owner < 0 ? "." : String(owner);
    territory[i] = land < 0 ? "." : String(land);
  }
  const players = (delta.players ?? state.players).map((p) => ({ ...p, land: 0, alive: 0 }));
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== ".") players[Number(cells[i])].alive++;
    if (territory[i] !== ".") players[Number(territory[i])].land++;
  }
  return {
    ...state,
    version: delta.version,
    generation: delta.generation,
    phase: delta.phase,
    phaseLeftMs: delta.phaseLeftMs,
    cells: cells.join(""),
    territory: territory.join(""),
    players,
  };
}

export type Session = { accessToken: string; refreshToken: string; /** Unix seconds. */ expiresAt: number };

/** A rank tier, e.g. Species from 0, Genus from 1100. */
export type Tier = { name: string; minRating: number };

export type Profile = {
  username: string;
  rating: Record<Mode, number>;
  games: Record<Mode, number>;
  wins: Record<Mode, number>;
  /** The tier name each rating is in. */
  tier: Record<Mode, string>;
};

export type AuthReply = Result<{ session: Session; profile: Profile; tiers: Tier[] }>;

export type QueueStatus = { kind: MatchKind; mode: Mode; waiting: number; needed: number; /** Unix ms when we joined. */ since: number } | null;

export type RankedResult = {
  mode: Mode;
  results: { seat: number; username: string; place: number; before: number; after: number; tier: string }[];
};

export interface ClientToServerEvents {
  "room:create": (req: { name: string; color?: number; bots?: number; mode?: Mode }, ack: (r: JoinReply) => void) => void;
  "room:join": (req: { roomId: string; name: string; color?: number }, ack: (r: JoinReply) => void) => void;
  /** Take back a seat after a dropped connection, using the token from create/join. */
  "room:rejoin": (req: { roomId: string; token: string }, ack: (r: JoinReply) => void) => void;
  "room:leave": (ack?: (r: Result) => void) => void;
  "lobby:color": (req: { color: number }, ack?: (r: Result) => void) => void;
  /** Host only. */
  "lobby:bots": (req: { bots: number }, ack?: (r: Result) => void) => void;
  /** Host only. */
  "lobby:mode": (req: { mode: Mode }, ack?: (r: Result) => void) => void;
  /** Host only: start a game, or a new one after the last is over. */
  "room:start": (ack?: (r: Result) => void) => void;
  /** Queued and answered on the room's next tick, once validated against the true board. */
  "game:action": (action: GameAction, ack?: (r: Result) => void) => void;
  /** Missed a delta: send a full game:state soon. */
  "game:sync": () => void;

  /** Each of these also signs this connection in, for ranked play. */
  "auth:signup": (req: { username: string; password: string }, ack: (r: AuthReply) => void) => void;
  "auth:login": (req: { username: string; password: string }, ack: (r: AuthReply) => void) => void;
  /** Sign in again with a saved refresh token, e.g. after a page reload. Replies with a fresh session. */
  "auth:resume": (req: { refreshToken: string }, ack: (r: AuthReply) => void) => void;
  "auth:logout": (ack?: (r: Result) => void) => void;
  "auth:profile": (ack: (r: Result<{ profile: Profile }>) => void) => void;

  /**
   * Wait for a match of this kind and mode. Ranked needs a signed-in connection; classic takes anyone, and a
   * guest's `name` is what the others see (a signed-in player is shown by their username).
   */
  "match:queue": (req: { kind: MatchKind; mode: Mode; name?: string }, ack?: (r: Result) => void) => void;
  "match:cancel": (ack?: (r: Result) => void) => void;
}

export interface ServerToClientEvents {
  "room:lobby": (state: LobbyState) => void;
  /** A full snapshot: at the start, on phase changes, after a rejoin or game:sync, and every few seconds. */
  "game:state": (state: GameState) => void;
  /** Most broadcasts: just what changed. */
  "game:delta": (delta: GameDelta) => void;
  /** e.g. a room closed by the server. */
  "room:closed": (info: { reason: string }) => void;
  "match:queue": (status: QueueStatus) => void;
  /** A match was found and you've been seated in it; a game:state follows. */
  "match:found": (seat: { roomId: string; id: string; seat: number; token: string; kind: MatchKind; mode: Mode }) => void;
  /** Rating changes once a ranked game is over. */
  "ranked:result": (result: RankedResult) => void;
}
