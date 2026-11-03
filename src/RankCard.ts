import * as Phaser from "phaser";
import { MODES, modeName } from "./modes";
import Online from "./net/Online";
import { loadRankArt, rankArt, rankIndex, RANKS } from "./ranks";
import { displayFont, fontFamily, PANEL_COLOR } from "./ui";

const CARD_PAD = 32;
const BAR_H = 10;
const LADDER_GAP = 8;
const LOCKED = 0x3a3166;
// room above and below the creature's disc, for its glow
const ART_GAP = 28;
// between the card and the player counts under it
const STATS_GAP = 14;
const ONLINE_DOT = 0x3ddc84;
// how long "Counting players…" waits for the server before the line goes blank
const STATS_WAIT_MS = 5_000;

/**
 * The player's rank: their best mode's tier as its creature, how far it is to the next, and every tier in a row,
 * the ones not reached yet in silhouette. Under the card, how many players are online and how many have signed up.
 * Load its art with RankCard.preload in the scene's preload; then measure() and layout() from the scene's layout,
 * and refresh() when the profile changes.
 */
export default class RankCard {
  static preload(scene: Phaser.Scene) {
    loadRankArt(scene);
  }

  private card: Phaser.GameObjects.Rectangle;
  private label: Phaser.GameObjects.Text;
  private halo: Phaser.GameObjects.Graphics;
  // the creature bobs inside its container, which the layout places
  private artBox: Phaser.GameObjects.Container;
  private art: Phaser.GameObjects.Image;
  private tierText: Phaser.GameObjects.Text;
  private ratingText: Phaser.GameObjects.Text;
  private bar: Phaser.GameObjects.Graphics;
  private barText: Phaser.GameObjects.Text;
  private ladder: Phaser.GameObjects.Image[];
  private ladderMark: Phaser.GameObjects.Graphics;
  private modesText: Phaser.GameObjects.Text;
  private statsText: Phaser.GameObjects.Text;
  private statsDot: Phaser.GameObjects.Graphics;
  // the rank shown: its tier's place in RANKS (-1 for a guest) and how far it is into that tier
  private rank = -1;
  private progress = 0;
  // STATS_WAIT_MS passed without counts from the server
  private waited = false;
  // sizes from the last measure()
  private artSize = 0;
  private icon = 0;
  private contentH = 0;

  constructor(scene: Phaser.Scene) {
    const font = fontFamily();
    const display = displayFont();
    this.card = scene.add.rectangle(0, 0, 1, 1, PANEL_COLOR).setOrigin(0).setStrokeStyle(2, LOCKED);
    this.label = scene.add.text(0, 0, "YOUR RANK", { fontFamily: display, fontSize: "15px", fontStyle: "bold", color: "#d4ccff" }).setOrigin(0.5, 0);
    this.halo = scene.add.graphics();
    this.art = scene.add.image(0, 0, rankArt(0));
    this.artBox = scene.add.container(0, 0, [this.art]);
    scene.tweens.add({ targets: this.art, y: -8, duration: 1600, ease: "Sine.InOut", yoyo: true, repeat: -1 });
    this.tierText = scene.add.text(0, 0, "", { fontFamily: display, fontSize: "48px", fontStyle: "bold", color: "#ffe03d" }).setOrigin(0.5, 0);
    this.ratingText = scene.add.text(0, 0, "", { fontFamily: font, fontSize: "16px", color: "#f8f5ff", align: "center" }).setOrigin(0.5, 0);
    this.bar = scene.add.graphics();
    this.barText = scene.add.text(0, 0, "", { fontFamily: font, fontSize: "14px", color: "#d4ccff", align: "center" }).setOrigin(0.5, 0);
    this.ladder = RANKS.map((_, i) => scene.add.image(0, 0, rankArt(i, true)));
    this.ladderMark = scene.add.graphics();
    this.modesText = scene.add
      .text(0, 0, "", { fontFamily: font, fontSize: "14px", color: "#d4ccff", align: "center", lineSpacing: 4 })
      .setOrigin(0.5, 0);
    // always one line, so a new count never moves anything else
    this.statsText = scene.add.text(0, 0, "", { fontFamily: font, fontSize: "14px", fontStyle: "bold", color: "#d4ccff" }).setOrigin(0.5, 0);
    this.statsDot = scene.add.graphics();

    const online = Online.get();
    online.on("stats", this.showStats, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => online.off("stats", this.showStats, this));
    // the counts arrive within a second or so; a server too old to send them shouldn't leave "Counting…" up for good
    scene.time.delayedCall(STATS_WAIT_MS, () => {
      this.waited = true;
      this.showStats();
    });
    this.refresh();
    this.showStats();
  }

  /** Fill the card in from the profile: the tier of whichever mode is rated highest. Call measure() and layout() after. */
  refresh() {
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
  }

  /** "12 online · 340 registered", with a green dot while connected. */
  private showStats() {
    const { stats } = Online.get();
    // a space, not nothing, keeps the line's height so the layout doesn't move when the counts arrive
    if (!stats) this.statsText.setText(this.waited ? " " : "Counting players…");
    else this.statsText.setText(stats.registered === null ? `${stats.online} online` : `${stats.online} online · ${stats.registered} registered`);
    this.statsDot.setVisible(!!stats);
    this.placeDot();
  }

  private placeDot() {
    const t = this.statsText;
    this.statsDot.clear().fillStyle(ONLINE_DOT).fillCircle(t.x - t.width / 2 - 10, t.y + t.height / 2, 4);
  }

  /** The card's height at width `w`, with a big creature (`large`) or a smaller one; it can be laid out taller. */
  measure(w: number, large: boolean) {
    this.artSize = large ? Math.min(240, w - 140) : Math.min(150, w - 120);
    const inner = w - CARD_PAD * 2;
    for (const t of [this.ratingText, this.barText, this.modesText]) t.setWordWrapWidth(inner);
    this.tierText.setFontSize(large ? 48 : 36);
    this.icon = Math.min(32, Math.floor((inner - LADDER_GAP * (RANKS.length - 1)) / RANKS.length));
    const barH = this.rank >= 0 ? 18 + BAR_H + 8 + this.barText.height : 0;
    this.contentH =
      this.label.height + ART_GAP + this.artSize + ART_GAP + this.tierText.height + 4 + this.ratingText.height + barH + 28 + this.icon + 20 + this.modesText.height;
    return this.contentH + CARD_PAD * 2;
  }

  /** Room the player counts take under the card. */
  get footH() {
    return STATS_GAP + this.statsText.height;
  }

  /** The card at (x, y), its contents centred in it, and the player counts under it. Call measure() first. */
  layout(x: number, y: number, w: number, h: number) {
    const { artSize, icon } = this;
    this.card.setPosition(x, y).setSize(w, h);
    const cx = x + w / 2;
    const inner = w - CARD_PAD * 2;
    let cy = y + (h - this.contentH) / 2;
    this.label.setPosition(cx, cy);
    cy += this.label.height + ART_GAP;

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

    // the dot sits left of the text, so nudge the text right by half its width to keep the pair centred
    this.statsText.setPosition(cx + 7, y + h + STATS_GAP);
    this.placeDot();
  }
}
