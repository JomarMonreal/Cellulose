import * as Phaser from "phaser";
import { type Mode, MODES } from "../modes";
import Online from "../net/Online";
import type { Leaderboard, LeaderboardEntry } from "../net/protocol";
import { loadRankArt, rankArt, rankIndex } from "../ranks";
import {
  BTN_H,
  type Button,
  displayFont,
  fitHeight,
  fontFamily,
  layoutButton,
  makeButton,
  makeSpinner,
  PANEL_COLOR,
  PRIMARY,
  SECONDARY,
  SPINNER_INDENT,
  SPINNER_SIZE,
  setButtonStyle,
} from "../ui";

const PAD = 24;
const GAP = 12;
const ROW_H = 36;
const ICON = 26;
// the place column, and the rating and won columns (right-aligned); narrower on a phone
const PLACE_W = 44;
const NUM_W = 72;
const NARROW_PLACE_W = 30;
const NARROW_NUM_W = 48;
// the server sends at most this many, plus you if you're further down
const ROWS = 50;
const ME_COLOR = "#ffe03d";
const ME_FILL = 0x2b2448;
const MODE_KEY = "cellulose:rankedMode";

type Row = {
  bg: Phaser.GameObjects.Rectangle;
  place: Phaser.GameObjects.Text;
  icon: Phaser.GameObjects.Image;
  name: Phaser.GameObjects.Text;
  rating: Phaser.GameObjects.Text;
  won: Phaser.GameObjects.Text;
};

/**
 * The ranked leaderboards, one per mode: the best rated players who have played it, each with their tier's creature,
 * rating and games won. You're highlighted; if you're rated but further down, your own place shows under the list.
 * Each board is fetched when first shown, then kept while the screen is open. The page scrolls when it's long.
 */
export default class LeaderboardScene extends Phaser.Scene {
  constructor() {
    super("LeaderboardScene");
  }

  private online!: Online;
  private mode!: Mode;
  // fetched boards, by mode; a fetch on its way, so a second one isn't started
  private boards!: Map<Mode, Leaderboard>;
  private loading!: Set<Mode>;
  private error!: string;
  // where Back goes: the screen that opened this one
  private from!: string;

  private panel!: Phaser.GameObjects.Rectangle;
  private title!: Phaser.GameObjects.Text;
  private status!: Phaser.GameObjects.Text;
  private spinner!: Phaser.GameObjects.Graphics;
  private modeButtons!: Button[];
  private header!: Phaser.GameObjects.Text[];
  private rows!: Row[];
  // your row, under the list when you didn't make it
  private meRow!: Row;
  private gapText!: Phaser.GameObjects.Text;
  private backButton!: Button;

  init(data?: { mode?: Mode; from?: "HomeScene" | "RankedScene" }) {
    this.from = data?.from ?? "RankedScene";
    this.online = Online.get();
    const saved = localStorage.getItem(MODE_KEY);
    this.mode = data?.mode ?? (MODES.some((m) => m.id === saved) ? (saved as Mode) : "strongest500");
    this.boards = new Map();
    this.loading = new Set();
    this.error = "";
  }

  preload() {
    loadRankArt(this);
  }

  create() {
    const font = fontFamily();
    const display = displayFont();
    this.panel = this.add.rectangle(0, 0, 1, 1, PANEL_COLOR).setOrigin(0);
    this.title = this.add.text(0, 0, "Leaderboard", { fontFamily: display, fontSize: "32px", fontStyle: "bold", color: "#f8f5ff" });
    this.status = this.add.text(0, 0, "", { fontFamily: font, fontSize: "15px", color: "#d4ccff" });
    this.spinner = makeSpinner(this);
    this.modeButtons = MODES.map((m) => makeButton(this, m.name, SECONDARY, () => this.pickMode(m.id)));
    for (const b of this.modeButtons) b.label.setFontSize(17);
    const headStyle = { fontFamily: display, fontSize: "14px", color: "#d4ccff" };
    this.header = ["#", "Player", "Rating", "Won"].map((t) => this.add.text(0, 0, t, headStyle));
    this.rows = Array.from({ length: ROWS }, () => this.makeRow(font, display));
    this.meRow = this.makeRow(font, display);
    this.gapText = this.add.text(0, 0, "⋮", { fontFamily: font, fontSize: "18px", color: "#d4ccff" }).setOrigin(0.5, 0);
    this.backButton = makeButton(this, "Back", SECONDARY, () =>
      this.scene.start(this.from, this.from === "RankedScene" ? { kind: "ranked" } : undefined),
    );

    // not connected yet (or the connection dropped): fetch once it's back
    const onStatus = () => {
      if (this.online.connected) this.fetch(this.mode);
      this.refresh();
    };
    this.online.on("status", onStatus);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.online.off("status", onStatus);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });
    this.fetch(this.mode);
    this.refresh();
  }

  private makeRow(font: string, display: string): Row {
    const text = { fontFamily: font, fontSize: "15px", color: "#f8f5ff" };
    return {
      bg: this.add.rectangle(0, 0, 1, ROW_H, ME_FILL).setOrigin(0),
      place: this.add.text(0, 0, "", { fontFamily: display, fontSize: "16px", color: "#d4ccff" }).setOrigin(0, 0.5),
      icon: this.add.image(0, 0, rankArt(0, true)).setDisplaySize(ICON, ICON),
      name: this.add.text(0, 0, "", { ...text, fontStyle: "bold" }).setOrigin(0, 0.5),
      rating: this.add.text(0, 0, "", text).setOrigin(1, 0.5),
      won: this.add.text(0, 0, "", { ...text, color: "#d4ccff" }).setOrigin(1, 0.5),
    };
  }

  private pickMode(mode: Mode) {
    this.mode = mode;
    localStorage.setItem(MODE_KEY, mode);
    this.error = "";
    this.fetch(mode);
    this.refresh();
  }

  private async fetch(mode: Mode) {
    if (this.boards.has(mode) || this.loading.has(mode) || !this.online.connected) return;
    this.loading.add(mode);
    const r = await this.online.leaderboard(mode);
    this.loading.delete(mode);
    if (!this.scene.isActive()) return;
    if (r.ok) this.boards.set(mode, r.leaderboard);
    else if (mode === this.mode) this.error = r.reason;
    this.refresh();
  }

  private refresh() {
    const board = this.boards.get(this.mode);
    const busy = !board && !this.error;
    this.modeButtons.forEach((b, i) => setButtonStyle(b, MODES[i].id === this.mode ? PRIMARY : SECONDARY));
    let status: string;
    if (this.error) status = this.error;
    else if (!board) status = this.online.connectionStatus ?? "Loading…";
    else if (!board.entries.length) status = "Nobody has played a ranked game in this mode yet.";
    else if (board.me) status = `You're #${board.me.place} with ${board.me.rating}.`;
    else status = this.online.profile ? "Play a ranked game in this mode to get on the board." : "Sign in and play ranked to get on the board.";
    this.status.setText(status).setColor(this.error ? "#ff4d5e" : "#d4ccff");
    this.spinner.setVisible(busy);

    const entries = board?.entries ?? [];
    const me = board?.me ?? null;
    const isMe = (e: LeaderboardEntry) => !!me && e.username === me.username;
    this.rows.forEach((row, i) => this.fillRow(row, entries[i], !!entries[i] && isMe(entries[i])));
    // you're further down than the list goes
    const meBelow = !!me && !entries.some(isMe);
    this.fillRow(this.meRow, meBelow ? me : undefined, true);
    this.gapText.setVisible(meBelow);
    for (const h of this.header) h.setVisible(entries.length > 0);
    this.layout(this.scale.gameSize);
  }

  private fillRow(row: Row, entry: LeaderboardEntry | undefined, mine: boolean) {
    const shown = !!entry;
    for (const o of [row.place, row.icon, row.name, row.rating, row.won]) o.setVisible(shown);
    row.bg.setVisible(shown && mine);
    if (!entry) return;
    row.place.setText(String(entry.place)).setColor(mine ? ME_COLOR : "#d4ccff");
    row.icon.setTexture(rankArt(rankIndex(entry.tier), true)).setDisplaySize(ICON, ICON);
    row.name.setText(entry.username).setColor(mine ? ME_COLOR : "#f8f5ff");
    row.rating.setText(String(entry.rating));
    row.won.setText(`${entry.wins}/${entry.games}`);
  }

  /** A centred panel: title, mode buttons, then the table, one row per player. */
  private layout({ width, height }: Phaser.Structs.Size) {
    const pw = Math.min(640, width - PAD * 2);
    const inner = pw - 64;
    this.status.setWordWrapWidth(inner - SPINNER_INDENT);
    const shownRows = this.rows.filter((r) => r.name.visible).length;
    const meBelow = this.meRow.name.visible;
    const tableH = shownRows ? 24 + shownRows * ROW_H + (meBelow ? 28 + ROW_H : 0) : 0;
    const ph = 32 + this.title.height + 8 + this.status.height + 24 + BTN_H + 24 + tableH + (tableH ? 24 : 0) + BTN_H + 32;
    fitHeight(this, ph + PAD * 2);
    const px = (width - pw) / 2;
    const py = Math.max(PAD, (height - ph) / 2);
    const x = px + 32;
    this.panel.setPosition(px, py).setSize(pw, ph);

    let y = py + 32;
    this.title.setPosition(x, y);
    y += this.title.height + 8;
    const spin = this.spinner.visible;
    this.status.setPosition(x + (spin ? SPINNER_INDENT : 0), y);
    this.spinner.setPosition(x + SPINNER_SIZE / 2, y + 10);
    y += this.status.height + 24;
    const bw = (inner - GAP) / 2;
    this.modeButtons.forEach((b, i) => layoutButton(b, x + i * (bw + GAP), y, bw));
    y += BTN_H + 24;

    // columns: place, the tier's creature and the name, then rating and games won on the right
    const narrow = inner < 400;
    const placeW = narrow ? NARROW_PLACE_W : PLACE_W;
    const numW = narrow ? NARROW_NUM_W : NUM_W;
    const nameX = x + placeW + ICON + 8;
    const wonR = x + inner;
    const ratingR = wonR - numW - 8;
    for (const h of this.header) h.setFontSize(narrow ? 12 : 14);
    if (tableH) {
      const [place, player, rating, won] = this.header;
      place.setPosition(x, y);
      player.setPosition(nameX, y);
      rating.setOrigin(1, 0).setPosition(ratingR, y);
      won.setOrigin(1, 0).setPosition(wonR, y);
      y += 24;
      const placeRow = (row: Row, ry: number) => {
        const cy = ry + ROW_H / 2;
        row.bg.setPosition(x - 12, ry).setSize(inner + 24, ROW_H);
        row.place.setPosition(x, cy);
        row.icon.setPosition(x + placeW + ICON / 2, cy);
        row.name.setPosition(nameX, cy);
        // a long name stops short of the rating column
        row.name.setCrop(0, 0, ratingR - numW - nameX, ROW_H);
        row.rating.setPosition(ratingR, cy);
        row.won.setPosition(wonR, cy);
      };
      this.rows.forEach((row, i) => placeRow(row, y + i * ROW_H));
      y += shownRows * ROW_H;
      if (meBelow) {
        this.gapText.setPosition(px + pw / 2, y + 2);
        y += 28;
        placeRow(this.meRow, y);
        y += ROW_H;
      }
      y += 24;
    }
    layoutButton(this.backButton, x, y, inner);
  }
}
