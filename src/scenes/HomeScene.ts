import * as Phaser from "phaser";
import { MODES, modeName } from "../modes";
import Online from "../net/Online";
import { PALETTE } from "../Player";
import { loadRankArt, rankArt, rankIndex, RANKS } from "../ranks";
import { BTN_H, type Button, displayFont, fitHeight, fontFamily, layoutButton, makeButton, PANEL_COLOR, PRIMARY, SECONDARY } from "../ui";

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
const CARD_PAD = 32;
const BAR_H = 10;
const LADDER_GAP = 8;
const LOCKED = 0x3a3166;
// room above and below the creature's disc, for its glow
const ART_GAP = 28;

/**
 * Title screen: the game's name, a row of gliders in the player colours, and play with bots, with friends,
 * classic (matchmade, unrated) or ranked, the playground, or the tutorial. Guests see ranked dimmed; choosing it asks them to sign in.
 * Beside the buttons (below them on narrow screens), a card shows the player's rank: their best mode's tier as its creature,
 * how far it is to the next, and every tier in a row, the ones not reached yet in silhouette.
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

  private card!: Phaser.GameObjects.Rectangle;
  private cardLabel!: Phaser.GameObjects.Text;
  private halo!: Phaser.GameObjects.Graphics;
  // the creature bobs inside its container, which the layout places
  private artBox!: Phaser.GameObjects.Container;
  private art!: Phaser.GameObjects.Image;
  private tierText!: Phaser.GameObjects.Text;
  private ratingText!: Phaser.GameObjects.Text;
  private bar!: Phaser.GameObjects.Graphics;
  private barText!: Phaser.GameObjects.Text;
  private ladder!: Phaser.GameObjects.Image[];
  private ladderMark!: Phaser.GameObjects.Graphics;
  private modesText!: Phaser.GameObjects.Text;
  // the rank shown: its tier's place in RANKS (-1 for a guest) and how far it is into that tier
  private rank = -1;
  private progress = 0;

  preload() {
    loadRankArt(this);
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

    this.card = this.add.rectangle(0, 0, 1, 1, PANEL_COLOR).setOrigin(0).setStrokeStyle(2, LOCKED);
    this.cardLabel = this.add
      .text(0, 0, "YOUR RANK", { fontFamily: display, fontSize: "15px", fontStyle: "bold", color: "#d4ccff" })
      .setOrigin(0.5, 0);
    this.halo = this.add.graphics();
    this.art = this.add.image(0, 0, rankArt(0));
    this.artBox = this.add.container(0, 0, [this.art]);
    this.tweens.add({ targets: this.art, y: -8, duration: 1600, ease: "Sine.InOut", yoyo: true, repeat: -1 });
    this.tierText = this.add
      .text(0, 0, "", { fontFamily: display, fontSize: "48px", fontStyle: "bold", color: "#ffe03d" })
      .setOrigin(0.5, 0);
    this.ratingText = this.add.text(0, 0, "", { fontFamily: font, fontSize: "16px", color: "#f8f5ff", align: "center" }).setOrigin(0.5, 0);
    this.bar = this.add.graphics();
    this.barText = this.add.text(0, 0, "", { fontFamily: font, fontSize: "14px", color: "#d4ccff", align: "center" }).setOrigin(0.5, 0);
    this.ladder = RANKS.map((_, i) => this.add.image(0, 0, rankArt(i, true)));
    this.ladderMark = this.add.graphics();
    this.modesText = this.add
      .text(0, 0, "", { fontFamily: font, fontSize: "14px", color: "#d4ccff", align: "center", lineSpacing: 4 })
      .setOrigin(0.5, 0);

    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this));
    this.refreshRank();
    if (online.profile) void online.refreshProfile();
  }

  /** Fill the card in from the profile: the tier of whichever mode is rated highest. */
  private refreshRank() {
    const { profile, tiers } = Online.get();
    if (!profile) {
      this.rank = -1;
      this.progress = 0;
      this.art.setTexture(rankArt(0)).setAlpha(0.35);
      this.tierText.setText("Unranked").setColor("#f8f5ff");
      this.ratingText.setText("Guests play unrated.");
      this.modesText.setText(`Sign in and play ranked to climb\nfrom ${RANKS[0].name} to ${RANKS[RANKS.length - 1].name}.`);
    } else {
      const best = MODES.reduce((a, m) => (profile.rating[m.id] > profile.rating[a.id] ? m : a)).id;
      const rating = profile.rating[best];
      this.rank = rankIndex(profile.tier[best]);
      const from = tiers.findLast((t) => t.minRating <= rating);
      const next = tiers.find((t) => t.minRating > rating);
      this.progress = from && next ? (rating - from.minRating) / (next.minRating - from.minRating) : 1;
      this.art.setTexture(rankArt(this.rank)).setAlpha(1);
      this.tierText.setText(RANKS[this.rank].name).setColor("#ffe03d");
      this.ratingText.setText(`${rating} rating · ${modeName(best)}`);
      this.barText.setText(next ? `${next.minRating - rating} to ${next.name}` : "Top rank");
      this.modesText.setText(
        MODES.map((m) => `${m.name}: ${profile.tier[m.id]} · ${profile.rating[m.id]} · ${profile.wins[m.id]}/${profile.games[m.id]} won`).join("\n"),
      );
    }
    this.bar.setVisible(this.rank >= 0);
    this.barText.setVisible(this.rank >= 0);
    this.ladder.forEach((icon, i) => {
      if (i <= this.rank) icon.clearTint().setTintMode(Phaser.TintModes.MULTIPLY).setAlpha(1);
      else icon.setTint(LOCKED).setTintMode(Phaser.TintModes.FILL).setAlpha(0.8);
    });
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
    const artSize = wide ? Math.min(240, cardW - 140) : Math.min(150, cardW - 120);

    for (const t of this.title) t.setFontSize(72);
    const titleW = this.title.reduce((w, t) => w + t.width, 0);
    if (titleW > colW) for (const t of this.title) t.setFontSize(Math.floor((72 * colW) / titleW));
    const titleH = this.title[0].height;
    for (const t of [this.subtitle, this.blurb]) {
      t.setWordWrapWidth(colW).setAlign(wide ? "left" : "center").setOrigin(wide ? 0 : 0.5, 0);
    }
    const cardInner = cardW - CARD_PAD * 2;
    for (const t of [this.ratingText, this.barText, this.modesText]) t.setWordWrapWidth(cardInner);
    this.tierText.setFontSize(wide ? 48 : 36);

    const cell = width < 480 ? 8 : 12;
    const glidersH = cell * 3;
    const glidersW = PALETTE.length * cell * 3 + (PALETTE.length - 1) * GLIDER_GAP;
    const buttonsH = this.buttons.length * (BTN_H + BUTTON_GAP) - BUTTON_GAP;
    const columnH = titleH + 8 + this.subtitle.height + 32 + glidersH + 40 + buttonsH + 28 + this.blurb.height;

    const icon = Math.min(32, Math.floor((cardInner - LADDER_GAP * (RANKS.length - 1)) / RANKS.length));
    const barH = this.rank >= 0 ? 18 + BAR_H + 8 + this.barText.height : 0;
    const contentH =
      this.cardLabel.height + ART_GAP + artSize + ART_GAP + this.tierText.height + 4 + this.ratingText.height + barH + 28 + icon + 20 + this.modesText.height;

    this.account.setPosition(PAD, PAD);
    this.logout.setPosition(width - PAD, PAD);
    const top = PAD + this.account.height + 16;

    if (wide) {
      const cardH = Math.max(columnH, contentH + CARD_PAD * 2);
      // a window too short for the whole page makes it scroll
      fitHeight(this, top + cardH + PAD);
      const x = (width - (colW + COLUMN_GAP + cardW)) / 2;
      const y = Math.max(top, (height - cardH) / 2);
      this.layoutColumn(x, y + (cardH - columnH) / 2, colW, titleH, cell, glidersW, true);
      this.layoutCard(x + colW + COLUMN_GAP, y, cardW, cardH, contentH, artSize, icon);
    } else {
      const cardH = contentH + CARD_PAD * 2;
      const totalH = columnH + 32 + cardH;
      fitHeight(this, top + totalH + PAD);
      const x = (width - colW) / 2;
      const y = Math.max(top, (height - totalH) / 2);
      // the blurb goes under the card, so lay the column out without it and move it down after
      this.layoutColumn(x, y, colW, titleH, cell, glidersW, false);
      const cardY = y + columnH - this.blurb.height;
      this.layoutCard(x, cardY, cardW, cardH, contentH, artSize, icon);
      this.blurb.setPosition(width / 2, cardY + cardH + 28);
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

  /** The rank card at (x, y), its contents centred in it. */
  private layoutCard(x: number, y: number, w: number, h: number, contentH: number, artSize: number, icon: number) {
    this.card.setPosition(x, y).setSize(w, h);
    const cx = x + w / 2;
    const inner = w - CARD_PAD * 2;
    let cy = y + (h - contentH) / 2;
    this.cardLabel.setPosition(cx, cy);
    cy += this.cardLabel.height + ART_GAP;

    // a glowing disc behind the creature, ringed in yellow once there's a rank; the glow spills into the gaps around it
    const r = artSize / 2;
    const ay = cy + r;
    this.halo.clear();
    for (let i = 3; i >= 1; i--) this.halo.fillStyle(0x8b3bdb, 0.08).fillCircle(cx, ay, r * (1 + i * 0.05));
    this.halo.fillStyle(0x15112a).fillCircle(cx, ay, r);
    this.halo.lineStyle(3, this.rank >= 0 ? 0xffe03d : LOCKED).strokeCircle(cx, ay, r);
    this.art.setDisplaySize(artSize * 0.78, artSize * 0.78);
    this.artBox.setPosition(cx, ay);
    cy += artSize + ART_GAP;

    this.tierText.setPosition(cx, cy);
    cy += this.tierText.height + 4;
    this.ratingText.setPosition(cx, cy);
    cy += this.ratingText.height;

    if (this.rank >= 0) {
      cy += 18;
      const bx = x + CARD_PAD;
      this.bar.clear();
      this.bar.fillStyle(0x15112a).fillRect(bx, cy, inner, BAR_H);
      this.bar.fillStyle(0xffe03d).fillRect(bx, cy, Math.round(inner * Phaser.Math.Clamp(this.progress, 0, 1)), BAR_H);
      cy += BAR_H + 8;
      this.barText.setPosition(cx, cy);
      cy += this.barText.height;
    }
    cy += 28;

    // every tier in a row, lowest first; the current one is boxed
    const ladderW = RANKS.length * icon + (RANKS.length - 1) * LADDER_GAP;
    const lx = cx - ladderW / 2;
    this.ladder.forEach((img, i) => img.setDisplaySize(icon, icon).setPosition(lx + i * (icon + LADDER_GAP) + icon / 2, cy + icon / 2));
    this.ladderMark.clear();
    if (this.rank >= 0) {
      this.ladderMark.lineStyle(2, 0xffe03d).strokeRect(lx + this.rank * (icon + LADDER_GAP) - 4, cy - 4, icon + 8, icon + 8);
    }
    cy += icon + 20;
    this.modesText.setPosition(cx, cy);
  }
}
