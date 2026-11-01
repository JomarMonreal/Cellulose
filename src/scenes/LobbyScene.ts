import * as Phaser from "phaser";
import { MODES } from "../modes";
import { PALETTE } from "../Player";
import { BTN_H, type Button, displayFont, fitHeight, fontFamily, layoutButton, makeButton, PANEL_COLOR, PRIMARY, SECONDARY, setButtonStyle } from "../ui";
import { FINAL_GENERATION, type GameSettings } from "./GameScene";

const PAD = 24;
const GAP = 12;
const MAX_OPPONENTS = PALETTE.length - 1;

/** Single-player setup: pick the mode, your colour and how many AI colonies to face, then start. */
export default class LobbyScene extends Phaser.Scene {
  constructor() {
    super("LobbyScene");
  }

  private settings!: GameSettings;

  private panel!: Phaser.GameObjects.Rectangle;
  private title!: Phaser.GameObjects.Text;
  private modeLabel!: Phaser.GameObjects.Text;
  private modeButtons!: Button[];
  private colorLabel!: Phaser.GameObjects.Text;
  private swatches!: Button[];
  private opponentsLabel!: Phaser.GameObjects.Text;
  private opponentButtons!: Button[];
  private matchup!: Phaser.GameObjects.Text;
  private backButton!: Button;
  private startButton!: Button;

  /** Coming back from a game keeps that game's settings. */
  init(data: Partial<GameSettings>) {
    this.settings = { color: data.color ?? 0, opponents: data.opponents ?? MAX_OPPONENTS, mode: data.mode ?? "strongest500" };
  }

  create() {
    const font = fontFamily();
    const display = displayFont();
    const labelStyle = { fontFamily: display, fontSize: "16px", fontStyle: "bold", color: "#d4ccff" };

    this.panel = this.add.rectangle(0, 0, 1, 1, PANEL_COLOR).setOrigin(0);
    this.title = this.add.text(0, 0, "Play with bots", { fontFamily: display, fontSize: "32px", fontStyle: "bold", color: "#f8f5ff" });
    this.modeLabel = this.add.text(0, 0, "Mode", labelStyle);
    this.modeButtons = MODES.map((m) =>
      makeButton(this, m.name, SECONDARY, () => {
        this.settings.mode = m.id;
        this.refresh();
      }),
    );
    for (const b of this.modeButtons) b.label.setFontSize(17);
    this.colorLabel = this.add.text(0, 0, "", labelStyle);
    this.swatches = PALETTE.map(({ color }, i) =>
      makeButton(this, "", { fill: color, hover: color, text: "#120e22" }, () => {
        this.settings.color = i;
        this.refresh();
      }),
    );
    this.opponentsLabel = this.add.text(0, 0, "AI opponents", labelStyle);
    this.opponentButtons = Array.from({ length: MAX_OPPONENTS }, (_, i) =>
      makeButton(this, `${i + 1}`, SECONDARY, () => {
        this.settings.opponents = i + 1;
        this.refresh();
      }),
    );
    this.matchup = this.add.text(0, 0, "", { fontFamily: font, fontSize: "15px", color: "#f8f5ff", lineSpacing: 4 });
    this.backButton = makeButton(this, "Back", SECONDARY, () => this.scene.start("HomeScene"));
    this.startButton = makeButton(this, "Start", PRIMARY, () => this.scene.start("GameScene", { ...this.settings }));

    this.refresh();
    this.layout(this.scale.gameSize);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this));
  }

  /** Show the current choices: the mode and opponent count lit up, a tick on the chosen colour, and who you'll face. */
  private refresh() {
    const { color, opponents, mode } = this.settings;
    this.modeButtons.forEach((b, i) => setButtonStyle(b, MODES[i].id === mode ? PRIMARY : SECONDARY));
    this.colorLabel.setText(`Your colour: ${PALETTE[color].name}`);
    this.swatches.forEach((b, i) => b.label.setText(i === color ? "✓" : ""));
    this.opponentButtons.forEach((b, i) => setButtonStyle(b, i + 1 === opponents ? PRIMARY : SECONDARY));
    const rivals = PALETTE.filter((_, i) => i !== color)
      .slice(0, opponents)
      .map((p) => `${p.name} AI`);
    const rule = mode === "ctf" ? MODES.find((m) => m.id === "ctf")!.rule : `${FINAL_GENERATION.strongest500} generations. Most land at the end wins.`;
    this.matchup.setText(`You vs ${rivals.join(", ")}\n${rule}`);
  }

  /** A centred panel; rows of equal-width buttons fill its width. */
  private layout({ width, height }: Phaser.Structs.Size) {
    const pw = Math.min(460, width - PAD * 2);
    const inner = pw - 64;
    this.matchup.setWordWrapWidth(inner);
    const ph = 32 + this.title.height + 28 + (24 + BTN_H + 28) * 3 - 4 + this.matchup.height + 32 + BTN_H + 32;
    fitHeight(this, ph + PAD * 2);
    const px = (width - pw) / 2;
    const py = Math.max(PAD, (height - ph) / 2);
    const x = px + 32;
    this.panel.setPosition(px, py).setSize(pw, ph);

    let y = py + 32;
    this.title.setPosition(x, y);
    y += this.title.height + 28;

    this.modeLabel.setPosition(x, y);
    y += 24;
    this.layoutRow(this.modeButtons, x, y, inner);
    y += BTN_H + 28;

    this.colorLabel.setPosition(x, y);
    y += 24;
    this.layoutRow(this.swatches, x, y, inner);
    y += BTN_H + 28;

    this.opponentsLabel.setPosition(x, y);
    y += 24;
    this.layoutRow(this.opponentButtons, x, y, inner);
    y += BTN_H + 24;

    this.matchup.setPosition(x, y);
    y += this.matchup.height + 32;
    this.layoutRow([this.backButton, this.startButton], x, y, inner);
  }

  private layoutRow(buttons: Button[], x: number, y: number, w: number) {
    const bw = (w - GAP * (buttons.length - 1)) / buttons.length;
    buttons.forEach((b, i) => layoutButton(b, x + i * (bw + GAP), y, bw));
  }
}
