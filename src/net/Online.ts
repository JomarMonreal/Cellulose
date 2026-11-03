import * as Phaser from "phaser";
import { io, type Socket } from "socket.io-client";
import type { Mode } from "../modes";
import {
  applyDelta,
  type AuthReply,
  type ChatMessage,
  type ClientToServerEvents,
  type GameAction,
  type GameState,
  type JoinReply,
  type Leaderboard,
  type LobbyState,
  type MatchKind,
  type Profile,
  type QueueStatus,
  type RankedResult,
  type Result,
  type ServerStats,
  type ServerToClientEvents,
  type Tier,
} from "./protocol";
import QueueBanner from "./QueueBanner";

/** Set VITE_SERVER_URL to point at a deployed server; by default it's port 3000 on whatever host served the page. */
export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? `${location.protocol}//${location.hostname}:3000`;
// requests the server hasn't answered by then count as failed
const ACK_TIMEOUT_MS = 5_000;
// the seat to take back after a dropped connection or a page refresh
const SEAT_KEY = "cellulose:seat";
const NAME_KEY = "cellulose:name";
// the refresh token that keeps you signed in across visits
const SESSION_KEY = "cellulose:session";
// a guest's name, kept for this tab only: a new visit asks again whether to sign in
const GUEST_KEY = "cellulose:guest";
// after a missed delta, ask for a full state at most this often (one usually arrives within a few seconds anyway)
const SYNC_EVERY_MS = 1_000;
// still not connected after this long: the host is probably waking up from sleep
const WAKE_HINT_MS = 4_000;
// after the server turns the connection away, try again this much later
const REFUSED_RETRY_MS = 60_000;
// chat lines kept for the room we're in
const CHAT_KEEP = 100;

/** Ping the server as soon as the page loads, so a host that sleeps when idle starts waking before anyone clicks Play. */
export function wakeServer() {
  // no-cors: nothing is read back; the request reaching the server is the point
  fetch(`${SERVER_URL}/health`, { mode: "no-cors", cache: "no-store" }).catch(() => {});
}

type Saved = { roomId: string; id: string; token: string };
type TimedSocket = ReturnType<Socket<ServerToClientEvents, ClientToServerEvents>["timeout"]>;

/**
 * The connection to the Cellulose server, shared by the online scenes (one per page). The server holds the
 * true board; this only sends requests and keeps the latest lobby, game state, sign-in and queue it reported.
 * Events: "status" (connected changed), "lobby", "state", "closed" (the room went away; reason as the argument),
 * "auth" (signed in or out, became or stopped being a guest, the profile changed, or the account signed in elsewhere), "queue" (matchmaking queue status),
 * "ranked" (a ranked game's rating changes), "chat" (a new chat line as the argument, or none when the whole log
 * changed), "stats" (players online and registered).
 */
export default class Online extends Phaser.Events.EventEmitter {
  private static instance?: Online;
  private static game?: Phaser.Game;

  static get(): Online {
    return (this.instance ??= new Online());
  }

  /** The game to switch to a ranked match when one is found, whatever screen it's on. Doesn't connect. */
  static attach(game: Phaser.Game) {
    this.game = game;
  }

  readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  roomId: string | null = null;
  /** Our public member id, to find ourselves in the lobby. */
  id: string | null = null;
  lobby: LobbyState | null = null;
  state: GameState | null = null;
  profile: Profile | null = null;
  /** Playing without an account: this is the name others see. Guests can't play ranked. */
  guest: string | null = sessionStorage.getItem(GUEST_KEY);
  tiers: Tier[] = [];
  queue: QueueStatus = null;
  /** The room's chat, oldest first. */
  chat: ChatMessage[] = [];
  /** Players online and registered, while connected. */
  stats: ServerStats | null = null;
  /** Why we were signed out without asking (the account signed in elsewhere), for the sign-in screen to say once. */
  signedOutBecause: string | null = null;
  // the refresh token this tab saved: tabs share localStorage, so a newer tab's sign-in must not be thrown away here
  private refreshToken: string | null = null;
  private token: string | null = null;
  // a ranked match was found; switch to it once its first state arrives
  private matchPending = false;
  private banner = new QueueBanner(() => void this.cancelQueue());
  // when the current connection attempt began, to tell "connecting" from "waking up"
  private connectingSince = Date.now();
  private wakeHint = 0;
  private lastSync = 0;
  // the server turned the connection away (e.g. too many from this network), and why
  private refusedBecause: string | null = null;

  private constructor() {
    super();
    const saved = load<Saved>(sessionStorage, SEAT_KEY);
    if (saved) [this.roomId, this.id, this.token] = [saved.roomId, saved.id, saved.token];

    this.socket = io(SERVER_URL);
    this.startConnecting();
    // a reconnect (or a refreshed page) signs back in and takes back the seat we had
    this.socket.on("connect", async () => {
      clearTimeout(this.wakeHint);
      this.refusedBecause = null;
      this.emit("status");
      const session = load<{ refreshToken: string }>(localStorage, SESSION_KEY);
      if (session) {
        const r = await this.request<AuthReply>((s) => s.emitWithAck("auth:resume", { refreshToken: session.refreshToken }));
        this.signedIn(r, true);
      }
      if (!this.roomId || !this.token) return;
      const r = await this.request<JoinReply>((s) => s.emitWithAck("room:rejoin", { roomId: this.roomId!, token: this.token! }));
      if (!r.ok) this.forget(r.reason);
    });
    this.socket.on("disconnect", () => {
      // the server drops queued sockets, so we're not waiting any more
      this.setQueue(null);
      this.stats = null;
      this.emit("stats");
      this.startConnecting();
      this.emit("status");
    });
    this.socket.on("connect_error", (err) => {
      // a refusal from the server itself (not a network failure) doesn't retry on its own; say why, and try again later
      if (this.socket.active) this.refusedBecause = null;
      else {
        this.refusedBecause = err.message;
        window.setTimeout(() => this.socket.connect(), REFUSED_RETRY_MS);
      }
      this.emit("status");
    });
    // a room we just left can still have a broadcast or two on the way; ignore those
    this.socket.on("room:lobby", (lobby) => {
      if (lobby.roomId !== this.roomId) return;
      this.lobby = lobby;
      this.emit("lobby", lobby);
    });
    this.socket.on("game:state", (state) => {
      if (state.roomId !== this.roomId) return;
      // states can arrive out of order; only ever move forward
      if (this.state && state.version <= this.state.version) return;
      this.showState(state);
    });
    // most broadcasts are just what changed since the previous one
    this.socket.on("game:delta", (delta) => {
      if (delta.roomId !== this.roomId) return;
      const next = this.state && applyDelta(this.state, delta);
      if (next) return this.showState(next);
      // missed one (or the first full state hasn't come yet): get back in step
      if (this.state && delta.version <= this.state.version) return;
      if (Date.now() - this.lastSync < SYNC_EVERY_MS) return;
      this.lastSync = Date.now();
      this.socket.emit("game:sync");
    });
    this.socket.on("room:closed", ({ reason }) => this.forget(reason));
    this.socket.on("match:queue", (status) => this.setQueue(status));
    this.socket.on("match:found", (m) => {
      this.enter({ ok: true, ...m });
      this.matchPending = true;
      this.banner.matchFound();
    });
    this.socket.on("chat:history", ({ roomId, messages }) => {
      if (roomId !== this.roomId) return;
      this.chat = messages.slice(-CHAT_KEEP);
      this.emit("chat");
    });
    this.socket.on("chat:message", (m) => {
      if (m.roomId !== this.roomId) return;
      this.chat.push(m);
      if (this.chat.length > CHAT_KEEP) this.chat.shift();
      this.emit("chat", m);
    });
    this.socket.on("server:stats", (stats) => {
      this.stats = stats;
      this.emit("stats");
    });
    // one session per account: signing in elsewhere signs this one out
    this.socket.on("auth:kicked", ({ reason }) => {
      this.profile = null;
      if (load<{ refreshToken: string }>(localStorage, SESSION_KEY)?.refreshToken === this.refreshToken) localStorage.removeItem(SESSION_KEY);
      this.refreshToken = null;
      this.signedOutBecause = reason;
      this.setQueue(null);
      this.emit("auth");
    });
    this.socket.on("ranked:result", (result: RankedResult) => {
      this.emit("ranked", result);
      void this.refreshProfile();
    });
  }

  get connected() {
    return this.socket.connected;
  }

  /** What to show while not connected, or null once connected. A host that sleeps when idle can take a minute to wake. */
  get connectionStatus(): string | null {
    if (this.connected) return null;
    if (this.refusedBecause) return `The server turned this connection away: ${this.refusedBecause}. Retrying in a minute.`;
    return Date.now() - this.connectingSince < WAKE_HINT_MS ? "Connecting to the server…" : "Waking up the server… this can take up to a minute.";
  }

  get inRoom() {
    return this.roomId !== null && this.lobby?.roomId === this.roomId;
  }

  /** Us in the lobby's member list. */
  get me() {
    return this.lobby?.members.find((m) => m.id === this.id) ?? null;
  }

  /** Our board seat while a game runs (the lobby reports it once the game starts), otherwise -1. */
  get seat() {
    return this.lobby?.status === "playing" ? (this.me?.seat ?? -1) : -1;
  }

  /** A name entered before, otherwise the account's username or the guest name. */
  get savedName() {
    return localStorage.getItem(NAME_KEY) ?? this.profile?.username ?? this.guest ?? "";
  }

  /** Who's playing: the signed-in username, the guest name, or null before either (the sign-in screen). */
  get player() {
    return this.profile?.username ?? this.guest;
  }

  /** Play without an account, under a made-up name. Everything but ranked is open. */
  playAsGuest() {
    this.guest = `Guest${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
    sessionStorage.setItem(GUEST_KEY, this.guest);
    this.emit("auth");
  }

  /** Stop being a guest, e.g. to sign in. */
  leaveGuest() {
    if (this.queue) void this.cancelQueue();
    this.guest = null;
    sessionStorage.removeItem(GUEST_KEY);
    this.emit("auth");
  }

  /** A sign-in from an earlier visit is saved; it's resumed once the socket connects. */
  get hasSession() {
    return localStorage.getItem(SESSION_KEY) !== null;
  }

  async create(name: string, color: number, bots: number): Promise<Result> {
    localStorage.setItem(NAME_KEY, name);
    return this.enter(await this.request<JoinReply>((s) => s.emitWithAck("room:create", { name, color, bots })));
  }

  async join(roomId: string, name: string, color: number): Promise<Result> {
    localStorage.setItem(NAME_KEY, name);
    return this.enter(await this.request<JoinReply>((s) => s.emitWithAck("room:join", { roomId, name, color })));
  }

  /** We're out as soon as we ask; the server's answer doesn't change that. */
  leave() {
    const r = this.request((s) => s.emitWithAck("room:leave"));
    this.forget();
    return r;
  }

  setColor(color: number) {
    return this.request((s) => s.emitWithAck("lobby:color", { color }));
  }

  setBots(bots: number) {
    return this.request((s) => s.emitWithAck("lobby:bots", { bots }));
  }

  setMode(mode: Mode) {
    return this.request((s) => s.emitWithAck("lobby:mode", { mode }));
  }

  start() {
    return this.request((s) => s.emitWithAck("room:start"));
  }

  /** Ask the server to place, remove or ready up. The board only changes once the server broadcasts it. */
  act(action: GameAction) {
    return this.request((s) => s.emitWithAck("game:action", action));
  }

  /** A mode's ranked leaderboard, with where we stand when signed in. */
  leaderboard(mode: Mode) {
    return this.request<Result<{ leaderboard: Leaderboard }>>((s) => s.emitWithAck("ranked:leaderboard", { mode }));
  }

  /** Say something to the room. It shows once the server sends it back to everyone. */
  sendChat(text: string) {
    return this.request((s) => s.emitWithAck("chat:send", { text }));
  }

  async signup(username: string, password: string): Promise<Result> {
    return this.signedIn(await this.request<AuthReply>((s) => s.emitWithAck("auth:signup", { username, password })));
  }

  async login(username: string, password: string): Promise<Result> {
    return this.signedIn(await this.request<AuthReply>((s) => s.emitWithAck("auth:login", { username, password })));
  }

  async logout() {
    const r = await this.request((s) => s.emitWithAck("auth:logout"));
    this.profile = null;
    this.refreshToken = null;
    localStorage.removeItem(SESSION_KEY);
    this.setQueue(null);
    this.emit("auth");
    return r;
  }

  /** Sign out on every device, this one too; every saved sign-in stops working. */
  async logoutAll() {
    const r = await this.request((s) => s.emitWithAck("auth:logoutAll"));
    if (!r.ok) return r;
    this.profile = null;
    this.refreshToken = null;
    localStorage.removeItem(SESSION_KEY);
    this.setQueue(null);
    this.emit("auth");
    return r;
  }

  /** Change the password. Every other device is signed out; this one stays signed in, with a fresh session. */
  async changePassword(current: string, next: string): Promise<Result> {
    return this.signedIn(await this.request<AuthReply>((s) => s.emitWithAck("auth:password", { current, next })));
  }

  async refreshProfile() {
    const r = await this.request<Result<{ profile: Profile }>>((s) => s.emitWithAck("auth:profile"));
    if (!r.ok) return;
    this.profile = r.profile;
    this.emit("auth");
  }

  /**
   * Wait for a ranked or classic match in `mode`. Play anything meanwhile: the game switches to the match when
   * it's found. Ranked needs a sign-in; a guest goes into classic under their guest name.
   */
  findMatch(kind: MatchKind, mode: Mode) {
    const name = this.profile ? undefined : (this.guest ?? undefined);
    return this.request((s) => s.emitWithAck("match:queue", { kind, mode, name }));
  }

  async cancelQueue() {
    const r = await this.request((s) => s.emitWithAck("match:cancel"));
    this.setQueue(null);
    return r;
  }

  /** Keep a successful sign-in; a failed resume just means the saved session is no good any more. */
  private signedIn(r: AuthReply, resuming = false): Result {
    if (r.ok) {
      [this.profile, this.tiers] = [r.profile, r.tiers];
      this.refreshToken = r.session.refreshToken;
      this.signedOutBecause = null;
      localStorage.setItem(SESSION_KEY, JSON.stringify({ refreshToken: r.session.refreshToken }));
      // a guest who signs in isn't a guest any more
      this.guest = null;
      sessionStorage.removeItem(GUEST_KEY);
      this.emit("auth");
    } else if (resuming) {
      localStorage.removeItem(SESSION_KEY);
      this.emit("auth");
    }
    return r;
  }

  private setQueue(status: QueueStatus) {
    this.queue = status;
    this.banner.show(status);
    this.emit("queue", status);
  }

  private showState(state: GameState) {
    this.state = state;
    if (this.matchPending) {
      this.matchPending = false;
      this.openMatch();
    }
    this.emit("state", state);
  }

  /** A connection attempt starts; if it's still going after WAKE_HINT_MS, tell the scenes so they can say why. */
  private startConnecting() {
    this.connectingSince = Date.now();
    clearTimeout(this.wakeHint);
    this.wakeHint = window.setTimeout(() => !this.connected && this.emit("status"), WAKE_HINT_MS);
  }

  /** Leave whatever's on screen, even a solo game played while waiting, for the ranked match. */
  private openMatch() {
    this.banner.show(null);
    const scenes = Online.game?.scene;
    if (!scenes) return;
    for (const s of scenes.getScenes(true)) if (s.scene.key !== "GameScene") s.scene.stop();
    scenes.start("GameScene", { online: true });
  }

  private enter(r: JoinReply): Result {
    if (!r.ok) return r;
    [this.roomId, this.id, this.token] = [r.roomId, r.id, r.token];
    this.state = null;
    this.chat = [];
    sessionStorage.setItem(SEAT_KEY, JSON.stringify({ roomId: r.roomId, id: r.id, token: r.token } satisfies Saved));
    return r;
  }

  /** Drop everything about the room we were in; with a reason, tell the scenes it was taken from us. */
  private forget(reason?: string) {
    [this.roomId, this.id, this.token, this.lobby, this.state] = [null, null, null, null, null];
    this.chat = [];
    sessionStorage.removeItem(SEAT_KEY);
    // a match that went away before it opened
    if (this.matchPending) {
      this.matchPending = false;
      this.banner.show(null);
    }
    this.emit("lobby", null);
    if (reason) this.emit("closed", reason);
  }

  private async request<R = Result>(send: (s: TimedSocket) => Promise<R>): Promise<R | { ok: false; reason: string }> {
    try {
      return await send(this.socket.timeout(ACK_TIMEOUT_MS));
    } catch {
      return { ok: false, reason: this.connected ? "the server didn't answer" : "can't reach the server" };
    }
  }
}

function load<T>(storage: Storage, key: string): T | null {
  try {
    return JSON.parse(storage.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
}
