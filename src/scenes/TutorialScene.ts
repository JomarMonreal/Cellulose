import * as Phaser from "phaser";
import { GUIDE } from "../patterns";
import { displayFont, fitHeight, fontFamily, PANEL_COLOR } from "../ui";

const PAD = 24;
const GAP = 16;
// cards are at least this wide; as many columns as fit
const MIN_CARD_W = 240;
const MAX_CONTENT_W = 1040;
// the drawing at the top of each card
const DRAWING_H = 120;
const MAX_TILE = 14;
const CARD_PAD = 16;
const EMPTY_COLOR = 0x15112a;
const GRID_COLOR = 0x2b2448;

type Card = { panel: Phaser.GameObjects.Rectangle; name: Phaser.GameObjects.Text; about: Phaser.GameObjects.Text };
type Section = { heading: Phaser.GameObjects.Text; about: Phaser.GameObjects.Text; cards: Card[] };

/**
 * The tutorial: patterns worth knowing, by kind (still lifes, oscillators, spaceships, guns, methuselahs), each
 * drawn with what it does. The page scrolls when it's taller than the window.
 */
export default class TutorialScene extends Phaser.Scene {
  constructor() {
    super("TutorialScene");
  }

  private title!: Phaser.GameObjects.Text;
  private backText!: Phaser.GameObjects.Text;
  private intro!: Phaser.GameObjects.Text;
  private sections!: Section[];
  // every card's drawing, redrawn on each layout
  private drawings!: Phaser.GameObjects.Graphics;

  create() {
    const font = fontFamily();
    const display = displayFont();

    this.title = this.add.text(0, 0, "Tutorial", { fontFamily: display, fontSize: "32px", fontStyle: "bold", color: "#f8f5ff" });
    this.backText = this.add
      .text(0, 0, "Back", { fontFamily: display, fontSize: "16px", fontStyle: "bold", color: "#d4ccff" })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => this.backText.setColor("#ffe03d"))
      .on("pointerout", () => this.backText.setColor("#d4ccff"))
      .on("pointerdown", () => this.scene.start("HomeScene"));
    this.intro = this.add.text(
      0,
      0,
      "Some shapes behave in ways you can count on. Learn them, then place them on your land to hold it, spread it, or reach a rival's. Try any of them in the playground.",
      { fontFamily: font, fontSize: "16px", color: "#d4ccff", lineSpacing: 4 },
    );

    this.sections = GUIDE.map((s) => ({
      heading: this.add.text(0, 0, s.title, {
        fontFamily: display,
        fontSize: "24px",
        fontStyle: "bold",
        color: `#${s.color.toString(16).padStart(6, "0")}`,
      }),
      about: this.add.text(0, 0, s.about, { fontFamily: font, fontSize: "15px", color: "#f8f5ff", lineSpacing: 4 }),
      cards: s.patterns.map((p) => ({
        panel: this.add.rectangle(0, 0, 1, 1, PANEL_COLOR).setOrigin(0),
        name: this.add.text(0, 0, p.name, { fontFamily: display, fontSize: "18px", fontStyle: "bold", color: "#f8f5ff" }),
        about: this.add.text(0, 0, p.about, { fontFamily: font, fontSize: "14px", color: "#d4ccff", lineSpacing: 3 }),
      })),
    }));
    // after the panels, so the drawings sit on top of them
    this.drawings = this.add.graphics();

    this.layout(this.scale.gameSize);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this));
  }

  /** A centred column: the title and intro, then each section's heading, its line, and a grid of cards. */
  private layout({ width }: Phaser.Structs.Size) {
    const w = Math.min(MAX_CONTENT_W, width - PAD * 2);
    const x = (width - w) / 2;
    const cols = Math.max(1, Math.floor((w + GAP) / (MIN_CARD_W + GAP)));
    const cardW = (w - GAP * (cols - 1)) / cols;
    this.drawings.clear();

    let y = PAD;
    this.title.setPosition(x, y);
    this.backText.setPosition(x + w, y + 10);
    y += this.title.height + 12;
    this.intro.setWordWrapWidth(w).setPosition(x, y);
    y += this.intro.height + 32;

    GUIDE.forEach((s, si) => {
      const { heading, about, cards } = this.sections[si];
      heading.setPosition(x, y);
      y += heading.height + 6;
      about.setWordWrapWidth(w).setPosition(x, y);
      y += about.height + 16;

      // a row of cards is as tall as its tallest description
      for (let start = 0; start < cards.length; start += cols) {
        const row = cards.slice(start, start + cols);
        for (const c of row) {
          c.name.setWordWrapWidth(cardW - CARD_PAD * 2);
          c.about.setWordWrapWidth(cardW - CARD_PAD * 2);
        }
        const rowH = CARD_PAD + DRAWING_H + 12 + Math.max(...row.map((c) => c.name.height + 4 + c.about.height)) + CARD_PAD;
        row.forEach((c, i) => {
          const cx = x + i * (cardW + GAP);
          c.panel.setPosition(cx, y).setSize(cardW, rowH);
          this.drawPattern(s.patterns[start + i].cells, s.color, cx + CARD_PAD, y + CARD_PAD, cardW - CARD_PAD * 2);
          c.name.setPosition(cx + CARD_PAD, y + CARD_PAD + DRAWING_H + 12);
          c.about.setPosition(cx + CARD_PAD, c.name.y + c.name.height + 4);
        });
        y += rowH + GAP;
      }
      y += 24;
    });

    // the page scrolls when the guide is taller than the window
    fitHeight(this, y - 24 - GAP + PAD);
  }

  /** The pattern on a little board one tile bigger all round, centred in a w × DRAWING_H box. */
  private drawPattern(cells: [number, number][], color: number, bx: number, by: number, w: number) {
    const rows = Math.max(...cells.map(([r]) => r)) + 3;
    const cols = Math.max(...cells.map(([, c]) => c)) + 3;
    const tile = Math.min(MAX_TILE, Math.floor(w / cols), Math.floor(DRAWING_H / rows));
    const ox = bx + (w - tile * cols) / 2;
    const oy = by + (DRAWING_H - tile * rows) / 2;
    const g = this.drawings;
    g.fillStyle(EMPTY_COLOR).fillRect(ox, oy, tile * cols, tile * rows);
    g.lineStyle(1, GRID_COLOR);
    for (let c = 0; c <= cols; c++) g.lineBetween(ox + c * tile, oy, ox + c * tile, oy + rows * tile);
    for (let r = 0; r <= rows; r++) g.lineBetween(ox, oy + r * tile, ox + cols * tile, oy + r * tile);
    g.fillStyle(color);
    for (const [r, c] of cells) g.fillRect(ox + (c + 1) * tile + 1, oy + (r + 1) * tile + 1, tile - 1, tile - 1);
  }
}
