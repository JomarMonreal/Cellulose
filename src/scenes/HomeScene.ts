import * as Phaser from "phaser";
import Online from "../net/Online";
import { PALETTE } from "../Player";
import { BTN_H, type Button, fontFamily, layoutButton, makeButton, PRIMARY, SECONDARY } from "../ui";

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
const BUTTON_GAP = 12;

/**
 * Title screen: the game's name, a row of gliders in the player colours, and play with bots, with friends,
 * classic (matchmade, unrated) or ranked. Guests see ranked dimmed; choosing it asks them to sign in.
 */
export default class HomeScene extends Phaser.Scene {
  constructor() {
    super("HomeScene");
  }

  private title!: Phaser.GameObjects.Text;
  private subtitle!: Phaser.GameObjects.Text;
  private gliders!: Phaser.GameObjects.Graphics;
  private buttons!: Button[];
  private blurb!: Phaser.GameObjects.Text;
  private account!: Phaser.GameObjects.Text;
  private logout!: Phaser.GameObjects.Text;

  create() {
    const online = Online.get();
    // signing out or leaving guest mode (here or on another screen) goes back to the sign-in screen
    if (!online.player) return this.scene.start("AuthScene");
    const guest = !online.profile;
    const font = fontFamily();
    this.account = this.add
      .text(0, 0, guest ? `Playing as ${online.guest} (guest)` : `Signed in as ${online.player}`, {
        fontFamily: font,
        fontSize: "15px",
        color: "#d4ccff",
      })
      .setOrigin(0, 0);
    this.logout = this.add
      .text(0, 0, guest ? "Sign in" : "Log out", { fontFamily: font, fontSize: "15px", fontStyle: "bold", color: "#d4ccff" })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => this.logout.setColor("#ffe03d"))
      .on("pointerout", () => this.logout.setColor("#d4ccff"))
      .on("pointerdown", () => {
        if (guest) return online.leaveGuest();
        this.logout.setText("Logging out…").disableInteractive();
        void online.logout();
      });
    const onAuth = () => !online.player && this.scene.start("AuthScene");
    online.on("auth", onAuth);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => online.off("auth", onAuth));
    // ranked needs an account: a guest is asked to sign in, and lands on ranked once they do
    const ranked = () => {
      if (!guest) return this.scene.start("RankedScene", { kind: "ranked" });
      online.off("auth", onAuth);
      online.leaveGuest();
      this.scene.start("AuthScene", { message: "Sign in to play ranked.", then: "RankedScene" });
    };

    this.title = this.add.text(0, 0, "Cellulose", { fontFamily: font, fontSize: "72px", fontStyle: "bold", color: "#ffe03d" }).setOrigin(0.5, 0);
    this.subtitle = this.add
      .text(0, 0, "Conway's Competitive Game of Life", { fontFamily: font, fontSize: "20px", color: "#d4ccff", align: "center" })
      .setOrigin(0.5, 0);
    this.gliders = this.add.graphics();
    this.buttons = [
      makeButton(this, "Play with bots", PRIMARY, () => this.scene.start("LobbyScene")),
      makeButton(this, "Play with friends", SECONDARY, () => this.scene.start("OnlineLobbyScene")),
      makeButton(this, "Play classic", SECONDARY, () => this.scene.start("RankedScene", { kind: "classic" })),
      makeButton(this, guest ? "Play ranked (sign in)" : "Play ranked", SECONDARY, ranked),
    ];
    if (guest) for (const o of [this.buttons[3].rect, this.buttons[3].label]) o.setAlpha(0.5);
    this.blurb = this.add
      .text(0, 0, "Seed living cells, outgrow rival colonies, and hold the most land or the last flag standing.", {
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
    const buttonsH = this.buttons.length * (BTN_H + BUTTON_GAP) - BUTTON_GAP;
    const totalH = this.title.height + 8 + this.subtitle.height + 40 + glidersH + 48 + buttonsH + 32 + this.blurb.height;

    this.account.setPosition(PAD, PAD);
    this.logout.setPosition(width - PAD, PAD);
    const top = PAD + this.account.height + 16;

    const cx = width / 2;
    let y = Math.max(top, (height - totalH) / 2);
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

    const btnW = Math.min(260, colW);
    this.buttons.forEach((b, i) => layoutButton(b, cx - btnW / 2, y + i * (BTN_H + BUTTON_GAP), btnW));
    y += buttonsH + 32;
    this.blurb.setPosition(cx, y);
  }
}
