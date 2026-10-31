import * as Phaser from "phaser";
import Ai from "../Ai";
import Board, { CLAIM_RADIUS } from "../Board";
import type Cell from "../Cell";
import Player, { PALETTE } from "../Player";
import { BTN_H, type Button, fontFamily, layoutButton, makeButton, PANEL_COLOR, PRIMARY, SECONDARY, setButtonDepth } from "../ui";

const PAD = 24;
const GENERATION_MS = 120;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
// zoom factor per wheel pixel; one mouse notch (~100px) is about 10%
const ZOOM_SPEED = 0.001;
// zoom factor per click of the sidebar's - / + buttons
const ZOOM_STEP = 1.25;
// pixels the pointer must move before a press becomes a pan instead of a click
const DRAG_THRESHOLD = 4;
const FRAME_COLOR = 0xfff2a1;
const FRAME_WIDTH = 10;
// empty space outside the frame, visible at the starting zoom and when panned to an edge
const MARGIN = 10;
// distance from the view's edge to the board at the starting zoom
const INSET = FRAME_WIDTH + MARGIN;

const START_RESOURCES = 10;
// each round every player gets ROUND_RESOURCES cells, plus floor(cbrt(territory gained since last round))
const ROUND_RESOURCES = 5;
// each player starts with a START_TERRITORY x START_TERRITORY corner
const START_TERRITORY = 7;
// generations between placement phases (and resource grants)
const GRANT_EVERY = 50;
// the game ends after this generation; the player with the most land wins
export const FINAL_GENERATION = 1000;
const SETUP_MS = 30_000;
const PLACE_MS = 15_000;
// an AI places one cell every AI_PLACE_MIN_MS..AI_PLACE_MAX_MS during a placement phase
const AI_PLACE_MIN_MS = 150;
const AI_PLACE_MAX_MS = 500;
// corners clockwise from the human's top-left: one opponent sits across the board, two take the corners beside you
const AI_CORNERS: Record<number, number[]> = { 1: [2], 2: [1, 3], 3: [1, 2, 3] };
const PLAYER_ROW_H = 46;
// the results panel draws over everything else
const RESULTS_DEPTH = 10;

/** setup: the opening placement window; placing: the window every GRANT_EVERY generations; running: the simulation; over: past FINAL_GENERATION. */
type Phase = "setup" | "placing" | "running" | "over";

/** Chosen in the lobby. */
export type GameSettings = {
  /** Index into PALETTE of the human's colour. */
  color: number;
  /** Number of AI opponents, 1 to 3. */
  opponents: number;
};

type Results = {
  shade: Phaser.GameObjects.Rectangle;
  panel: Phaser.GameObjects.Rectangle;
  title: Phaser.GameObjects.Text;
  standings: Phaser.GameObjects.Text;
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

  private sidebar!: Phaser.GameObjects.Rectangle;
  private title!: Phaser.GameObjects.Text;
  // the title's height on one line, to tell how much it grows when it wraps
  private titleLineH!: number;
  private quitText!: Phaser.GameObjects.Text;
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
  private instructions!: Phaser.GameObjects.Text;
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
  init(settings: GameSettings) {
    this.settings = settings;
    this.playerSwatches = [];
    this.playerTexts = [];
    this.results = undefined;
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

    this.graphics = this.add.graphics();
    this.frame = this.add.graphics();
    this.board = new Board(0, 0, 1, 50);
    this.createPlayers();

    this.sidebar = this.add.rectangle(0, 0, 1, 1, PANEL_COLOR).setOrigin(0);
    this.title = this.add.text(0, 0, "Cellulose", { fontFamily: font, fontSize: "24px", fontStyle: "bold", color: "#f8f5ff" });
    this.titleLineH = this.title.height;
    this.quitText = this.add
      .text(0, 0, "Quit", { fontFamily: font, fontSize: "16px", fontStyle: "bold", color: "#d4ccff" })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => this.quitText.setColor("#ffe03d"))
      .on("pointerout", () => this.quitText.setColor("#d4ccff"))
      .on("pointerdown", () => this.toLobby());
    this.generationText = this.add.text(0, 0, "", { fontFamily: font, fontSize: "16px", color: "#d4ccff" });
    this.phaseText = this.add.text(0, 0, "", { fontFamily: font, fontSize: "16px", fontStyle: "bold", color: "#ffe03d" });
    this.playButton = makeButton(this, "Play", PRIMARY, () => this.play());
    this.stopButton = makeButton(this, "Stop", SECONDARY, () => this.setPaused(true));

    this.zoomLabel = this.add.text(0, 0, "Zoom", { fontFamily: font, fontSize: "16px", color: "#d4ccff" });
    this.zoomOutButton = makeButton(this, "−", SECONDARY, () => this.zoomAtCenter(this.zoom / ZOOM_STEP));
    this.zoomInButton = makeButton(this, "+", SECONDARY, () => this.zoomAtCenter(this.zoom * ZOOM_STEP));
    this.zoomInput = this.add.dom(0, 0, this.makeZoomInput(font)).setOrigin(0);

    for (const p of this.players) {
      this.playerSwatches.push(this.add.rectangle(0, 0, 14, 14, p.main_color).setOrigin(0));
      this.playerTexts.push(this.add.text(0, 0, "", { fontFamily: font, fontSize: "14px", color: "#f8f5ff", lineSpacing: 2 }));
    }
    this.instructions = this.add.text(0, 0, this.instructionsText(), { fontFamily: font, fontSize: "13px", color: "#d4ccff", lineSpacing: 3 });

    // drag pans the board; a click (press and release without dragging) places or takes back a cell
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.pressed = this.phase !== "over" && this.view.contains(p.x, p.y);
      this.panning = false;
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.pressed || !p.isDown) return;
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
      this.input.setDefaultCursor("default");
    };
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => release(p, true));
    this.input.on("pointerupoutside", (p: Phaser.Input.Pointer) => release(p, false));

    // scroll to zoom, keeping the point under the cursor fixed
    this.input.on("wheel", (p: Phaser.Input.Pointer, _objs: unknown, _dx: number, dy: number) => {
      if (this.phase === "over" || !this.view.contains(p.x, p.y)) return;
      this.zoomAt(this.zoom * Math.exp(-dy * ZOOM_SPEED), p.x, p.y);
    });

    this.ticker = this.time.addEvent({
      delay: GENERATION_MS,
      loop: true,
      paused: true,
      callback: () => {
        this.board.step();
        this.board.claimTerritory();
        this.generation++;
        if (this.generation >= FINAL_GENERATION) this.finish();
        else if (this.generation % GRANT_EVERY === 0) {
          this.grantResources();
          this.startPhase("placing", PLACE_MS);
        }
        this.updateGenerationText();
        this.updatePhaseText();
        this.updatePlayerTexts();
        this.board.draw(this.graphics, this.view);
      },
    });

    this.startPhase("setup", SETUP_MS);
    this.updateGenerationText();
    this.layout(this.scale.gameSize);

    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this));
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
    });
    this.human = this.players[0];
    this.ais = this.players.filter((p) => p.is_ai).map((p) => new Ai(p, this.board));
  }

  /** Back to the lobby with the same settings, ready for another game. */
  private toLobby() {
    this.scene.start("LobbyScene", this.settings);
  }

  /** Play resumes when paused; during a placement phase it ends the phase early ("Ready"). */
  private play() {
    if (this.phase === "over") return;
    if (this.paused) this.setPaused(false);
    else if (this.phase !== "running") this.endPhase();
  }

  private setPaused(paused: boolean) {
    if (this.phase === "over") return;
    this.paused = paused;
    this.syncTicker();
  }

  /** The simulation only runs outside placement phases and while not paused. */
  private syncTicker() {
    this.ticker.paused = this.paused || this.phase !== "running";
    const over = this.phase === "over";
    const playActive = !over && (this.paused || this.phase !== "running");
    const stopActive = !over && !this.paused;
    this.playButton.label.setText(!this.paused && (this.phase === "setup" || this.phase === "placing") ? "Ready" : "Play");
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
    this.board.draw(this.graphics, this.view);
  }

  /** Stop the simulation and show who claimed the most land. */
  private finish() {
    this.phase = "over";
    this.syncTicker();
    // the zoom field is HTML, so it would sit on top of the results panel
    this.zoomInput.setVisible(false);
    this.input.setDefaultCursor("default");

    const land = new Map(this.players.map((p) => [p, this.board.territoryOf(p)]));
    const ranked = [...this.players].sort((a, b) => land.get(b)! - land.get(a)!);
    const best = land.get(ranked[0])!;
    const winners = ranked.filter((p) => land.get(p) === best);
    let headline: string;
    if (winners.length > 1) headline = winners.includes(this.human) ? "It's a draw!" : "No winner: a draw";
    else headline = winners[0] === this.human ? "You win!" : `${winners[0].name} wins`;
    const standings = ranked.map((p, i) => `${i + 1}.  ${p.name}: ${land.get(p)} land`).join("\n");

    const font = fontFamily();
    const results: Results = {
      // interactive so it catches clicks meant for the sidebar buttons underneath
      shade: this.add.rectangle(0, 0, 1, 1, 0x120e22, 0.75).setOrigin(0).setInteractive(),
      panel: this.add.rectangle(0, 0, 1, 1, PANEL_COLOR).setOrigin(0),
      title: this.add.text(0, 0, headline, { fontFamily: font, fontSize: "32px", fontStyle: "bold", color: "#ffe03d", align: "center" }).setOrigin(0.5, 0),
      standings: this.add.text(0, 0, standings, { fontFamily: font, fontSize: "18px", color: "#f8f5ff", lineSpacing: 8 }).setOrigin(0.5, 0),
      button: makeButton(this, "Back to lobby", PRIMARY, () => this.toLobby()),
    };
    for (const o of [results.shade, results.panel, results.title, results.standings]) o.setDepth(RESULTS_DEPTH);
    setButtonDepth(results.button, RESULTS_DEPTH);
    this.results = results;
    this.layoutResults(this.scale.gameSize);
  }

  /** Every player earns ROUND_RESOURCES cells plus floor(cbrt(territory gained since the last grant)). */
  private grantResources() {
    for (const p of this.players) {
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
    if (this.paused || this.phase === "running" || this.phase === "over") return;
    const p = this.human;
    if (cell.is_alive && cell.owner === p) {
      cell.is_alive = false;
      cell.owner = null;
      if (this.placedThisPhase.delete(cell)) p.resources++;
    } else if (!cell.is_alive && cell.territory === p && p.resources > 0) {
      this.place(p, cell);
    } else {
      return;
    }
    this.updatePlayerTexts();
    this.board.draw(this.graphics, this.view);
  }

  /** Let an AI place its next cell. False if it has nothing it can place. */
  private aiPlace(ai: Ai): boolean {
    return ai.step((cell) => this.place(ai.player, cell));
  }

  private randomAiDelay() {
    return Phaser.Math.Between(AI_PLACE_MIN_MS, AI_PLACE_MAX_MS);
  }

  private updateGenerationText() {
    this.generationText.setText(`Generation ${this.generation} / ${FINAL_GENERATION}`);
  }

  private updatePhaseText() {
    const secs = Math.ceil(this.phaseLeft / 1000);
    const nextGrant = GRANT_EVERY - (this.generation % GRANT_EVERY);
    let text: string;
    if (this.phase === "over") text = "Game over";
    else if (this.paused) text = "Paused";
    else if (this.phase === "setup") text = `Setup: place cells (${secs}s)`;
    else if (this.phase === "placing") text = `Place cells (${secs}s)`;
    else if (this.generation + nextGrant >= FINAL_GENERATION) text = `Game ends in ${FINAL_GENERATION - this.generation} gens`;
    else text = `Next placement in ${nextGrant} gens`;
    this.phaseText.setText(text);
  }

  private instructionsText() {
    return [
      "HOW TO PLAY",
      "• Place cells inside your outlined territory during setup and placement windows. Click your own cell to remove it.",
      "• A cell lives on with 2 or 3 neighbours. An empty tile with exactly 3 comes alive for the colour with the most of them.",
      `• Live cells claim the land ${CLAIM_RADIUS} tiles around them.`,
      `• Every ${GRANT_EVERY} generations: ${PLACE_MS / 1000}s to place, +${ROUND_RESOURCES} cells, plus the cube root of land gained.`,
      `• After generation ${FINAL_GENERATION}, whoever holds the most land wins.`,
      "• Drag to pan, scroll to zoom.",
    ].join("\n");
  }

  private updatePlayerTexts() {
    this.players.forEach((p, i) => {
      const stats = `${p.resources} to place · ${this.board.territoryOf(p)} land · ${this.board.liveCellsOf(p)} alive`;
      this.playerTexts[i].setText(`${p.name}\n${stats}`);
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
    this.board.draw(this.graphics, this.view);
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

  /** Board on the left, sidebar on the right. On narrow screens the sidebar drops below the board. */
  private layout({ width, height }: Phaser.Structs.Size) {
    let size: number, bx: number, by: number;
    let sx: number, sy: number, sh: number;
    const wide = width >= 720;
    const sw = wide ? Phaser.Math.Clamp(width * 0.24, 200, 320) : width - PAD * 2;

    // wrap first: a title that wraps pushes everything below it down, and the narrow
    // sidebar must be tall enough for the instructions. The title leaves room for Quit.
    this.title.setWordWrapWidth(sw - 100);
    this.instructions.setWordWrapWidth(sw - 40);
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
      sh = extra + 300 + PLAYER_ROW_H * this.players.length + this.instructions.height + 20;
      size = Math.min(width - PAD * 2, height - sh - PAD * 3);
      bx = (width - size) / 2;
      by = PAD;
      sx = PAD;
      sy = by + size + PAD;
    }

    this.view.setTo(bx, by, size, size);
    this.applyView();

    this.sidebar.setPosition(sx, sy).setSize(sw, sh);
    this.title.setPosition(sx + 20, sy + 20);
    this.quitText.setPosition(sx + sw - 20, sy + 26);
    // everything under the title starts lower by however much the title wrapped
    const top = sy + extra;
    this.generationText.setPosition(sx + 20, top + 58);
    this.phaseText.setPosition(sx + 20, top + 82);

    // Play and Stop side by side
    const gap = 12;
    const btnW = (sw - 40 - gap) / 2;
    layoutButton(this.playButton, sx + 20, top + 116, btnW);
    layoutButton(this.stopButton, sx + 20 + btnW + gap, top + 116, btnW);

    // Zoom: [-] [ 150% ] [+]
    this.zoomLabel.setPosition(sx + 20, top + 186);
    const zy = top + 212;
    const inputW = sw - 40 - (BTN_H + gap) * 2;
    layoutButton(this.zoomOutButton, sx + 20, zy, BTN_H);
    this.zoomInput.setPosition(sx + 20 + BTN_H + gap, zy);
    (this.zoomInput.node as HTMLInputElement).style.width = `${inputW}px`;
    layoutButton(this.zoomInButton, sx + sw - 20 - BTN_H, zy, BTN_H);

    // one row per player: colour swatch, name, then stats
    this.players.forEach((_, i) => {
      const py = top + 290 + i * PLAYER_ROW_H;
      this.playerSwatches[i].setPosition(sx + 20, py + 2);
      this.playerTexts[i].setPosition(sx + 42, py).setWordWrapWidth(sw - 62);
    });
    this.updatePlayerTexts();

    this.instructions.setPosition(sx + 20, top + 300 + PLAYER_ROW_H * this.players.length);
    if (this.results) this.layoutResults({ width, height });
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
      this.board.draw(this.graphics, this.view);
    }
    this.updatePhaseText();
  }
}
