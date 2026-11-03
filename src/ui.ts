import * as Phaser from "phaser";
import { playUi, type UiSound } from "./sound";

export const BTN_H = 52;
export const PANEL_COLOR = 0x1c1633;

export type ButtonStyle = { fill: number; hover: number; text: string };
export const PRIMARY: ButtonStyle = { fill: 0xffe03d, hover: 0xfff2a1, text: "#120e22" };
export const SECONDARY: ButtonStyle = { fill: 0x5b4b9a, hover: 0x6e5db0, text: "#f8f5ff" };

export type Button = {
  rect: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  style: ButtonStyle;
  // while loading, a spinner stands in for the label (see setButtonLoading)
  loading?: boolean;
  spinner?: Phaser.GameObjects.Graphics;
  // the label's own font size, which layoutButton shrinks from when the label wouldn't fit
  labelSize?: number;
};

// a label keeps at least this much room on each side, shrinking down to MIN_LABEL_SIZE to make it
const LABEL_PAD = 10;
const MIN_LABEL_SIZE = 12;

export const SPINNER_SIZE = 16;
// room a status line leaves in front of itself for its spinner
export const SPINNER_INDENT = SPINNER_SIZE + 10;

/** A spinning arc for anything still loading. It's drawn around (0, 0), so position it by its centre. */
export function makeSpinner(scene: Phaser.Scene, size = SPINNER_SIZE, color = 0xd4ccff) {
  const width = Math.max(2, Math.round(size / 7));
  const r = (size - width) / 2;
  const g = scene.add.graphics();
  g.lineStyle(width, color, 0.25).strokeCircle(0, 0, r);
  g.lineStyle(width, color).beginPath().arc(0, 0, r, 0, Math.PI / 2).strokePath();
  scene.tweens.add({ targets: g, angle: 360, duration: 800, repeat: -1 });
  return g;
}

/**
 * Let the page scroll when a screen needs more height than the window leaves the game. Call it from a layout with
 * the height the screen needs: the game grows to at least that (and lays out again, a frame later, at the new
 * size), then goes back to fitting the window when the scene shuts down.
 */
export function fitHeight(scene: Phaser.Scene, height: number) {
  const main = document.querySelector("main");
  const parent = scene.scale.parent as HTMLElement | null;
  if (!main || !parent) return;
  // the header and padding around the game
  const around = main.getBoundingClientRect().height - parent.getBoundingClientRect().height;
  const min = `${Math.ceil(height + around)}px`;
  if (main.style.minHeight === min) return;
  if (!main.style.minHeight) scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => setMinHeight(scene, ""));
  setMinHeight(scene, min);
}

function setMinHeight(scene: Phaser.Scene, min: string) {
  document.querySelector("main")!.style.minHeight = min;
  // Phaser reads the game's new size on its next step; resizing right away would rerun the layout inside itself
  scene.scale.dirty = true;
}

const PATTERN_EMPTY = 0x15112a;
const PATTERN_GRID = 0x2b2448;

/** A pattern's cells on a little board one tile bigger all round, centred in the w × h box at (x, y). */
export function drawPattern(g: Phaser.GameObjects.Graphics, cells: [number, number][], color: number, x: number, y: number, w: number, h: number, maxTile: number) {
  const rows = Math.max(...cells.map(([r]) => r)) + 3;
  const cols = Math.max(...cells.map(([, c]) => c)) + 3;
  const tile = Math.min(maxTile, Math.floor(w / cols), Math.floor(h / rows));
  const ox = x + (w - tile * cols) / 2;
  const oy = y + (h - tile * rows) / 2;
  g.fillStyle(PATTERN_EMPTY).fillRect(ox, oy, tile * cols, tile * rows);
  g.lineStyle(1, PATTERN_GRID);
  for (let c = 0; c <= cols; c++) g.lineBetween(ox + c * tile, oy, ox + c * tile, oy + rows * tile);
  for (let r = 0; r <= rows; r++) g.lineBetween(ox, oy + r * tile, ox + cols * tile, oy + r * tile);
  g.fillStyle(color);
  for (const [r, c] of cells) g.fillRect(ox + (c + 1) * tile + 1, oy + (r + 1) * tile + 1, tile - 1, tile - 1);
}

/**
 * Phaser leaves wheel events to the page (config.ts), so it can scroll. Where `over` says a point (in game
 * coordinates) belongs to the scene, such as a board that zooms, the page leaves them alone instead.
 */
export function keepWheel(scene: Phaser.Scene, over: (x: number, y: number) => boolean) {
  const canvas = scene.game.canvas;
  const onWheel = (e: WheelEvent) => {
    if (e.target === canvas && over(e.offsetX, e.offsetY)) e.preventDefault();
  };
  canvas.addEventListener("wheel", onWheel, { passive: false });
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => canvas.removeEventListener("wheel", onWheel));
}

/** The site's text font, for canvas text read as sentences: statuses, stats, hints. */
export function fontFamily() {
  return getComputedStyle(document.body).fontFamily;
}

/** The display font (Arco), for canvas titles, buttons and labels. */
export function displayFont() {
  return getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim();
}

/**
 * A button that plays `sound` when clicked: the select sound, unless it makes its own (e.g. a confirmation as a game
 * starts), in which case pass null.
 */
export function makeButton(scene: Phaser.Scene, text: string, style: ButtonStyle, onClick: () => void, sound: UiSound | null = "select"): Button {
  const rect = scene.add.rectangle(0, 0, 1, 1, style.fill).setOrigin(0).setInteractive({ useHandCursor: true });
  const label = scene.add.text(0, 0, text, { fontFamily: displayFont(), fontSize: "20px", fontStyle: "bold", color: style.text }).setOrigin(0.5);
  const button = { rect, label, style };
  // read the style through the button so setButtonStyle also changes the hover colours
  rect.on("pointerover", () => rect.setFillStyle(button.style.hover));
  rect.on("pointerout", () => rect.setFillStyle(button.style.fill));
  rect.on("pointerdown", () => {
    if (sound) playUi(scene, sound);
    onClick();
  });
  return button;
}

export function setButtonStyle(button: Button, style: ButtonStyle) {
  button.style = style;
  button.rect.setFillStyle(style.fill);
  button.label.setColor(style.text);
  // the spinner is drawn in the old text colour; make a new one when it's next needed
  button.spinner?.destroy();
  button.spinner = undefined;
  if (button.loading) setButtonLoading(button, true);
}

/** Swap the label for a spinner while the button's request is on its way. */
export function setButtonLoading(button: Button, loading: boolean) {
  button.loading = loading;
  const { rect, label } = button;
  if (loading && !button.spinner) {
    const color = Phaser.Display.Color.HexStringToColor(button.style.text).color;
    button.spinner = makeSpinner(rect.scene, 22, color).setDepth(label.depth);
  }
  button.spinner?.setVisible(loading && rect.visible).setPosition(label.x, label.y);
  label.setVisible(!loading && rect.visible);
}

export function layoutButton(button: Button, x: number, y: number, w: number, h = BTN_H) {
  const { rect, label, spinner } = button;
  rect.setPosition(x, y).setSize(w, h);
  // setSize doesn't update the click area, so keep it in sync
  (rect.input!.hitArea as Phaser.Geom.Rectangle).setTo(0, 0, w, h);
  // a label too wide for the button (a long one, or a narrow screen) shrinks until it fits
  let size = (button.labelSize ??= parseFloat(String(label.style.fontSize)));
  label.setFontSize(size);
  while (label.width > w - LABEL_PAD * 2 && size > MIN_LABEL_SIZE) label.setFontSize(--size);
  label.setPosition(x + w / 2, y + h / 2);
  spinner?.setPosition(x + w / 2, y + h / 2);
}

export function setButtonDepth({ rect, label, spinner }: Button, depth: number) {
  rect.setDepth(depth);
  label.setDepth(depth);
  spinner?.setDepth(depth);
}

export function setButtonVisible({ rect, label, spinner, loading }: Button, visible: boolean) {
  rect.setVisible(visible);
  label.setVisible(visible && !loading);
  spinner?.setVisible(visible && !!loading);
}

/** An HTML text field styled like the game's zoom input, for scene.add.dom. */
export function textInput(fontFamily: string, label: string, maxLength: number, value = "", type: "text" | "password" = "text") {
  const input = document.createElement("input");
  input.type = type;
  input.maxLength = maxLength;
  input.value = value;
  input.placeholder = label;
  input.setAttribute("aria-label", label);
  Object.assign(input.style, {
    boxSizing: "border-box",
    height: `${BTN_H}px`,
    padding: "0 14px",
    background: "#120e22",
    color: "#f8f5ff",
    border: "2px solid #5b4b9a",
    borderRadius: "0",
    outline: "none",
    fontFamily,
    fontSize: "18px",
    fontWeight: "bold",
  });
  showFocus(input);
  return input;
}

/** Light the field's border up in yellow while it has focus, since the browser's own outline is turned off. */
export function showFocus(input: HTMLInputElement) {
  input.addEventListener("focus", () => (input.style.borderColor = "#ffe03d"));
  input.addEventListener("blur", () => (input.style.borderColor = "#5b4b9a"));
}
