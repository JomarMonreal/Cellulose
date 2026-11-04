import * as Phaser from "phaser";
import { avatarTexture } from "./avatars";
import Online from "./net/Online";
import { playUi } from "./sound";
import { displayFont, fontFamily, PANEL_COLOR } from "./ui";

const DISC = 36;
// the disc behind the initial when there's no picture (the Account screen's preview uses the same)
const NO_PICTURE = 0x8b3bdb;
const ITEM_H = 40;
const MENU_W = 180;
const MENU_PAD = 6;
// over everything else on the screen
const DEPTH = 100;

export type MenuItem = { label: string; onClick: () => void };

/**
 * Who's playing, at the top right: their name and avatar (their picture, or the name's first letter on a disc), with
 * a caret. Clicking it drops down a menu of `items`; clicking anywhere else, or Escape, closes it.
 */
export default class ProfileMenu {
  private hit: Phaser.GameObjects.Rectangle;
  private name: Phaser.GameObjects.Text;
  private disc: Phaser.GameObjects.Graphics;
  private initial: Phaser.GameObjects.Text;
  private picture: Phaser.GameObjects.Image;
  // drawn, not a Rectangle (an outlined Rectangle can render a stray diagonal); the invisible block catches clicks
  private panel: Phaser.GameObjects.Graphics;
  private block: Phaser.GameObjects.Rectangle;
  private rows: { bg: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text; item: MenuItem }[];
  private open = false;
  // where the badge's right edge and top are, from the last layout
  private right = 0;
  private top = 0;

  constructor(
    private scene: Phaser.Scene,
    items: MenuItem[],
  ) {
    const online = Online.get();
    const display = displayFont();
    const player = online.player ?? "";
    this.hit = scene.add.rectangle(0, 0, 1, 1, 0xffffff, 0).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    this.name = scene.add
      .text(0, 0, online.profile ? player : `${player} (guest)`, { fontFamily: fontFamily(), fontSize: "15px", fontStyle: "bold", color: "#d4ccff" })
      .setOrigin(1, 0.5);
    this.disc = scene.add.graphics();
    this.initial = scene.add.text(0, 0, (player[0] ?? "?").toUpperCase(), { fontFamily: display, fontSize: "18px", color: "#f8f5ff" }).setOrigin(0.5);
    this.picture = scene.add.image(0, 0, "__DEFAULT").setVisible(false);

    // the menu: a panel and a row per item, hidden until the badge is clicked
    this.panel = scene.add.graphics();
    // it catches clicks, so nothing underneath gets them
    this.block = scene.add.rectangle(0, 0, MENU_W, items.length * ITEM_H + MENU_PAD * 2, 0x000000, 0).setOrigin(1, 0).setInteractive();
    this.rows = items.map((item) => {
      const bg = scene.add.rectangle(0, 0, MENU_W - MENU_PAD * 2, ITEM_H, 0x2b2448, 0).setOrigin(1, 0).setInteractive({ useHandCursor: true });
      const label = scene.add.text(0, 0, item.label, { fontFamily: display, fontSize: "15px", fontStyle: "bold", color: "#f8f5ff" }).setOrigin(0, 0.5);
      bg.on("pointerover", () => bg.setFillStyle(0x2b2448, 1));
      bg.on("pointerout", () => bg.setFillStyle(0x2b2448, 0));
      bg.on("pointerdown", () => {
        playUi(scene, "select");
        this.setOpen(false);
        item.onClick();
      });
      return { bg, label, item };
    });
    for (const o of [this.panel, this.block, ...this.rows.flatMap((r) => [r.bg, r.label])]) o.setDepth(DEPTH + 1);
    for (const o of [this.hit, this.name, this.disc, this.initial, this.picture]) o.setDepth(DEPTH);

    this.hit.on("pointerover", () => this.name.setColor("#ffe03d"));
    this.hit.on("pointerout", () => this.name.setColor("#d4ccff"));
    this.hit.on("pointerdown", () => {
      playUi(scene, "select");
      this.setOpen(!this.open);
    });
    // a click anywhere but the badge and the menu closes it
    const inside = new Set<Phaser.GameObjects.GameObject>([this.hit, this.block, ...this.rows.map((r) => r.bg)]);
    const onDown = (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (this.open && !over.some((o) => inside.has(o))) this.setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && this.setOpen(false);
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, onDown);
    scene.input.keyboard?.on("keydown", onKey);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.input.off(Phaser.Input.Events.POINTER_DOWN, onDown);
      scene.input.keyboard?.off("keydown", onKey);
    });
    this.setOpen(false);
    this.showPicture();
  }

  /** The badge's height, for whatever sits under it. */
  get height() {
    return DISC;
  }

  /** The badge with its right edge at `right` and its top at `top`; the menu drops from under it, right-aligned. */
  layout(right: number, top: number) {
    [this.right, this.top] = [right, top];
    const cy = top + DISC / 2;
    // [name] [disc] [caret], right to left
    const caretW = 10;
    const cx = right - caretW - 8 - DISC / 2;
    this.disc.clear().fillStyle(NO_PICTURE).fillCircle(cx, cy, DISC / 2).lineStyle(2, 0xffe03d).strokeCircle(cx, cy, DISC / 2);
    const tx = right - caretW / 2;
    this.disc.fillStyle(0xd4ccff).fillTriangle(tx - caretW / 2, cy - 3, tx + caretW / 2, cy - 3, tx, cy + 4);
    this.initial.setPosition(cx, cy);
    this.picture.setPosition(cx, cy).setDisplaySize(DISC - 4, DISC - 4);
    this.name.setPosition(cx - DISC / 2 - 10, cy);
    const width = right - (this.name.x - this.name.width);
    this.hit.setPosition(right, top).setSize(width, DISC);
    (this.hit.input!.hitArea as Phaser.Geom.Rectangle).setTo(0, 0, width, DISC);
    this.layoutMenu();
  }

  private layoutMenu() {
    const y = this.top + DISC + 8;
    const h = this.rows.length * ITEM_H + MENU_PAD * 2;
    this.panel.clear().fillStyle(PANEL_COLOR).fillRect(this.right - MENU_W, y, MENU_W, h).lineStyle(2, 0x5b4b9a).strokeRect(this.right - MENU_W, y, MENU_W, h);
    this.block.setPosition(this.right, y);
    this.rows.forEach(({ bg, label }, i) => {
      const ry = y + MENU_PAD + i * ITEM_H;
      bg.setPosition(this.right - MENU_PAD, ry);
      label.setPosition(this.right - MENU_W + 18, ry + ITEM_H / 2);
    });
  }

  private setOpen(open: boolean) {
    this.open = open;
    for (const o of [this.panel, this.block, ...this.rows.flatMap((r) => [r.bg, r.label])]) o.setVisible(open);
    // a hidden row mustn't take the next hover's highlight with it
    if (!open) for (const { bg } of this.rows) bg.setFillStyle(0x2b2448, 0);
  }

  /** The picture once it's loaded, or the initial. */
  private showPicture() {
    const online = Online.get();
    const url = online.pictureUrl(online.profile?.avatar);
    this.picture.setVisible(false);
    this.initial.setVisible(true);
    if (!url) return;
    void avatarTexture(this.scene, url).then((key) => {
      if (!key || !this.picture.active) return;
      const { displayWidth, displayHeight } = this.picture;
      this.picture.setTexture(key).setDisplaySize(displayWidth, displayHeight).setVisible(true);
      this.initial.setVisible(false);
    });
  }
}
