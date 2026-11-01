import * as Phaser from "phaser";
import Ai from "../Ai";
import Board, { CLAIM_RADIUS } from "../Board";
import type Cell from "../Cell";
import { type Mode, modeName } from "../modes";
import Online from "../net/Online";
import type { GameAction, GameState, LobbyState, RankedResult } from "../net/protocol";
import Player, { PALETTE } from "../Player";
import {
  BTN_H,
  type Button,
  displayFont,
  fontFamily,
  keepWheel,
  layoutButton,
  makeButton,
  PANEL_COLOR,
  PRIMARY,
  SECONDARY,
  setButtonDepth,
  setButtonLoading,
  showFocus,
} from "../ui";

const PAD = 24;
// the exported pace, zoom, pan and frame settings are shared with PlaygroundScene, so its board feels the same
export const GENERATION_MS = 120;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 10;
// zoom factor per wheel pixel; one mouse notch (~100px) is about 10%
export const ZOOM_SPEED = 0.001;
// zoom factor per click of the sidebar's - / + buttons
export const ZOOM_STEP = 1.25;
// pixels the pointer must move before a press becomes a pan instead of a click
export const DRAG_THRESHOLD = 4;
export const FRAME_COLOR = 0xfff2a1;
export const FRAME_WIDTH = 10;
// empty space outside the frame, visible at the starting zoom and when panned to an edge
const MARGIN = 10;
// distance from the view's edge to the board at the starting zoom
export const INSET = FRAME_WIDTH + MARGIN;

const START_RESOURCES = 10;
// each round every player gets ROUND_RESOURCES cells, plus floor(cbrt(territory gained since last round))
const ROUND_RESOURCES = 5;
// each player starts with a START_TERRITORY x START_TERRITORY corner
const START_TERRITORY = 7;
// capture the flag: each flag sits in the middle of its owner's starting corner
const FLAG_OFFSET = Math.floor(START_TERRITORY / 2);
const FLAG_OUTLINE = 0x120e22;
const FLAG_TILE_COLOR = 0xf8f5ff;
// a flag is drawn this many tiles tall, its pole standing on its own tile
const FLAG_SIZE = 2.5;
// generations between placement phases (and resource grants)
const GRANT_EVERY = 50;
// the game ends after this generation, per mode; the player with the most land wins (capture the flag runs longer)
export const FINAL_GENERATION: Record<Mode, number> = { strongest500: 500, ctf: 1000 };
const SETUP_MS = 30_000;
const PLACE_MS = 30_000;
// an AI places one cell every AI_PLACE_MIN_MS..AI_PLACE_MAX_MS during a placement phase
const AI_PLACE_MIN_MS = 150;
const AI_PLACE_MAX_MS = 500;
// corners clockwise from the human's top-left: one opponent sits across the board, two take the corners beside you
const AI_CORNERS: Record<number, number[]> = { 1: [2], 2: [1, 3], 3: [1, 2, 3] };
const PLAYER_ROW_H = 40;
const PLAYER_SWATCH = 24;
// the square Rules and Quit buttons in the sidebar's top corner
const ICON_BTN = 40;
const ICON_GAP = 8;
// the results panel draws over everything else
const RESULTS_DEPTH = 10;
// how long a notice (a refused request, a click that can't place) replaces the phase text
export const NOTICE_MS = 2_000;
// the placement timer turns red for its last few seconds
const URGENT_SECS = 5;
// the rules overlay opens by itself on your first game, then only when asked
const RULES_SEEN_KEY = "cellulose:seenRules";
export const HOVER_PLACE_ALPHA = 0.55;
export const REMOVE_COLOR = 0xff4d5e;

/** setup: the opening placement window; placing: the window every GRANT_EVERY generations; running: the simulation; over: past FINAL_GENERATION. */
type Phase = "setup" | "placing" | "running" | "over";

/** Chosen in the lobby. */
export type GameSettings = {
  /** Index into PALETTE of the human's colour. */
  color: number;
  /** Number of AI opponents, 1 to 3. */
  opponents: number;
  mode: Mode;
};

/** Online games are set up in OnlineLobbyScene; everything else comes from the server. */
export type OnlineSettings = { online: true };

type Results = {
  shade: Phaser.GameObjects.Rectangle;
  panel: Phaser.GameObjects.Rectangle;
  title: Phaser.GameObjects.Text;
  standings: Phaser.GameObjects.Text;
  button: Button;
};

type Rules = {
  shade: Phaser.GameObjects.Rectangle;
  panel: Phaser.GameObjects.Rectangle;
  title: Phaser.GameObjects.Text;
  body: Phaser.GameObjects.Text;
  button: Button;
};

export default class GameScene extends Phaser.Scene {
  constructor() {
    super("GameScene");
  }

  private settings!: GameSettings;
  private board!: Board;
  // Graphics, not Rectangles: a resized Rectangle's stroke keeps its old path
  private graphics!: Phaser.GameObjects.Graphics;
  // border around the board's edges; moves with zoom and pan
  private frame!: Phaser.GameObjects.Graphics;
  // capture the flag markers, drawn over the board
  private flagGraphics!: Phaser.GameObjects.Graphics;
  // what a click on the tile under the mouse would do: place a cell or take one back
  private hoverGraphics!: Phaser.GameObjects.Graphics;
  private mode!: Mode;
  /** Capture the flag: each player's flag tile. Empty in other modes. */
  private flags!: Map<Player, Cell>;
  // a ranked game's rating changes, once the server has recorded them
  private rankedResult?: RankedResult;
  /** Online: what kind of room this game is in, kept so "back" still knows after the room is left. */
  private roomKind!: LobbyState["kind"];

  private sidebar!: Phaser.GameObjects.Rectangle;
  private title!: Phaser.GameObjects.Text;
  // the title's height on one line, to tell how much it grows when it wraps
  private titleLineH!: number;
  private quitButton!: Button;
  // the × drawn over the Quit button
  private quitIcon!: Phaser.GameObjects.Graphics;
  private rulesButton!: Button;
  private generationText!: Phaser.GameObjects.Text;
  private phaseText!: Phaser.GameObjects.Text;
  private playButton!: Button;
  private stopButton!: Button;
  private zoomLabel!: Phaser.GameObjects.Text;
  private zoomOutButton!: Button;
  private zoomInButton!: Button;
  // an HTML input so the zoom percentage can be typed in
  private zoomInput!: Phaser.GameObjects.DOMElement;
  private playerSwatches!: Phaser.GameObjects.Rectangle[];
  private playerTexts!: Phaser.GameObjects.Text[];
  // how many cells each player has left to place, big beside their name
  private playerCounts!: Phaser.GameObjects.Text[];
  private placeLabel!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  // the sidebar is beside the board (wide) or below it, compacted (narrow)
  private wide!: boolean;
  // the how-to-play overlay, while it's open
  private rules?: Rules;
  // the overlay paused an offline game; closing it resumes
  private rulesResume!: boolean;
  // shown once the game is over
  private results?: Results;

  private ticker!: Phaser.Time.TimerEvent;
  private generation!: number;

  private players!: Player[];
  private human!: Player;
  private phase!: Phase;
  // ms left in the current setup/placing phase
  private phaseLeft!: number;
  private paused!: boolean;
  // cells placed this phase; the human can click theirs again to take them back
  private placedThisPhase!: Set<Cell>;
  private ais!: Ai[];
  // ms until each AI's next placement
  private aiCooldowns!: Map<Ai, number>;

  /**
   * Set in an online game. The server then holds the true board: clicks become requests to it, nothing is
   * simulated here, and each state it broadcasts replaces ours.
   */
  private online!: Online | null;
  // our seat on the server's board
  private seat!: number;
  // why the server refused our last request, shown for NOTICE_MS
  private notice!: string;
  private noticeLeft!: number;

  /** Screen area the board is shown in; the board itself may be larger (zoomed) and offset (panned). */
  private view!: Phaser.Geom.Rectangle;
  private zoom!: number;
  // board top-left relative to the view, as a fraction of view size so it survives resizes
  private panX!: number;
  private panY!: number;
  // pressed: the pointer went down on the board; panning: it has since moved far enough to count as a drag
  private pressed!: boolean;
  private panning!: boolean;

  /** Phaser reuses the scene object for every game, so all per-game state starts here rather than in field initializers. */
  init(settings: GameSettings | OnlineSettings) {
    this.online = "online" in settings ? Online.get() : null;
    if (!this.online) this.settings = settings as GameSettings;
    this.mode = this.online ? (this.online.state?.mode ?? "strongest500") : this.settings.mode;
    this.flags = new Map();
    this.rankedResult = undefined;
    this.roomKind = this.online?.lobby?.kind ?? "friends";
    this.seat = this.online?.seat ?? 0;
    this.notice = "";
    this.noticeLeft = 0;
    this.playerSwatches = [];
    this.playerTexts = [];
    this.playerCounts = [];
    this.results = undefined;
    this.rules = undefined;
    this.rulesResume = false;
    this.wide = true;
    this.generation = 0;
    this.players = [];
    this.phase = "setup";
    this.phaseLeft = SETUP_MS;
    this.paused = false;
    this.placedThisPhase = new Set();
    this.ais = [];
    this.aiCooldowns = new Map();
    this.view = new Phaser.Geom.Rectangle();
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.pressed = false;
    this.panning = false;
  }

  create() {
    const font = fontFamily();
    const display = displayFont();
    const state = this.online?.state;
    // nothing to show without the server's state or a seat in it (e.g. the room went away)
    if (this.online && (!state || !state.players[this.seat])) {
      this.scene.start("OnlineLobbyScene");
      return;
    }

    this.graphics = this.add.graphics();
    this.flagGraphics = this.add.graphics();
    this.hoverGraphics = this.add.graphics();
    this.frame = this.add.graphics();
    this.board = new Board(0, 0, 1, state?.tiles ?? 50);
    if (state) this.createOnlinePlayers(state);
    else this.createPlayers();

    this.sidebar = this.add.rectangle(0, 0, 1, 1, PANEL_COLOR).setOrigin(0);
    this.title = this.add.text(0, 0, modeName(this.mode), { fontFamily: display, fontSize: "24px", fontStyle: "bold", color: "#f8f5ff" });
    this.titleLineH = this.title.height;
    this.rulesButton = makeButton(this, "?", SECONDARY, () => this.openRules());
    this.quitButton = makeButton(this, "", SECONDARY, () => this.quit());
    this.quitIcon = this.add.graphics();
    this.generationText = this.add.text(0, 0, "", { fontFamily: font, fontSize: "16px", color: "#d4ccff" });
    this.phaseText = this.add.text(0, 0, "", { fontFamily: font, fontSize: "16px", fontStyle: "bold", color: "#ffe03d" });
    this.playButton = makeButton(this, "Play", PRIMARY, () => this.play());
    this.stopButton = makeButton(this, "Stop", SECONDARY, () => this.setPaused(true));

    this.zoomLabel = this.add.text(0, 0, "Zoom", { fontFamily: display, fontSize: "16px", color: "#d4ccff" });
    this.zoomOutButton = makeButton(this, "−", SECONDARY, () => this.zoomAtCenter(this.zoom / ZOOM_STEP));
    this.zoomInButton = makeButton(this, "+", SECONDARY, () => this.zoomAtCenter(this.zoom * ZOOM_STEP));
    this.zoomInput = this.add.dom(0, 0, this.makeZoomInput(font)).setOrigin(0);

    this.placeLabel = this.add.text(0, 0, "To place", { fontFamily: display, fontSize: "16px", color: "#d4ccff" });
    for (const p of this.players) {
      this.playerSwatches.push(this.add.rectangle(0, 0, PLAYER_SWATCH, PLAYER_SWATCH, p.main_color).setOrigin(0, 0.5));
      this.playerTexts.push(this.add.text(0, 0, "", { fontFamily: font, fontSize: "16px", fontStyle: "bold", color: "#f8f5ff" }).setOrigin(0, 0.5));
      this.playerCounts.push(this.add.text(0, 0, "", { fontFamily: display, fontSize: "24px", color: "#f8f5ff" }).setOrigin(1, 0.5));
    }
    const hint = "Click your shaded land to place a cell, or one of yours to take it back. Drag to pan, scroll to zoom.\nSpace: ready · ?: rules";
    this.hint = this.add.text(0, 0, hint, { fontFamily: font, fontSize: "13px", color: "#d4ccff", lineSpacing: 3 });

    // drag pans the board; a click (press and release without dragging) places or takes back a cell
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.pressed = this.phase !== "over" && !this.rules && this.view.contains(p.x, p.y);
      this.panning = false;
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.pressed || !p.isDown) return this.drawHover();
      if (!this.panning && Phaser.Math.Distance.Between(p.downX, p.downY, p.x, p.y) > DRAG_THRESHOLD) {
        this.panning = true;
        this.input.setDefaultCursor("grabbing");
      }
      if (!this.panning) return;
      const inner = this.view.width - INSET * 2;
      this.panX += (p.x - p.prevPosition.x) / inner;
      this.panY += (p.y - p.prevPosition.y) / inner;
      this.applyView();
    });
    const release = (p: Phaser.Input.Pointer, click: boolean) => {
      if (click && this.pressed && !this.panning) {
        const cell = this.board.cellAt(p.x, p.y);
        if (cell) this.humanClick(cell);
      }
      this.pressed = false;
      this.panning = false;
      this.drawHover();
    };
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => release(p, true));
    this.input.on("pointerupoutside", (p: Phaser.Input.Pointer) => release(p, false));
    this.input.on(Phaser.Input.Events.GAME_OUT, () => this.hoverGraphics.clear());

    // scroll to zoom, keeping the point under the cursor fixed
    this.input.on("wheel", (p: Phaser.Input.Pointer, _objs: unknown, _dx: number, dy: number) => {
      if (this.phase === "over" || this.rules || !this.view.contains(p.x, p.y)) return;
      this.zoomAt(this.zoom * Math.exp(-dy * ZOOM_SPEED), p.x, p.y);
    });
    // a game always fits the window, so the page has nothing to scroll: the wheel is all the game's
    keepWheel(this, () => true);

    this.ticker = this.time.addEvent({
      delay: GENERATION_MS,
      loop: true,
      paused: true,
      callback: () => {
        this.board.step();
        this.board.claimTerritory();
        this.generation++;
        if (this.checkFlags() || this.generation >= this.finalGeneration) this.finish();
        else if (this.generation % GRANT_EVERY === 0) {
          this.grantResources();
          this.startPhase("placing", PLACE_MS);
        }
        this.updateGenerationText();
        this.updatePhaseText();
        this.updatePlayerTexts();
        this.redraw();
      },
    });

    this.input.keyboard?.on("keydown", (e: KeyboardEvent) => this.onKey(e));

    if (state) this.applyState(state);
    else this.startPhase("setup", SETUP_MS);
    this.updateGenerationText();
    this.layout(this.scale.gameSize);
    if (!readRulesSeen() && this.phase !== "over") this.openRules();

    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this));

    if (this.online) {
      const online = this.online;
      const onClosed = (reason: string) => this.scene.start(this.lobbyScene, { ...this.lobbyData, error: reason });
      const onRanked = (r: RankedResult) => {
        this.rankedResult = r;
        if (this.results) this.showStandings();
      };
      online.on("state", this.applyState, this).on("status", this.updatePhaseText, this).on("closed", onClosed).on("ranked", onRanked);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
        online.off("state", this.applyState, this).off("status", this.updatePhaseText, this).off("closed", onClosed).off("ranked", onRanked),
      );
    }
  }

  /** The server's players, in seat order; ours is "You". Bots play on the server, so there are no local AIs. */
  private createOnlinePlayers(state: GameState) {
    this.players = state.players.map((p) => new Player(p.seat === this.seat ? "You" : p.name, p.color, p.isBot, p.resources));
    this.human = this.players[this.seat];
    this.ais = [];
    for (const f of state.flags) this.flags.set(this.players[f.seat], this.board.cells[f.row][f.col]);
  }

  /** Where this game's "back" goes: the ranked or classic screen, the friends lobby, or the bots lobby. */
  private get lobbyScene() {
    if (!this.online) return "LobbyScene";
    return this.roomKind === "friends" ? "OnlineLobbyScene" : "RankedScene";
  }

  /** What that screen needs: the bots lobby's settings, or which matchmaking screen to show. */
  private get lobbyData(): object | undefined {
    if (!this.online) return this.settings;
    return this.roomKind === "friends" ? undefined : { kind: this.roomKind };
  }

  /** Make the board and sidebar show a state the server broadcast. */
  private applyState(s: GameState) {
    if (this.phase === "over") {
      // the host started another game while we were on the results screen
      if (s.phase !== "over") this.scene.restart({ online: true });
      return;
    }

    const at = (grid: string, i: number) => (grid[i] === "." ? null : this.players[Number(grid[i])]);
    this.board.cells.forEach((cols, row) =>
      cols.forEach((c, col) => {
        const i = row * s.tiles + col;
        c.owner = at(s.cells, i);
        c.is_alive = c.owner !== null;
        c.territory = at(s.territory, i);
      }),
    );
    for (const p of s.players) {
      this.players[p.seat].resources = p.resources;
      this.players[p.seat].captured_at = p.capturedAt;
    }
    this.generation = s.generation;
    this.phaseLeft = s.phaseLeftMs;
    if (s.phase === "over") this.finish();
    else {
      this.phase = s.phase;
      this.syncTicker();
    }
    this.updateGenerationText();
    this.updatePlayerTexts();
    this.redraw();
  }

  /** Board, then the flags on top. */
  private redraw() {
    this.board.draw(this.graphics, this.view);
    this.drawFlags();
    this.drawHover();
  }

  /** A little pennant on each standing flag's tile, in its owner's colour; captured flags are gone. */
  private drawFlags() {
    const g = this.flagGraphics.clear();
    for (const [p, c] of this.flags) {
      if (p.captured_at !== null) continue;
      // the flag's own tile in white, unless a cell lives on it; inset so the grid lines still show
      const tileShown = c.x >= this.view.x && c.y >= this.view.y && c.x + c.w <= this.view.right && c.y + c.h <= this.view.bottom;
      if (tileShown && !c.is_alive) g.fillStyle(FLAG_TILE_COLOR).fillRect(c.x + 1, c.y + 1, c.w - 2, c.h - 2);
      // the flag's box: the pole rises from the middle of the flag tile's bottom edge
      const s = c.w * FLAG_SIZE;
      const px = c.x + c.w / 2;
      const x = px - s * 0.25;
      const y = c.y + c.h - s * 0.9;
      // only whole flags, so one never spills past the board's visible area
      if (x < this.view.x || y < this.view.y || x + s > this.view.right || c.y + c.h > this.view.bottom) continue;
      const pole = Math.max(1, s * 0.1);
      g.fillStyle(FLAG_OUTLINE).fillRect(px - pole / 2, y + s * 0.12, pole, s * 0.78);
      g.fillStyle(p.main_color).lineStyle(Math.max(1, s * 0.06), FLAG_OUTLINE);
      g.fillTriangle(px, y + s * 0.12, px + s * 0.62, y + s * 0.3, px, y + s * 0.5);
      g.strokeTriangle(px, y + s * 0.12, px + s * 0.62, y + s * 0.3, px, y + s * 0.5);
    }
  }

  /**
   * Capture the flag (local games): anyone whose flag tile is now someone else's land is captured. Their cells
   * die and they place no more. True once at most one player is left standing, which ends the game.
   */
  private checkFlags(): boolean {
    if (this.mode !== "ctf") return false;
    for (const [p, flag] of this.flags) {
      if (p.captured_at !== null || flag.territory === p) continue;
      p.captured_at = this.generation;
      p.resources = 0;
      for (const row of this.board.cells) for (const c of row) if (c.owner === p) [c.is_alive, c.owner] = [false, null];
    }
    return this.players.filter((p) => p.captured_at === null).length <= 1;
  }

  /**
   * Players from first place to last, with their place (ties share one). Strongest 500: by land. Capture the
   * flag: those still standing first (by land), then the captured, the later their capture the better.
   */
  private placements(): { player: Player; land: number; place: number }[] {
    const survived = (p: Player) => (this.mode === "ctf" ? (p.captured_at ?? Infinity) : 0);
    const rows = this.players.map((player) => ({ player, land: this.board.territoryOf(player), survived: survived(player) }));
    // Infinity - Infinity is NaN, which falls through to land like a tie would
    rows.sort((a, b) => b.survived - a.survived || b.land - a.land);
    return rows.map((r) => ({ ...r, place: 1 + rows.findIndex((q) => q.survived === r.survived && q.land === r.land) }));
  }

  /** The generation this game ends after: online, the server's word for it. */
  private get finalGeneration() {
    return this.online?.state?.finalGeneration ?? FINAL_GENERATION[this.mode];
  }

  /** Whether we've said we're done placing this phase, in an online game. */
  private get onlineReady() {
    return !!this.online?.state?.players[this.seat]?.ready;
  }

  private get placing() {
    return this.phase === "setup" || this.phase === "placing";
  }

  /** Send a request to the server; if it's refused, say why for a moment. */
  private request(action: GameAction) {
    void this.online!.act(action).then((r) => {
      if (r.ok || !this.scene.isActive()) return;
      this.say(r.reason);
    });
  }

  /** Show `message` in place of the phase text for a moment. */
  private say(message: string) {
    this.notice = message;
    this.noticeLeft = NOTICE_MS;
    this.updatePhaseText();
  }

  /** The human in the top-left corner and each AI in its own corner, each with a starting square of territory. */
  private createPlayers() {
    const n = this.board.tiles;
    const s = START_TERRITORY;
    // top-left, top-right, bottom-right, bottom-left
    const corners = [
      [0, 0],
      [0, n - s],
      [n - s, n - s],
      [n - s, 0],
    ];
    const { color, opponents } = this.settings;
    const others = PALETTE.filter((_, i) => i !== color).slice(0, opponents);
    this.players = [
      new Player("You", PALETTE[color].color, false, START_RESOURCES),
      ...others.map((o) => new Player(`${o.name} AI`, o.color, true, START_RESOURCES)),
    ];
    const slots = [0, ...AI_CORNERS[opponents]];
    this.players.forEach((p, i) => {
      const [row, col] = corners[slots[i]];
      this.board.setTerritory(p, row, col, s, s);
      p.territory_at_last_grant = s * s;
      if (this.mode === "ctf") this.flags.set(p, this.board.cells[row + FLAG_OFFSET][col + FLAG_OFFSET]);
    });
    this.human = this.players[0];
    this.ais = this.players.filter((p) => p.is_ai).map((p) => new Ai(p, this.board));
  }

  /** Back to the lobby with the same settings, ready for another game. Friends: the same room; matchmade: its matchmaking screen. */
  private toLobby() {
    // a finished matchmade room has nothing more to offer
    if (this.lobbyScene === "RankedScene" && this.online?.roomId) void this.online.leave();
    this.scene.start(this.lobbyScene, this.lobbyData);
  }

  /** Online, quitting gives up your seat; offline it's just back to the lobby. */
  private quit() {
    if (this.online) void this.online.leave();
    this.scene.start(this.lobbyScene, this.lobbyData);
  }

  /**
   * Play resumes when paused; during a placement phase it ends the phase early ("Ready").
   * Online it tells the server you're ready; the phase ends once everyone is.
   */
  private play() {
    if (this.phase === "over") return;
    if (this.online) {
      if (this.placing && !this.onlineReady) this.request({ type: "ready" });
    } else if (this.paused) this.setPaused(false);
    else if (this.phase !== "running") this.endPhase();
  }

  /** Online games can't be paused: that would stop them for everyone. */
  private setPaused(paused: boolean) {
    if (this.phase === "over" || this.online) return;
    this.paused = paused;
    this.syncTicker();
  }

  /** The simulation only runs outside placement phases and while not paused; online it only runs on the server. */
  private syncTicker() {
    this.ticker.paused = !!this.online || this.paused || this.phase !== "running";
    const over = this.phase === "over";
    const playActive = !over && (this.online ? this.placing && !this.onlineReady : this.paused || this.phase !== "running");
    const stopActive = !over && !this.online && !this.paused;
    // online, once you're ready the button spins until everyone else is
    if (this.online) {
      this.playButton.label.setText("Ready");
      setButtonLoading(this.playButton, this.placing && this.onlineReady);
    } else this.playButton.label.setText(!this.paused && this.placing ? "Ready" : "Play");
    // dim whichever button doesn't apply right now
    this.playButton.rect.setAlpha(playActive ? 1 : 0.4);
    this.playButton.label.setAlpha(playActive ? 1 : 0.4);
    this.stopButton.rect.setAlpha(stopActive ? 1 : 0.4);
    this.stopButton.label.setAlpha(stopActive ? 1 : 0.4);
    this.updatePhaseText();
  }

  private startPhase(phase: "setup" | "placing", ms: number) {
    this.phase = phase;
    this.phaseLeft = ms;
    this.placedThisPhase.clear();
    for (const ai of this.ais) {
      ai.reset();
      this.aiCooldowns.set(ai, this.randomAiDelay());
    }
    this.syncTicker();
  }

  private endPhase() {
    // AIs that haven't spent everything yet do so now, so ending early doesn't cost them
    for (const ai of this.ais) while (this.aiPlace(ai));
    // newly placed cells claim their territory right away
    this.board.claimTerritory();
    this.phase = "running";
    this.placedThisPhase.clear();
    this.syncTicker();
    this.updatePlayerTexts();
    this.redraw();
    if (this.checkFlags()) this.finish();
  }

  /** Stop the simulation and show the standings. */
  private finish() {
    this.phase = "over";
    this.syncTicker();
    this.redraw();
    this.closeRules();
    this.hoverGraphics.clear();
    this.input.setDefaultCursor("default");

    const winners = this.placements().filter((r) => r.place === 1).map((r) => r.player);
    let headline: string;
    if (winners.length > 1) headline = winners.includes(this.human) ? "It's a draw!" : "No winner: a draw";
    else headline = winners[0] === this.human ? "You win!" : `${winners[0].name} wins`;

    const font = fontFamily();
    const display = displayFont();
    const back = this.roomKind === "ranked" ? "Back to ranked" : this.roomKind === "classic" ? "Back to classic" : "Back to lobby";
    const results: Results = {
      // interactive so it catches clicks meant for the sidebar buttons underneath
      shade: this.add.rectangle(0, 0, 1, 1, 0x120e22, 0.75).setOrigin(0).setInteractive(),
      panel: this.add.rectangle(0, 0, 1, 1, PANEL_COLOR).setOrigin(0),
      title: this.add.text(0, 0, headline, { fontFamily: display, fontSize: "32px", fontStyle: "bold", color: "#ffe03d", align: "center" }).setOrigin(0.5, 0),
      standings: this.add.text(0, 0, "", { fontFamily: font, fontSize: "18px", color: "#f8f5ff", lineSpacing: 8 }).setOrigin(0.5, 0),
      button: makeButton(this, back, PRIMARY, () => this.toLobby()),
    };
    for (const o of [results.shade, results.panel, results.title, results.standings]) o.setDepth(RESULTS_DEPTH);
    setButtonDepth(results.button, RESULTS_DEPTH);
    this.results = results;
    this.syncZoomInput();
    this.showStandings();
  }

  /** One line per player: place, land, a ctf capture, and in ranked games the rating change once it's in. */
  private showStandings() {
    const lines = this.placements().map(({ player, land, place }) => {
      let line = `${place}.  ${player.name}: ${land} land`;
      if (this.mode === "ctf" && player.captured_at !== null) line += ` · captured at gen ${player.captured_at}`;
      const rated = this.rankedResult?.results.find((r) => this.players[r.seat] === player);
      if (rated) {
        const delta = rated.after - rated.before;
        line += `\n      ${rated.after} (${delta >= 0 ? "+" : ""}${delta}) · ${rated.tier}`;
      }
      return line;
    });
    if (this.roomKind === "ranked" && !this.rankedResult) lines.push("", "Updating ratings…");
    this.results!.standings.setText(lines.join("\n"));
    this.layoutResults(this.scale.gameSize);
  }

  /** Every player still in earns ROUND_RESOURCES cells plus floor(cbrt(territory gained since the last grant)). */
  private grantResources() {
    for (const p of this.players) {
      if (p.captured_at !== null) continue;
      const territory = this.board.territoryOf(p);
      const gained = Math.max(0, territory - p.territory_at_last_grant);
      p.resources += ROUND_RESOURCES + Math.floor(Math.cbrt(gained));
      p.territory_at_last_grant = territory;
    }
  }

  private place(player: Player, cell: Cell) {
    cell.is_alive = true;
    cell.owner = player;
    player.resources--;
    this.placedThisPhase.add(cell);
  }

  /**
   * During a placement phase: place a cell in your territory, or click one of your live cells to remove it.
   * Only cells placed this phase are refunded; older ones (and any born from them) just disappear.
   */
  private humanClick(cell: Cell) {
    const action = this.clickAction(cell);
    if (!action) {
      // say why a click during placement did nothing
      if (this.canPlaceNow) this.say(cell.territory === this.human && !cell.is_alive ? "No cells left to place" : "Place inside your shaded land");
      return;
    }
    const p = this.human;
    if (this.online) {
      // just a request: the server checks it against the true board and broadcasts the result
      this.request({ type: action, row: cell.row, col: cell.col });
      return;
    }
    if (action === "remove") {
      cell.is_alive = false;
      cell.owner = null;
      if (this.placedThisPhase.delete(cell)) p.resources++;
    } else this.place(p, cell);
    this.updatePlayerTexts();
    this.redraw();
  }

  /** Whether the human may place or remove cells right now: a placement phase, not paused, and not captured. */
  private get canPlaceNow() {
    return this.placing && !this.paused && this.human.captured_at === null;
  }

  /** What clicking `cell` would do: take back one of your cells, place one on your empty land, or nothing. */
  private clickAction(cell: Cell): "place" | "remove" | null {
    if (!this.canPlaceNow) return null;
    const p = this.human;
    if (cell.is_alive && cell.owner === p) return "remove";
    if (!cell.is_alive && cell.territory === p && p.resources > 0) return "place";
    return null;
  }

  /** Preview the click under the mouse (not on touch, where there's no hover), and set the cursor to match. */
  private drawHover() {
    const g = this.hoverGraphics.clear();
    const p = this.input.activePointer;
    if (this.panning) return this.input.setDefaultCursor("grabbing");
    const cell = !this.rules && !p.wasTouch && this.view.contains(p.x, p.y) ? this.board.cellAt(p.x, p.y) : null;
    const action = cell && this.clickAction(cell);
    this.input.setDefaultCursor(action ? "pointer" : "default");
    if (!cell || !action) return;
    const x = Math.max(cell.x, this.view.x);
    const y = Math.max(cell.y, this.view.y);
    const w = Math.min(cell.x + cell.w, this.view.right) - x;
    const h = Math.min(cell.y + cell.h, this.view.bottom) - y;
    if (w <= 0 || h <= 0) return;
    const line = Math.max(1, Math.min(3, cell.w * 0.12));
    if (action === "place") g.fillStyle(this.human.main_color, HOVER_PLACE_ALPHA).fillRect(x, y, w, h).lineStyle(line, 0xf8f5ff);
    else g.lineStyle(line, REMOVE_COLOR);
    g.strokeRect(x, y, w, h);
  }

  /** Space plays or readies, + and - zoom, 0 resets the view, ? shows the rules and Escape hides them. Not while typing in a field. */
  private onKey(e: KeyboardEvent) {
    if (document.activeElement instanceof HTMLInputElement) return;
    if (this.rules) {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " " || e.key === "?") {
        e.preventDefault();
        this.closeRules();
      }
      return;
    }
    if (this.phase === "over") return;
    if (e.key === " ") {
      e.preventDefault();
      this.play();
    } else if (e.key === "?" || e.key === "h") this.openRules();
    else if (e.key === "+" || e.key === "=") this.zoomAtCenter(this.zoom * ZOOM_STEP);
    else if (e.key === "-" || e.key === "_") this.zoomAtCenter(this.zoom / ZOOM_STEP);
    else if (e.key === "0") {
      this.zoom = 1;
      this.panX = this.panY = 0;
      this.applyView();
    }
  }

  /** The how-to-play overlay. Offline, the game pauses while it's open so reading doesn't cost setup time. */
  private openRules() {
    if (this.rules || this.phase === "over") return;
    try {
      localStorage.setItem(RULES_SEEN_KEY, "1");
    } catch {
      // private browsing: it'll just open again next game
    }
    this.rulesResume = !this.online && !this.paused;
    if (this.rulesResume) this.setPaused(true);
    const font = fontFamily();
    const display = displayFont();
    const rules: Rules = {
      // interactive so it catches clicks meant for the board and sidebar underneath
      shade: this.add.rectangle(0, 0, 1, 1, 0x120e22, 0.75).setOrigin(0).setInteractive(),
      panel: this.add.rectangle(0, 0, 1, 1, PANEL_COLOR).setOrigin(0),
      title: this.add.text(0, 0, "How to play", { fontFamily: display, fontSize: "28px", fontStyle: "bold", color: "#ffe03d" }),
      body: this.add.text(0, 0, this.instructionsText(), { fontFamily: font, fontSize: "15px", color: "#f8f5ff", lineSpacing: 6 }),
      button: makeButton(this, this.online ? "Got it" : "Got it, let's play", PRIMARY, () => this.closeRules()),
    };
    for (const o of [rules.shade, rules.panel, rules.title, rules.body]) o.setDepth(RESULTS_DEPTH);
    setButtonDepth(rules.button, RESULTS_DEPTH);
    this.rules = rules;
    this.syncZoomInput();
    this.drawHover();
    this.layoutRules(this.scale.gameSize);
  }

  private closeRules() {
    if (!this.rules) return;
    const { shade, panel, title, body, button } = this.rules;
    for (const o of [shade, panel, title, body, button.rect, button.label]) o.destroy();
    this.rules = undefined;
    this.syncZoomInput();
    if (this.rulesResume) this.setPaused(false);
    this.rulesResume = false;
  }

  /** Rules panel centred over the whole screen; the text shrinks if it wouldn't fit. */
  private layoutRules({ width, height }: { width: number; height: number }) {
    const r = this.rules!;
    const pw = Math.min(560, width - PAD * 2);
    const measure = () => 32 + r.title.height + 16 + r.body.height + 28 + BTN_H + 32;
    r.body.setFontSize(15).setLineSpacing(6).setWordWrapWidth(pw - 64);
    if (measure() > height - PAD * 2) r.body.setFontSize(13).setLineSpacing(3);
    const ph = measure();
    const px = (width - pw) / 2;
    const py = Math.max(PAD, (height - ph) / 2);
    r.shade.setSize(width, height);
    (r.shade.input!.hitArea as Phaser.Geom.Rectangle).setTo(0, 0, width, height);
    r.panel.setPosition(px, py).setSize(pw, ph);
    r.title.setPosition(px + 32, py + 32);
    r.body.setPosition(px + 32, py + 32 + r.title.height + 16);
    layoutButton(r.button, px + 32, py + ph - 32 - BTN_H, pw - 64);
  }

  /** The zoom field is HTML, so it would sit on top of an overlay; narrow screens just use - and +. */
  private syncZoomInput() {
    this.zoomInput.setVisible(this.wide && !this.rules && !this.results);
  }

  /** Let an AI place its next cell. False if it has nothing it can place. */
  private aiPlace(ai: Ai): boolean {
    return ai.step((cell) => this.place(ai.player, cell));
  }

  private randomAiDelay() {
    return Phaser.Math.Between(AI_PLACE_MIN_MS, AI_PLACE_MAX_MS);
  }

  private updateGenerationText() {
    this.generationText.setText(`Generation ${this.generation} / ${this.finalGeneration}`);
  }

  private updatePhaseText() {
    const secs = Math.ceil(this.phaseLeft / 1000);
    const nextGrant = GRANT_EVERY - (this.generation % GRANT_EVERY);
    let text: string;
    if (this.phase === "over") text = "Game over";
    else if (this.online && !this.online.connected) text = "Reconnecting…";
    else if (this.notice) text = this.notice;
    else if (this.human.captured_at !== null) text = "Your flag was captured";
    else if (this.paused) text = "Paused";
    else if (this.placing && this.onlineReady) text = `Waiting for others (${secs}s)`;
    else if (this.phase === "setup") text = `Setup: place cells (${secs}s)`;
    else if (this.phase === "placing") text = `Place cells (${secs}s)`;
    else if (this.generation + nextGrant >= this.finalGeneration) text = `Game ends in ${this.finalGeneration - this.generation} gens`;
    else text = `Next placement in ${nextGrant} gens`;
    const urgent = this.canPlaceNow && !this.onlineReady && secs <= URGENT_SECS;
    this.phaseText.setText(text).setColor(this.notice || urgent ? "#ff4d5e" : "#ffe03d");
  }

  private instructionsText() {
    return [
      "• Place cells on your shaded land during setup and placement windows. Click your own cell to take it back.",
      "• A cell lives on with 2 or 3 neighbours. An empty tile with exactly 3 comes alive for the colour with the most of them.",
      `• Live cells claim the land ${CLAIM_RADIUS} tiles around them.`,
      `• Every ${GRANT_EVERY} generations: ${PLACE_MS / 1000}s to place, +${ROUND_RESOURCES} cells, plus the cube root of land gained.`,
      this.mode === "ctf"
        ? `• Capture the flag: if a rival's land covers your flag, you're out. Last colony standing wins; after generation ${this.finalGeneration}, the most land.`
        : `• After generation ${this.finalGeneration}, whoever holds the most land wins.`,
      "• Drag to pan, scroll or + / − to zoom, 0 to reset. Space to ready up, ? for these rules.",
    ].join("\n");
  }

  private updatePlayerTexts() {
    this.players.forEach((p, i) => {
      // who's been captured; online, also who's dropped out and who's done placing
      const info = this.online?.state?.players[i];
      const tags = [p.captured_at !== null && "captured", info && !info.connected && "offline", this.placing && info?.ready && "ready"].filter(Boolean);
      this.playerTexts[i].setText(`${p.name}${tags.length ? ` (${tags.join(", ")})` : ""}`);
      this.playerCounts[i].setText(String(p.resources));
    });
  }

  /** Set the zoom (clamped), keeping the board point under screen position (px, py) fixed. */
  private zoomAt(zoom: number, px: number, py: number) {
    zoom = Phaser.Math.Clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    // point as a fraction of the area inside the frame, then as a fraction of the board
    const inner = this.view.width - INSET * 2;
    const fx = (px - this.view.x - INSET) / inner;
    const fy = (py - this.view.y - INSET) / inner;
    const ux = (fx - this.panX) / this.zoom;
    const uy = (fy - this.panY) / this.zoom;
    this.zoom = zoom;
    this.panX = fx - ux * zoom;
    this.panY = fy - uy * zoom;
    this.applyView();
  }

  private zoomAtCenter(zoom: number) {
    if (this.phase === "over") return;
    this.zoomAt(zoom, this.view.centerX, this.view.centerY);
  }

  private makeZoomInput(fontFamily: string): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "numeric";
    input.setAttribute("aria-label", "Zoom percentage");
    Object.assign(input.style, {
      boxSizing: "border-box",
      height: `${BTN_H}px`,
      background: "#120e22",
      color: "#f8f5ff",
      border: "2px solid #5b4b9a",
      borderRadius: "0",
      outline: "none",
      textAlign: "center",
      fontFamily,
      fontSize: "18px",
      fontWeight: "bold",
    });
    // typed value applies on Enter or when the field loses focus; Escape discards it
    const commit = () => {
      const percent = parseFloat(input.value);
      if (Number.isFinite(percent)) this.zoomAtCenter(percent / 100);
      else this.updateZoomInput();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") {
        this.updateZoomInput();
        input.blur();
      }
    });
    input.addEventListener("blur", commit);
    input.addEventListener("focus", () => input.select());
    showFocus(input);
    return input;
  }

  private updateZoomInput() {
    (this.zoomInput.node as HTMLInputElement).value = `${Math.round(this.zoom * 100)}%`;
  }

  /** Place the board (and the frame around it) inside the view according to zoom and pan, then redraw. */
  private applyView() {
    // at zoom 1 the board fills the view minus the frame and margin; pan is measured in that inner size
    const inner = this.view.width - INSET * 2;
    const size = inner * this.zoom;
    // zoomed in, the framed board must cover the whole view; zoomed out, it must stay fully inside it
    const lo = Math.min(0, 1 - this.zoom);
    const hi = Math.max(0, 1 - this.zoom);
    this.panX = Phaser.Math.Clamp(this.panX, lo, hi);
    this.panY = Phaser.Math.Clamp(this.panY, lo, hi);
    const bx = this.view.x + INSET + this.panX * inner;
    const by = this.view.y + INSET + this.panY * inner;
    this.board.resize(bx, by, size);
    this.redraw();
    this.drawFrame(bx, by, size);
    this.updateZoomInput();
  }

  /** Frame hugging the board's edges, clipped to the view like the board is. */
  private drawFrame(bx: number, by: number, size: number) {
    const f = FRAME_WIDTH;
    const outer = size + f * 2;
    const sides = [
      [bx - f, by - f, outer, f], // top
      [bx - f, by + size, outer, f], // bottom
      [bx - f, by, f, size], // left
      [bx + size, by, f, size], // right
    ];
    this.frame.clear().fillStyle(FRAME_COLOR);
    for (const [sx, sy, sw, sh] of sides) {
      const x = Math.max(sx, this.view.x);
      const y = Math.max(sy, this.view.y);
      const w = Math.min(sx + sw, this.view.right) - x;
      const h = Math.min(sy + sh, this.view.bottom) - y;
      if (w > 0 && h > 0) this.frame.fillRect(x, y, w, h);
    }
  }

  /**
   * Board on the left, sidebar on the right. On narrow screens the sidebar drops below the board and
   * compacts: zoom is just - and + beside Play and Stop, and the players sit in two columns.
   */
  private layout({ width, height }: Phaser.Structs.Size) {
    let size: number, bx: number, by: number;
    let sx: number, sy: number, sh: number;
    const wide = (this.wide = width >= 720);
    // wide enough for the mode's name beside Quit, in the display font
    const sw = wide ? Phaser.Math.Clamp(width * 0.24, 260, 320) : width - PAD * 2;
    const gap = 12;
    const cols = wide ? 1 : 2;
    const rowH = PLAYER_ROW_H;
    const playersY = wide ? 290 : 188;
    // the "To place" label, then the rows
    const playersH = 26 + Math.ceil(this.players.length / cols) * rowH;

    // wrap first: a title that wraps pushes everything below it down. It leaves room for Rules and Quit.
    this.title.setWordWrapWidth(sw - 40 - ICON_BTN * 2 - ICON_GAP - 12);
    const extra = this.title.height - this.titleLineH;

    if (wide) {
      const areaW = width - sw - PAD * 3;
      size = Math.min(areaW, height - PAD * 2);
      bx = PAD + (areaW - size) / 2;
      by = (height - size) / 2;
      sx = width - PAD - sw;
      sy = PAD;
      sh = height - PAD * 2;
    } else {
      sh = extra + playersY + playersH + 8;
      size = Math.max(120, Math.min(width - PAD * 2, height - sh - PAD * 3));
      bx = (width - size) / 2;
      by = PAD;
      sx = PAD;
      sy = by + size + PAD;
    }

    this.view.setTo(bx, by, size, size);
    this.applyView();

    this.sidebar.setPosition(sx, sy).setSize(sw, sh);
    this.title.setPosition(sx + 20, sy + 20);
    // [?] [×] in the top corner
    const qx = sx + sw - 20 - ICON_BTN;
    layoutButton(this.quitButton, qx, sy + 14, ICON_BTN, ICON_BTN);
    layoutButton(this.rulesButton, qx - ICON_GAP - ICON_BTN, sy + 14, ICON_BTN, ICON_BTN);
    const [cx, cy, arm] = [qx + ICON_BTN / 2, sy + 14 + ICON_BTN / 2, 7];
    this.quitIcon.clear().lineStyle(4, 0xf8f5ff);
    this.quitIcon.lineBetween(cx - arm, cy - arm, cx + arm, cy + arm).lineBetween(cx - arm, cy + arm, cx + arm, cy - arm);
    // everything under the title starts lower by however much the title wrapped
    const top = sy + extra;
    this.generationText.setPosition(sx + 20, top + 58);
    this.phaseText.setPosition(sx + 20, top + 82);

    this.zoomLabel.setVisible(wide);
    this.syncZoomInput();
    if (wide) {
      // [Play] [Stop], then Zoom: [-] [ 150% ] [+]
      const btnW = (sw - 40 - gap) / 2;
      layoutButton(this.playButton, sx + 20, top + 116, btnW);
      layoutButton(this.stopButton, sx + 20 + btnW + gap, top + 116, btnW);
      this.zoomLabel.setPosition(sx + 20, top + 186);
      const zy = top + 212;
      const inputW = sw - 40 - (BTN_H + gap) * 2;
      layoutButton(this.zoomOutButton, sx + 20, zy, BTN_H);
      this.zoomInput.setPosition(sx + 20 + BTN_H + gap, zy);
      (this.zoomInput.node as HTMLInputElement).style.width = `${inputW}px`;
      layoutButton(this.zoomInButton, sx + sw - 20 - BTN_H, zy, BTN_H);
    } else {
      // [Play] [Stop] [-] [+]
      const btnW = (sw - 40 - gap * 3 - BTN_H * 2) / 2;
      layoutButton(this.playButton, sx + 20, top + 116, btnW);
      layoutButton(this.stopButton, sx + 20 + btnW + gap, top + 116, btnW);
      layoutButton(this.zoomOutButton, sx + sw - 20 - BTN_H * 2 - gap, top + 116, BTN_H);
      layoutButton(this.zoomInButton, sx + sw - 20 - BTN_H, top + 116, BTN_H);
    }

    // "To place", then per player: colour swatch, name, and their cells to place on the right
    this.placeLabel.setPosition(sx + 20, top + playersY);
    const colW = (sw - 40 - gap * (cols - 1)) / cols;
    this.players.forEach((_, i) => {
      const px = sx + 20 + (i % cols) * (colW + gap);
      const py = top + playersY + 26 + Math.floor(i / cols) * rowH + rowH / 2;
      this.playerSwatches[i].setPosition(px, py);
      this.playerTexts[i].setPosition(px + PLAYER_SWATCH + 10, py);
      this.playerCounts[i].setPosition(px + colW, py);
    });
    this.updatePlayerTexts();

    // the sidebar has room for a reminder of the controls only beside the board
    this.hint.setVisible(wide).setWordWrapWidth(sw - 40).setPosition(sx + 20, top + playersY + playersH + 12);
    if (this.results) this.layoutResults({ width, height });
    if (this.rules) this.layoutRules({ width, height });
  }

  /** Results panel centred over the whole screen. */
  private layoutResults({ width, height }: { width: number; height: number }) {
    const r = this.results!;
    const pw = Math.min(420, width - PAD * 2);
    // wrap before measuring, so a long headline makes the panel taller
    r.title.setWordWrapWidth(pw - 40);
    const ph = 40 + r.title.height + 24 + r.standings.height + 32 + BTN_H + 32;
    const px = (width - pw) / 2;
    const py = Math.max(PAD, (height - ph) / 2);
    r.shade.setSize(width, height);
    (r.shade.input!.hitArea as Phaser.Geom.Rectangle).setTo(0, 0, width, height);
    r.panel.setPosition(px, py).setSize(pw, ph);
    r.title.setPosition(width / 2, py + 40);
    r.standings.setPosition(width / 2, py + 40 + r.title.height + 24);
    layoutButton(r.button, px + 32, py + ph - 32 - BTN_H, pw - 64);
  }

  /** Counts down setup/placement phases and lets the AIs place their cells over time. */
  update(_time: number, delta: number) {
    if (this.noticeLeft > 0 && (this.noticeLeft -= delta) <= 0) {
      this.notice = "";
      this.updatePhaseText();
    }
    if (this.online) {
      // the server runs the clock; between its broadcasts just count down so the timer moves smoothly
      if (this.placing) this.phaseLeft = Math.max(0, this.phaseLeft - delta);
      if (this.phase !== "over") this.updatePhaseText();
      return;
    }
    if (this.paused || this.phase === "running" || this.phase === "over") return;
    this.phaseLeft -= delta;
    let placed = false;
    for (const [ai, left] of this.aiCooldowns) {
      if (left - delta > 0) {
        this.aiCooldowns.set(ai, left - delta);
        continue;
      }
      placed = this.aiPlace(ai) || placed;
      this.aiCooldowns.set(ai, this.randomAiDelay());
    }
    if (this.phaseLeft <= 0) {
      this.endPhase();
      return;
    }
    if (placed) {
      this.updatePlayerTexts();
      this.redraw();
    }
    this.updatePhaseText();
  }
}

function readRulesSeen() {
  try {
    return localStorage.getItem(RULES_SEEN_KEY) !== null;
  } catch {
    return true;
  }
}
