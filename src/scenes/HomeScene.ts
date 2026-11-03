import * as Phaser from "phaser";
import Online from "../net/Online";
import { PALETTE } from "../Player";
import RankCard from "../RankCard";
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
// wide enough for the buttons and the rank card side by side
const WIDE = 860;
const COLUMN_GAP = 56;

/**
 * Title screen: the game's name, a row of gliders in the player colours, and play with bots, with friends,
 * classic (matchmade, unrated) or ranked, the ranked leaderboard, the playground, or the tutorial. Guests see ranked dimmed; choosing it asks them to sign in.
 * Beside the buttons (below them on narrow screens), a card shows the player's rank (see RankCard), with how many
 * players are online and registered under it.
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
  // signed in only: password and sign out everywhere
  private accountLink!: Phaser.GameObjects.Text;

  private card!: RankCard;

  preload() {
    RankCard.preload(this);
  }

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
    this.accountLink = this.add
      .text(0, 0, "Account", { fontFamily: display, fontSize: "15px", fontStyle: "bold", color: "#d4ccff" })
      .setOrigin(1, 0)
      .setVisible(!guest)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => this.accountLink.setColor("#ffe03d"))
      .on("pointerout", () => this.accountLink.setColor("#d4ccff"))
      .on("pointerdown", () => this.scene.start("AccountScene"));
    // a fresher profile (after a ranked game, say) redraws the rank
    const onAuth = () => (online.player ? this.refreshRank() : this.scene.start("AuthScene"));
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
    this.subtitle = this.add.text(0, 0, "Conway's Competitive Game of Life", { fontFamily: display, fontSize: "20px", color: "#d4ccff" });
    this.gliders = this.add.graphics();
    this.buttons = [
      makeButton(this, "Play with bots", PRIMARY, () => this.scene.start("LobbyScene")),
      makeButton(this, "Play with friends", SECONDARY, () => this.scene.start("OnlineLobbyScene")),
      makeButton(this, "Play classic", SECONDARY, () => this.scene.start("RankedScene", { kind: "classic" })),
      makeButton(this, guest ? "Play ranked (sign in)" : "Play ranked", SECONDARY, ranked),
      makeButton(this, "Leaderboard", SECONDARY, () => this.scene.start("LeaderboardScene", { from: "HomeScene" })),
      makeButton(this, "Playground", SECONDARY, () => this.scene.start("PlaygroundScene")),
      makeButton(this, "Tutorial", SECONDARY, () => this.scene.start("TutorialScene")),
    ];
    if (guest) for (const o of [this.buttons[3].rect, this.buttons[3].label]) o.setAlpha(0.5);
    this.blurb = this.add.text(0, 0, "Seed living cells, outgrow rival colonies, and hold the most land or the last flag standing.", {
      fontFamily: font,
      fontSize: "16px",
      color: "#d4ccff",
      lineSpacing: 4,
    });

    this.card = new RankCard(this);

    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this));
    this.refreshRank();
    if (online.profile) void online.refreshProfile();
  }

  private refreshRank() {
    this.card.refresh();
    this.layout(this.scale.gameSize);
  }

  /**
   * Wide screens: the title and buttons in a column on the left, the rank card filling the right. Narrow screens:
   * one centred column, with the card under the buttons. The title shrinks to fit its column.
   */
  private layout({ width, height }: Phaser.Structs.Size) {
    const wide = width >= WIDE;
    const colW = wide ? 340 : Math.min(480, width - PAD * 2);
    const cardW = wide ? Math.min(520, width - PAD * 2 - colW - COLUMN_GAP) : colW;

    for (const t of this.title) t.setFontSize(72);
    const titleW = this.title.reduce((w, t) => w + t.width, 0);
    if (titleW > colW) for (const t of this.title) t.setFontSize(Math.floor((72 * colW) / titleW));
    const titleH = this.title[0].height;
    for (const t of [this.subtitle, this.blurb]) {
      t.setWordWrapWidth(colW).setAlign(wide ? "left" : "center").setOrigin(wide ? 0 : 0.5, 0);
    }

    const cell = width < 480 ? 8 : 12;
    const glidersH = cell * 3;
    const glidersW = PALETTE.length * cell * 3 + (PALETTE.length - 1) * GLIDER_GAP;
    const buttonsH = this.buttons.length * (BTN_H + BUTTON_GAP) - BUTTON_GAP;
    const columnH = titleH + 8 + this.subtitle.height + 32 + glidersH + 40 + buttonsH + 28 + this.blurb.height;

    const cardNeed = this.card.measure(cardW, wide);
    const footH = this.card.footH;

    this.logout.setPosition(width - PAD, PAD);
    this.accountLink.setPosition(width - PAD - this.logout.width - 24, PAD);
    // who's signed in sits left of the links, or under them when the screen's too narrow for both
    const linksLeft = this.accountLink.visible ? this.accountLink.x - this.accountLink.width : this.logout.x - this.logout.width;
    const crowded = PAD + this.account.width + 16 > linksLeft;
    this.account.setPosition(PAD, crowded ? PAD + this.logout.height + 8 : PAD);
    const top = this.account.y + this.account.height + 16;

    if (wide) {
      const cardH = Math.max(columnH, cardNeed);
      // a window too short for the whole page makes it scroll
      fitHeight(this, top + cardH + footH + PAD);
      const x = (width - (colW + COLUMN_GAP + cardW)) / 2;
      const y = Math.max(top, (height - cardH - footH) / 2);
      this.layoutColumn(x, y + (cardH - columnH) / 2, colW, titleH, cell, glidersW, true);
      this.card.layout(x + colW + COLUMN_GAP, y, cardW, cardH);
    } else {
      const cardH = cardNeed;
      const totalH = columnH + 32 + cardH + footH;
      fitHeight(this, top + totalH + PAD);
      const x = (width - colW) / 2;
      const y = Math.max(top, (height - totalH) / 2);
      // the blurb goes under the card, so lay the column out without it and move it down after
      this.layoutColumn(x, y, colW, titleH, cell, glidersW, false);
      const cardY = y + columnH - this.blurb.height;
      this.card.layout(x, cardY, cardW, cardH);
      this.blurb.setPosition(width / 2, cardY + cardH + footH + 28);
    }
  }

  /** The title, subtitle, gliders, buttons and blurb, from (x, y) down, left-aligned or centred in the column. */
  private layoutColumn(x: number, y: number, w: number, titleH: number, cell: number, glidersW: number, left: boolean) {
    const cx = x + w / 2;
    // the three parts side by side
    let tx = left ? x : cx - this.title.reduce((tw, t) => tw + t.width, 0) / 2;
    for (const t of this.title) {
      t.setPosition(tx, y);
      tx += t.width;
    }
    y += titleH + 8;
    this.subtitle.setPosition(left ? x : cx, y);
    y += this.subtitle.height + 32;

    this.gliders.clear();
    const gx0 = left ? x : cx - glidersW / 2;
    PALETTE.forEach(({ color }, i) => {
      const gx = gx0 + i * (cell * 3 + GLIDER_GAP);
      this.gliders.fillStyle(color);
      for (const [r, c] of GLIDER) this.gliders.fillRect(gx + c * cell, y + r * cell, cell - 1, cell - 1);
    });
    y += cell * 3 + 40;

    this.buttons.forEach((b, i) => layoutButton(b, x, y + i * (BTN_H + BUTTON_GAP), w));
    y += this.buttons.length * (BTN_H + BUTTON_GAP) - BUTTON_GAP + 28;
    this.blurb.setPosition(left ? x : cx, y);
  }
}
