import * as Phaser from "phaser";
import Ai from "../Ai";
import { avatarTexture } from "../avatars";
import Board, { CLAIM_RADIUS } from "../Board";
import type Cell from "../Cell";
import { type Mode, modeName } from "../modes";
import ChatBox from "../net/ChatBox";
import Online from "../net/Online";
import type { GameAction, GameState, LobbyState, RankedResult } from "../net/protocol";
import { GUIDE } from "../patterns";
import Player, { PALETTE } from "../Player";
import { isMuted, loadSounds, playUi, popForBirths, popForPlace, setMuted } from "../sound";
import {
  BTN_H,
  type Button,
  displayFont,
  drawPattern,
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
// each player's corner, clockwise from the top-left, by how many play: the first player (you, offline) takes the
// top-left, one opponent sits across the board, two take the corners beside you. The server seats online games the same way.
const CORNER_SLOTS: Record<number, number[]> = { 1: [0], 2: [0, 2], 3: [0, 1, 3], 4: [0, 1, 2, 3] };
// each player's badge sits at their corner, in a band above or below the board: their initial on a disc in their colour,
// then their name and how many cells they have left to place
const BADGE_BAND = 52;
const BADGE_BAND_NARROW = 44;
const BADGE_RING = 0x120e22;
// the square Rules and Quit buttons in the sidebar's top corner
const ICON_BTN = 40;
const ICON_GAP = 8;
// the Patterns popup shows one of each basic kind of pattern, from the tutorial's guide
const PATTERN_PICKS = [
  ["Still life", "Block"],
  ["Oscillator", "Blinker"],
  ["Spaceship", "Glider"],
  ["Methuselah", "R-pentomino"],
] as const;
const PATTERN_DRAWING_H = 72;
// the chat fills the sidebar under the controls, at least this tall beside the board, and exactly this tall below it
const CHAT_MIN_H = 200;
const CHAT_NARROW_H = 150;
// the results panel draws over everything else
const RESULTS_DEPTH = 10;
// the results: the crowned winner's disc, the land bars, and the medals for 1st, 2nd and 3rd
const CROWN_R = 30;
const RESULT_BAR_H = 8;
const MEDALS = [0xffd23d, 0xc9cbe0, 0xd98c4a];
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

/** One player's line on the results: place medal, their disc and initial, name, land bar, and a note. */
type ResultRow = {
  player: Player;
  // yours is highlighted
  bg: Phaser.GameObjects.Rectangle;
  // the medal and the player's disc
  marks: Phaser.GameObjects.Graphics;
  place: Phaser.GameObjects.Text;
  initial: Phaser.GameObjects.Text;
  name: Phaser.GameObjects.Text;
  land: Phaser.GameObjects.Text;
  // a rating change (ranked) or when their flag fell (ctf)
  note: Phaser.GameObjects.Text;
  // where the land bar goes, set by the layout
  bar: { x: number; y: number; w: number };
};

type Results = {
  shade: Phaser.GameObjects.Rectangle;
  panel: Phaser.GameObjects.Rectangle;
  // the winner's disc, crowned, at the top
  crown: Phaser.GameObjects.Graphics;
  crownInitial: Phaser.GameObjects.Text;
  title: Phaser.GameObjects.Text;
  subtitle: Phaser.GameObjects.Text;
  rows: ResultRow[];
  bars: Phaser.GameObjects.Graphics;
  // "Updating ratings…" in a ranked game, until they're in
  footer: Phaser.GameObjects.Text;
  button: Button;
  // the land bars grow in: 0 to 1
  grow: { p: number };
  // the winner's colour, for the crown's disc
  winnerColor: number;
};

type Rules = {
  shade: Phaser.GameObjects.Rectangle;
  panel: Phaser.GameObjects.Rectangle;
  title: Phaser.GameObjects.Text;
  body: Phaser.GameObjects.Text;
  button: Button;
};

type Patterns = {
  shade: Phaser.GameObjects.Rectangle;
  panel: Phaser.GameObjects.Rectangle;
  title: Phaser.GameObjects.Text;
  drawings: Phaser.GameObjects.Graphics;
  // per pattern: its name, its kind (in the guide section's colour) and what it does
  names: Phaser.GameObjects.Text[];
  kinds: Phaser.GameObjects.Text[];
  abouts: Phaser.GameObjects.Text[];
  button: Button;
};

/** A player at their corner of the board. */
type Badge = {
  disc: Phaser.GameObjects.Graphics;
  letter: Phaser.GameObjects.Text;
  // the player's profile picture over the disc, once it's loaded; until then (or without one) the letter shows
  picture: Phaser.GameObjects.Image;
  name: Phaser.GameObjects.Text;
  count: Phaser.GameObjects.Text;
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
  // sound on or off, left of Rules: a speaker drawn over the button, with waves or a cross
  private soundButton!: Button;
  private soundIcon!: Phaser.GameObjects.Graphics;
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
  // per player, in seat order: their badge and the corner it's in (0..3, clockwise from the top-left)
  private badges!: Badge[];
  private corners!: number[];
  // height of the bands above and below the board that hold the badges
  private badgeBand!: number;
  // per badge, how wide its name may be before it's cut short
  private badgeTextW!: number[];
  private hint!: Phaser.GameObjects.Text;
  private patternsButton!: Button;
  // the patterns overlay, while it's open
  private patterns?: Patterns;
  // HTML, pinned to the sidebar's foot: it never scrolls with the controls above it
  private chat!: Phaser.GameObjects.DOMElement;
  private chatBox!: ChatBox;
  private chatH!: number;
  // the sidebar's contents have their own camera, clipped to the panel, so they scroll inside it
  private sidebarCam!: Phaser.Cameras.Scene2D.Camera;
  // overlays (rules, results) have a camera on top of everything, so their shade covers the sidebar too
  private overlayCam!: Phaser.Cameras.Scene2D.Camera;
  private sidebarView!: Phaser.Geom.Rectangle;
  private sidebarScroll!: number;
  private sidebarMaxScroll!: number;
  // the pointer went down in the sidebar, so dragging scrolls it
  private sidebarDrag!: boolean;
  private scrollbar!: Phaser.GameObjects.Graphics;
  // where the zoom field sits in the sidebar before scrolling
  private zoomY!: number;
  // the sidebar is beside the board (wide) or below it, compacted (narrow)
  private wide!: boolean;
  // the how-to-play overlay, while it's open
  private rules?: Rules;
  // the rules or patterns overlay paused an offline game; closing it resumes
  private overlayResume!: boolean;
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
  // online: a state from the server has been shown, so changes from here on are news (a capture to sound)
  private stateSeen!: boolean;
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
    this.stateSeen = false;
    if (!this.online) this.settings = settings as GameSettings;
    this.mode = this.online ? (this.online.state?.mode ?? "strongest500") : this.settings.mode;
    this.flags = new Map();
    this.rankedResult = undefined;
    this.roomKind = this.online?.lobby?.kind ?? "friends";
    this.seat = this.online?.seat ?? 0;
    this.notice = "";
    this.noticeLeft = 0;
    this.badges = [];
    this.corners = [];
    this.badgeBand = BADGE_BAND;
    this.badgeTextW = [];
    this.chatH = CHAT_MIN_H;
    this.results = undefined;
    this.rules = undefined;
    this.patterns = undefined;
    this.overlayResume = false;
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
    this.sidebarView = new Phaser.Geom.Rectangle();
    this.sidebarScroll = 0;
    this.sidebarMaxScroll = 0;
    this.sidebarDrag = false;
    this.zoomY = 0;
  }

  preload() {
    loadSounds(this);
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
    // the game is starting (from a lobby, a found match, or the host's next game)
    if (state?.phase !== "over") playUi(this, "confirm");

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
    this.soundButton = makeButton(this, "", SECONDARY, () => this.toggleSound());
    this.soundIcon = this.add.graphics();
    this.generationText = this.add.text(0, 0, "", { fontFamily: font, fontSize: "16px", color: "#d4ccff" });
    this.phaseText = this.add.text(0, 0, "", { fontFamily: font, fontSize: "16px", fontStyle: "bold", color: "#ffe03d" });
    this.playButton = makeButton(this, "Play", PRIMARY, () => this.play());
    this.stopButton = makeButton(this, "Stop", SECONDARY, () => this.setPaused(true));

    this.zoomLabel = this.add.text(0, 0, "Zoom", { fontFamily: display, fontSize: "16px", color: "#d4ccff" });
    this.zoomOutButton = makeButton(this, "−", SECONDARY, () => this.zoomAtCenter(this.zoom / ZOOM_STEP));
    this.zoomInButton = makeButton(this, "+", SECONDARY, () => this.zoomAtCenter(this.zoom * ZOOM_STEP));
    this.zoomInput = this.add.dom(0, 0, this.makeZoomInput(font)).setOrigin(0);

    this.patternsButton = makeButton(this, "Patterns", SECONDARY, () => this.openPatterns());
    const keys = this.online ? "Space: ready · ?: rules · P: patterns · M: sound · Enter: chat" : "Space: ready · ?: rules · P: patterns · M: sound";
    const hint = `Click your shaded land to place a cell, or one of yours to take it back. Drag to pan, scroll to zoom.\n${keys}`;
    this.hint = this.add.text(0, 0, hint, { fontFamily: font, fontSize: "13px", color: "#d4ccff", lineSpacing: 3 });
    this.scrollbar = this.add.graphics();

    // drawn by the main camera, around the board
    this.corners = CORNER_SLOTS[this.players.length];
    this.badges = this.players.map((_, i) => ({
      disc: this.add.graphics(),
      letter: this.add.text(0, 0, initial(this.realName(i)), { fontFamily: display, fontSize: "20px", color: "#120e22" }).setOrigin(0.5),
      picture: this.add.image(0, 0, "__DEFAULT").setVisible(false),
      name: this.add.text(0, 0, "", { fontFamily: font, fontSize: "13px", fontStyle: "bold", color: "#f8f5ff" }),
      count: this.add.text(0, 0, "", { fontFamily: display, fontSize: "18px", color: "#ffe03d" }),
    }));
    this.loadBadgePictures();

    // everything below the sidebar's title bar moves with the sidebar's scroll; the main camera skips it
    const sidebarObjects: Phaser.GameObjects.GameObject[] = [
      this.title,
      this.quitIcon,
      this.soundIcon,
      this.generationText,
      this.phaseText,
      this.zoomLabel,
      this.hint,
      ...[this.soundButton, this.rulesButton, this.quitButton, this.playButton, this.stopButton, this.zoomOutButton, this.zoomInButton, this.patternsButton].flatMap(
        (b) => [b.rect, b.label],
      ),
    ];
    const others = this.children.list.filter((o) => !sidebarObjects.includes(o));
    this.cameras.main.ignore(sidebarObjects);
    this.sidebarCam = this.cameras.add(0, 0, 1, 1);
    this.sidebarCam.ignore(others);
    this.overlayCam = this.cameras.add(0, 0, 1, 1);
    // the zoom field is HTML: every camera that skips it hides it, so only the last, unscrolled one shows it,
    // and scrollSidebar moves it with the sidebar's contents
    this.cameras.main.ignore(this.zoomInput);
    this.overlayCam.ignore(this.children.list.filter((o) => o !== this.zoomInput));
    // the chat is HTML too, shown by the top camera only; it stays put at the sidebar's foot
    this.chatBox = new ChatBox(this.online, (reason) => this.scene.isActive() && this.say(reason));
    this.chat = this.add.dom(0, 0, this.chatBox.element).setOrigin(0);
    this.showOnTop([this.chat]);

    // drag pans the board; a click (press and release without dragging) places or takes back a cell
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.pressed = this.phase !== "over" && !this.modal && this.view.contains(p.x, p.y);
      this.panning = false;
      // dragging in the sidebar scrolls it (handy on touch screens)
      this.sidebarDrag = !this.modal && !this.results && this.sidebarView.contains(p.x, p.y);
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (this.sidebarDrag && p.isDown) return this.scrollSidebar(p.prevPosition.y - p.y);
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
      this.sidebarDrag = false;
      this.drawHover();
    };
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => release(p, true));
    this.input.on("pointerupoutside", (p: Phaser.Input.Pointer) => release(p, false));
    this.input.on(Phaser.Input.Events.GAME_OUT, () => this.hoverGraphics.clear());

    // scroll over the board to zoom, keeping the point under the cursor fixed; over the sidebar, to scroll it
    this.input.on("wheel", (p: Phaser.Input.Pointer, _objs: unknown, _dx: number, dy: number) => {
      if (this.modal || this.results) return;
      if (this.sidebarView.contains(p.x, p.y)) return this.scrollSidebar(dy);
      if (this.phase === "over" || !this.view.contains(p.x, p.y)) return;
      this.zoomAt(this.zoom * Math.exp(-dy * ZOOM_SPEED), p.x, p.y);
    });
    // a game always fits the window, so the page has nothing to scroll: the wheel is all the game's
    keepWheel(this, () => true);

    this.ticker = this.time.addEvent({
      delay: GENERATION_MS,
      loop: true,
      paused: true,
      callback: () => {
        popForBirths(this, this.board.step(this.players, this.generation));
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
      online
        .on("state", this.applyState, this)
        .on("status", this.updatePhaseText, this)
        .on("closed", onClosed)
        .on("ranked", onRanked)
        .on("chat", this.chatBox.render, this.chatBox);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
        online
          .off("state", this.applyState, this)
          .off("status", this.updatePhaseText, this)
          .off("closed", onClosed)
          .off("ranked", onRanked)
          .off("chat", this.chatBox.render, this.chatBox),
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
    // cells born since the last state: only when generations passed, so placements don't pop
    const stepped = s.generation > this.generation;
    let births = 0;
    this.board.cells.forEach((cols, row) =>
      cols.forEach((c, col) => {
        const i = row * s.tiles + col;
        if (stepped && !c.is_alive && s.cells[i] !== ".") births++;
        c.owner = at(s.cells, i);
        c.is_alive = c.owner !== null;
        c.territory = at(s.territory, i);
      }),
    );
    // a flag newly taken scratches; on the first state (a rejoin mid-game, say) every capture is old news
    let captured = false;
    for (const p of s.players) {
      const player = this.players[p.seat];
      if (player.captured_at === null && p.capturedAt !== null && this.stateSeen) captured = true;
      player.resources = p.resources;
      player.captured_at = p.capturedAt;
    }
    this.stateSeen = true;
    if (captured) playUi(this, "capture");
    popForBirths(this, births);
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
      g.fillStyle(FLAG_OUTLINE).fillRect(px - pole / 2, y + s * 0.12 - 5, pole, s * 0.78);
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
      playUi(this, "capture");
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
      ...others.map((o) => new Player(`${o.name} Bot`, o.color, true, START_RESOURCES)),
    ];
    const slots = CORNER_SLOTS[this.players.length];
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

  /**
   * Online, quitting gives up your seat; offline it's just back to the lobby. In a friends room you stay in the
   * room, waiting in its lobby for the next game (Leave there to go for good).
   */
  private quit() {
    if (this.online && this.roomKind === "friends" && this.phase !== "over") {
      // the lobby must know we're out of the game before it opens, or it would send us straight back in
      void this.online.sitOut().then(() => this.scene.isActive() && this.scene.start(this.lobbyScene, this.lobbyData));
      return;
    }
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
      // the spinner is made on first use; it belongs to the sidebar's camera
      if (this.playButton.spinner) for (const cam of [this.cameras.main, this.overlayCam]) cam.ignore(this.playButton.spinner);
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
    this.closePatterns();
    this.hoverGraphics.clear();
    this.input.setDefaultCursor("default");

    const placements = this.placements();
    const winners = placements.filter((r) => r.place === 1).map((r) => r.player);
    const won = winners.includes(this.human);
    let headline: string;
    if (winners.length > 1) headline = won ? "It's a draw!" : "No winner: a draw";
    else headline = won ? "You win!" : `${winners[0].name} wins`;
    const mine = placements.find((r) => r.player === this.human)!;
    const subtitle = `${won && winners.length === 1 ? "1st" : ordinal(mine.place)} of ${this.players.length} · ${modeName(this.mode)}`;

    const font = fontFamily();
    const display = displayFont();
    const back = this.roomKind === "ranked" ? "Back to ranked" : this.roomKind === "classic" ? "Back to classic" : "Back to lobby";
    const rows = placements.map(({ player }) => ({
      player,
      bg: this.add.rectangle(0, 0, 1, 1, 0x2b2448).setOrigin(0).setVisible(player === this.human),
      marks: this.add.graphics(),
      place: this.add.text(0, 0, "", { fontFamily: display, fontSize: "16px", color: "#120e22" }).setOrigin(0.5),
      initial: this.add
        .text(0, 0, initial(this.realName(this.players.indexOf(player))), { fontFamily: display, fontSize: "16px", color: "#120e22" })
        .setOrigin(0.5),
      name: this.add.text(0, 0, player.name, { fontFamily: font, fontSize: "16px", fontStyle: "bold", color: "#f8f5ff" }),
      land: this.add.text(0, 0, "", { fontFamily: display, fontSize: "16px", color: "#f8f5ff" }).setOrigin(1, 0),
      note: this.add.text(0, 0, "", { fontFamily: font, fontSize: "13px", fontStyle: "bold", color: "#9a8ae0" }),
      bar: { x: 0, y: 0, w: 0 },
    }));
    const results: Results = {
      // interactive so it catches clicks meant for the sidebar buttons underneath
      shade: this.add.rectangle(0, 0, 1, 1, 0x120e22, 0.8).setOrigin(0).setInteractive(),
      panel: this.add.rectangle(0, 0, 1, 1, PANEL_COLOR).setOrigin(0),
      crown: this.add.graphics(),
      crownInitial: this.add
        .text(0, 0, initial(this.realName(this.players.indexOf(winners[0]))), { fontFamily: display, fontSize: "30px", color: "#120e22" })
        .setOrigin(0.5)
        .setVisible(winners.length === 1),
      title: this.add
        .text(0, 0, headline, { fontFamily: display, fontSize: "36px", fontStyle: "bold", color: won ? "#ffe03d" : "#f8f5ff", align: "center" })
        .setOrigin(0.5, 0),
      subtitle: this.add.text(0, 0, subtitle, { fontFamily: font, fontSize: "15px", fontStyle: "bold", color: "#d4ccff", align: "center" }).setOrigin(0.5, 0),
      rows,
      bars: this.add.graphics(),
      footer: this.add.text(0, 0, "", { fontFamily: font, fontSize: "14px", color: "#d4ccff", align: "center" }).setOrigin(0.5, 0),
      button: makeButton(this, back, PRIMARY, () => this.toLobby()),
      grow: { p: 0 },
      winnerColor: winners.length === 1 ? winners[0].main_color : 0xffe03d,
    };
    const contents = [results.crown, results.crownInitial, results.title, results.subtitle, results.bars, results.footer, ...rows.flatMap(rowObjects)];
    results.shade.setDepth(RESULTS_DEPTH);
    results.panel.setDepth(RESULTS_DEPTH + 2);
    for (const o of contents) o.setDepth(RESULTS_DEPTH + 3);
    setButtonDepth(results.button, RESULTS_DEPTH + 3);
    this.results = results;
    this.showOnTop([results.shade, results.panel, ...contents, results.button.rect, results.button.label]);
    this.syncDom();
    this.showStandings();
    this.animateResults(won && winners.length === 1, this.cheers(mine.place));
  }

  /** Whether the end of the game cheers for us: every game with friends, otherwise a 1st or 2nd place finish. */
  private cheers(place: number) {
    if (this.online && this.roomKind === "friends") return true;
    return place <= 2;
  }

  /** Each row's numbers: land, and a ctf capture or (ranked, once it's in) the rating change. */
  private showStandings() {
    const r = this.results!;
    for (const row of r.rows) {
      const { player } = row;
      const placed = this.placements().find((p) => p.player === player)!;
      row.place.setText(String(placed.place));
      row.land.setText(`${placed.land} land`);
      const notes: string[] = [];
      let color = "#9a8ae0";
      const rated = this.rankedResult?.results.find((x) => this.players[x.seat] === player);
      if (rated) {
        const delta = rated.after - rated.before;
        notes.push(`${delta >= 0 ? "+" : ""}${delta} → ${rated.after} · ${rated.tier}`);
        color = delta > 0 ? "#3ddc84" : delta < 0 ? "#ff4d5e" : "#d4ccff";
      }
      if (this.mode === "ctf" && player.captured_at !== null) notes.push(`flag taken at gen ${player.captured_at}`);
      row.note.setText(notes.join(" · ")).setColor(color);
    }
    r.footer.setText(this.roomKind === "ranked" && !this.rankedResult ? "Updating ratings…" : "");
    this.layoutResults(this.scale.gameSize);
  }

  /**
   * The results arrive: the panel rises in, the rows follow one by one, and the land bars grow. A win rains live
   * cells in every player's colour behind the panel.
   */
  private animateResults(celebrate: boolean, cheer: boolean) {
    const r = this.results!;
    const head = [r.panel, r.crown, r.crownInitial, r.title, r.subtitle, r.bars, r.footer, r.button.rect, r.button.label];
    for (const o of head) {
      const y = o.y;
      o.setAlpha(0).setY(y + 24);
      this.tweens.add({ targets: o, alpha: 1, y, duration: 350, ease: "Back.Out" });
    }
    r.rows.forEach((row, i) => {
      for (const o of rowObjects(row)) {
        const x = o.x;
        o.setAlpha(0).setX(x - 30);
        this.tweens.add({ targets: o, alpha: 1, x, duration: 300, delay: 250 + i * 120, ease: "Cubic.Out" });
      }
    });
    this.tweens.add({
      targets: r.grow,
      p: 1,
      duration: 900,
      delay: 300 + r.rows.length * 120,
      ease: "Cubic.Out",
      onUpdate: () => this.drawResultBars(),
    });
    // the cheer (see cheers()); the shower of cells is for an outright win only
    if (cheer) playUi(this, "win");
    if (celebrate) this.rainCells();
  }

  /** A shower of live cells, in the players' colours and yellow, falling past the panel and gone in a few seconds. */
  private rainCells() {
    const { width, height } = this.scale.gameSize;
    const colors = [...this.players.map((p) => p.main_color), 0xffe03d];
    const cells: Phaser.GameObjects.Rectangle[] = [];
    for (let i = 0; i < 90; i++) {
      const size = Phaser.Math.Between(6, 12);
      const cell = this.add
        .rectangle(Phaser.Math.Between(0, width), -Phaser.Math.Between(10, height * 0.6), size, size, Phaser.Utils.Array.GetRandom(colors))
        .setDepth(RESULTS_DEPTH + 1)
        .setAngle(Phaser.Math.Between(0, 90));
      cells.push(cell);
      this.tweens.add({
        targets: cell,
        y: height + 20,
        x: cell.x + Phaser.Math.Between(-80, 80),
        angle: cell.angle + Phaser.Math.Between(-360, 360),
        duration: Phaser.Math.Between(2200, 4200),
        delay: Phaser.Math.Between(0, 900),
        ease: "Quad.In",
        onComplete: () => cell.destroy(),
      });
    }
    this.showOnTop(cells);
  }

  /** The land bars, each in its player's colour, as long as their land against the leader's. */
  private drawResultBars() {
    const r = this.results!;
    const g = r.bars.clear();
    const most = Math.max(1, ...r.rows.map(({ player }) => this.board.territoryOf(player)));
    for (const { player, bar } of r.rows) {
      g.fillStyle(0x120e22).fillRect(bar.x, bar.y, bar.w, RESULT_BAR_H);
      const w = Math.round(bar.w * (this.board.territoryOf(player) / most) * r.grow.p);
      if (w > 0) g.fillStyle(player.main_color).fillRect(bar.x, bar.y, w, RESULT_BAR_H);
    }
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
    // the pop is right away, not when the server answers: it's for the click, and a refusal says so anyway
    if (action === "place") popForPlace(this);
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
    const cell = !this.modal && !p.wasTouch && this.view.contains(p.x, p.y) ? this.board.cellAt(p.x, p.y) : null;
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

  /**
   * Space plays or readies, + and - zoom, 0 resets the view, ? shows the rules, P the patterns, Enter types in the
   * chat, and Escape closes an overlay. Not while typing in a field.
   */
  private onKey(e: KeyboardEvent) {
    if (document.activeElement instanceof HTMLInputElement) return;
    if (this.modal) {
      if (["Escape", "Enter", " ", "?", "p", "P"].includes(e.key)) {
        e.preventDefault();
        this.closeRules();
        this.closePatterns();
      }
      return;
    }
    if (this.phase === "over") return;
    if (e.key === " ") {
      e.preventDefault();
      this.play();
    } else if (e.key === "?" || e.key === "h") this.openRules();
    else if (e.key === "p" || e.key === "P") this.openPatterns();
    else if (e.key === "m" || e.key === "M") this.toggleSound();
    else if (e.key === "Enter" && this.online) {
      e.preventDefault();
      this.chatBox.input.focus();
    } else if (e.key === "+" || e.key === "=") this.zoomAtCenter(this.zoom * ZOOM_STEP);
    else if (e.key === "-" || e.key === "_") this.zoomAtCenter(this.zoom / ZOOM_STEP);
    else if (e.key === "0") {
      this.zoom = 1;
      this.panX = this.panY = 0;
      this.applyView();
    }
  }

  /** Mute or unmute everything, sound effects and music; the volumes themselves are in Settings. */
  private toggleSound() {
    setMuted(!isMuted());
    this.drawSoundIcon();
  }

  /** A speaker on the sound button: with waves while sound is on, crossed out while it's off. */
  private drawSoundIcon() {
    const { rect } = this.soundButton;
    const cx = rect.x + ICON_BTN / 2;
    const cy = rect.y + ICON_BTN / 2;
    const g = this.soundIcon.clear().fillStyle(0xf8f5ff);
    // the speaker: a small box and its cone
    g.fillRect(cx - 10, cy - 4, 5, 8);
    g.fillTriangle(cx - 6, cy - 4, cx + 1, cy - 9, cx + 1, cy + 9).fillTriangle(cx - 6, cy - 4, cx + 1, cy + 9, cx - 6, cy + 4);
    g.lineStyle(2.5, 0xf8f5ff);
    if (!isMuted()) {
      for (const r of [5, 9]) g.beginPath().arc(cx + 1, cy, r, -Math.PI / 4, Math.PI / 4).strokePath();
    } else {
      g.lineBetween(cx + 4, cy - 4, cx + 10, cy + 4).lineBetween(cx + 4, cy + 4, cx + 10, cy - 4);
    }
  }

  /** The rules or the patterns are open over the game. */
  private get modal() {
    return !!this.rules || !!this.patterns;
  }

  /** Offline, an overlay pauses the game while it's open, so reading doesn't cost setup time. */
  private pauseForOverlay() {
    this.overlayResume = !this.online && !this.paused;
    if (this.overlayResume) this.setPaused(true);
  }

  private resumeAfterOverlay() {
    if (this.overlayResume) this.setPaused(false);
    this.overlayResume = false;
  }

  /** The how-to-play overlay. */
  private openRules() {
    if (this.modal || this.phase === "over") return;
    try {
      localStorage.setItem(RULES_SEEN_KEY, "1");
    } catch {
      // private browsing: it'll just open again next game
    }
    this.pauseForOverlay();
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
    this.showOnTop([rules.shade, rules.panel, rules.title, rules.body, rules.button.rect, rules.button.label]);
    this.syncDom();
    this.drawHover();
    this.layoutRules(this.scale.gameSize);
  }

  private closeRules() {
    if (!this.rules) return;
    const { shade, panel, title, body, button } = this.rules;
    for (const o of [shade, panel, title, body, button.rect, button.label]) o.destroy();
    this.rules = undefined;
    this.syncDom();
    this.resumeAfterOverlay();
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

  /** One of each basic kind of pattern, drawn and explained, from the tutorial's guide. */
  private openPatterns() {
    if (this.modal || this.phase === "over") return;
    this.pauseForOverlay();
    const font = fontFamily();
    const display = displayFont();
    const picks = this.patternPicks();
    const patterns: Patterns = {
      // interactive so it catches clicks meant for the board and sidebar underneath
      shade: this.add.rectangle(0, 0, 1, 1, 0x120e22, 0.75).setOrigin(0).setInteractive(),
      panel: this.add.rectangle(0, 0, 1, 1, PANEL_COLOR).setOrigin(0),
      title: this.add.text(0, 0, "Patterns", { fontFamily: display, fontSize: "28px", fontStyle: "bold", color: "#ffe03d" }),
      drawings: this.add.graphics(),
      names: picks.map((p) => this.add.text(0, 0, p.name, { fontFamily: display, fontSize: "16px", color: "#f8f5ff" })),
      kinds: picks.map((p) =>
        this.add.text(0, 0, p.kind, { fontFamily: font, fontSize: "13px", fontStyle: "bold", color: `#${p.color.toString(16).padStart(6, "0")}` }),
      ),
      abouts: picks.map((p) => this.add.text(0, 0, p.about, { fontFamily: font, fontSize: "13px", color: "#d4ccff", lineSpacing: 2 })),
      button: makeButton(this, "Close", PRIMARY, () => this.closePatterns()),
    };
    const objects = [patterns.shade, patterns.panel, patterns.title, patterns.drawings, ...patterns.names, ...patterns.kinds, ...patterns.abouts];
    for (const o of objects) o.setDepth(RESULTS_DEPTH);
    setButtonDepth(patterns.button, RESULTS_DEPTH);
    this.patterns = patterns;
    this.showOnTop([...objects, patterns.button.rect, patterns.button.label]);
    this.syncDom();
    this.drawHover();
    this.layoutPatterns(this.scale.gameSize);
  }

  private closePatterns() {
    if (!this.patterns) return;
    const { shade, panel, title, drawings, names, kinds, abouts, button } = this.patterns;
    for (const o of [shade, panel, title, drawings, ...names, ...kinds, ...abouts, button.rect, button.label]) o.destroy();
    this.patterns = undefined;
    this.syncDom();
    this.resumeAfterOverlay();
  }

  /** PATTERN_PICKS from the tutorial's guide, each in its section's colour. */
  private patternPicks() {
    const guide = GUIDE.flatMap((s) => s.patterns.map((p) => ({ ...p, color: s.color })));
    return PATTERN_PICKS.map(([kind, name]) => ({ kind, ...guide.find((p) => p.name === name)! }));
  }

  /** Patterns panel centred over the whole screen, two to a row; on a screen too short for it, without what each does. */
  private layoutPatterns({ width, height }: { width: number; height: number }) {
    const p = this.patterns!;
    const picks = this.patternPicks();
    const pw = Math.min(600, width - PAD * 2);
    const gap = 20;
    const itemW = (pw - 64 - gap) / 2;
    for (const t of p.abouts) t.setWordWrapWidth(itemW).setVisible(true);
    const itemH = (i: number) => PATTERN_DRAWING_H + 10 + p.names[i].height + p.kinds[i].height + (p.abouts[i].visible ? 6 + p.abouts[i].height : 0);
    const rowH = (row: number) => Math.max(itemH(row * 2), itemH(row * 2 + 1));
    const measure = () => 32 + p.title.height + 20 + rowH(0) + gap + rowH(1) + 28 + BTN_H + 32;
    if (measure() > height - PAD * 2) for (const t of p.abouts) t.setVisible(false);
    const ph = measure();
    const px = (width - pw) / 2;
    const py = Math.max(PAD, (height - ph) / 2);
    p.shade.setSize(width, height);
    (p.shade.input!.hitArea as Phaser.Geom.Rectangle).setTo(0, 0, width, height);
    p.panel.setPosition(px, py).setSize(pw, ph);
    p.title.setPosition(px + 32, py + 32);
    let y = py + 32 + p.title.height + 20;
    p.drawings.clear();
    for (const row of [0, 1]) {
      for (const i of [row * 2, row * 2 + 1]) {
        const x = px + 32 + (i % 2) * (itemW + gap);
        drawPattern(p.drawings, picks[i].cells, picks[i].color, x, y, itemW, PATTERN_DRAWING_H, 14);
        let ty = y + PATTERN_DRAWING_H + 10;
        p.names[i].setPosition(x, ty);
        ty += p.names[i].height;
        p.kinds[i].setPosition(x, ty);
        p.abouts[i].setPosition(x, ty + p.kinds[i].height + 6);
      }
      y += rowH(row) + gap;
    }
    layoutButton(p.button, px + 32, py + ph - 32 - BTN_H, pw - 64);
  }

  /**
   * The zoom field and the chat are HTML, so they'd sit on top of an overlay: they hide while one is open. The
   * sidebar's camera can't clip the zoom field either, so it hides once scrolled even partly out of view. Narrow
   * screens just use - and +.
   */
  private syncDom() {
    const top = this.zoomInput.y;
    const inView = top >= this.sidebarView.y && top + BTN_H <= this.sidebarView.bottom;
    const clear = !this.modal && !this.results;
    this.zoomInput.setVisible(this.wide && clear && inView);
    // the chat is made after the zoom field, so an early call can come before it exists
    this.chat?.setVisible(clear);
    if (!clear) this.chatBox?.blur();
  }

  /** Overlay objects show on the top camera only, above the board and the sidebar's contents. */
  private showOnTop(objects: Phaser.GameObjects.GameObject[]) {
    this.cameras.main.ignore(objects);
    this.sidebarCam.ignore(objects);
  }

  /** Scroll the sidebar's contents by dy, within what they have to show. */
  private scrollSidebar(dy: number) {
    this.sidebarScroll = Phaser.Math.Clamp(this.sidebarScroll + dy, 0, this.sidebarMaxScroll);
    const { x, y, width: w, height: h } = this.sidebarView;
    this.sidebarCam.setScroll(x, y + this.sidebarScroll);
    this.zoomInput.y = this.zoomY - this.sidebarScroll;
    // a thin bar along the panel's right edge, while there's more than fits
    const g = this.scrollbar.clear();
    if (this.sidebarMaxScroll > 0) {
      const track = h - 16;
      const bar = Math.max(24, (track * h) / (h + this.sidebarMaxScroll));
      g.fillStyle(0xf8f5ff, 0.25).fillRect(x + w - 7, y + 8 + ((track - bar) * this.sidebarScroll) / this.sidebarMaxScroll, 3, bar);
    }
    this.syncDom();
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
      "• Three different colours around one empty tile? Players take turns being first in line, a new player each generation, and the tile goes to whichever of the three is first in line.",
      `• Live cells claim the land ${CLAIM_RADIUS} tiles around them.`,
      `• Every ${GRANT_EVERY} generations: ${PLACE_MS / 1000}s to place, +${ROUND_RESOURCES} cells, plus the cube root of land gained.`,
      this.mode === "ctf"
        ? `• Capture the flag: if a rival's land covers your flag, you're out. Last colony standing wins; after generation ${this.finalGeneration}, the most land.`
        : `• After generation ${this.finalGeneration}, whoever holds the most land wins.`,
      "• Drag to pan, scroll or + / − to zoom, 0 to reset. Space to ready up, ? for these rules, P for patterns.",
    ].join("\n");
  }

  /**
   * Each badge's picture, for players who have one: online, from the room's lobby (by seat); offline, yours, from your
   * profile. Bots and guests keep their letter, as does anyone whose picture can't be loaded.
   */
  private loadBadgePictures() {
    const online = Online.get();
    this.players.forEach((player, i) => {
      const avatar = this.online ? this.online.lobby?.members.find((m) => m.seat === i)?.avatar : player === this.human ? online.profile?.avatar : null;
      const url = online.pictureUrl(avatar);
      if (!url) return;
      const badge = this.badges[i];
      void avatarTexture(this, url).then((key) => {
        // the game may be over and gone by the time a slow picture arrives
        if (!key || !badge.picture.active) return;
        const { displayWidth, displayHeight } = badge.picture;
        badge.picture.setTexture(key).setDisplaySize(displayWidth, displayHeight).setVisible(true);
        badge.letter.setVisible(false);
      });
    });
  }

  /** A player's own name: the board calls you "You", but your badge's letter is your username or guest name. */
  private realName(i: number) {
    if (this.online) return this.online.state?.players[i]?.name ?? this.players[i].name;
    return this.players[i] === this.human ? (Online.get().player ?? this.human.name) : this.players[i].name;
  }

  /** Each badge's name and cells to place; a captured player's badge fades. */
  private updatePlayerTexts() {
    this.players.forEach((p, i) => {
      // who's been captured; online, also who's dropped out and who's done placing
      const info = this.online?.state?.players[i];
      const tags = [p.captured_at !== null && "captured", info && !info.connected && "offline", this.placing && info?.ready && "ready"].filter(Boolean);
      const { disc, letter, picture, name, count } = this.badges[i];
      const maxW = this.badgeTextW[i] ?? 0;
      fitText(name, `${p.name}${tags.length ? ` (${tags.join(", ")})` : ""}`, maxW);
      // a small board leaves room for just the number
      count.setText(`${p.resources} to place`);
      if (maxW > 0 && count.width > maxW) count.setText(String(p.resources));
      for (const o of [disc, letter, picture, name, count]) o.setAlpha(p.captured_at === null ? 1 : 0.4);
    });
  }

  /**
   * Each player's badge at their corner of the board, in the band above or below it: their initial on a disc in their
   * colour (yours ringed in yellow), then their name and cells to place, reading in toward the middle.
   */
  private layoutBadges() {
    const band = this.badgeBand;
    const r = band / 2 - 4;
    const { x, y, right, bottom } = this.view;
    // a band shared by two badges gives each half its width; a badge alone in its band has all of it
    const top = (c: number) => c < 2;
    this.badgeTextW = this.corners.map((c) => {
      const shared = this.corners.some((o) => o !== c && top(o) === top(c));
      return (shared ? this.view.width / 2 : this.view.width - MARGIN) - MARGIN - r * 2 - 18;
    });
    this.badges.forEach(({ disc, letter, picture, name, count }, i) => {
      const corner = this.corners[i];
      const left = corner === 0 || corner === 3;
      const cx = left ? x + MARGIN + r : right - MARGIN - r;
      const cy = top(corner) ? y - band / 2 : bottom + band / 2;
      disc.clear().fillStyle(this.players[i].main_color).fillCircle(cx, cy, r);
      disc.lineStyle(3, this.players[i] === this.human ? 0xffe03d : BADGE_RING).strokeCircle(cx, cy, r);
      letter.setFontSize(Math.round(r * 1.1)).setPosition(cx, cy);
      // inside the ring, which stays drawn around it
      picture.setPosition(cx, cy).setDisplaySize(r * 2 - 4, r * 2 - 4);
      const tx = left ? cx + r + 10 : cx - r - 10;
      name.setOrigin(left ? 0 : 1, 1).setPosition(tx, cy + 1);
      count.setOrigin(left ? 0 : 1, 0).setPosition(tx, cy - 1);
    });
    this.updatePlayerTexts();
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
   * Board on the left, sidebar on the right, with the players' badges in bands above and below the board. On narrow
   * screens the sidebar drops below the board and compacts: zoom is just - and + beside Play and Stop. The chat
   * sits at the sidebar's foot and stays put; the controls above it scroll if they don't fit.
   */
  private layout({ width, height }: Phaser.Structs.Size) {
    let size: number, bx: number, by: number;
    let sx: number, sy: number, sh: number;
    const wide = (this.wide = width >= 720);
    // wide enough for the mode's name beside Quit, in the display font
    const sw = wide ? Phaser.Math.Clamp(width * 0.24, 260, 320) : width - PAD * 2;
    const gap = 12;
    const band = (this.badgeBand = wide ? BADGE_BAND : BADGE_BAND_NARROW);
    const patternsY = wide ? 284 : 180;

    // wrap first: a title that wraps pushes everything below it down. It leaves room for Rules and Quit.
    const titleW = sw - 40 - ICON_BTN * 3 - ICON_GAP * 2 - 12;
    this.title.setFontSize(24).setWordWrapWidth(titleW);
    // a word longer than the room ("Strongest") can't wrap, so the title shrinks until each word fits
    for (let size = 24; this.title.width > titleW && size > 16; ) this.title.setFontSize(--size);
    const extra = Math.max(0, this.title.height - this.titleLineH);
    // the sidebar has room for a reminder of the controls only beside the board
    this.hint.setVisible(wide).setWordWrapWidth(sw - 40);
    // from the sidebar's top to the bottom of the controls
    const controlsH = extra + patternsY + BTN_H + (wide ? 16 + this.hint.height : 0) + 20;

    if (wide) {
      const areaW = width - sw - PAD * 3;
      size = Math.min(areaW, height - PAD * 2 - band * 2);
      bx = PAD + (areaW - size) / 2;
      by = (height - size) / 2;
      sx = width - PAD - sw;
      sy = PAD;
      sh = height - PAD * 2;
      // on a short window the controls still keep some of the panel (and scroll)
      this.chatH = Math.min(Math.max(CHAT_MIN_H, sh - controlsH), sh * 0.6);
    } else {
      this.chatH = CHAT_NARROW_H;
      sh = controlsH + this.chatH;
      size = Math.max(120, Math.min(width - PAD * 2, height - sh - PAD * 3 - band * 2));
      bx = (width - size) / 2;
      by = PAD + band;
      sx = PAD;
      sy = by + size + band + PAD;
    }

    this.view.setTo(bx, by, size, size);
    this.applyView();

    this.sidebar.setPosition(sx, sy).setSize(sw, sh);
    this.title.setPosition(sx + 20, sy + 20);
    // [sound] [?] [×] in the top corner
    const qx = sx + sw - 20 - ICON_BTN;
    layoutButton(this.quitButton, qx, sy + 14, ICON_BTN, ICON_BTN);
    layoutButton(this.rulesButton, qx - ICON_GAP - ICON_BTN, sy + 14, ICON_BTN, ICON_BTN);
    layoutButton(this.soundButton, qx - (ICON_GAP + ICON_BTN) * 2, sy + 14, ICON_BTN, ICON_BTN);
    this.drawSoundIcon();
    const [cx, cy, arm] = [qx + ICON_BTN / 2, sy + 14 + ICON_BTN / 2, 7];
    this.quitIcon.clear().lineStyle(4, 0xf8f5ff);
    this.quitIcon.lineBetween(cx - arm, cy - arm, cx + arm, cy + arm).lineBetween(cx - arm, cy + arm, cx + arm, cy - arm);
    // everything under the title starts lower by however much the title wrapped
    const top = sy + extra;
    this.generationText.setPosition(sx + 20, top + 58);
    this.phaseText.setPosition(sx + 20, top + 82);

    this.zoomLabel.setVisible(wide);
    this.syncDom();
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
      this.zoomY = zy;
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

    layoutButton(this.patternsButton, sx + 20, top + patternsY, sw - 40);
    this.hint.setPosition(sx + 20, top + patternsY + BTN_H + 16);
    this.layoutBadges();

    // the chat, pinned to the panel's foot
    const chatTop = sy + sh - this.chatH;
    this.chat.setPosition(sx + 20, chatTop);
    Object.assign((this.chat.node as HTMLElement).style, { width: `${sw - 40}px`, height: `${this.chatH - 20}px` });
    // the controls get the rest of the panel; whatever doesn't fit scrolls inside it
    this.sidebarView.setTo(sx, sy, sw, chatTop - sy);
    this.sidebarMaxScroll = Math.max(0, controlsH - (chatTop - sy));
    this.sidebarCam.setViewport(sx, sy, sw, chatTop - sy);
    this.overlayCam.setViewport(0, 0, width, height);
    this.scrollSidebar(0);

    if (this.results) this.layoutResults({ width, height });
    if (this.rules) this.layoutRules({ width, height });
    if (this.patterns) this.layoutPatterns({ width, height });
  }

  /** Results panel centred over the whole screen: the crowned winner, the headline, then a row per player. */
  private layoutResults({ width, height }: { width: number; height: number }) {
    const r = this.results!;
    const pw = Math.min(520, width - PAD * 2);
    const inner = pw - 48;
    // wrap before measuring, so a long headline makes the panel taller
    r.title.setWordWrapWidth(inner);
    r.subtitle.setWordWrapWidth(inner);
    const crownH = r.crownInitial.visible ? CROWN_R * 2 + 26 : 0;
    const rowH = (row: ResultRow) => 52 + (row.note.text ? 18 : 0);
    const rowsH = r.rows.reduce((h, row) => h + rowH(row) + 6, 0) - 6;
    const footerH = r.footer.text ? r.footer.height + 12 : 0;
    const ph = 28 + crownH + r.title.height + 6 + r.subtitle.height + 22 + rowsH + 20 + footerH + BTN_H + 28;
    const px = (width - pw) / 2;
    const py = Math.max(PAD, (height - ph) / 2);
    const cx = width / 2;
    r.shade.setSize(width, height);
    (r.shade.input!.hitArea as Phaser.Geom.Rectangle).setTo(0, 0, width, height);
    r.panel.setPosition(px, py).setSize(pw, ph).setStrokeStyle(3, r.winnerColor);

    let y = py + 28;
    // the winner's disc with a crown over it
    r.crown.clear();
    if (r.crownInitial.visible) {
      const dy = y + 22 + CROWN_R;
      for (let i = 3; i >= 1; i--) r.crown.fillStyle(r.winnerColor, 0.12).fillCircle(cx, dy, CROWN_R * (1 + i * 0.12));
      r.crown.fillStyle(r.winnerColor).fillCircle(cx, dy, CROWN_R).lineStyle(3, 0xffe03d).strokeCircle(cx, dy, CROWN_R);
      const top = dy - CROWN_R - 4;
      const crown = [
        [cx - 20, top],
        [cx - 22, top - 18],
        [cx - 9, top - 8],
        [cx, top - 24],
        [cx + 9, top - 8],
        [cx + 22, top - 18],
        [cx + 20, top],
      ].map(([px2, py2]) => new Phaser.Math.Vector2(px2, py2));
      r.crown.fillStyle(0xffe03d).fillPoints(crown, true);
      r.crownInitial.setPosition(cx, dy);
      y += crownH;
    }
    r.title.setPosition(cx, y);
    y += r.title.height + 6;
    r.subtitle.setPosition(cx, y);
    y += r.subtitle.height + 22;

    const x = px + 24;
    for (const row of r.rows) {
      const h = rowH(row);
      row.bg.setPosition(x - 8, y).setSize(inner + 16, h);
      const my = y + 26;
      // the place: a gold, silver or bronze medal, or a plain ring
      const medal = MEDALS[Number(row.place.text) - 1];
      const g = row.marks.clear();
      if (medal !== undefined) g.fillStyle(medal).fillCircle(x + 16, my, 15);
      else g.lineStyle(2, 0x5b4b9a).strokeCircle(x + 16, my, 14);
      row.place.setPosition(x + 16, my).setColor(medal !== undefined ? "#120e22" : "#d4ccff");
      // the player's disc, as on the board
      g.fillStyle(row.player.main_color).fillCircle(x + 54, my, 16);
      if (row.player === this.human) g.lineStyle(2, 0xffe03d).strokeCircle(x + 54, my, 16);
      row.initial.setPosition(x + 54, my);
      // name and land on a line, the bar under them, then the note
      const tx = x + 82;
      const right = x + inner;
      row.land.setPosition(right, y + 8);
      // a long name gets an ellipsis before it reaches the land
      fitText(row.name.setPosition(tx, y + 8), row.player.name, right - tx - row.land.width - 12);
      row.bar = { x: tx, y: y + 34, w: right - tx };
      row.note.setPosition(tx, y + 48);
      y += h + 6;
    }
    this.drawResultBars();
    y += 14;
    if (r.footer.text) {
      r.footer.setPosition(cx, y);
      y += r.footer.height + 12;
    }
    layoutButton(r.button, px + 24, py + ph - 28 - BTN_H, inner);
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

/** 1st, 2nd, 3rd, 4th. */
function ordinal(n: number) {
  return `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4] ?? "th"}`;
}

/** A results row's objects, for depth, cameras and the entrance. */
function rowObjects(row: ResultRow): (Phaser.GameObjects.Rectangle | Phaser.GameObjects.Graphics | Phaser.GameObjects.Text)[] {
  return [row.bg, row.marks, row.place, row.initial, row.name, row.land, row.note];
}

/** The first letter or digit of a name, capitalised; "?" if it has none. */
function initial(name: string) {
  return (name.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();
}

/** Set `text`, cut short with an ellipsis if it's wider than `maxW`. */
function fitText(t: Phaser.GameObjects.Text, text: string, maxW: number) {
  t.setText(text);
  if (maxW <= 0) return;
  for (let n = text.length - 1; t.width > maxW && n > 0; n--) t.setText(`${text.slice(0, n).trimEnd()}…`);
}

function readRulesSeen() {
  try {
    return localStorage.getItem(RULES_SEEN_KEY) !== null;
  } catch {
    return true;
  }
}
