import type * as Phaser from "phaser";

export const BTN_H = 52;
export const PANEL_COLOR = 0x1c1633;

export type ButtonStyle = { fill: number; hover: number; text: string };
export const PRIMARY: ButtonStyle = { fill: 0xffe03d, hover: 0xfff2a1, text: "#120e22" };
export const SECONDARY: ButtonStyle = { fill: 0x5b4b9a, hover: 0x6e5db0, text: "#f8f5ff" };

export type Button = { rect: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text; style: ButtonStyle };

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
}

export function layoutButton({ rect, label }: Button, x: number, y: number, w: number, h = BTN_H) {
  rect.setPosition(x, y).setSize(w, h);
  // setSize doesn't update the click area, so keep it in sync
  (rect.input!.hitArea as Phaser.Geom.Rectangle).setTo(0, 0, w, h);
  label.setPosition(x + w / 2, y + h / 2);
}

export function setButtonDepth({ rect, label }: Button, depth: number) {
  rect.setDepth(depth);
  label.setDepth(depth);
}
