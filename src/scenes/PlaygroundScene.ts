import * as Phaser from "phaser";
import Board from "../Board";
import type Cell from "../Cell";
import Player, { PALETTE } from "../Player";
import { isMuted, loadSounds, popForBirths, popForPlace, setMuted } from "../sound";
import {
  BTN_H,
  type Button,
  displayFont,
  fitHeight,
  fontFamily,
  keepWheel,
  layoutButton,
  makeButton,
  PANEL_COLOR,
  PRIMARY,
  SECONDARY,
  setButtonStyle,
  textInput,
} from "../ui";
import {
  DRAG_THRESHOLD,
  FINAL_GENERATION,
  FRAME_COLOR,
  FRAME_WIDTH,
  GENERATION_MS,
  HOVER_PLACE_ALPHA,
  INSET,
  MAX_ZOOM,
  MIN_ZOOM,
  NOTICE_MS,
  REMOVE_COLOR,
  ZOOM_SPEED,
  ZOOM_STEP,
} from "./GameScene";

const PAD = 24;
const GAP = 12;
// how much faster than the game's own pace (one generation every GENERATION_MS) the board can run
const SPEEDS = [1, 2, 4, 8, 16];
// after a stall (e.g. the tab was hidden), catch up at most this many generations in one frame
const MAX_STEPS_PER_FRAME = 8;
const MAX_GENERATIONS = 99_999;
// space for a label above each row of controls, beside the board
const LABEL_H = 26;

/**
 * A sandbox for Conway's Game of Life: draw cells in any of the colours, then play, pause, speed up or clear.
 * It runs up to a generation limit you choose. Colours mix as in a game (a new cell takes the colour most of
 * its parents share), but there's no territory, no turns and no opponents.
 */
export default class PlaygroundScene extends Phaser.Scene {
  constructor() {
    super("PlaygroundScene");
  }

  private board!: Board;
  private graphics!: Phaser.GameObjects.Graphics;
  // what a click on the tile under the mouse would do: draw a cell or erase one
  private hoverGraphics!: Phaser.GameObjects.Graphics;
  private frame!: Phaser.GameObjects.Graphics;
  /** One per palette colour: the board gives every live cell an owner, and that's what colours it. */
  private colors!: Player[];
  /** Index into colors of the one clicks draw with. */
  private color!: number;
  private generation!: number;
  /** Running stops here; raise it to keep going. */
  private limit!: number;
  private speed!: number;
  private running!: boolean;
  // ms owed to the simulation since the last generation
  private elapsed!: number;
  private notice!: string;
  private noticeLeft!: number;

  private sidebar!: Phaser.GameObjects.Rectangle;
  private title!: Phaser.GameObjects.Text;
  private backText!: Phaser.GameObjects.Text;
  private generationText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private playButton!: Button;
  private pauseButton!: Button;
  private clearButton!: Button;
  private speedLabel!: Phaser.GameObjects.Text;
  private speedButtons!: Button[];
  private colorLabel!: Phaser.GameObjects.Text;
  private swatches!: Button[];
  private limitLabel!: Phaser.GameObjects.Text;
  // an HTML input so the generation limit can be typed in
  private limitInput!: Phaser.GameObjects.DOMElement;
  private zoomLabel!: Phaser.GameObjects.Text;
  private zoomOutButton!: Button;
  private zoomInButton!: Button;
  private hint!: Phaser.GameObjects.Text;

  /** Screen area the board is shown in; the board itself may be larger (zoomed) and offset (panned). */
  private view!: Phaser.Geom.Rectangle;
  private zoom!: number;
  // board top-left relative to the view, as a fraction of view size so it survives resizes
  private panX!: number;
  private panY!: number;
  // pressed: the pointer went down on the board; panning: it has since moved far enough to count as a drag
  private pressed!: boolean;
  private panning!: boolean;

  /** Phaser reuses the scene object, so every visit starts from an empty board here. */
  init() {
    this.color = 0;
    this.generation = 0;
    this.limit = FINAL_GENERATION.strongest500;
    this.speed = 1;
    this.running = false;
    this.elapsed = 0;
    this.notice = "";
    this.noticeLeft = 0;
    this.view = new Phaser.Geom.Rectangle();
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.pressed = false;
    this.panning = false;
  }

  preload() {
    loadSounds(this);
  }

  create() {
    const font = fontFamily();
    const display = displayFont();
    const labelStyle = { fontFamily: display, fontSize: "16px", fontStyle: "bold", color: "#d4ccff" };

    this.graphics = this.add.graphics();
    this.hoverGraphics = this.add.graphics();
    this.frame = this.add.graphics();
    this.board = new Board(0, 0, 1);
    this.colors = PALETTE.map((p) => new Player(p.name, p.color, false, 0));

    this.sidebar = this.add.rectangle(0, 0, 1, 1, PANEL_COLOR).setOrigin(0);
    this.title = this.add.text(0, 0, "Playground", { fontFamily: display, fontSize: "24px", fontStyle: "bold", color: "#f8f5ff" });
    this.backText = this.add
      .text(0, 0, "Back", { fontFamily: display, fontSize: "16px", fontStyle: "bold", color: "#d4ccff" })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => this.backText.setColor("#ffe03d"))
      .on("pointerout", () => this.backText.setColor("#d4ccff"))
      .on("pointerdown", () => this.scene.start("HomeScene"));
    this.generationText = this.add.text(0, 0, "", { fontFamily: font, fontSize: "16px", color: "#d4ccff" });
    this.statusText = this.add.text(0, 0, "", { fontFamily: font, fontSize: "16px", fontStyle: "bold", color: "#ffe03d" });
    this.playButton = makeButton(this, "Play", PRIMARY, () => this.setRunning(true));
    this.pauseButton = makeButton(this, "Pause", SECONDARY, () => this.setRunning(false));
    this.clearButton = makeButton(this, "Clear", SECONDARY, () => this.clear());

    this.speedLabel = this.add.text(0, 0, "Speed", labelStyle);
    this.speedButtons = SPEEDS.map((s) =>
      makeButton(this, `${s}×`, SECONDARY, () => {
        this.speed = s;
        this.refresh();
      }),
    );
    for (const b of [this.playButton, this.pauseButton, this.clearButton, ...this.speedButtons]) b.label.setFontSize(17);
    this.colorLabel = this.add.text(0, 0, "", labelStyle);
    this.swatches = this.colors.map((p, i) => makeButton(this, "", { fill: p.main_color, hover: p.main_color, text: "#120e22" }, () => this.pickColor(i)));

    this.limitLabel = this.add.text(0, 0, "Generations", labelStyle);
    this.limitInput = this.add.dom(0, 0, this.makeLimitInput(font)).setOrigin(0);
    this.zoomLabel = this.add.text(0, 0, "", labelStyle);
    this.zoomOutButton = makeButton(this, "−", SECONDARY, () => this.zoomAtCenter(this.zoom / ZOOM_STEP));
    this.zoomInButton = makeButton(this, "+", SECONDARY, () => this.zoomAtCenter(this.zoom * ZOOM_STEP));

    const hint = [
      "Click a tile to draw in the chosen colour, or a cell of that colour to erase it. Drag to pan, scroll to zoom.",
      "A new cell takes the colour most of its parents share.",
      "Space: play / pause · 1–4: colour · M: sound",
    ].join("\n");
    this.hint = this.add.text(0, 0, hint, { fontFamily: font, fontSize: "13px", color: "#d4ccff", lineSpacing: 3 });

    // drag pans the board; a click (press and release without dragging) draws or erases a cell
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.pressed = this.view.contains(p.x, p.y);
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
        if (cell) this.paint(cell);
      }
      this.pressed = false;
      this.panning = false;
      this.drawHover();
    };
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => release(p, true));
    this.input.on("pointerupoutside", (p: Phaser.Input.Pointer) => release(p, false));
    this.input.on(Phaser.Input.Events.GAME_OUT, () => this.hoverGraphics.clear());

    // scroll to zoom, keeping the point under the cursor fixed; elsewhere the wheel scrolls the page
    this.input.on("wheel", (p: Phaser.Input.Pointer, _objs: unknown, _dx: number, dy: number) => {
      if (!this.view.contains(p.x, p.y)) return;
      this.zoomAt(this.zoom * Math.exp(-dy * ZOOM_SPEED), p.x, p.y);
    });
    keepWheel(this, (x, y) => this.view.contains(x, y));

    this.input.keyboard?.on("keydown", (e: KeyboardEvent) => this.onKey(e));

    this.refresh();
    this.layout(this.scale.gameSize);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this));
  }

  /** Show the current choices: the speed lit up, a tick on the colour, and the generation count. */
  private refresh() {
    this.speedButtons.forEach((b, i) => setButtonStyle(b, SPEEDS[i] === this.speed ? PRIMARY : SECONDARY));
    this.colorLabel.setText(`Colour: ${this.colors[this.color].name}`);
    this.swatches.forEach((b, i) => b.label.setText(i === this.color ? "✓" : ""));
    this.updateGenerationText();
    this.syncButtons();
  }

  private pickColor(i: number) {
    this.color = i;
    this.refresh();
    this.drawHover();
  }

  /** Play or pause. Once the generation limit is reached, Play only says to raise it. */
  private setRunning(running: boolean) {
    if (running && this.generation >= this.limit) return this.say("Raise the limit to go on");
    this.running = running;
    this.elapsed = 0;
    this.syncButtons();
  }

  /** Kill every cell, count generations from 0 again, and pause, ready for a new drawing. */
  private clear() {
    for (const row of this.board.cells) for (const c of row) [c.is_alive, c.owner] = [false, null];
    this.generation = 0;
    this.setRunning(false);
    this.updateGenerationText();
    this.redraw();
  }

  /** A typed limit lower than the current generation stops the board there. */
  private setLimit(limit: number) {
    this.limit = limit;
    if (this.generation >= limit) this.running = false;
    this.updateGenerationText();
    this.syncButtons();
  }

  /** Clicking a tile with the chosen colour: an empty tile or another colour's cell becomes that colour, and its own cell is erased. */
  private paint(cell: Cell) {
    if (this.erases(cell)) [cell.is_alive, cell.owner] = [false, null];
    else {
      [cell.is_alive, cell.owner] = [true, this.colors[this.color]];
      popForPlace(this);
    }
    this.redraw();
  }

  private erases(cell: Cell) {
    return cell.is_alive && cell.owner === this.colors[this.color];
  }

  /** Show `message` in place of the status for a moment. */
  private say(message: string) {
    this.notice = message;
    this.noticeLeft = NOTICE_MS;
    this.updateStatusText();
  }

  /** Dim whichever of Play and Pause doesn't apply right now, and say what the board is doing. */
  private syncButtons() {
    const playActive = !this.running && this.generation < this.limit;
    this.playButton.rect.setAlpha(playActive ? 1 : 0.4);
    this.playButton.label.setAlpha(playActive ? 1 : 0.4);
    this.pauseButton.rect.setAlpha(this.running ? 1 : 0.4);
    this.pauseButton.label.setAlpha(this.running ? 1 : 0.4);
    this.updateStatusText();
  }

  private updateGenerationText() {
    this.generationText.setText(`Generation ${this.generation} / ${this.limit}`);
  }

  private updateStatusText() {
    let text: string;
    if (this.notice) text = this.notice;
    else if (this.running) text = `Running at ${this.speed}×`;
    else if (this.generation >= this.limit) text = "Reached the limit";
    else if (this.generation === 0) text = "Draw cells, then press Play";
    else text = "Paused";
    this.statusText.setText(text).setColor(this.notice ? "#ff4d5e" : "#ffe03d");
  }

  /** The generation limit, typed in. It applies on Enter or when the field loses focus; Escape discards it. */
  private makeLimitInput(font: string): HTMLInputElement {
    const input = textInput(font, "Generations", String(MAX_GENERATIONS).length, String(this.limit));
    input.inputMode = "numeric";
    input.style.textAlign = "center";
    // anything that isn't a whole number from 1 up puts the current limit back
    const commit = () => {
      const limit = Math.floor(Number(input.value));
      if (limit >= 1) this.setLimit(Math.min(limit, MAX_GENERATIONS));
      input.value = String(this.limit);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") {
        input.value = String(this.limit);
        input.blur();
      }
    });
    input.addEventListener("blur", commit);
    input.addEventListener("focus", () => input.select());
    return input;
  }

  private redraw() {
    this.board.draw(this.graphics, this.view);
    this.drawHover();
  }

  /** Preview the click under the mouse (not on touch, where there's no hover), and set the cursor to match. */
  private drawHover() {
    const g = this.hoverGraphics.clear();
    const p = this.input.activePointer;
    if (this.panning) return this.input.setDefaultCursor("grabbing");
    const cell = !p.wasTouch && this.view.contains(p.x, p.y) ? this.board.cellAt(p.x, p.y) : null;
    this.input.setDefaultCursor(cell ? "pointer" : "default");
    if (!cell) return;
    const x = Math.max(cell.x, this.view.x);
    const y = Math.max(cell.y, this.view.y);
    const w = Math.min(cell.x + cell.w, this.view.right) - x;
    const h = Math.min(cell.y + cell.h, this.view.bottom) - y;
    if (w <= 0 || h <= 0) return;
    const line = Math.max(1, Math.min(3, cell.w * 0.12));
    if (this.erases(cell)) g.lineStyle(line, REMOVE_COLOR);
    else g.fillStyle(this.colors[this.color].main_color, HOVER_PLACE_ALPHA).fillRect(x, y, w, h).lineStyle(line, 0xf8f5ff);
    g.strokeRect(x, y, w, h);
  }

  /** Space plays or pauses, 1 to 4 pick a colour, + and - zoom, 0 resets the view, M turns sound on or off. Not while typing in a field. */
  private onKey(e: KeyboardEvent) {
    if (document.activeElement instanceof HTMLInputElement) return;
    const n = Number(e.key);
    if (e.key === " ") {
      e.preventDefault();
      this.setRunning(!this.running);
    } else if (n >= 1 && n <= this.colors.length) this.pickColor(n - 1);
    else if (e.key === "+" || e.key === "=") this.zoomAtCenter(this.zoom * ZOOM_STEP);
    else if (e.key === "-" || e.key === "_") this.zoomAtCenter(this.zoom / ZOOM_STEP);
    else if (e.key === "m" || e.key === "M") {
      setMuted(!isMuted());
      this.say(isMuted() ? "Sound off" : "Sound on");
    } else if (e.key === "0") {
      this.zoom = 1;
      this.panX = this.panY = 0;
      this.applyView();
    }
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
    this.zoomAt(zoom, this.view.centerX, this.view.centerY);
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
    this.zoomLabel.setText(`Zoom ${Math.round(this.zoom * 100)}%`);
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
   * Board on the left, sidebar on the right. On narrow screens the sidebar drops below the board and packs
   * its rows of controls together, without their labels or the hint.
   */
  private layout({ width, height }: Phaser.Structs.Size) {
    let size: number, bx: number, by: number;
    let sx: number, sy: number, sh: number;
    const wide = width >= 720;
    // wide enough for the title beside Back, and the Generations and Zoom labels side by side, in the display font
    const sw = wide ? Phaser.Math.Clamp(width * 0.24, 290, 320) : width - PAD * 2;
    const inner = sw - 40;
    const labelH = wide ? LABEL_H : 0;
    const rowGap = wide ? 18 : GAP;

    if (wide) {
      const areaW = width - sw - PAD * 3;
      size = Math.min(areaW, height - PAD * 2);
      bx = PAD + (areaW - size) / 2;
      by = (height - size) / 2;
      sx = width - PAD - sw;
      sy = PAD;
      sh = height - PAD * 2;
    } else {
      // four rows of buttons under the status line
      sh = 116 + (BTN_H + GAP) * 4 - GAP + 20;
      size = Math.max(120, Math.min(width - PAD * 2, height - sh - PAD * 3));
      bx = (width - size) / 2;
      by = PAD;
      sx = PAD;
      sy = by + size + PAD;
    }

    this.view.setTo(bx, by, size, size);
    this.applyView();

    const x = sx + 20;
    this.sidebar.setPosition(sx, sy).setSize(sw, sh);
    this.title.setPosition(x, sy + 20);
    this.backText.setPosition(sx + sw - 20, sy + 26);
    this.generationText.setPosition(x, sy + 58);
    this.statusText.setPosition(x, sy + 82);

    // [Play] [Pause] [Clear], then Speed, Colour, and Generations beside Zoom, each row under its label
    let y = sy + 116;
    this.layoutRow([this.playButton, this.pauseButton, this.clearButton], x, y, inner);
    y += BTN_H + rowGap;
    for (const label of [this.speedLabel, this.colorLabel, this.limitLabel, this.zoomLabel]) label.setVisible(wide);
    this.speedLabel.setPosition(x, y);
    this.layoutRow(this.speedButtons, x, y + labelH, inner);
    y += labelH + BTN_H + rowGap;
    this.colorLabel.setPosition(x, y);
    this.layoutRow(this.swatches, x, y + labelH, inner);
    y += labelH + BTN_H + rowGap;

    const half = (inner - GAP) / 2;
    const zx = x + half + GAP;
    const zoomW = (half - GAP) / 2;
    this.limitLabel.setPosition(x, y);
    this.zoomLabel.setPosition(zx, y);
    y += labelH;
    this.limitInput.setPosition(x, y);
    (this.limitInput.node as HTMLInputElement).style.width = `${half}px`;
    layoutButton(this.zoomOutButton, zx, y, zoomW);
    layoutButton(this.zoomInButton, zx + zoomW + GAP, y, zoomW);
    y += BTN_H + rowGap;
    // a window too short for the controls (or, narrow, for them and a small board) makes the page scroll
    fitHeight(this, (wide ? y - rowGap + 20 : sy + sh) + PAD);

    // the controls hint only beside the board, and only if it fits
    this.hint.setWordWrapWidth(inner).setPosition(x, y);
    this.hint.setVisible(wide && y + this.hint.height <= sy + sh - 20);
  }

  private layoutRow(buttons: Button[], x: number, y: number, w: number) {
    const bw = (w - GAP * (buttons.length - 1)) / buttons.length;
    buttons.forEach((b, i) => layoutButton(b, x + i * (bw + GAP), y, bw));
  }

  /** Steps the board while it's running, as many generations as the speed calls for, up to the limit. */
  update(_time: number, delta: number) {
    if (this.noticeLeft > 0 && (this.noticeLeft -= delta) <= 0) {
      this.notice = "";
      this.updateStatusText();
    }
    if (!this.running) return;
    const interval = GENERATION_MS / this.speed;
    this.elapsed = Math.min(this.elapsed + delta, interval * MAX_STEPS_PER_FRAME);
    let stepped = false;
    while (this.elapsed >= interval && this.generation < this.limit) {
      popForBirths(this, this.board.step());
      this.generation++;
      this.elapsed -= interval;
      stepped = true;
    }
    if (this.generation >= this.limit) this.setRunning(false);
    if (!stepped) return;
    this.updateGenerationText();
    this.redraw();
  }
}
