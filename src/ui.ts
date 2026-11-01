import * as Phaser from "phaser";

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
};

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

/** The site's font, for canvas text. */
export function fontFamily() {
  return getComputedStyle(document.body).fontFamily;
}

export function makeButton(scene: Phaser.Scene, text: string, style: ButtonStyle, onClick: () => void): Button {
  const rect = scene.add.rectangle(0, 0, 1, 1, style.fill).setOrigin(0).setInteractive({ useHandCursor: true });
  const label = scene.add.text(0, 0, text, { fontFamily: fontFamily(), fontSize: "20px", fontStyle: "bold", color: style.text }).setOrigin(0.5);
  const button = { rect, label, style };
  // read the style through the button so setButtonStyle also changes the hover colours
  rect.on("pointerover", () => rect.setFillStyle(button.style.hover));
  rect.on("pointerout", () => rect.setFillStyle(button.style.fill));
  rect.on("pointerdown", onClick);
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

export function layoutButton({ rect, label, spinner }: Button, x: number, y: number, w: number, h = BTN_H) {
  rect.setPosition(x, y).setSize(w, h);
  // setSize doesn't update the click area, so keep it in sync
  (rect.input!.hitArea as Phaser.Geom.Rectangle).setTo(0, 0, w, h);
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
