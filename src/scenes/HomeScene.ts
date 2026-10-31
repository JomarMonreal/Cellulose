import * as Phaser from "phaser";
import { PALETTE } from "../Player";
import { BTN_H, type Button, fontFamily, layoutButton, makeButton, PRIMARY } from "../ui";

const PAD = 24;
// the classic glider, as [row, col] in a 3x3 box
const GLIDER = [
  [0, 1],
  [1, 2],
  [2, 0],
  [2, 1],
  [2, 2],
];
const GLIDER_GAP = 24;

/** Title screen: the game's name, a row of gliders in the player colours, and Play. */
export default class HomeScene extends Phaser.Scene {
  constructor() {
    super("HomeScene");
  }

  private title!: Phaser.GameObjects.Text;
  private subtitle!: Phaser.GameObjects.Text;
  private gliders!: Phaser.GameObjects.Graphics;
  private playButton!: Button;
  private blurb!: Phaser.GameObjects.Text;

  create() {
    const font = fontFamily();
    this.title = this.add.text(0, 0, "Cellulose", { fontFamily: font, fontSize: "72px", fontStyle: "bold", color: "#ffe03d" }).setOrigin(0.5, 0);
    this.subtitle = this.add
      .text(0, 0, "Conway's Competitive Game of Life", { fontFamily: font, fontSize: "20px", color: "#d4ccff", align: "center" })
      .setOrigin(0.5, 0);
    this.gliders = this.add.graphics();
    this.playButton = makeButton(this, "Play", PRIMARY, () => this.scene.start("LobbyScene"));
    this.blurb = this.add
      .text(0, 0, "Seed living cells, outgrow the AI colonies, and hold the most land when the clock runs out.", {
        fontFamily: font,
        fontSize: "16px",
        color: "#d4ccff",
        align: "center",
        lineSpacing: 4,
      })
      .setOrigin(0.5, 0);

    this.layout(this.scale.gameSize);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this));
  }

  /** Everything stacked in a centred column; the title shrinks on narrow screens. */
  private layout({ width, height }: Phaser.Structs.Size) {
    const colW = Math.min(480, width - PAD * 2);
    this.title.setFontSize(Phaser.Math.Clamp(Math.round(width / 9), 40, 72));
    this.subtitle.setWordWrapWidth(colW);
    this.blurb.setWordWrapWidth(colW);

    const cell = width < 480 ? 8 : 12;
    const glidersH = cell * 3;
    const glidersW = PALETTE.length * cell * 3 + (PALETTE.length - 1) * GLIDER_GAP;
    const totalH = this.title.height + 8 + this.subtitle.height + 40 + glidersH + 48 + BTN_H + 32 + this.blurb.height;

    const cx = width / 2;
    let y = Math.max(PAD, (height - totalH) / 2);
    this.title.setPosition(cx, y);
    y += this.title.height + 8;
    this.subtitle.setPosition(cx, y);
    y += this.subtitle.height + 40;

    this.gliders.clear();
    PALETTE.forEach(({ color }, i) => {
      const gx = cx - glidersW / 2 + i * (cell * 3 + GLIDER_GAP);
      this.gliders.fillStyle(color);
      for (const [r, c] of GLIDER) this.gliders.fillRect(gx + c * cell, y + r * cell, cell - 1, cell - 1);
    });
    y += glidersH + 48;

    const btnW = Math.min(240, colW);
    layoutButton(this.playButton, cx - btnW / 2, y, btnW);
    y += BTN_H + 32;
    this.blurb.setPosition(cx, y);
  }
}
