import * as Phaser from "phaser";
import Online from "../net/Online";
import { PALETTE } from "../Player";
import { BTN_H, type Button, displayFont, fitHeight, fontFamily, layoutButton, makeButton, PRIMARY, SECONDARY } from "../ui";

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
 * classic (matchmade, unrated) or ranked, or the playground. Guests see ranked dimmed; choosing it asks them to sign in.
 */
export default class HomeScene extends Phaser.Scene {
  constructor() {
    super("HomeScene");
  }

  // "Cellulose" in the logo's colours: Cell, u, lose
  private title!: Phaser.GameObjects.Text[];
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
    const display = displayFont();
    this.account = this.add
      .text(0, 0, guest ? `Playing as ${online.guest} (guest)` : `Signed in as ${online.player}`, {
        fontFamily: font,
        fontSize: "15px",
        color: "#d4ccff",
      })
      .setOrigin(0, 0);
    this.logout = this.add
      .text(0, 0, guest ? "Sign in" : "Log out", { fontFamily: display, fontSize: "15px", fontStyle: "bold", color: "#d4ccff" })
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

    this.title = [
      ["Cell", "#ffe03d"],
      ["u", "#f8f5ff"],
      ["lose", "#8b3bdb"],
    ].map(([text, color]) => this.add.text(0, 0, text, { fontFamily: display, fontSize: "72px", fontStyle: "bold", color }));
    this.subtitle = this.add
      .text(0, 0, "Conway's Competitive Game of Life", { fontFamily: display, fontSize: "20px", color: "#d4ccff", align: "center" })
      .setOrigin(0.5, 0);
    this.gliders = this.add.graphics();
    this.buttons = [
      makeButton(this, "Play with bots", PRIMARY, () => this.scene.start("LobbyScene")),
      makeButton(this, "Play with friends", SECONDARY, () => this.scene.start("OnlineLobbyScene")),
      makeButton(this, "Play classic", SECONDARY, () => this.scene.start("RankedScene", { kind: "classic" })),
      makeButton(this, guest ? "Play ranked (sign in)" : "Play ranked", SECONDARY, ranked),
      makeButton(this, "Playground", SECONDARY, () => this.scene.start("PlaygroundScene")),
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
    for (const t of this.title) t.setFontSize(Phaser.Math.Clamp(Math.round(width / 9), 40, 72));
    const titleH = this.title[0].height;
    this.subtitle.setWordWrapWidth(colW);
    this.blurb.setWordWrapWidth(colW);

    const cell = width < 480 ? 8 : 12;
    const glidersH = cell * 3;
    const glidersW = PALETTE.length * cell * 3 + (PALETTE.length - 1) * GLIDER_GAP;
    const buttonsH = this.buttons.length * (BTN_H + BUTTON_GAP) - BUTTON_GAP;
    const totalH = titleH + 8 + this.subtitle.height + 40 + glidersH + 48 + buttonsH + 32 + this.blurb.height;

    this.account.setPosition(PAD, PAD);
    this.logout.setPosition(width - PAD, PAD);
    const top = PAD + this.account.height + 16;
    // a window too short for the whole column makes the page scroll
    fitHeight(this, top + totalH + PAD);

    const cx = width / 2;
    let y = Math.max(top, (height - totalH) / 2);
    // the three parts side by side, centred together
    let tx = cx - this.title.reduce((w, t) => w + t.width, 0) / 2;
    for (const t of this.title) {
      t.setPosition(tx, y);
      tx += t.width;
    }
    y += titleH + 8;
    this.subtitle.setPosition(cx, y);
    y += this.subtitle.height + 40;

    this.gliders.clear();
    PALETTE.forEach(({ color }, i) => {
      const gx = cx - glidersW / 2 + i * (cell * 3 + GLIDER_GAP);
      this.gliders.fillStyle(color);
      for (const [r, c] of GLIDER) this.gliders.fillRect(gx + c * cell, y + r * cell, cell - 1, cell - 1);
    });
    y += glidersH + 48;

    // room around the longest label, "Play ranked (sign in)", in the display font
    const btnW = Math.min(300, colW);
    this.buttons.forEach((b, i) => layoutButton(b, cx - btnW / 2, y + i * (BTN_H + BUTTON_GAP), btnW));
    y += buttonsH + 32;
    this.blurb.setPosition(cx, y);
  }
}
